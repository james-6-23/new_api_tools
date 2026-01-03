package tasks

import (
	"context"
	"time"

	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/ketches/new-api-tools/internal/models"
	"go.uber.org/zap"
)

// IPRecordingEnforceTask 强制开启 IP 记录任务
// 每 30 分钟检查并强制开启所有用户的 IP 记录功能
func IPRecordingEnforceTask(ctx context.Context) error {
	db := database.GetMainDB()

	// 查询关闭了 IP 记录的用户数量
	// NewAPI 中 request_count 字段用于控制 IP 记录
	// 当 request_count < 0 时表示关闭了 IP 记录
	var disabledCount int64
	if err := db.Model(&models.User{}).
		Where("deleted_at IS NULL AND request_count < 0").
		Count(&disabledCount).Error; err != nil {
		return err
	}

	if disabledCount == 0 {
		logger.Debug("所有用户已开启 IP 记录")
		return nil
	}

	// 强制开启 IP 记录
	result := db.Model(&models.User{}).
		Where("deleted_at IS NULL AND request_count < 0").
		Update("request_count", 0)

	if result.Error != nil {
		return result.Error
	}

	logger.Info("已强制开启 IP 记录",
		zap.Int64("updated", result.RowsAffected))

	return nil
}

// IndexEnsureTask 后台索引创建任务
// 在启动时检查并创建缺失的索引
func IndexEnsureTask(ctx context.Context) error {
	db := database.GetMainDB()

	// 需要创建的索引列表
	indexes := []struct {
		table string
		name  string
		sql   string
	}{
		{
			table: "logs",
			name:  "idx_logs_created_type_user",
			sql:   "CREATE INDEX IF NOT EXISTS idx_logs_created_type_user ON logs(created_at, type, user_id)",
		},
		{
			table: "logs",
			name:  "idx_logs_created_ip_token",
			sql:   "CREATE INDEX IF NOT EXISTS idx_logs_created_ip_token ON logs(created_at, ip, token_id)",
		},
		{
			table: "logs",
			name:  "idx_logs_user_created",
			sql:   "CREATE INDEX IF NOT EXISTS idx_logs_user_created ON logs(user_id, created_at)",
		},
		{
			table: "logs",
			name:  "idx_logs_token_created",
			sql:   "CREATE INDEX IF NOT EXISTS idx_logs_token_created ON logs(token_id, created_at)",
		},
	}

	for _, idx := range indexes {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// 检查索引是否存在
		var exists bool
		if db.Dialector.Name() == "postgres" {
			var count int64
			db.Raw("SELECT COUNT(*) FROM pg_indexes WHERE indexname = ?", idx.name).Scan(&count)
			exists = count > 0
		} else {
			// MySQL
			var count int64
			db.Raw("SELECT COUNT(*) FROM information_schema.statistics WHERE table_name = ? AND index_name = ?",
				idx.table, idx.name).Scan(&count)
			exists = count > 0
		}

		if exists {
			logger.Debug("索引已存在", zap.String("index", idx.name))
			continue
		}

		// 创建索引
		logger.Info("正在创建索引", zap.String("index", idx.name))
		start := time.Now()

		if err := db.Exec(idx.sql).Error; err != nil {
			logger.Error("创建索引失败",
				zap.String("index", idx.name),
				zap.Error(err))
			continue
		}

		logger.Info("索引创建完成",
			zap.String("index", idx.name),
			zap.Duration("elapsed", time.Since(start)))

		// 每个索引创建后等待一下，避免数据库压力过大
		time.Sleep(2 * time.Second)
	}

	return nil
}

// LogSyncTask 日志同步任务
// 定时处理新日志，更新统计数据
func LogSyncTask(ctx context.Context) error {
	// 获取分析服务
	analyticsService := NewAnalyticsService()

	// 检查是否需要同步
	state, err := analyticsService.GetState()
	if err != nil {
		return err
	}

	if state.NeedsInitialSync {
		// 未初始化，跳过自动同步
		logger.Debug("日志分析未初始化，跳过自动同步")
		return nil
	}

	// 处理新日志
	processed, err := analyticsService.ProcessNewLogs(5000)
	if err != nil {
		return err
	}

	if processed > 0 {
		logger.Info("日志同步完成", zap.Int("processed", processed))
	}

	return nil
}

// AnalyticsService 简化的分析服务（用于后台任务）
type AnalyticsService struct{}

// NewAnalyticsService 创建分析服务
func NewAnalyticsService() *AnalyticsService {
	return &AnalyticsService{}
}

// AnalyticsState 分析状态
type AnalyticsState struct {
	LastProcessedID  int64     `json:"last_processed_id"`
	LastProcessedAt  time.Time `json:"last_processed_at"`
	TotalProcessed   int64     `json:"total_processed"`
	NeedsInitialSync bool      `json:"needs_initial_sync"`
}

// GetState 获取分析状态
func (s *AnalyticsService) GetState() (*AnalyticsState, error) {
	db := database.GetLocalDB()

	var state struct {
		LastProcessedID int64
		LastProcessedAt *time.Time
		TotalProcessed  int64
	}

	err := db.Raw(`
		SELECT last_processed_id, last_processed_at, total_processed
		FROM analytics_state
		ORDER BY id DESC LIMIT 1
	`).Scan(&state).Error

	if err != nil {
		return &AnalyticsState{NeedsInitialSync: true}, nil
	}

	return &AnalyticsState{
		LastProcessedID: state.LastProcessedID,
		LastProcessedAt: func() time.Time {
			if state.LastProcessedAt != nil {
				return *state.LastProcessedAt
			}
			return time.Time{}
		}(),
		TotalProcessed:   state.TotalProcessed,
		NeedsInitialSync: state.LastProcessedID == 0,
	}, nil
}

// ProcessNewLogs 处理新日志
func (s *AnalyticsService) ProcessNewLogs(limit int) (int, error) {
	// 获取当前状态
	state, err := s.GetState()
	if err != nil {
		return 0, err
	}

	mainDB := database.GetMainDB()
	localDB := database.GetLocalDB()

	// 查询新日志
	var logs []models.Log
	err = mainDB.Where("id > ? AND type = ?", state.LastProcessedID, models.LogTypeConsume).
		Order("id ASC").
		Limit(limit).
		Find(&logs).Error

	if err != nil {
		return 0, err
	}

	if len(logs) == 0 {
		return 0, nil
	}

	// 更新状态
	lastID := logs[len(logs)-1].ID
	now := time.Now()

	err = localDB.Exec(`
		INSERT INTO analytics_state (last_processed_id, last_processed_at, total_processed, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			last_processed_id = excluded.last_processed_id,
			last_processed_at = excluded.last_processed_at,
			total_processed = analytics_state.total_processed + ?,
			updated_at = excluded.updated_at
	`, lastID, now, len(logs), now, len(logs)).Error

	if err != nil {
		return 0, err
	}

	return len(logs), nil
}

package tasks

import (
	"context"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/ketches/new-api-tools/internal/models"
	"github.com/ketches/new-api-tools/internal/service"
	"go.uber.org/zap"
)

// IPRecordingEnforceTask 强制开启 IP 记录任务
// 每 30 分钟检查并强制开启所有用户的 IP 记录功能
// 防止用户自行关闭 IP 记录导致风控数据缺失
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

	createdCount := 0
	existingCount := 0

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
			existingCount++
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

		createdCount++
		logger.Info("索引创建完成",
			zap.String("index", idx.name),
			zap.Duration("elapsed", time.Since(start)))

		// 每个索引创建后等待一下，避免数据库压力过大
		time.Sleep(2 * time.Second)
	}

	if createdCount > 0 {
		logger.Info("索引创建任务完成",
			zap.Int("created", createdCount),
			zap.Int("existing", existingCount))
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

	// 处理新日志（每次最多处理 5000 条）
	totalProcessed := 0
	for i := 0; i < 5; i++ {
		processed, err := analyticsService.ProcessNewLogs(1000)
		if err != nil {
			return err
		}
		if processed == 0 {
			break
		}
		totalProcessed += processed
	}

	if totalProcessed > 0 {
		logger.Info("日志同步完成", zap.Int("processed", totalProcessed))
	}

	return nil
}

// CacheCleanupTask 过期缓存清理任务
// 定时清理 SQLite 中过期的缓存数据
func CacheCleanupTask(ctx context.Context) error {
	cacheManager := cache.GetCacheManager()

	cleaned, err := cacheManager.CleanupExpired()
	if err != nil {
		return err
	}

	if cleaned > 0 {
		logger.Info("过期缓存清理完成", zap.Int64("cleaned", cleaned))
	}

	return nil
}

// ModelStatusRefreshTask 模型状态刷新任务
// 定时刷新模型列表和状态缓存
func ModelStatusRefreshTask(ctx context.Context) error {
	modelService := service.NewModelStatusService()

	start := time.Now()

	// 刷新可用模型列表
	models, err := modelService.GetAvailableModels()
	if err != nil {
		logger.Warn("刷新模型列表失败", zap.Error(err))
		return err
	}

	logger.Debug("模型状态刷新完成",
		zap.Int("models", len(models)),
		zap.Duration("elapsed", time.Since(start)))

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

	// 兼容 Python 版本的 key-value 表结构
	var lastLogID, totalProcessed, lastProcessedAt int64

	db.Raw(`SELECT value FROM analytics_state WHERE key = 'last_log_id'`).Scan(&lastLogID)
	db.Raw(`SELECT value FROM analytics_state WHERE key = 'total_processed'`).Scan(&totalProcessed)
	db.Raw(`SELECT value FROM analytics_state WHERE key = 'last_processed_at'`).Scan(&lastProcessedAt)

	return &AnalyticsState{
		LastProcessedID: lastLogID,
		LastProcessedAt: func() time.Time {
			if lastProcessedAt > 0 {
				return time.Unix(lastProcessedAt, 0)
			}
			return time.Time{}
		}(),
		TotalProcessed:   totalProcessed,
		NeedsInitialSync: lastLogID == 0,
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

	// 更新状态（兼容 Python 版本的 key-value 结构）
	lastID := logs[len(logs)-1].ID
	now := time.Now().Unix()
	engine := database.GetLocalDBEngine()

	// 使用兼容多数据库的 UPSERT 语法
	sql := database.UpsertSQL("analytics_state", "key", []string{"key", "value", "updated_at"}, []string{"value", "updated_at"}, engine)

	// 更新 last_log_id
	if err = localDB.Exec(sql, "last_log_id", lastID, now).Error; err != nil {
		return 0, err
	}

	// 更新 last_processed_at
	if err = localDB.Exec(sql, "last_processed_at", now, now).Error; err != nil {
		return 0, err
	}

	// 更新 total_processed（累加）
	incrementSQL := database.UpsertWithIncrement("analytics_state", "key", []string{"key", "value", "updated_at"}, "value", engine)
	if err = localDB.Exec(incrementSQL, "total_processed", len(logs), now).Error; err != nil {
		return 0, err
	}

	return len(logs), nil
}

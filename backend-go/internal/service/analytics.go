package service

import (
	"fmt"
	"sync"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/ketches/new-api-tools/internal/models"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// AnalyticsService 日志分析服务
type AnalyticsService struct {
	mu           sync.RWMutex
	isProcessing bool
}

// AnalyticsStateDB 分析状态（对应数据库 analytics_state 表）
type AnalyticsStateDB struct {
	LastProcessedID int64     `json:"last_processed_id"`
	LastProcessedAt time.Time `json:"last_processed_at"`
	TotalProcessed  int64     `json:"total_processed"`
}

// NewAnalyticsService 创建日志分析服务
func NewAnalyticsService() *AnalyticsService {
	return &AnalyticsService{}
}

// AnalyticsState 分析状态
type AnalyticsState struct {
	IsProcessing      bool   `json:"is_processing"`
	LastProcessedAt   string `json:"last_processed_at"`
	TotalLogsCount    int64  `json:"total_logs_count"`
	ProcessedCount    int64  `json:"processed_count"`
	PendingCount      int64  `json:"pending_count"`
	ProcessingSpeed   int64  `json:"processing_speed"`
	EstimatedTimeLeft string `json:"estimated_time_left"`
}

// ProcessResult 处理结果
type ProcessResult struct {
	ProcessedCount int64  `json:"processed_count"`
	Duration       string `json:"duration"`
	StartTime      string `json:"start_time"`
	EndTime        string `json:"end_time"`
}

// UserRequestRanking 用户请求排行
type UserRequestRanking struct {
	Rank         int     `json:"rank"`
	UserID       int     `json:"user_id"`
	Username     string  `json:"username"`
	RequestCount int64   `json:"request_count"`
	SuccessCount int64   `json:"success_count"`
	FailCount    int64   `json:"fail_count"`
	SuccessRate  float64 `json:"success_rate"`
	AvgLatency   float64 `json:"avg_latency"`
	LastRequest  string  `json:"last_request"`
}

// UserQuotaRanking 用户额度排行
type UserQuotaRanking struct {
	Rank       int     `json:"rank"`
	UserID     int     `json:"user_id"`
	Username   string  `json:"username"`
	TotalQuota int64   `json:"total_quota"`
	UsedQuota  int64   `json:"used_quota"`
	UsageRate  float64 `json:"usage_rate"`
	TodayUsed  int64   `json:"today_used"`
	WeekUsed   int64   `json:"week_used"`
	MonthUsed  int64   `json:"month_used"`
}

// ModelStat 模型统计
type ModelStat struct {
	ModelName    string  `json:"model_name"`
	RequestCount int64   `json:"request_count"`
	TotalQuota   int64   `json:"total_quota"`
	AvgQuota     float64 `json:"avg_quota"`
	SuccessRate  float64 `json:"success_rate"`
	AvgLatency   float64 `json:"avg_latency"`
	UserCount    int64   `json:"user_count"`
	LastUsed     string  `json:"last_used"`
}

// AnalyticsSummary 分析摘要
type AnalyticsSummary struct {
	TotalRequests      int64   `json:"total_requests"`
	TotalQuotaUsed     int64   `json:"total_quota_used"`
	UniqueUsers        int64   `json:"unique_users"`
	UniqueModels       int64   `json:"unique_models"`
	AvgRequestsPerUser float64 `json:"avg_requests_per_user"`
	AvgQuotaPerRequest float64 `json:"avg_quota_per_request"`
	PeakHour           int     `json:"peak_hour"`
	PeakHourRequests   int64   `json:"peak_hour_requests"`
	TopModel           string  `json:"top_model"`
	TopModelRequests   int64   `json:"top_model_requests"`
	Period             string  `json:"period"`
	GeneratedAt        string  `json:"generated_at"`
}

// GetState 获取分析状态
func (s *AnalyticsService) GetState() (*AnalyticsState, error) {
	mainDB := database.GetMainDB()
	localDB := database.GetLocalDB()

	s.mu.RLock()
	isProcessing := s.isProcessing
	s.mu.RUnlock()

	state := &AnalyticsState{
		IsProcessing: isProcessing,
	}

	// 获取总日志数
	mainDB.Model(&models.Log{}).Count(&state.TotalLogsCount)

	// 获取已处理状态
	dbState := s.getStateFromDB(localDB)
	state.ProcessedCount = dbState.TotalProcessed
	state.PendingCount = state.TotalLogsCount - state.ProcessedCount

	if state.PendingCount < 0 {
		state.PendingCount = 0
	}

	if !dbState.LastProcessedAt.IsZero() {
		state.LastProcessedAt = dbState.LastProcessedAt.Format("2006-01-02 15:04:05")
	}

	// 估算剩余时间（假设每秒处理 5000 条）
	if state.IsProcessing && state.PendingCount > 0 {
		seconds := state.PendingCount / 5000
		if seconds < 60 {
			state.EstimatedTimeLeft = "不到 1 分钟"
		} else if seconds < 3600 {
			minutes := seconds / 60
			state.EstimatedTimeLeft = fmt.Sprintf("约 %d 分钟", minutes)
		} else {
			state.EstimatedTimeLeft = "超过 1 小时"
		}
		state.ProcessingSpeed = 5000
	}

	return state, nil
}

// getStateFromDB 从数据库获取分析状态
func (s *AnalyticsService) getStateFromDB(db *gorm.DB) *AnalyticsStateDB {
	state := &AnalyticsStateDB{}

	var row struct {
		LastProcessedID int64
		LastProcessedAt *time.Time
		TotalProcessed  int64
	}

	err := db.Table("analytics_state").
		Select("last_processed_id, last_processed_at, total_processed").
		Order("id DESC").
		Limit(1).
		Scan(&row).Error

	if err == nil && row.LastProcessedAt != nil {
		state.LastProcessedID = row.LastProcessedID
		state.LastProcessedAt = *row.LastProcessedAt
		state.TotalProcessed = row.TotalProcessed
	}

	return state
}

// updateStateInDB 更新数据库中的分析状态
func (s *AnalyticsService) updateStateInDB(db *gorm.DB, lastID int64, processed int64) error {
	now := time.Now()

	// 使用 upsert 模式
	return db.Exec(`
		INSERT INTO analytics_state (id, last_processed_id, last_processed_at, total_processed, updated_at)
		VALUES (1, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			last_processed_id = excluded.last_processed_id,
			last_processed_at = excluded.last_processed_at,
			total_processed = excluded.total_processed,
			updated_at = excluded.updated_at
	`, lastID, now, processed, now).Error
}

// ProcessLogs 处理日志（增量处理）
func (s *AnalyticsService) ProcessLogs(batchSize int) (*ProcessResult, error) {
	s.mu.Lock()
	if s.isProcessing {
		s.mu.Unlock()
		return nil, fmt.Errorf("已有处理任务正在执行")
	}
	s.isProcessing = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.isProcessing = false
		s.mu.Unlock()
	}()

	startTime := time.Now()
	mainDB := database.GetMainDB()
	localDB := database.GetLocalDB()

	if batchSize <= 0 {
		batchSize = 1000
	}

	// 获取当前处理状态
	dbState := s.getStateFromDB(localDB)
	lastProcessedID := dbState.LastProcessedID
	totalProcessed := dbState.TotalProcessed

	// 查询新日志
	var logs []models.Log
	err := mainDB.Where("id > ?", lastProcessedID).
		Order("id ASC").
		Limit(batchSize).
		Find(&logs).Error

	if err != nil {
		logger.Error("查询日志失败", zap.Error(err))
		return nil, fmt.Errorf("查询日志失败: %w", err)
	}

	processedCount := int64(len(logs))

	if processedCount > 0 {
		// 更新最后处理的 ID
		newLastID := int64(logs[len(logs)-1].ID)
		totalProcessed += processedCount

		// 更新状态到数据库
		if err := s.updateStateInDB(localDB, newLastID, totalProcessed); err != nil {
			logger.Error("更新处理状态失败", zap.Error(err))
			return nil, fmt.Errorf("更新处理状态失败: %w", err)
		}

		logger.Info("日志处理完成",
			zap.Int64("processed_count", processedCount),
			zap.Int64("last_id", newLastID),
			zap.Int64("total_processed", totalProcessed))
	}

	endTime := time.Now()

	return &ProcessResult{
		ProcessedCount: processedCount,
		Duration:       endTime.Sub(startTime).String(),
		StartTime:      startTime.Format("2006-01-02 15:04:05"),
		EndTime:        endTime.Format("2006-01-02 15:04:05"),
	}, nil
}

// GetUserRequestRanking 获取用户请求排行
func (s *AnalyticsService) GetUserRequestRanking(period string, limit int) ([]UserRequestRanking, error) {
	cacheKey := cache.CacheKey("analytics", "user_request_ranking", period)

	var rankings []UserRequestRanking
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 2 * time.Minute,
	}

	err := wrapper.GetOrSet(&rankings, func() (interface{}, error) {
		return s.fetchUserRequestRanking(period, limit)
	})

	return rankings, err
}

// fetchUserRequestRanking 获取用户请求排行数据
func (s *AnalyticsService) fetchUserRequestRanking(period string, limit int) ([]UserRequestRanking, error) {
	db := database.GetMainDB()

	startTime := s.getStartTime(period)

	var results []struct {
		UserID       int
		Username     string
		RequestCount int64
		LastRequest  int64
	}

	db.Table("logs").
		Select(`
			logs.user_id,
			users.username,
			COUNT(*) as request_count,
			MAX(logs.created_at) as last_request
		`).
		Joins("LEFT JOIN users ON logs.user_id = users.id").
		Where("logs.created_at >= ? AND logs.type = ?", startTime, models.LogTypeConsume).
		Group("logs.user_id, users.username").
		Order("request_count DESC").
		Limit(limit).
		Scan(&results)

	rankings := make([]UserRequestRanking, len(results))
	for i, r := range results {
		rankings[i] = UserRequestRanking{
			Rank:         i + 1,
			UserID:       r.UserID,
			Username:     r.Username,
			RequestCount: r.RequestCount,
			SuccessCount: r.RequestCount, // 假设全部成功
			FailCount:    0,
			SuccessRate:  100.0,
			LastRequest:  time.Unix(r.LastRequest, 0).Format("2006-01-02 15:04:05"),
		}
	}

	return rankings, nil
}

// GetUserQuotaRanking 获取用户额度排行
func (s *AnalyticsService) GetUserQuotaRanking(period string, limit int) ([]UserQuotaRanking, error) {
	cacheKey := cache.CacheKey("analytics", "user_quota_ranking", period)

	var rankings []UserQuotaRanking
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 2 * time.Minute,
	}

	err := wrapper.GetOrSet(&rankings, func() (interface{}, error) {
		return s.fetchUserQuotaRanking(period, limit)
	})

	return rankings, err
}

// fetchUserQuotaRanking 获取用户额度排行数据
func (s *AnalyticsService) fetchUserQuotaRanking(period string, limit int) ([]UserQuotaRanking, error) {
	db := database.GetMainDB()

	startTime := s.getStartTime(period)

	var results []struct {
		UserID     int
		Username   string
		TotalQuota int64
		UsedQuota  int64
		PeriodUsed int64
	}

	db.Table("users").
		Select(`
			users.id as user_id,
			users.username,
			users.quota as total_quota,
			users.used_quota,
			COALESCE((
				SELECT SUM(logs.quota)
				FROM logs
				WHERE logs.user_id = users.id
				AND logs.created_at >= ?
				AND logs.type = ?
			), 0) as period_used
		`, startTime, models.LogTypeConsume).
		Where("users.deleted_at IS NULL").
		Order("period_used DESC").
		Limit(limit).
		Scan(&results)

	rankings := make([]UserQuotaRanking, len(results))
	for i, r := range results {
		usageRate := float64(0)
		if r.TotalQuota > 0 {
			usageRate = float64(r.UsedQuota) / float64(r.TotalQuota) * 100
		}

		rankings[i] = UserQuotaRanking{
			Rank:       i + 1,
			UserID:     r.UserID,
			Username:   r.Username,
			TotalQuota: r.TotalQuota,
			UsedQuota:  r.UsedQuota,
			UsageRate:  usageRate,
			TodayUsed:  r.PeriodUsed,
		}
	}

	return rankings, nil
}

// GetModelStats 获取模型统计
func (s *AnalyticsService) GetModelStats(period string, limit int) ([]ModelStat, error) {
	cacheKey := cache.CacheKey("analytics", "model_stats", period)

	var stats []ModelStat
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 2 * time.Minute,
	}

	err := wrapper.GetOrSet(&stats, func() (interface{}, error) {
		return s.fetchModelStats(period, limit)
	})

	return stats, err
}

// fetchModelStats 获取模型统计数据
func (s *AnalyticsService) fetchModelStats(period string, limit int) ([]ModelStat, error) {
	db := database.GetMainDB()

	startTime := s.getStartTime(period)

	var results []struct {
		ModelName    string
		RequestCount int64
		TotalQuota   int64
		AvgQuota     float64
		UserCount    int64
		LastUsed     int64
	}

	db.Table("logs").
		Select(`
			model_name,
			COUNT(*) as request_count,
			COALESCE(SUM(quota), 0) as total_quota,
			COALESCE(AVG(quota), 0) as avg_quota,
			COUNT(DISTINCT user_id) as user_count,
			MAX(created_at) as last_used
		`).
		Where("created_at >= ? AND type = ?", startTime, models.LogTypeConsume).
		Group("model_name").
		Order("request_count DESC").
		Limit(limit).
		Scan(&results)

	stats := make([]ModelStat, len(results))
	for i, r := range results {
		stats[i] = ModelStat{
			ModelName:    r.ModelName,
			RequestCount: r.RequestCount,
			TotalQuota:   r.TotalQuota,
			AvgQuota:     r.AvgQuota,
			SuccessRate:  100.0, // 假设全部成功
			UserCount:    r.UserCount,
			LastUsed:     time.Unix(r.LastUsed, 0).Format("2006-01-02 15:04:05"),
		}
	}

	return stats, nil
}

// GetSummary 获取分析摘要
func (s *AnalyticsService) GetSummary(period string) (*AnalyticsSummary, error) {
	cacheKey := cache.CacheKey("analytics", "summary", period)

	var summary AnalyticsSummary
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 2 * time.Minute,
	}

	err := wrapper.GetOrSet(&summary, func() (interface{}, error) {
		return s.fetchSummary(period)
	})

	return &summary, err
}

// fetchSummary 获取分析摘要数据
func (s *AnalyticsService) fetchSummary(period string) (*AnalyticsSummary, error) {
	db := database.GetMainDB()

	startTime := s.getStartTime(period)
	summary := &AnalyticsSummary{
		Period:      period,
		GeneratedAt: time.Now().Format("2006-01-02 15:04:05"),
	}

	// 总请求数
	db.Model(&models.Log{}).
		Where("created_at >= ? AND type = ?", startTime, models.LogTypeConsume).
		Count(&summary.TotalRequests)

	// 总额度消耗
	db.Model(&models.Log{}).
		Where("created_at >= ? AND type = ?", startTime, models.LogTypeConsume).
		Select("COALESCE(SUM(quota), 0)").
		Scan(&summary.TotalQuotaUsed)

	// 唯一用户数
	db.Model(&models.Log{}).
		Where("created_at >= ? AND type = ?", startTime, models.LogTypeConsume).
		Distinct("user_id").
		Count(&summary.UniqueUsers)

	// 唯一模型数
	db.Model(&models.Log{}).
		Where("created_at >= ? AND type = ?", startTime, models.LogTypeConsume).
		Distinct("model_name").
		Count(&summary.UniqueModels)

	// 平均值计算
	if summary.UniqueUsers > 0 {
		summary.AvgRequestsPerUser = float64(summary.TotalRequests) / float64(summary.UniqueUsers)
	}
	if summary.TotalRequests > 0 {
		summary.AvgQuotaPerRequest = float64(summary.TotalQuotaUsed) / float64(summary.TotalRequests)
	}

	// 高峰时段
	// 注意：created_at 是 bigint (Unix 时间戳)
	var peakResult struct {
		Hour     int
		Requests int64
	}
	var hourFormat string
	if database.GetMainDB().Dialector.Name() == "postgres" {
		hourFormat = "EXTRACT(HOUR FROM TO_TIMESTAMP(created_at))"
	} else {
		hourFormat = "HOUR(FROM_UNIXTIME(created_at))"
	}
	db.Table("logs").
		Select(hourFormat+" as hour, COUNT(*) as requests").
		Where("created_at >= ? AND type = ?", startTime, models.LogTypeConsume).
		Group(hourFormat).
		Order("requests DESC").
		Limit(1).
		Scan(&peakResult)

	summary.PeakHour = peakResult.Hour
	summary.PeakHourRequests = peakResult.Requests

	// 最热门模型
	var topModel struct {
		ModelName string
		Requests  int64
	}
	db.Table("logs").
		Select("model_name, COUNT(*) as requests").
		Where("created_at >= ? AND type = ?", startTime, models.LogTypeConsume).
		Group("model_name").
		Order("requests DESC").
		Limit(1).
		Scan(&topModel)

	summary.TopModel = topModel.ModelName
	summary.TopModelRequests = topModel.Requests

	return summary, nil
}

// Reset 重置分析数据
func (s *AnalyticsService) Reset() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 清除所有分析相关缓存
	_, _ = cache.DeleteByPattern("analytics:*")

	return nil
}

// getStartTime 根据周期获取开始时间（Unix 时间戳）
func (s *AnalyticsService) getStartTime(period string) int64 {
	now := time.Now()
	switch period {
	case "hour":
		return now.Add(-1 * time.Hour).Unix()
	case "today":
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	case "week":
		return now.AddDate(0, 0, -7).Unix()
	case "month":
		return now.AddDate(0, -1, 0).Unix()
	case "year":
		return now.AddDate(-1, 0, 0).Unix()
	default:
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	}
}

// BatchProcessLogs 批量处理日志
func (s *AnalyticsService) BatchProcessLogs(batchSize int) (map[string]interface{}, error) {
	result, err := s.ProcessLogs(batchSize)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"processed":  result.ProcessedCount,
		"batch_size": batchSize,
		"message":    "批量处理完成",
	}, nil
}

// SyncStatus 同步状态
type SyncStatus struct {
	IsInitialized    bool   `json:"is_initialized"`
	LastSyncTime     string `json:"last_sync_time"`
	TotalProcessed   int64  `json:"total_processed"`
	PendingCount     int64  `json:"pending_count"`
	NeedsInitialSync bool   `json:"needs_initial_sync"`
	IsInitializing   bool   `json:"is_initializing"`
}

// GetSyncStatus 获取同步状态
func (s *AnalyticsService) GetSyncStatus() (*SyncStatus, error) {
	state, err := s.GetState()
	if err != nil {
		return nil, err
	}
	isInitialized := state.ProcessedCount > 0
	return &SyncStatus{
		IsInitialized:    isInitialized,
		LastSyncTime:     state.LastProcessedAt,
		TotalProcessed:   state.ProcessedCount,
		PendingCount:     state.PendingCount,
		NeedsInitialSync: !isInitialized,
		IsInitializing:   state.IsProcessing,
	}, nil
}

// ConsistencyResult 一致性检查结果
type ConsistencyResult struct {
	IsConsistent    bool   `json:"is_consistent"`
	Message         string `json:"message"`
	CheckedAt       string `json:"checked_at"`
	MainDBLogCount  int64  `json:"main_db_log_count"`
	ProcessedCount  int64  `json:"processed_count"`
	LastProcessedID int64  `json:"last_processed_id"`
	MaxLogID        int64  `json:"max_log_id"`
	NeedsReset      bool   `json:"needs_reset"`
}

// CheckConsistency 检查数据一致性
func (s *AnalyticsService) CheckConsistency() (*ConsistencyResult, error) {
	mainDB := database.GetMainDB()
	localDB := database.GetLocalDB()

	result := &ConsistencyResult{
		CheckedAt: time.Now().Format("2006-01-02 15:04:05"),
	}

	// 获取主数据库日志总数
	mainDB.Model(&models.Log{}).Count(&result.MainDBLogCount)

	// 获取主数据库最大日志 ID
	var maxLog models.Log
	mainDB.Order("id DESC").Limit(1).Find(&maxLog)
	result.MaxLogID = int64(maxLog.ID)

	// 获取本地处理状态
	dbState := s.getStateFromDB(localDB)
	result.ProcessedCount = dbState.TotalProcessed
	result.LastProcessedID = dbState.LastProcessedID

	// 一致性检查逻辑
	// 1. 如果 last_processed_id > max_log_id，说明日志被删除，需要重置
	if result.LastProcessedID > result.MaxLogID && result.MaxLogID > 0 {
		result.IsConsistent = false
		result.NeedsReset = true
		result.Message = "检测到日志删除：已处理 ID 大于当前最大日志 ID，建议重置分析状态"
		return result, nil
	}

	// 2. 如果 processed_count > main_db_log_count，说明有日志被删除
	if result.ProcessedCount > result.MainDBLogCount {
		result.IsConsistent = false
		result.NeedsReset = true
		result.Message = "检测到日志删除：已处理数量大于当前日志总数，建议重置分析状态"
		return result, nil
	}

	// 3. 检查是否有未处理的日志
	pendingCount := result.MainDBLogCount - result.ProcessedCount
	if pendingCount > 0 {
		result.IsConsistent = true
		result.Message = fmt.Sprintf("数据一致，有 %d 条待处理日志", pendingCount)
	} else {
		result.IsConsistent = true
		result.Message = "数据一致，所有日志已处理完成"
	}

	return result, nil
}

// ResetState 重置分析状态
func (s *AnalyticsService) ResetState() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	localDB := database.GetLocalDB()

	// 删除分析状态记录
	if err := localDB.Exec("DELETE FROM analytics_state").Error; err != nil {
		return fmt.Errorf("重置分析状态失败: %w", err)
	}

	// 清除分析相关缓存
	_, _ = cache.DeleteByPattern("analytics:*")

	logger.Info("分析状态已重置")
	return nil
}

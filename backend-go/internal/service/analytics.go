package service

import (
	"fmt"
	"math"
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

	// 轻量内存缓存：用于避免频繁 COUNT(*)/MAX(id) 压主库
	totalLogsCache struct {
		count int64
		at    time.Time
	}
	maxLogIDCache struct {
		id int64
		at time.Time
	}
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

// ModelStatistics 模型统计（前端期望的格式）
type ModelStatistics struct {
	ModelName     string  `json:"model_name"`
	TotalRequests int64   `json:"total_requests"`
	SuccessCount  int64   `json:"success_count"`
	FailureCount  int64   `json:"failure_count"`
	EmptyCount    int64   `json:"empty_count"`
	SuccessRate   float64 `json:"success_rate"`
	EmptyRate     float64 `json:"empty_rate"`
}

// UserRanking 用户排行（前端期望的格式）
type UserRanking struct {
	UserID       int    `json:"user_id"`
	Username     string `json:"username"`
	RequestCount int64  `json:"request_count"`
	QuotaUsed    int64  `json:"quota_used"`
}

// AnalyticsSummaryResponse 分析摘要响应（前端期望的完整格式）
type AnalyticsSummaryResponse struct {
	State              *AnalyticsStateForSummary `json:"state"`
	UserRequestRanking []UserRanking             `json:"user_request_ranking"`
	UserQuotaRanking   []UserRanking             `json:"user_quota_ranking"`
	ModelStatistics    []ModelStatistics         `json:"model_statistics"`
}

// AnalyticsStateForSummary 分析状态（用于 summary 响应）
type AnalyticsStateForSummary struct {
	LastLogID       int64 `json:"last_log_id"`
	LastProcessedAt int64 `json:"last_processed_at"`
	TotalProcessed  int64 `json:"total_processed"`
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

	// 使用 upsert 模式，避免表无限增长
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
	err := mainDB.Where("id > ? AND type IN (?)", lastProcessedID, []int{models.LogTypeConsume, models.LogTypeFailure}).
		Order("id ASC").
		Limit(batchSize).
		Find(&logs).Error

	if err != nil {
		logger.Error("查询日志失败", zap.Error(err))
		return nil, fmt.Errorf("查询日志失败: %w", err)
	}

	processedCount := int64(len(logs))

	newLastID := lastProcessedID
	if processedCount > 0 {
		newLastID = int64(logs[len(logs)-1].ID)
		totalProcessed += processedCount
	}

	// 即使没有新日志也更新 last_processed_at，便于前端显示“最近检查时间”
	if err := s.updateStateInDB(localDB, newLastID, totalProcessed); err != nil {
		logger.Error("更新处理状态失败", zap.Error(err))
		return nil, fmt.Errorf("更新处理状态失败: %w", err)
	}

	if processedCount > 0 {
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

// GetFullSummary 获取完整的分析摘要（前端期望的格式）
func (s *AnalyticsService) GetFullSummary() (*AnalyticsSummaryResponse, error) {
	localDB := database.GetLocalDB()
	mainDB := database.GetMainDB()

	// 获取分析状态
	dbState := s.getStateFromDB(localDB)
	state := &AnalyticsStateForSummary{
		LastLogID:      dbState.LastProcessedID,
		TotalProcessed: dbState.TotalProcessed,
	}
	if !dbState.LastProcessedAt.IsZero() {
		state.LastProcessedAt = dbState.LastProcessedAt.Unix()
	}

	// 获取用户请求排行
	userRequestRanking, err := s.fetchUserRankingForSummary(mainDB, "request", 10)
	if err != nil {
		return nil, err
	}

	// 获取用户额度排行
	userQuotaRanking, err := s.fetchUserRankingForSummary(mainDB, "quota", 10)
	if err != nil {
		return nil, err
	}

	// 获取模型统计
	modelStatistics, err := s.fetchModelStatisticsForSummary(mainDB, 20)
	if err != nil {
		return nil, err
	}

	return &AnalyticsSummaryResponse{
		State:              state,
		UserRequestRanking: userRequestRanking,
		UserQuotaRanking:   userQuotaRanking,
		ModelStatistics:    modelStatistics,
	}, nil
}

// fetchUserRankingForSummary 获取用户排行数据（用于 summary）
func (s *AnalyticsService) fetchUserRankingForSummary(db *gorm.DB, rankType string, limit int) ([]UserRanking, error) {
	var results []struct {
		UserID       int
		Username     string
		RequestCount int64
		QuotaUsed    int64
	}

	orderBy := "request_count DESC"
	if rankType == "quota" {
		orderBy = "quota_used DESC"
	}

	err := db.Table("logs").
		Select(`
			logs.user_id,
			users.username,
			COUNT(*) as request_count,
			COALESCE(SUM(logs.quota), 0) as quota_used
		`).
		Joins("LEFT JOIN users ON logs.user_id = users.id").
		Where("logs.type = ?", models.LogTypeConsume).
		Group("logs.user_id, users.username").
		Order(orderBy).
		Limit(limit).
		Scan(&results).Error

	if err != nil {
		logger.Error("获取用户排行失败", zap.Error(err))
		return nil, err
	}

	rankings := make([]UserRanking, len(results))
	for i, r := range results {
		rankings[i] = UserRanking{
			UserID:       r.UserID,
			Username:     r.Username,
			RequestCount: r.RequestCount,
			QuotaUsed:    r.QuotaUsed,
		}
	}

	return rankings, nil
}

// fetchModelStatisticsForSummary 获取模型统计数据（用于 summary）
func (s *AnalyticsService) fetchModelStatisticsForSummary(db *gorm.DB, limit int) ([]ModelStatistics, error) {
	// 查询模型统计：成功数、失败数、空回复数
	var results []struct {
		ModelName     string
		TotalRequests int64
		SuccessCount  int64
		FailureCount  int64
	}

	// 统计每个模型的请求数、成功数、失败数
	err := db.Table("logs").
		Select(`
			model_name,
			COUNT(*) as total_requests,
			SUM(CASE WHEN type = ? THEN 1 ELSE 0 END) as success_count,
			SUM(CASE WHEN type = ? THEN 1 ELSE 0 END) as failure_count
		`, models.LogTypeConsume, models.LogTypeFailure).
		Where("type IN (?, ?)", models.LogTypeConsume, models.LogTypeFailure).
		Group("model_name").
		Order("total_requests DESC").
		Limit(limit).
		Scan(&results).Error

	if err != nil {
		logger.Error("获取模型统计失败", zap.Error(err))
		return nil, err
	}

	stats := make([]ModelStatistics, len(results))
	for i, r := range results {
		successRate := float64(0)
		if r.TotalRequests > 0 {
			successRate = float64(r.SuccessCount) / float64(r.TotalRequests) * 100
		}

		// 空回复数暂时设为 0，因为需要额外查询 content 字段
		emptyCount := int64(0)
		emptyRate := float64(0)

		stats[i] = ModelStatistics{
			ModelName:     r.ModelName,
			TotalRequests: r.TotalRequests,
			SuccessCount:  r.SuccessCount,
			FailureCount:  r.FailureCount,
			EmptyCount:    emptyCount,
			SuccessRate:   successRate,
			EmptyRate:     emptyRate,
		}
	}

	return stats, nil
}

// ==================== Legacy Analytics Methods ====================

const (
	legacyMaxLogIDCacheTTL              = 60 * time.Second
	legacyTotalLogsCacheTTL             = 5 * time.Minute
	legacyInitCutoffMetaKey             = "init_cutoff_id"
	legacyDefaultUserLimit              = 10
	legacyDefaultModelLimit             = 20
	legacyDefaultMaxIter                = 100
	legacyDataInconsistentSkewTolerance = int64(100)
)

// LegacyAnalyticsState Legacy 分析状态
type LegacyAnalyticsState struct {
	LastLogID       int64 `json:"last_log_id"`
	LastProcessedAt int64 `json:"last_processed_at"`
	TotalProcessed  int64 `json:"total_processed"`
}

// LegacyUserRankingItem Legacy 用户排行项
type LegacyUserRankingItem struct {
	UserID       int    `json:"user_id"`
	Username     string `json:"username"`
	RequestCount int64  `json:"request_count"`
	QuotaUsed    int64  `json:"quota_used"`
}

// LegacyModelStatsItem Legacy 模型统计项
type LegacyModelStatsItem struct {
	ModelName     string  `json:"model_name"`
	TotalRequests int64   `json:"total_requests"`
	SuccessCount  int64   `json:"success_count"`
	FailureCount  int64   `json:"failure_count"`
	EmptyCount    int64   `json:"empty_count"`
	SuccessRate   float64 `json:"success_rate"`
	EmptyRate     float64 `json:"empty_rate"`
}

// LegacyAnalyticsSummary Legacy 分析摘要
type LegacyAnalyticsSummary struct {
	State           LegacyAnalyticsState    `json:"state"`
	UserRequestRank []LegacyUserRankingItem `json:"user_request_ranking"`
	UserQuotaRank   []LegacyUserRankingItem `json:"user_quota_ranking"`
	ModelStatistics []LegacyModelStatsItem  `json:"model_statistics"`
}

// LegacySyncStatus Legacy 同步状态
type LegacySyncStatus struct {
	LastLogID        int64   `json:"last_log_id"`
	MaxLogID         int64   `json:"max_log_id"`
	InitCutoffID     *int64  `json:"init_cutoff_id"`
	TotalLogsInDB    int64   `json:"total_logs_in_db"`
	TotalProcessed   int64   `json:"total_processed"`
	ProgressPercent  float64 `json:"progress_percent"`
	RemainingLogs    int64   `json:"remaining_logs"`
	IsSynced         bool    `json:"is_synced"`
	IsInitializing   bool    `json:"is_initializing"`
	NeedsInitialSync bool    `json:"needs_initial_sync"`
	DataInconsistent bool    `json:"data_inconsistent"`
	NeedsReset       bool    `json:"needs_reset"`
}

// LegacyBatchProcessResult Legacy 批量处理结果
type LegacyBatchProcessResult struct {
	Success         bool    `json:"success"`
	TotalProcessed  int64   `json:"total_processed"`
	Iterations      int     `json:"iterations"`
	BatchSize       int     `json:"batch_size"`
	ElapsedSeconds  float64 `json:"elapsed_seconds"`
	LogsPerSecond   float64 `json:"logs_per_second"`
	ProgressPercent float64 `json:"progress_percent"`
	RemainingLogs   int64   `json:"remaining_logs"`
	LastLogID       int64   `json:"last_log_id"`
	InitCutoffID    *int64  `json:"init_cutoff_id"`
	Completed       bool    `json:"completed"`
}

// LegacyAutoResetResult Legacy 自动重置结果
type LegacyAutoResetResult struct {
	Reset           bool   `json:"reset"`
	Reason          string `json:"reason,omitempty"`
	OldLastLogID    int64  `json:"old_last_log_id,omitempty"`
	CurrentMaxLogID int64  `json:"current_max_log_id,omitempty"`
}

func (s *AnalyticsService) getMetaInt(key string) (int64, error) {
	db := database.GetLocalDB()

	var row struct {
		Value int64
	}
	err := db.Raw(`SELECT value FROM analytics_meta WHERE key = ? LIMIT 1`, key).Scan(&row).Error
	if err != nil {
		return 0, err
	}
	return row.Value, nil
}

func (s *AnalyticsService) setMetaInt(key string, value int64) error {
	db := database.GetLocalDB()
	now := time.Now()
	return db.Exec(`
		INSERT INTO analytics_meta (key, value, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = excluded.updated_at
	`, key, value, now).Error
}

func (s *AnalyticsService) deleteMetaKey(key string) error {
	db := database.GetLocalDB()
	return db.Exec(`DELETE FROM analytics_meta WHERE key = ?`, key).Error
}

func (s *AnalyticsService) clearLegacyCaches() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.totalLogsCache = struct {
		count int64
		at    time.Time
	}{}
	s.maxLogIDCache = struct {
		id int64
		at time.Time
	}{}
}

func (s *AnalyticsService) getMaxLogID(forceRefresh bool) (int64, error) {
	s.mu.RLock()
	cached := s.maxLogIDCache
	s.mu.RUnlock()

	if !forceRefresh && cached.id > 0 && time.Since(cached.at) < legacyMaxLogIDCacheTTL {
		return cached.id, nil
	}

	db := database.GetMainDB()
	var maxID int64
	if err := db.Table("logs").Select("COALESCE(MAX(id), 0)").Scan(&maxID).Error; err != nil {
		return 0, err
	}

	s.mu.Lock()
	s.maxLogIDCache.id = maxID
	s.maxLogIDCache.at = time.Now()
	s.mu.Unlock()

	return maxID, nil
}

func (s *AnalyticsService) getTotalLogsCount(forceRefresh bool) (int64, error) {
	s.mu.RLock()
	cached := s.totalLogsCache
	s.mu.RUnlock()

	if !forceRefresh && cached.at.After(time.Time{}) && time.Since(cached.at) < legacyTotalLogsCacheTTL {
		return cached.count, nil
	}

	db := database.GetMainDB()
	var count int64
	if err := db.Model(&models.Log{}).
		Where("type IN (?)", []int{models.LogTypeConsume, models.LogTypeFailure}).
		Count(&count).Error; err != nil {
		return 0, err
	}

	s.mu.Lock()
	s.totalLogsCache.count = count
	s.totalLogsCache.at = time.Now()
	s.mu.Unlock()

	return count, nil
}

func getDynamicBatchConfig(totalLogs int64) (batchSize int, maxIter int) {
	switch {
	case totalLogs < 10_000:
		return 1000, 20
	case totalLogs < 100_000:
		return 2000, 50
	case totalLogs < 1_000_000:
		return 5000, 100
	case totalLogs < 10_000_000:
		return 10_000, 150
	default:
		return 20_000, 200
	}
}

// GetLegacyState 获取 Legacy 分析状态
func (s *AnalyticsService) GetLegacyState() (LegacyAnalyticsState, error) {
	localDB := database.GetLocalDB()
	dbState := s.getStateFromDB(localDB)
	var lastProcessedAt int64
	if !dbState.LastProcessedAt.IsZero() {
		lastProcessedAt = dbState.LastProcessedAt.Unix()
	}
	return LegacyAnalyticsState{
		LastLogID:       dbState.LastProcessedID,
		LastProcessedAt: lastProcessedAt,
		TotalProcessed:  dbState.TotalProcessed,
	}, nil
}

func (s *AnalyticsService) fetchLegacyUserRanking(limit int, orderBy string) ([]LegacyUserRankingItem, error) {
	if limit <= 0 {
		limit = legacyDefaultUserLimit
	}

	db := database.GetMainDB()
	var rows []struct {
		UserID       int
		Username     string
		RequestCount int64
		QuotaUsed    int64
	}

	err := db.Table("logs").
		Select(`
			logs.user_id,
			COALESCE(users.username, logs.username, '') as username,
			COUNT(*) as request_count,
			COALESCE(SUM(logs.quota), 0) as quota_used
		`).
		Joins("LEFT JOIN users ON logs.user_id = users.id").
		Where("logs.user_id > 0 AND logs.type IN (?)", []int{models.LogTypeConsume, models.LogTypeFailure}).
		Group("logs.user_id, users.username, logs.username").
		Order(orderBy).
		Limit(limit).
		Scan(&rows).Error

	if err != nil {
		return nil, err
	}

	items := make([]LegacyUserRankingItem, 0, len(rows))
	for _, r := range rows {
		username := r.Username
		if username == "" {
			username = fmt.Sprintf("User#%d", r.UserID)
		}
		items = append(items, LegacyUserRankingItem{
			UserID:       r.UserID,
			Username:     username,
			RequestCount: r.RequestCount,
			QuotaUsed:    r.QuotaUsed,
		})
	}
	return items, nil
}

func (s *AnalyticsService) fetchLegacyModelStats(limit int) ([]LegacyModelStatsItem, error) {
	if limit <= 0 {
		limit = legacyDefaultModelLimit
	}

	db := database.GetMainDB()
	var rows []struct {
		ModelName     string
		TotalRequests int64
		SuccessCount  int64
		FailureCount  int64
		EmptyCount    int64
	}

	err := db.Table("logs").
		Select(`
			model_name as model_name,
			COUNT(*) as total_requests,
			SUM(CASE WHEN type = ? THEN 1 ELSE 0 END) as success_count,
			SUM(CASE WHEN type = ? THEN 1 ELSE 0 END) as failure_count,
			SUM(CASE WHEN type = ? AND completion_tokens = 0 THEN 1 ELSE 0 END) as empty_count
		`, models.LogTypeConsume, models.LogTypeFailure, models.LogTypeConsume).
		Where("type IN (?)", []int{models.LogTypeConsume, models.LogTypeFailure}).
		Group("model_name").
		Order("total_requests DESC").
		Limit(limit).
		Scan(&rows).Error

	if err != nil {
		return nil, err
	}

	items := make([]LegacyModelStatsItem, 0, len(rows))
	for _, r := range rows {
		modelName := r.ModelName
		if modelName == "" {
			modelName = "unknown"
		}
		var successRate float64
		if r.TotalRequests > 0 {
			successRate = float64(r.SuccessCount) / float64(r.TotalRequests) * 100
		}
		var emptyRate float64
		if r.SuccessCount > 0 {
			emptyRate = float64(r.EmptyCount) / float64(r.SuccessCount) * 100
		}

		items = append(items, LegacyModelStatsItem{
			ModelName:     modelName,
			TotalRequests: r.TotalRequests,
			SuccessCount:  r.SuccessCount,
			FailureCount:  r.FailureCount,
			EmptyCount:    r.EmptyCount,
			SuccessRate:   math.Round(successRate*100) / 100,
			EmptyRate:     math.Round(emptyRate*100) / 100,
		})
	}

	return items, nil
}

// GetLegacySummary 获取 Legacy 分析摘要
func (s *AnalyticsService) GetLegacySummary() (*LegacyAnalyticsSummary, error) {
	state, err := s.GetLegacyState()
	if err != nil {
		return nil, err
	}

	userRequestRanking, err := s.fetchLegacyUserRanking(legacyDefaultUserLimit, "request_count DESC")
	if err != nil {
		return nil, err
	}
	userQuotaRanking, err := s.fetchLegacyUserRanking(legacyDefaultUserLimit, "quota_used DESC")
	if err != nil {
		return nil, err
	}
	modelStats, err := s.fetchLegacyModelStats(legacyDefaultModelLimit)
	if err != nil {
		return nil, err
	}

	return &LegacyAnalyticsSummary{
		State:           state,
		UserRequestRank: userRequestRanking,
		UserQuotaRank:   userQuotaRanking,
		ModelStatistics: modelStats,
	}, nil
}

// GetLegacySyncStatus 获取 Legacy 同步状态
func (s *AnalyticsService) GetLegacySyncStatus() (*LegacySyncStatus, error) {
	state, err := s.GetLegacyState()
	if err != nil {
		return nil, err
	}

	maxLogID, err := s.getMaxLogID(false)
	if err != nil {
		return nil, err
	}
	totalLogs, err := s.getTotalLogsCount(false)
	if err != nil {
		return nil, err
	}

	initCutoff, err := s.getMetaInt(legacyInitCutoffMetaKey)
	if err != nil {
		// meta 不存在时视为未初始化
		initCutoff = 0
	}
	isInitializing := initCutoff > 0

	dataInconsistent := maxLogID > 0 && state.LastLogID > (maxLogID+legacyDataInconsistentSkewTolerance)

	var progress float64
	var remaining int64
	if totalLogs > 0 && !dataInconsistent {
		if state.TotalProcessed >= totalLogs {
			progress = 100
		} else {
			progress = (float64(state.TotalProcessed) / float64(totalLogs)) * 100
		}
		remaining = totalLogs - state.TotalProcessed
		if remaining < 0 {
			remaining = 0
		}
	}

	progress = math.Round(progress*100) / 100

	isSynced := progress >= 95.0 && !isInitializing && !dataInconsistent
	needsInitialSync := totalLogs > 0 && !isSynced && !isInitializing

	var initCutoffPtr *int64
	if isInitializing {
		initCutoffCopy := initCutoff
		initCutoffPtr = &initCutoffCopy
	}

	return &LegacySyncStatus{
		LastLogID:        state.LastLogID,
		MaxLogID:         maxLogID,
		InitCutoffID:     initCutoffPtr,
		TotalLogsInDB:    totalLogs,
		TotalProcessed:   state.TotalProcessed,
		ProgressPercent:  progress,
		RemainingLogs:    remaining,
		IsSynced:         isSynced,
		IsInitializing:   isInitializing,
		NeedsInitialSync: needsInitialSync,
		DataInconsistent: dataInconsistent,
		NeedsReset:       dataInconsistent,
	}, nil
}

func (s *AnalyticsService) processLogsWithCutoff(batchSize int, maxID *int64) (processed int64, lastLogID int64, err error) {
	if batchSize <= 0 {
		batchSize = 1000
	}

	mainDB := database.GetMainDB()
	localDB := database.GetLocalDB()

	dbState := s.getStateFromDB(localDB)
	lastProcessedID := dbState.LastProcessedID
	totalProcessed := dbState.TotalProcessed

	query := mainDB.Where("id > ? AND type IN (?)", lastProcessedID, []int{models.LogTypeConsume, models.LogTypeFailure})
	if maxID != nil && *maxID > 0 {
		query = query.Where("id <= ?", *maxID)
	}

	var logs []models.Log
	if err := query.Order("id ASC").Limit(batchSize).Find(&logs).Error; err != nil {
		return 0, 0, err
	}

	processedCount := int64(len(logs))
	newLastID := lastProcessedID
	if processedCount > 0 {
		newLastID = int64(logs[len(logs)-1].ID)
		totalProcessed += processedCount
	}

	if err := s.updateStateInDB(localDB, newLastID, totalProcessed); err != nil {
		return 0, 0, err
	}

	return processedCount, newLastID, nil
}

// ProcessLegacy Legacy 处理日志
func (s *AnalyticsService) ProcessLegacy() (processed int64, lastLogID int64, err error) {
	s.mu.Lock()
	if s.isProcessing {
		s.mu.Unlock()
		return 0, 0, fmt.Errorf("已有处理任务正在执行")
	}
	s.isProcessing = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.isProcessing = false
		s.mu.Unlock()
	}()

	totalLogs, err := s.getTotalLogsCount(false)
	if err != nil {
		return 0, 0, err
	}
	batchSize, _ := getDynamicBatchConfig(totalLogs)

	return s.processLogsWithCutoff(batchSize, nil)
}

// BatchProcessLegacy Legacy 批量处理日志
func (s *AnalyticsService) BatchProcessLegacy(maxIterations int) (*LegacyBatchProcessResult, error) {
	if maxIterations <= 0 {
		maxIterations = legacyDefaultMaxIter
	}

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

	start := time.Now()

	initCutoff, err := s.getMetaInt(legacyInitCutoffMetaKey)
	if err != nil {
		initCutoff = 0
	}
	if initCutoff == 0 {
		maxID, err := s.getMaxLogID(true)
		if err != nil {
			return nil, err
		}
		initCutoff = maxID
		if err := s.setMetaInt(legacyInitCutoffMetaKey, initCutoff); err != nil {
			return nil, err
		}
	}

	totalLogs, err := s.getTotalLogsCount(false)
	if err != nil {
		return nil, err
	}
	batchSize, dynamicMaxIter := getDynamicBatchConfig(totalLogs)
	if maxIterations > dynamicMaxIter {
		maxIterations = dynamicMaxIter
	}

	var processedThisCall int64
	iterations := 0

	for iterations < maxIterations {
		processed, _, err := s.processLogsWithCutoff(batchSize, &initCutoff)
		if err != nil {
			return nil, err
		}
		if processed == 0 {
			_ = s.deleteMetaKey(legacyInitCutoffMetaKey)
			break
		}
		processedThisCall += processed
		iterations++
	}

	elapsed := time.Since(start).Seconds()
	var lps float64
	if elapsed > 0 {
		lps = float64(processedThisCall) / elapsed
	}

	state, err := s.GetLegacyState()
	if err != nil {
		return nil, err
	}

	currentCutoff, err := s.getMetaInt(legacyInitCutoffMetaKey)
	if err != nil {
		currentCutoff = 0
	}

	var progress float64
	var remaining int64
	completed := false

	if currentCutoff == 0 && initCutoff > 0 {
		progress = 100
		remaining = 0
		completed = true
	} else if initCutoff > 0 {
		if state.LastLogID >= initCutoff {
			progress = 100
			completed = true
		} else if initCutoff > 0 {
			progress = (float64(state.LastLogID) / float64(initCutoff)) * 100
		}
		remaining = initCutoff - state.LastLogID
		if remaining < 0 {
			remaining = 0
		}
	}

	progress = math.Round(progress*100) / 100

	var cutoffPtr *int64
	if currentCutoff > 0 {
		cutoffCopy := currentCutoff
		cutoffPtr = &cutoffCopy
	}

	return &LegacyBatchProcessResult{
		Success:         true,
		TotalProcessed:  processedThisCall,
		Iterations:      iterations,
		BatchSize:       batchSize,
		ElapsedSeconds:  math.Round(elapsed*100) / 100,
		LogsPerSecond:   math.Round(lps*10) / 10,
		ProgressPercent: progress,
		RemainingLogs:   remaining,
		LastLogID:       state.LastLogID,
		InitCutoffID:    cutoffPtr,
		Completed:       completed,
	}, nil
}

// ResetLegacy Legacy 重置分析数据
func (s *AnalyticsService) ResetLegacy() error {
	localDB := database.GetLocalDB()
	if err := localDB.Exec("DELETE FROM analytics_state").Error; err != nil {
		return err
	}
	_ = localDB.Exec("DELETE FROM analytics_meta").Error
	s.clearLegacyCaches()
	return nil
}

// CheckAndAutoResetLegacy Legacy 检查并自动重置
func (s *AnalyticsService) CheckAndAutoResetLegacy(autoReset bool) (*LegacyAutoResetResult, error) {
	state, err := s.GetLegacyState()
	if err != nil {
		return nil, err
	}

	maxLogID, err := s.getMaxLogID(true)
	if err != nil {
		return nil, err
	}

	inconsistent := state.LastLogID > 0 && maxLogID > 0 && state.LastLogID > maxLogID
	if !autoReset || !inconsistent {
		return &LegacyAutoResetResult{Reset: false}, nil
	}

	if err := s.ResetLegacy(); err != nil {
		return nil, err
	}
	return &LegacyAutoResetResult{
		Reset:           true,
		Reason:          "Logs deleted or database reset detected",
		OldLastLogID:    state.LastLogID,
		CurrentMaxLogID: maxLogID,
	}, nil
}

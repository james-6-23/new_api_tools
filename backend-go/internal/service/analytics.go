package service

import (
	"sync"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/models"
)

// AnalyticsService 日志分析服务
type AnalyticsService struct {
	mu sync.RWMutex
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
	db := database.GetMainDB()

	state := &AnalyticsState{
		IsProcessing: false,
	}

	// 获取总日志数
	db.Model(&models.Log{}).Count(&state.TotalLogsCount)

	// 已处理数（这里假设所有日志都已处理）
	state.ProcessedCount = state.TotalLogsCount
	state.PendingCount = 0
	state.LastProcessedAt = time.Now().Format("2006-01-02 15:04:05")

	return state, nil
}

// ProcessLogs 处理日志
func (s *AnalyticsService) ProcessLogs(batchSize int) (*ProcessResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	startTime := time.Now()

	// 模拟日志处理
	if batchSize <= 0 {
		batchSize = 1000
	}

	// 实际处理逻辑可以在这里实现
	// 例如：聚合统计、生成报表等

	endTime := time.Now()

	return &ProcessResult{
		ProcessedCount: int64(batchSize),
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
		LastRequest  time.Time
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
			LastRequest:  r.LastRequest.Format("2006-01-02 15:04:05"),
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
		LastUsed     time.Time
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
			LastUsed:     r.LastUsed.Format("2006-01-02 15:04:05"),
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
	var peakResult struct {
		Hour     int
		Requests int64
	}
	db.Table("logs").
		Select("HOUR(created_at) as hour, COUNT(*) as requests").
		Where("created_at >= ? AND type = ?", startTime, models.LogTypeConsume).
		Group("HOUR(created_at)").
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
	cache.DeleteByPattern("analytics:*")

	return nil
}

// getStartTime 根据周期获取开始时间
func (s *AnalyticsService) getStartTime(period string) string {
	now := time.Now()
	switch period {
	case "hour":
		return now.Add(-1 * time.Hour).Format("2006-01-02 15:04:05")
	case "today":
		return now.Format("2006-01-02") + " 00:00:00"
	case "week":
		return now.AddDate(0, 0, -7).Format("2006-01-02 15:04:05")
	case "month":
		return now.AddDate(0, -1, 0).Format("2006-01-02 15:04:05")
	case "year":
		return now.AddDate(-1, 0, 0).Format("2006-01-02 15:04:05")
	default:
		return now.Format("2006-01-02") + " 00:00:00"
	}
}

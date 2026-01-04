package service

import (
	"fmt"
	"runtime"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/models"
)

// DashboardService Dashboard 服务
type DashboardService struct{}

// NewDashboardService 创建 Dashboard 服务
func NewDashboardService() *DashboardService {
	return &DashboardService{}
}

// OverviewData 概览数据
type OverviewData struct {
	TotalUsers     int64   `json:"total_users"`
	ActiveUsers    int64   `json:"active_users"`
	TotalTokens    int64   `json:"total_tokens"`
	ActiveTokens   int64   `json:"active_tokens"`
	TotalChannels  int64   `json:"total_channels"`
	ActiveChannels int64   `json:"active_channels"`
	TodayRequests  int64   `json:"today_requests"`
	TodayQuota     int64   `json:"today_quota"`
	TotalQuota     int64   `json:"total_quota"`
	TotalUsedQuota int64   `json:"total_used_quota"`
	QuotaUsageRate float64 `json:"quota_usage_rate"`
}

// GetOverview 获取系统概览
func (s *DashboardService) GetOverview() (*OverviewData, error) {
	cacheKey := cache.CacheKey("dashboard", "overview")

	// 尝试从缓存获取
	var data OverviewData
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 5 * time.Minute,
	}

	err := wrapper.GetOrSet(&data, func() (interface{}, error) {
		return s.fetchOverviewData()
	})

	return &data, err
}

// fetchOverviewData 获取概览数据
func (s *DashboardService) fetchOverviewData() (*OverviewData, error) {
	db := database.GetMainDB()
	data := &OverviewData{}

	// 总用户数
	db.Model(&models.User{}).Where("deleted_at IS NULL").Count(&data.TotalUsers)

	// 活跃用户数（状态为启用）
	db.Model(&models.User{}).Where("deleted_at IS NULL AND status = ?", models.UserStatusEnabled).Count(&data.ActiveUsers)

	// 总令牌数
	db.Model(&models.Token{}).Where("deleted_at IS NULL").Count(&data.TotalTokens)

	// 活跃令牌数
	db.Model(&models.Token{}).Where("deleted_at IS NULL AND status = ?", models.TokenStatusEnabled).Count(&data.ActiveTokens)

	// 总渠道数
	db.Model(&models.Channel{}).Where("deleted_at IS NULL").Count(&data.TotalChannels)

	// 活跃渠道数
	db.Model(&models.Channel{}).Where("deleted_at IS NULL AND status = ?", models.ChannelStatusEnabled).Count(&data.ActiveChannels)

	// 今日请求数和额度消耗
	// 注意：数据库中 created_at 是 bigint (Unix 时间戳)
	todayStart := time.Date(time.Now().Year(), time.Now().Month(), time.Now().Day(), 0, 0, 0, 0, time.Now().Location()).Unix()

	db.Model(&models.Log{}).
		Where("created_at >= ? AND type = ?", todayStart, models.LogTypeConsume).
		Count(&data.TodayRequests)

	db.Model(&models.Log{}).
		Where("created_at >= ? AND type = ?", todayStart, models.LogTypeConsume).
		Select("COALESCE(SUM(quota), 0)").
		Scan(&data.TodayQuota)

	// 总额度和已用额度
	db.Model(&models.User{}).
		Where("deleted_at IS NULL").
		Select("COALESCE(SUM(quota), 0)").
		Scan(&data.TotalQuota)

	db.Model(&models.User{}).
		Where("deleted_at IS NULL").
		Select("COALESCE(SUM(used_quota), 0)").
		Scan(&data.TotalUsedQuota)

	// 计算额度使用率
	if data.TotalQuota > 0 {
		data.QuotaUsageRate = float64(data.TotalUsedQuota) / float64(data.TotalQuota) * 100
	}

	return data, nil
}

// UsageData 使用统计数据
type UsageData struct {
	Period        string  `json:"period"`
	TotalRequests int64   `json:"total_requests"`
	TotalQuota    int64   `json:"total_quota"`
	AvgQuota      float64 `json:"avg_quota"`
	UniqueUsers   int64   `json:"unique_users"`
	UniqueTokens  int64   `json:"unique_tokens"`
}

// GetUsage 获取使用统计
func (s *DashboardService) GetUsage(period string) (*UsageData, error) {
	cacheKey := cache.CacheKey("dashboard", "usage", period)

	var data UsageData
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 5 * time.Minute,
	}

	err := wrapper.GetOrSet(&data, func() (interface{}, error) {
		return s.fetchUsageData(period)
	})

	return &data, err
}

// fetchUsageData 获取使用统计数据
func (s *DashboardService) fetchUsageData(period string) (*UsageData, error) {
	db := database.GetMainDB()
	data := &UsageData{Period: period}

	// 计算时间范围（Unix 时间戳）
	// 支持前端期望的格式：24h/3d/7d/14d 以及传统格式：today/week/month
	now := time.Now()
	var startTime int64
	switch period {
	case "today":
		startTime = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	case "1h":
		startTime = now.Add(-1 * time.Hour).Unix()
	case "6h":
		startTime = now.Add(-6 * time.Hour).Unix()
	case "24h":
		startTime = now.Add(-24 * time.Hour).Unix()
	case "3d":
		startTime = now.Add(-3 * 24 * time.Hour).Unix()
	case "7d", "week":
		startTime = now.Add(-7 * 24 * time.Hour).Unix()
	case "14d":
		startTime = now.Add(-14 * 24 * time.Hour).Unix()
	case "month":
		startTime = now.AddDate(0, -1, 0).Unix()
	default:
		startTime = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	}

	// 总请求数
	db.Model(&models.Log{}).
		Where("created_at >= ? AND type = ?", startTime, models.LogTypeConsume).
		Count(&data.TotalRequests)

	// 总额度消耗
	db.Model(&models.Log{}).
		Where("created_at >= ? AND type = ?", startTime, models.LogTypeConsume).
		Select("COALESCE(SUM(quota), 0)").
		Scan(&data.TotalQuota)

	// 平均额度
	if data.TotalRequests > 0 {
		data.AvgQuota = float64(data.TotalQuota) / float64(data.TotalRequests)
	}

	// 唯一用户数
	db.Model(&models.Log{}).
		Where("created_at >= ? AND type = ?", startTime, models.LogTypeConsume).
		Distinct("user_id").
		Count(&data.UniqueUsers)

	// 唯一令牌数
	db.Model(&models.Log{}).
		Where("created_at >= ? AND type = ?", startTime, models.LogTypeConsume).
		Distinct("token_id").
		Count(&data.UniqueTokens)

	return data, nil
}

// ModelUsage 模型使用统计
type ModelUsage struct {
	ModelName        string `json:"model_name"`
	RequestCount     int64  `json:"request_count"`
	QuotaUsed        int64  `json:"quota_used"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
}

// GetModelUsage 获取模型使用统计
func (s *DashboardService) GetModelUsage(period string, limit int) ([]ModelUsage, error) {
	cacheKey := cache.CacheKey("dashboard", "models", period, fmt.Sprintf("%d", limit))

	var data []ModelUsage
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 5 * time.Minute,
	}

	err := wrapper.GetOrSet(&data, func() (interface{}, error) {
		return s.fetchModelUsage(period, limit)
	})

	return data, err
}

// fetchModelUsage 获取模型使用数据
func (s *DashboardService) fetchModelUsage(period string, limit int) ([]ModelUsage, error) {
	db := database.GetMainDB()

	// 根据 period 计算时间范围（与 fetchUsageData 保持一致）
	now := time.Now()
	var startTime int64
	switch period {
	case "today":
		startTime = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	case "1h":
		startTime = now.Add(-1 * time.Hour).Unix()
	case "6h":
		startTime = now.Add(-6 * time.Hour).Unix()
	case "24h":
		startTime = now.Add(-24 * time.Hour).Unix()
	case "3d":
		startTime = now.Add(-3 * 24 * time.Hour).Unix()
	case "7d", "week":
		startTime = now.Add(-7 * 24 * time.Hour).Unix()
	case "14d":
		startTime = now.Add(-14 * 24 * time.Hour).Unix()
	case "month":
		startTime = now.AddDate(0, -1, 0).Unix()
	default:
		// 默认 24 小时
		startTime = now.Add(-24 * time.Hour).Unix()
	}

	var results []struct {
		ModelName        string
		RequestCount     int64
		QuotaUsed        int64
		PromptTokens     int64
		CompletionTokens int64
	}

	err := db.Model(&models.Log{}).
		Select("model_name, COUNT(*) as request_count, COALESCE(SUM(quota), 0) as quota_used, COALESCE(SUM(prompt_tokens), 0) as prompt_tokens, COALESCE(SUM(completion_tokens), 0) as completion_tokens").
		Where("created_at >= ? AND type = ? AND model_name != ''", startTime, models.LogTypeConsume).
		Group("model_name").
		Order("request_count DESC").
		Limit(limit).
		Scan(&results).Error

	if err != nil {
		return nil, err
	}

	// 转换为返回格式
	data := make([]ModelUsage, len(results))
	for i, r := range results {
		data[i] = ModelUsage{
			ModelName:        r.ModelName,
			RequestCount:     r.RequestCount,
			QuotaUsed:        r.QuotaUsed,
			PromptTokens:     r.PromptTokens,
			CompletionTokens: r.CompletionTokens,
		}
	}

	return data, nil
}

// TrendData 趋势数据
type TrendData struct {
	Time     string `json:"time"`
	Requests int64  `json:"requests"`
	Quota    int64  `json:"quota"`
	Users    int64  `json:"users"`
}

// GetDailyTrends 获取每日趋势（最近30天）
func (s *DashboardService) GetDailyTrends(days int) ([]TrendData, error) {
	cacheKey := cache.CacheKey("dashboard", "trends", "daily", fmt.Sprintf("%d", days))

	var data []TrendData
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 10 * time.Minute,
	}

	err := wrapper.GetOrSet(&data, func() (interface{}, error) {
		return s.fetchDailyTrends(days)
	})

	return data, err
}

// fetchDailyTrends 获取每日趋势数据
func (s *DashboardService) fetchDailyTrends(days int) ([]TrendData, error) {
	db := database.GetMainDB()

	startTime := time.Now().AddDate(0, 0, -days).Unix()

	var results []struct {
		Date     string
		Requests int64
		Quota    int64
		Users    int64
	}

	// 根据数据库类型使用不同的日期格式化函数
	// 注意：created_at 是 bigint (Unix 时间戳)
	var dateFormat string
	if database.GetMainDB().Dialector.Name() == "postgres" {
		dateFormat = "TO_CHAR(TO_TIMESTAMP(created_at), 'YYYY-MM-DD')"
	} else {
		// MySQL
		dateFormat = "DATE(FROM_UNIXTIME(created_at))"
	}

	err := db.Model(&models.Log{}).
		Select(fmt.Sprintf("%s as date, COUNT(*) as requests, COALESCE(SUM(quota), 0) as quota, COUNT(DISTINCT user_id) as users", dateFormat)).
		Where("created_at >= ? AND type = ?", startTime, models.LogTypeConsume).
		Group("date").
		Order("date ASC").
		Scan(&results).Error

	if err != nil {
		return nil, err
	}

	// 转换为返回格式
	data := make([]TrendData, len(results))
	for i, r := range results {
		data[i] = TrendData{
			Time:     r.Date,
			Requests: r.Requests,
			Quota:    r.Quota,
			Users:    r.Users,
		}
	}

	return data, nil
}

// TopUser 用户排行
type TopUser struct {
	UserID      int    `json:"user_id"`
	Username    string `json:"username"`
	Requests    int64  `json:"requests"`
	Quota       int64  `json:"quota"`
	LastRequest string `json:"last_request"`
}

// GetTopUsers 获取用户排行
func (s *DashboardService) GetTopUsers(limit int, orderBy string) ([]TopUser, error) {
	cacheKey := cache.CacheKey("dashboard", "top-users", orderBy, fmt.Sprintf("%d", limit))

	var data []TopUser
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 2 * time.Minute,
	}

	err := wrapper.GetOrSet(&data, func() (interface{}, error) {
		return s.fetchTopUsers(limit, orderBy)
	})

	return data, err
}

// fetchTopUsers 获取用户排行数据
func (s *DashboardService) fetchTopUsers(limit int, orderBy string) ([]TopUser, error) {
	db := database.GetMainDB()

	// 获取今日数据（Unix 时间戳）
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()

	orderClause := "requests DESC"
	if orderBy == "quota" {
		orderClause = "quota DESC"
	}

	var results []struct {
		UserID      int
		Username    string
		Requests    int64
		Quota       int64
		LastRequest int64
	}

	err := db.Table("logs").
		Select("logs.user_id, users.username, COUNT(*) as requests, COALESCE(SUM(logs.quota), 0) as quota, MAX(logs.created_at) as last_request").
		Joins("LEFT JOIN users ON logs.user_id = users.id").
		Where("logs.created_at >= ? AND logs.type = ?", todayStart, models.LogTypeConsume).
		Group("logs.user_id, users.username").
		Order(orderClause).
		Limit(limit).
		Scan(&results).Error

	if err != nil {
		return nil, err
	}

	// 转换为返回格式
	data := make([]TopUser, len(results))
	for i, r := range results {
		data[i] = TopUser{
			UserID:      r.UserID,
			Username:    r.Username,
			Requests:    r.Requests,
			Quota:       r.Quota,
			LastRequest: time.Unix(r.LastRequest, 0).Format("2006-01-02 15:04:05"),
		}
	}

	return data, nil
}

// HourlyTrendData 每小时趋势数据
type HourlyTrendData struct {
	Hour        string `json:"hour"`
	Timestamp   int64  `json:"timestamp"`
	Requests    int64  `json:"request_count"`
	Quota       int64  `json:"quota_used"`
	UniqueUsers int64  `json:"unique_users"`
}

// ChannelStatus 渠道状态
type ChannelStatus struct {
	ID           int     `json:"id"`
	Name         string  `json:"name"`
	Type         int     `json:"type"`
	Status       int     `json:"status"`
	ResponseTime int     `json:"response_time"`
	UsedQuota    int64   `json:"used_quota"`
	Balance      float64 `json:"balance"`
	TestAt       string  `json:"test_at"`
}

// GetHourlyTrends 获取每小时趋势
func (s *DashboardService) GetHourlyTrends(hours int) ([]HourlyTrendData, error) {
	cacheKey := cache.CacheKey("dashboard", "trends", "hourly", fmt.Sprintf("%d", hours))

	var data []HourlyTrendData
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 5 * time.Minute,
	}

	err := wrapper.GetOrSet(&data, func() (interface{}, error) {
		return s.fetchHourlyTrends(hours)
	})

	return data, err
}

// fetchHourlyTrends 获取每小时趋势数据
func (s *DashboardService) fetchHourlyTrends(hours int) ([]HourlyTrendData, error) {
	db := database.GetMainDB()

	// 计算时间范围，向下取整到小时
	now := time.Now()
	currentHour := time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), 0, 0, 0, now.Location())

	// 生成所有小时的时间戳列表
	hourTimestamps := make([]int64, hours)
	for i := 0; i < hours; i++ {
		hourTimestamps[hours-1-i] = currentHour.Add(-time.Duration(i) * time.Hour).Unix()
	}

	startTime := hourTimestamps[0]

	// 根据数据库类型使用不同的小时格式化
	// 注意：created_at 是 bigint (Unix 时间戳)
	var hourFormat string
	if database.GetMainDB().Dialector.Name() == "postgres" {
		// 将 Unix 时间戳向下取整到小时
		hourFormat = "(created_at / 3600) * 3600"
	} else {
		// MySQL
		hourFormat = "UNIX_TIMESTAMP(DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m-%d %H:00:00'))"
	}

	var results []struct {
		HourTS   int64
		Requests int64
		Quota    int64
		Users    int64
	}

	err := db.Model(&models.Log{}).
		Select(fmt.Sprintf("%s as hour_ts, COUNT(*) as requests, COALESCE(SUM(quota), 0) as quota, COUNT(DISTINCT user_id) as users", hourFormat)).
		Where("created_at >= ? AND type = ?", startTime, models.LogTypeConsume).
		Group("hour_ts").
		Order("hour_ts ASC").
		Scan(&results).Error

	if err != nil {
		return nil, err
	}

	// 构建结果映射
	dataByHour := make(map[int64]HourlyTrendData)
	for _, r := range results {
		dataByHour[r.HourTS] = HourlyTrendData{
			Hour:        time.Unix(r.HourTS, 0).Format("15:04"),
			Timestamp:   r.HourTS,
			Requests:    r.Requests,
			Quota:       r.Quota,
			UniqueUsers: r.Users,
		}
	}

	// 填充所有小时（包括无数据的小时）
	data := make([]HourlyTrendData, hours)
	for i, ts := range hourTimestamps {
		if d, ok := dataByHour[ts]; ok {
			data[i] = d
		} else {
			data[i] = HourlyTrendData{
				Hour:        time.Unix(ts, 0).Format("15:04"),
				Timestamp:   ts,
				Requests:    0,
				Quota:       0,
				UniqueUsers: 0,
			}
		}
	}

	return data, nil
}

// GetChannelStatus 获取渠道状态
func (s *DashboardService) GetChannelStatus() ([]ChannelStatus, error) {
	cacheKey := cache.CacheKey("dashboard", "channels")

	var data []ChannelStatus
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 5 * time.Minute,
	}

	err := wrapper.GetOrSet(&data, func() (interface{}, error) {
		return s.fetchChannelStatus()
	})

	return data, err
}

// fetchChannelStatus 获取渠道状态数据
func (s *DashboardService) fetchChannelStatus() ([]ChannelStatus, error) {
	db := database.GetMainDB()

	var channels []models.Channel
	// 注意：channels 表可能没有 deleted_at 字段，直接查询所有渠道
	err := db.Order("id ASC").Find(&channels).Error
	if err != nil {
		return nil, err
	}

	data := make([]ChannelStatus, len(channels))
	for i, ch := range channels {
		data[i] = ChannelStatus{
			ID:           ch.ID,
			Name:         ch.Name,
			Type:         ch.Type,
			Status:       ch.Status,
			ResponseTime: ch.ResponseTime,
			UsedQuota:    ch.UsedQuota,
			Balance:      ch.Balance,
		}
		if ch.TestAt != nil {
			data[i].TestAt = ch.TestAt.Format("2006-01-02 15:04:05")
		}
	}

	return data, nil
}

// SystemInfo 系统信息
type SystemInfo struct {
	Version      string `json:"version"`
	GoVersion    string `json:"go_version"`
	StartTime    string `json:"start_time"`
	Uptime       string `json:"uptime"`
	NumCPU       int    `json:"num_cpu"`
	NumGoroutine int    `json:"num_goroutine"`
	MemAlloc     string `json:"mem_alloc"`
	MemSys       string `json:"mem_sys"`
}

// 服务启动时间
var serviceStartTime = time.Now()

// GetSystemInfo 获取系统信息
func (s *DashboardService) GetSystemInfo() (*SystemInfo, error) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	uptime := time.Since(serviceStartTime)

	return &SystemInfo{
		Version:      "1.0.0-go",
		GoVersion:    runtime.Version(),
		StartTime:    serviceStartTime.Format("2006-01-02 15:04:05"),
		Uptime:       uptime.Round(time.Second).String(),
		NumCPU:       runtime.NumCPU(),
		NumGoroutine: runtime.NumGoroutine(),
		MemAlloc:     formatBytes(m.Alloc),
		MemSys:       formatBytes(m.Sys),
	}, nil
}

// formatBytes 格式化字节数
func formatBytes(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

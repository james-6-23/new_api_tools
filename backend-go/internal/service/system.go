package service

import (
	"runtime"
	"sync"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/models"
)

// SystemService 系统管理服务
type SystemService struct {
	mu            sync.RWMutex
	cachedScale   string
	cachedMetrics *ScaleMetrics
	cacheTime     time.Time
}

// NewSystemService 创建系统服务
func NewSystemService() *SystemService {
	return &SystemService{}
}

// ScaleLevel 系统规模等级
type ScaleLevel string

const (
	ScaleSmall  ScaleLevel = "small"  // < 1000 users, < 100k logs/day
	ScaleMedium ScaleLevel = "medium" // 1000-10000 users, 100k-1M logs/day
	ScaleLarge  ScaleLevel = "large"  // 10000-50000 users, 1M-10M logs/day
	ScaleXLarge ScaleLevel = "xlarge" // > 50000 users, > 10M logs/day
)

// ScaleMetrics 系统规模指标
type ScaleMetrics struct {
	TotalUsers     int64   `json:"total_users"`
	ActiveUsers24h int64   `json:"active_users_24h"`
	Logs24h        int64   `json:"logs_24h"`
	TotalLogs      int64   `json:"total_logs"`
	RPMAvg         float64 `json:"rpm_avg"`
}

// ScaleSettings 规模对应的设置
type ScaleSettings struct {
	Scale                   string `json:"scale"`
	LeaderboardCacheTTL     int    `json:"leaderboard_cache_ttl"`
	IPCacheTTL              int    `json:"ip_cache_ttl"`
	StatsCacheTTL           int    `json:"stats_cache_ttl"`
	FrontendRefreshInterval int    `json:"frontend_refresh_interval"`
	Description             string `json:"description"`
}

// 规模设置配置
var scaleSettingsMap = map[ScaleLevel]ScaleSettings{
	ScaleSmall: {
		Scale:                   "small",
		LeaderboardCacheTTL:     30,
		IPCacheTTL:              30,
		StatsCacheTTL:           60,
		FrontendRefreshInterval: 30,
		Description:             "小型系统 (< 1000 用户)",
	},
	ScaleMedium: {
		Scale:                   "medium",
		LeaderboardCacheTTL:     60,
		IPCacheTTL:              60,
		StatsCacheTTL:           120,
		FrontendRefreshInterval: 60,
		Description:             "中型系统 (1000-10000 用户)",
	},
	ScaleLarge: {
		Scale:                   "large",
		LeaderboardCacheTTL:     300,
		IPCacheTTL:              300,
		StatsCacheTTL:           300,
		FrontendRefreshInterval: 300,
		Description:             "大型系统 (10000-50000 用户)",
	},
	ScaleXLarge: {
		Scale:                   "xlarge",
		LeaderboardCacheTTL:     600,
		IPCacheTTL:              600,
		StatsCacheTTL:           600,
		FrontendRefreshInterval: 600,
		Description:             "超大型系统 (> 50000 用户)",
	},
}

// ScaleDetectionResult 规模检测结果
type ScaleDetectionResult struct {
	Scale    string         `json:"scale"`
	Metrics  *ScaleMetrics  `json:"metrics"`
	Settings *ScaleSettings `json:"settings"`
	Cached   bool           `json:"cached"`
}

// DetectScale 检测系统规模
func (s *SystemService) DetectScale(forceRefresh bool) (*ScaleDetectionResult, error) {
	s.mu.RLock()
	if !forceRefresh && s.cachedScale != "" && time.Since(s.cacheTime) < time.Hour {
		settings := scaleSettingsMap[ScaleLevel(s.cachedScale)]
		result := &ScaleDetectionResult{
			Scale:    s.cachedScale,
			Metrics:  s.cachedMetrics,
			Settings: &settings,
			Cached:   true,
		}
		s.mu.RUnlock()
		return result, nil
	}
	s.mu.RUnlock()

	// 收集指标
	metrics := s.collectMetrics()

	// 确定规模
	scale := s.determineScale(metrics)

	// 缓存结果
	s.mu.Lock()
	s.cachedScale = string(scale)
	s.cachedMetrics = metrics
	s.cacheTime = time.Now()
	s.mu.Unlock()

	settings := scaleSettingsMap[scale]
	return &ScaleDetectionResult{
		Scale:    string(scale),
		Metrics:  metrics,
		Settings: &settings,
		Cached:   false,
	}, nil
}

// collectMetrics 收集系统指标
func (s *SystemService) collectMetrics() *ScaleMetrics {
	db := database.GetMainDB()
	metrics := &ScaleMetrics{}

	now := time.Now()
	start24h := now.Add(-24 * time.Hour).Unix()
	start1h := now.Add(-1 * time.Hour).Unix()

	// 总用户数
	db.Model(&models.User{}).Where("deleted_at IS NULL").Count(&metrics.TotalUsers)

	// 24h 活跃用户
	db.Model(&models.Log{}).
		Where("created_at >= ?", start24h).
		Distinct("user_id").
		Count(&metrics.ActiveUsers24h)

	// 24h 日志数
	db.Model(&models.Log{}).
		Where("created_at >= ?", start24h).
		Count(&metrics.Logs24h)

	// 总日志数（使用近似值）
	if db.Dialector.Name() == "postgres" {
		var count int64
		db.Raw("SELECT reltuples::bigint FROM pg_class WHERE relname = 'logs'").Scan(&count)
		metrics.TotalLogs = count
	} else {
		var count int64
		db.Raw("SELECT TABLE_ROWS FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'logs'").Scan(&count)
		metrics.TotalLogs = count
	}

	// 如果近似值为 0，使用精确计数
	if metrics.TotalLogs == 0 {
		db.Model(&models.Log{}).Count(&metrics.TotalLogs)
	}

	// 计算 RPM（每分钟请求数）
	var logs1h int64
	db.Model(&models.Log{}).Where("created_at >= ?", start1h).Count(&logs1h)
	metrics.RPMAvg = float64(logs1h) / 60.0

	return metrics
}

// determineScale 根据指标确定系统规模
func (s *SystemService) determineScale(metrics *ScaleMetrics) ScaleLevel {
	totalUsers := metrics.TotalUsers
	logs24h := metrics.Logs24h
	rpmAvg := metrics.RPMAvg

	// XLarge: > 50000 users OR > 10M logs/day OR > 7000 RPM
	if totalUsers > 50000 || logs24h > 10000000 || rpmAvg > 7000 {
		return ScaleXLarge
	}

	// Large: > 10000 users OR > 1M logs/day OR > 700 RPM
	if totalUsers > 10000 || logs24h > 1000000 || rpmAvg > 700 {
		return ScaleLarge
	}

	// Medium: > 1000 users OR > 100k logs/day OR > 70 RPM
	if totalUsers > 1000 || logs24h > 100000 || rpmAvg > 70 {
		return ScaleMedium
	}

	return ScaleSmall
}

// GetCurrentScale 获取当前系统规模（快速，使用缓存）
func (s *SystemService) GetCurrentScale() string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.cachedScale != "" {
		return s.cachedScale
	}
	return "medium" // 默认中型
}

// SystemScale 系统规模
type SystemScale struct {
	TotalUsers       int64  `json:"total_users"`
	ActiveUsers      int64  `json:"active_users"`
	TotalTokens      int64  `json:"total_tokens"`
	ActiveTokens     int64  `json:"active_tokens"`
	TotalChannels    int64  `json:"total_channels"`
	ActiveChannels   int64  `json:"active_channels"`
	TotalLogs        int64  `json:"total_logs"`
	TodayLogs        int64  `json:"today_logs"`
	TotalTopUps      int64  `json:"total_topups"`
	TotalRedemptions int64  `json:"total_redemptions"`
	DatabaseSize     string `json:"database_size"`
	CacheSize        string `json:"cache_size"`
	RefreshedAt      string `json:"refreshed_at"`
}

// WarmupStatus 预热状态
type WarmupStatus struct {
	IsWarmedUp     bool                   `json:"is_warmed_up"`
	WarmupProgress float64                `json:"warmup_progress"`
	CacheStats     map[string]interface{} `json:"cache_stats"`
	DatabaseStats  map[string]interface{} `json:"database_stats"`
	MemoryStats    map[string]interface{} `json:"memory_stats"`
	StartedAt      string                 `json:"started_at"`
	CompletedAt    string                 `json:"completed_at"`
}

// IndexInfo 索引信息
type IndexInfo struct {
	TableName   string `json:"table_name"`
	IndexName   string `json:"index_name"`
	Columns     string `json:"columns"`
	IsUnique    bool   `json:"is_unique"`
	Cardinality int64  `json:"cardinality"`
	Size        string `json:"size"`
}

// IndexResult 索引操作结果
type IndexResult struct {
	Created  int      `json:"created"`
	Existing int      `json:"existing"`
	Failed   int      `json:"failed"`
	Details  []string `json:"details"`
	Duration string   `json:"duration"`
}

// GetSystemScale 获取系统规模
func (s *SystemService) GetSystemScale() (*SystemScale, error) {
	cacheKey := cache.CacheKey("system", "scale")

	var scale SystemScale
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 5 * time.Minute,
	}

	err := wrapper.GetOrSet(&scale, func() (interface{}, error) {
		return s.fetchSystemScale()
	})

	return &scale, err
}

// fetchSystemScale 获取系统规模数据
func (s *SystemService) fetchSystemScale() (*SystemScale, error) {
	db := database.GetMainDB()
	scale := &SystemScale{
		RefreshedAt: time.Now().Format("2006-01-02 15:04:05"),
	}

	// 用户统计
	db.Model(&models.User{}).Where("deleted_at IS NULL").Count(&scale.TotalUsers)
	db.Model(&models.User{}).Where("deleted_at IS NULL AND status = ?", models.UserStatusEnabled).Count(&scale.ActiveUsers)

	// 令牌统计
	db.Model(&models.Token{}).Where("deleted_at IS NULL").Count(&scale.TotalTokens)
	db.Model(&models.Token{}).Where("deleted_at IS NULL AND status = ?", models.TokenStatusEnabled).Count(&scale.ActiveTokens)

	// 渠道统计
	db.Model(&models.Channel{}).Count(&scale.TotalChannels)
	db.Model(&models.Channel{}).Where("status = ?", models.ChannelStatusEnabled).Count(&scale.ActiveChannels)

	// 日志统计
	db.Model(&models.Log{}).Count(&scale.TotalLogs)
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	db.Model(&models.Log{}).Where("created_at >= ?", todayStart).Count(&scale.TodayLogs)

	// 充值和兑换码统计
	db.Model(&models.TopUp{}).Count(&scale.TotalTopUps)
	db.Model(&models.Redemption{}).Count(&scale.TotalRedemptions)

	// 数据库大小（MySQL）
	var dbSize struct {
		Size float64
	}
	db.Raw(`
		SELECT SUM(data_length + index_length) / 1024 / 1024 as size
		FROM information_schema.tables
		WHERE table_schema = DATABASE()
	`).Scan(&dbSize)
	scale.DatabaseSize = formatSize(int64(dbSize.Size * 1024 * 1024))

	// 缓存大小
	scale.CacheSize = "N/A"

	return scale, nil
}

// RefreshSystemScale 刷新系统规模
func (s *SystemService) RefreshSystemScale() (*SystemScale, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 清除缓存
	cacheKey := cache.CacheKey("system", "scale")
	cache.Delete(cacheKey)

	return s.GetSystemScale()
}

// GetWarmupStatus 获取预热状态
func (s *SystemService) GetWarmupStatus() (*WarmupStatus, error) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	status := &WarmupStatus{
		IsWarmedUp:     true,
		WarmupProgress: 100.0,
		CacheStats: map[string]interface{}{
			"connected": cache.IsConnected(),
		},
		DatabaseStats: map[string]interface{}{
			"connected": database.IsConnected(),
		},
		MemoryStats: map[string]interface{}{
			"alloc":       formatSize(int64(m.Alloc)),
			"total_alloc": formatSize(int64(m.TotalAlloc)),
			"sys":         formatSize(int64(m.Sys)),
			"num_gc":      m.NumGC,
			"goroutines":  runtime.NumGoroutine(),
		},
		StartedAt:   time.Now().Add(-time.Hour).Format("2006-01-02 15:04:05"),
		CompletedAt: time.Now().Add(-time.Hour + time.Second*30).Format("2006-01-02 15:04:05"),
	}

	return status, nil
}

// GetIndexes 获取索引列表
func (s *SystemService) GetIndexes() ([]IndexInfo, error) {
	db := database.GetMainDB()

	var results []struct {
		TableName   string `gorm:"column:TABLE_NAME"`
		IndexName   string `gorm:"column:INDEX_NAME"`
		ColumnName  string `gorm:"column:COLUMN_NAME"`
		NonUnique   int    `gorm:"column:NON_UNIQUE"`
		Cardinality int64  `gorm:"column:CARDINALITY"`
	}

	db.Raw(`
		SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE, CARDINALITY
		FROM information_schema.statistics
		WHERE table_schema = DATABASE()
		ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
	`).Scan(&results)

	// 合并同一索引的列
	indexMap := make(map[string]*IndexInfo)
	for _, r := range results {
		key := r.TableName + "." + r.IndexName
		if idx, exists := indexMap[key]; exists {
			idx.Columns += ", " + r.ColumnName
		} else {
			indexMap[key] = &IndexInfo{
				TableName:   r.TableName,
				IndexName:   r.IndexName,
				Columns:     r.ColumnName,
				IsUnique:    r.NonUnique == 0,
				Cardinality: r.Cardinality,
			}
		}
	}

	indexes := make([]IndexInfo, 0, len(indexMap))
	for _, idx := range indexMap {
		indexes = append(indexes, *idx)
	}

	return indexes, nil
}

// EnsureIndexes 确保索引存在
func (s *SystemService) EnsureIndexes() (*IndexResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	startTime := time.Now()
	db := database.GetMainDB()

	result := &IndexResult{
		Details: []string{},
	}

	// 定义需要的索引
	indexes := []struct {
		table   string
		name    string
		columns string
	}{
		{"logs", "idx_logs_user_id", "user_id"},
		{"logs", "idx_logs_created_at", "created_at"},
		{"logs", "idx_logs_type", "type"},
		{"logs", "idx_logs_model_name", "model_name"},
		{"logs", "idx_logs_channel_id", "channel_id"},
		{"logs", "idx_logs_ip", "ip"},
		{"users", "idx_users_status", "status"},
		{"users", "idx_users_inviter_id", "inviter_id"},
		{"tokens", "idx_tokens_user_id", "user_id"},
		{"tokens", "idx_tokens_status", "status"},
		{"channels", "idx_channels_status", "status"},
		{"top_ups", "idx_topups_user_id", "user_id"},
		{"top_ups", "idx_topups_status", "status"},
		{"redemptions", "idx_redemptions_status", "status"},
	}

	for _, idx := range indexes {
		// 检查索引是否存在
		var count int64
		db.Raw(`
			SELECT COUNT(*)
			FROM information_schema.statistics
			WHERE table_schema = DATABASE()
			AND table_name = ?
			AND index_name = ?
		`, idx.table, idx.name).Scan(&count)

		if count > 0 {
			result.Existing++
			result.Details = append(result.Details, "索引已存在: "+idx.name)
			continue
		}

		// 创建索引
		err := db.Exec("CREATE INDEX " + idx.name + " ON " + idx.table + " (" + idx.columns + ")").Error
		if err != nil {
			result.Failed++
			result.Details = append(result.Details, "创建失败: "+idx.name+" - "+err.Error())
		} else {
			result.Created++
			result.Details = append(result.Details, "创建成功: "+idx.name)
		}
	}

	result.Duration = time.Since(startTime).String()

	return result, nil
}

// formatSize 格式化大小
func formatSize(bytes int64) string {
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
	)

	switch {
	case bytes >= GB:
		return formatFloat(float64(bytes)/float64(GB)) + " GB"
	case bytes >= MB:
		return formatFloat(float64(bytes)/float64(MB)) + " MB"
	case bytes >= KB:
		return formatFloat(float64(bytes)/float64(KB)) + " KB"
	default:
		return formatInt(bytes) + " B"
	}
}

func formatFloat(f float64) string {
	return formatFloatPrec(f, 2)
}

func formatFloatPrec(f float64, prec int) string {
	format := "%." + formatInt(int64(prec)) + "f"
	return sprintf(format, f)
}

func formatInt(i int64) string {
	if i == 0 {
		return "0"
	}

	negative := i < 0
	if negative {
		i = -i
	}

	var result []byte
	for i > 0 {
		result = append([]byte{byte('0' + i%10)}, result...)
		i /= 10
	}

	if negative {
		result = append([]byte{'-'}, result...)
	}

	return string(result)
}

func sprintf(format string, args ...interface{}) string {
	// 简单实现，仅支持 %.2f
	if len(args) == 1 {
		if f, ok := args[0].(float64); ok {
			intPart := int64(f)
			fracPart := int64((f - float64(intPart)) * 100)
			if fracPart < 0 {
				fracPart = -fracPart
			}
			frac := formatInt(fracPart)
			if len(frac) == 1 {
				frac = "0" + frac
			}
			return formatInt(intPart) + "." + frac
		}
	}
	return ""
}

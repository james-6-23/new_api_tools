package service

import (
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/config"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/models"
)

// StorageService 存储管理服务
type StorageService struct {
	mu sync.RWMutex
}

// NewStorageService 创建存储服务
func NewStorageService() *StorageService {
	return &StorageService{}
}

// StorageConfig 存储配置
type StorageConfig struct {
	CacheEnabled     bool   `json:"cache_enabled"`
	CacheTTL         int    `json:"cache_ttl"`
	CacheMaxSize     int64  `json:"cache_max_size"`
	LogRetentionDays int    `json:"log_retention_days"`
	AutoCleanup      bool   `json:"auto_cleanup"`
	CleanupInterval  int    `json:"cleanup_interval"`
	CompressOldLogs  bool   `json:"compress_old_logs"`
	BackupEnabled    bool   `json:"backup_enabled"`
	BackupPath       string `json:"backup_path"`
	LastUpdated      string `json:"last_updated"`
}

// CleanupResult 清理结果
type CleanupResult struct {
	CacheCleared   int64  `json:"cache_cleared"`
	LogsDeleted    int64  `json:"logs_deleted"`
	SpaceReclaimed string `json:"space_reclaimed"`
	Duration       string `json:"duration"`
	CleanedAt      string `json:"cleaned_at"`
}

// CacheStats 缓存统计
type CacheStats struct {
	Connected   bool    `json:"connected"`
	KeyCount    int64   `json:"key_count"`
	MemoryUsed  string  `json:"memory_used"`
	HitRate     float64 `json:"hit_rate"`
	MissRate    float64 `json:"miss_rate"`
	Uptime      string  `json:"uptime"`
	LastChecked string  `json:"last_checked"`
}

// 默认存储配置
var defaultStorageConfig = &StorageConfig{
	CacheEnabled:     true,
	CacheTTL:         300,
	CacheMaxSize:     1073741824, // 1GB
	LogRetentionDays: 90,
	AutoCleanup:      true,
	CleanupInterval:  86400, // 24 hours
	CompressOldLogs:  false,
	BackupEnabled:    false,
	BackupPath:       "/var/backups/new-api-tools",
}

// GetConfig 获取存储配置
func (s *StorageService) GetConfig() (*StorageConfig, error) {
	cacheKey := cache.CacheKey("storage", "config")

	var config StorageConfig
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 10 * time.Minute,
	}

	err := wrapper.GetOrSet(&config, func() (interface{}, error) {
		cfg := *defaultStorageConfig
		cfg.LastUpdated = time.Now().Format("2006-01-02 15:04:05")
		return &cfg, nil
	})

	return &config, err
}

// UpdateConfig 更新存储配置
func (s *StorageService) UpdateConfig(config *StorageConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	config.LastUpdated = time.Now().Format("2006-01-02 15:04:05")

	// 清除缓存
	cacheKey := cache.CacheKey("storage", "config")
	cache.Delete(cacheKey)

	return nil
}

// CleanupCache 清理缓存
func (s *StorageService) CleanupCache() (*CleanupResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	startTime := time.Now()

	// 清理所有缓存
	cleared, err := cache.FlushAll()
	if err != nil {
		cleared = 0
	}

	duration := time.Since(startTime)

	return &CleanupResult{
		CacheCleared:   cleared,
		LogsDeleted:    0,
		SpaceReclaimed: "N/A",
		Duration:       duration.String(),
		CleanedAt:      time.Now().Format("2006-01-02 15:04:05"),
	}, nil
}

// GetCacheStats 获取缓存统计
func (s *StorageService) GetCacheStats() (*CacheStats, error) {
	stats := &CacheStats{
		Connected:   cache.IsConnected(),
		LastChecked: time.Now().Format("2006-01-02 15:04:05"),
	}

	if stats.Connected {
		// 获取 Redis 信息
		info, err := cache.GetInfo()
		if err == nil {
			stats.KeyCount = info.KeyCount
			stats.MemoryUsed = info.MemoryUsed
			stats.HitRate = info.HitRate
			stats.MissRate = 100 - info.HitRate
			stats.Uptime = info.Uptime
		}
	}

	return stats, nil
}

// CleanupOldLogs 清理旧日志
func (s *StorageService) CleanupOldLogs(retentionDays int) (int64, error) {
	// 这里可以实现日志清理逻辑
	// 由于涉及数据删除，需要谨慎处理
	return 0, nil
}

// GetStorageUsage 获取存储使用情况
func (s *StorageService) GetStorageUsage() (map[string]interface{}, error) {
	result := map[string]interface{}{
		"checked_at": time.Now().Format("2006-01-02 15:04:05"),
	}

	// 获取本地 SQLite 数据库信息
	localDBInfo := s.getLocalDBInfo()
	result["local_database"] = localDBInfo

	// 获取主数据库日志统计
	logsInfo := s.getLogsInfo()
	result["logs"] = logsInfo

	// 获取 Redis 缓存信息
	cacheInfo := s.getCacheInfoInternal()
	result["cache"] = cacheInfo

	return result, nil
}

// getLocalDBInfo 获取本地 SQLite 数据库信息
func (s *StorageService) getLocalDBInfo() map[string]interface{} {
	info := map[string]interface{}{
		"size":        "N/A",
		"table_count": 0,
		"tables":      []map[string]interface{}{},
	}

	cfg := config.Get()
	if cfg == nil {
		return info
	}

	// 获取数据库文件大小
	dbPath := cfg.Database.LocalDBPath
	if fileInfo, err := os.Stat(dbPath); err == nil {
		info["size"] = formatBytes(uint64(fileInfo.Size()))
		info["size_bytes"] = fileInfo.Size()
	}

	// 统计各表行数
	localDB := database.GetLocalDB()
	if localDB == nil {
		return info
	}

	tables := []struct {
		name  string
		label string
	}{
		{"config", "配置"},
		{"cache", "缓存"},
		{"stats_snapshots", "统计快照"},
		{"security_audit", "安全审计"},
		{"ai_audit_logs", "AI 审计"},
		{"analytics_state", "分析状态"},
		{"user_rankings", "用户排行"},
		{"model_stats", "模型统计"},
		{"aiban_whitelist", "AI Ban 白名单"},
		{"aiban_audit_logs", "AI Ban 审计"},
		{"aiban_config", "AI Ban 配置"},
	}

	var tableInfos []map[string]interface{}
	totalRows := int64(0)

	for _, t := range tables {
		var count int64
		if err := localDB.Raw("SELECT COUNT(*) FROM " + t.name).Scan(&count).Error; err == nil {
			tableInfos = append(tableInfos, map[string]interface{}{
				"name":  t.name,
				"label": t.label,
				"rows":  count,
			})
			totalRows += count
		}
	}

	info["table_count"] = len(tableInfos)
	info["total_rows"] = totalRows
	info["tables"] = tableInfos

	return info
}

// getLogsInfo 获取日志统计信息
func (s *StorageService) getLogsInfo() map[string]interface{} {
	info := map[string]interface{}{
		"total_count": int64(0),
		"today_count": int64(0),
		"oldest_log":  "N/A",
		"newest_log":  "N/A",
	}

	mainDB := database.GetMainDB()
	if mainDB == nil {
		return info
	}

	// 总日志数
	var totalCount int64
	mainDB.Model(&models.Log{}).Count(&totalCount)
	info["total_count"] = totalCount

	// 今日日志数
	todayStart := time.Date(time.Now().Year(), time.Now().Month(), time.Now().Day(), 0, 0, 0, 0, time.Now().Location()).Unix()
	var todayCount int64
	mainDB.Model(&models.Log{}).Where("created_at >= ?", todayStart).Count(&todayCount)
	info["today_count"] = todayCount

	// 最早日志时间
	var oldestLog models.Log
	if err := mainDB.Order("id ASC").Limit(1).Find(&oldestLog).Error; err == nil && oldestLog.ID > 0 {
		info["oldest_log"] = time.Unix(oldestLog.CreatedAt, 0).Format("2006-01-02 15:04:05")
	}

	// 最新日志时间
	var newestLog models.Log
	if err := mainDB.Order("id DESC").Limit(1).Find(&newestLog).Error; err == nil && newestLog.ID > 0 {
		info["newest_log"] = time.Unix(newestLog.CreatedAt, 0).Format("2006-01-02 15:04:05")
	}

	return info
}

// getCacheInfoInternal 获取缓存信息（内部方法）
func (s *StorageService) getCacheInfoInternal() map[string]interface{} {
	info := map[string]interface{}{
		"type":      "redis",
		"connected": cache.IsConnected(),
		"key_count": int64(0),
		"memory":    "N/A",
	}

	if cache.IsConnected() {
		if redisInfo, err := cache.GetInfo(); err == nil {
			info["key_count"] = redisInfo.KeyCount
			info["memory"] = redisInfo.MemoryUsed
			info["hit_rate"] = redisInfo.HitRate
			info["uptime"] = redisInfo.Uptime
		}
	}

	return info
}

// GetConfigByKey 获取单个配置项
func (s *StorageService) GetConfigByKey(key string) (map[string]interface{}, error) {
	config, err := s.GetConfig()
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"key":   key,
		"value": config,
	}, nil
}

// DeleteConfig 删除配置项
func (s *StorageService) DeleteConfig(key string) error {
	cacheKey := cache.CacheKey("storage", "config", key)
	cache.Delete(cacheKey)
	return nil
}

// GetCacheInfo 获取缓存信息
func (s *StorageService) GetCacheInfo() (map[string]interface{}, error) {
	info := map[string]interface{}{
		"type":       "redis",
		"connected":  cache.IsConnected(),
		"key_count":  int64(0),
		"memory":     "N/A",
		"checked_at": time.Now().Format("2006-01-02 15:04:05"),
	}

	if cache.IsConnected() {
		if redisInfo, err := cache.GetInfo(); err == nil {
			info["key_count"] = redisInfo.KeyCount
			info["memory"] = redisInfo.MemoryUsed
			info["hit_rate"] = redisInfo.HitRate
			info["miss_rate"] = 100 - redisInfo.HitRate
			info["uptime"] = redisInfo.Uptime
		}
	}

	// 获取 SQLite 缓存表统计
	localDB := database.GetLocalDB()
	if localDB != nil {
		var cacheCount int64
		var expiredCount int64
		now := time.Now()

		localDB.Raw("SELECT COUNT(*) FROM cache").Scan(&cacheCount)
		localDB.Raw("SELECT COUNT(*) FROM cache WHERE expire_at < ?", now).Scan(&expiredCount)

		info["sqlite_cache"] = map[string]interface{}{
			"total_entries":   cacheCount,
			"expired_entries": expiredCount,
			"active_entries":  cacheCount - expiredCount,
		}
	}

	return info, nil
}

// ClearAllCache 清空所有缓存
func (s *StorageService) ClearAllCache() error {
	_, err := cache.FlushAll()
	return err
}

// ClearDashboardCache 清空仪表板缓存
func (s *StorageService) ClearDashboardCache() error {
	patterns := []string{"dashboard:*", "overview:*", "usage:*", "trends:*"}
	for _, pattern := range patterns {
		_, _ = cache.DeleteByPattern(pattern) // 忽略返回值
	}
	return nil
}

// CleanupExpiredCache 清理过期缓存
func (s *StorageService) CleanupExpiredCache() (map[string]interface{}, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	result := map[string]interface{}{
		"redis_cleaned":  int64(0),
		"sqlite_cleaned": int64(0),
		"message":        "",
		"cleaned_at":     time.Now().Format("2006-01-02 15:04:05"),
	}

	var messages []string

	// Redis 自动处理过期
	if cache.IsConnected() {
		messages = append(messages, "Redis 自动处理过期缓存")
	}

	// 清理 SQLite 缓存表中的过期条目
	localDB := database.GetLocalDB()
	if localDB != nil {
		now := time.Now()

		// 先统计过期条目数
		var expiredCount int64
		localDB.Raw("SELECT COUNT(*) FROM cache WHERE expire_at < ?", now).Scan(&expiredCount)

		if expiredCount > 0 {
			// 删除过期条目
			if err := localDB.Exec("DELETE FROM cache WHERE expire_at < ?", now).Error; err == nil {
				result["sqlite_cleaned"] = expiredCount
				messages = append(messages, fmt.Sprintf("已清理 %d 条 SQLite 过期缓存", expiredCount))
			}
		} else {
			messages = append(messages, "SQLite 缓存表无过期条目")
		}
	}

	if len(messages) > 0 {
		result["message"] = messages[0]
		if len(messages) > 1 {
			result["details"] = messages
		}
	}

	return result, nil
}

// GetStorageInfo 获取存储信息
func (s *StorageService) GetStorageInfo() (map[string]interface{}, error) {
	return s.GetStorageUsage()
}

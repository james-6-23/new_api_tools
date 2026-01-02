package service

import (
	"sync"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
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
	return map[string]interface{}{
		"database": map[string]interface{}{
			"size":        "N/A",
			"table_count": 0,
			"row_count":   0,
		},
		"cache": map[string]interface{}{
			"size":      "N/A",
			"key_count": 0,
		},
		"logs": map[string]interface{}{
			"total_count":  0,
			"today_count":  0,
			"oldest_log":   "N/A",
			"storage_size": "N/A",
		},
		"checked_at": time.Now().Format("2006-01-02 15:04:05"),
	}, nil
}

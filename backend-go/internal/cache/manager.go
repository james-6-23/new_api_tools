package cache

import (
	"database/sql"
	"encoding/json"
	"sync"
	"time"

	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/logger"
	"go.uber.org/zap"
)

// CacheManager 三层缓存管理器
// L1: Redis (高性能热缓存，可选)
// L2: SQLite (本地持久化缓存，必选)
// L3: PostgreSQL/MySQL (只读数据源)
type CacheManager struct {
	mu             sync.RWMutex
	redisAvailable bool
}

var (
	cacheManager *CacheManager
	managerOnce  sync.Once
)

// GetCacheManager 获取缓存管理器单例
func GetCacheManager() *CacheManager {
	managerOnce.Do(func() {
		cacheManager = &CacheManager{
			redisAvailable: IsConnected(),
		}
		// 初始化 SQLite 缓存表
		cacheManager.initSQLiteTables()
	})
	return cacheManager
}

// initSQLiteTables 初始化 SQLite 缓存表
func (m *CacheManager) initSQLiteTables() {
	db := database.GetLocalDB()
	if db == nil {
		logger.Warn("本地数据库未初始化，SQLite 缓存不可用")
		return
	}

	// 创建排行榜缓存表
	db.Exec(`
		CREATE TABLE IF NOT EXISTS leaderboard_cache (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			window TEXT NOT NULL,
			sort_by TEXT NOT NULL,
			data TEXT NOT NULL,
			snapshot_time INTEGER NOT NULL,
			expires_at INTEGER NOT NULL,
			UNIQUE(window, sort_by)
		)
	`)

	// 创建 IP 监控缓存表
	db.Exec(`
		CREATE TABLE IF NOT EXISTS ip_monitoring_cache (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type TEXT NOT NULL,
			window TEXT NOT NULL,
			data TEXT NOT NULL,
			snapshot_time INTEGER NOT NULL,
			expires_at INTEGER NOT NULL,
			UNIQUE(type, window)
		)
	`)

	// 创建通用缓存表
	db.Exec(`
		CREATE TABLE IF NOT EXISTS generic_cache (
			key TEXT PRIMARY KEY,
			data TEXT NOT NULL,
			snapshot_time INTEGER NOT NULL,
			expires_at INTEGER NOT NULL
		)
	`)

	// 创建时间槽缓存表（用于增量缓存）
	db.Exec(`
		CREATE TABLE IF NOT EXISTS slot_cache (
			slot_key TEXT PRIMARY KEY,
			window TEXT NOT NULL,
			sort_by TEXT NOT NULL,
			slot_start INTEGER NOT NULL,
			slot_end INTEGER NOT NULL,
			data TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL
		)
	`)

	// 创建索引
	db.Exec("CREATE INDEX IF NOT EXISTS idx_leaderboard_expires ON leaderboard_cache(expires_at)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_ip_monitoring_expires ON ip_monitoring_cache(expires_at)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_generic_expires ON generic_cache(expires_at)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_slot_cache_expires ON slot_cache(expires_at)")

	logger.Info("SQLite 缓存表初始化完成")
}

// Get 获取缓存（L1 Redis -> L2 SQLite）
func (m *CacheManager) Get(key string, dest interface{}) error {
	// L1: 尝试从 Redis 获取
	if m.redisAvailable {
		err := Get(key, dest)
		if err == nil {
			return nil
		}
		if err != ErrCacheMiss {
			logger.Debug("Redis 获取失败，尝试 SQLite", zap.String("key", key), zap.Error(err))
		}
	}

	// L2: 从 SQLite 获取
	return m.getFromSQLite(key, dest)
}

// Set 设置缓存（同时写入 L1 和 L2）
func (m *CacheManager) Set(key string, value interface{}, ttl time.Duration) error {
	// L1: 写入 Redis
	if m.redisAvailable {
		if err := Set(key, value, ttl); err != nil {
			logger.Debug("Redis 写入失败", zap.String("key", key), zap.Error(err))
		}
	}

	// L2: 写入 SQLite
	return m.setToSQLite(key, value, ttl)
}

// Delete 删除缓存
func (m *CacheManager) Delete(key string) error {
	// L1: 从 Redis 删除
	if m.redisAvailable {
		Delete(key)
	}

	// L2: 从 SQLite 删除
	return m.deleteFromSQLite(key)
}

// getFromSQLite 从 SQLite 获取缓存
func (m *CacheManager) getFromSQLite(key string, dest interface{}) error {
	db := database.GetLocalDB()
	if db == nil {
		return ErrCacheMiss
	}

	var data string
	var expiresAt int64

	err := db.Raw(`
		SELECT data, expires_at FROM generic_cache
		WHERE key = ? AND expires_at > ?
	`, key, time.Now().Unix()).Row().Scan(&data, &expiresAt)

	if err != nil {
		if err == sql.ErrNoRows {
			return ErrCacheMiss
		}
		return err
	}

	return json.Unmarshal([]byte(data), dest)
}

// setToSQLite 写入 SQLite 缓存
func (m *CacheManager) setToSQLite(key string, value interface{}, ttl time.Duration) error {
	db := database.GetLocalDB()
	if db == nil {
		return nil
	}

	data, err := json.Marshal(value)
	if err != nil {
		return err
	}

	now := time.Now().Unix()
	expiresAt := now + int64(ttl.Seconds())

	return db.Exec(`
		INSERT INTO generic_cache (key, data, snapshot_time, expires_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			data = excluded.data,
			snapshot_time = excluded.snapshot_time,
			expires_at = excluded.expires_at
	`, key, string(data), now, expiresAt).Error
}

// deleteFromSQLite 从 SQLite 删除缓存
func (m *CacheManager) deleteFromSQLite(key string) error {
	db := database.GetLocalDB()
	if db == nil {
		return nil
	}

	return db.Exec("DELETE FROM generic_cache WHERE key = ?", key).Error
}

// SetLeaderboard 设置排行榜缓存
func (m *CacheManager) SetLeaderboard(window, sortBy string, data interface{}, ttl time.Duration) error {
	key := CacheKey("leaderboard", window, sortBy)

	// L1: Redis
	if m.redisAvailable {
		Set(key, data, ttl)
	}

	// L2: SQLite
	db := database.GetLocalDB()
	if db == nil {
		return nil
	}

	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	now := time.Now().Unix()
	expiresAt := now + int64(ttl.Seconds())

	return db.Exec(`
		INSERT INTO leaderboard_cache (window, sort_by, data, snapshot_time, expires_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(window, sort_by) DO UPDATE SET
			data = excluded.data,
			snapshot_time = excluded.snapshot_time,
			expires_at = excluded.expires_at
	`, window, sortBy, string(jsonData), now, expiresAt).Error
}

// GetLeaderboard 获取排行榜缓存
func (m *CacheManager) GetLeaderboard(window, sortBy string, dest interface{}) error {
	key := CacheKey("leaderboard", window, sortBy)

	// L1: Redis
	if m.redisAvailable {
		if err := Get(key, dest); err == nil {
			return nil
		}
	}

	// L2: SQLite
	db := database.GetLocalDB()
	if db == nil {
		return ErrCacheMiss
	}

	var data string
	err := db.Raw(`
		SELECT data FROM leaderboard_cache
		WHERE window = ? AND sort_by = ? AND expires_at > ?
	`, window, sortBy, time.Now().Unix()).Row().Scan(&data)

	if err != nil {
		if err == sql.ErrNoRows {
			return ErrCacheMiss
		}
		return err
	}

	return json.Unmarshal([]byte(data), dest)
}

// SetIPMonitoring 设置 IP 监控缓存
func (m *CacheManager) SetIPMonitoring(monitorType, window string, data interface{}, ttl time.Duration) error {
	key := CacheKey("ip_monitoring", monitorType, window)

	// L1: Redis
	if m.redisAvailable {
		Set(key, data, ttl)
	}

	// L2: SQLite
	db := database.GetLocalDB()
	if db == nil {
		return nil
	}

	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	now := time.Now().Unix()
	expiresAt := now + int64(ttl.Seconds())

	return db.Exec(`
		INSERT INTO ip_monitoring_cache (type, window, data, snapshot_time, expires_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(type, window) DO UPDATE SET
			data = excluded.data,
			snapshot_time = excluded.snapshot_time,
			expires_at = excluded.expires_at
	`, monitorType, window, string(jsonData), now, expiresAt).Error
}

// GetIPMonitoring 获取 IP 监控缓存
func (m *CacheManager) GetIPMonitoring(monitorType, window string, dest interface{}) error {
	key := CacheKey("ip_monitoring", monitorType, window)

	// L1: Redis
	if m.redisAvailable {
		if err := Get(key, dest); err == nil {
			return nil
		}
	}

	// L2: SQLite
	db := database.GetLocalDB()
	if db == nil {
		return ErrCacheMiss
	}

	var data string
	err := db.Raw(`
		SELECT data FROM ip_monitoring_cache
		WHERE type = ? AND window = ? AND expires_at > ?
	`, monitorType, window, time.Now().Unix()).Row().Scan(&data)

	if err != nil {
		if err == sql.ErrNoRows {
			return ErrCacheMiss
		}
		return err
	}

	return json.Unmarshal([]byte(data), dest)
}

// CleanupExpired 清理过期缓存
func (m *CacheManager) CleanupExpired() (int64, error) {
	db := database.GetLocalDB()
	if db == nil {
		return 0, nil
	}

	now := time.Now().Unix()
	var total int64

	// 清理通用缓存
	result := db.Exec("DELETE FROM generic_cache WHERE expires_at < ?", now)
	total += result.RowsAffected

	// 清理排行榜缓存
	result = db.Exec("DELETE FROM leaderboard_cache WHERE expires_at < ?", now)
	total += result.RowsAffected

	// 清理 IP 监控缓存
	result = db.Exec("DELETE FROM ip_monitoring_cache WHERE expires_at < ?", now)
	total += result.RowsAffected

	// 清理槽缓存
	result = db.Exec("DELETE FROM slot_cache WHERE expires_at < ?", now)
	total += result.RowsAffected

	if total > 0 {
		logger.Info("清理过期缓存", zap.Int64("count", total))
	}

	return total, nil
}

// RestoreToRedis 从 SQLite 恢复缓存到 Redis
func (m *CacheManager) RestoreToRedis() (int, error) {
	if !m.redisAvailable {
		return 0, nil
	}

	db := database.GetLocalDB()
	if db == nil {
		return 0, nil
	}

	now := time.Now().Unix()
	restored := 0

	// 恢复通用缓存
	var genericItems []struct {
		Key       string
		Data      string
		ExpiresAt int64
	}
	db.Raw("SELECT key, data, expires_at FROM generic_cache WHERE expires_at > ?", now).Scan(&genericItems)

	for _, item := range genericItems {
		ttl := time.Duration(item.ExpiresAt-now) * time.Second
		if ttl > 0 {
			var value interface{}
			if json.Unmarshal([]byte(item.Data), &value) == nil {
				if Set(item.Key, value, ttl) == nil {
					restored++
				}
			}
		}
	}

	logger.Info("从 SQLite 恢复缓存到 Redis", zap.Int("count", restored))
	return restored, nil
}

// GetStats 获取缓存统计
func (m *CacheManager) GetStats() map[string]interface{} {
	stats := map[string]interface{}{
		"redis_available": m.redisAvailable,
	}

	// Redis 统计
	if m.redisAvailable {
		if info, err := GetInfo(); err == nil {
			stats["redis_keys"] = info.KeyCount
			stats["redis_memory"] = info.MemoryUsed
			stats["redis_hit_rate"] = info.HitRate
		}
	}

	// SQLite 统计
	db := database.GetLocalDB()
	if db != nil {
		var genericCount, leaderboardCount, ipMonitoringCount, slotCount int64
		db.Raw("SELECT COUNT(*) FROM generic_cache WHERE expires_at > ?", time.Now().Unix()).Scan(&genericCount)
		db.Raw("SELECT COUNT(*) FROM leaderboard_cache WHERE expires_at > ?", time.Now().Unix()).Scan(&leaderboardCount)
		db.Raw("SELECT COUNT(*) FROM ip_monitoring_cache WHERE expires_at > ?", time.Now().Unix()).Scan(&ipMonitoringCount)
		db.Raw("SELECT COUNT(*) FROM slot_cache WHERE expires_at > ?", time.Now().Unix()).Scan(&slotCount)

		stats["sqlite_generic"] = genericCount
		stats["sqlite_leaderboard"] = leaderboardCount
		stats["sqlite_ip_monitoring"] = ipMonitoringCount
		stats["sqlite_slot"] = slotCount
		stats["sqlite_total"] = genericCount + leaderboardCount + ipMonitoringCount + slotCount
	}

	return stats
}

// IsRedisAvailable 检查 Redis 是否可用
func (m *CacheManager) IsRedisAvailable() bool {
	return m.redisAvailable
}

// RefreshRedisStatus 刷新 Redis 状态
func (m *CacheManager) RefreshRedisStatus() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.redisAvailable = IsConnected()
}

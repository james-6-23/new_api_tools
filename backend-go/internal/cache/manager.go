package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/new-api-tools/backend/internal/logger"
	"github.com/redis/go-redis/v9"
)

// Manager provides a two-level cache: local sync.Map + Redis
// Matches Python's cache_manager.py functionality
type Manager struct {
	rdb        *redis.Client
	localCache sync.Map // level-1 local cache
	ctx        context.Context

	// Stats
	hits   int64
	misses int64
	mu     sync.RWMutex
}

// Global cache manager
var mgr *Manager

// Init creates the cache manager and connects to Redis
func Init(connString string) (*Manager, error) {
	ctx := context.Background()

	// Parse Redis connection string
	opt, err := redis.ParseURL(connString)
	if err != nil {
		// Try as host:port format
		opt = &redis.Options{
			Addr: connString,
		}
	}

	rdb := redis.NewClient(opt)

	// Test connection
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis connection failed: %w", err)
	}

	mgr = &Manager{
		rdb: rdb,
		ctx: ctx,
	}

	logger.L.System("Redis 连接成功")
	return mgr, nil
}

// Get returns the global cache manager
func Get() *Manager {
	if mgr == nil {
		panic("cache not initialized, call cache.Init() first")
	}
	return mgr
}

// Close closes the Redis connection
func Close() error {
	if mgr != nil && mgr.rdb != nil {
		return mgr.rdb.Close()
	}
	return nil
}

// RedisClient returns the underlying redis client for advanced usage
func (m *Manager) RedisClient() *redis.Client {
	return m.rdb
}

// ========== Cache Operations ==========

// Set stores a value in both local and Redis cache
func (m *Manager) Set(key string, value interface{}, ttl time.Duration) error {
	// Serialize value
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("failed to serialize cache value: %w", err)
	}

	// Store in local cache
	m.localCache.Store(key, data)

	// Store in Redis
	return m.rdb.Set(m.ctx, key, data, ttl).Err()
}

// GetJSON retrieves and deserializes a value from cache
func (m *Manager) GetJSON(key string, dest interface{}) (bool, error) {
	// Try local cache first
	if val, ok := m.localCache.Load(key); ok {
		m.mu.Lock()
		m.hits++
		m.mu.Unlock()

		if data, ok := val.([]byte); ok {
			return true, json.Unmarshal(data, dest)
		}
	}

	// Try Redis
	data, err := m.rdb.Get(m.ctx, key).Bytes()
	if err == redis.Nil {
		m.mu.Lock()
		m.misses++
		m.mu.Unlock()
		return false, nil
	}
	if err != nil {
		return false, err
	}

	// Update local cache
	m.localCache.Store(key, data)

	m.mu.Lock()
	m.hits++
	m.mu.Unlock()

	return true, json.Unmarshal(data, dest)
}

// GetString retrieves a string value from cache
func (m *Manager) GetString(key string) (string, bool, error) {
	val, err := m.rdb.Get(m.ctx, key).Result()
	if err == redis.Nil {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return val, true, nil
}

// Delete removes a key from both caches
func (m *Manager) Delete(key string) error {
	m.localCache.Delete(key)
	return m.rdb.Del(m.ctx, key).Err()
}

// DeleteByPrefix removes all keys matching a prefix
func (m *Manager) DeleteByPrefix(prefix string) (int64, error) {
	// Clear local cache entries with this prefix
	m.localCache.Range(func(key, value interface{}) bool {
		if k, ok := key.(string); ok && strings.HasPrefix(k, prefix) {
			m.localCache.Delete(k)
		}
		return true
	})

	// Clear Redis keys with this prefix
	var cursor uint64
	var deleted int64
	pattern := prefix + "*"

	for {
		keys, nextCursor, err := m.rdb.Scan(m.ctx, cursor, pattern, 100).Result()
		if err != nil {
			return deleted, err
		}

		if len(keys) > 0 {
			pipe := m.rdb.Pipeline()
			for _, k := range keys {
				pipe.Del(m.ctx, k)
			}
			_, err := pipe.Exec(m.ctx)
			if err != nil {
				return deleted, err
			}
			deleted += int64(len(keys))
		}

		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	return deleted, nil
}

// Exists checks if a key exists in cache
func (m *Manager) Exists(key string) (bool, error) {
	n, err := m.rdb.Exists(m.ctx, key).Result()
	return n > 0, err
}

// ClearLocal clears the entire local cache
func (m *Manager) ClearLocal() {
	m.localCache = sync.Map{}
}

// ClearAll clears both local and all application Redis keys
func (m *Manager) ClearAll() (int64, error) {
	m.ClearLocal()
	return m.DeleteByPrefix("cache:")
}

// ========== Stats ==========

// Stats returns cache statistics
func (m *Manager) Stats() map[string]interface{} {
	m.mu.RLock()
	hits := m.hits
	misses := m.misses
	m.mu.RUnlock()

	total := hits + misses
	hitRate := float64(0)
	if total > 0 {
		hitRate = float64(hits) / float64(total) * 100
	}

	// Count local cache entries
	localCount := 0
	m.localCache.Range(func(_, _ interface{}) bool {
		localCount++
		return true
	})

	// Get Redis info
	info := map[string]interface{}{
		"hits":        hits,
		"misses":      misses,
		"hit_rate":    fmt.Sprintf("%.1f%%", hitRate),
		"local_count": localCount,
	}

	// Try to get Redis memory info
	memInfo, err := m.rdb.Info(m.ctx, "memory").Result()
	if err == nil {
		for _, line := range strings.Split(memInfo, "\r\n") {
			if strings.HasPrefix(line, "used_memory_human:") {
				info["redis_memory"] = strings.TrimPrefix(line, "used_memory_human:")
			}
		}
	}

	// Get key count
	dbSize, err := m.rdb.DBSize(m.ctx).Result()
	if err == nil {
		info["redis_keys"] = dbSize
	}

	return info
}

// ========== Hash operations (for local_store replacement) ==========

// HSet sets a field in a Redis hash
func (m *Manager) HSet(key, field string, value interface{}) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return m.rdb.HSet(m.ctx, key, field, data).Err()
}

// HGet retrieves a field from a Redis hash
func (m *Manager) HGet(key, field string, dest interface{}) (bool, error) {
	data, err := m.rdb.HGet(m.ctx, key, field).Bytes()
	if err == redis.Nil {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, json.Unmarshal(data, dest)
}

// HGetString retrieves a string field from a Redis hash
func (m *Manager) HGetString(key, field string) (string, bool, error) {
	val, err := m.rdb.HGet(m.ctx, key, field).Result()
	if err == redis.Nil {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return val, true, nil
}

// HDel removes a field from a Redis hash
func (m *Manager) HDel(key string, fields ...string) error {
	return m.rdb.HDel(m.ctx, key, fields...).Err()
}

// HGetAll retrieves all fields from a Redis hash
func (m *Manager) HGetAll(key string) (map[string]string, error) {
	return m.rdb.HGetAll(m.ctx, key).Result()
}

// ========== Convenience wrappers for handlers ==========

// GetStats returns cache statistics for API responses
func (m *Manager) GetStats() map[string]interface{} {
	return m.Stats()
}

// GetAllHashFields returns all fields of a Redis hash
func (m *Manager) GetAllHashFields(key string) (map[string]string, error) {
	return m.HGetAll(key)
}

// HashGet retrieves a single hash field as a string
func (m *Manager) HashGet(key, field string) (string, error) {
	val, found, err := m.HGetString(key, field)
	if err != nil {
		return "", err
	}
	if !found {
		return "", nil
	}
	return val, nil
}

// HashSet sets a hash field value
func (m *Manager) HashSet(key, field string, value interface{}) error {
	return m.HSet(key, field, value)
}

// HashDelete deletes a hash field, returns true if field existed
func (m *Manager) HashDelete(key, field string) (bool, error) {
	n, err := m.rdb.HDel(m.ctx, key, field).Result()
	return n > 0, err
}

// DeleteLocal removes local cache entries matching a prefix
func (m *Manager) DeleteLocal(prefix string) {
	m.localCache.Range(func(key, value interface{}) bool {
		if k, ok := key.(string); ok && strings.HasPrefix(k, prefix) {
			m.localCache.Delete(k)
		}
		return true
	})
}

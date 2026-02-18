package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/new-api-tools/backend/internal/logger"
	"github.com/redis/go-redis/v9"
)

// localEntry wraps cached data with an expiry time
type localEntry struct {
	data      []byte
	expiresAt time.Time // zero means no expiry
}

// isExpired returns true if the entry has expired
func (e *localEntry) isExpired() bool {
	if e.expiresAt.IsZero() {
		return false
	}
	return time.Now().After(e.expiresAt)
}

// Manager provides a two-level cache: local sync.Map + Redis
// Matches Python's cache_manager.py functionality
type Manager struct {
	rdb        *redis.Client
	localCache sync.Map // level-1 local cache (stores *localEntry)
	ctx        context.Context

	// Stats — use atomic for lock-free incrementing
	hits   int64
	misses int64
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

	// Configure Redis connection pool
	opt.PoolSize = 20
	opt.MinIdleConns = 5

	rdb := redis.NewClient(opt)

	// Test connection
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis connection failed: %w", err)
	}

	mgr = &Manager{
		rdb: rdb,
		ctx: ctx,
	}

	// Start local cache cleanup goroutine
	go mgr.cleanupExpiredEntries()

	logger.L.System("Redis 连接成功")
	return mgr, nil
}

// cleanupExpiredEntries periodically removes expired local cache entries
func (m *Manager) cleanupExpiredEntries() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		m.localCache.Range(func(key, value interface{}) bool {
			if entry, ok := value.(*localEntry); ok && entry.isExpired() {
				m.localCache.Delete(key)
			}
			return true
		})
	}
}

// Available returns true if the cache manager has been initialized
func Available() bool {
	return mgr != nil
}

// Get returns the global cache manager, or a no-op manager if not initialized
func Get() *Manager {
	if mgr == nil {
		return &noop
	}
	return mgr
}

// noop is a zero-value Manager used when Redis is unavailable.
// All operations on it are safe no-ops (rdb is nil, methods check for it).
var noop = Manager{}

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

	// Store in local cache with TTL
	entry := &localEntry{data: data}
	if ttl > 0 {
		entry.expiresAt = time.Now().Add(ttl)
	}
	m.localCache.Store(key, entry)

	// Store in Redis (skip if not connected)
	if m.rdb == nil {
		return nil
	}
	return m.rdb.Set(m.ctx, key, data, ttl).Err()
}

// GetJSON retrieves and deserializes a value from cache
func (m *Manager) GetJSON(key string, dest interface{}) (bool, error) {
	// Try local cache first
	if val, ok := m.localCache.Load(key); ok {
		if entry, ok := val.(*localEntry); ok {
			if !entry.isExpired() {
				atomic.AddInt64(&m.hits, 1)
				return true, json.Unmarshal(entry.data, dest)
			}
			// Expired — remove from local cache
			m.localCache.Delete(key)
		}
	}

	// Skip Redis if not connected
	if m.rdb == nil {
		atomic.AddInt64(&m.misses, 1)
		return false, nil
	}

	// Try Redis
	data, err := m.rdb.Get(m.ctx, key).Bytes()
	if err == redis.Nil {
		atomic.AddInt64(&m.misses, 1)
		return false, nil
	}
	if err != nil {
		return false, err
	}

	// Use fixed 30s local cache instead of extra TTL round trip
	entry := &localEntry{
		data:      data,
		expiresAt: time.Now().Add(30 * time.Second),
	}
	m.localCache.Store(key, entry)

	atomic.AddInt64(&m.hits, 1)

	return true, json.Unmarshal(data, dest)
}

// GetString retrieves a string value from cache
func (m *Manager) GetString(key string) (string, bool, error) {
	if m.rdb == nil {
		return "", false, nil
	}
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
	if m.rdb == nil {
		return nil
	}
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

	// Skip Redis if not connected
	if m.rdb == nil {
		return 0, nil
	}

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
	if m.rdb == nil {
		return false, nil
	}
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
	hits := atomic.LoadInt64(&m.hits)
	misses := atomic.LoadInt64(&m.misses)

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

	// Try to get Redis memory info (skip if not connected)
	if m.rdb != nil {
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
	}

	return info
}

// ========== Hash operations (for local_store replacement) ==========

// HSet sets a field in a Redis hash
func (m *Manager) HSet(key, field string, value interface{}) error {
	if m.rdb == nil {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return m.rdb.HSet(m.ctx, key, field, data).Err()
}

// HGet retrieves a field from a Redis hash
func (m *Manager) HGet(key, field string, dest interface{}) (bool, error) {
	if m.rdb == nil {
		return false, nil
	}
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
	if m.rdb == nil {
		return "", false, nil
	}
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
	if m.rdb == nil {
		return nil
	}
	return m.rdb.HDel(m.ctx, key, fields...).Err()
}

// HGetAll retrieves all fields from a Redis hash
func (m *Manager) HGetAll(key string) (map[string]string, error) {
	if m.rdb == nil {
		return map[string]string{}, nil
	}
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
	if m.rdb == nil {
		return false, nil
	}
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

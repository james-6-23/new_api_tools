package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/ketches/new-api-tools/internal/config"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

var (
	rdb *redis.Client
	ctx = context.Background()
)

// Init 初始化 Redis 连接
func Init(cfg *config.Config) error {
	// 解析连接字符串或使用分离配置
	var opt *redis.Options

	if cfg.Redis.ConnString != "" {
		// 使用连接字符串
		parsedOpt, err := redis.ParseURL(cfg.Redis.ConnString)
		if err != nil {
			return fmt.Errorf("解析 Redis 连接字符串失败: %w", err)
		}
		opt = parsedOpt
	} else {
		// 使用分离配置
		opt = &redis.Options{
			Addr:         fmt.Sprintf("%s:%d", cfg.Redis.Host, cfg.Redis.Port),
			Password:     cfg.Redis.Password,
			DB:           cfg.Redis.DB,
			PoolSize:     cfg.Redis.PoolSize,
			MinIdleConns: cfg.Redis.MinIdleConns,
		}
	}

	rdb = redis.NewClient(opt)

	// 测试连接
	if err := rdb.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("Redis 连接测试失败: %w", err)
	}

	logger.Info("Redis 连接成功",
		zap.String("addr", opt.Addr),
		zap.Int("db", opt.DB),
	)

	return nil
}

// GetClient 获取 Redis 客户端
func GetClient() *redis.Client {
	return rdb
}

// Close 关闭 Redis 连接
func Close() error {
	if rdb != nil {
		return rdb.Close()
	}
	return nil
}

// Set 设置缓存（带过期时间）
func Set(key string, value interface{}, ttl time.Duration) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("序列化缓存数据失败: %w", err)
	}

	return rdb.Set(ctx, key, data, ttl).Err()
}

// Get 获取缓存
func Get(key string, dest interface{}) error {
	data, err := rdb.Get(ctx, key).Bytes()
	if err != nil {
		if err == redis.Nil {
			return ErrCacheMiss
		}
		return fmt.Errorf("获取缓存失败: %w", err)
	}

	if err := json.Unmarshal(data, dest); err != nil {
		return fmt.Errorf("反序列化缓存数据失败: %w", err)
	}

	return nil
}

// Delete 删除缓存
func Delete(keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	return rdb.Del(ctx, keys...).Err()
}

// Exists 检查缓存是否存在
func Exists(key string) (bool, error) {
	count, err := rdb.Exists(ctx, key).Result()
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// Expire 设置过期时间
func Expire(key string, ttl time.Duration) error {
	return rdb.Expire(ctx, key, ttl).Err()
}

// TTL 获取剩余过期时间
func TTL(key string) (time.Duration, error) {
	return rdb.TTL(ctx, key).Result()
}

// Keys 获取匹配的键列表
// 注意：此函数使用 KEYS 命令，在大数据量下可能阻塞 Redis，建议使用 ScanKeys
func Keys(pattern string) ([]string, error) {
	return rdb.Keys(ctx, pattern).Result()
}

// ScanKeys 使用 SCAN 迭代获取匹配的键列表（生产环境推荐）
// 不会阻塞 Redis，适合大数据量场景
func ScanKeys(pattern string) ([]string, error) {
	var keys []string
	var cursor uint64
	var err error

	for {
		var batch []string
		batch, cursor, err = rdb.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return nil, fmt.Errorf("SCAN 获取键失败: %w", err)
		}
		keys = append(keys, batch...)
		if cursor == 0 {
			break
		}
	}

	return keys, nil
}

// DeletePattern 删除匹配模式的所有键（使用 SCAN，不阻塞 Redis）
// 返回实际删除的键数量
func DeletePattern(pattern string) (int64, error) {
	var totalDeleted int64
	var cursor uint64
	var err error

	for {
		var batch []string
		batch, cursor, err = rdb.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return totalDeleted, fmt.Errorf("SCAN 获取键失败: %w", err)
		}

		if len(batch) > 0 {
			deleted, delErr := rdb.Del(ctx, batch...).Result()
			if delErr != nil {
				return totalDeleted, fmt.Errorf("删除键失败: %w", delErr)
			}
			totalDeleted += deleted
		}

		if cursor == 0 {
			break
		}
	}

	return totalDeleted, nil
}

// Incr 自增
func Incr(key string) (int64, error) {
	return rdb.Incr(ctx, key).Result()
}

// Decr 自减
func Decr(key string) (int64, error) {
	return rdb.Decr(ctx, key).Result()
}

// IncrBy 增加指定值
func IncrBy(key string, value int64) (int64, error) {
	return rdb.IncrBy(ctx, key, value).Result()
}

// HSet 设置哈希字段
func HSet(key string, field string, value interface{}) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("序列化哈希数据失败: %w", err)
	}
	return rdb.HSet(ctx, key, field, data).Err()
}

// HGet 获取哈希字段
func HGet(key string, field string, dest interface{}) error {
	data, err := rdb.HGet(ctx, key, field).Bytes()
	if err != nil {
		if err == redis.Nil {
			return ErrCacheMiss
		}
		return fmt.Errorf("获取哈希字段失败: %w", err)
	}

	if err := json.Unmarshal(data, dest); err != nil {
		return fmt.Errorf("反序列化哈希数据失败: %w", err)
	}

	return nil
}

// HGetAll 获取所有哈希字段
func HGetAll(key string) (map[string]string, error) {
	return rdb.HGetAll(ctx, key).Result()
}

// HDel 删除哈希字段
func HDel(key string, fields ...string) error {
	return rdb.HDel(ctx, key, fields...).Err()
}

// ZAdd 添加有序集合成员
func ZAdd(key string, score float64, member interface{}) error {
	return rdb.ZAdd(ctx, key, redis.Z{
		Score:  score,
		Member: member,
	}).Err()
}

// ZRange 获取有序集合范围（按分数从小到大）
func ZRange(key string, start, stop int64) ([]string, error) {
	return rdb.ZRange(ctx, key, start, stop).Result()
}

// ZRevRange 获取有序集合范围（按分数从大到小）
func ZRevRange(key string, start, stop int64) ([]string, error) {
	return rdb.ZRevRange(ctx, key, start, stop).Result()
}

// ZRangeWithScores 获取有序集合范围（带分数）
func ZRangeWithScores(key string, start, stop int64) ([]redis.Z, error) {
	return rdb.ZRangeWithScores(ctx, key, start, stop).Result()
}

// ZRevRangeWithScores 获取有序集合范围（带分数，倒序）
func ZRevRangeWithScores(key string, start, stop int64) ([]redis.Z, error) {
	return rdb.ZRevRangeWithScores(ctx, key, start, stop).Result()
}

// ZRem 删除有序集合成员
func ZRem(key string, members ...interface{}) error {
	return rdb.ZRem(ctx, key, members...).Err()
}

// ZCard 获取有序集合成员数量
func ZCard(key string) (int64, error) {
	return rdb.ZCard(ctx, key).Result()
}

// SAdd 添加集合成员
func SAdd(key string, members ...interface{}) error {
	return rdb.SAdd(ctx, key, members...).Err()
}

// SMembers 获取集合所有成员
func SMembers(key string) ([]string, error) {
	return rdb.SMembers(ctx, key).Result()
}

// SIsMember 检查是否是集合成员
func SIsMember(key string, member interface{}) (bool, error) {
	return rdb.SIsMember(ctx, key, member).Result()
}

// SRem 删除集合成员
func SRem(key string, members ...interface{}) error {
	return rdb.SRem(ctx, key, members...).Err()
}

// FlushDB 清空当前数据库
func FlushDB() error {
	return rdb.FlushDB(ctx).Err()
}

// HealthCheck 健康检查
func HealthCheck() error {
	return rdb.Ping(ctx).Err()
}

// GetStats 获取 Redis 统计信息
func GetStats() (*redis.PoolStats, error) {
	return rdb.PoolStats(), nil
}

// CacheKey 生成缓存键
func CacheKey(parts ...string) string {
	key := "newapi"
	for _, part := range parts {
		key += ":" + part
	}
	return key
}

// 错误定义
var (
	ErrCacheMiss = fmt.Errorf("缓存未命中")
)

// CacheWrapper 缓存包装器（用于装饰器模式）
type CacheWrapper struct {
	Key string
	TTL time.Duration
}

// GetOrSet 获取缓存或执行函数并缓存结果
func (c *CacheWrapper) GetOrSet(dest interface{}, fn func() (interface{}, error)) error {
	// 尝试从缓存获取
	err := Get(c.Key, dest)
	if err == nil {
		return nil
	}

	if err != ErrCacheMiss {
		logger.Warn("获取缓存失败，将执行函数", zap.String("key", c.Key), zap.Error(err))
	}

	// 执行函数获取数据
	result, err := fn()
	if err != nil {
		return err
	}

	// 缓存结果
	if err := Set(c.Key, result, c.TTL); err != nil {
		logger.Warn("设置缓存失败", zap.String("key", c.Key), zap.Error(err))
	}

	// 将结果复制到 dest
	data, _ := json.Marshal(result)
	return json.Unmarshal(data, dest)
}

// Invalidate 使缓存失效
func (c *CacheWrapper) Invalidate() error {
	return Delete(c.Key)
}

// IsConnected 检查 Redis 是否连接
func IsConnected() bool {
	if rdb == nil {
		return false
	}
	return rdb.Ping(ctx).Err() == nil
}

// DeleteByPattern 按模式删除缓存
func DeleteByPattern(pattern string) (int64, error) {
	return DeletePattern(pattern)
}

// FlushAll 清空所有缓存
func FlushAll() (int64, error) {
	if rdb == nil {
		return 0, fmt.Errorf("Redis 未连接")
	}

	// 获取所有键数量
	keys, err := rdb.Keys(ctx, "*").Result()
	if err != nil {
		return 0, err
	}

	count := int64(len(keys))

	// 清空数据库
	if err := rdb.FlushDB(ctx).Err(); err != nil {
		return 0, err
	}

	return count, nil
}

// RedisInfo Redis 信息
type RedisInfo struct {
	KeyCount   int64
	MemoryUsed string
	HitRate    float64
	Uptime     string
}

// GetInfo 获取 Redis 信息
func GetInfo() (*RedisInfo, error) {
	if rdb == nil {
		return nil, fmt.Errorf("Redis 未连接")
	}

	info := &RedisInfo{}

	// 获取键数量
	dbSize, err := rdb.DBSize(ctx).Result()
	if err == nil {
		info.KeyCount = dbSize
	}

	// 获取内存使用
	memInfo, err := rdb.Info(ctx, "memory").Result()
	if err == nil {
		// 简单解析
		info.MemoryUsed = parseRedisInfoValue(memInfo, "used_memory_human")
	}

	// 获取命中率
	statsInfo, err := rdb.Info(ctx, "stats").Result()
	if err == nil {
		hits := parseRedisInfoInt(statsInfo, "keyspace_hits")
		misses := parseRedisInfoInt(statsInfo, "keyspace_misses")
		if hits+misses > 0 {
			info.HitRate = float64(hits) / float64(hits+misses) * 100
		}
	}

	// 获取运行时间
	serverInfo, err := rdb.Info(ctx, "server").Result()
	if err == nil {
		uptimeSecs := parseRedisInfoInt(serverInfo, "uptime_in_seconds")
		info.Uptime = formatUptime(uptimeSecs)
	}

	return info, nil
}

// parseRedisInfoValue 解析 Redis INFO 输出中的值
func parseRedisInfoValue(info, key string) string {
	lines := splitLines(info)
	for _, line := range lines {
		if len(line) > len(key)+1 && line[:len(key)] == key && line[len(key)] == ':' {
			return line[len(key)+1:]
		}
	}
	return "N/A"
}

// parseRedisInfoInt 解析 Redis INFO 输出中的整数值
func parseRedisInfoInt(info, key string) int64 {
	value := parseRedisInfoValue(info, key)
	if value == "N/A" {
		return 0
	}

	var result int64
	for _, c := range value {
		if c >= '0' && c <= '9' {
			result = result*10 + int64(c-'0')
		} else {
			break
		}
	}
	return result
}

// splitLines 分割行
func splitLines(s string) []string {
	var lines []string
	var line []byte
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			lines = append(lines, string(line))
			line = nil
		} else {
			line = append(line, s[i])
		}
	}
	if len(line) > 0 {
		lines = append(lines, string(line))
	}
	return lines
}

// formatUptime 格式化运行时间
func formatUptime(seconds int64) string {
	days := seconds / 86400
	hours := (seconds % 86400) / 3600
	minutes := (seconds % 3600) / 60

	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm", days, hours, minutes)
	} else if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, minutes)
	}
	return fmt.Sprintf("%dm", minutes)
}

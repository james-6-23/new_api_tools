package cache

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/logger"
	"go.uber.org/zap"
)

// SlotConfig 时间槽配置
type SlotConfig struct {
	SlotSize  int64 // 槽大小（秒）
	SlotCount int   // 槽数量
	TTL       int64 // 缓存过期时间（秒）
}

// 时间槽配置：只对 3d、7d、14d 使用增量缓存
var slotConfigs = map[string]SlotConfig{
	"3d": {
		SlotSize:  6 * 3600,      // 6 小时一个槽
		SlotCount: 12,            // 12 个槽
		TTL:       7 * 24 * 3600, // 槽缓存 7 天过期
	},
	"7d": {
		SlotSize:  12 * 3600,      // 12 小时一个槽
		SlotCount: 14,             // 14 个槽
		TTL:       14 * 24 * 3600, // 槽缓存 14 天过期
	},
	"14d": {
		SlotSize:  24 * 3600,      // 24 小时一个槽
		SlotCount: 14,             // 14 个槽
		TTL:       21 * 24 * 3600, // 槽缓存 21 天过期
	},
}

// IncrementalPeriods 支持增量缓存的周期
var IncrementalPeriods = map[string]bool{
	"3d":  true,
	"7d":  true,
	"14d": true,
}

// SlotData 槽数据
type SlotData struct {
	SlotKey   string      `json:"slot_key"`
	Window    string      `json:"window"`
	SortBy    string      `json:"sort_by"`
	SlotStart int64       `json:"slot_start"`
	SlotEnd   int64       `json:"slot_end"`
	Data      interface{} `json:"data"`
	CreatedAt int64       `json:"created_at"`
	ExpiresAt int64       `json:"expires_at"`
}

// IsIncrementalWindow 检查是否是增量缓存窗口
func IsIncrementalWindow(window string) bool {
	return IncrementalPeriods[window]
}

// GetSlotConfig 获取槽配置
func GetSlotConfig(window string) *SlotConfig {
	if cfg, ok := slotConfigs[window]; ok {
		return &cfg
	}
	return nil
}

// CalculateSlots 计算时间槽列表
func CalculateSlots(window string) []SlotInfo {
	cfg := GetSlotConfig(window)
	if cfg == nil {
		return nil
	}

	now := time.Now().Unix()
	slots := make([]SlotInfo, cfg.SlotCount)

	// 计算当前槽的开始时间（向下取整到槽边界）
	currentSlotStart := (now / cfg.SlotSize) * cfg.SlotSize

	for i := 0; i < cfg.SlotCount; i++ {
		slotStart := currentSlotStart - int64(i)*cfg.SlotSize
		slotEnd := slotStart + cfg.SlotSize
		slots[cfg.SlotCount-1-i] = SlotInfo{
			Start: slotStart,
			End:   slotEnd,
			Index: cfg.SlotCount - 1 - i,
		}
	}

	return slots
}

// SlotInfo 槽信息
type SlotInfo struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
	Index int   `json:"index"`
}

// SetSlotCache 设置槽缓存
func (m *CacheManager) SetSlotCache(window, sortBy string, slotStart, slotEnd int64, data interface{}) error {
	cfg := GetSlotConfig(window)
	if cfg == nil {
		return fmt.Errorf("不支持的增量缓存窗口: %s", window)
	}

	slotKey := fmt.Sprintf("%s:%s:%d", window, sortBy, slotStart)
	now := time.Now().Unix()
	expiresAt := now + cfg.TTL

	// L1: Redis
	if m.redisAvailable {
		redisKey := CacheKey("slot", slotKey)
		slotData := &SlotData{
			SlotKey:   slotKey,
			Window:    window,
			SortBy:    sortBy,
			SlotStart: slotStart,
			SlotEnd:   slotEnd,
			Data:      data,
			CreatedAt: now,
			ExpiresAt: expiresAt,
		}
		Set(redisKey, slotData, time.Duration(cfg.TTL)*time.Second)
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

	engine := database.GetLocalDBEngine()
	sql := database.UpsertSQL("slot_cache", "slot_key",
		[]string{"slot_key", "window", "sort_by", "slot_start", "slot_end", "data", "created_at", "expires_at"},
		[]string{"data", "created_at", "expires_at"}, engine)
	return db.Exec(sql, slotKey, window, sortBy, slotStart, slotEnd, string(jsonData), now, expiresAt).Error
}

// GetSlotCache 获取槽缓存
func (m *CacheManager) GetSlotCache(window, sortBy string, slotStart int64, dest interface{}) error {
	slotKey := fmt.Sprintf("%s:%s:%d", window, sortBy, slotStart)

	// L1: Redis
	if m.redisAvailable {
		redisKey := CacheKey("slot", slotKey)
		var slotData SlotData
		if err := Get(redisKey, &slotData); err == nil {
			// 将 Data 字段复制到 dest
			dataBytes, _ := json.Marshal(slotData.Data)
			return json.Unmarshal(dataBytes, dest)
		}
	}

	// L2: SQLite
	db := database.GetLocalDB()
	if db == nil {
		return ErrCacheMiss
	}

	var data string
	err := db.Raw(`
		SELECT data FROM slot_cache
		WHERE slot_key = ? AND expires_at > ?
	`, slotKey, time.Now().Unix()).Row().Scan(&data)

	if err != nil {
		return ErrCacheMiss
	}

	return json.Unmarshal([]byte(data), dest)
}

// GetMissingSlots 获取缺失的槽列表
func (m *CacheManager) GetMissingSlots(window, sortBy string) []SlotInfo {
	slots := CalculateSlots(window)
	if slots == nil {
		return nil
	}

	missing := make([]SlotInfo, 0)
	for _, slot := range slots {
		var dummy interface{}
		if err := m.GetSlotCache(window, sortBy, slot.Start, &dummy); err != nil {
			missing = append(missing, slot)
		}
	}

	return missing
}

// GetCachedSlots 获取已缓存的槽列表
func (m *CacheManager) GetCachedSlots(window, sortBy string) []SlotInfo {
	slots := CalculateSlots(window)
	if slots == nil {
		return nil
	}

	cached := make([]SlotInfo, 0)
	for _, slot := range slots {
		var dummy interface{}
		if err := m.GetSlotCache(window, sortBy, slot.Start, &dummy); err == nil {
			cached = append(cached, slot)
		}
	}

	return cached
}

// AggregateSlotData 聚合槽数据
// aggregator 函数用于合并多个槽的数据
func (m *CacheManager) AggregateSlotData(window, sortBy string, aggregator func([]interface{}) interface{}) (interface{}, error) {
	slots := CalculateSlots(window)
	if slots == nil {
		return nil, fmt.Errorf("不支持的增量缓存窗口: %s", window)
	}

	allData := make([]interface{}, 0, len(slots))
	for _, slot := range slots {
		var data interface{}
		if err := m.GetSlotCache(window, sortBy, slot.Start, &data); err == nil {
			allData = append(allData, data)
		}
	}

	if len(allData) == 0 {
		return nil, ErrCacheMiss
	}

	return aggregator(allData), nil
}

// ClearSlotCache 清除指定窗口的槽缓存
func (m *CacheManager) ClearSlotCache(window, sortBy string) error {
	// L1: Redis
	if m.redisAvailable {
		pattern := CacheKey("slot", fmt.Sprintf("%s:%s:*", window, sortBy))
		_, _ = DeletePattern(pattern) // 忽略返回值，清除失败不影响后续操作
	}

	// L2: SQLite
	db := database.GetLocalDB()
	if db == nil {
		return nil
	}

	return db.Exec("DELETE FROM slot_cache WHERE window = ? AND sort_by = ?", window, sortBy).Error
}

// GetSlotCacheStats 获取槽缓存统计
func (m *CacheManager) GetSlotCacheStats() map[string]interface{} {
	stats := make(map[string]interface{})

	for window := range slotConfigs {
		windowStats := make(map[string]interface{})
		slots := CalculateSlots(window)

		// 统计各种排序方式的缓存情况
		sortTypes := []string{"requests", "quota", "failure_rate"}
		for _, sortBy := range sortTypes {
			cached := m.GetCachedSlots(window, sortBy)
			windowStats[sortBy] = map[string]interface{}{
				"total":  len(slots),
				"cached": len(cached),
				"rate":   float64(len(cached)) / float64(len(slots)) * 100,
			}
		}

		stats[window] = windowStats
	}

	return stats
}

// WarmupSlotCache 预热槽缓存
// fetchSlotData 函数用于获取单个槽的数据
func (m *CacheManager) WarmupSlotCache(window, sortBy string, fetchSlotData func(start, end int64) (interface{}, error)) error {
	missing := m.GetMissingSlots(window, sortBy)
	if len(missing) == 0 {
		logger.Debug("槽缓存已完整，无需预热",
			zap.String("window", window),
			zap.String("sortBy", sortBy))
		return nil
	}

	logger.Info("开始预热槽缓存",
		zap.String("window", window),
		zap.String("sortBy", sortBy),
		zap.Int("missing", len(missing)))

	for _, slot := range missing {
		data, err := fetchSlotData(slot.Start, slot.End)
		if err != nil {
			logger.Warn("获取槽数据失败",
				zap.String("window", window),
				zap.Int64("slotStart", slot.Start),
				zap.Error(err))
			continue
		}

		if err := m.SetSlotCache(window, sortBy, slot.Start, slot.End, data); err != nil {
			logger.Warn("设置槽缓存失败",
				zap.String("window", window),
				zap.Int64("slotStart", slot.Start),
				zap.Error(err))
		}
	}

	logger.Info("槽缓存预热完成",
		zap.String("window", window),
		zap.String("sortBy", sortBy))

	return nil
}

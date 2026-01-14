package service

import (
	cryptoRand "crypto/rand"
	"encoding/hex"
	"fmt"
	"math/rand"
	"strings"
	"sync/atomic"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/models"
)

// 全局计数器，用于结构化 key 生成
var keyCounter uint64

// RedemptionService 兑换码服务
type RedemptionService struct{}

// NewRedemptionService 创建兑换码服务
func NewRedemptionService() *RedemptionService {
	return &RedemptionService{}
}

// RedemptionRecord 兑换码记录
type RedemptionRecord struct {
	ID           int    `json:"id"`
	Name         string `json:"name"`
	Key          string `json:"key"`
	Quota        int64  `json:"quota"`
	Count        int    `json:"count"`
	UsedCount    int    `json:"used_count"`
	Status       string `json:"status"` // unused, used, expired
	RedeemedBy   int    `json:"redeemed_by"`
	RedeemerName string `json:"redeemer_name"`
	CreatedAt    string `json:"created_at"`
	RedeemedAt   string `json:"redeemed_at"`
}

// RedemptionStatistics 兑换码统计
type RedemptionStatistics struct {
	TotalCount  int64   `json:"total_count"`
	UsedCount   int64   `json:"used_count"`
	UnusedCount int64   `json:"unused_count"`
	TotalQuota  int64   `json:"total_quota"`
	UsedQuota   int64   `json:"used_quota"`
	UsageRate   float64 `json:"usage_rate"`
	TodayUsed   int64   `json:"today_used"`
	TodayQuota  int64   `json:"today_quota"`
}

// RedemptionQuery 兑换码查询参数
type RedemptionQuery struct {
	Page      int    `form:"page"`
	PageSize  int    `form:"page_size"`
	Key       string `form:"key"`
	Name      string `form:"name"`
	Status    int    `form:"status"`
	StartDate string `form:"start_date"`
	EndDate   string `form:"end_date"`
}

// RedemptionListResult 兑换码列表结果
type RedemptionListResult struct {
	Total      int64              `json:"total"`
	Page       int                `json:"page"`
	PageSize   int                `json:"page_size"`
	TotalPages int                `json:"total_pages"`
	Items      []RedemptionRecord `json:"items"`
}

// GenerateConfig 生成配置
type GenerateConfig struct {
	Count  int    `json:"count"`
	Quota  int64  `json:"quota"`
	Prefix string `json:"prefix"`
	Name   string `json:"name"`

	// 额度模式: fixed (固定) / random (随机)
	QuotaType string `json:"quota_type"`
	QuotaMin  int64  `json:"quota_min"` // 随机模式最小值
	QuotaMax  int64  `json:"quota_max"` // 随机模式最大值

	// 过期模式: never (永不) / days (N天后) / date (指定日期)
	ExpireMode string `json:"expire_mode"`
	ExpireDays int    `json:"expire_days"` // days 模式的天数
	ExpireDate string `json:"expire_date"` // date 模式的日期 (YYYY-MM-DD)
	ExpireTime string `json:"expire_time"` // date 模式的时间 (HH:MM:SS，可选)
}

// GetRedemptions 获取兑换码列表
func (s *RedemptionService) GetRedemptions(query *RedemptionQuery) (*RedemptionListResult, error) {
	db := database.GetMainDB()

	// 默认分页
	if query.Page <= 0 {
		query.Page = 1
	}
	if query.PageSize <= 0 {
		query.PageSize = 20
	}

	// 构建查询
	// 注意：数据库中使用者 ID 字段名为 used_user_id（与 Python 版本一致）
	tx := db.Table("redemptions").
		Select("redemptions.*, users.username as redeemer_name").
		Joins("LEFT JOIN users ON redemptions.used_user_id = users.id")

	// 应用过滤条件
	if query.Key != "" {
		tx = tx.Where("redemptions.key LIKE ?", "%"+query.Key+"%")
	}
	if query.Name != "" {
		tx = tx.Where("redemptions.name LIKE ?", "%"+query.Name+"%")
	}
	if query.Status > 0 {
		tx = tx.Where("redemptions.status = ?", query.Status)
	}
	if query.StartDate != "" {
		if t, err := time.ParseInLocation("2006-01-02", query.StartDate, time.Local); err == nil {
			tx = tx.Where("redemptions.created_time >= ?", t.Unix())
		}
	}
	if query.EndDate != "" {
		if t, err := time.ParseInLocation("2006-01-02", query.EndDate, time.Local); err == nil {
			// 当天 23:59:59
			endTime := time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 0, time.Local)
			tx = tx.Where("redemptions.created_time <= ?", endTime.Unix())
		}
	}

	// 获取总数
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, err
	}

	// 分页查询
	offset := (query.Page - 1) * query.PageSize
	var results []struct {
		models.Redemption
		RedeemerName string
	}

	if err := tx.Order("redemptions.created_time DESC").
		Offset(offset).
		Limit(query.PageSize).
		Scan(&results).Error; err != nil {
		return nil, err
	}

	// 转换为返回格式
	records := make([]RedemptionRecord, len(results))
	for i, r := range results {
		records[i] = RedemptionRecord{
			ID:           r.ID,
			Name:         r.Name,
			Key:          maskKey(r.Key),
			Quota:        r.Quota,
			Count:        r.Count,
			Status:       mapRedemptionStatus(r.Status, r.ExpiredTime),
			RedeemedBy:   r.UsedUserID,
			RedeemerName: r.RedeemerName,
		}
		if r.CreatedTime > 0 {
			records[i].CreatedAt = time.Unix(r.CreatedTime, 0).Format("2006-01-02 15:04:05")
		}
		if r.RedeemedTime > 0 {
			records[i].RedeemedAt = time.Unix(r.RedeemedTime, 0).Format("2006-01-02 15:04:05")
		}
	}

	// 计算总页数
	totalPages := int((total + int64(query.PageSize) - 1) / int64(query.PageSize))

	return &RedemptionListResult{
		Total:      total,
		Page:       query.Page,
		PageSize:   query.PageSize,
		TotalPages: totalPages,
		Items:      records,
	}, nil
}

// GetRedemptionStatistics 获取兑换码统计
func (s *RedemptionService) GetRedemptionStatistics() (*RedemptionStatistics, error) {
	cacheKey := cache.CacheKey("redemption", "statistics")

	var data RedemptionStatistics
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 5 * time.Minute,
	}

	err := wrapper.GetOrSet(&data, func() (interface{}, error) {
		return s.fetchRedemptionStatistics()
	})

	return &data, err
}

// fetchRedemptionStatistics 获取兑换码统计数据
func (s *RedemptionService) fetchRedemptionStatistics() (*RedemptionStatistics, error) {
	db := database.GetMainDB()
	data := &RedemptionStatistics{}

	// 总数
	db.Model(&models.Redemption{}).Count(&data.TotalCount)

	// 已使用数（状态 = 3 表示已使用）
	db.Model(&models.Redemption{}).
		Where("status = ?", models.RedemptionStatusUsed).
		Count(&data.UsedCount)

	// 未使用数
	db.Model(&models.Redemption{}).
		Where("status = ?", models.RedemptionStatusEnabled).
		Count(&data.UnusedCount)

	// 总额度
	db.Model(&models.Redemption{}).
		Select("COALESCE(SUM(quota), 0)").
		Scan(&data.TotalQuota)

	// 已使用额度
	db.Model(&models.Redemption{}).
		Where("status = ?", models.RedemptionStatusUsed).
		Select("COALESCE(SUM(quota), 0)").
		Scan(&data.UsedQuota)

	// 使用率
	if data.TotalCount > 0 {
		data.UsageRate = float64(data.UsedCount) / float64(data.TotalCount) * 100
	}

	// 今日统计
	todayStart := time.Date(time.Now().Year(), time.Now().Month(), time.Now().Day(), 0, 0, 0, 0, time.Local).Unix()

	db.Model(&models.Redemption{}).
		Where("status = ? AND redeemed_time >= ?", models.RedemptionStatusUsed, todayStart).
		Count(&data.TodayUsed)

	db.Model(&models.Redemption{}).
		Where("status = ? AND redeemed_time >= ?", models.RedemptionStatusUsed, todayStart).
		Select("COALESCE(SUM(quota), 0)").
		Scan(&data.TodayQuota)

	return data, nil
}

// GenerateRedemptions 批量生成兑换码
func (s *RedemptionService) GenerateRedemptions(config *GenerateConfig) ([]string, error) {
	db := database.GetMainDB()

	if config.Count <= 0 || config.Count > 1000 {
		return nil, fmt.Errorf("生成数量必须在 1-1000 之间")
	}

	// 验证额度配置
	if config.QuotaType == "random" {
		if config.QuotaMin <= 0 || config.QuotaMax <= 0 {
			return nil, fmt.Errorf("随机模式下最小和最大额度必须大于 0")
		}
		if config.QuotaMin > config.QuotaMax {
			return nil, fmt.Errorf("最小额度不能大于最大额度")
		}
	} else if config.Quota <= 0 {
		return nil, fmt.Errorf("固定额度必须大于 0")
	}

	keys := make([]string, config.Count)
	redemptions := make([]models.Redemption, config.Count)
	now := time.Now()

	// 计算过期时间（如果有）
	var expiredTime int64
	if exp := calculateExpiration(config); exp != nil {
		expiredTime = exp.Unix()
	}

	for i := 0; i < config.Count; i++ {
		key := generateStructuredKey(config.Prefix)
		keys[i] = key

		name := config.Name
		if name == "" {
			name = fmt.Sprintf("兑换码-%s", time.Now().Format("20060102"))
		}

		// 计算额度
		quota := calculateQuota(config)

		redemptions[i] = models.Redemption{
			Name:        name,
			Key:         key,
			Quota:       quota,
			Count:       1,
			Status:      models.RedemptionStatusEnabled,
			CreatedTime: now.Unix(),
			ExpiredTime: expiredTime,
		}
	}

	// 批量插入
	if err := db.CreateInBatches(redemptions, 100).Error; err != nil {
		return nil, fmt.Errorf("生成兑换码失败: %v", err)
	}

	return keys, nil
}

// DeleteRedemption 删除兑换码
func (s *RedemptionService) DeleteRedemption(id int) error {
	db := database.GetMainDB()

	result := db.Delete(&models.Redemption{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("兑换码不存在")
	}

	return nil
}

// BatchDeleteRedemptions 批量删除兑换码
func (s *RedemptionService) BatchDeleteRedemptions(ids []int) (int64, error) {
	db := database.GetMainDB()

	result := db.Delete(&models.Redemption{}, ids)
	if result.Error != nil {
		return 0, result.Error
	}

	return result.RowsAffected, nil
}

// generateStructuredKey 生成结构化兑换码 key (32 位)
// 格式: [前缀-]随机串 + 时间戳后6位 + 计数器3位
func generateStructuredKey(prefix string) string {
	// 生成随机部分 (16 字节 = 32 个 hex 字符)
	randomBytes := make([]byte, 16)
	cryptoRand.Read(randomBytes)
	randomPart := hex.EncodeToString(randomBytes)

	// 获取时间戳后 6 位
	timestamp := time.Now().UnixNano() / 1000000 // 毫秒
	timePart := fmt.Sprintf("%06d", timestamp%1000000)

	// 递增计数器
	counter := atomic.AddUint64(&keyCounter, 1)
	counterPart := fmt.Sprintf("%03d", counter%1000)

	// 组合: 取随机部分前 23 位 + 时间 6 位 + 计数 3 位 = 32 位
	key := randomPart[:23] + timePart + counterPart

	if prefix != "" {
		// 带前缀时，前缀 + "-" + 剩余部分，总长仍为合理长度
		maxKeyLen := 32 - len(prefix) - 1
		if maxKeyLen < 16 {
			maxKeyLen = 16
		}
		if len(key) > maxKeyLen {
			key = key[:maxKeyLen]
		}
		return strings.ToUpper(prefix + "-" + key)
	}

	return strings.ToUpper(key)
}

// calculateQuota 计算额度（固定或随机）
func calculateQuota(config *GenerateConfig) int64 {
	if config.QuotaType == "random" {
		// 随机生成 [min, max] 范围内的额度
		rangeSize := config.QuotaMax - config.QuotaMin + 1
		return config.QuotaMin + rand.Int63n(rangeSize)
	}
	return config.Quota
}

// calculateExpiration 计算过期时间
func calculateExpiration(config *GenerateConfig) *time.Time {
	switch config.ExpireMode {
	case "never", "":
		// 永不过期
		return nil
	case "days":
		// N 天后过期
		if config.ExpireDays <= 0 {
			return nil
		}
		expireTime := time.Now().AddDate(0, 0, config.ExpireDays)
		// 设置为当天 23:59:59
		expireTime = time.Date(
			expireTime.Year(), expireTime.Month(), expireTime.Day(),
			23, 59, 59, 0, expireTime.Location(),
		)
		return &expireTime
	case "date":
		// 指定日期过期
		if config.ExpireDate == "" {
			return nil
		}

		// 解析日期
		var expireTime time.Time
		var err error

		if config.ExpireTime != "" {
			// 日期 + 时间
			expireTime, err = time.ParseInLocation(
				"2006-01-02 15:04:05",
				config.ExpireDate+" "+config.ExpireTime,
				time.Local,
			)
		} else {
			// 仅日期，默认 23:59:59
			expireTime, err = time.ParseInLocation(
				"2006-01-02",
				config.ExpireDate,
				time.Local,
			)
			if err == nil {
				expireTime = time.Date(
					expireTime.Year(), expireTime.Month(), expireTime.Day(),
					23, 59, 59, 0, expireTime.Location(),
				)
			}
		}

		if err != nil {
			return nil
		}
		return &expireTime
	default:
		return nil
	}
}

// mapRedemptionStatus 将数字状态映射为字符串状态
func mapRedemptionStatus(status int, expiredTime int64) string {
	// 已使用状态优先
	if status == models.RedemptionStatusUsed {
		return "used"
	}
	// 检查是否已过期
	if expiredTime > 0 && expiredTime < time.Now().Unix() {
		return "expired"
	}
	// 默认未使用
	return "unused"
}

// maskKey 隐藏部分 key
func maskKey(key string) string {
	if len(key) <= 8 {
		return key
	}
	return key[:4] + "****" + key[len(key)-4:]
}

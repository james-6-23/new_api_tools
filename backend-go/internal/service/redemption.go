package service

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/models"
)

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
	Status       int    `json:"status"`
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
	tx := db.Table("redemptions").
		Select("redemptions.*, users.username as redeemer_name").
		Joins("LEFT JOIN users ON redemptions.redeemed_user_id = users.id")

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
		tx = tx.Where("redemptions.created_at >= ?", query.StartDate)
	}
	if query.EndDate != "" {
		tx = tx.Where("redemptions.created_at <= ?", query.EndDate+" 23:59:59")
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

	if err := tx.Order("redemptions.created_at DESC").
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
			Key:          maskKey(r.Key), // 部分隐藏
			Quota:        r.Quota,
			Count:        1, // 单次使用兑换码
			Status:       r.Status,
			RedeemedBy:   r.RedeemedBy,
			RedeemerName: r.RedeemerName,
		}
		records[i].CreatedAt = r.CreatedAt.Format("2006-01-02 15:04:05")
		if r.RedeemedAt != nil {
			records[i].RedeemedAt = r.RedeemedAt.Format("2006-01-02 15:04:05")
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
	today := time.Now().Format("2006-01-02") + " 00:00:00"

	db.Model(&models.Redemption{}).
		Where("status = ? AND redeemed_time >= ?", models.RedemptionStatusUsed, today).
		Count(&data.TodayUsed)

	db.Model(&models.Redemption{}).
		Where("status = ? AND redeemed_time >= ?", models.RedemptionStatusUsed, today).
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
	if config.Quota <= 0 {
		return nil, fmt.Errorf("额度必须大于 0")
	}

	keys := make([]string, config.Count)
	redemptions := make([]models.Redemption, config.Count)
	now := time.Now()

	for i := 0; i < config.Count; i++ {
		key := generateRedemptionKey(config.Prefix)
		keys[i] = key

		name := config.Name
		if name == "" {
			name = fmt.Sprintf("兑换码-%s", time.Now().Format("20060102"))
		}

		redemptions[i] = models.Redemption{
			Name:      name,
			Key:       key,
			Quota:     config.Quota,
			Status:    models.RedemptionStatusEnabled,
			CreatedAt: now,
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

// generateRedemptionKey 生成兑换码 key
func generateRedemptionKey(prefix string) string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	key := hex.EncodeToString(bytes)

	if prefix != "" {
		return strings.ToUpper(prefix + "-" + key[:16])
	}
	return strings.ToUpper(key)
}

// maskKey 隐藏部分 key
func maskKey(key string) string {
	if len(key) <= 8 {
		return key
	}
	return key[:4] + "****" + key[len(key)-4:]
}

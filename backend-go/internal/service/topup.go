package service

import (
	"fmt"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/models"
)

// TopUpService 充值服务
type TopUpService struct{}

// NewTopUpService 创建充值服务
func NewTopUpService() *TopUpService {
	return &TopUpService{}
}

// TopUpRecord 充值记录
type TopUpRecord struct {
	ID            int     `json:"id"`
	UserID        int     `json:"user_id"`
	Username      string  `json:"username"`
	Amount        int64   `json:"amount"`
	Money         float64 `json:"money"`
	TradeNo       string  `json:"trade_no"`
	PaymentMethod string  `json:"payment_method"`
	Status        int     `json:"status"`
	CreatedAt     string  `json:"created_at"`
}

// TopUpStatistics 充值统计
type TopUpStatistics struct {
	TotalCount       int64            `json:"total_count"`
	TotalAmount      int64            `json:"total_amount"`
	TotalMoney       float64          `json:"total_money"`
	TodayCount       int64            `json:"today_count"`
	TodayAmount      int64            `json:"today_amount"`
	TodayMoney       float64          `json:"today_money"`
	AvgAmount        float64          `json:"avg_amount"`
	SuccessRate      float64          `json:"success_rate"`
	PaymentMethodMap map[string]int64 `json:"payment_methods"`
}

// TopUpQuery 充值查询参数
type TopUpQuery struct {
	Page          int    `form:"page"`
	PageSize      int    `form:"page_size"`
	UserID        int    `form:"user_id"`
	Username      string `form:"username"`
	TradeNo       string `form:"trade_no"`
	PaymentMethod string `form:"payment_method"`
	Status        int    `form:"status"`
	StartDate     string `form:"start_date"`
	EndDate       string `form:"end_date"`
}

// TopUpListResult 充值列表结果
type TopUpListResult struct {
	Total    int64         `json:"total"`
	Page     int           `json:"page"`
	PageSize int           `json:"page_size"`
	Records  []TopUpRecord `json:"records"`
}

// GetTopUps 获取充值记录列表
func (s *TopUpService) GetTopUps(query *TopUpQuery) (*TopUpListResult, error) {
	db := database.GetMainDB()

	// 默认分页
	if query.Page <= 0 {
		query.Page = 1
	}
	if query.PageSize <= 0 {
		query.PageSize = 20
	}

	// 构建查询
	tx := db.Table("top_ups").
		Select("top_ups.*, users.username").
		Joins("LEFT JOIN users ON top_ups.user_id = users.id")

	// 应用过滤条件
	if query.UserID > 0 {
		tx = tx.Where("top_ups.user_id = ?", query.UserID)
	}
	if query.Username != "" {
		tx = tx.Where("users.username LIKE ?", "%"+query.Username+"%")
	}
	if query.TradeNo != "" {
		tx = tx.Where("top_ups.trade_no = ?", query.TradeNo)
	}
	if query.PaymentMethod != "" {
		tx = tx.Where("top_ups.payment_method = ?", query.PaymentMethod)
	}
	if query.Status > 0 {
		tx = tx.Where("top_ups.status = ?", query.Status)
	}
	if query.StartDate != "" {
		tx = tx.Where("top_ups.created_at >= ?", query.StartDate)
	}
	if query.EndDate != "" {
		tx = tx.Where("top_ups.created_at <= ?", query.EndDate+" 23:59:59")
	}

	// 获取总数
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, err
	}

	// 分页查询
	offset := (query.Page - 1) * query.PageSize
	var results []struct {
		models.TopUp
		Username string
	}

	if err := tx.Order("top_ups.created_at DESC").
		Offset(offset).
		Limit(query.PageSize).
		Scan(&results).Error; err != nil {
		return nil, err
	}

	// 转换为返回格式
	records := make([]TopUpRecord, len(results))
	for i, r := range results {
		records[i] = TopUpRecord{
			ID:            r.ID,
			UserID:        r.UserID,
			Username:      r.Username,
			Amount:        r.Amount,
			Money:         float64(r.Amount) / 500000, // 额度转换为金额
			TradeNo:       r.TradeNo,
			PaymentMethod: r.Method,
			Status:        r.Status,
		}
		records[i].CreatedAt = r.CreatedAt.Format("2006-01-02 15:04:05")
	}

	return &TopUpListResult{
		Total:    total,
		Page:     query.Page,
		PageSize: query.PageSize,
		Records:  records,
	}, nil
}

// GetTopUpStatistics 获取充值统计
func (s *TopUpService) GetTopUpStatistics() (*TopUpStatistics, error) {
	cacheKey := cache.CacheKey("topup", "statistics")

	var data TopUpStatistics
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 5 * time.Minute,
	}

	err := wrapper.GetOrSet(&data, func() (interface{}, error) {
		return s.fetchTopUpStatistics()
	})

	return &data, err
}

// fetchTopUpStatistics 获取充值统计数据
func (s *TopUpService) fetchTopUpStatistics() (*TopUpStatistics, error) {
	db := database.GetMainDB()
	data := &TopUpStatistics{
		PaymentMethodMap: make(map[string]int64),
	}

	// 成功状态
	successStatus := 3 // 假设 3 是成功状态

	// 总统计
	db.Model(&models.TopUp{}).
		Where("status = ?", successStatus).
		Count(&data.TotalCount)

	db.Model(&models.TopUp{}).
		Where("status = ?", successStatus).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&data.TotalAmount)

	db.Model(&models.TopUp{}).
		Where("status = ?", successStatus).
		Select("COALESCE(SUM(money), 0)").
		Scan(&data.TotalMoney)

	// 今日统计
	today := time.Now().Format("2006-01-02") + " 00:00:00"

	db.Model(&models.TopUp{}).
		Where("status = ? AND created_at >= ?", successStatus, today).
		Count(&data.TodayCount)

	db.Model(&models.TopUp{}).
		Where("status = ? AND created_at >= ?", successStatus, today).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&data.TodayAmount)

	db.Model(&models.TopUp{}).
		Where("status = ? AND created_at >= ?", successStatus, today).
		Select("COALESCE(SUM(money), 0)").
		Scan(&data.TodayMoney)

	// 平均额度
	if data.TotalCount > 0 {
		data.AvgAmount = float64(data.TotalAmount) / float64(data.TotalCount)
	}

	// 成功率
	var allCount int64
	db.Model(&models.TopUp{}).Count(&allCount)
	if allCount > 0 {
		data.SuccessRate = float64(data.TotalCount) / float64(allCount) * 100
	}

	return data, nil
}

// GetPaymentMethods 获取支付方式统计
func (s *TopUpService) GetPaymentMethods() ([]map[string]interface{}, error) {
	db := database.GetMainDB()

	var results []struct {
		PaymentMethod string
		Count         int64
		TotalAmount   int64
		TotalMoney    float64
	}

	// 注意：这里假设 top_ups 表有 payment_method 字段
	// 如果没有，需要根据实际表结构调整
	err := db.Table("top_ups").
		Select("'' as payment_method, COUNT(*) as count, COALESCE(SUM(amount), 0) as total_amount, COALESCE(SUM(money), 0) as total_money").
		Where("status = ?", 3).
		Group("payment_method").
		Scan(&results).Error

	if err != nil {
		return nil, err
	}

	data := make([]map[string]interface{}, len(results))
	for i, r := range results {
		method := r.PaymentMethod
		if method == "" {
			method = "unknown"
		}
		data[i] = map[string]interface{}{
			"method":       method,
			"count":        r.Count,
			"total_amount": r.TotalAmount,
			"total_money":  r.TotalMoney,
		}
	}

	return data, nil
}

// RefundTopUp 退款
func (s *TopUpService) RefundTopUp(topUpID int) error {
	db := database.GetMainDB()

	// 开始事务
	tx := db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 查找充值记录
	var topUp models.TopUp
	if err := tx.First(&topUp, topUpID).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("充值记录不存在")
	}

	// 检查状态
	if topUp.Status != 3 {
		tx.Rollback()
		return fmt.Errorf("只能退款成功的充值记录")
	}

	// 扣除用户额度
	if err := tx.Model(&models.User{}).
		Where("id = ?", topUp.UserID).
		Update("quota", database.GetMainDB().Raw("quota - ?", topUp.Amount)).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("扣除额度失败: %v", err)
	}

	// 更新充值记录状态
	if err := tx.Model(&topUp).Update("status", 4).Error; err != nil { // 4 = 已退款
		tx.Rollback()
		return fmt.Errorf("更新充值状态失败: %v", err)
	}

	return tx.Commit().Error
}

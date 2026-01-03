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
	Status        string  `json:"status"`
	CreateTime    int64   `json:"create_time"`
	CompleteTime  int64   `json:"complete_time"`
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
	Status        string `form:"status"`
	StartDate     string `form:"start_date"`
	EndDate       string `form:"end_date"`
}

// TopUpListResult 充值列表结果
type TopUpListResult struct {
	Total      int64         `json:"total"`
	Page       int           `json:"page"`
	PageSize   int           `json:"page_size"`
	TotalPages int           `json:"total_pages"`
	Items      []TopUpRecord `json:"items"`
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
	if query.Status != "" {
		tx = tx.Where("LOWER(top_ups.status) = LOWER(?)", query.Status)
	}
	if query.StartDate != "" {
		// 将日期转换为 Unix 时间戳
		startTime, err := time.Parse("2006-01-02", query.StartDate)
		if err == nil {
			tx = tx.Where("top_ups.create_time >= ?", startTime.Unix())
		}
	}
	if query.EndDate != "" {
		// 将日期转换为 Unix 时间戳（当天结束）
		endTime, err := time.Parse("2006-01-02", query.EndDate)
		if err == nil {
			tx = tx.Where("top_ups.create_time <= ?", endTime.Add(24*time.Hour-time.Second).Unix())
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
		models.TopUp
		Username string
	}

	if err := tx.Order("top_ups.create_time DESC").
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
			Money:         r.Money,
			TradeNo:       r.TradeNo,
			PaymentMethod: r.Method,
			Status:        r.Status,
			CreateTime:    r.CreateTime,
			CompleteTime:  r.CompleteTime,
		}
	}

	// 计算总页数
	totalPages := int((total + int64(query.PageSize) - 1) / int64(query.PageSize))

	return &TopUpListResult{
		Total:      total,
		Page:       query.Page,
		PageSize:   query.PageSize,
		TotalPages: totalPages,
		Items:      records,
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

	// 成功状态 (字符串类型，与 Python 版本一致)
	// 注意：需要用括号包裹，避免 AND/OR 优先级问题
	successCondition := "(LOWER(status) IN ('success', 'completed') OR status = '1')"

	// 总统计
	db.Model(&models.TopUp{}).
		Where(successCondition).
		Count(&data.TotalCount)

	db.Model(&models.TopUp{}).
		Where(successCondition).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&data.TotalAmount)

	db.Model(&models.TopUp{}).
		Where(successCondition).
		Select("COALESCE(SUM(money), 0)").
		Scan(&data.TotalMoney)

	// 今日统计 (使用本地时区午夜的 Unix 时间戳)
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()

	db.Model(&models.TopUp{}).
		Where(successCondition+" AND create_time >= ?", todayStart).
		Count(&data.TodayCount)

	db.Model(&models.TopUp{}).
		Where(successCondition+" AND create_time >= ?", todayStart).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&data.TodayAmount)

	db.Model(&models.TopUp{}).
		Where(successCondition+" AND create_time >= ?", todayStart).
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

// GetPaymentMethods 获取支付方式列表
func (s *TopUpService) GetPaymentMethods() ([]string, error) {
	db := database.GetMainDB()

	var methods []string

	// 与 Python 版本一致：获取去重的支付方式列表
	err := db.Table("top_ups").
		Select("DISTINCT payment_method").
		Where("payment_method IS NOT NULL AND payment_method != ''").
		Order("payment_method").
		Pluck("payment_method", &methods).Error

	if err != nil {
		return nil, err
	}

	return methods, nil
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

	// 检查状态 (字符串类型)
	if !topUp.IsSuccess() {
		tx.Rollback()
		return fmt.Errorf("只能退款成功的充值记录")
	}

	// 扣除用户额度
	if err := tx.Model(&models.User{}).
		Where("id = ?", topUp.UserID).
		Update("quota", database.GetMainDB().Raw("GREATEST(0, quota - ?)", topUp.Amount)).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("扣除额度失败: %v", err)
	}

	// 更新充值记录状态
	if err := tx.Model(&topUp).Update("status", models.TopUpStatusRefunded).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("更新充值状态失败: %v", err)
	}

	return tx.Commit().Error
}

// TopUpDetail 充值详情
type TopUpDetail struct {
	ID            int     `json:"id"`
	UserID        int     `json:"user_id"`
	Username      string  `json:"username"`
	Amount        int64   `json:"amount"`
	Money         float64 `json:"money"`
	TradeNo       string  `json:"trade_no"`
	PaymentMethod string  `json:"payment_method"`
	Status        string  `json:"status"`
	StatusText    string  `json:"status_text"`
	CreateTime    int64   `json:"create_time"`
	CompleteTime  int64   `json:"complete_time"`
}

// GetTopUpByID 获取单个充值记录
func (s *TopUpService) GetTopUpByID(id int) (*TopUpDetail, error) {
	db := database.GetMainDB()

	var result struct {
		ID            int
		UserID        int
		Username      string
		Amount        int64
		Money         float64
		TradeNo       string
		PaymentMethod string
		Status        string
		CreateTime    int64
		CompleteTime  int64
	}

	err := db.Table("top_ups").
		Select("top_ups.*, users.username").
		Joins("LEFT JOIN users ON top_ups.user_id = users.id").
		Where("top_ups.id = ?", id).
		First(&result).Error

	if err != nil {
		return nil, fmt.Errorf("充值记录不存在")
	}

	statusText := map[string]string{
		"pending":   "待支付",
		"success":   "成功",
		"completed": "成功",
		"failed":    "失败",
		"error":     "失败",
		"refunded":  "已退款",
	}

	return &TopUpDetail{
		ID:            result.ID,
		UserID:        result.UserID,
		Username:      result.Username,
		Amount:        result.Amount,
		Money:         result.Money,
		TradeNo:       result.TradeNo,
		PaymentMethod: result.PaymentMethod,
		Status:        result.Status,
		StatusText:    statusText[result.Status],
		CreateTime:    result.CreateTime,
		CompleteTime:  result.CompleteTime,
	}, nil
}

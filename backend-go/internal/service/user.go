package service

import (
	"fmt"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/models"
)

// UserService 用户服务
type UserService struct{}

// NewUserService 创建用户服务
func NewUserService() *UserService {
	return &UserService{}
}

// UserRecord 用户记录
type UserRecord struct {
	ID           int    `json:"id"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	Email        string `json:"email"`
	Role         int    `json:"role"`
	Status       int    `json:"status"`
	Quota        int64  `json:"quota"`
	UsedQuota    int64  `json:"used_quota"`
	RequestCount int64  `json:"request_count"`
	TokenCount   int    `json:"token_count"`
	InviterID    int    `json:"inviter_id"`
	InviterName  string `json:"inviter_name"`
	CreatedAt    string `json:"created_at"`
	LastLoginAt  string `json:"last_login_at"`
}

// UserStatistics 用户统计
type UserStatistics struct {
	TotalUsers     int64   `json:"total_users"`
	ActiveUsers    int64   `json:"active_users"`
	BannedUsers    int64   `json:"banned_users"`
	TodayNew       int64   `json:"today_new"`
	WeekNew        int64   `json:"week_new"`
	MonthNew       int64   `json:"month_new"`
	TotalQuota     int64   `json:"total_quota"`
	TotalUsedQuota int64   `json:"total_used_quota"`
	AvgQuota       float64 `json:"avg_quota"`
}

// UserQuery 用户查询参数
type UserQuery struct {
	Page      int    `form:"page"`
	PageSize  int    `form:"page_size"`
	Username  string `form:"username"`
	Email     string `form:"email"`
	Role      int    `form:"role"`
	Status    int    `form:"status"`
	InviterID int    `form:"inviter_id"`
	StartDate string `form:"start_date"`
	EndDate   string `form:"end_date"`
	OrderBy   string `form:"order_by"`
}

// UserListResult 用户列表结果
type UserListResult struct {
	Total      int64        `json:"total"`
	Page       int          `json:"page"`
	PageSize   int          `json:"page_size"`
	TotalPages int          `json:"total_pages"`
	Items      []UserRecord `json:"items"`
}

// GetUsers 获取用户列表
func (s *UserService) GetUsers(query *UserQuery) (*UserListResult, error) {
	db := database.GetMainDB()

	// 默认分页
	if query.Page <= 0 {
		query.Page = 1
	}
	if query.PageSize <= 0 {
		query.PageSize = 20
	}

	// 构建查询
	tx := db.Table("users u").
		Select("u.*, inviter.username as inviter_name").
		Joins("LEFT JOIN users inviter ON u.inviter_id = inviter.id").
		Where("u.deleted_at IS NULL")

	// 应用过滤条件
	if query.Username != "" {
		tx = tx.Where("u.username LIKE ?", "%"+query.Username+"%")
	}
	if query.Email != "" {
		tx = tx.Where("u.email LIKE ?", "%"+query.Email+"%")
	}
	if query.Role > 0 {
		tx = tx.Where("u.role = ?", query.Role)
	}
	if query.Status > 0 {
		tx = tx.Where("u.status = ?", query.Status)
	}
	if query.InviterID > 0 {
		tx = tx.Where("u.inviter_id = ?", query.InviterID)
	}
	if query.StartDate != "" {
		tx = tx.Where("u.created_at >= ?", query.StartDate)
	}
	if query.EndDate != "" {
		tx = tx.Where("u.created_at <= ?", query.EndDate+" 23:59:59")
	}

	// 获取总数
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, err
	}

	// 排序
	orderClause := "u.created_at DESC"
	switch query.OrderBy {
	case "quota":
		orderClause = "u.quota DESC"
	case "used_quota":
		orderClause = "u.used_quota DESC"
	case "request_count":
		orderClause = "u.request_count DESC"
	}

	// 分页查询
	offset := (query.Page - 1) * query.PageSize
	var results []struct {
		models.User
		InviterName string
	}

	if err := tx.Order(orderClause).
		Offset(offset).
		Limit(query.PageSize).
		Scan(&results).Error; err != nil {
		return nil, err
	}

	// 获取每个用户的令牌数
	userIDs := make([]int, len(results))
	for i, r := range results {
		userIDs[i] = r.ID
	}

	tokenCounts := make(map[int]int)
	if len(userIDs) > 0 {
		var counts []struct {
			UserID int
			Count  int
		}
		db.Model(&models.Token{}).
			Select("user_id, COUNT(*) as count").
			Where("user_id IN ? AND deleted_at IS NULL", userIDs).
			Group("user_id").
			Scan(&counts)
		for _, c := range counts {
			tokenCounts[c.UserID] = c.Count
		}
	}

	// 转换为返回格式
	records := make([]UserRecord, len(results))
	for i, r := range results {
		records[i] = UserRecord{
			ID:           r.ID,
			Username:     r.Username,
			DisplayName:  r.DisplayName,
			Email:        r.Email,
			Role:         r.Role,
			Status:       r.Status,
			Quota:        r.Quota,
			UsedQuota:    r.UsedQuota,
			RequestCount: int64(r.RequestCount),
			TokenCount:   tokenCounts[r.ID],
			InviterID:    r.InviterID,
			InviterName:  r.InviterName,
		}
		records[i].CreatedAt = r.CreatedAt.Format("2006-01-02 15:04:05")
	}

	// 计算总页数
	totalPages := int((total + int64(query.PageSize) - 1) / int64(query.PageSize))

	return &UserListResult{
		Total:      total,
		Page:       query.Page,
		PageSize:   query.PageSize,
		TotalPages: totalPages,
		Items:      records,
	}, nil
}

// GetUserStatistics 获取用户统计
func (s *UserService) GetUserStatistics() (*UserStatistics, error) {
	cacheKey := cache.CacheKey("user", "statistics")

	var data UserStatistics
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 5 * time.Minute,
	}

	err := wrapper.GetOrSet(&data, func() (interface{}, error) {
		return s.fetchUserStatistics()
	})

	return &data, err
}

// fetchUserStatistics 获取用户统计数据
func (s *UserService) fetchUserStatistics() (*UserStatistics, error) {
	db := database.GetMainDB()
	data := &UserStatistics{}

	// 总用户数
	db.Model(&models.User{}).
		Where("deleted_at IS NULL").
		Count(&data.TotalUsers)

	// 活跃用户数
	db.Model(&models.User{}).
		Where("deleted_at IS NULL AND status = ?", models.UserStatusEnabled).
		Count(&data.ActiveUsers)

	// 封禁用户数
	db.Model(&models.User{}).
		Where("deleted_at IS NULL AND status = ?", models.UserStatusBanned).
		Count(&data.BannedUsers)

	// 今日新增
	today := time.Now().Format("2006-01-02") + " 00:00:00"
	db.Model(&models.User{}).
		Where("deleted_at IS NULL AND created_at >= ?", today).
		Count(&data.TodayNew)

	// 本周新增
	weekStart := time.Now().AddDate(0, 0, -7).Format("2006-01-02") + " 00:00:00"
	db.Model(&models.User{}).
		Where("deleted_at IS NULL AND created_at >= ?", weekStart).
		Count(&data.WeekNew)

	// 本月新增
	monthStart := time.Now().AddDate(0, -1, 0).Format("2006-01-02") + " 00:00:00"
	db.Model(&models.User{}).
		Where("deleted_at IS NULL AND created_at >= ?", monthStart).
		Count(&data.MonthNew)

	// 总额度和已用额度
	db.Model(&models.User{}).
		Where("deleted_at IS NULL").
		Select("COALESCE(SUM(quota), 0)").
		Scan(&data.TotalQuota)

	db.Model(&models.User{}).
		Where("deleted_at IS NULL").
		Select("COALESCE(SUM(used_quota), 0)").
		Scan(&data.TotalUsedQuota)

	// 平均额度
	if data.TotalUsers > 0 {
		data.AvgQuota = float64(data.TotalQuota) / float64(data.TotalUsers)
	}

	return data, nil
}

// GetBannedUsers 获取封禁用户列表
func (s *UserService) GetBannedUsers(page, pageSize int) (*UserListResult, error) {
	query := &UserQuery{
		Page:     page,
		PageSize: pageSize,
		Status:   models.UserStatusBanned,
	}
	return s.GetUsers(query)
}

// BanUser 封禁用户
func (s *UserService) BanUser(userID int, reason string) error {
	db := database.GetMainDB()

	result := db.Model(&models.User{}).
		Where("id = ?", userID).
		Update("status", models.UserStatusBanned)

	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("用户不存在")
	}

	// 同时禁用该用户的所有令牌
	db.Model(&models.Token{}).
		Where("user_id = ?", userID).
		Update("status", models.TokenStatusDisabled)

	return nil
}

// UnbanUser 解封用户
func (s *UserService) UnbanUser(userID int) error {
	db := database.GetMainDB()

	result := db.Model(&models.User{}).
		Where("id = ?", userID).
		Update("status", models.UserStatusEnabled)

	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("用户不存在")
	}

	return nil
}

// DeleteUser 删除用户
func (s *UserService) DeleteUser(userID int) error {
	db := database.GetMainDB()

	now := time.Now()
	result := db.Model(&models.User{}).
		Where("id = ?", userID).
		Update("deleted_at", now)

	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("用户不存在")
	}

	// 同时删除该用户的所有令牌
	db.Model(&models.Token{}).
		Where("user_id = ?", userID).
		Update("deleted_at", now)

	return nil
}

// BatchDeleteUsers 批量删除用户
func (s *UserService) BatchDeleteUsers(userIDs []int) (int64, error) {
	db := database.GetMainDB()

	now := time.Now()
	result := db.Model(&models.User{}).
		Where("id IN ?", userIDs).
		Update("deleted_at", now)

	if result.Error != nil {
		return 0, result.Error
	}

	// 同时删除这些用户的所有令牌
	db.Model(&models.Token{}).
		Where("user_id IN ?", userIDs).
		Update("deleted_at", now)

	return result.RowsAffected, nil
}

// DisableUserToken 禁用用户令牌
func (s *UserService) DisableUserToken(tokenID int) error {
	db := database.GetMainDB()

	result := db.Model(&models.Token{}).
		Where("id = ?", tokenID).
		Update("status", models.TokenStatusDisabled)

	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("令牌不存在")
	}

	return nil
}

// GetInvitedUsers 获取被邀请用户列表
func (s *UserService) GetInvitedUsers(inviterID int, page, pageSize int) (*UserListResult, error) {
	query := &UserQuery{
		Page:      page,
		PageSize:  pageSize,
		InviterID: inviterID,
	}
	return s.GetUsers(query)
}

// BatchDeleteUsersByActivity 按活跃度级别批量删除用户
func (s *UserService) BatchDeleteUsersByActivity(activityLevel string, dryRun bool) (map[string]interface{}, error) {
	db := database.GetMainDB()

	// 活跃度阈值（秒）
	const inactiveThreshold = 30 * 24 * 3600 // 30 天

	now := time.Now().Unix()
	inactiveCutoff := now - inactiveThreshold

	var findSQL string
	var params []interface{}

	if activityLevel == "very_inactive" {
		// 超过 30 天没有请求的用户
		findSQL = `
			SELECT u.id, u.username
			FROM users u
			LEFT JOIN logs l ON u.id = l.user_id AND l.type = 2
			WHERE u.deleted_at IS NULL
			GROUP BY u.id, u.username
			HAVING MAX(l.created_at) < ?
		`
		params = []interface{}{inactiveCutoff}
	} else if activityLevel == "never" {
		// 从未请求的用户
		findSQL = `
			SELECT u.id, u.username
			FROM users u
			LEFT JOIN logs l ON u.id = l.user_id AND l.type = 2
			WHERE u.deleted_at IS NULL
			GROUP BY u.id, u.username
			HAVING MAX(l.created_at) IS NULL
		`
		params = []interface{}{}
	} else {
		return nil, fmt.Errorf("不支持的活跃度级别: %s", activityLevel)
	}

	var results []struct {
		ID       int    `gorm:"column:id"`
		Username string `gorm:"column:username"`
	}

	if err := db.Raw(findSQL, params...).Scan(&results).Error; err != nil {
		return nil, err
	}

	userIDs := make([]int, len(results))
	usernames := make([]string, 0, min(len(results), 20))
	for i, r := range results {
		userIDs[i] = r.ID
		if i < 20 {
			usernames = append(usernames, r.Username)
		}
	}

	if dryRun {
		return map[string]interface{}{
			"success": true,
			"dry_run": true,
			"count":   len(userIDs),
			"users":   usernames,
			"message": fmt.Sprintf("预览：将删除 %d 个用户", len(userIDs)),
		}, nil
	}

	if len(userIDs) == 0 {
		return map[string]interface{}{
			"success": true,
			"count":   0,
			"message": "没有需要删除的用户",
		}, nil
	}

	// 执行批量删除
	now2 := time.Now()
	result := db.Model(&models.User{}).
		Where("id IN ?", userIDs).
		Update("deleted_at", now2)

	if result.Error != nil {
		return nil, result.Error
	}

	// 同时删除这些用户的所有令牌
	db.Model(&models.Token{}).
		Where("user_id IN ?", userIDs).
		Update("deleted_at", now2)

	return map[string]interface{}{
		"success": true,
		"count":   result.RowsAffected,
		"message": fmt.Sprintf("已删除 %d 个不活跃用户", result.RowsAffected),
	}, nil
}

// min 返回两个整数中的较小值
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

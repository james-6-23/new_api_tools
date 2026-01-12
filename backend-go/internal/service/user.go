package service

import (
	"fmt"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/ketches/new-api-tools/internal/models"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// UserService 用户服务
type UserService struct{}

// NewUserService 创建用户服务
func NewUserService() *UserService {
	return &UserService{}
}

// ActivityStats 用户活跃度统计（与 Python /api/users/stats 对齐）
type ActivityStats struct {
	TotalUsers        int64 `json:"total_users"`
	ActiveUsers       int64 `json:"active_users"`
	InactiveUsers     int64 `json:"inactive_users"`
	VeryInactiveUsers int64 `json:"very_inactive_users"`
	NeverRequested    int64 `json:"never_requested"`
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
	LinuxDoID    string `json:"linux_do_id"`
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
	Search    string `form:"search"` // 通用搜索：支持用户名、邮箱、linux_do_id、aff_code
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
	// 通用搜索：支持用户名、显示名、邮箱、linux_do_id、aff_code
	if query.Search != "" {
		searchPattern := "%" + query.Search + "%"
		tx = tx.Where("(u.username LIKE ? OR COALESCE(u.display_name, '') LIKE ? OR COALESCE(u.email, '') LIKE ? OR COALESCE(u.linux_do_id, '') LIKE ? OR COALESCE(u.aff_code, '') LIKE ?)",
			searchPattern, searchPattern, searchPattern, searchPattern, searchPattern)
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
	// 注意：NewAPI 的 users 表没有 created_at 列，日期过滤暂不支持
	// 如需按日期过滤，可考虑使用 logs 表的首次请求时间

	// 获取总数
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, err
	}

	// 排序（users 表没有 created_at，默认按 id 降序）
	orderClause := "u.id DESC"
	switch query.OrderBy {
	case "quota":
		orderClause = "u.quota DESC"
	case "used_quota":
		orderClause = "u.used_quota DESC"
	case "request_count":
		orderClause = "u.request_count DESC"
	case "id":
		orderClause = "u.id DESC"
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

	// 获取每个用户的首次请求时间和最后请求时间（从 logs 表）
	// users 表没有 created_at，使用 logs 表的 MIN(created_at) 作为 first_seen
	firstSeenMap := make(map[int]int64)
	lastSeenMap := make(map[int]int64)
	if len(userIDs) > 0 {
		var logTimes []struct {
			UserID    int   `gorm:"column:user_id"`
			FirstSeen int64 `gorm:"column:first_seen"`
			LastSeen  int64 `gorm:"column:last_seen"`
		}
		db.Table("logs").
			Select("user_id, MIN(created_at) as first_seen, MAX(created_at) as last_seen").
			Where("user_id IN ?", userIDs).
			Group("user_id").
			Scan(&logTimes)
		for _, lt := range logTimes {
			firstSeenMap[lt.UserID] = lt.FirstSeen
			lastSeenMap[lt.UserID] = lt.LastSeen
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
			LinuxDoID:    r.LinuxDoID,
		}
		// 使用 logs 表的首次请求时间作为 created_at（first_seen）
		if firstSeen, ok := firstSeenMap[r.ID]; ok && firstSeen > 0 {
			records[i].CreatedAt = time.Unix(firstSeen, 0).Format("2006-01-02 15:04:05")
		}
		// 使用 logs 表的最后请求时间作为 last_login_at
		if lastSeen, ok := lastSeenMap[r.ID]; ok && lastSeen > 0 {
			records[i].LastLoginAt = time.Unix(lastSeen, 0).Format("2006-01-02 15:04:05")
		}
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

	// 使用 logs 表统计"新增用户"（首次请求时间在指定时间范围内的用户）
	// 这是一个近似值，因为 users 表没有 created_at 列
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	weekStart := now.AddDate(0, 0, -7).Unix()
	monthStart := now.AddDate(0, -1, 0).Unix()

	// 今日新增：首次请求时间在今天的用户数
	db.Table("logs").
		Select("COUNT(DISTINCT user_id)").
		Where("user_id IN (SELECT user_id FROM logs GROUP BY user_id HAVING MIN(created_at) >= ?)", todayStart).
		Scan(&data.TodayNew)

	// 本周新增：首次请求时间在最近7天的用户数
	db.Table("logs").
		Select("COUNT(DISTINCT user_id)").
		Where("user_id IN (SELECT user_id FROM logs GROUP BY user_id HAVING MIN(created_at) >= ?)", weekStart).
		Scan(&data.WeekNew)

	// 本月新增：首次请求时间在最近30天的用户数
	db.Table("logs").
		Select("COUNT(DISTINCT user_id)").
		Where("user_id IN (SELECT user_id FROM logs GROUP BY user_id HAVING MIN(created_at) >= ?)", monthStart).
		Scan(&data.MonthNew)

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
func (s *UserService) BanUser(userID int, reason string, disableTokens bool) error {
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

	if disableTokens {
		// 同时禁用该用户的所有令牌
		db.Model(&models.Token{}).
			Where("user_id = ?", userID).
			Update("status", models.TokenStatusDisabled)
	}

	return nil
}

// UnbanUser 解封用户
func (s *UserService) UnbanUser(userID int, enableTokens bool) error {
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

	if enableTokens {
		db.Model(&models.Token{}).
			Where("user_id = ? AND status = ?", userID, models.TokenStatusDisabled).
			Update("status", models.TokenStatusEnabled)
	}

	return nil
}

// GetActivityStats 获取用户活跃度统计（用 logs 作为“请求记录”来源）
func (s *UserService) GetActivityStats(quick bool) (*ActivityStats, error) {
	db := database.GetMainDB()
	stats := &ActivityStats{}

	if err := db.Model(&models.User{}).
		Where("deleted_at IS NULL").
		Count(&stats.TotalUsers).Error; err != nil {
		return nil, err
	}

	// 统计有过请求的用户数（以 logs 表为准）
	var requestedUsers int64
	if err := db.Table("users u").
		Joins("JOIN logs l ON l.user_id = u.id").
		Where("u.deleted_at IS NULL").
		Distinct("u.id").
		Count(&requestedUsers).Error; err != nil {
		return nil, err
	}

	stats.NeverRequested = stats.TotalUsers - requestedUsers
	if quick {
		return stats, nil
	}

	now := time.Now().Unix()
	sevenDaysAgo := now - 7*24*3600
	thirtyDaysAgo := now - 30*24*3600

	lastLogSubquery := db.Table("logs").
		Select("user_id, MAX(created_at) AS last_ts").
		Group("user_id")

	// active: 最近 7 天内有请求
	if err := db.Table("users u").
		Joins("JOIN (?) l ON l.user_id = u.id", lastLogSubquery).
		Where("u.deleted_at IS NULL AND l.last_ts >= ?", sevenDaysAgo).
		Count(&stats.ActiveUsers).Error; err != nil {
		return nil, err
	}

	// inactive: 7-30 天内有请求
	if err := db.Table("users u").
		Joins("JOIN (?) l ON l.user_id = u.id", lastLogSubquery).
		Where("u.deleted_at IS NULL AND l.last_ts < ? AND l.last_ts >= ?", sevenDaysAgo, thirtyDaysAgo).
		Count(&stats.InactiveUsers).Error; err != nil {
		return nil, err
	}

	// very_inactive: 超过 30 天有请求
	if err := db.Table("users u").
		Joins("JOIN (?) l ON l.user_id = u.id", lastLogSubquery).
		Where("u.deleted_at IS NULL AND l.last_ts < ?", thirtyDaysAgo).
		Count(&stats.VeryInactiveUsers).Error; err != nil {
		return nil, err
	}

	return stats, nil
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

// GetInvitedUsers 获取被邀请用户列表（增强版，与 Python 版本一致）
func (s *UserService) GetInvitedUsers(inviterID int, page, pageSize int) (map[string]interface{}, error) {
	db := database.GetMainDB()

	// 默认分页
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}

	// 1. 获取邀请人信息
	var inviter models.User
	if err := db.Where("id = ? AND deleted_at IS NULL", inviterID).First(&inviter).Error; err != nil {
		return map[string]interface{}{
			"success": false,
			"message": "用户不存在",
			"inviter": nil,
			"items":   []interface{}{},
			"total":   0,
		}, nil
	}

	inviterInfo := map[string]interface{}{
		"user_id":      inviter.ID,
		"username":     inviter.Username,
		"display_name": inviter.DisplayName,
		"aff_code":     inviter.AffCode,
		"aff_count":    inviter.AffCount,
		"aff_quota":    inviter.AffQuota,
		"aff_history":  inviter.AffHistory,
	}

	// 2. 查询被邀请用户总数
	var total int64
	db.Model(&models.User{}).
		Where("inviter_id = ? AND deleted_at IS NULL", inviterID).
		Count(&total)

	// 3. 查询被邀请用户列表
	offset := (page - 1) * pageSize
	var invitedUsers []models.User
	db.Where("inviter_id = ? AND deleted_at IS NULL", inviterID).
		Order("id DESC").
		Offset(offset).
		Limit(pageSize).
		Find(&invitedUsers)

	// 4. 转换为返回格式
	items := make([]map[string]interface{}, len(invitedUsers))
	var activeCount, bannedCount int
	var totalUsedQuota int64
	var totalRequests int

	for i, u := range invitedUsers {
		items[i] = map[string]interface{}{
			"user_id":       u.ID,
			"username":      u.Username,
			"display_name":  u.DisplayName,
			"email":         u.Email,
			"status":        u.Status,
			"quota":         u.Quota,
			"used_quota":    u.UsedQuota,
			"request_count": u.RequestCount,
			"group":         u.Group,
			"role":          u.Role,
		}

		// 统计
		if u.RequestCount > 0 {
			activeCount++
		}
		if u.Status == models.UserStatusBanned {
			bannedCount++
		}
		totalUsedQuota += u.UsedQuota
		totalRequests += u.RequestCount
	}

	// 5. 构建统计信息
	stats := map[string]interface{}{
		"total_invited":    total,
		"active_count":     activeCount,
		"banned_count":     bannedCount,
		"total_used_quota": totalUsedQuota,
		"total_requests":   totalRequests,
	}

	return map[string]interface{}{
		"success":   true,
		"inviter":   inviterInfo,
		"items":     items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
		"stats":     stats,
	}, nil
}

// BatchDeleteUsersByActivity 按活跃度级别批量删除用户
// hardDelete: true 时物理删除用户及关联数据，false 时软删除
func (s *UserService) BatchDeleteUsersByActivity(activityLevel string, dryRun bool, hardDelete bool) (map[string]interface{}, error) {
	db := database.GetMainDB()

	// 活跃度阈值（秒）
	const activeThreshold = 7 * 24 * 3600    // 7 天
	const inactiveThreshold = 30 * 24 * 3600 // 30 天

	now := time.Now().Unix()
	activeCutoff := now - activeThreshold
	inactiveCutoff := now - inactiveThreshold

	var findSQL string
	var params []interface{}

	switch activityLevel {
	case "very_inactive":
		// 超过 30 天没有请求的用户（但有请求记录）
		findSQL = `
			SELECT u.id, u.username
			FROM users u
			WHERE u.deleted_at IS NULL
			  AND u.request_count > 0
			  AND NOT EXISTS (
				SELECT 1 FROM logs l
				WHERE l.user_id = u.id AND l.type = 2 AND l.created_at >= ?
				LIMIT 1
			  )
		`
		params = []interface{}{inactiveCutoff}
	case "inactive":
		// 7-30 天内有请求
		findSQL = `
			SELECT u.id, u.username
			FROM users u
			WHERE u.deleted_at IS NULL
			  AND u.request_count > 0
			  AND NOT EXISTS (
				SELECT 1 FROM logs l
				WHERE l.user_id = u.id AND l.type = 2 AND l.created_at >= ?
				LIMIT 1
			  )
			  AND EXISTS (
				SELECT 1 FROM logs l
				WHERE l.user_id = u.id AND l.type = 2 AND l.created_at >= ?
				LIMIT 1
			  )
		`
		params = []interface{}{activeCutoff, inactiveCutoff}
	case "never":
		// 从未请求的用户
		findSQL = `
			SELECT u.id, u.username
			FROM users u
			WHERE u.deleted_at IS NULL
			  AND u.request_count = 0
		`
		params = []interface{}{}
	default:
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

	action := "删除"
	if hardDelete {
		action = "彻底删除"
	}

	if dryRun {
		return map[string]interface{}{
			"success": true,
			"dry_run": true,
			"count":   len(userIDs),
			"users":   usernames,
			"message": fmt.Sprintf("预览：将%s %d 个用户", action, len(userIDs)),
		}, nil
	}

	if len(userIDs) == 0 {
		return map[string]interface{}{
			"success": true,
			"count":   0,
			"message": "没有需要删除的用户",
		}, nil
	}

	var deletedCount int64
	if hardDelete {
		// 彻底删除：物理删除用户及关联数据
		deletedCount = s.hardDeleteUsers(userIDs)
	} else {
		// 软删除
		now2 := time.Now()
		result := db.Model(&models.User{}).
			Where("id IN ?", userIDs).
			Update("deleted_at", now2)

		if result.Error != nil {
			return nil, result.Error
		}

		// 同时软删除这些用户的所有令牌
		db.Model(&models.Token{}).
			Where("user_id IN ?", userIDs).
			Update("deleted_at", now2)

		deletedCount = result.RowsAffected
	}

	return map[string]interface{}{
		"success": true,
		"count":   deletedCount,
		"message": fmt.Sprintf("已%s %d 个不活跃用户", action, deletedCount),
	}, nil
}

// hardDeleteUsers 彻底删除用户（物理删除）
// 删除顺序考虑外键约束
func (s *UserService) hardDeleteUsers(userIDs []int) int64 {
	if len(userIDs) == 0 {
		return 0
	}

	db := database.GetMainDB()
	var deletedCount int64

	// 批量处理，每批 100 个用户
	batchSize := 100
	for i := 0; i < len(userIDs); i += batchSize {
		end := i + batchSize
		if end > len(userIDs) {
			end = len(userIDs)
		}
		batchIDs := userIDs[i:end]

		// 使用事务保护，确保数据一致性
		err := db.Transaction(func(tx *gorm.DB) error {
			// 1. 删除 tokens
			if err := tx.Exec("DELETE FROM tokens WHERE user_id IN ?", batchIDs).Error; err != nil {
				return err
			}

			// 2. 删除 quota_data
			if err := tx.Exec("DELETE FROM quota_data WHERE user_id IN ?", batchIDs).Error; err != nil {
				return err
			}

			// 3. 删除 midjourneys
			if err := tx.Exec("DELETE FROM midjourneys WHERE user_id IN ?", batchIDs).Error; err != nil {
				return err
			}

			// 4. 删除 tasks
			if err := tx.Exec("DELETE FROM tasks WHERE user_id IN ?", batchIDs).Error; err != nil {
				return err
			}

			// 5. 删除 top_ups
			if err := tx.Exec("DELETE FROM top_ups WHERE user_id IN ?", batchIDs).Error; err != nil {
				return err
			}

			// 6. 删除用户创建的兑换码
			if err := tx.Exec("DELETE FROM redemptions WHERE user_id IN ?", batchIDs).Error; err != nil {
				return err
			}

			// 7. 删除 2FA 相关
			if err := tx.Exec("DELETE FROM two_fa_backup_codes WHERE user_id IN ?", batchIDs).Error; err != nil {
				return err
			}
			if err := tx.Exec("DELETE FROM two_fas WHERE user_id IN ?", batchIDs).Error; err != nil {
				return err
			}

			// 8. 删除 passkey_credentials
			if err := tx.Exec("DELETE FROM passkey_credentials WHERE user_id IN ?", batchIDs).Error; err != nil {
				return err
			}

			// 9. 最后删除用户
			result := tx.Exec("DELETE FROM users WHERE id IN ?", batchIDs)
			if result.Error != nil {
				return result.Error
			}
			deletedCount += result.RowsAffected
			return nil
		})

		if err != nil {
			logger.Error("硬删除用户批次失败", zap.Error(err), zap.Ints("batch_ids", batchIDs))
		}
	}

	return deletedCount
}

// GetSoftDeletedUsersCount 获取已软删除用户的数量
func (s *UserService) GetSoftDeletedUsersCount() (map[string]interface{}, error) {
	db := database.GetMainDB()

	var count int64
	if err := db.Model(&models.User{}).
		Where("deleted_at IS NOT NULL").
		Count(&count).Error; err != nil {
		return map[string]interface{}{
			"success": false,
			"count":   0,
			"message": err.Error(),
		}, err
	}

	return map[string]interface{}{
		"success": true,
		"count":   count,
	}, nil
}

// PurgeSoftDeletedUsers 彻底清理已软删除的用户（物理删除）
func (s *UserService) PurgeSoftDeletedUsers(dryRun bool) (map[string]interface{}, error) {
	db := database.GetMainDB()

	// 查找所有已软删除的用户
	var results []struct {
		ID       int    `gorm:"column:id"`
		Username string `gorm:"column:username"`
	}

	if err := db.Table("users").
		Select("id, username").
		Where("deleted_at IS NOT NULL").
		Scan(&results).Error; err != nil {
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
			"message": fmt.Sprintf("预览：将彻底清理 %d 个已注销用户", len(userIDs)),
		}, nil
	}

	if len(userIDs) == 0 {
		return map[string]interface{}{
			"success": true,
			"count":   0,
			"message": "没有需要清理的用户",
		}, nil
	}

	// 执行彻底删除
	deletedCount := s.hardDeleteUsers(userIDs)

	return map[string]interface{}{
		"success": true,
		"count":   deletedCount,
		"message": fmt.Sprintf("已彻底清理 %d 个已注销用户", deletedCount),
	}, nil
}

// min 返回两个整数中的较小值
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

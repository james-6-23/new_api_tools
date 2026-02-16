package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/new-api-tools/backend/internal/database"
	"github.com/new-api-tools/backend/internal/logger"
)

// Activity level constants
const (
	ActivityActive       = "active"
	ActivityInactive     = "inactive"
	ActivityVeryInactive = "very_inactive"
	ActivityNever        = "never"

	ActiveThreshold   = 7 * 24 * 3600  // 7 days
	InactiveThreshold = 30 * 24 * 3600 // 30 days
)

// UserManagementService handles user queries and operations
type UserManagementService struct {
	db *database.Manager
}

// NewUserManagementService creates a new UserManagementService
func NewUserManagementService() *UserManagementService {
	return &UserManagementService{db: database.Get()}
}

// GetActivityStats returns user activity statistics
func (s *UserManagementService) GetActivityStats(quick bool) (map[string]interface{}, error) {
	now := time.Now().Unix()
	activeThreshold := now - ActiveThreshold
	inactiveThreshold := now - InactiveThreshold

	// Total users (not deleted)
	totalRow, err := s.db.QueryOne("SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL")
	if err != nil {
		return nil, err
	}
	totalUsers := totalRow["count"]

	if quick {
		// Quick mode: only total + never requested
		neverRow, _ := s.db.QueryOne(
			"SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL AND request_count = 0")
		neverCount := int64(0)
		if neverRow != nil {
			neverCount = toInt64(neverRow["count"])
		}
		return map[string]interface{}{
			"total_users":         totalUsers,
			"active_users":        0,
			"inactive_users":      0,
			"very_inactive_users": 0,
			"never_requested":     neverCount,
			"quick_mode":          true,
		}, nil
	}

	// Full stats: count users by last request time using EXISTS subquery
	activeQuery := fmt.Sprintf(
		`SELECT COUNT(*) as count FROM users u 
		 WHERE u.deleted_at IS NULL AND u.request_count > 0 
		 AND EXISTS (SELECT 1 FROM logs l WHERE l.user_id = u.id AND l.type IN (2,5) AND l.created_at >= %d)`,
		activeThreshold)
	activeRow, _ := s.db.QueryOne(activeQuery)
	activeCount := int64(0)
	if activeRow != nil {
		activeCount = toInt64(activeRow["count"])
	}

	// Inactive: has requests but last request between 7-30 days ago
	inactiveQuery := fmt.Sprintf(
		`SELECT COUNT(*) as count FROM users u 
		 WHERE u.deleted_at IS NULL AND u.request_count > 0 
		 AND EXISTS (SELECT 1 FROM logs l WHERE l.user_id = u.id AND l.type IN (2,5) AND l.created_at >= %d AND l.created_at < %d)
		 AND NOT EXISTS (SELECT 1 FROM logs l WHERE l.user_id = u.id AND l.type IN (2,5) AND l.created_at >= %d)`,
		inactiveThreshold, activeThreshold, activeThreshold)
	inactiveRow, _ := s.db.QueryOne(inactiveQuery)
	inactiveCount := int64(0)
	if inactiveRow != nil {
		inactiveCount = toInt64(inactiveRow["count"])
	}

	// Never requested
	neverRow, _ := s.db.QueryOne("SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL AND request_count = 0")
	neverCount := int64(0)
	if neverRow != nil {
		neverCount = toInt64(neverRow["count"])
	}

	total := toInt64(totalUsers)
	veryInactive := total - activeCount - inactiveCount - neverCount

	return map[string]interface{}{
		"total_users":         total,
		"active_users":        activeCount,
		"inactive_users":      inactiveCount,
		"very_inactive_users": veryInactive,
		"never_requested":     neverCount,
	}, nil
}

// ListUsersParams defines parameters for listing users
type ListUsersParams struct {
	Page           int    `json:"page"`
	PageSize       int    `json:"page_size"`
	ActivityFilter string `json:"activity_filter"`
	GroupFilter    string `json:"group_filter"`
	SourceFilter   string `json:"source_filter"`
	Search         string `json:"search"`
	OrderBy        string `json:"order_by"`
	OrderDir       string `json:"order_dir"`
}

// GetUsers returns paginated user list
func (s *UserManagementService) GetUsers(params ListUsersParams) (map[string]interface{}, error) {
	if params.Page < 1 {
		params.Page = 1
	}
	if params.PageSize < 1 || params.PageSize > 100 {
		params.PageSize = 20
	}
	if params.OrderBy == "" {
		params.OrderBy = "request_count"
	}
	if params.OrderDir == "" {
		params.OrderDir = "DESC"
	}

	// Validate order_by
	allowedOrderBy := map[string]bool{
		"id": true, "username": true, "request_count": true,
		"quota": true, "used_quota": true, "created_at": true,
	}
	if !allowedOrderBy[params.OrderBy] {
		params.OrderBy = "request_count"
	}
	orderDir := strings.ToUpper(params.OrderDir)
	if orderDir != "ASC" && orderDir != "DESC" {
		orderDir = "DESC"
	}

	groupCol := "`group`"
	if s.db.IsPG {
		groupCol = `"group"`
	}

	offset := (params.Page - 1) * params.PageSize
	where := []string{"u.deleted_at IS NULL"}
	args := []interface{}{}
	argIdx := 1

	if params.Search != "" {
		if s.db.IsPG {
			where = append(where, fmt.Sprintf(
				"(u.username ILIKE $%d OR COALESCE(u.display_name,'') ILIKE $%d OR COALESCE(u.email,'') ILIKE $%d OR COALESCE(u.linux_do_id,'') ILIKE $%d OR COALESCE(u.aff_code,'') ILIKE $%d)",
				argIdx, argIdx+1, argIdx+2, argIdx+3, argIdx+4))
			searchPattern := "%" + params.Search + "%"
			args = append(args, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern)
			argIdx += 5
		} else {
			where = append(where, "(u.username LIKE ? OR COALESCE(u.display_name,'') LIKE ? OR COALESCE(u.email,'') LIKE ? OR COALESCE(u.linux_do_id,'') LIKE ? OR COALESCE(u.aff_code,'') LIKE ?)")
			searchPattern := "%" + params.Search + "%"
			args = append(args, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern)
		}
	}
	if params.GroupFilter != "" {
		if s.db.IsPG {
			where = append(where, fmt.Sprintf("u.%s = $%d", groupCol, argIdx))
			argIdx++
		} else {
			where = append(where, fmt.Sprintf("u.%s = ?", groupCol))
		}
		args = append(args, params.GroupFilter)
	}
	if params.ActivityFilter == ActivityNever {
		where = append(where, "u.request_count = 0")
	}

	// Source filter
	if params.SourceFilter != "" {
		sourceConditions := map[string]string{
			"github":   "u.github_id IS NOT NULL AND u.github_id <> ''",
			"wechat":   "u.wechat_id IS NOT NULL AND u.wechat_id <> ''",
			"telegram": "u.telegram_id IS NOT NULL AND u.telegram_id <> ''",
			"discord":  "u.discord_id IS NOT NULL AND u.discord_id <> ''",
			"oidc":     "u.oidc_id IS NOT NULL AND u.oidc_id <> ''",
			"linux_do": "u.linux_do_id IS NOT NULL AND u.linux_do_id <> ''",
			"password": "(u.github_id IS NULL OR u.github_id = '') AND (u.wechat_id IS NULL OR u.wechat_id = '') AND (u.telegram_id IS NULL OR u.telegram_id = '') AND (u.discord_id IS NULL OR u.discord_id = '') AND (u.oidc_id IS NULL OR u.oidc_id = '') AND (u.linux_do_id IS NULL OR u.linux_do_id = '')",
		}
		if cond, ok := sourceConditions[params.SourceFilter]; ok {
			where = append(where, "("+cond+")")
		}
	}

	whereClause := strings.Join(where, " AND ")

	// Count total
	countQuery := fmt.Sprintf("SELECT COUNT(*) as count FROM users u WHERE %s", whereClause)
	if !s.db.IsPG {
		countQuery = s.db.RebindQuery(countQuery)
	}
	countRow, err := s.db.QueryOne(countQuery, args...)
	if err != nil {
		return nil, err
	}
	total := toInt64(countRow["count"])

	// Query users — include linux_do_id field
	var selectQuery string
	if s.db.IsPG {
		selectQuery = fmt.Sprintf(
			`SELECT u.id, u.username, u.display_name, u.email, u.role, u.status,
			 u.quota, u.used_quota, u.request_count, u.%s, u.created_at, u.linux_do_id,
			 u.github_id, u.wechat_id, u.telegram_id, u.discord_id, u.oidc_id
			 FROM users u WHERE %s ORDER BY u.%s %s LIMIT $%d OFFSET $%d`,
			groupCol, whereClause, params.OrderBy, orderDir, argIdx, argIdx+1)
		args = append(args, params.PageSize, offset)
	} else {
		selectQuery = fmt.Sprintf(
			"SELECT u.id, u.username, u.display_name, u.email, u.role, u.status, "+
				"u.quota, u.used_quota, u.request_count, u.%s, u.created_at, u.linux_do_id, "+
				"u.github_id, u.wechat_id, u.telegram_id, u.discord_id, u.oidc_id "+
				"FROM users u WHERE %s ORDER BY u.%s %s LIMIT ? OFFSET ?",
			groupCol, whereClause, params.OrderBy, orderDir)
		args = append(args, params.PageSize, offset)
		selectQuery = s.db.RebindQuery(selectQuery)
	}

	rows, err := s.db.Query(selectQuery, args...)
	if err != nil {
		return nil, err
	}

	// Enrich rows with computed fields (activity_level, source)
	for _, row := range rows {
		reqCount := toInt64(row["request_count"])
		if reqCount == 0 {
			row["activity_level"] = ActivityNever
		} else {
			row["activity_level"] = ActivityActive
		}
		row["last_request_time"] = nil

		// Compute source from OAuth ID fields
		source := "password"
		if toString(row["linux_do_id"]) != "" {
			source = "linux_do"
		} else if toString(row["github_id"]) != "" {
			source = "github"
		} else if toString(row["wechat_id"]) != "" {
			source = "wechat"
		} else if toString(row["telegram_id"]) != "" {
			source = "telegram"
		} else if toString(row["discord_id"]) != "" {
			source = "discord"
		} else if toString(row["oidc_id"]) != "" {
			source = "oidc"
		}
		row["source"] = source

		// Clean up internal fields
		delete(row, "github_id")
		delete(row, "wechat_id")
		delete(row, "telegram_id")
		delete(row, "discord_id")
		delete(row, "oidc_id")
	}

	totalPages := int((total + int64(params.PageSize) - 1) / int64(params.PageSize))

	return map[string]interface{}{
		"items":       rows,
		"total":       total,
		"page":        params.Page,
		"page_size":   params.PageSize,
		"total_pages": totalPages,
	}, nil
}

// GetBannedUsers returns banned users list
func (s *UserManagementService) GetBannedUsers(page, pageSize int, search string) (map[string]interface{}, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}

	offset := (page - 1) * pageSize
	where := "u.status = 2 AND u.deleted_at IS NULL"
	args := []interface{}{}

	if search != "" {
		if s.db.IsPG {
			where += " AND u.username ILIKE $1"
		} else {
			where += " AND u.username LIKE ?"
		}
		args = append(args, "%"+search+"%")
	}

	// Count
	countQuery := s.db.RebindQuery(fmt.Sprintf("SELECT COUNT(*) as count FROM users u WHERE %s", where))
	countRow, _ := s.db.QueryOne(countQuery, args...)
	total := int64(0)
	if countRow != nil {
		total = toInt64(countRow["count"])
	}

	// Query
	query := fmt.Sprintf(
		"SELECT u.id, u.username, u.display_name, u.email, u.status, u.role, "+
			"u.quota, u.used_quota, u.request_count "+
			"FROM users u WHERE %s ORDER BY u.id DESC LIMIT %d OFFSET %d",
		where, pageSize, offset)
	if !s.db.IsPG {
		query = s.db.RebindQuery(query)
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}

	totalPages := int((total + int64(pageSize) - 1) / int64(pageSize))

	return map[string]interface{}{
		"items":       rows,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": totalPages,
	}, nil
}

// DeleteUser soft-deletes a user
func (s *UserManagementService) DeleteUser(userID int64, hardDelete bool) (int64, error) {
	if hardDelete {
		// Hard delete: remove user and associated data
		s.db.Execute(s.db.RebindQuery("DELETE FROM tokens WHERE user_id = ?"), userID)
		affected, err := s.db.Execute(s.db.RebindQuery("DELETE FROM users WHERE id = ?"), userID)
		if err != nil {
			return 0, err
		}
		logger.L.Business(fmt.Sprintf("用户 %d 已彻底删除", userID))
		return affected, nil
	}

	// Soft delete
	now := time.Now().Unix()
	affected, err := s.db.Execute(s.db.RebindQuery(
		"UPDATE users SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL"), now, userID)
	if err != nil {
		return 0, err
	}
	if affected > 0 {
		logger.L.Business(fmt.Sprintf("用户 %d 已注销", userID))
	}
	return affected, nil
}

// BanUser sets user status to banned (2)
func (s *UserManagementService) BanUser(userID int64, disableTokens bool) error {
	_, err := s.db.Execute(s.db.RebindQuery("UPDATE users SET status = 2 WHERE id = ?"), userID)
	if err != nil {
		return err
	}
	if disableTokens {
		s.db.Execute(s.db.RebindQuery("UPDATE tokens SET status = 2 WHERE user_id = ?"), userID)
	}
	logger.L.Security(fmt.Sprintf("用户 %d 已封禁", userID))
	return nil
}

// UnbanUser sets user status to active (1)
func (s *UserManagementService) UnbanUser(userID int64, enableTokens bool) error {
	_, err := s.db.Execute(s.db.RebindQuery("UPDATE users SET status = 1 WHERE id = ?"), userID)
	if err != nil {
		return err
	}
	if enableTokens {
		s.db.Execute(s.db.RebindQuery("UPDATE tokens SET status = 1 WHERE user_id = ?"), userID)
	}
	logger.L.Security(fmt.Sprintf("用户 %d 已解封", userID))
	return nil
}

// DisableToken disables a single token
func (s *UserManagementService) DisableToken(tokenID int64) error {
	_, err := s.db.Execute(s.db.RebindQuery("UPDATE tokens SET status = 2 WHERE id = ?"), tokenID)
	if err != nil {
		return err
	}
	logger.L.Security(fmt.Sprintf("Token %d 已禁用", tokenID))
	return nil
}

// GetSoftDeletedCount returns count of soft-deleted users
func (s *UserManagementService) GetSoftDeletedCount() (int64, error) {
	row, err := s.db.QueryOne("SELECT COUNT(*) as count FROM users WHERE deleted_at IS NOT NULL")
	if err != nil {
		return 0, err
	}
	return toInt64(row["count"]), nil
}

// PurgeSoftDeleted permanently deletes soft-deleted users
func (s *UserManagementService) PurgeSoftDeleted(dryRun bool) (int64, error) {
	if dryRun {
		return s.GetSoftDeletedCount()
	}

	// Delete associated tokens first
	s.db.Execute("DELETE FROM tokens WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL)")

	affected, err := s.db.Execute("DELETE FROM users WHERE deleted_at IS NOT NULL")
	if err != nil {
		return 0, err
	}
	logger.L.Business(fmt.Sprintf("已清理 %d 个软删除用户", affected))
	return affected, nil
}

// BatchDeleteInactiveUsers deletes inactive users
func (s *UserManagementService) BatchDeleteInactiveUsers(activityLevel string, dryRun, hardDelete bool) (map[string]interface{}, error) {
	now := time.Now().Unix()
	var condition string

	switch activityLevel {
	case ActivityNever:
		condition = "request_count = 0"
	case ActivityVeryInactive:
		threshold := now - InactiveThreshold
		condition = fmt.Sprintf("request_count > 0 AND id NOT IN (SELECT DISTINCT user_id FROM logs WHERE type IN (2,5) AND created_at >= %d)", threshold)
	case ActivityInactive:
		threshold := now - ActiveThreshold
		condition = fmt.Sprintf("request_count > 0 AND id NOT IN (SELECT DISTINCT user_id FROM logs WHERE type IN (2,5) AND created_at >= %d)", threshold)
	default:
		return nil, fmt.Errorf("invalid activity level: %s", activityLevel)
	}

	// Count affected users
	countRow, err := s.db.QueryOne(fmt.Sprintf(
		"SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL AND role != 100 AND %s", condition))
	if err != nil {
		return nil, err
	}
	affected := toInt64(countRow["count"])

	if dryRun {
		return map[string]interface{}{
			"dry_run":        true,
			"affected_count": affected,
			"activity_level": activityLevel,
		}, nil
	}

	// Execute delete
	if hardDelete {
		s.db.Execute(fmt.Sprintf(
			"DELETE FROM tokens WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NULL AND role != 100 AND %s)", condition))
		s.db.Execute(fmt.Sprintf(
			"DELETE FROM users WHERE deleted_at IS NULL AND role != 100 AND %s", condition))
	} else {
		s.db.Execute(fmt.Sprintf(
			"UPDATE users SET deleted_at = %d WHERE deleted_at IS NULL AND role != 100 AND %s", now, condition))
	}

	logger.L.Business(fmt.Sprintf("批量删除 %s 用户: %d 个", activityLevel, affected))

	return map[string]interface{}{
		"dry_run":        false,
		"affected_count": affected,
		"activity_level": activityLevel,
		"hard_delete":    hardDelete,
	}, nil
}

// toInt64 safely converts interface{} to int64
func toInt64(v interface{}) int64 {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case int64:
		return val
	case int:
		return int64(val)
	case int32:
		return int64(val)
	case float64:
		return int64(val)
	case float32:
		return int64(val)
	case string:
		var n int64
		fmt.Sscanf(val, "%d", &n)
		return n
	case []byte:
		var n int64
		fmt.Sscanf(string(val), "%d", &n)
		return n
	default:
		return 0
	}
}

// toString safely converts interface{} to string
func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case string:
		return val
	case []byte:
		return string(val)
	default:
		return fmt.Sprintf("%v", val)
	}
}

// GetInvitedUsers returns users invited by the specified user
func (s *UserManagementService) GetInvitedUsers(userID int64, page, pageSize int) (map[string]interface{}, error) {
	offset := (page - 1) * pageSize

	// Get inviter info
	inviterRow, err := s.db.QueryOne(s.db.RebindQuery(
		fmt.Sprintf("SELECT id, username, display_name, aff_code, aff_count, aff_quota, aff_history FROM users WHERE id = %d AND deleted_at IS NULL", userID)))
	if err != nil || inviterRow == nil {
		return map[string]interface{}{
			"inviter":   nil,
			"items":     []interface{}{},
			"total":     0,
			"page":      page,
			"page_size": pageSize,
			"stats":     map[string]interface{}{},
		}, nil
	}

	inviter := map[string]interface{}{
		"user_id":      inviterRow["id"],
		"username":     inviterRow["username"],
		"display_name": inviterRow["display_name"],
		"aff_code":     inviterRow["aff_code"],
		"aff_count":    inviterRow["aff_count"],
		"aff_quota":    inviterRow["aff_quota"],
		"aff_history":  inviterRow["aff_history"],
	}

	// Count total invited
	countRow, _ := s.db.QueryOne(s.db.RebindQuery(
		fmt.Sprintf("SELECT COUNT(*) as total FROM users WHERE inviter_id = %d AND deleted_at IS NULL", userID)))
	total := int64(0)
	if countRow != nil {
		total = toInt64(countRow["total"])
	}

	// Get invited users list
	groupCol := "`group`"
	if s.db.IsPG {
		groupCol = `"group"`
	}
	query := fmt.Sprintf(`
		SELECT id, username, display_name, email, status,
			quota, used_quota, request_count, %s, role
		FROM users
		WHERE inviter_id = %d AND deleted_at IS NULL
		ORDER BY id DESC
		LIMIT %d OFFSET %d`,
		groupCol, userID, pageSize, offset)

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}

	// Compute stats
	activeCount := 0
	bannedCount := 0
	totalUsedQuota := int64(0)
	totalRequests := int64(0)
	for _, row := range rows {
		if toInt64(row["request_count"]) > 0 {
			activeCount++
		}
		if toInt64(row["status"]) == 2 {
			bannedCount++
		}
		totalUsedQuota += toInt64(row["used_quota"])
		totalRequests += toInt64(row["request_count"])
	}

	return map[string]interface{}{
		"inviter":   inviter,
		"items":     rows,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
		"stats": map[string]interface{}{
			"total_invited":    total,
			"active_count":     activeCount,
			"banned_count":     bannedCount,
			"total_used_quota": totalUsedQuota,
			"total_requests":   totalRequests,
		},
	}, nil
}

package service

import (
	"fmt"
	"time"

	"github.com/new-api-tools/backend/internal/cache"
	"github.com/new-api-tools/backend/internal/database"
)

// AutoGroupService handles automatic user group assignment
type AutoGroupService struct {
	db *database.Manager
}

// NewAutoGroupService creates a new AutoGroupService
func NewAutoGroupService() *AutoGroupService {
	return &AutoGroupService{db: database.Get()}
}

// Default auto group config
var defaultAutoGroupConfig = map[string]interface{}{
	"enabled":               false,
	"mode":                  "simple",
	"target_group":          "",
	"source_rules":          map[string]string{},
	"scan_interval_minutes": 60,
	"auto_scan_enabled":     false,
	"whitelist_ids":         []int64{},
}

// GetConfig returns auto group configuration
func (s *AutoGroupService) GetConfig() map[string]interface{} {
	cm := cache.Get()
	var config map[string]interface{}
	found, _ := cm.GetJSON("auto_group:config", &config)
	if found {
		return config
	}
	return defaultAutoGroupConfig
}

// SaveConfig saves auto group configuration
func (s *AutoGroupService) SaveConfig(updates map[string]interface{}) bool {
	config := s.GetConfig()
	for k, v := range updates {
		config[k] = v
	}
	cm := cache.Get()
	cm.Set("auto_group:config", config, 0)
	return true
}

// IsEnabled returns whether auto group is enabled
func (s *AutoGroupService) IsEnabled() bool {
	config := s.GetConfig()
	if enabled, ok := config["enabled"].(bool); ok {
		return enabled
	}
	return false
}

// GetStats returns grouping statistics
func (s *AutoGroupService) GetStats() map[string]interface{} {
	// Count users by group
	rows, _ := s.db.Query(`
		SELECT COALESCE(group_id, 'default') as group_name, COUNT(*) as count
		FROM users
		WHERE deleted_at IS NULL
		GROUP BY group_id
		ORDER BY count DESC`)

	totalUsers := int64(0)
	for _, row := range rows {
		totalUsers += toInt64(row["count"])
	}

	return map[string]interface{}{
		"groups":      rows,
		"total_users": totalUsers,
	}
}

// GetAvailableGroups returns all distinct groups from users table
func (s *AutoGroupService) GetAvailableGroups() []map[string]interface{} {
	rows, _ := s.db.Query(`
		SELECT DISTINCT COALESCE(group_id, 'default') as name, COUNT(*) as user_count
		FROM users
		WHERE deleted_at IS NULL
		GROUP BY group_id
		ORDER BY user_count DESC`)
	if rows == nil {
		return []map[string]interface{}{}
	}
	return rows
}

// GetPendingUsers returns users not yet assigned to a group
func (s *AutoGroupService) GetPendingUsers(page, pageSize int) map[string]interface{} {
	offset := (page - 1) * pageSize

	countRow, _ := s.db.QueryOne(
		"SELECT COUNT(*) as total FROM users WHERE (group_id IS NULL OR group_id = '') AND deleted_at IS NULL")
	total := int64(0)
	if countRow != nil {
		total = toInt64(countRow["total"])
	}

	query := fmt.Sprintf(`
		SELECT id, username, email, status, created_time, group_id
		FROM users
		WHERE (group_id IS NULL OR group_id = '') AND deleted_at IS NULL
		ORDER BY created_time DESC
		LIMIT %d OFFSET %d`, pageSize, offset)

	rows, _ := s.db.Query(query)
	totalPages := (total + int64(pageSize) - 1) / int64(pageSize)

	return map[string]interface{}{
		"items":       rows,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": totalPages,
	}
}

// GetUsers returns users with filtering
func (s *AutoGroupService) GetUsers(page, pageSize int, group, source, keyword string) map[string]interface{} {
	offset := (page - 1) * pageSize
	where := "deleted_at IS NULL"

	if group != "" {
		where += fmt.Sprintf(" AND group_id = '%s'", group)
	}
	if keyword != "" {
		where += fmt.Sprintf(" AND (username LIKE '%%%s%%' OR CAST(id AS CHAR) LIKE '%%%s%%')", keyword, keyword)
	}

	countRow, _ := s.db.QueryOne(fmt.Sprintf("SELECT COUNT(*) as total FROM users WHERE %s", where))
	total := int64(0)
	if countRow != nil {
		total = toInt64(countRow["total"])
	}

	query := fmt.Sprintf(`
		SELECT id, username, email, status, created_time, group_id
		FROM users
		WHERE %s
		ORDER BY created_time DESC
		LIMIT %d OFFSET %d`, where, pageSize, offset)

	rows, _ := s.db.Query(query)
	totalPages := (total + int64(pageSize) - 1) / int64(pageSize)

	return map[string]interface{}{
		"items":       rows,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": totalPages,
	}
}

// RunScan executes a group assignment scan
func (s *AutoGroupService) RunScan(dryRun bool) map[string]interface{} {
	config := s.GetConfig()
	targetGroup, _ := config["target_group"].(string)
	if targetGroup == "" {
		return map[string]interface{}{
			"success":  false,
			"message":  "未配置目标分组",
			"affected": 0,
		}
	}

	// Find users without group
	rows, _ := s.db.Query(
		"SELECT id, username FROM users WHERE (group_id IS NULL OR group_id = '') AND deleted_at IS NULL")

	if dryRun {
		return map[string]interface{}{
			"success":      true,
			"message":      fmt.Sprintf("试运行：%d 个用户将被分配到 %s", len(rows), targetGroup),
			"affected":     len(rows),
			"target_group": targetGroup,
			"dry_run":      true,
		}
	}

	affected, err := s.db.Execute(fmt.Sprintf(
		"UPDATE users SET group_id = '%s' WHERE (group_id IS NULL OR group_id = '') AND deleted_at IS NULL",
		targetGroup))
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"message": err.Error(),
		}
	}

	// Log the action
	s.addLog("scan", int(affected), targetGroup, "admin")

	return map[string]interface{}{
		"success":      true,
		"message":      fmt.Sprintf("已将 %d 个用户分配到 %s", affected, targetGroup),
		"affected":     affected,
		"target_group": targetGroup,
		"dry_run":      false,
	}
}

// BatchMoveUsers moves users to a target group
func (s *AutoGroupService) BatchMoveUsers(userIDs []int64, targetGroup string) map[string]interface{} {
	if len(userIDs) == 0 {
		return map[string]interface{}{
			"success": false,
			"message": "未选择用户",
		}
	}

	// Build IN clause
	idStr := ""
	for i, id := range userIDs {
		if i > 0 {
			idStr += ","
		}
		idStr += fmt.Sprintf("%d", id)
	}

	affected, err := s.db.Execute(fmt.Sprintf(
		"UPDATE users SET group_id = '%s' WHERE id IN (%s)", targetGroup, idStr))
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"message": err.Error(),
		}
	}

	s.addLog("batch_move", int(affected), targetGroup, "admin")

	return map[string]interface{}{
		"success":      true,
		"message":      fmt.Sprintf("已移动 %d 个用户到 %s", affected, targetGroup),
		"affected":     affected,
		"target_group": targetGroup,
	}
}

// GetLogs returns group assignment logs
func (s *AutoGroupService) GetLogs(page, pageSize int, action string, userID *int64) map[string]interface{} {
	cm := cache.Get()
	var allLogs []map[string]interface{}
	cm.GetJSON("auto_group:logs", &allLogs)

	// Filter
	filtered := allLogs
	if action != "" {
		filtered = make([]map[string]interface{}, 0)
		for _, log := range allLogs {
			if logAction, ok := log["action"].(string); ok && logAction == action {
				filtered = append(filtered, log)
			}
		}
	}

	total := len(filtered)
	start := (page - 1) * pageSize
	end := start + pageSize
	if start > total {
		start = total
	}
	if end > total {
		end = total
	}

	return map[string]interface{}{
		"items":       filtered[start:end],
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": (total + pageSize - 1) / pageSize,
	}
}

// RevertUser reverts a user's group assignment
func (s *AutoGroupService) RevertUser(logID int) map[string]interface{} {
	// Placeholder - would need to read log and revert
	return map[string]interface{}{
		"success": false,
		"message": "恢复功能需要从日志记录中获取原分组信息",
	}
}

// addLog adds a log entry
func (s *AutoGroupService) addLog(action string, affected int, targetGroup, operator string) {
	cm := cache.Get()
	var logs []map[string]interface{}
	cm.GetJSON("auto_group:logs", &logs)

	entry := map[string]interface{}{
		"id":           len(logs) + 1,
		"action":       action,
		"affected":     affected,
		"target_group": targetGroup,
		"operator":     operator,
		"created_at":   time.Now().Unix(),
	}
	logs = append([]map[string]interface{}{entry}, logs...)

	// Keep only last 1000 logs
	if len(logs) > 1000 {
		logs = logs[:1000]
	}
	cm.Set("auto_group:logs", logs, 0)
}

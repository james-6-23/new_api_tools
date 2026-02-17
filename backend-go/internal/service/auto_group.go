package service

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/new-api-tools/backend/internal/cache"
	"github.com/new-api-tools/backend/internal/database"
	"github.com/new-api-tools/backend/internal/logger"
)

// AutoGroupService handles automatic user group assignment
// Mirrors Python auto_group_service.py functionality
type AutoGroupService struct {
	db *database.Manager
}

// Cached OAuth column existence checks for auto group
var (
	agOAuthColumnsOnce   sync.Once
	agAvailableOAuthCols []string
)

// allAutoGroupOAuthColumns lists all possible OAuth ID columns
var allAutoGroupOAuthColumns = []string{"github_id", "wechat_id", "telegram_id", "discord_id", "oidc_id", "linux_do_id"}

// NewAutoGroupService creates a new AutoGroupService
func NewAutoGroupService() *AutoGroupService {
	return &AutoGroupService{db: database.Get()}
}

// getGroupCol returns the properly quoted column name for "group"
func (s *AutoGroupService) getGroupCol() string {
	if s.db.IsPG {
		return `"group"`
	}
	return "`group`"
}

// getAvailableOAuthColumns returns OAuth columns that exist in the users table (cached)
func (s *AutoGroupService) getAvailableOAuthColumns() []string {
	agOAuthColumnsOnce.Do(func() {
		agAvailableOAuthCols = make([]string, 0)
		for _, col := range allAutoGroupOAuthColumns {
			if s.db.ColumnExists("users", col) {
				agAvailableOAuthCols = append(agAvailableOAuthCols, col)
			}
		}
	})
	return agAvailableOAuthCols
}

// detectSource detects user registration source from OAuth ID fields
func (s *AutoGroupService) detectSource(row map[string]interface{}) string {
	if toString(row["github_id"]) != "" {
		return "github"
	}
	if toString(row["wechat_id"]) != "" {
		return "wechat"
	}
	if toString(row["telegram_id"]) != "" {
		return "telegram"
	}
	if toString(row["discord_id"]) != "" {
		return "discord"
	}
	if toString(row["oidc_id"]) != "" {
		return "oidc"
	}
	if toString(row["linux_do_id"]) != "" {
		return "linux_do"
	}
	return "password"
}

// Default auto group config — matches Python defaults
var defaultAutoGroupConfig = map[string]interface{}{
	"enabled":               false,
	"mode":                  "simple",
	"target_group":          "",
	"source_rules":          map[string]interface{}{"github": "", "wechat": "", "telegram": "", "discord": "", "oidc": "", "linux_do": "", "password": ""},
	"scan_interval_minutes": 60,
	"auto_scan_enabled":     false,
	"whitelist_ids":         []interface{}{},
	"last_scan_time":        0,
}

// GetConfig returns auto group configuration
func (s *AutoGroupService) GetConfig() map[string]interface{} {
	cm := cache.Get()
	var config map[string]interface{}
	found, _ := cm.GetJSON("auto_group:config", &config)
	if found && config != nil {
		// Merge with defaults to ensure all keys exist
		result := make(map[string]interface{})
		for k, v := range defaultAutoGroupConfig {
			result[k] = v
		}
		for k, v := range config {
			result[k] = v
		}
		return result
	}
	// Return a copy of defaults
	result := make(map[string]interface{})
	for k, v := range defaultAutoGroupConfig {
		result[k] = v
	}
	return result
}

// SaveConfig saves auto group configuration
func (s *AutoGroupService) SaveConfig(updates map[string]interface{}) bool {
	config := s.GetConfig()
	for k, v := range updates {
		config[k] = v
	}
	cm := cache.Get()
	if err := cm.Set("auto_group:config", config, 0); err != nil {
		logger.L.Error(fmt.Sprintf("保存自动分组配置失败: %v", err))
		return false
	}
	logger.L.Business("自动分组配置已更新")
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

// getWhitelistIDs extracts whitelist IDs from config
func (s *AutoGroupService) getWhitelistIDs() []int64 {
	config := s.GetConfig()
	rawList, ok := config["whitelist_ids"]
	if !ok || rawList == nil {
		return nil
	}

	var result []int64
	switch list := rawList.(type) {
	case []interface{}:
		for _, v := range list {
			result = append(result, toInt64(v))
		}
	case []int64:
		result = list
	case []float64:
		for _, v := range list {
			result = append(result, int64(v))
		}
	}
	return result
}

// getTargetGroupBySource returns the target group for a given source
func (s *AutoGroupService) getTargetGroupBySource(source string) string {
	config := s.GetConfig()
	mode, _ := config["mode"].(string)

	if mode == "simple" {
		tg, _ := config["target_group"].(string)
		return tg
	}

	// by_source mode
	rules, ok := config["source_rules"].(map[string]interface{})
	if !ok {
		return ""
	}
	tg, _ := rules[source].(string)
	return tg
}

// buildWhitelistCondition builds the SQL condition and args for whitelist exclusion
func (s *AutoGroupService) buildWhitelistCondition(whitelistIDs []int64, argIdx int) (string, []interface{}, int) {
	if len(whitelistIDs) == 0 {
		return "", nil, argIdx
	}

	var args []interface{}
	if s.db.IsPG {
		placeholders := make([]string, len(whitelistIDs))
		for i, id := range whitelistIDs {
			placeholders[i] = fmt.Sprintf("$%d", argIdx)
			args = append(args, id)
			argIdx++
		}
		return fmt.Sprintf("AND id NOT IN (%s)", strings.Join(placeholders, ",")), args, argIdx
	}

	placeholders := make([]string, len(whitelistIDs))
	for i, id := range whitelistIDs {
		placeholders[i] = "?"
		args = append(args, id)
		_ = i
	}
	return fmt.Sprintf("AND id NOT IN (%s)", strings.Join(placeholders, ",")), args, argIdx
}

// buildOAuthSelectCols builds the OAuth column select string
func (s *AutoGroupService) buildOAuthSelectCols() string {
	cols := s.getAvailableOAuthColumns()
	if len(cols) == 0 {
		return ""
	}
	result := ""
	for _, col := range cols {
		result += ", " + col
	}
	return result
}

// GetStats returns grouping statistics — matches Python's get_stats()
func (s *AutoGroupService) GetStats() map[string]interface{} {
	config := s.GetConfig()
	enabled, _ := config["enabled"].(bool)
	autoScanEnabled, _ := config["auto_scan_enabled"].(bool)
	scanInterval := toInt64(config["scan_interval_minutes"])
	lastScanTime := toInt64(config["last_scan_time"])

	groupCol := s.getGroupCol()
	whitelistIDs := s.getWhitelistIDs()

	// Build whitelist condition
	wlCond, wlArgs, _ := s.buildWhitelistCondition(whitelistIDs, 1)

	// Count pending users (default group, active, not whitelisted)
	pendingSQL := fmt.Sprintf(`
		SELECT COUNT(*) as cnt
		FROM users
		WHERE (COALESCE(%s, 'default') = 'default' OR %s = '')
		AND deleted_at IS NULL
		AND status = 1
		%s`, groupCol, groupCol, wlCond)

	if !s.db.IsPG {
		pendingSQL = s.db.RebindQuery(pendingSQL)
	}

	pendingCount := int64(0)
	row, err := s.db.QueryOne(pendingSQL, wlArgs...)
	if err == nil && row != nil {
		pendingCount = toInt64(row["cnt"])
	}

	// Count total assigned from logs
	totalAssigned := int64(0)
	cm := cache.Get()
	var allLogs []map[string]interface{}
	cm.GetJSON("auto_group:logs", &allLogs)
	for _, log := range allLogs {
		if action, _ := log["action"].(string); action == "assign" || action == "scan" {
			totalAssigned += toInt64(log["affected"])
		}
	}

	// Calculate next scan time
	nextScanTime := int64(0)
	if autoScanEnabled && scanInterval > 0 {
		nextScanTime = lastScanTime + (scanInterval * 60)
	}

	return map[string]interface{}{
		"pending_count":     pendingCount,
		"total_assigned":    totalAssigned,
		"last_scan_time":    lastScanTime,
		"next_scan_time":    nextScanTime,
		"enabled":           enabled,
		"auto_scan_enabled": autoScanEnabled,
	}
}

// GetAvailableGroups returns all distinct groups from users table
func (s *AutoGroupService) GetAvailableGroups() []map[string]interface{} {
	groupCol := s.getGroupCol()
	query := fmt.Sprintf(`
		SELECT COALESCE(%s, 'default') as group_name, COUNT(*) as user_count
		FROM users
		WHERE deleted_at IS NULL
		GROUP BY COALESCE(%s, 'default')
		ORDER BY user_count DESC`, groupCol, groupCol)

	rows, err := s.db.Query(query)
	if err != nil {
		logger.L.Error(fmt.Sprintf("获取可用分组列表失败: %v", err))
		return []map[string]interface{}{}
	}
	if rows == nil {
		return []map[string]interface{}{}
	}

	// Normalize output keys
	result := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		result = append(result, map[string]interface{}{
			"group_name": toString(row["group_name"]),
			"user_count": toInt64(row["user_count"]),
		})
	}
	return result
}

// GetPendingUsers returns users not yet assigned to a group
// Matches Python: default group, status=1, not deleted, not whitelisted
func (s *AutoGroupService) GetPendingUsers(page, pageSize int) map[string]interface{} {
	groupCol := s.getGroupCol()
	whitelistIDs := s.getWhitelistIDs()
	oauthCols := s.buildOAuthSelectCols()

	// Build args
	args := make([]interface{}, 0)
	argIdx := 1

	// Build whitelist condition
	wlCond, wlArgs, nextIdx := s.buildWhitelistCondition(whitelistIDs, argIdx)
	args = append(args, wlArgs...)
	argIdx = nextIdx

	// Count total
	countSQL := fmt.Sprintf(`
		SELECT COUNT(*) as cnt
		FROM users
		WHERE (COALESCE(%s, 'default') = 'default' OR %s = '')
		AND deleted_at IS NULL
		AND status = 1
		%s`, groupCol, groupCol, wlCond)

	if !s.db.IsPG {
		countSQL = s.db.RebindQuery(countSQL)
	}

	total := int64(0)
	countRow, err := s.db.QueryOne(countSQL, args...)
	if err == nil && countRow != nil {
		total = toInt64(countRow["cnt"])
	}

	// Get user list
	offset := (page - 1) * pageSize
	var listArgs []interface{}
	listArgs = append(listArgs, args...)

	var listSQL string
	if s.db.IsPG {
		listSQL = fmt.Sprintf(`
			SELECT id, username, display_name, email, %s as user_group, status%s
			FROM users
			WHERE (COALESCE(%s, 'default') = 'default' OR %s = '')
			AND deleted_at IS NULL
			AND status = 1
			%s
			ORDER BY id DESC
			LIMIT $%d OFFSET $%d`,
			groupCol, oauthCols, groupCol, groupCol, wlCond, argIdx, argIdx+1)
		listArgs = append(listArgs, pageSize, offset)
	} else {
		listSQL = fmt.Sprintf(`
			SELECT id, username, display_name, email, %s as user_group, status%s
			FROM users
			WHERE (COALESCE(%s, 'default') = 'default' OR %s = '')
			AND deleted_at IS NULL
			AND status = 1
			%s
			ORDER BY id DESC
			LIMIT ? OFFSET ?`,
			groupCol, oauthCols, groupCol, groupCol, wlCond)
		listArgs = append(listArgs, pageSize, offset)
		listSQL = s.db.RebindQuery(listSQL)
	}

	rows, err := s.db.Query(listSQL, listArgs...)
	if err != nil {
		logger.L.Error(fmt.Sprintf("获取待分配用户列表失败: %v", err))
		rows = nil
	}

	// Build items with source detection
	items := make([]map[string]interface{}, 0)
	for _, row := range rows {
		source := s.detectSource(row)
		items = append(items, map[string]interface{}{
			"id":           toInt64(row["id"]),
			"username":     toString(row["username"]),
			"display_name": toString(row["display_name"]),
			"email":        toString(row["email"]),
			"group":        toString(row["user_group"]),
			"source":       source,
			"status":       toInt64(row["status"]),
		})
	}

	totalPages := int64(0)
	if total > 0 {
		totalPages = (total + int64(pageSize) - 1) / int64(pageSize)
	}

	return map[string]interface{}{
		"items":       items,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": totalPages,
	}
}

// GetUsers returns users with filtering — matches Python's get_users()
func (s *AutoGroupService) GetUsers(page, pageSize int, group, source, keyword string) map[string]interface{} {
	groupCol := s.getGroupCol()
	oauthCols := s.buildOAuthSelectCols()

	offset := (page - 1) * pageSize
	where := []string{"deleted_at IS NULL"}
	args := []interface{}{}
	argIdx := 1

	if group != "" {
		if group == "default" {
			where = append(where, fmt.Sprintf("(COALESCE(%s, 'default') = 'default' OR %s = '')", groupCol, groupCol))
		} else {
			if s.db.IsPG {
				where = append(where, fmt.Sprintf("%s = $%d", groupCol, argIdx))
				argIdx++
			} else {
				where = append(where, fmt.Sprintf("%s = ?", groupCol))
			}
			args = append(args, group)
		}
	}

	if keyword != "" {
		if s.db.IsPG {
			where = append(where, fmt.Sprintf("(username ILIKE $%d OR CAST(id AS TEXT) LIKE $%d)", argIdx, argIdx+1))
			args = append(args, "%"+keyword+"%", "%"+keyword+"%")
			argIdx += 2
		} else {
			where = append(where, "(username LIKE ? OR CAST(id AS CHAR) LIKE ?)")
			args = append(args, "%"+keyword+"%", "%"+keyword+"%")
		}
	}

	whereClause := strings.Join(where, " AND ")

	// Count total
	countSQL := fmt.Sprintf("SELECT COUNT(*) as cnt FROM users WHERE %s", whereClause)
	if !s.db.IsPG {
		countSQL = s.db.RebindQuery(countSQL)
	}
	total := int64(0)
	countRow, err := s.db.QueryOne(countSQL, args...)
	if err == nil && countRow != nil {
		total = toInt64(countRow["cnt"])
	}

	// Get users
	var listArgs []interface{}
	listArgs = append(listArgs, args...)

	var listSQL string
	if s.db.IsPG {
		listSQL = fmt.Sprintf(`
			SELECT id, username, display_name, email, %s as user_group, status%s
			FROM users
			WHERE %s
			ORDER BY id DESC
			LIMIT $%d OFFSET $%d`,
			groupCol, oauthCols, whereClause, argIdx, argIdx+1)
		listArgs = append(listArgs, pageSize, offset)
	} else {
		listSQL = fmt.Sprintf(`
			SELECT id, username, display_name, email, %s as user_group, status%s
			FROM users
			WHERE %s
			ORDER BY id DESC
			LIMIT ? OFFSET ?`,
			groupCol, oauthCols, whereClause)
		listArgs = append(listArgs, pageSize, offset)
		listSQL = s.db.RebindQuery(listSQL)
	}

	rows, err := s.db.Query(listSQL, listArgs...)
	if err != nil {
		logger.L.Error(fmt.Sprintf("获取用户列表失败: %v", err))
		rows = nil
	}

	// Build items with source detection, filter by source if specified
	items := make([]map[string]interface{}, 0)
	for _, row := range rows {
		userSource := s.detectSource(row)
		if source != "" && userSource != source {
			continue
		}
		items = append(items, map[string]interface{}{
			"id":           toInt64(row["id"]),
			"username":     toString(row["username"]),
			"display_name": toString(row["display_name"]),
			"email":        toString(row["email"]),
			"group":        toString(row["user_group"]),
			"source":       userSource,
			"status":       toInt64(row["status"]),
		})
	}

	// If source filter applied, recount total (source is application-level filter)
	if source != "" {
		// Re-query all matching users for accurate count
		allSQL := fmt.Sprintf(`
			SELECT id%s
			FROM users
			WHERE %s`, oauthCols, whereClause)
		filterArgs := make([]interface{}, len(args))
		copy(filterArgs, args)
		if !s.db.IsPG {
			allSQL = s.db.RebindQuery(allSQL)
		}
		allRows, err := s.db.Query(allSQL, filterArgs...)
		if err == nil {
			filteredCount := int64(0)
			for _, row := range allRows {
				if s.detectSource(row) == source {
					filteredCount++
				}
			}
			total = filteredCount
		}
	}

	totalPages := int64(0)
	if total > 0 {
		totalPages = (total + int64(pageSize) - 1) / int64(pageSize)
	}

	return map[string]interface{}{
		"items":       items,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": totalPages,
	}
}

// assignUser assigns a single user to a target group — matches Python's assign_user()
func (s *AutoGroupService) assignUser(userID int64, targetGroup, operator string) map[string]interface{} {
	groupCol := s.getGroupCol()
	oauthCols := s.buildOAuthSelectCols()

	// Get user info
	var userSQL string
	if s.db.IsPG {
		userSQL = fmt.Sprintf(
			"SELECT id, username, %s as user_group%s FROM users WHERE id = $1 AND deleted_at IS NULL",
			groupCol, oauthCols)
	} else {
		userSQL = fmt.Sprintf(
			"SELECT id, username, %s as user_group%s FROM users WHERE id = ? AND deleted_at IS NULL",
			groupCol, oauthCols)
	}

	userRow, err := s.db.QueryOne(userSQL, userID)
	if err != nil || userRow == nil {
		return map[string]interface{}{
			"success": false,
			"message": "用户不存在",
		}
	}

	oldGroup := toString(userRow["user_group"])
	if oldGroup == "" {
		oldGroup = "default"
	}
	username := toString(userRow["username"])
	source := s.detectSource(userRow)

	// Update user group
	var updateSQL string
	if s.db.IsPG {
		updateSQL = fmt.Sprintf("UPDATE users SET %s = $1 WHERE id = $2", groupCol)
	} else {
		updateSQL = fmt.Sprintf("UPDATE users SET %s = ? WHERE id = ?", groupCol)
	}

	_, err = s.db.Execute(updateSQL, targetGroup, userID)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("更新用户分组失败: %v", err),
		}
	}

	// Add log entry
	s.addUserLog("assign", userID, username, oldGroup, targetGroup, source, operator)

	logger.L.Business(fmt.Sprintf("自动分组: 用户分配 user_id=%d username=%s %s -> %s source=%s operator=%s",
		userID, username, oldGroup, targetGroup, source, operator))

	return map[string]interface{}{
		"success":   true,
		"message":   fmt.Sprintf("用户 %s 已分配到 %s", username, targetGroup),
		"user_id":   userID,
		"username":  username,
		"old_group": oldGroup,
		"new_group": targetGroup,
		"source":    source,
	}
}

// RunScan executes a group assignment scan — matches Python's run_scan()
func (s *AutoGroupService) RunScan(dryRun bool) map[string]interface{} {
	config := s.GetConfig()
	mode, _ := config["mode"].(string)

	// Validate configuration
	if mode == "simple" {
		targetGroup, _ := config["target_group"].(string)
		if targetGroup == "" {
			return map[string]interface{}{
				"success": false,
				"message": "未配置目标分组",
			}
		}
	} else if mode == "by_source" {
		rules, _ := config["source_rules"].(map[string]interface{})
		hasAnyRule := false
		if rules != nil {
			for _, v := range rules {
				if s, ok := v.(string); ok && s != "" {
					hasAnyRule = true
					break
				}
			}
		}
		if !hasAnyRule {
			return map[string]interface{}{
				"success": false,
				"message": "未配置任何来源分组规则",
			}
		}
	}

	startTime := time.Now()

	// Get pending users (up to 1000)
	pending := s.GetPendingUsers(1, 1000)
	users, _ := pending["items"].([]map[string]interface{})

	logger.L.Info(fmt.Sprintf("自动分组扫描: 发现 %d 个待分配用户", len(users)))

	results := make([]map[string]interface{}, 0)
	assignedCount := 0
	skippedCount := 0
	errorCount := 0

	for _, user := range users {
		userID := toInt64(user["id"])
		username := toString(user["username"])
		userSource := toString(user["source"])

		// Get target group based on source
		targetGroup := s.getTargetGroupBySource(userSource)

		if targetGroup == "" {
			skippedCount++
			results = append(results, map[string]interface{}{
				"user_id":  userID,
				"username": username,
				"source":   userSource,
				"action":   "skipped",
				"message":  fmt.Sprintf("来源 %s 未配置目标分组", userSource),
			})
			continue
		}

		if dryRun {
			assignedCount++
			results = append(results, map[string]interface{}{
				"user_id":      userID,
				"username":     username,
				"source":       userSource,
				"target_group": targetGroup,
				"action":       "would_assign",
				"message":      fmt.Sprintf("[试运行] 将分配到 %s", targetGroup),
			})
		} else {
			result := s.assignUser(userID, targetGroup, "system")
			if success, _ := result["success"].(bool); success {
				assignedCount++
				results = append(results, map[string]interface{}{
					"user_id":      userID,
					"username":     username,
					"source":       userSource,
					"target_group": targetGroup,
					"action":       "assigned",
					"message":      toString(result["message"]),
				})
			} else {
				errorCount++
				results = append(results, map[string]interface{}{
					"user_id":  userID,
					"username": username,
					"source":   userSource,
					"action":   "error",
					"message":  toString(result["message"]),
				})
			}
		}
	}

	elapsed := time.Since(startTime).Seconds()

	// Update last scan time
	s.SaveConfig(map[string]interface{}{
		"last_scan_time": time.Now().Unix(),
	})

	logger.L.Business(fmt.Sprintf("自动分组扫描完成 dry_run=%v total=%d assigned=%d skipped=%d errors=%d elapsed=%.2fs",
		dryRun, len(users), assignedCount, skippedCount, errorCount, elapsed))

	return map[string]interface{}{
		"success": true,
		"dry_run": dryRun,
		"stats": map[string]interface{}{
			"total":    len(users),
			"assigned": assignedCount,
			"skipped":  skippedCount,
			"errors":   errorCount,
		},
		"elapsed_seconds": fmt.Sprintf("%.2f", elapsed),
		"results":         results,
	}
}

// BatchMoveUsers moves users to a target group — matches Python's batch_move_users()
func (s *AutoGroupService) BatchMoveUsers(userIDs []int64, targetGroup string) map[string]interface{} {
	if len(userIDs) == 0 {
		return map[string]interface{}{
			"success": false,
			"message": "未选择用户",
		}
	}
	if targetGroup == "" {
		return map[string]interface{}{
			"success": false,
			"message": "未指定目标分组",
		}
	}

	successCount := 0
	failedCount := 0
	results := make([]map[string]interface{}, 0)

	for _, userID := range userIDs {
		result := s.assignUser(userID, targetGroup, "admin")
		if success, _ := result["success"].(bool); success {
			successCount++
		} else {
			failedCount++
		}
		results = append(results, result)
	}

	return map[string]interface{}{
		"success":       failedCount == 0,
		"message":       fmt.Sprintf("成功移动 %d 个用户，失败 %d 个", successCount, failedCount),
		"success_count": successCount,
		"failed_count":  failedCount,
		"results":       results,
	}
}

// GetLogs returns group assignment logs — matches Python's get_logs()
func (s *AutoGroupService) GetLogs(page, pageSize int, action string, userID *int64) map[string]interface{} {
	cm := cache.Get()
	var allLogs []map[string]interface{}
	cm.GetJSON("auto_group:logs", &allLogs)

	// Filter
	filtered := make([]map[string]interface{}, 0)
	for _, log := range allLogs {
		if action != "" {
			if logAction, ok := log["action"].(string); !ok || logAction != action {
				continue
			}
		}
		if userID != nil {
			logUserID := toInt64(log["user_id"])
			if logUserID != *userID {
				continue
			}
		}
		filtered = append(filtered, log)
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

	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}

	return map[string]interface{}{
		"items":       filtered[start:end],
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": totalPages,
	}
}

// RevertUser reverts a user's group assignment — matches Python's revert_user()
func (s *AutoGroupService) RevertUser(logID int) map[string]interface{} {
	cm := cache.Get()
	var allLogs []map[string]interface{}
	cm.GetJSON("auto_group:logs", &allLogs)

	// Find the log entry by ID
	var targetLog map[string]interface{}
	for _, log := range allLogs {
		if toInt64(log["id"]) == int64(logID) {
			targetLog = log
			break
		}
	}

	if targetLog == nil {
		return map[string]interface{}{
			"success": false,
			"message": "日志记录不存在",
		}
	}

	userID := toInt64(targetLog["user_id"])
	oldGroup := toString(targetLog["old_group"])
	newGroup := toString(targetLog["new_group"])
	username := toString(targetLog["username"])
	source := toString(targetLog["source"])

	if userID == 0 {
		return map[string]interface{}{
			"success": false,
			"message": "日志记录缺少用户信息，无法恢复",
		}
	}

	groupCol := s.getGroupCol()

	// Check current user group
	var userSQL string
	if s.db.IsPG {
		userSQL = fmt.Sprintf("SELECT id, %s as user_group FROM users WHERE id = $1 AND deleted_at IS NULL", groupCol)
	} else {
		userSQL = fmt.Sprintf("SELECT id, %s as user_group FROM users WHERE id = ? AND deleted_at IS NULL", groupCol)
	}

	userRow, err := s.db.QueryOne(userSQL, userID)
	if err != nil || userRow == nil {
		return map[string]interface{}{
			"success": false,
			"message": "用户不存在",
		}
	}

	currentGroup := toString(userRow["user_group"])
	if currentGroup == "" {
		currentGroup = "default"
	}

	if currentGroup != newGroup {
		return map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("用户当前分组 (%s) 与日志记录不符 (%s)，无法恢复", currentGroup, newGroup),
		}
	}

	// Revert the group
	var updateSQL string
	if s.db.IsPG {
		updateSQL = fmt.Sprintf("UPDATE users SET %s = $1 WHERE id = $2", groupCol)
	} else {
		updateSQL = fmt.Sprintf("UPDATE users SET %s = ? WHERE id = ?", groupCol)
	}

	_, err = s.db.Execute(updateSQL, oldGroup, userID)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("恢复用户分组失败: %v", err),
		}
	}

	// Add revert log
	s.addUserLog("revert", userID, username, newGroup, oldGroup, source, "admin")

	logger.L.Business(fmt.Sprintf("自动分组: 用户恢复 user_id=%d username=%s %s -> %s", userID, username, newGroup, oldGroup))

	return map[string]interface{}{
		"success":   true,
		"message":   fmt.Sprintf("用户 %s 已恢复到 %s", username, oldGroup),
		"user_id":   userID,
		"username":  username,
		"old_group": newGroup,
		"new_group": oldGroup,
	}
}

// addUserLog adds a detailed user-level log entry — matches Python's log recording
func (s *AutoGroupService) addUserLog(action string, userID int64, username, oldGroup, newGroup, source, operator string) {
	cm := cache.Get()
	var logs []map[string]interface{}
	cm.GetJSON("auto_group:logs", &logs)

	entry := map[string]interface{}{
		"id":         len(logs) + 1,
		"action":     action,
		"user_id":    userID,
		"username":   username,
		"old_group":  oldGroup,
		"new_group":  newGroup,
		"source":     source,
		"operator":   operator,
		"affected":   1,
		"created_at": time.Now().Unix(),
	}

	// Prepend (newest first)
	logs = append([]map[string]interface{}{entry}, logs...)

	// Keep only last 1000 logs
	if len(logs) > 1000 {
		logs = logs[:1000]
	}
	cm.Set("auto_group:logs", logs, 0)
}

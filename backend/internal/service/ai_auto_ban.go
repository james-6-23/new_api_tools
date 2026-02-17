package service

import (
	"fmt"
	"strconv"
	"time"

	"github.com/new-api-tools/backend/internal/cache"
	"github.com/new-api-tools/backend/internal/database"
)

// AIAutoBanService handles AI-assisted automatic user banning
type AIAutoBanService struct {
	db *database.Manager
}

// NewAIAutoBanService creates a new AIAutoBanService
func NewAIAutoBanService() *AIAutoBanService {
	return &AIAutoBanService{db: database.Get()}
}

// Default config
var defaultAIBanConfig = map[string]interface{}{
	"base_url":              "",
	"api_key":               "",
	"model":                 "",
	"enabled":               false,
	"dry_run":               true,
	"scan_interval_minutes": 30,
	"custom_prompt":         "",
	"whitelist_ips":         []string{},
	"blacklist_ips":         []string{},
	"excluded_models":       []string{},
	"excluded_groups":       []string{},
}

// GetConfig returns AI auto ban configuration
func (s *AIAutoBanService) GetConfig() map[string]interface{} {
	cm := cache.Get()
	var config map[string]interface{}
	found, _ := cm.GetJSON("ai_ban:config", &config)
	if found {
		return config
	}
	return defaultAIBanConfig
}

// SaveConfig saves AI auto ban configuration
func (s *AIAutoBanService) SaveConfig(updates map[string]interface{}) error {
	config := s.GetConfig()
	for k, v := range updates {
		config[k] = v
	}
	cm := cache.Get()
	cm.Set("ai_ban:config", config, 0)
	return nil
}

// ResetAPIHealth resets the API health status
func (s *AIAutoBanService) ResetAPIHealth() map[string]interface{} {
	cm := cache.Get()
	cm.Delete("ai_ban:api_paused")
	return map[string]interface{}{
		"message": "API 健康状态已重置",
		"status":  "healthy",
	}
}

// GetAuditLogs returns AI audit logs
func (s *AIAutoBanService) GetAuditLogs(limit, offset int, status string) map[string]interface{} {
	cm := cache.Get()
	var allLogs []map[string]interface{}
	cm.GetJSON("ai_ban:audit_logs", &allLogs)

	// Filter by status if provided
	filtered := allLogs
	if status != "" {
		filtered = make([]map[string]interface{}, 0)
		for _, log := range allLogs {
			if logStatus, ok := log["status"].(string); ok && logStatus == status {
				filtered = append(filtered, log)
			}
		}
	}

	total := len(filtered)
	// Paginate
	start := offset
	end := offset + limit
	if start > total {
		start = total
	}
	if end > total {
		end = total
	}

	return map[string]interface{}{
		"items":  filtered[start:end],
		"total":  total,
		"limit":  limit,
		"offset": offset,
	}
}

// ClearAuditLogs clears all AI audit logs
func (s *AIAutoBanService) ClearAuditLogs() map[string]interface{} {
	cm := cache.Get()
	cm.Set("ai_ban:audit_logs", []map[string]interface{}{}, 0)
	return map[string]interface{}{
		"message": "审查记录已清空",
	}
}

// GetAvailableGroups returns groups used in recent logs
func (s *AIAutoBanService) GetAvailableGroups(days int) ([]map[string]interface{}, error) {
	startTime := time.Now().Unix() - int64(days*86400)
	query := s.db.RebindQuery(`
		SELECT DISTINCT group_id as name, COUNT(*) as count
		FROM logs
		WHERE created_at >= ? AND group_id IS NOT NULL AND group_id != ''
		GROUP BY group_id
		ORDER BY count DESC`)

	rows, err := s.db.Query(query, startTime)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// GetAvailableModelsForExclude returns models used in recent logs
func (s *AIAutoBanService) GetAvailableModelsForExclude(days int) ([]map[string]interface{}, error) {
	startTime := time.Now().Unix() - int64(days*86400)
	query := s.db.RebindQuery(`
		SELECT DISTINCT model_name as name, COUNT(*) as count
		FROM logs
		WHERE created_at >= ? AND model_name IS NOT NULL AND model_name != ''
		GROUP BY model_name
		ORDER BY count DESC`)

	rows, err := s.db.Query(query, startTime)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// GetSuspiciousUsers returns users with suspicious behavior patterns
func (s *AIAutoBanService) GetSuspiciousUsers(window string, limit int) ([]map[string]interface{}, error) {
	seconds, ok := WindowSeconds[window]
	if !ok {
		seconds = 3600
	}
	startTime := time.Now().Unix() - seconds

	cacheKey := fmt.Sprintf("ai_ban:suspicious:%s:%d", window, limit)
	cm := cache.Get()
	var cached []map[string]interface{}
	found, _ := cm.GetJSON(cacheKey, &cached)
	if found {
		return cached, nil
	}

	// Find users with high failure rates or unusual patterns
	query := s.db.RebindQuery(`
		SELECT l.user_id, COALESCE(u.username, '') as username,
			COUNT(*) as total_requests,
			SUM(CASE WHEN l.type = 5 THEN 1 ELSE 0 END) as failure_count,
			COALESCE(SUM(l.quota), 0) as total_quota,
			COUNT(DISTINCT l.ip) as unique_ips,
			COUNT(DISTINCT l.model_name) as unique_models
		FROM logs l
		LEFT JOIN users u ON l.user_id = u.id
		WHERE l.created_at >= ? AND l.type IN (2, 5)
		GROUP BY l.user_id, u.username
		HAVING COUNT(*) >= 10
		ORDER BY failure_count DESC, total_requests DESC
		LIMIT ?`)

	rows, err := s.db.Query(query, startTime, limit)
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		total := toInt64(row["total_requests"])
		failures := toInt64(row["failure_count"])
		if total > 0 {
			row["failure_rate"] = float64(failures) / float64(total) * 100
		} else {
			row["failure_rate"] = 0.0
		}
	}

	cm.Set(cacheKey, rows, 2*time.Minute)
	return rows, nil
}

// ManualAssess performs AI assessment on a single user (placeholder)
func (s *AIAutoBanService) ManualAssess(userID int64, window string) map[string]interface{} {
	return map[string]interface{}{
		"user_id":     userID,
		"window":      window,
		"risk_score":  0,
		"risk_level":  "unknown",
		"suggestion":  "AI 评估功能需要配置 API",
		"assessed":    false,
		"assessed_at": time.Now().Unix(),
	}
}

// RunScan performs a scan (placeholder)
func (s *AIAutoBanService) RunScan(window string, limit int) map[string]interface{} {
	return map[string]interface{}{
		"scanned":  0,
		"assessed": 0,
		"banned":   0,
		"dry_run":  true,
		"window":   window,
		"message":  "扫描功能需要配置 AI API",
	}
}

// TestConnection tests the configured API connection (placeholder)
func (s *AIAutoBanService) TestConnection() map[string]interface{} {
	config := s.GetConfig()
	baseURL, _ := config["base_url"].(string)
	if baseURL == "" {
		return map[string]interface{}{
			"success": false,
			"message": "未配置 API Base URL",
		}
	}
	return map[string]interface{}{
		"success": true,
		"message": "连接测试需要在运行时执行",
	}
}

// Whitelist management

// GetWhitelist returns the whitelist user IDs
func (s *AIAutoBanService) GetWhitelist() map[string]interface{} {
	cm := cache.Get()
	var whitelist []int64
	cm.GetJSON("ai_ban:whitelist", &whitelist)

	items := make([]map[string]interface{}, 0)
	if len(whitelist) > 0 {
		// Batch query all whitelist users in one query
		placeholders := buildPlaceholders(s.db.IsPG, len(whitelist), 1)
		args := make([]interface{}, len(whitelist))
		for i, uid := range whitelist {
			args[i] = uid
		}
		query := s.db.RebindQuery(fmt.Sprintf(
			"SELECT id, username, status FROM users WHERE id IN (%s)", placeholders))
		rows, err := s.db.Query(query, args...)
		if err == nil && rows != nil {
			items = rows
		}
	}

	return map[string]interface{}{
		"items": items,
		"total": len(items),
	}
}

// AddToWhitelist adds a user to the whitelist
func (s *AIAutoBanService) AddToWhitelist(userID int64) map[string]interface{} {
	cm := cache.Get()
	var whitelist []int64
	cm.GetJSON("ai_ban:whitelist", &whitelist)

	for _, uid := range whitelist {
		if uid == userID {
			return map[string]interface{}{"message": "用户已在白名单中"}
		}
	}
	whitelist = append(whitelist, userID)
	cm.Set("ai_ban:whitelist", whitelist, 0)
	return map[string]interface{}{"message": fmt.Sprintf("用户 %d 已加入白名单", userID)}
}

// RemoveFromWhitelist removes a user from the whitelist
func (s *AIAutoBanService) RemoveFromWhitelist(userID int64) map[string]interface{} {
	cm := cache.Get()
	var whitelist []int64
	cm.GetJSON("ai_ban:whitelist", &whitelist)

	newList := make([]int64, 0)
	for _, uid := range whitelist {
		if uid != userID {
			newList = append(newList, uid)
		}
	}
	cm.Set("ai_ban:whitelist", newList, 0)
	return map[string]interface{}{"message": fmt.Sprintf("用户 %d 已从白名单移除", userID)}
}

// SearchUserForWhitelist searches users for whitelist addition
func (s *AIAutoBanService) SearchUserForWhitelist(keyword string) ([]map[string]interface{}, error) {
	// Try numeric first (user ID)
	var query string
	var args []interface{}
	if id, err := strconv.ParseInt(keyword, 10, 64); err == nil {
		query = s.db.RebindQuery(
			"SELECT id, username, status FROM users WHERE id = ? OR username LIKE ? LIMIT 20")
		args = []interface{}{id, "%" + keyword + "%"}
	} else {
		query = s.db.RebindQuery(
			"SELECT id, username, status FROM users WHERE username LIKE ? LIMIT 20")
		args = []interface{}{"%" + keyword + "%"}
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

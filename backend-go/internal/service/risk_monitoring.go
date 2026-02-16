package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/new-api-tools/backend/internal/cache"
	"github.com/new-api-tools/backend/internal/database"
)

// RiskMonitoringService handles risk detection queries
type RiskMonitoringService struct {
	db *database.Manager
}

// NewRiskMonitoringService creates a new RiskMonitoringService
func NewRiskMonitoringService() *RiskMonitoringService {
	return &RiskMonitoringService{db: database.Get()}
}

// GetLeaderboards returns usage leaderboards across multiple time windows
func (s *RiskMonitoringService) GetLeaderboards(windows []string, limit int, sortBy string) (map[string]interface{}, error) {
	cm := cache.Get()
	cacheKey := fmt.Sprintf("risk:leaderboards:%s:%d:%s", strings.Join(windows, ","), limit, sortBy)
	var cached map[string]interface{}
	found, _ := cm.GetJSON(cacheKey, &cached)
	if found {
		return cached, nil
	}

	windowsData := map[string]interface{}{}

	for _, window := range windows {
		seconds, ok := WindowSeconds[window]
		if !ok {
			continue
		}
		startTime := time.Now().Unix() - seconds

		orderCol := "request_count"
		if sortBy == "quota" {
			orderCol = "quota_used"
		}

		query := fmt.Sprintf(`
			SELECT l.user_id, COALESCE(u.username, '') as username,
				COUNT(*) as request_count,
				COALESCE(SUM(l.quota), 0) as quota_used,
				SUM(CASE WHEN l.type = 5 THEN 1 ELSE 0 END) as failure_count
			FROM logs l
			LEFT JOIN users u ON l.user_id = u.id
			WHERE l.created_at >= %d AND l.type IN (2, 5)
			GROUP BY l.user_id, u.username
			ORDER BY %s DESC
			LIMIT %d`, startTime, orderCol, limit)

		rows, err := s.db.Query(query)
		if err != nil {
			windowsData[window] = []map[string]interface{}{}
			continue
		}

		// Calculate failure rate
		for _, row := range rows {
			total := toInt64(row["request_count"])
			failures := toInt64(row["failure_count"])
			if total > 0 {
				row["failure_rate"] = float64(failures) / float64(total) * 100
			} else {
				row["failure_rate"] = 0.0
			}
		}

		windowsData[window] = rows
	}

	result := map[string]interface{}{
		"windows":      windowsData,
		"generated_at": time.Now().Unix(),
	}

	cm.Set(cacheKey, result, 3*time.Minute)
	return result, nil
}

// GetUserAnalysis returns detailed risk analysis for a user
func (s *RiskMonitoringService) GetUserAnalysis(userID int64, windowSeconds int64, endTime *int64) (map[string]interface{}, error) {
	now := time.Now().Unix()
	if endTime != nil {
		now = *endTime
	}
	startTime := now - windowSeconds

	// User info
	userRow, _ := s.db.QueryOne(s.db.RebindQuery(
		"SELECT id, username, status, quota, used_quota, request_count FROM users WHERE id = ?"), userID)

	// Usage stats in window
	statsQuery := fmt.Sprintf(`
		SELECT COUNT(*) as total_requests,
			COALESCE(SUM(quota), 0) as total_quota,
			SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_count,
			COUNT(DISTINCT ip) as unique_ips,
			COUNT(DISTINCT token_id) as unique_tokens,
			COUNT(DISTINCT model_name) as unique_models
		FROM logs
		WHERE user_id = %d AND created_at >= %d AND created_at <= %d AND type IN (2, 5)`,
		userID, startTime, now)

	statsRow, _ := s.db.QueryOne(statsQuery)

	// Top models
	modelsQuery := fmt.Sprintf(`
		SELECT model_name, COUNT(*) as request_count, COALESCE(SUM(quota), 0) as quota_used
		FROM logs
		WHERE user_id = %d AND created_at >= %d AND created_at <= %d AND type IN (2, 5)
		GROUP BY model_name
		ORDER BY request_count DESC
		LIMIT 10`, userID, startTime, now)

	models, _ := s.db.Query(modelsQuery)

	// Recent IPs
	ipsQuery := fmt.Sprintf(`
		SELECT ip, COUNT(*) as request_count
		FROM logs
		WHERE user_id = %d AND created_at >= %d AND created_at <= %d AND ip IS NOT NULL AND ip != ''
		GROUP BY ip
		ORDER BY request_count DESC
		LIMIT 20`, userID, startTime, now)

	ips, _ := s.db.Query(ipsQuery)

	result := map[string]interface{}{
		"user":       userRow,
		"stats":      statsRow,
		"top_models": models,
		"recent_ips": ips,
	}

	return result, nil
}

// GetTokenRotationUsers detects token rotation behavior
func (s *RiskMonitoringService) GetTokenRotationUsers(window string, minTokens, maxReqPerToken, limit int) (map[string]interface{}, error) {
	seconds, ok := WindowSeconds[window]
	if !ok {
		seconds = 86400
	}
	startTime := time.Now().Unix() - seconds

	cacheKey := fmt.Sprintf("risk:token_rotation:%s:%d:%d:%d", window, minTokens, maxReqPerToken, limit)
	cm := cache.Get()
	var cached map[string]interface{}
	found, _ := cm.GetJSON(cacheKey, &cached)
	if found {
		return cached, nil
	}

	query := fmt.Sprintf(`
		SELECT l.user_id, COALESCE(u.username, '') as username,
			COUNT(DISTINCT l.token_id) as token_count,
			COUNT(*) as total_requests
		FROM logs l
		LEFT JOIN users u ON l.user_id = u.id
		WHERE l.created_at >= %d AND l.type IN (2, 5)
		GROUP BY l.user_id, u.username
		HAVING COUNT(DISTINCT l.token_id) >= %d
			AND (COUNT(*) * 1.0 / COUNT(DISTINCT l.token_id)) <= %d
		ORDER BY token_count DESC
		LIMIT %d`, startTime, minTokens, maxReqPerToken, limit)

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		total := toInt64(row["total_requests"])
		tokens := toInt64(row["token_count"])
		if tokens > 0 {
			row["avg_requests_per_token"] = float64(total) / float64(tokens)
		}
	}

	result := map[string]interface{}{
		"items":  rows,
		"total":  len(rows),
		"window": window,
	}

	cm.Set(cacheKey, result, 5*time.Minute)
	return result, nil
}

// GetAffiliatedAccounts detects accounts from same inviter
func (s *RiskMonitoringService) GetAffiliatedAccounts(minInvited, limit int) (map[string]interface{}, error) {
	cacheKey := fmt.Sprintf("risk:affiliated:%d:%d", minInvited, limit)
	cm := cache.Get()
	var cached map[string]interface{}
	found, _ := cm.GetJSON(cacheKey, &cached)
	if found {
		return cached, nil
	}

	query := fmt.Sprintf(`
		SELECT inviter_id, COUNT(*) as invited_count
		FROM users
		WHERE inviter_id IS NOT NULL AND inviter_id > 0 AND deleted_at IS NULL
		GROUP BY inviter_id
		HAVING COUNT(*) >= %d
		ORDER BY invited_count DESC
		LIMIT %d`, minInvited, limit)

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}

	result := map[string]interface{}{
		"items":       rows,
		"total":       len(rows),
		"min_invited": minInvited,
	}

	cm.Set(cacheKey, result, 10*time.Minute)
	return result, nil
}

// GetSameIPRegistrations detects accounts registered from same IP
func (s *RiskMonitoringService) GetSameIPRegistrations(window string, minUsers, limit int) (map[string]interface{}, error) {
	seconds, ok := WindowSeconds[window]
	if !ok {
		seconds = 604800
	}
	startTime := time.Now().Unix() - seconds

	cacheKey := fmt.Sprintf("risk:same_ip:%s:%d:%d", window, minUsers, limit)
	cm := cache.Get()
	var cached map[string]interface{}
	found, _ := cm.GetJSON(cacheKey, &cached)
	if found {
		return cached, nil
	}

	// Find IPs with first requests from multiple users
	query := fmt.Sprintf(`
		SELECT first_ip, COUNT(*) as user_count
		FROM (
			SELECT user_id, ip as first_ip
			FROM logs
			WHERE type IN (2, 5) AND ip IS NOT NULL AND ip != ''
			AND created_at >= %d
			GROUP BY user_id, ip
		) sub
		GROUP BY first_ip
		HAVING COUNT(*) >= %d
		ORDER BY user_count DESC
		LIMIT %d`, startTime, minUsers, limit)

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}

	result := map[string]interface{}{
		"items":     rows,
		"total":     len(rows),
		"window":    window,
		"min_users": minUsers,
	}

	cm.Set(cacheKey, result, 10*time.Minute)
	return result, nil
}

// ListBanRecords returns ban/unban audit records (placeholder - reads from storage)
func (s *RiskMonitoringService) ListBanRecords(page, pageSize int, action string, userID *int64) map[string]interface{} {
	return map[string]interface{}{
		"items":       []interface{}{},
		"total":       0,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": 0,
	}
}

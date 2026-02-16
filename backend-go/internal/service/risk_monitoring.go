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
// Returns format matching frontend UserAnalysis interface:
// { range, user, summary, risk, top_models, top_channels, top_ips, recent_logs }
func (s *RiskMonitoringService) GetUserAnalysis(userID int64, windowSeconds int64, endTime *int64) (map[string]interface{}, error) {
	now := time.Now().Unix()
	if endTime != nil {
		now = *endTime
	}
	startTime := now - windowSeconds

	// User info
	groupCol := "`group`"
	if s.db.IsPG {
		groupCol = `"group"`
	}
	userRow, _ := s.db.QueryOne(s.db.RebindQuery(
		fmt.Sprintf("SELECT id, username, display_name, email, status, %s, request_count FROM users WHERE id = ?", groupCol)), userID)

	// Build user object
	userInfo := map[string]interface{}{
		"id":           userID,
		"username":     "",
		"display_name": nil,
		"email":        nil,
		"status":       1,
		"group":        nil,
	}
	if userRow != nil {
		userInfo["id"] = userRow["id"]
		userInfo["username"] = userRow["username"]
		userInfo["display_name"] = userRow["display_name"]
		userInfo["email"] = userRow["email"]
		userInfo["status"] = userRow["status"]
		userInfo["group"] = userRow[groupCol]
	}

	// Usage stats in window
	statsQuery := fmt.Sprintf(`
		SELECT COUNT(*) as total_requests,
			SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as success_requests,
			SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_requests,
			COALESCE(SUM(quota), 0) as quota_used,
			COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
			COALESCE(SUM(completion_tokens), 0) as completion_tokens,
			COUNT(DISTINCT ip) as unique_ips,
			COUNT(DISTINCT token_id) as unique_tokens,
			COUNT(DISTINCT model_name) as unique_models,
			COUNT(DISTINCT channel) as unique_channels
		FROM logs
		WHERE user_id = %d AND created_at >= %d AND created_at <= %d AND type IN (2, 5)`,
		userID, startTime, now)

	statsRow, _ := s.db.QueryOne(statsQuery)

	totalRequests := int64(0)
	successRequests := int64(0)
	failureRequests := int64(0)
	quotaUsed := int64(0)
	promptTokens := int64(0)
	completionTokens := int64(0)
	uniqueIPs := int64(0)
	uniqueTokens := int64(0)
	uniqueModels := int64(0)
	uniqueChannels := int64(0)

	if statsRow != nil {
		totalRequests = toInt64(statsRow["total_requests"])
		successRequests = toInt64(statsRow["success_requests"])
		failureRequests = toInt64(statsRow["failure_requests"])
		quotaUsed = toInt64(statsRow["quota_used"])
		promptTokens = toInt64(statsRow["prompt_tokens"])
		completionTokens = toInt64(statsRow["completion_tokens"])
		uniqueIPs = toInt64(statsRow["unique_ips"])
		uniqueTokens = toInt64(statsRow["unique_tokens"])
		uniqueModels = toInt64(statsRow["unique_models"])
		uniqueChannels = toInt64(statsRow["unique_channels"])
	}

	// Calculate rates
	failureRate := 0.0
	emptyRate := 0.0
	if totalRequests > 0 {
		failureRate = float64(failureRequests) / float64(totalRequests) * 100
	}

	// Average use time
	avgUseTimeQuery := fmt.Sprintf(`
		SELECT COALESCE(AVG(use_time), 0) as avg_use_time
		FROM logs
		WHERE user_id = %d AND created_at >= %d AND created_at <= %d AND type = 2`,
		userID, startTime, now)
	avgRow, _ := s.db.QueryOne(avgUseTimeQuery)
	avgUseTime := 0.0
	if avgRow != nil {
		if v, ok := avgRow["avg_use_time"].(float64); ok {
			avgUseTime = v
		} else {
			avgUseTime = float64(toInt64(avgRow["avg_use_time"]))
		}
	}

	// Summary
	summary := map[string]interface{}{
		"total_requests":    totalRequests,
		"success_requests":  successRequests,
		"failure_requests":  failureRequests,
		"quota_used":        quotaUsed,
		"prompt_tokens":     promptTokens,
		"completion_tokens": completionTokens,
		"avg_use_time":      avgUseTime,
		"unique_ips":        uniqueIPs,
		"unique_tokens":     uniqueTokens,
		"unique_models":     uniqueModels,
		"unique_channels":   uniqueChannels,
		"empty_count":       0,
		"failure_rate":      failureRate,
		"empty_rate":        emptyRate,
	}

	// Risk analysis
	windowMinutes := float64(windowSeconds) / 60.0
	requestsPerMinute := 0.0
	if windowMinutes > 0 {
		requestsPerMinute = float64(totalRequests) / windowMinutes
	}

	avgQuotaPerRequest := 0.0
	if totalRequests > 0 {
		avgQuotaPerRequest = float64(quotaUsed) / float64(totalRequests)
	}

	// Risk flags
	riskFlags := []string{}
	if requestsPerMinute > 5.0 {
		riskFlags = append(riskFlags, "HIGH_RPM")
	}
	if uniqueIPs > 10 {
		riskFlags = append(riskFlags, "MANY_IPS")
	}
	if failureRate > 50.0 && totalRequests > 10 {
		riskFlags = append(riskFlags, "HIGH_FAILURE_RATE")
	}

	risk := map[string]interface{}{
		"requests_per_minute":   requestsPerMinute,
		"avg_quota_per_request": avgQuotaPerRequest,
		"risk_flags":            riskFlags,
	}

	// Top models
	modelsQuery := fmt.Sprintf(`
		SELECT model_name, COUNT(*) as requests,
			COALESCE(SUM(quota), 0) as quota_used,
			SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as success_requests,
			SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_requests
		FROM logs
		WHERE user_id = %d AND created_at >= %d AND created_at <= %d AND type IN (2, 5)
		GROUP BY model_name
		ORDER BY requests DESC
		LIMIT 10`, userID, startTime, now)

	topModels, _ := s.db.Query(modelsQuery)
	if topModels == nil {
		topModels = []map[string]interface{}{}
	}
	// Add empty_count = 0 for each model
	for _, m := range topModels {
		m["empty_count"] = 0
	}

	// Top channels
	channelsQuery := fmt.Sprintf(`
		SELECT channel as channel_id, COUNT(*) as requests,
			COALESCE(SUM(quota), 0) as quota_used
		FROM logs
		WHERE user_id = %d AND created_at >= %d AND created_at <= %d AND type IN (2, 5)
		GROUP BY channel
		ORDER BY requests DESC
		LIMIT 10`, userID, startTime, now)

	topChannels, _ := s.db.Query(channelsQuery)
	if topChannels == nil {
		topChannels = []map[string]interface{}{}
	}
	// Add channel_name placeholder
	for _, ch := range topChannels {
		ch["channel_name"] = fmt.Sprintf("渠道 %v", ch["channel_id"])
	}

	// Top IPs
	ipsQuery := fmt.Sprintf(`
		SELECT ip, COUNT(*) as requests
		FROM logs
		WHERE user_id = %d AND created_at >= %d AND created_at <= %d AND ip IS NOT NULL AND ip != ''
		GROUP BY ip
		ORDER BY requests DESC
		LIMIT 20`, userID, startTime, now)

	topIPs, _ := s.db.Query(ipsQuery)
	if topIPs == nil {
		topIPs = []map[string]interface{}{}
	}

	// Recent logs
	recentLogsQuery := fmt.Sprintf(`
		SELECT l.id, l.created_at, l.type, COALESCE(l.model_name,'') as model_name,
			COALESCE(l.quota, 0) as quota,
			COALESCE(l.prompt_tokens, 0) as prompt_tokens,
			COALESCE(l.completion_tokens, 0) as completion_tokens,
			COALESCE(l.use_time, 0) as use_time,
			COALESCE(l.ip, '') as ip,
			COALESCE(l.channel, 0) as channel,
			COALESCE(t.name, '') as token_name
		FROM logs l
		LEFT JOIN tokens t ON l.token_id = t.id
		WHERE l.user_id = %d AND l.created_at >= %d AND l.created_at <= %d AND l.type IN (2, 5)
		ORDER BY l.created_at DESC
		LIMIT 50`, userID, startTime, now)

	recentLogs, _ := s.db.Query(recentLogsQuery)
	if recentLogs == nil {
		recentLogs = []map[string]interface{}{}
	}
	// Map channel -> channel_name
	for _, log := range recentLogs {
		log["channel_name"] = fmt.Sprintf("渠道 %v", log["channel"])
	}

	result := map[string]interface{}{
		"range": map[string]interface{}{
			"start_time":     startTime,
			"end_time":       now,
			"window_seconds": windowSeconds,
		},
		"user":         userInfo,
		"summary":      summary,
		"risk":         risk,
		"top_models":   topModels,
		"top_channels": topChannels,
		"top_ips":      topIPs,
		"recent_logs":  recentLogs,
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

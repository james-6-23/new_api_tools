package service

import (
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/new-api-tools/backend/internal/cache"
	"github.com/new-api-tools/backend/internal/database"
	"github.com/new-api-tools/backend/internal/logger"
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

	// Validate sortBy to prevent SQL injection via ORDER BY expression
	orderBy := "request_count DESC"
	if sortBy == "quota" {
		orderBy = "quota_used DESC"
	} else if sortBy == "failure_rate" {
		orderBy = "failure_rate DESC, request_count DESC"
	}

	for _, window := range windows {
		seconds, ok := WindowSeconds[window]
		if !ok {
			continue
		}
		now := time.Now().Unix()
		startTime := now - seconds

		query := s.db.RebindQuery(fmt.Sprintf(`
			SELECT l.user_id as user_id,
				COALESCE(
					NULLIF(MAX(u.display_name), ''),
					NULLIF(MAX(u.username), ''),
					NULLIF(MAX(l.username), '')
				) as username,
				COALESCE(MAX(u.status), 0) as user_status,
				COUNT(*) as request_count,
				SUM(CASE WHEN l.type = 5 THEN 1 ELSE 0 END) as failure_requests,
				(SUM(CASE WHEN l.type = 5 THEN 1 ELSE 0 END) * 1.0) / NULLIF(COUNT(*), 0) as failure_rate,
				COALESCE(SUM(l.quota), 0) as quota_used,
				COALESCE(SUM(l.prompt_tokens), 0) as prompt_tokens,
				COALESCE(SUM(l.completion_tokens), 0) as completion_tokens,
				COALESCE(COUNT(DISTINCT NULLIF(l.ip, '')), 0) as unique_ips
			FROM logs l
			LEFT JOIN users u ON u.id = l.user_id AND u.deleted_at IS NULL
			WHERE l.created_at >= ? AND l.created_at <= ?
				AND l.type IN (2, 5)
				AND l.user_id IS NOT NULL
			GROUP BY l.user_id
			ORDER BY %s
			LIMIT ?`, orderBy))

		rows, err := s.db.Query(query, startTime, now, limit)
		if err != nil {
			windowsData[window] = []map[string]interface{}{}
			continue
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
	groupCol := "`group`"
	if s.db.IsPG {
		groupCol = `"group"`
	}
	userRow, _ := s.db.QueryOne(s.db.RebindQuery(
		fmt.Sprintf("SELECT id, username, display_name, email, status, %s, remark, linux_do_id, request_count FROM users WHERE id = ? AND deleted_at IS NULL", groupCol)), userID)

	// Build user object
	userInfo := map[string]interface{}{
		"id":           userID,
		"username":     "",
		"display_name": nil,
		"email":        nil,
		"status":       1,
		"group":        nil,
		"remark":       nil,
		"linux_do_id":  nil,
	}
	if userRow != nil {
		userInfo["id"] = userRow["id"]
		userInfo["username"] = userRow["username"]
		userInfo["display_name"] = userRow["display_name"]
		userInfo["email"] = userRow["email"]
		userInfo["status"] = userRow["status"]
		userInfo["group"] = userRow["group"]
		userInfo["remark"] = userRow["remark"]
		userInfo["linux_do_id"] = userRow["linux_do_id"]
	}

	// Usage stats in window
	statsQuery := s.db.RebindQuery(`
		SELECT COUNT(*) as total_requests,
			SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as success_requests,
			SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_requests,
			COALESCE(SUM(quota), 0) as quota_used,
			COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
			COALESCE(SUM(completion_tokens), 0) as completion_tokens,
			COUNT(DISTINCT NULLIF(ip, '')) as unique_ips,
			COUNT(DISTINCT token_id) as unique_tokens,
			COUNT(DISTINCT model_name) as unique_models,
			COUNT(DISTINCT channel_id) as unique_channels,
			SUM(CASE WHEN type = 2 AND completion_tokens = 0 THEN 1 ELSE 0 END) as empty_count
		FROM logs
		WHERE user_id = ? AND created_at >= ? AND created_at <= ? AND type IN (2, 5)`)

	statsRow, _ := s.db.QueryOne(statsQuery, userID, startTime, now)

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
	emptyCount := int64(0)

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
		emptyCount = toInt64(statsRow["empty_count"])
	}

	// Calculate rates
	failureRate := 0.0
	emptyRate := 0.0
	if totalRequests > 0 {
		failureRate = float64(failureRequests) / float64(totalRequests)
	}
	if successRequests > 0 {
		emptyRate = float64(emptyCount) / float64(successRequests)
	}

	// Average use time
	avgUseTimeQuery := s.db.RebindQuery(`
		SELECT COALESCE(AVG(use_time), 0) as avg_use_time
		FROM logs
		WHERE user_id = ? AND created_at >= ? AND created_at <= ? AND type = 2`)
	avgRow, _ := s.db.QueryOne(avgUseTimeQuery, userID, startTime, now)
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
		"empty_count":       emptyCount,
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

	// IP switch analysis — fetch IP sequence ordered by time
	ipSeqQuery := s.db.RebindQuery(`
		SELECT created_at, ip
		FROM logs
		WHERE user_id = ? AND created_at >= ? AND created_at <= ?
			AND type IN (2, 5) AND ip IS NOT NULL AND ip != ''
		ORDER BY created_at ASC`)
	ipSequence, _ := s.db.Query(ipSeqQuery, userID, startTime, now)
	if ipSequence == nil {
		ipSequence = []map[string]interface{}{}
	}
	ipSwitchAnalysis := analyzeIPSwitches(ipSequence)

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

	// IP switch risk flags (matching Python logic)
	avgIPDuration := toFloat64(ipSwitchAnalysis["avg_ip_duration"])
	rapidSwitchCount := toInt64(ipSwitchAnalysis["rapid_switch_count"])
	realSwitchCount := toInt64(ipSwitchAnalysis["real_switch_count"])
	if rapidSwitchCount >= 3 && avgIPDuration < 300 {
		riskFlags = append(riskFlags, "IP_RAPID_SWITCH")
	}
	if avgIPDuration < 30 && realSwitchCount >= 3 {
		riskFlags = append(riskFlags, "IP_HOPPING")
	}

	// Checkin anomaly detection
	checkin := analyzeCheckins(s.db, userID, startTime, now)
	var checkinAnalysisMap map[string]interface{}
	if checkin != nil && checkin.CheckinCount > 0 {
		requestsPerCheckin := float64(0)
		if checkin.CheckinCount > 0 {
			requestsPerCheckin = float64(totalRequests) / float64(checkin.CheckinCount)
		}
		checkin.RequestsPerCheckin = math.Round(requestsPerCheckin*10) / 10

		checkinAnalysisMap = map[string]interface{}{
			"checkin_count":        checkin.CheckinCount,
			"total_quota_awarded":  checkin.TotalQuotaAwarded,
			"requests_per_checkin": checkin.RequestsPerCheckin,
		}

		// Flag: many checkins but very few requests per checkin
		if checkin.CheckinCount > 3 && requestsPerCheckin < 5 {
			riskFlags = append(riskFlags, "CHECKIN_ANOMALY")
		}
	}

	risk := map[string]interface{}{
		"requests_per_minute":   requestsPerMinute,
		"avg_quota_per_request": avgQuotaPerRequest,
		"risk_flags":            riskFlags,
		"ip_switch_analysis":    ipSwitchAnalysis,
	}
	if checkinAnalysisMap != nil {
		risk["checkin_analysis"] = checkinAnalysisMap
	}

	// Top models
	modelsQuery := s.db.RebindQuery(`
		SELECT COALESCE(model_name, 'unknown') as model_name, COUNT(*) as requests,
			COALESCE(SUM(quota), 0) as quota_used,
			SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as success_requests,
			SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_requests,
			SUM(CASE WHEN type = 2 AND completion_tokens = 0 THEN 1 ELSE 0 END) as empty_count
		FROM logs
		WHERE user_id = ? AND created_at >= ? AND created_at <= ? AND type IN (2, 5)
		GROUP BY COALESCE(model_name, 'unknown')
		ORDER BY requests DESC
		LIMIT 10`)

	topModels, _ := s.db.Query(modelsQuery, userID, startTime, now)
	if topModels == nil {
		topModels = []map[string]interface{}{}
	}

	// Top channels
	channelsQuery := s.db.RebindQuery(`
		SELECT channel_id, COALESCE(MAX(channel_name), '') as channel_name,
			COUNT(*) as requests,
			COALESCE(SUM(quota), 0) as quota_used
		FROM logs
		WHERE user_id = ? AND created_at >= ? AND created_at <= ? AND type IN (2, 5)
		GROUP BY channel_id
		ORDER BY requests DESC
		LIMIT 10`)

	topChannels, _ := s.db.Query(channelsQuery, userID, startTime, now)
	if topChannels == nil {
		topChannels = []map[string]interface{}{}
	}

	// Top IPs
	ipsQuery := s.db.RebindQuery(`
		SELECT ip, COUNT(*) as requests
		FROM logs
		WHERE user_id = ? AND created_at >= ? AND created_at <= ? AND ip IS NOT NULL AND ip != ''
		GROUP BY ip
		ORDER BY requests DESC
		LIMIT 20`)

	topIPs, _ := s.db.Query(ipsQuery, userID, startTime, now)
	if topIPs == nil {
		topIPs = []map[string]interface{}{}
	}

	// Recent logs (token_name and channel_name are directly in logs table)
	recentLogsQuery := s.db.RebindQuery(`
		SELECT id, created_at, type, COALESCE(model_name,'') as model_name,
			COALESCE(quota, 0) as quota,
			COALESCE(prompt_tokens, 0) as prompt_tokens,
			COALESCE(completion_tokens, 0) as completion_tokens,
			COALESCE(use_time, 0) as use_time,
			COALESCE(ip, '') as ip,
			COALESCE(channel_id, 0) as channel_id,
			COALESCE(channel_name, '') as channel_name,
			COALESCE(token_id, 0) as token_id,
			COALESCE(token_name, '') as token_name
		FROM logs
		WHERE user_id = ? AND created_at >= ? AND created_at <= ? AND type IN (2, 5)
		ORDER BY id DESC
		LIMIT 50`)

	recentLogs, _ := s.db.Query(recentLogsQuery, userID, startTime, now)
	if recentLogs == nil {
		recentLogs = []map[string]interface{}{}
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

	query := s.db.RebindQuery(`
		SELECT l.user_id, COALESCE(u.username, '') as username,
			COUNT(DISTINCT l.token_id) as token_count,
			COUNT(*) as total_requests
		FROM logs l
		LEFT JOIN users u ON l.user_id = u.id
		WHERE l.created_at >= ? AND l.type IN (2, 5)
		GROUP BY l.user_id, u.username
		HAVING COUNT(DISTINCT l.token_id) >= ?
			AND (COUNT(*) * 1.0 / COUNT(DISTINCT l.token_id)) <= ?
		ORDER BY token_count DESC
		LIMIT ?`)

	rows, err := s.db.Query(query, startTime, minTokens, maxReqPerToken, limit)
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

	query := s.db.RebindQuery(`
		SELECT inviter_id, COUNT(*) as invited_count
		FROM users
		WHERE inviter_id IS NOT NULL AND inviter_id > 0 AND deleted_at IS NULL
		GROUP BY inviter_id
		HAVING COUNT(*) >= ?
		ORDER BY invited_count DESC
		LIMIT ?`)

	rows, err := s.db.Query(query, minInvited, limit)
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
	query := s.db.RebindQuery(`
		SELECT first_ip, COUNT(*) as user_count
		FROM (
			SELECT user_id, ip as first_ip
			FROM logs
			WHERE type IN (2, 5) AND ip IS NOT NULL AND ip != ''
			AND created_at >= ?
			GROUP BY user_id, ip
		) sub
		GROUP BY first_ip
		HAVING COUNT(*) >= ?
		ORDER BY user_count DESC
		LIMIT ?`)

	rows, err := s.db.Query(query, startTime, minUsers, limit)
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

// ========== Checkin Analysis ==========

var (
	checkinTableOnce   sync.Once
	checkinTableExists bool
)

// checkinAnalysis holds checkin anomaly detection results
type checkinAnalysis struct {
	CheckinCount       int64   `json:"checkin_count"`
	TotalQuotaAwarded  int64   `json:"total_quota_awarded"`
	RequestsPerCheckin float64 `json:"requests_per_checkin"`
}

// analyzeCheckins checks for checkin abuse patterns
func analyzeCheckins(db *database.Manager, userID int64, startTime, endTime int64) *checkinAnalysis {
	checkinTableOnce.Do(func() {
		exists, err := db.TableExists("checkins")
		if err != nil {
			logger.L.Warn("检查 checkins 表失败: " + err.Error())
			return
		}
		checkinTableExists = exists
		if exists {
			logger.L.System("checkins 表已检测到，启用签到分析")
		}
	})

	if !checkinTableExists {
		return nil
	}

	row, err := db.QueryOne(db.RebindQuery(`
		SELECT COUNT(*) as checkin_count,
			COALESCE(SUM(quota), 0) as total_quota_awarded
		FROM checkins
		WHERE user_id = ? AND created_at >= ? AND created_at <= ?`),
		userID, startTime, endTime)
	if err != nil || row == nil {
		return nil
	}

	count := toInt64(row["checkin_count"])
	quotaAwarded := toInt64(row["total_quota_awarded"])

	return &checkinAnalysis{
		CheckinCount:      count,
		TotalQuotaAwarded: quotaAwarded,
	}
}

// ========== IP Switch Analysis ==========

// getIPVersion returns "v4" or "v6" based on the IP string
func getIPVersion(ip string) string {
	if strings.Contains(ip, ":") {
		return "v6"
	}
	return "v4"
}

// analyzeIPSwitches detects IP switching patterns from a time-ordered IP sequence.
// Matches Python's _analyze_ip_switches logic.
func analyzeIPSwitches(ipSequence []map[string]interface{}) map[string]interface{} {
	empty := map[string]interface{}{
		"switch_count":        int64(0),
		"real_switch_count":   int64(0),
		"rapid_switch_count":  int64(0),
		"dual_stack_switches": int64(0),
		"avg_ip_duration":     float64(0),
		"min_switch_interval": int64(0),
		"switch_details":      []map[string]interface{}{},
	}

	if len(ipSequence) < 2 {
		return empty
	}

	type switchDetail struct {
		Time        int64  `json:"time"`
		FromIP      string `json:"from_ip"`
		ToIP        string `json:"to_ip"`
		Interval    int64  `json:"interval"`
		IsDualStack bool   `json:"is_dual_stack"`
		FromVersion string `json:"from_version"`
		ToVersion   string `json:"to_version"`
	}

	var switches []switchDetail
	ipDurations := map[string][]int64{} // track usage duration per IP
	var rapidSwitches int64
	var dualStackSwitches int64

	var prevIP string
	var prevTime int64
	var ipStartTime int64

	for _, row := range ipSequence {
		currentIP := fmt.Sprintf("%v", row["ip"])
		currentTime := toInt64(row["created_at"])
		if currentIP == "" || currentTime == 0 {
			continue
		}

		if prevIP == "" {
			prevIP = currentIP
			prevTime = currentTime
			ipStartTime = currentTime
			continue
		}

		if currentIP != prevIP {
			switchInterval := currentTime - prevTime

			prevVersion := getIPVersion(prevIP)
			currVersion := getIPVersion(currentIP)

			// Detect dual-stack switch (v4 <-> v6)
			isDualStack := false
			isV4V6Switch := (prevVersion == "v4" && currVersion == "v6") ||
				(prevVersion == "v6" && currVersion == "v4")
			if isV4V6Switch {
				// Simple heuristic: v4/v6 switch within 60s is likely dual-stack
				if switchInterval <= 60 {
					isDualStack = true
				}
			}

			switches = append(switches, switchDetail{
				Time:        currentTime,
				FromIP:      prevIP,
				ToIP:        currentIP,
				Interval:    switchInterval,
				IsDualStack: isDualStack,
				FromVersion: prevVersion,
				ToVersion:   currVersion,
			})

			if isDualStack {
				dualStackSwitches++
			} else if switchInterval <= 60 {
				rapidSwitches++
			}

			// Record IP usage duration
			ipDuration := currentTime - ipStartTime
			ipDurations[prevIP] = append(ipDurations[prevIP], ipDuration)

			prevIP = currentIP
			ipStartTime = currentTime
		}

		prevTime = currentTime
	}

	switchCount := int64(len(switches))
	realSwitchCount := switchCount - dualStackSwitches

	// Min switch interval (excluding dual-stack)
	var minSwitchInterval int64
	first := true
	for _, s := range switches {
		if !s.IsDualStack {
			if first || s.Interval < minSwitchInterval {
				minSwitchInterval = s.Interval
				first = false
			}
		}
	}

	// Average IP duration
	var allDurations []int64
	for _, durations := range ipDurations {
		allDurations = append(allDurations, durations...)
	}
	avgIPDuration := float64(0)
	if len(allDurations) > 0 {
		var sum int64
		for _, d := range allDurations {
			sum += d
		}
		avgIPDuration = math.Round(float64(sum)/float64(len(allDurations))*10) / 10
	}

	// Return last 10 switch details
	detailLimit := 10
	startIdx := 0
	if len(switches) > detailLimit {
		startIdx = len(switches) - detailLimit
	}
	recentSwitches := make([]map[string]interface{}, 0, detailLimit)
	for _, s := range switches[startIdx:] {
		recentSwitches = append(recentSwitches, map[string]interface{}{
			"time":          s.Time,
			"from_ip":       s.FromIP,
			"to_ip":         s.ToIP,
			"interval":      s.Interval,
			"is_dual_stack": s.IsDualStack,
			"from_version":  s.FromVersion,
			"to_version":    s.ToVersion,
		})
	}

	return map[string]interface{}{
		"switch_count":        switchCount,
		"real_switch_count":   realSwitchCount,
		"rapid_switch_count":  rapidSwitches,
		"dual_stack_switches": dualStackSwitches,
		"avg_ip_duration":     avgIPDuration,
		"min_switch_interval": minSwitchInterval,
		"switch_details":      recentSwitches,
	}
}

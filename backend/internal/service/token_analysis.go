package service

import (
	"fmt"
	"time"
)

// GetTokenAnalysis 单令牌画像分析：档案 + 窗口统计 + IP 地理分析 + 用量分布。
// 结构对齐 GetUserAnalysis（risk_monitoring.go），查询条件换为 token_id，
// 全部命中 idx_logs_type_created_token / idx_logs_created_token_ip 索引。
func (s *TokenService) GetTokenAnalysis(tokenID int64, windowSeconds int64, endTime *int64) (map[string]interface{}, error) {
	now := time.Now().Unix()
	if endTime != nil {
		now = *endTime
	}
	startTime := now - windowSeconds

	// ===== 令牌档案（tokens + 所属用户） =====
	keyCol := s.keyCol()
	groupCol := s.groupCol()
	tokenRow, err := s.db.QueryOne(s.db.RebindQuery(fmt.Sprintf(`
		SELECT t.id, t.%s as token_key, t.name, t.user_id,
			COALESCE(u.username, '') as username,
			COALESCE(u.status, 1) as user_status,
			t.status, t.remain_quota, t.used_quota, t.unlimited_quota,
			COALESCE(t.allow_ips, '') as allow_ips,
			COALESCE(t.model_limits, '') as model_limits,
			t.%s as token_group,
			COALESCE(t.created_time, 0) as created_time,
			COALESCE(t.expired_time, 0) as expired_time
		FROM tokens t
		LEFT JOIN users u ON t.user_id = u.id
		WHERE t.id = ? AND t.deleted_at IS NULL`, keyCol, groupCol)), tokenID)
	if err != nil {
		return nil, err
	}
	if tokenRow == nil {
		return nil, fmt.Errorf("token %d not found", tokenID)
	}

	tokenInfo := map[string]interface{}{
		"id":              tokenID,
		"key":             MaskTokenKey(fmt.Sprintf("%v", tokenRow["token_key"])),
		"name":            tokenRow["name"],
		"user_id":         tokenRow["user_id"],
		"username":        tokenRow["username"],
		"user_status":     tokenRow["user_status"],
		"status":          tokenRow["status"],
		"remain_quota":    tokenRow["remain_quota"],
		"used_quota":      tokenRow["used_quota"],
		"unlimited_quota": tokenRow["unlimited_quota"],
		"allow_ips":       tokenRow["allow_ips"],
		"model_limits":    tokenRow["model_limits"],
		"group":           tokenRow["token_group"],
		"created_time":    tokenRow["created_time"],
		"expired_time":    tokenRow["expired_time"],
	}

	// ===== 窗口统计 =====
	uniqueIPsExpr := s.logDB.CountDistinctNonEmpty("l.ip")
	statsRow, _ := s.logDB.QueryOne(s.logDB.RebindQuery(fmt.Sprintf(`
		SELECT COUNT(*) as total_requests,
			SUM(CASE WHEN l.type = 2 THEN 1 ELSE 0 END) as success_requests,
			SUM(CASE WHEN l.type = 5 THEN 1 ELSE 0 END) as failure_requests,
			COALESCE(SUM(l.quota), 0) as quota_used,
			COALESCE(SUM(l.prompt_tokens), 0) as prompt_tokens,
			COALESCE(SUM(l.completion_tokens), 0) as completion_tokens,
			COALESCE(AVG(CASE WHEN l.type = 2 THEN l.use_time END), 0) as avg_use_time,
			%s as unique_ips,
			COUNT(DISTINCT l.model_name) as unique_models,
			SUM(CASE WHEN l.type = 2 AND l.completion_tokens = 0 THEN 1 ELSE 0 END) as empty_count
		FROM logs l
		WHERE l.token_id = ? AND l.created_at >= ? AND l.created_at <= ? AND l.type IN (2, 5)`, uniqueIPsExpr)),
		tokenID, startTime, now)

	totalRequests := int64(0)
	successRequests := int64(0)
	failureRequests := int64(0)
	quotaUsed := int64(0)
	uniqueIPs := int64(0)
	emptyCount := int64(0)
	avgUseTime := 0.0
	summary := map[string]interface{}{}
	if statsRow != nil {
		totalRequests = toInt64(statsRow["total_requests"])
		successRequests = toInt64(statsRow["success_requests"])
		failureRequests = toInt64(statsRow["failure_requests"])
		quotaUsed = toInt64(statsRow["quota_used"])
		uniqueIPs = toInt64(statsRow["unique_ips"])
		emptyCount = toInt64(statsRow["empty_count"])
		if v, ok := statsRow["avg_use_time"].(float64); ok {
			avgUseTime = v
		} else {
			avgUseTime = float64(toInt64(statsRow["avg_use_time"]))
		}
	}
	failureRate := 0.0
	emptyRate := 0.0
	if totalRequests > 0 {
		failureRate = float64(failureRequests) / float64(totalRequests)
	}
	if successRequests > 0 {
		emptyRate = float64(emptyCount) / float64(successRequests)
	}
	summary = map[string]interface{}{
		"total_requests":    totalRequests,
		"success_requests":  successRequests,
		"failure_requests":  failureRequests,
		"quota_used":        quotaUsed,
		"prompt_tokens":     toInt64(mapValue(statsRow, "prompt_tokens")),
		"completion_tokens": toInt64(mapValue(statsRow, "completion_tokens")),
		"avg_use_time":      avgUseTime,
		"unique_ips":        uniqueIPs,
		"unique_models":     toInt64(mapValue(statsRow, "unique_models")),
		"empty_count":       emptyCount,
		"failure_rate":      failureRate,
		"empty_rate":        emptyRate,
	}

	// ===== IP 序列 + 跳变/地理分析（复用风控中心逻辑） =====
	ipSequence, _ := s.logDB.QueryWithTimeout(30*time.Second, s.logDB.RebindQuery(`
		SELECT created_at, ip
		FROM logs
		WHERE token_id = ? AND created_at >= ? AND created_at <= ?
			AND type IN (2, 5) AND ip IS NOT NULL AND ip != ''
		ORDER BY created_at ASC`), tokenID, startTime, now)
	if ipSequence == nil {
		ipSequence = []map[string]interface{}{}
	}
	ipSwitchAnalysis := analyzeIPSwitches(ipSequence)

	distinctIPs := collectDistinctIPs(ipSequence)
	geoAvailable := IsIPGeoAvailable()
	var geoMap map[string]IPGeoInfo
	if geoAvailable && len(distinctIPs) > 0 {
		geoMap = LookupIPGeoBatch(distinctIPs)
	} else {
		geoMap = map[string]IPGeoInfo{}
	}
	geoAnalysis := analyzeIPGeoFromSequence(ipSequence, geoMap, geoAvailable)
	if details, ok := ipSwitchAnalysis["switch_details"].([]map[string]interface{}); ok && len(details) > 0 {
		enrichSwitchDetailsWithGeo(details, geoMap)
	}

	// 风险标记
	windowMinutes := float64(windowSeconds) / 60.0
	requestsPerMinute := 0.0
	if windowMinutes > 0 {
		requestsPerMinute = float64(totalRequests) / windowMinutes
	}
	riskFlags := []string{}
	if requestsPerMinute > 5.0 {
		riskFlags = append(riskFlags, "HIGH_RPM")
	}
	if failureRate > 0.5 && totalRequests > 10 {
		riskFlags = append(riskFlags, "HIGH_FAILURE_RATE")
	}
	riskFlags = appendGeoAwareIPRiskFlags(riskFlags, uniqueIPs, ipSwitchAnalysis, geoAnalysis)
	// 令牌特有：无 IP 白名单 + 多 IP = 泄漏重点嫌疑
	if fmt.Sprintf("%v", tokenRow["allow_ips"]) == "" && uniqueIPs >= 5 {
		riskFlags = append(riskFlags, "LEAK_SUSPECT")
	}

	risk := map[string]interface{}{
		"requests_per_minute": requestsPerMinute,
		"risk_flags":          riskFlags,
		"ip_switch_analysis":  ipSwitchAnalysis,
		"ip_geo_analysis":     geoAnalysis,
	}

	// ===== Top 模型 =====
	topModels, _ := s.logDB.Query(s.logDB.RebindQuery(`
		SELECT COALESCE(model_name, 'unknown') as model_name, COUNT(*) as requests,
			COALESCE(SUM(quota), 0) as quota_used,
			SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_requests
		FROM logs
		WHERE token_id = ? AND created_at >= ? AND created_at <= ? AND type IN (2, 5)
		GROUP BY COALESCE(model_name, 'unknown')
		ORDER BY requests DESC
		LIMIT 10`), tokenID, startTime, now)
	if topModels == nil {
		topModels = []map[string]interface{}{}
	}

	// ===== Top IP（带地理标签） =====
	topIPs, _ := s.logDB.QueryWithTimeout(30*time.Second, s.logDB.RebindQuery(`
		SELECT ip, COUNT(*) as requests,
			MIN(created_at) as first_seen,
			MAX(created_at) as last_seen
		FROM logs
		WHERE token_id = ? AND created_at >= ? AND created_at <= ? AND ip IS NOT NULL AND ip != ''
		GROUP BY ip
		ORDER BY requests DESC
		LIMIT 20`), tokenID, startTime, now)
	if topIPs == nil {
		topIPs = []map[string]interface{}{}
	}
	if geoAvailable && len(topIPs) > 0 {
		need := make([]string, 0)
		for _, row := range topIPs {
			ip := fmt.Sprintf("%v", row["ip"])
			if ip == "" {
				continue
			}
			if _, ok := geoMap[ip]; !ok {
				need = append(need, ip)
			}
		}
		if len(need) > 0 {
			for ip, info := range LookupIPGeoBatch(need) {
				geoMap[ip] = info
			}
		}
		for _, row := range topIPs {
			info := geoMap[fmt.Sprintf("%v", row["ip"])]
			row["city"] = info.City
			row["region"] = info.Region
			row["country"] = info.Country
			row["country_code"] = info.CountryCode
			row["geo_label"] = geoDisplayLabel(info)
		}
	}

	// ===== 按小时用量曲线（看突发暴增） =====
	hourly, _ := s.logDB.Query(s.logDB.RebindQuery(fmt.Sprintf(`
		SELECT FLOOR((created_at - %d) / 3600) as slot_idx,
			COUNT(*) as requests,
			COALESCE(SUM(quota), 0) as quota_used
		FROM logs
		WHERE token_id = ? AND created_at >= ? AND created_at <= ? AND type IN (2, 5)
		GROUP BY FLOOR((created_at - %d) / 3600)
		ORDER BY slot_idx ASC`, startTime, startTime)), tokenID, startTime, now)
	if hourly == nil {
		hourly = []map[string]interface{}{}
	}

	// ===== 最近调用 =====
	recentLogs, _ := s.logDB.Query(s.logDB.RebindQuery(`
		SELECT id, created_at, type, COALESCE(model_name,'') as model_name,
			COALESCE(quota, 0) as quota,
			COALESCE(prompt_tokens, 0) as prompt_tokens,
			COALESCE(completion_tokens, 0) as completion_tokens,
			COALESCE(use_time, 0) as use_time,
			COALESCE(ip, '') as ip
		FROM logs
		WHERE token_id = ? AND created_at >= ? AND created_at <= ? AND type IN (2, 5)
		ORDER BY id DESC
		LIMIT 30`), tokenID, startTime, now)
	if recentLogs == nil {
		recentLogs = []map[string]interface{}{}
	}

	return map[string]interface{}{
		"range": map[string]interface{}{
			"start_time":     startTime,
			"end_time":       now,
			"window_seconds": windowSeconds,
		},
		"token":       tokenInfo,
		"summary":     summary,
		"risk":        risk,
		"top_models":  topModels,
		"top_ips":     topIPs,
		"hourly":      hourly,
		"recent_logs": recentLogs,
	}, nil
}

// mapValue 安全取值：row 为 nil 时返回 nil
func mapValue(row map[string]interface{}, key string) interface{} {
	if row == nil {
		return nil
	}
	return row[key]
}

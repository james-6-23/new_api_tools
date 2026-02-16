package service

import (
	"fmt"
	"time"

	"github.com/new-api-tools/backend/internal/cache"
	"github.com/new-api-tools/backend/internal/database"
)

// WindowSeconds maps time window strings to seconds
var WindowSeconds = map[string]int64{
	"1h":  3600,
	"3h":  10800,
	"6h":  21600,
	"12h": 43200,
	"24h": 86400,
	"3d":  259200,
	"7d":  604800,
}

// IPMonitoringService handles IP analysis queries
type IPMonitoringService struct {
	db *database.Manager
}

// NewIPMonitoringService creates a new IPMonitoringService
func NewIPMonitoringService() *IPMonitoringService {
	return &IPMonitoringService{db: database.Get()}
}

// GetIPStats returns IP recording statistics matching the Python format:
// {total_users, enabled_count, disabled_count, enabled_percentage, unique_ips_24h}
func (s *IPMonitoringService) GetIPStats() (map[string]interface{}, error) {
	// Query total users and those with IP recording enabled
	var userSQL string
	if s.db.IsPG {
		userSQL = `
			SELECT
				COUNT(*) as total_users,
				SUM(CASE
					WHEN setting IS NOT NULL AND setting <> ''
						 AND setting::jsonb->>'record_ip_log' = 'true' THEN 1
					ELSE 0
				END) as enabled_count
			FROM users
			WHERE deleted_at IS NULL`
	} else {
		userSQL = `
			SELECT
				COUNT(*) as total_users,
				SUM(CASE
					WHEN setting IS NOT NULL AND setting <> ''
						 AND JSON_EXTRACT(setting, '$.record_ip_log') = true THEN 1
					ELSE 0
				END) as enabled_count
			FROM users
			WHERE deleted_at IS NULL`
	}

	row, err := s.db.QueryOne(userSQL)
	if err != nil {
		return map[string]interface{}{
			"total_users":        0,
			"enabled_count":      0,
			"disabled_count":     0,
			"enabled_percentage": 0.0,
			"unique_ips_24h":     0,
		}, nil
	}

	totalUsers := int64(0)
	enabledCount := int64(0)
	if row != nil {
		totalUsers = toInt64(row["total_users"])
		enabledCount = toInt64(row["enabled_count"])
	}
	disabledCount := totalUsers - enabledCount
	enabledPercentage := 0.0
	if totalUsers > 0 {
		enabledPercentage = float64(enabledCount) / float64(totalUsers) * 100
	}

	// Get unique IPs in last 24h
	startTime := time.Now().Unix() - 86400
	ipRow, _ := s.db.QueryOne(fmt.Sprintf(
		"SELECT COUNT(DISTINCT ip) as unique_ips FROM logs WHERE created_at >= %d AND ip IS NOT NULL AND ip <> ''",
		startTime))
	uniqueIPs := int64(0)
	if ipRow != nil {
		uniqueIPs = toInt64(ipRow["unique_ips"])
	}

	return map[string]interface{}{
		"total_users":        totalUsers,
		"enabled_count":      enabledCount,
		"disabled_count":     disabledCount,
		"enabled_percentage": enabledPercentage,
		"unique_ips_24h":     uniqueIPs,
	}, nil
}

// GetSharedIPs returns IPs used by multiple tokens with full token details
func (s *IPMonitoringService) GetSharedIPs(window string, minTokens, limit int) (map[string]interface{}, error) {
	seconds, ok := WindowSeconds[window]
	if !ok {
		seconds = 86400
	}
	startTime := time.Now().Unix() - seconds

	// Check cache
	cacheKey := fmt.Sprintf("ip:shared:%s:%d:%d", window, minTokens, limit)
	cm := cache.Get()
	var cached map[string]interface{}
	found, _ := cm.GetJSON(cacheKey, &cached)
	if found {
		return cached, nil
	}

	// Get IPs with multiple tokens
	query := fmt.Sprintf(`
		SELECT ip, COUNT(DISTINCT token_id) as token_count,
			COUNT(DISTINCT user_id) as user_count,
			COUNT(*) as request_count
		FROM logs
		WHERE created_at >= %d AND ip IS NOT NULL AND ip <> ''
		GROUP BY ip
		HAVING COUNT(DISTINCT token_id) >= %d
		ORDER BY token_count DESC
		LIMIT %d`, startTime, minTokens, limit)

	rows, err := s.db.Query(query)
	if err != nil {
		return map[string]interface{}{
			"items":      []interface{}{},
			"total":      0,
			"window":     window,
			"min_tokens": minTokens,
		}, nil
	}

	// For each shared IP, get the token details
	for _, row := range rows {
		ip, _ := row["ip"].(string)
		if ip == "" {
			row["tokens"] = []interface{}{}
			continue
		}

		tokenQuery := fmt.Sprintf(`
			SELECT l.token_id,
				COALESCE(t.name, '') as token_name,
				l.user_id,
				COALESCE(u.username, '') as username,
				COUNT(*) as request_count
			FROM logs l
			LEFT JOIN tokens t ON l.token_id = t.id
			LEFT JOIN users u ON l.user_id = u.id
			WHERE l.created_at >= %d AND l.ip = '%s'
			GROUP BY l.token_id, t.name, l.user_id, u.username
			ORDER BY request_count DESC`, startTime, ip)

		tokenRows, err := s.db.Query(tokenQuery)
		if err != nil {
			row["tokens"] = []interface{}{}
		} else {
			row["tokens"] = tokenRows
		}
	}

	result := map[string]interface{}{
		"items":      rows,
		"total":      len(rows),
		"window":     window,
		"min_tokens": minTokens,
	}

	cm.Set(cacheKey, result, 5*time.Minute)
	return result, nil
}

// GetMultiIPTokens returns tokens used from multiple IPs with IP details
func (s *IPMonitoringService) GetMultiIPTokens(window string, minIPs, limit int) (map[string]interface{}, error) {
	seconds, ok := WindowSeconds[window]
	if !ok {
		seconds = 86400
	}
	startTime := time.Now().Unix() - seconds

	cacheKey := fmt.Sprintf("ip:multi_token:%s:%d:%d", window, minIPs, limit)
	cm := cache.Get()
	var cached map[string]interface{}
	found, _ := cm.GetJSON(cacheKey, &cached)
	if found {
		return cached, nil
	}

	query := fmt.Sprintf(`
		SELECT l.token_id, COALESCE(t.name, '') as token_name,
			l.user_id, COALESCE(u.username, '') as username,
			COUNT(DISTINCT l.ip) as ip_count, COUNT(*) as request_count
		FROM logs l
		LEFT JOIN tokens t ON l.token_id = t.id
		LEFT JOIN users u ON l.user_id = u.id
		WHERE l.created_at >= %d AND l.ip IS NOT NULL AND l.ip <> ''
		GROUP BY l.token_id, t.name, l.user_id, u.username
		HAVING COUNT(DISTINCT l.ip) >= %d
		ORDER BY ip_count DESC
		LIMIT %d`, startTime, minIPs, limit)

	rows, err := s.db.Query(query)
	if err != nil {
		return map[string]interface{}{
			"items":   []interface{}{},
			"total":   0,
			"window":  window,
			"min_ips": minIPs,
		}, nil
	}

	// Get IP details for each token
	for _, row := range rows {
		tokenID := toInt64(row["token_id"])
		ipQuery := fmt.Sprintf(`
			SELECT ip, COUNT(*) as request_count
			FROM logs
			WHERE created_at >= %d AND token_id = %d AND ip IS NOT NULL AND ip <> ''
			GROUP BY ip
			ORDER BY request_count DESC
			LIMIT 20`, startTime, tokenID)

		ipRows, err := s.db.Query(ipQuery)
		if err != nil {
			row["ips"] = []interface{}{}
		} else {
			row["ips"] = ipRows
		}
	}

	result := map[string]interface{}{
		"items":   rows,
		"total":   len(rows),
		"window":  window,
		"min_ips": minIPs,
	}

	cm.Set(cacheKey, result, 5*time.Minute)
	return result, nil
}

// GetMultiIPUsers returns users accessing from multiple IPs with top IP details
func (s *IPMonitoringService) GetMultiIPUsers(window string, minIPs, limit int) (map[string]interface{}, error) {
	seconds, ok := WindowSeconds[window]
	if !ok {
		seconds = 86400
	}
	startTime := time.Now().Unix() - seconds

	cacheKey := fmt.Sprintf("ip:multi_user:%s:%d:%d", window, minIPs, limit)
	cm := cache.Get()
	var cached map[string]interface{}
	found, _ := cm.GetJSON(cacheKey, &cached)
	if found {
		return cached, nil
	}

	query := fmt.Sprintf(`
		SELECT l.user_id, COALESCE(u.username, '') as username,
			COUNT(DISTINCT l.ip) as ip_count, COUNT(*) as request_count
		FROM logs l
		LEFT JOIN users u ON l.user_id = u.id
		WHERE l.created_at >= %d AND l.ip IS NOT NULL AND l.ip <> ''
		GROUP BY l.user_id, u.username
		HAVING COUNT(DISTINCT l.ip) >= %d
		ORDER BY ip_count DESC
		LIMIT %d`, startTime, minIPs, limit)

	rows, err := s.db.Query(query)
	if err != nil {
		return map[string]interface{}{
			"items":   []interface{}{},
			"total":   0,
			"window":  window,
			"min_ips": minIPs,
		}, nil
	}

	// Get top IPs for each user
	for _, row := range rows {
		userID := toInt64(row["user_id"])
		ipQuery := fmt.Sprintf(`
			SELECT ip, COUNT(*) as request_count
			FROM logs
			WHERE created_at >= %d AND user_id = %d AND ip IS NOT NULL AND ip <> ''
			GROUP BY ip
			ORDER BY request_count DESC
			LIMIT 10`, startTime, userID)

		ipRows, err := s.db.Query(ipQuery)
		if err != nil {
			row["top_ips"] = []interface{}{}
		} else {
			row["top_ips"] = ipRows
		}
	}

	result := map[string]interface{}{
		"items":   rows,
		"total":   len(rows),
		"window":  window,
		"min_ips": minIPs,
	}

	cm.Set(cacheKey, result, 5*time.Minute)
	return result, nil
}

// LookupIPUsers finds all users/tokens using a specific IP
func (s *IPMonitoringService) LookupIPUsers(ip, window string, limit int) (map[string]interface{}, error) {
	seconds, ok := WindowSeconds[window]
	if !ok {
		seconds = 86400
	}
	startTime := time.Now().Unix() - seconds

	query := fmt.Sprintf(`
		SELECT l.user_id, COALESCE(u.username, '') as username,
			l.token_id, COUNT(*) as request_count,
			MIN(l.created_at) as first_seen, MAX(l.created_at) as last_seen
		FROM logs l
		LEFT JOIN users u ON l.user_id = u.id
		WHERE l.created_at >= %d AND l.ip = '%s'
		GROUP BY l.user_id, u.username, l.token_id
		ORDER BY request_count DESC
		LIMIT %d`, startTime, ip, limit)

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"ip":     ip,
		"items":  rows,
		"total":  len(rows),
		"window": window,
	}, nil
}

// GetUserIPs returns all unique IPs for a user
func (s *IPMonitoringService) GetUserIPs(userID int64, window string) (map[string]interface{}, error) {
	seconds, ok := WindowSeconds[window]
	if !ok {
		seconds = 86400
	}
	startTime := time.Now().Unix() - seconds

	query := fmt.Sprintf(`
		SELECT ip, COUNT(*) as request_count,
			MIN(created_at) as first_seen, MAX(created_at) as last_seen
		FROM logs
		WHERE user_id = %d AND created_at >= %d AND ip IS NOT NULL AND ip <> ''
		GROUP BY ip
		ORDER BY request_count DESC`, userID, startTime)

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"user_id": userID,
		"items":   rows,
		"total":   len(rows),
		"window":  window,
	}, nil
}

// EnableAllIPRecording enables IP recording for all users
func (s *IPMonitoringService) EnableAllIPRecording() (map[string]interface{}, error) {
	affected, err := s.db.Execute("UPDATE tokens SET ip_recording = 1 WHERE ip_recording = 0")
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"affected": affected,
		"message":  fmt.Sprintf("已为 %d 个 Token 开启 IP 记录", affected),
	}, nil
}

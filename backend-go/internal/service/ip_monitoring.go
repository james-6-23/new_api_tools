package service

import (
	"fmt"
	"strings"
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
	ipRow, _ := s.db.QueryOne(s.db.RebindQuery(
		"SELECT COUNT(DISTINCT ip) as unique_ips FROM logs WHERE created_at >= ? AND ip IS NOT NULL AND ip <> ''"),
		startTime)
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

	// Get IPs with multiple tokens — use parameterized queries
	query := s.db.RebindQuery(`
		SELECT ip, COUNT(DISTINCT token_id) as token_count,
			COUNT(DISTINCT user_id) as user_count,
			COUNT(*) as request_count
		FROM logs
		WHERE created_at >= ? AND ip IS NOT NULL AND ip <> ''
		GROUP BY ip
		HAVING COUNT(DISTINCT token_id) >= ?
		ORDER BY token_count DESC
		LIMIT ?`)

	rows, err := s.db.Query(query, startTime, minTokens, limit)
	if err != nil {
		return map[string]interface{}{
			"items":      []interface{}{},
			"total":      0,
			"window":     window,
			"min_tokens": minTokens,
		}, nil
	}

	// Batch fetch token details for all shared IPs
	if len(rows) > 0 {
		ips := make([]interface{}, 0, len(rows))
		for _, row := range rows {
			if ip, _ := row["ip"].(string); ip != "" {
				ips = append(ips, ip)
			}
		}

		if len(ips) > 0 {
			placeholders := buildPlaceholders(s.db.IsPG, len(ips), 2) // start at $2 for PG
			args := []interface{}{startTime}
			args = append(args, ips...)

			tokenQuery := s.db.RebindQuery(fmt.Sprintf(`
				SELECT l.ip, l.token_id,
					COALESCE(t.name, '') as token_name,
					l.user_id,
					COALESCE(u.username, '') as username,
					COUNT(*) as request_count
				FROM logs l
				LEFT JOIN tokens t ON l.token_id = t.id
				LEFT JOIN users u ON l.user_id = u.id
				WHERE l.created_at >= ? AND l.ip IN (%s)
				GROUP BY l.ip, l.token_id, t.name, l.user_id, u.username
				ORDER BY l.ip, request_count DESC`, placeholders))

			tokenRows, err := s.db.Query(tokenQuery, args...)
			if err == nil {
				// Group tokens by IP
				tokensByIP := map[string][]map[string]interface{}{}
				for _, tr := range tokenRows {
					ip := toString(tr["ip"])
					delete(tr, "ip")
					tokensByIP[ip] = append(tokensByIP[ip], tr)
				}
				for _, row := range rows {
					ip, _ := row["ip"].(string)
					if tokens, ok := tokensByIP[ip]; ok {
						row["tokens"] = tokens
					} else {
						row["tokens"] = []interface{}{}
					}
				}
			} else {
				for _, row := range rows {
					row["tokens"] = []interface{}{}
				}
			}
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

	query := s.db.RebindQuery(`
		SELECT l.token_id, COALESCE(t.name, '') as token_name,
			l.user_id, COALESCE(u.username, '') as username,
			COUNT(DISTINCT l.ip) as ip_count, COUNT(*) as request_count
		FROM logs l
		LEFT JOIN tokens t ON l.token_id = t.id
		LEFT JOIN users u ON l.user_id = u.id
		WHERE l.created_at >= ? AND l.ip IS NOT NULL AND l.ip <> ''
		GROUP BY l.token_id, t.name, l.user_id, u.username
		HAVING COUNT(DISTINCT l.ip) >= ?
		ORDER BY ip_count DESC
		LIMIT ?`)

	rows, err := s.db.Query(query, startTime, minIPs, limit)
	if err != nil {
		return map[string]interface{}{
			"items":   []interface{}{},
			"total":   0,
			"window":  window,
			"min_ips": minIPs,
		}, nil
	}

	// Batch fetch IP details for all tokens
	if len(rows) > 0 {
		tokenIDs := make([]interface{}, 0, len(rows))
		for _, row := range rows {
			tokenIDs = append(tokenIDs, toInt64(row["token_id"]))
		}

		placeholders := buildPlaceholders(s.db.IsPG, len(tokenIDs), 2)
		args := []interface{}{startTime}
		args = append(args, tokenIDs...)

		ipQuery := s.db.RebindQuery(fmt.Sprintf(`
			SELECT token_id, ip, COUNT(*) as request_count
			FROM logs
			WHERE created_at >= ? AND token_id IN (%s) AND ip IS NOT NULL AND ip <> ''
			GROUP BY token_id, ip
			ORDER BY token_id, request_count DESC`, placeholders))

		ipRows, err := s.db.Query(ipQuery, args...)
		if err == nil {
			// Group IPs by token_id, limit 20 per token
			ipsByToken := map[int64][]map[string]interface{}{}
			for _, ir := range ipRows {
				tid := toInt64(ir["token_id"])
				if len(ipsByToken[tid]) < 20 {
					delete(ir, "token_id")
					ipsByToken[tid] = append(ipsByToken[tid], ir)
				}
			}
			for _, row := range rows {
				tid := toInt64(row["token_id"])
				if ips, ok := ipsByToken[tid]; ok {
					row["ips"] = ips
				} else {
					row["ips"] = []interface{}{}
				}
			}
		} else {
			for _, row := range rows {
				row["ips"] = []interface{}{}
			}
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

	query := s.db.RebindQuery(`
		SELECT l.user_id, COALESCE(u.username, '') as username,
			COUNT(DISTINCT l.ip) as ip_count, COUNT(*) as request_count
		FROM logs l
		LEFT JOIN users u ON l.user_id = u.id
		WHERE l.created_at >= ? AND l.ip IS NOT NULL AND l.ip <> ''
		GROUP BY l.user_id, u.username
		HAVING COUNT(DISTINCT l.ip) >= ?
		ORDER BY ip_count DESC
		LIMIT ?`)

	rows, err := s.db.Query(query, startTime, minIPs, limit)
	if err != nil {
		return map[string]interface{}{
			"items":   []interface{}{},
			"total":   0,
			"window":  window,
			"min_ips": minIPs,
		}, nil
	}

	// Batch fetch top IPs for all users
	if len(rows) > 0 {
		userIDs := make([]interface{}, 0, len(rows))
		for _, row := range rows {
			userIDs = append(userIDs, toInt64(row["user_id"]))
		}

		placeholders := buildPlaceholders(s.db.IsPG, len(userIDs), 2)
		args := []interface{}{startTime}
		args = append(args, userIDs...)

		ipQuery := s.db.RebindQuery(fmt.Sprintf(`
			SELECT user_id, ip, COUNT(*) as request_count
			FROM logs
			WHERE created_at >= ? AND user_id IN (%s) AND ip IS NOT NULL AND ip <> ''
			GROUP BY user_id, ip
			ORDER BY user_id, request_count DESC`, placeholders))

		ipRows, err := s.db.Query(ipQuery, args...)
		if err == nil {
			// Group IPs by user_id, limit 10 per user
			ipsByUser := map[int64][]map[string]interface{}{}
			for _, ir := range ipRows {
				uid := toInt64(ir["user_id"])
				if len(ipsByUser[uid]) < 10 {
					delete(ir, "user_id")
					ipsByUser[uid] = append(ipsByUser[uid], ir)
				}
			}
			for _, row := range rows {
				uid := toInt64(row["user_id"])
				if ips, ok := ipsByUser[uid]; ok {
					row["top_ips"] = ips
				} else {
					row["top_ips"] = []interface{}{}
				}
			}
		} else {
			for _, row := range rows {
				row["top_ips"] = []interface{}{}
			}
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

	query := s.db.RebindQuery(`
		SELECT l.user_id, COALESCE(u.username, '') as username,
			l.token_id, COALESCE(t.name, '') as token_name,
			COUNT(*) as request_count,
			MIN(l.created_at) as first_seen, MAX(l.created_at) as last_seen
		FROM logs l
		LEFT JOIN users u ON l.user_id = u.id
		LEFT JOIN tokens t ON l.token_id = t.id
		WHERE l.created_at >= ? AND l.ip = ?
		GROUP BY l.user_id, u.username, l.token_id, t.name
		ORDER BY request_count DESC
		LIMIT ?`)

	rows, err := s.db.Query(query, startTime, ip, limit)
	if err != nil {
		return nil, err
	}

	// Calculate aggregated stats
	totalRequests := int64(0)
	uniqueUsers := map[int64]bool{}
	uniqueTokens := map[int64]bool{}
	for _, row := range rows {
		totalRequests += toInt64(row["request_count"])
		uniqueUsers[toInt64(row["user_id"])] = true
		uniqueTokens[toInt64(row["token_id"])] = true
	}

	// Get model usage for this IP
	modelQuery := s.db.RebindQuery(`
		SELECT model_name as model, COUNT(*) as count
		FROM logs
		WHERE created_at >= ? AND ip = ? AND model_name IS NOT NULL AND model_name <> ''
		GROUP BY model_name
		ORDER BY count DESC
		LIMIT 20`)
	modelRows, _ := s.db.Query(modelQuery, startTime, ip)
	if modelRows == nil {
		modelRows = []map[string]interface{}{}
	}

	return map[string]interface{}{
		"ip":             ip,
		"items":          rows,
		"total":          len(rows),
		"window":         window,
		"total_requests": totalRequests,
		"unique_users":   len(uniqueUsers),
		"unique_tokens":  len(uniqueTokens),
		"models":         modelRows,
	}, nil
}

// GetUserIPs returns all unique IPs for a user
func (s *IPMonitoringService) GetUserIPs(userID int64, window string) (map[string]interface{}, error) {
	seconds, ok := WindowSeconds[window]
	if !ok {
		seconds = 86400
	}
	startTime := time.Now().Unix() - seconds

	query := s.db.RebindQuery(`
		SELECT ip, COUNT(*) as request_count,
			MIN(created_at) as first_seen, MAX(created_at) as last_seen
		FROM logs
		WHERE user_id = ? AND created_at >= ? AND ip IS NOT NULL AND ip <> ''
		GROUP BY ip
		ORDER BY request_count DESC`)

	rows, err := s.db.Query(query, userID, startTime)
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

// EnableAllIPRecording enables IP recording for all users by updating the setting JSON field
func (s *IPMonitoringService) EnableAllIPRecording() (map[string]interface{}, error) {
	var updateSQL string
	if s.db.IsPG {
		updateSQL = `
			UPDATE users SET setting =
				CASE
					WHEN setting IS NULL OR setting = '' THEN '{"record_ip_log":true}'::jsonb::text
					ELSE (setting::jsonb || '{"record_ip_log":true}'::jsonb)::text
				END
			WHERE deleted_at IS NULL
			AND (setting IS NULL OR setting = '' OR setting::jsonb->>'record_ip_log' IS NULL OR setting::jsonb->>'record_ip_log' != 'true')`
	} else {
		updateSQL = `
			UPDATE users SET setting =
				CASE
					WHEN setting IS NULL OR setting = '' THEN '{"record_ip_log":true}'
					ELSE JSON_SET(setting, '$.record_ip_log', true)
				END
			WHERE deleted_at IS NULL
			AND (setting IS NULL OR setting = '' OR JSON_EXTRACT(setting, '$.record_ip_log') IS NULL OR JSON_EXTRACT(setting, '$.record_ip_log') != true)`
	}

	affected, err := s.db.Execute(updateSQL)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"affected": affected,
		"message":  fmt.Sprintf("已为 %d 个用户开启 IP 记录", affected),
	}, nil
}

// buildPlaceholders generates SQL placeholders for IN clauses.
// For MySQL: returns "?,?,?" (count times)
// For PostgreSQL: returns "$startIdx,$startIdx+1,..." (count times)
func buildPlaceholders(isPG bool, count, startIdx int) string {
	if count == 0 {
		return ""
	}
	parts := make([]string, count)
	if isPG {
		for i := 0; i < count; i++ {
			parts[i] = fmt.Sprintf("$%d", startIdx+i)
		}
	} else {
		for i := 0; i < count; i++ {
			parts[i] = "?"
		}
	}
	return strings.Join(parts, ",")
}

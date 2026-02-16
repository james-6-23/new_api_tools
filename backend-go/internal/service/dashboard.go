package service

import (
	"fmt"
	"time"

	"github.com/new-api-tools/backend/internal/database"
)

// DashboardService handles dashboard analytics queries
type DashboardService struct {
	db *database.Manager
}

// NewDashboardService creates a new DashboardService
func NewDashboardService() *DashboardService {
	return &DashboardService{db: database.Get()}
}

// parsePeriodToTimestamps converts period strings like "24h", "7d" to start/end timestamps
func parsePeriodToTimestamps(period string) (int64, int64) {
	now := time.Now().Unix()
	var duration time.Duration

	switch period {
	case "1h":
		duration = 1 * time.Hour
	case "6h":
		duration = 6 * time.Hour
	case "24h":
		duration = 24 * time.Hour
	case "3d":
		duration = 3 * 24 * time.Hour
	case "7d":
		duration = 7 * 24 * time.Hour
	case "14d":
		duration = 14 * 24 * time.Hour
	case "30d":
		duration = 30 * 24 * time.Hour
	default:
		duration = 7 * 24 * time.Hour
	}

	start := now - int64(duration.Seconds())
	return start, now
}

// GetSystemOverview returns system overview statistics
func (s *DashboardService) GetSystemOverview(period string) (map[string]interface{}, error) {
	startTime, _ := parsePeriodToTimestamps(period)
	result := map[string]interface{}{}

	// Total users (not deleted)
	row, err := s.db.QueryOne(s.db.RebindQuery(
		"SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL"))
	if err == nil && row != nil {
		result["total_users"] = row["count"]
	}

	// Active users (with requests in period)
	row, err = s.db.QueryOne(s.db.RebindQuery(
		fmt.Sprintf("SELECT COUNT(DISTINCT user_id) as count FROM logs WHERE created_at >= %d AND type IN (2, 5)", startTime)))
	if err == nil && row != nil {
		result["active_users"] = row["count"]
	}

	// Total tokens
	row, err = s.db.QueryOne(s.db.RebindQuery(
		"SELECT COUNT(*) as count FROM tokens WHERE deleted_at IS NULL"))
	if err == nil && row != nil {
		result["total_tokens"] = row["count"]
	}

	// Active tokens (status=1)
	row, err = s.db.QueryOne(s.db.RebindQuery(
		"SELECT COUNT(*) as count FROM tokens WHERE deleted_at IS NULL AND status = 1"))
	if err == nil && row != nil {
		result["active_tokens"] = row["count"]
	}

	// Total channels
	row, err = s.db.QueryOne(s.db.RebindQuery(
		"SELECT COUNT(*) as count FROM channels WHERE deleted_at IS NULL"))
	if err == nil && row != nil {
		result["total_channels"] = row["count"]
	}

	// Active channels (status=1)
	row, err = s.db.QueryOne(s.db.RebindQuery(
		"SELECT COUNT(*) as count FROM channels WHERE deleted_at IS NULL AND status = 1"))
	if err == nil && row != nil {
		result["active_channels"] = row["count"]
	}

	// Total models (distinct from logs)
	row, err = s.db.QueryOne(s.db.RebindQuery(
		"SELECT COUNT(DISTINCT model_name) as count FROM logs WHERE type = 2"))
	if err == nil && row != nil {
		result["total_models"] = row["count"]
	}

	// Redemption count
	row, err = s.db.QueryOne(s.db.RebindQuery(
		"SELECT COUNT(*) as count FROM redemptions WHERE deleted_at IS NULL"))
	if err == nil && row != nil {
		result["total_redemptions"] = row["count"]
	}

	// Unused redemptions
	row, err = s.db.QueryOne(s.db.RebindQuery(
		"SELECT COUNT(*) as count FROM redemptions WHERE deleted_at IS NULL AND status = 1"))
	if err == nil && row != nil {
		result["unused_redemptions"] = row["count"]
	}

	return result, nil
}

// GetUsageStatistics returns usage statistics for a time period
func (s *DashboardService) GetUsageStatistics(period string) (map[string]interface{}, error) {
	startTime, endTime := parsePeriodToTimestamps(period)

	query := fmt.Sprintf(`
		SELECT 
			COUNT(*) as total_requests,
			COALESCE(SUM(quota), 0) as total_quota_used,
			COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
			COALESCE(SUM(completion_tokens), 0) as total_completion_tokens
		FROM logs 
		WHERE created_at >= %d AND created_at <= %d AND type IN (2, 5)`,
		startTime, endTime)

	row, err := s.db.QueryOne(query)
	if err != nil {
		return nil, err
	}

	result := map[string]interface{}{
		"total_requests":          0,
		"total_quota_used":        0,
		"total_prompt_tokens":     0,
		"total_completion_tokens": 0,
		"period":                  period,
	}

	if row != nil {
		result["total_requests"] = row["total_requests"]
		result["total_quota_used"] = row["total_quota_used"]
		result["total_prompt_tokens"] = row["total_prompt_tokens"]
		result["total_completion_tokens"] = row["total_completion_tokens"]
	}

	return result, nil
}

// GetModelUsage returns model usage distribution
func (s *DashboardService) GetModelUsage(period string, limit int) ([]map[string]interface{}, error) {
	startTime, endTime := parsePeriodToTimestamps(period)

	query := fmt.Sprintf(`
		SELECT model_name,
			COUNT(*) as request_count,
			COALESCE(SUM(quota), 0) as quota_used,
			COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
			COALESCE(SUM(completion_tokens), 0) as completion_tokens
		FROM logs
		WHERE created_at >= %d AND created_at <= %d AND type = 2
		GROUP BY model_name
		ORDER BY request_count DESC
		LIMIT %d`,
		startTime, endTime, limit)

	return s.db.Query(query)
}

// GetDailyTrends returns daily usage trends
func (s *DashboardService) GetDailyTrends(days int) ([]map[string]interface{}, error) {
	now := time.Now()
	startTime := now.AddDate(0, 0, -days).Unix()

	var dateExpr string
	if s.db.IsPG {
		dateExpr = "TO_CHAR(TO_TIMESTAMP(created_at), 'YYYY-MM-DD')"
	} else {
		dateExpr = "DATE(FROM_UNIXTIME(created_at))"
	}

	query := fmt.Sprintf(`
		SELECT %s as date,
			COUNT(*) as request_count,
			COALESCE(SUM(quota), 0) as quota_used,
			COUNT(DISTINCT user_id) as unique_users
		FROM logs
		WHERE created_at >= %d AND type IN (2, 5)
		GROUP BY %s
		ORDER BY date ASC`,
		dateExpr, startTime, dateExpr)

	return s.db.Query(query)
}

// GetHourlyTrends returns hourly usage trends
func (s *DashboardService) GetHourlyTrends(hours int) ([]map[string]interface{}, error) {
	startTime := time.Now().Add(-time.Duration(hours) * time.Hour).Unix()

	var hourExpr string
	if s.db.IsPG {
		hourExpr = "TO_CHAR(TO_TIMESTAMP(created_at), 'YYYY-MM-DD HH24:00')"
	} else {
		hourExpr = "DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m-%d %H:00')"
	}

	query := fmt.Sprintf(`
		SELECT %s as hour,
			COUNT(*) as request_count,
			COALESCE(SUM(quota), 0) as quota_used
		FROM logs
		WHERE created_at >= %d AND type IN (2, 5)
		GROUP BY %s
		ORDER BY hour ASC`,
		hourExpr, startTime, hourExpr)

	return s.db.Query(query)
}

// GetTopUsers returns top users by quota usage
func (s *DashboardService) GetTopUsers(period string, limit int) ([]map[string]interface{}, error) {
	startTime, endTime := parsePeriodToTimestamps(period)

	query := fmt.Sprintf(`
		SELECT l.user_id,
			COALESCE(u.username, CAST(l.user_id AS CHAR)) as username,
			COUNT(*) as request_count,
			COALESCE(SUM(l.quota), 0) as quota_used
		FROM logs l
		LEFT JOIN users u ON l.user_id = u.id
		WHERE l.created_at >= %d AND l.created_at <= %d AND l.type IN (2, 5)
		GROUP BY l.user_id, u.username
		ORDER BY quota_used DESC
		LIMIT %d`,
		startTime, endTime, limit)

	if s.db.IsPG {
		query = fmt.Sprintf(`
			SELECT l.user_id,
				COALESCE(u.username, CAST(l.user_id AS TEXT)) as username,
				COUNT(*) as request_count,
				COALESCE(SUM(l.quota), 0) as quota_used
			FROM logs l
			LEFT JOIN users u ON l.user_id = u.id
			WHERE l.created_at >= %d AND l.created_at <= %d AND l.type IN (2, 5)
			GROUP BY l.user_id, u.username
			ORDER BY quota_used DESC
			LIMIT %d`,
			startTime, endTime, limit)
	}

	return s.db.Query(query)
}

// GetChannelStatus returns channel status overview
func (s *DashboardService) GetChannelStatus() ([]map[string]interface{}, error) {
	query := `
		SELECT id, name, type, status, 
			COALESCE(used_quota, 0) as used_quota,
			COALESCE(balance, 0) as balance,
			priority
		FROM channels 
		WHERE deleted_at IS NULL
		ORDER BY priority DESC, id ASC`

	return s.db.Query(query)
}

// GetIPDistribution returns IP access distribution statistics
func (s *DashboardService) GetIPDistribution(window string) (map[string]interface{}, error) {
	startTime, endTime := parsePeriodToTimestamps(window)

	// Get total distinct IPs and requests
	totalQuery := fmt.Sprintf(`
		SELECT COUNT(DISTINCT ip) as total_ips,
			COUNT(*) as total_requests
		FROM logs
		WHERE created_at >= %d AND created_at <= %d AND type IN (2, 5) AND ip IS NOT NULL AND ip <> ''`,
		startTime, endTime)

	summary, _ := s.db.QueryOne(totalQuery)

	totalIPs := int64(0)
	totalRequests := int64(0)
	if summary != nil {
		totalIPs = toInt64(summary["total_ips"])
		totalRequests = toInt64(summary["total_requests"])
	}

	result := map[string]interface{}{
		"total_ips":           totalIPs,
		"total_requests":      totalRequests,
		"domestic_percentage": 0.0,
		"overseas_percentage": 0.0,
		"by_country":          []map[string]interface{}{},
		"by_province":         []map[string]interface{}{},
		"top_cities":          []map[string]interface{}{},
		"snapshot_time":       time.Now().Unix(),
	}

	return result, nil
}

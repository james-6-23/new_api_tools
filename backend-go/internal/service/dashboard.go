package service

import (
	"fmt"
	"math"
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

	// Total channels (channels table has no deleted_at column)
	row, err = s.db.QueryOne(s.db.RebindQuery(
		`SELECT COUNT(*) as total, 
		 SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active 
		 FROM channels`))
	if err == nil && row != nil {
		result["total_channels"] = row["total"]
		result["active_channels"] = row["active"]
	}

	// Total models (from abilities table — count distinct enabled models on active channels)
	row, err = s.db.QueryOne(s.db.RebindQuery(
		`SELECT COUNT(DISTINCT a.model) as count 
		 FROM abilities a
		 INNER JOIN channels c ON c.id = a.channel_id
		 WHERE c.status = 1`))
	if err == nil && row != nil {
		result["total_models"] = row["count"]
	} else {
		// Fallback: try models table
		row, err = s.db.QueryOne(s.db.RebindQuery(
			"SELECT COUNT(*) as count FROM models WHERE deleted_at IS NULL"))
		if err == nil && row != nil {
			result["total_models"] = row["count"]
		}
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

	// Only type=2 (success) for usage stats, matching Python backend
	query := fmt.Sprintf(`
		SELECT 
			COUNT(*) as total_requests,
			COALESCE(SUM(quota), 0) as total_quota_used,
			COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
			COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
			COALESCE(AVG(use_time), 0) as avg_response_time
		FROM logs 
		WHERE created_at >= %d AND created_at <= %d AND type = 2`,
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
		"average_response_time":   float64(0),
		"period":                  period,
	}

	if row != nil {
		result["total_requests"] = row["total_requests"]
		result["total_quota_used"] = row["total_quota_used"]
		result["total_prompt_tokens"] = row["total_prompt_tokens"]
		result["total_completion_tokens"] = row["total_completion_tokens"]
		// Average response time in milliseconds
		if avgTime, ok := row["avg_response_time"]; ok {
			result["average_response_time"] = toFloat64(avgTime)
		}
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

	// Step 1: Query distinct IPs with request counts and user counts
	ipQuery := fmt.Sprintf(`
		SELECT ip, 
			COUNT(*) as request_count,
			COUNT(DISTINCT user_id) as user_count
		FROM logs
		WHERE created_at >= %d AND created_at <= %d AND type IN (2, 5) AND ip IS NOT NULL AND ip <> ''
		GROUP BY ip
		ORDER BY request_count DESC
		LIMIT 3000`, startTime, endTime)

	rows, err := s.db.Query(ipQuery)
	if err != nil || len(rows) == 0 {
		return map[string]interface{}{
			"total_ips":           0,
			"total_requests":      0,
			"domestic_percentage": 0.0,
			"overseas_percentage": 0.0,
			"by_country":          []map[string]interface{}{},
			"by_province":         []map[string]interface{}{},
			"top_cities":          []map[string]interface{}{},
			"snapshot_time":       time.Now().Unix(),
		}, nil
	}

	// Step 2: Collect IPs and look up GeoIP
	geoSvc := GetIPGeoService()

	type ipStat struct {
		IP           string
		RequestCount int64
		UserCount    int64
	}

	var ipStats []ipStat
	var ips []string
	for _, row := range rows {
		ip := fmt.Sprintf("%v", row["ip"])
		if ip == "" || ip == "<nil>" {
			continue
		}
		ipStats = append(ipStats, ipStat{
			IP:           ip,
			RequestCount: toInt64(row["request_count"]),
			UserCount:    toInt64(row["user_count"]),
		})
		ips = append(ips, ip)
	}

	geoResults := geoSvc.QueryBatch(ips)

	// Step 3: Aggregate by country, province, city
	type countryAgg struct {
		CountryCode  string
		IPCount      int64
		RequestCount int64
		UserCount    int64
	}
	type provinceAgg struct {
		Country      string
		CountryCode  string
		IPCount      int64
		RequestCount int64
		UserCount    int64
	}
	type cityAgg struct {
		Country      string
		CountryCode  string
		Region       string
		City         string
		IPCount      int64
		RequestCount int64
		UserCount    int64
	}

	byCountry := map[string]*countryAgg{}
	byProvince := map[string]*provinceAgg{}
	byCity := map[string]*cityAgg{}

	var totalIPs int64
	var totalRequests int64
	var domesticRequests int64
	var overseasRequests int64

	for _, stat := range ipStats {
		geo := geoResults[stat.IP]
		country := geo.Country
		countryCode := geo.CountryCode
		region := geo.Region
		city := geo.City

		if !geo.Success || country == "" {
			country = "未知"
			countryCode = "XX"
		}

		totalIPs++
		totalRequests += stat.RequestCount

		// Domestic vs overseas
		if domesticCountryCodes[countryCode] {
			domesticRequests += stat.RequestCount
		} else {
			overseasRequests += stat.RequestCount
		}

		// By country
		if _, ok := byCountry[country]; !ok {
			byCountry[country] = &countryAgg{CountryCode: countryCode}
		}
		byCountry[country].IPCount++
		byCountry[country].RequestCount += stat.RequestCount
		byCountry[country].UserCount += stat.UserCount

		// By province (Chinese mainland only)
		if countryCode == "CN" && region != "" {
			if _, ok := byProvince[region]; !ok {
				byProvince[region] = &provinceAgg{Country: country, CountryCode: countryCode}
			}
			byProvince[region].IPCount++
			byProvince[region].RequestCount += stat.RequestCount
			byProvince[region].UserCount += stat.UserCount
		}

		// By city
		if city != "" {
			cityKey := fmt.Sprintf("%s:%s:%s", country, region, city)
			if _, ok := byCity[cityKey]; !ok {
				byCity[cityKey] = &cityAgg{Country: country, CountryCode: countryCode, Region: region, City: city}
			}
			byCity[cityKey].IPCount++
			byCity[cityKey].RequestCount += stat.RequestCount
			byCity[cityKey].UserCount += stat.UserCount
		}
	}

	// Step 4: Convert to sorted lists
	countryList := make([]map[string]interface{}, 0, len(byCountry))
	for name, agg := range byCountry {
		pct := float64(0)
		if totalRequests > 0 {
			pct = float64(agg.RequestCount) / float64(totalRequests) * 100
		}
		countryList = append(countryList, map[string]interface{}{
			"country":       name,
			"country_code":  agg.CountryCode,
			"ip_count":      agg.IPCount,
			"request_count": agg.RequestCount,
			"user_count":    agg.UserCount,
			"percentage":    math.Round(pct*100) / 100,
		})
	}
	sortByRequestCount(countryList)

	provinceList := make([]map[string]interface{}, 0, len(byProvince))
	for name, agg := range byProvince {
		pct := float64(0)
		if totalRequests > 0 {
			pct = float64(agg.RequestCount) / float64(totalRequests) * 100
		}
		provinceList = append(provinceList, map[string]interface{}{
			"country":       agg.Country,
			"country_code":  agg.CountryCode,
			"region":        name,
			"ip_count":      agg.IPCount,
			"request_count": agg.RequestCount,
			"user_count":    agg.UserCount,
			"percentage":    math.Round(pct*100) / 100,
		})
	}
	sortByRequestCount(provinceList)

	cityList := make([]map[string]interface{}, 0, len(byCity))
	for _, agg := range byCity {
		pct := float64(0)
		if totalRequests > 0 {
			pct = float64(agg.RequestCount) / float64(totalRequests) * 100
		}
		cityList = append(cityList, map[string]interface{}{
			"country":       agg.Country,
			"country_code":  agg.CountryCode,
			"region":        agg.Region,
			"city":          agg.City,
			"ip_count":      agg.IPCount,
			"request_count": agg.RequestCount,
			"user_count":    agg.UserCount,
			"percentage":    math.Round(pct*100) / 100,
		})
	}
	sortByRequestCount(cityList)

	// Domestic/overseas percentage
	domesticPct := float64(0)
	overseasPct := float64(0)
	if totalRequests > 0 {
		domesticPct = math.Round(float64(domesticRequests)/float64(totalRequests)*10000) / 100
		overseasPct = math.Round(float64(overseasRequests)/float64(totalRequests)*10000) / 100
	}

	return map[string]interface{}{
		"total_ips":           totalIPs,
		"total_requests":      totalRequests,
		"domestic_percentage": domesticPct,
		"overseas_percentage": overseasPct,
		"by_country":          countryList,
		"by_province":         provinceList,
		"top_cities":          cityList,
		"snapshot_time":       time.Now().Unix(),
	}, nil
}

// sortByRequestCount sorts a slice of maps by request_count descending
func sortByRequestCount(list []map[string]interface{}) {
	for i := 0; i < len(list); i++ {
		for j := i + 1; j < len(list); j++ {
			iCount := toInt64(list[i]["request_count"])
			jCount := toInt64(list[j]["request_count"])
			if jCount > iCount {
				list[i], list[j] = list[j], list[i]
			}
		}
	}
}

// toFloat64 safely converts interface{} to float64
func toFloat64(v interface{}) float64 {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case float64:
		return val
	case float32:
		return float64(val)
	case int64:
		return float64(val)
	case int:
		return float64(val)
	case int32:
		return float64(val)
	case string:
		var f float64
		fmt.Sscanf(val, "%f", &f)
		return f
	case []byte:
		var f float64
		fmt.Sscanf(string(val), "%f", &f)
		return f
	default:
		return 0
	}
}

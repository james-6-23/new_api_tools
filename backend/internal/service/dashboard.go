package service

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/new-api-tools/backend/internal/cache"
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
func (s *DashboardService) GetSystemOverview(period string, noCache bool) (map[string]interface{}, error) {
	cm := cache.Get()
	cacheKey := fmt.Sprintf("dashboard:overview:%s", period)
	if !noCache {
		var cached map[string]interface{}
		if found, _ := cm.GetJSON(cacheKey, &cached); found {
			return cached, nil
		}
	}

	startTime, _ := parsePeriodToTimestamps(period)
	result := map[string]interface{}{}

	// Combined query 1: users + tokens counts (reduces 4 queries → 1)
	userTokenQuery := s.db.RebindQuery(`
		SELECT
			(SELECT COUNT(*) FROM users WHERE deleted_at IS NULL) as total_users,
			(SELECT COUNT(DISTINCT user_id) FROM logs WHERE created_at >= ? AND type IN (2, 5)) as active_users,
			(SELECT COUNT(*) FROM tokens WHERE deleted_at IS NULL) as total_tokens,
			(SELECT COUNT(*) FROM tokens WHERE deleted_at IS NULL AND status = 1) as active_tokens`)
	row, err := s.db.QueryOneWithTimeout(15*time.Second, userTokenQuery, startTime)
	if err == nil && row != nil {
		result["total_users"] = row["total_users"]
		result["active_users"] = row["active_users"]
		result["total_tokens"] = row["total_tokens"]
		result["active_tokens"] = row["active_tokens"]
	}

	// Combined query 2: channels
	channelQuery := `SELECT COUNT(*) as total, SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active FROM channels`
	row, err = s.db.QueryOneWithTimeout(10*time.Second, channelQuery)
	if err == nil && row != nil {
		result["total_channels"] = row["total"]
		result["active_channels"] = row["active"]
	}

	// Models count
	row, err = s.db.QueryOneWithTimeout(10*time.Second,
		`SELECT COUNT(DISTINCT a.model) as count
		 FROM abilities a
		 INNER JOIN channels c ON c.id = a.channel_id
		 WHERE c.status = 1`)
	if err == nil && row != nil {
		result["total_models"] = row["count"]
	} else {
		row, err = s.db.QueryOneWithTimeout(10*time.Second,
			"SELECT COUNT(*) as count FROM models WHERE deleted_at IS NULL")
		if err == nil && row != nil {
			result["total_models"] = row["count"]
		}
	}

	// Redemption counts
	row, err = s.db.QueryOneWithTimeout(10*time.Second,
		`SELECT COUNT(*) as total,
		 SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as unused
		 FROM redemptions WHERE deleted_at IS NULL`)
	if err == nil && row != nil {
		result["total_redemptions"] = row["total"]
		result["unused_redemptions"] = row["unused"]
	}

	cm.Set(cacheKey, result, 3*time.Minute)
	return result, nil
}

// GetUsageStatistics returns usage statistics for a time period
func (s *DashboardService) GetUsageStatistics(period string, noCache bool) (map[string]interface{}, error) {
	cm := cache.Get()
	cacheKey := fmt.Sprintf("dashboard:usage:%s", period)
	if !noCache {
		var cached map[string]interface{}
		if found, _ := cm.GetJSON(cacheKey, &cached); found {
			return cached, nil
		}
	}

	startTime, endTime := parsePeriodToTimestamps(period)

	// Only type=2 (success) for usage stats, matching Python backend
	query := s.db.RebindQuery(`
		SELECT
			COUNT(*) as total_requests,
			COALESCE(SUM(quota), 0) as total_quota_used,
			COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
			COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
			COALESCE(AVG(use_time), 0) as avg_response_time
		FROM logs
		WHERE created_at >= ? AND created_at <= ? AND type = 2`)

	row, err := s.db.QueryOneWithTimeout(15*time.Second, query, startTime, endTime)
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

	cm.Set(cacheKey, result, 3*time.Minute)
	return result, nil
}

// GetModelUsage returns model usage distribution
func (s *DashboardService) GetModelUsage(period string, limit int, noCache bool) ([]map[string]interface{}, error) {
	cm := cache.Get()
	cacheKey := fmt.Sprintf("dashboard:models:%s:%d", period, limit)
	if !noCache {
		var cached []map[string]interface{}
		if found, _ := cm.GetJSON(cacheKey, &cached); found {
			return cached, nil
		}
	}

	startTime, endTime := parsePeriodToTimestamps(period)

	query := s.db.RebindQuery(`
		SELECT model_name,
			COUNT(*) as request_count,
			COALESCE(SUM(quota), 0) as quota_used,
			COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
			COALESCE(SUM(completion_tokens), 0) as completion_tokens
		FROM logs
		WHERE created_at >= ? AND created_at <= ? AND type = 2
		GROUP BY model_name
		ORDER BY request_count DESC
		LIMIT ?`)

	rows, err := s.db.QueryWithTimeout(15*time.Second, query, startTime, endTime, limit)
	if err != nil {
		return nil, err
	}
	cm.Set(cacheKey, rows, 3*time.Minute)
	return rows, nil
}

// localTZOffset returns the local timezone offset in seconds (e.g. 28800 for UTC+8).
func localTZOffset() int {
	_, offset := time.Now().Zone()
	return offset
}

// GetDailyTrends returns daily usage trends
func (s *DashboardService) GetDailyTrends(days int, noCache bool) ([]map[string]interface{}, error) {
	cm := cache.Get()
	cacheKey := fmt.Sprintf("dashboard:daily:%d", days)
	if !noCache {
		var cached []map[string]interface{}
		if found, _ := cm.GetJSON(cacheKey, &cached); found {
			return cached, nil
		}
	}

	now := time.Now()
	startTime := now.AddDate(0, 0, -days).Unix()
	tzOffset := localTZOffset()

	// Group by local-time day using pure unix arithmetic — timezone-safe
	dayGroupExpr := fmt.Sprintf("FLOOR((created_at + %d) / 86400)", tzOffset)

	var rows []map[string]interface{}
	var err error

	if IsQuotaDataAvailable() {
		query := s.db.RebindQuery(fmt.Sprintf(`
			SELECT %s as day_group,
				COALESCE(SUM(count), 0) as request_count,
				COALESCE(SUM(quota), 0) as quota_used,
				COUNT(DISTINCT user_id) as unique_users
			FROM quota_data
			WHERE created_at >= ?
			GROUP BY %s
			ORDER BY day_group ASC`,
			dayGroupExpr, dayGroupExpr))
		rows, err = s.db.QueryWithTimeout(30*time.Second, query, startTime)
	} else {
		query := s.db.RebindQuery(fmt.Sprintf(`
			SELECT %s as day_group,
				COUNT(*) as request_count,
				COALESCE(SUM(quota), 0) as quota_used,
				COUNT(DISTINCT user_id) as unique_users
			FROM logs
			WHERE created_at >= ? AND type = 2
			GROUP BY %s
			ORDER BY day_group ASC`,
			dayGroupExpr, dayGroupExpr))
		rows, err = s.db.QueryWithTimeout(30*time.Second, query, startTime)
	}

	if err != nil {
		return nil, err
	}

	rows = fillDailyGaps(rows, days, tzOffset)

	cm.Set(cacheKey, rows, 5*time.Minute)
	return rows, nil
}

// GetHourlyTrends returns hourly usage trends
func (s *DashboardService) GetHourlyTrends(hours int, noCache bool) ([]map[string]interface{}, error) {
	cm := cache.Get()
	cacheKey := fmt.Sprintf("dashboard:hourly:%d", hours)
	if !noCache {
		var cached []map[string]interface{}
		if found, _ := cm.GetJSON(cacheKey, &cached); found {
			return cached, nil
		}
	}

	startTime := time.Now().Add(-time.Duration(hours) * time.Hour).Unix()
	tzOffset := localTZOffset()

	// Group by local-time hour using pure unix arithmetic — timezone-safe
	hourGroupExpr := fmt.Sprintf("FLOOR((created_at + %d) / 3600)", tzOffset)

	query := s.db.RebindQuery(fmt.Sprintf(`
		SELECT %s as hour_group,
			COUNT(*) as request_count,
			COALESCE(SUM(quota), 0) as quota_used
		FROM logs
		WHERE created_at >= ? AND type = 2
		GROUP BY %s
		ORDER BY hour_group ASC`,
		hourGroupExpr, hourGroupExpr))

	rows, err := s.db.QueryWithTimeout(15*time.Second, query, startTime)
	if err != nil {
		return nil, err
	}

	rows = fillHourlyGaps(rows, hours, tzOffset)

	cm.Set(cacheKey, rows, 2*time.Minute)
	return rows, nil
}

// GetTopUsers returns top users by quota usage (subquery-first optimization)
func (s *DashboardService) GetTopUsers(period string, limit int, noCache bool) ([]map[string]interface{}, error) {
	cm := cache.Get()
	cacheKey := fmt.Sprintf("dashboard:topusers:%s:%d", period, limit)
	if !noCache {
		var cached []map[string]interface{}
		if found, _ := cm.GetJSON(cacheKey, &cached); found {
			return cached, nil
		}
	}

	startTime, endTime := parsePeriodToTimestamps(period)

	castExpr := "CAST(sub.user_id AS CHAR)"
	if s.db.IsPG {
		castExpr = "CAST(sub.user_id AS TEXT)"
	}

	// Subquery aggregates first, then JOINs users — avoids scanning users table during GROUP BY
	query := s.db.RebindQuery(fmt.Sprintf(`
		SELECT sub.user_id,
			COALESCE(u.username, %s) as username,
			sub.request_count,
			sub.quota_used
		FROM (
			SELECT user_id,
				COUNT(*) as request_count,
				COALESCE(SUM(quota), 0) as quota_used
			FROM logs
			WHERE created_at >= ? AND created_at <= ? AND type IN (2, 5)
			GROUP BY user_id
			ORDER BY quota_used DESC
			LIMIT ?
		) sub
		LEFT JOIN users u ON sub.user_id = u.id
		ORDER BY sub.quota_used DESC`, castExpr))

	rows, err := s.db.QueryWithTimeout(15*time.Second, query, startTime, endTime, limit)
	if err != nil {
		return nil, err
	}
	cm.Set(cacheKey, rows, 3*time.Minute)
	return rows, nil
}

// InvalidateDashboardCache clears all dashboard-related caches
func (s *DashboardService) InvalidateDashboardCache() {
	cm := cache.Get()
	cm.DeleteByPrefix("dashboard:")
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
	ipQuery := s.db.RebindQuery(`
		SELECT ip,
			COUNT(*) as request_count,
			COUNT(DISTINCT user_id) as user_count
		FROM logs
		WHERE created_at >= ? AND created_at <= ? AND type IN (2, 5) AND ip IS NOT NULL AND ip <> ''
		GROUP BY ip
		ORDER BY request_count DESC
		LIMIT 3000`)

	rows, err := s.db.Query(ipQuery, startTime, endTime)
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

// fillDailyGaps ensures every day in the range has a row.
// Matches DB rows by day_group (FLOOR((unix_ts + tzOffset) / 86400)) for
// timezone-safe bucket matching that is identical to the SQL grouping expression.
func fillDailyGaps(rows []map[string]interface{}, days int, tzOffset int) []map[string]interface{} {
	now := time.Now()
	loc := now.Location()

	// Build lookup keyed by day_group integer
	lookup := make(map[int64]map[string]interface{}, len(rows))
	for _, row := range rows {
		group := toInt64(row["day_group"])
		if group > 0 {
			lookup[group] = row
		}
	}

	result := make([]map[string]interface{}, 0, days)
	for i := days - 1; i >= 0; i-- {
		day := now.AddDate(0, 0, -i)
		dayStart := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc)
		// Compute the same day_group as the SQL expression
		expectedGroup := (dayStart.Unix() + int64(tzOffset)) / 86400
		dateStr := dayStart.Format("2006-01-02")
		ts := dayStart.Unix()

		if existing, ok := lookup[expectedGroup]; ok {
			existing["date"] = dateStr
			existing["timestamp"] = ts
			delete(existing, "day_group")
			result = append(result, existing)
		} else {
			result = append(result, map[string]interface{}{
				"date":          dateStr,
				"timestamp":     ts,
				"request_count": int64(0),
				"quota_used":    int64(0),
				"unique_users":  int64(0),
			})
		}
	}
	return result
}

// fillHourlyGaps ensures every hour in the range has a row.
// Matches DB rows by hour_group (FLOOR((unix_ts + tzOffset) / 3600)) for
// timezone-safe bucket matching that is identical to the SQL grouping expression.
func fillHourlyGaps(rows []map[string]interface{}, hours int, tzOffset int) []map[string]interface{} {
	now := time.Now()
	loc := now.Location()

	// Build lookup keyed by hour_group integer
	lookup := make(map[int64]map[string]interface{}, len(rows))
	for _, row := range rows {
		group := toInt64(row["hour_group"])
		if group > 0 {
			lookup[group] = row
		}
	}

	result := make([]map[string]interface{}, 0, hours)
	for i := hours - 1; i >= 0; i-- {
		t := now.Add(-time.Duration(i) * time.Hour)
		hourStart := time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), 0, 0, 0, loc)
		// Compute the same hour_group as the SQL expression
		expectedGroup := (hourStart.Unix() + int64(tzOffset)) / 3600
		hourStr := hourStart.Format("2006-01-02 15:00")
		ts := hourStart.Unix()

		if existing, ok := lookup[expectedGroup]; ok {
			existing["hour"] = hourStr
			existing["timestamp"] = ts
			delete(existing, "hour_group")
			result = append(result, existing)
		} else {
			result = append(result, map[string]interface{}{
				"hour":          hourStr,
				"timestamp":     ts,
				"request_count": int64(0),
				"quota_used":    int64(0),
			})
		}
	}
	return result
}

// sortByRequestCount sorts a slice of maps by request_count descending using sort.Slice
func sortByRequestCount(list []map[string]interface{}) {
	sort.Slice(list, func(i, j int) bool {
		return toInt64(list[i]["request_count"]) > toInt64(list[j]["request_count"])
	})
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

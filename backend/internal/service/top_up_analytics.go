package service

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/new-api-tools/backend/internal/cache"
	"github.com/new-api-tools/backend/internal/database"
	"github.com/new-api-tools/backend/internal/util"
)

// TopUpTrendPoint represents a single data point in the revenue trend
type TopUpTrendPoint struct {
	Date         string  `json:"date"`
	Timestamp    int64   `json:"timestamp"`
	Count        int64   `json:"count"`
	Money        float64 `json:"money"`
	Amount       int64   `json:"amount"`
	SuccessCount int64   `json:"success_count"`
	SuccessMoney float64 `json:"success_money"`
}

// TopUpFinancialSummary represents a monthly/weekly financial summary
type TopUpFinancialSummary struct {
	Period      string  `json:"period"`
	Revenue     float64 `json:"revenue"`
	Count       int64   `json:"count"`
	AvgOrder    float64 `json:"avg_order"`
	GrowthRate  float64 `json:"growth_rate"`
	Amount      int64   `json:"amount"`
	SuccessRate float64 `json:"success_rate"`
}

// TopUpTopUser represents a top user by recharge amount
type TopUpTopUser struct {
	UserID   int64   `json:"user_id"`
	Username string  `json:"username"`
	Count    int64   `json:"count"`
	Money    float64 `json:"money"`
	Amount   int64   `json:"amount"`
}

// PaymentMethodDistribution represents payment method breakdown
type PaymentMethodDistribution struct {
	Method     string  `json:"method"`
	Count      int64   `json:"count"`
	Money      float64 `json:"money"`
	Percentage float64 `json:"percentage"`
}

// TopUpRealtimeStats represents real-time comparison stats
type TopUpRealtimeStats struct {
	TodayMoney     float64 `json:"today_money"`
	TodayCount     int64   `json:"today_count"`
	YesterdayMoney float64 `json:"yesterday_money"`
	YesterdayCount int64   `json:"yesterday_count"`
	DayGrowth      float64 `json:"day_growth"`
	WeekMoney      float64 `json:"week_money"`
	WeekCount      int64   `json:"week_count"`
	LastWeekMoney  float64 `json:"last_week_money"`
	LastWeekCount  int64   `json:"last_week_count"`
	WeekGrowth     float64 `json:"week_growth"`
	MonthMoney     float64 `json:"month_money"`
	MonthCount     int64   `json:"month_count"`
	LastMonthMoney float64 `json:"last_month_money"`
	LastMonthCount int64   `json:"last_month_count"`
	MonthGrowth    float64 `json:"month_growth"`
}

// HourlyHeatmapPoint represents a single cell in the heatmap
type HourlyHeatmapPoint struct {
	DayOfWeek int     `json:"day_of_week"` // 0=Sunday, 6=Saturday
	Hour      int     `json:"hour"`        // 0-23
	Count     int64   `json:"count"`
	Money     float64 `json:"money"`
}

// successStatusCondition returns the SQL condition for successful top-ups.
// Pass a qualified column (for example "t.status") when the query joins another
// table that also has a status column.
func successStatusCondition(columnRefs ...string) string {
	column := "status"
	if len(columnRefs) > 0 && strings.TrimSpace(columnRefs[0]) != "" {
		column = columnRefs[0]
	}
	trimmed := fmt.Sprintf("TRIM(%s)", column)
	return fmt.Sprintf("(LOWER(%s) IN ('success', 'completed') OR %s = '1')", trimmed, trimmed)
}

// TopUpTrendsParams holds query parameters for revenue trends
type TopUpTrendsParams struct {
	Granularity string // "daily" | "weekly" | "monthly"; default daily
	StartDate   string // "YYYY-MM-DD"; optional
	EndDate     string // "YYYY-MM-DD"; optional
	Days        int    // fallback when StartDate/EndDate are empty; default 30
}

// resolveTrendsRange normalizes params and returns the effective [startTs, endTs] range
// (inclusive) plus the resolved granularity.
func resolveTrendsRange(p TopUpTrendsParams) (granularity string, startTs, endTs int64) {
	granularity = strings.ToLower(strings.TrimSpace(p.Granularity))
	switch granularity {
	case "weekly", "monthly":
	default:
		granularity = "daily"
	}

	days := p.Days
	if days < 1 || days > 365 {
		days = 30
	}

	loc := time.Now().Location()
	now := time.Now().In(loc)
	endOfToday := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 0, loc)

	var sTs, eTs int64
	customRange := false
	if p.StartDate != "" && p.EndDate != "" {
		s, errS := util.ParseDateToTimestampPublic(p.StartDate, false)
		e, errE := util.ParseDateToTimestampPublic(p.EndDate, true)
		if errS == nil && errE == nil && s <= e {
			sTs, eTs = s, e
			customRange = true
		}
	}
	if !customRange {
		startDay := now.AddDate(0, 0, -(days - 1))
		startTs = time.Date(startDay.Year(), startDay.Month(), startDay.Day(), 0, 0, 0, 0, loc).Unix()
		endTs = endOfToday.Unix()
		return
	}
	startTs, endTs = sTs, eTs
	return
}

// GetTopUpTrends returns revenue trends with configurable granularity and date range
func GetTopUpTrends(p TopUpTrendsParams) ([]TopUpTrendPoint, error) {
	granularity, startTs, endTs := resolveTrendsRange(p)

	cm := cache.Get()
	cacheKey := fmt.Sprintf("topup:trends:%s:%d:%d", granularity, startTs, endTs)
	var cached []TopUpTrendPoint
	if found, _ := cm.GetJSON(cacheKey, &cached); found {
		return cached, nil
	}

	var (
		result []TopUpTrendPoint
		err    error
	)
	switch granularity {
	case "weekly":
		result, err = topUpTrendsWeekly(startTs, endTs)
	case "monthly":
		result, err = topUpTrendsMonthly(startTs, endTs)
	default:
		result, err = topUpTrendsDaily(startTs, endTs)
	}
	if err != nil {
		return nil, err
	}

	cm.Set(cacheKey, result, 5*time.Minute)
	return result, nil
}

// topUpTrendsDaily groups by day in the local timezone.
func topUpTrendsDaily(startTs, endTs int64) ([]TopUpTrendPoint, error) {
	db := database.Get()
	tzOffset := localTZOffset()

	dayGroupExpr := fmt.Sprintf("FLOOR((create_time + %d) / 86400)", tzOffset)

	query := db.RebindQuery(fmt.Sprintf(`
		SELECT %s as bucket,
			COUNT(*) as total_count,
			COALESCE(SUM(money), 0) as total_money,
			COALESCE(SUM(amount), 0) as total_amount,
			COALESCE(SUM(CASE WHEN %s THEN 1 ELSE 0 END), 0) as success_count,
			COALESCE(SUM(CASE WHEN %s THEN money ELSE 0 END), 0) as success_money
		FROM top_ups
		WHERE create_time >= ? AND create_time <= ?
		GROUP BY %s
		ORDER BY bucket ASC`,
		dayGroupExpr, successStatusCondition(), successStatusCondition(), dayGroupExpr))

	rows, err := db.QueryWithTimeout(15*time.Second, query, startTs, endTs)
	if err != nil {
		return nil, fmt.Errorf("top-up trends daily query failed: %w", err)
	}

	lookup := make(map[int64]map[string]interface{}, len(rows))
	for _, row := range rows {
		lookup[toInt64(row["bucket"])] = row
	}

	loc := time.Now().Location()
	startTime := time.Unix(startTs, 0).In(loc)
	endTime := time.Unix(endTs, 0).In(loc)
	cursor := time.Date(startTime.Year(), startTime.Month(), startTime.Day(), 0, 0, 0, 0, loc)
	last := time.Date(endTime.Year(), endTime.Month(), endTime.Day(), 0, 0, 0, 0, loc)

	result := make([]TopUpTrendPoint, 0)
	for !cursor.After(last) {
		expectedGroup := (cursor.Unix() + int64(tzOffset)) / 86400
		point := TopUpTrendPoint{
			Date:      cursor.Format("2006-01-02"),
			Timestamp: cursor.Unix(),
		}
		if existing, ok := lookup[expectedGroup]; ok {
			point.Count = toInt64(existing["total_count"])
			point.Money = toFloat64(existing["total_money"])
			point.Amount = toInt64(existing["total_amount"])
			point.SuccessCount = toInt64(existing["success_count"])
			point.SuccessMoney = toFloat64(existing["success_money"])
		}
		result = append(result, point)
		cursor = cursor.AddDate(0, 0, 1)
	}
	return result, nil
}

// topUpTrendsWeekly groups by ISO week (Monday-aligned) in the local timezone.
// Bucket math: FLOOR((create_time + tz - 345600) / 604800).
// 345600 = 4 * 86400 shifts Unix epoch (1970-01-01 Thu) so the *following* Monday
// (1970-01-05) becomes bucket 0 — every other Monday-aligned week aligns from there.
func topUpTrendsWeekly(startTs, endTs int64) ([]TopUpTrendPoint, error) {
	db := database.Get()
	tzOffset := localTZOffset()

	weekGroupExpr := fmt.Sprintf("FLOOR((create_time + %d - 345600) / 604800)", tzOffset)

	query := db.RebindQuery(fmt.Sprintf(`
		SELECT %s as bucket,
			COUNT(*) as total_count,
			COALESCE(SUM(money), 0) as total_money,
			COALESCE(SUM(amount), 0) as total_amount,
			COALESCE(SUM(CASE WHEN %s THEN 1 ELSE 0 END), 0) as success_count,
			COALESCE(SUM(CASE WHEN %s THEN money ELSE 0 END), 0) as success_money
		FROM top_ups
		WHERE create_time >= ? AND create_time <= ?
		GROUP BY %s
		ORDER BY bucket ASC`,
		weekGroupExpr, successStatusCondition(), successStatusCondition(), weekGroupExpr))

	rows, err := db.QueryWithTimeout(15*time.Second, query, startTs, endTs)
	if err != nil {
		return nil, fmt.Errorf("top-up trends weekly query failed: %w", err)
	}

	lookup := make(map[int64]map[string]interface{}, len(rows))
	for _, row := range rows {
		lookup[toInt64(row["bucket"])] = row
	}

	loc := time.Now().Location()
	startTime := time.Unix(startTs, 0).In(loc)
	endTime := time.Unix(endTs, 0).In(loc)

	cursor := mondayOf(startTime)
	last := mondayOf(endTime)

	result := make([]TopUpTrendPoint, 0)
	for !cursor.After(last) {
		expectedGroup := (cursor.Unix() + int64(tzOffset) - 345600) / 604800
		year, week := cursor.ISOWeek()
		point := TopUpTrendPoint{
			Date:      fmt.Sprintf("%04d-W%02d", year, week),
			Timestamp: cursor.Unix(),
		}
		if existing, ok := lookup[expectedGroup]; ok {
			point.Count = toInt64(existing["total_count"])
			point.Money = toFloat64(existing["total_money"])
			point.Amount = toInt64(existing["total_amount"])
			point.SuccessCount = toInt64(existing["success_count"])
			point.SuccessMoney = toFloat64(existing["success_money"])
		}
		result = append(result, point)
		cursor = cursor.AddDate(0, 0, 7)
	}
	return result, nil
}

// mondayOf returns the Monday of the week containing t, at midnight local time.
func mondayOf(t time.Time) time.Time {
	loc := t.Location()
	weekday := int(t.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	monday := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, -(weekday - 1))
	return monday
}

// topUpTrendsMonthly walks each calendar month in the range and runs an aggregate query
// per month. SQL-side grouping for months is messy across MySQL/PG; the per-month loop
// keeps the bucket boundaries correct and stays under the cache layer anyway.
func topUpTrendsMonthly(startTs, endTs int64) ([]TopUpTrendPoint, error) {
	db := database.Get()
	loc := time.Now().Location()

	startTime := time.Unix(startTs, 0).In(loc)
	endTime := time.Unix(endTs, 0).In(loc)

	cursor := time.Date(startTime.Year(), startTime.Month(), 1, 0, 0, 0, 0, loc)

	query := db.RebindQuery(fmt.Sprintf(`
		SELECT
			COUNT(*) as total_count,
			COALESCE(SUM(money), 0) as total_money,
			COALESCE(SUM(amount), 0) as total_amount,
			COALESCE(SUM(CASE WHEN %s THEN 1 ELSE 0 END), 0) as success_count,
			COALESCE(SUM(CASE WHEN %s THEN money ELSE 0 END), 0) as success_money
		FROM top_ups
		WHERE create_time >= ? AND create_time <= ?`,
		successStatusCondition(), successStatusCondition()))

	result := make([]TopUpTrendPoint, 0)
	for !cursor.After(endTime) {
		nextMonth := cursor.AddDate(0, 1, 0)
		monthEndTs := nextMonth.Unix() - 1

		queryStart := cursor.Unix()
		if queryStart < startTs {
			queryStart = startTs
		}
		queryEnd := monthEndTs
		if queryEnd > endTs {
			queryEnd = endTs
		}

		point := TopUpTrendPoint{
			Date:      cursor.Format("2006-01"),
			Timestamp: cursor.Unix(),
		}

		if queryStart <= queryEnd {
			row, err := db.QueryOneWithTimeout(10*time.Second, query, queryStart, queryEnd)
			if err == nil && row != nil {
				point.Count = toInt64(row["total_count"])
				point.Money = toFloat64(row["total_money"])
				point.Amount = toInt64(row["total_amount"])
				point.SuccessCount = toInt64(row["success_count"])
				point.SuccessMoney = toFloat64(row["success_money"])
			}
		}

		result = append(result, point)
		cursor = nextMonth
	}
	return result, nil
}

// GetTopUpFinancialSummary returns monthly financial summaries
func GetTopUpFinancialSummary(months int) ([]TopUpFinancialSummary, error) {
	cm := cache.Get()
	cacheKey := fmt.Sprintf("topup:financial:%d", months)
	var cached []TopUpFinancialSummary
	if found, _ := cm.GetJSON(cacheKey, &cached); found {
		return cached, nil
	}

	db := database.Get()
	now := time.Now()
	loc := now.Location()

	result := make([]TopUpFinancialSummary, 0, months)

	for i := 0; i < months; i++ {
		// Calculate month boundaries
		monthStart := time.Date(now.Year(), now.Month()-time.Month(i), 1, 0, 0, 0, 0, loc)
		monthEnd := monthStart.AddDate(0, 1, 0).Add(-time.Second)

		startTs := monthStart.Unix()
		endTs := monthEnd.Unix()

		query := db.RebindQuery(fmt.Sprintf(`
			SELECT
				COUNT(*) as total_count,
				COALESCE(SUM(CASE WHEN %s THEN money ELSE 0 END), 0) as success_money,
				COALESCE(SUM(CASE WHEN %s THEN amount ELSE 0 END), 0) as success_amount,
				COALESCE(SUM(CASE WHEN %s THEN 1 ELSE 0 END), 0) as success_count
			FROM top_ups
			WHERE create_time >= ? AND create_time <= ?`,
			successStatusCondition(), successStatusCondition(), successStatusCondition()))

		row, err := db.QueryOneWithTimeout(10*time.Second, query, startTs, endTs)
		if err != nil {
			continue
		}

		totalCount := toInt64(row["total_count"])
		successMoney := toFloat64(row["success_money"])
		successAmount := toInt64(row["success_amount"])
		successCount := toInt64(row["success_count"])

		avgOrder := float64(0)
		if successCount > 0 {
			avgOrder = math.Round(successMoney/float64(successCount)*100) / 100
		}

		successRate := float64(0)
		if totalCount > 0 {
			successRate = math.Round(float64(successCount)/float64(totalCount)*10000) / 100
		}

		summary := TopUpFinancialSummary{
			Period:      monthStart.Format("2006-01"),
			Revenue:     math.Round(successMoney*100) / 100,
			Count:       successCount,
			AvgOrder:    avgOrder,
			Amount:      successAmount,
			SuccessRate: successRate,
		}

		result = append(result, summary)
	}

	// Calculate growth rates (compare with previous month)
	for i := 0; i < len(result)-1; i++ {
		if result[i+1].Revenue > 0 {
			result[i].GrowthRate = math.Round((result[i].Revenue-result[i+1].Revenue)/result[i+1].Revenue*10000) / 100
		}
	}

	cm.Set(cacheKey, result, 10*time.Minute)
	return result, nil
}

// GetTopUpTopUsers returns top users by recharge amount
func GetTopUpTopUsers(limit int, days int) ([]TopUpTopUser, error) {
	cm := cache.Get()
	cacheKey := fmt.Sprintf("topup:topusers:%d:%d", limit, days)
	var cached []TopUpTopUser
	if found, _ := cm.GetJSON(cacheKey, &cached); found {
		return cached, nil
	}

	db := database.Get()
	startTime := time.Now().AddDate(0, 0, -days).Unix()

	castExpr := "CAST(t.user_id AS CHAR)"
	if db.IsPG {
		castExpr = "CAST(t.user_id AS TEXT)"
	}

	query := db.RebindQuery(fmt.Sprintf(`
		SELECT t.user_id,
			COALESCE(u.username, %s) as username,
			COUNT(*) as count,
			COALESCE(SUM(t.money), 0) as money,
			COALESCE(SUM(t.amount), 0) as amount
		FROM top_ups t
		LEFT JOIN users u ON t.user_id = u.id
		WHERE t.create_time >= ? AND %s
		GROUP BY t.user_id, u.username
		ORDER BY money DESC
		LIMIT ?`, castExpr, successStatusCondition("t.status")))

	rows, err := db.QueryWithTimeout(15*time.Second, query, startTime, limit)
	if err != nil {
		return nil, fmt.Errorf("top users query failed: %w", err)
	}

	result := make([]TopUpTopUser, 0, len(rows))
	for _, row := range rows {
		result = append(result, TopUpTopUser{
			UserID:   toInt64(row["user_id"]),
			Username: fmt.Sprintf("%v", row["username"]),
			Count:    toInt64(row["count"]),
			Money:    toFloat64(row["money"]),
			Amount:   toInt64(row["amount"]),
		})
	}

	cm.Set(cacheKey, result, 5*time.Minute)
	return result, nil
}

// GetPaymentMethodDistribution returns payment method breakdown
func GetPaymentMethodDistribution(days int) ([]PaymentMethodDistribution, error) {
	cm := cache.Get()
	cacheKey := fmt.Sprintf("topup:payment_dist:%d", days)
	var cached []PaymentMethodDistribution
	if found, _ := cm.GetJSON(cacheKey, &cached); found {
		return cached, nil
	}

	db := database.Get()
	startTime := time.Now().AddDate(0, 0, -days).Unix()

	query := db.RebindQuery(fmt.Sprintf(`
		SELECT COALESCE(payment_method, '未知') as method,
			COUNT(*) as count,
			COALESCE(SUM(money), 0) as money
		FROM top_ups
		WHERE create_time >= ? AND %s
		GROUP BY payment_method
		ORDER BY money DESC`, successStatusCondition()))

	rows, err := db.QueryWithTimeout(10*time.Second, query, startTime)
	if err != nil {
		return nil, fmt.Errorf("payment distribution query failed: %w", err)
	}

	// Calculate total for percentages
	var totalMoney float64
	for _, row := range rows {
		totalMoney += toFloat64(row["money"])
	}

	result := make([]PaymentMethodDistribution, 0, len(rows))
	for _, row := range rows {
		money := toFloat64(row["money"])
		pct := float64(0)
		if totalMoney > 0 {
			pct = math.Round(money/totalMoney*10000) / 100
		}
		method := fmt.Sprintf("%v", row["method"])
		if method == "" || method == "<nil>" {
			method = "未知"
		}
		result = append(result, PaymentMethodDistribution{
			Method:     method,
			Count:      toInt64(row["count"]),
			Money:      math.Round(money*100) / 100,
			Percentage: pct,
		})
	}

	cm.Set(cacheKey, result, 5*time.Minute)
	return result, nil
}

// GetTopUpRealtimeStats returns real-time comparison statistics
func GetTopUpRealtimeStats() (*TopUpRealtimeStats, error) {
	db := database.Get()
	now := time.Now()
	loc := now.Location()

	// Today
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).Unix()
	// Yesterday
	yesterdayStart := todayStart - 86400
	// This week (Monday start)
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	weekStart := time.Date(now.Year(), now.Month(), now.Day()-(weekday-1), 0, 0, 0, 0, loc).Unix()
	lastWeekStart := weekStart - 7*86400
	// This month
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc).Unix()
	lastMonthStart := time.Date(now.Year(), now.Month()-1, 1, 0, 0, 0, 0, loc).Unix()

	// 缓存键编入日历边界，跨日 / 跨周 / 跨月时自动失效，避免临界点展示昨天数据。
	cm := cache.Get()
	cacheKey := fmt.Sprintf("topup:realtime:%d:%d:%d", todayStart, weekStart, monthStart)
	var cached TopUpRealtimeStats
	if found, _ := cm.GetJSON(cacheKey, &cached); found {
		return &cached, nil
	}

	successCond := successStatusCondition()

	query := db.RebindQuery(fmt.Sprintf(`
		SELECT
			COALESCE(SUM(CASE WHEN create_time >= ? AND %s THEN money ELSE 0 END), 0) as today_money,
			COALESCE(SUM(CASE WHEN create_time >= ? AND %s THEN 1 ELSE 0 END), 0) as today_count,
			COALESCE(SUM(CASE WHEN create_time >= ? AND create_time < ? AND %s THEN money ELSE 0 END), 0) as yesterday_money,
			COALESCE(SUM(CASE WHEN create_time >= ? AND create_time < ? AND %s THEN 1 ELSE 0 END), 0) as yesterday_count,
			COALESCE(SUM(CASE WHEN create_time >= ? AND %s THEN money ELSE 0 END), 0) as week_money,
			COALESCE(SUM(CASE WHEN create_time >= ? AND %s THEN 1 ELSE 0 END), 0) as week_count,
			COALESCE(SUM(CASE WHEN create_time >= ? AND create_time < ? AND %s THEN money ELSE 0 END), 0) as last_week_money,
			COALESCE(SUM(CASE WHEN create_time >= ? AND create_time < ? AND %s THEN 1 ELSE 0 END), 0) as last_week_count,
			COALESCE(SUM(CASE WHEN create_time >= ? AND %s THEN money ELSE 0 END), 0) as month_money,
			COALESCE(SUM(CASE WHEN create_time >= ? AND %s THEN 1 ELSE 0 END), 0) as month_count,
			COALESCE(SUM(CASE WHEN create_time >= ? AND create_time < ? AND %s THEN money ELSE 0 END), 0) as last_month_money,
			COALESCE(SUM(CASE WHEN create_time >= ? AND create_time < ? AND %s THEN 1 ELSE 0 END), 0) as last_month_count
		FROM top_ups
		WHERE create_time >= ?`,
		successCond, successCond,
		successCond, successCond,
		successCond, successCond,
		successCond, successCond,
		successCond, successCond,
		successCond, successCond))

	row, err := db.QueryOneWithTimeout(15*time.Second, query,
		todayStart,                 // today_money
		todayStart,                 // today_count
		yesterdayStart, todayStart, // yesterday_money
		yesterdayStart, todayStart, // yesterday_count
		weekStart,                // week_money
		weekStart,                // week_count
		lastWeekStart, weekStart, // last_week_money
		lastWeekStart, weekStart, // last_week_count
		monthStart,                 // month_money
		monthStart,                 // month_count
		lastMonthStart, monthStart, // last_month_money
		lastMonthStart, monthStart, // last_month_count
		lastMonthStart, // WHERE condition
	)
	if err != nil {
		return nil, fmt.Errorf("realtime stats query failed: %w", err)
	}

	stats := &TopUpRealtimeStats{}
	if row != nil {
		stats.TodayMoney = math.Round(toFloat64(row["today_money"])*100) / 100
		stats.TodayCount = toInt64(row["today_count"])
		stats.YesterdayMoney = math.Round(toFloat64(row["yesterday_money"])*100) / 100
		stats.YesterdayCount = toInt64(row["yesterday_count"])
		stats.WeekMoney = math.Round(toFloat64(row["week_money"])*100) / 100
		stats.WeekCount = toInt64(row["week_count"])
		stats.LastWeekMoney = math.Round(toFloat64(row["last_week_money"])*100) / 100
		stats.LastWeekCount = toInt64(row["last_week_count"])
		stats.MonthMoney = math.Round(toFloat64(row["month_money"])*100) / 100
		stats.MonthCount = toInt64(row["month_count"])
		stats.LastMonthMoney = math.Round(toFloat64(row["last_month_money"])*100) / 100
		stats.LastMonthCount = toInt64(row["last_month_count"])

		// Calculate growth rates
		if stats.YesterdayMoney > 0 {
			stats.DayGrowth = math.Round((stats.TodayMoney-stats.YesterdayMoney)/stats.YesterdayMoney*10000) / 100
		}
		if stats.LastWeekMoney > 0 {
			stats.WeekGrowth = math.Round((stats.WeekMoney-stats.LastWeekMoney)/stats.LastWeekMoney*10000) / 100
		}
		if stats.LastMonthMoney > 0 {
			stats.MonthGrowth = math.Round((stats.MonthMoney-stats.LastMonthMoney)/stats.LastMonthMoney*10000) / 100
		}
	}

	cm.Set(cacheKey, stats, 2*time.Minute)
	return stats, nil
}

// GetTopUpHourlyHeatmap returns hourly heatmap data for the past N days
func GetTopUpHourlyHeatmap(days int) ([]HourlyHeatmapPoint, error) {
	cm := cache.Get()
	cacheKey := fmt.Sprintf("topup:heatmap:%d", days)
	var cached []HourlyHeatmapPoint
	if found, _ := cm.GetJSON(cacheKey, &cached); found {
		return cached, nil
	}

	db := database.Get()
	startTime := time.Now().AddDate(0, 0, -days).Unix()
	tzOffset := localTZOffset()

	hourExpr, dowExpr := topUpHeatmapTimeExpressions(tzOffset, db.IsPG)

	query := db.RebindQuery(fmt.Sprintf(`
		SELECT %s as day_of_week,
			%s as hour,
			COUNT(*) as count,
			COALESCE(SUM(money), 0) as money
		FROM top_ups
		WHERE create_time >= ? AND %s
		GROUP BY %s, %s
		ORDER BY day_of_week, hour`,
		dowExpr, hourExpr, successStatusCondition(), dowExpr, hourExpr))

	rows, err := db.QueryWithTimeout(15*time.Second, query, startTime)
	if err != nil {
		return nil, fmt.Errorf("heatmap query failed: %w", err)
	}

	result := topUpHeatmapGrid(rows)

	cm.Set(cacheKey, result, 10*time.Minute)
	return result, nil
}

func topUpHeatmapGrid(rows []map[string]interface{}) []HourlyHeatmapPoint {
	result := make([]HourlyHeatmapPoint, 0, 7*24)
	heatmap := make(map[string]*HourlyHeatmapPoint)

	for dow := 0; dow < 7; dow++ {
		for h := 0; h < 24; h++ {
			key := fmt.Sprintf("%d-%d", dow, h)
			point := &HourlyHeatmapPoint{DayOfWeek: dow, Hour: h}
			heatmap[key] = point
		}
	}

	// Fill with data
	for _, row := range rows {
		dow := int(toInt64(row["day_of_week"]))
		hour := int(toInt64(row["hour"]))
		key := fmt.Sprintf("%d-%d", dow, hour)
		if point, ok := heatmap[key]; ok {
			point.Count = toInt64(row["count"])
			point.Money = toFloat64(row["money"])
		}
	}

	for dow := 0; dow < 7; dow++ {
		for h := 0; h < 24; h++ {
			key := fmt.Sprintf("%d-%d", dow, h)
			result = append(result, *heatmap[key])
		}
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].DayOfWeek != result[j].DayOfWeek {
			return result[i].DayOfWeek < result[j].DayOfWeek
		}
		return result[i].Hour < result[j].Hour
	})

	return result
}

func topUpHeatmapTimeExpressions(tzOffset int, isPG bool) (hourExpr, dowExpr string) {
	// Extract day of week and hour from unix timestamp with timezone offset.
	// Day of week: (day_bucket + 4) % 7 gives 0=Sunday because Unix epoch was Thursday=4.
	hourExpr = fmt.Sprintf("FLOOR(((create_time + %d) %% 86400) / 3600)", tzOffset)
	dayBucketExpr := fmt.Sprintf("FLOOR((create_time + %d) / 86400)", tzOffset)
	if isPG {
		// PostgreSQL FLOOR(bigint division) returns double precision, and modulo
		// is not defined for double precision. Cast before applying %.
		dayBucketExpr = fmt.Sprintf("CAST(%s AS BIGINT)", dayBucketExpr)
	}
	dowExpr = fmt.Sprintf("(%s + 4) %% 7", dayBucketExpr)
	return hourExpr, dowExpr
}

// FunnelStatusBucket counts top-ups grouped into success/failed/pending buckets.
type FunnelStatusBucket struct {
	Status string  `json:"status"`
	Count  int64   `json:"count"`
	Money  float64 `json:"money"`
}

// FunnelPaymentBucket reports per-payment-method success rate.
type FunnelPaymentBucket struct {
	Method       string  `json:"method"`
	TotalCount   int64   `json:"total_count"`
	SuccessCount int64   `json:"success_count"`
	SuccessRate  float64 `json:"success_rate"` // 0-100
}

// TopUpFunnelData is the conversion-funnel response.
type TopUpFunnelData struct {
	StatusBreakdown   []FunnelStatusBucket  `json:"status_breakdown"`
	ByPaymentMethod   []FunnelPaymentBucket `json:"by_payment_method"`
	AvgCompletionSecs float64               `json:"avg_completion_secs"`
	TotalCount        int64                 `json:"total_count"`
}

// GetTopUpFunnel returns conversion funnel statistics for the past N days.
func GetTopUpFunnel(days int) (*TopUpFunnelData, error) {
	if days < 1 || days > 365 {
		days = 30
	}

	cm := cache.Get()
	cacheKey := fmt.Sprintf("topup:funnel:%d", days)
	var cached TopUpFunnelData
	if found, _ := cm.GetJSON(cacheKey, &cached); found {
		return &cached, nil
	}

	db := database.Get()
	startTime := time.Now().AddDate(0, 0, -days).Unix()
	bucketSQL := topUpStatusBucketSQL("status")

	// 1. status breakdown — bucketize each row into the shared normalized status set.
	statusQuery := db.RebindQuery(fmt.Sprintf(`
		SELECT
			%s as bucket,
			COUNT(*) as count,
			COALESCE(SUM(money), 0) as money
		FROM top_ups
		WHERE create_time >= ?
		GROUP BY 1`, bucketSQL))

	statusRows, err := db.QueryWithTimeout(15*time.Second, statusQuery, startTime)
	if err != nil {
		return nil, fmt.Errorf("funnel status query failed: %w", err)
	}

	tally := map[string]FunnelStatusBucket{}
	var totalCount int64
	for _, row := range statusRows {
		status := fmt.Sprintf("%v", row["bucket"])
		count := toInt64(row["count"])
		tally[status] = FunnelStatusBucket{
			Status: status,
			Count:  count,
			Money:  math.Round(toFloat64(row["money"])*100) / 100,
		}
		totalCount += count
	}
	// Always emit all buckets in a stable order.
	finalStatus := make([]FunnelStatusBucket, 0, 5)
	for _, s := range []string{"success", "pending", "failed", "expired", "unknown"} {
		if b, ok := tally[s]; ok {
			finalStatus = append(finalStatus, b)
		} else {
			finalStatus = append(finalStatus, FunnelStatusBucket{Status: s})
		}
	}

	// 2. payment method breakdown with success rate
	paymentQuery := db.RebindQuery(fmt.Sprintf(`
		SELECT COALESCE(payment_method, '') as method,
			COUNT(*) as total_count,
			COALESCE(SUM(CASE WHEN %s THEN 1 ELSE 0 END), 0) as success_count
		FROM top_ups
		WHERE create_time >= ?
		GROUP BY payment_method
		ORDER BY total_count DESC`, successStatusCondition()))

	paymentRows, err := db.QueryWithTimeout(15*time.Second, paymentQuery, startTime)
	if err != nil {
		return nil, fmt.Errorf("funnel payment query failed: %w", err)
	}

	paymentBuckets := make([]FunnelPaymentBucket, 0, len(paymentRows))
	for _, row := range paymentRows {
		total := toInt64(row["total_count"])
		success := toInt64(row["success_count"])
		rate := float64(0)
		if total > 0 {
			rate = math.Round(float64(success)/float64(total)*10000) / 100
		}
		method := strings.TrimSpace(fmt.Sprintf("%v", row["method"]))
		if method == "" || method == "<nil>" {
			method = "未知"
		}
		paymentBuckets = append(paymentBuckets, FunnelPaymentBucket{
			Method:       method,
			TotalCount:   total,
			SuccessCount: success,
			SuccessRate:  rate,
		})
	}

	// 3. average completion latency (only for successful, completed orders)
	// 显式 CAST 成 double，避免 PG 上 AVG(bigint) 返回 numeric 时驱动 scan 出意外类型。
	avgCastExpr := "CAST(AVG(complete_time - create_time) AS DOUBLE PRECISION)"
	if !db.IsPG {
		// MySQL：DOUBLE 关键字（无 PRECISION）；SQLite 也接受 DOUBLE。
		avgCastExpr = "CAST(AVG(complete_time - create_time) AS DOUBLE)"
	}
	avgQuery := db.RebindQuery(fmt.Sprintf(`
		SELECT COALESCE(%s, 0) as avg_secs
		FROM top_ups
		WHERE create_time >= ?
			AND %s
			AND complete_time > 0
			AND complete_time >= create_time`,
		avgCastExpr, successStatusCondition()))

	avgRow, _ := db.QueryOneWithTimeout(10*time.Second, avgQuery, startTime)
	avgSecs := float64(0)
	if avgRow != nil {
		avgSecs = math.Round(toFloat64(avgRow["avg_secs"])*100) / 100
	}

	result := &TopUpFunnelData{
		StatusBreakdown:   finalStatus,
		ByPaymentMethod:   paymentBuckets,
		AvgCompletionSecs: avgSecs,
		TotalCount:        totalCount,
	}

	cm.Set(cacheKey, result, 5*time.Minute)
	return result, nil
}

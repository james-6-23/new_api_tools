package service

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/new-api-tools/backend/internal/cache"
	"github.com/new-api-tools/backend/internal/database"
)

type TopUpPayerCohorts struct {
	Days                  int     `json:"days"`
	PayingUsers           int64   `json:"paying_users"`
	FirstTimePayers       int64   `json:"first_time_payers"`
	RepeatPayers          int64   `json:"repeat_payers"`
	RepeatRate            float64 `json:"repeat_rate"`
	TotalRevenue          float64 `json:"total_revenue"`
	ARPPU                 float64 `json:"arppu"`
	AvgOrdersPerPayer     float64 `json:"avg_orders_per_payer"`
	AvgFirstPayDelayHours float64 `json:"avg_first_pay_delay_hours"`
	RepeatRevenueShare    float64 `json:"repeat_revenue_share"`
	Top1RevenueShare      float64 `json:"top1_revenue_share"`
	Top5RevenueShare      float64 `json:"top5_revenue_share"`
	Top10RevenueShare     float64 `json:"top10_revenue_share"`
}

type TopUpProviderHealth struct {
	Provider          string  `json:"provider"`
	Method            string  `json:"method"`
	TotalCount        int64   `json:"total_count"`
	SuccessCount      int64   `json:"success_count"`
	PendingCount      int64   `json:"pending_count"`
	FailedCount       int64   `json:"failed_count"`
	ExpiredCount      int64   `json:"expired_count"`
	UnknownCount      int64   `json:"unknown_count"`
	SuccessRate       float64 `json:"success_rate"`
	FailureRate       float64 `json:"failure_rate"`
	ExpiredRate       float64 `json:"expired_rate"`
	Revenue           float64 `json:"revenue"`
	AvgCompletionSecs float64 `json:"avg_completion_secs"`
	P95CompletionSecs float64 `json:"p95_completion_secs"`
}

type TopUpAuditSummary struct {
	TotalAnomalies         int64 `json:"total_anomalies"`
	OverduePending         int64 `json:"overdue_pending"`
	Pending30m             int64 `json:"pending_30m"`
	Pending2h              int64 `json:"pending_2h"`
	Pending24h             int64 `json:"pending_24h"`
	SuccessMissingComplete int64 `json:"success_missing_complete"`
	CompleteBeforeCreate   int64 `json:"complete_before_create"`
	InvalidMoney           int64 `json:"invalid_money"`
	InvalidAmount          int64 `json:"invalid_amount"`
	EmptyTradeNo           int64 `json:"empty_trade_no"`
	UnknownStatus          int64 `json:"unknown_status"`
}

type TopUpAnomalyRecord struct {
	TopUpRecord
	AgeHours float64 `json:"age_hours"`
}

type TopUpAnomalies struct {
	Days         int                  `json:"days"`
	PendingHours int                  `json:"pending_hours"`
	Summary      TopUpAuditSummary    `json:"summary"`
	Items        []TopUpAnomalyRecord `json:"items"`
}

type payerAgg struct {
	userCreatedAt int64
	firstSuccess  int64
	windowCount   int64
	windowMoney   float64
}

func normalizeTopUpDays(days int, defaultDays int, maxDays int) int {
	if days < 1 || days > maxDays {
		return defaultDays
	}
	return days
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func round4(v float64) float64 {
	return math.Round(v*10000) / 100
}

func GetTopUpPayerCohorts(days int) (*TopUpPayerCohorts, error) {
	days = normalizeTopUpDays(days, 30, 365)

	cm := cache.Get()
	cacheKey := fmt.Sprintf("topup:payer_cohorts:%d", days)
	var cached TopUpPayerCohorts
	if found, _ := cm.GetJSON(cacheKey, &cached); found {
		return &cached, nil
	}

	db := database.Get()
	startTime := time.Now().AddDate(0, 0, -days).Unix()
	userCreatedSelect := "0 as user_created_at"
	userJoin := ""
	if db.ColumnExists("users", "created_at") {
		userCreatedSelect = "COALESCE(MAX(u.created_at), 0) as user_created_at"
		userJoin = "LEFT JOIN users u ON w.user_id = u.id"
	}
	query := db.RebindQuery(fmt.Sprintf(`
		SELECT w.user_id,
			%s,
			COALESCE(MIN(CASE WHEN COALESCE(all_t.create_time, 0) > 0 THEN all_t.create_time END), 0) as first_success,
			w.window_count,
			w.window_money
		FROM (
			SELECT t.user_id,
				COUNT(*) as window_count,
				COALESCE(SUM(COALESCE(t.money, 0)), 0) as window_money
			FROM top_ups t
			WHERE t.create_time >= ?
				AND (%s) = 'success'
				AND t.user_id > 0
			GROUP BY t.user_id
		) w
		LEFT JOIN top_ups all_t ON all_t.user_id = w.user_id AND (%s) = 'success'
		%s
		GROUP BY w.user_id, w.window_count, w.window_money`,
		userCreatedSelect, topUpStatusBucketSQL("t.status"), topUpStatusBucketSQL("all_t.status"), userJoin))

	rows, err := db.QueryWithTimeout(15*time.Second, query, startTime)
	if err != nil {
		return nil, fmt.Errorf("payer cohorts query failed: %w", err)
	}

	byUser := map[int64]*payerAgg{}
	var totalRevenue float64
	var totalOrders int64
	for _, row := range rows {
		userID := toInt64(row["user_id"])
		if userID <= 0 {
			continue
		}
		createdAt := toInt64(row["user_created_at"])
		firstSuccess := toInt64(row["first_success"])
		windowCount := toInt64(row["window_count"])
		windowMoney := toFloat64(row["window_money"])

		agg := byUser[userID]
		if agg == nil {
			agg = &payerAgg{
				userCreatedAt: createdAt,
				firstSuccess:  firstSuccess,
				windowCount:   windowCount,
				windowMoney:   windowMoney,
			}
			byUser[userID] = agg
		}
		totalOrders += windowCount
		totalRevenue += windowMoney
	}

	var (
		payingUsers           int64
		firstTimePayers       int64
		repeatPayers          int64
		repeatRevenue         float64
		firstPayDelayHoursSum float64
		firstPayDelayCount    int64
		userRevenues          []float64
	)
	for _, agg := range byUser {
		if agg.windowCount <= 0 {
			continue
		}
		payingUsers++
		userRevenues = append(userRevenues, agg.windowMoney)
		if agg.windowCount >= 2 {
			repeatPayers++
			repeatRevenue += agg.windowMoney
		}
		if agg.firstSuccess >= startTime {
			firstTimePayers++
			if agg.userCreatedAt > 0 && agg.firstSuccess >= agg.userCreatedAt {
				firstPayDelayHoursSum += float64(agg.firstSuccess-agg.userCreatedAt) / 3600
				firstPayDelayCount++
			}
		}
	}

	sort.Slice(userRevenues, func(i, j int) bool { return userRevenues[i] > userRevenues[j] })
	share := func(n int) float64 {
		if totalRevenue <= 0 || len(userRevenues) == 0 {
			return 0
		}
		if n > len(userRevenues) {
			n = len(userRevenues)
		}
		var sum float64
		for i := 0; i < n; i++ {
			sum += userRevenues[i]
		}
		return round4(sum / totalRevenue)
	}

	result := &TopUpPayerCohorts{
		Days:              days,
		PayingUsers:       payingUsers,
		FirstTimePayers:   firstTimePayers,
		RepeatPayers:      repeatPayers,
		TotalRevenue:      round2(totalRevenue),
		Top1RevenueShare:  share(1),
		Top5RevenueShare:  share(5),
		Top10RevenueShare: share(10),
	}
	if payingUsers > 0 {
		result.RepeatRate = round4(float64(repeatPayers) / float64(payingUsers))
		result.ARPPU = round2(totalRevenue / float64(payingUsers))
		result.AvgOrdersPerPayer = round2(float64(totalOrders) / float64(payingUsers))
	}
	if totalRevenue > 0 {
		result.RepeatRevenueShare = round4(repeatRevenue / totalRevenue)
	}
	if firstPayDelayCount > 0 {
		result.AvgFirstPayDelayHours = round2(firstPayDelayHoursSum / float64(firstPayDelayCount))
	}

	cm.Set(cacheKey, result, 10*time.Minute)
	return result, nil
}

type providerAgg struct {
	health      TopUpProviderHealth
	durations   []int64
	durationSum int64
}

type topUpAnomalySQLFilters struct {
	overduePending       string
	pending30m           string
	pending2h            string
	pending24h           string
	completeBeforeCreate string
	invalidMoney         string
	invalidAmount        string
	emptyTradeNo         string
	unknownStatus        string
	any                  string
}

func buildTopUpAnomalySQLFilters(statusBucketSQL string, now int64, pendingHours int) topUpAnomalySQLFilters {
	if pendingHours < 1 {
		pendingHours = defaultPendingAnomalyHours
	}
	pendingOlderThan := func(seconds int64) string {
		return fmt.Sprintf("(%s) = 'pending' AND COALESCE(t.create_time, 0) > 0 AND t.create_time <= %d", statusBucketSQL, now-seconds)
	}

	filters := topUpAnomalySQLFilters{
		overduePending:       pendingOlderThan(int64(pendingHours) * 3600),
		pending30m:           pendingOlderThan(30 * 60),
		pending2h:            pendingOlderThan(2 * 3600),
		pending24h:           pendingOlderThan(24 * 3600),
		completeBeforeCreate: "COALESCE(t.create_time, 0) > 0 AND COALESCE(t.complete_time, 0) > 0 AND t.complete_time < t.create_time",
		invalidMoney:         "COALESCE(t.money, 0) <= 0",
		invalidAmount:        "COALESCE(t.amount, 0) <= 0",
		emptyTradeNo:         "TRIM(COALESCE(t.trade_no, '')) = ''",
		unknownStatus:        fmt.Sprintf("(%s) = 'unknown'", statusBucketSQL),
	}
	filters.any = "(" + strings.Join([]string{
		filters.overduePending,
		filters.completeBeforeCreate,
		filters.invalidMoney,
		filters.invalidAmount,
		filters.emptyTradeNo,
		filters.unknownStatus,
	}, " OR ") + ")"
	return filters
}

func GetTopUpProviderHealth(days int) ([]TopUpProviderHealth, error) {
	days = normalizeTopUpDays(days, 30, 365)

	cm := cache.Get()
	cacheKey := fmt.Sprintf("topup:provider_health:%d", days)
	var cached []TopUpProviderHealth
	if found, _ := cm.GetJSON(cacheKey, &cached); found {
		return cached, nil
	}

	db := database.Get()
	startTime := time.Now().AddDate(0, 0, -days).Unix()
	paymentProviderExpr := topUpPaymentProviderExpr("")
	query := db.RebindQuery(fmt.Sprintf(`
		SELECT COALESCE(%s, '') as payment_provider,
			COALESCE(payment_method, '') as payment_method,
			COALESCE(status, '') as status,
			COALESCE(money, 0) as money,
			COALESCE(create_time, 0) as create_time,
			COALESCE(complete_time, 0) as complete_time
		FROM top_ups
		WHERE create_time >= ?`, paymentProviderExpr))

	rows, err := db.QueryWithTimeout(15*time.Second, query, startTime)
	if err != nil {
		return nil, fmt.Errorf("provider health query failed: %w", err)
	}

	groups := map[string]*providerAgg{}
	for _, row := range rows {
		provider := strings.TrimSpace(fmt.Sprintf("%v", row["payment_provider"]))
		method := strings.TrimSpace(fmt.Sprintf("%v", row["payment_method"]))
		if provider == "" || provider == "<nil>" {
			provider = "未知"
		}
		if method == "" || method == "<nil>" {
			method = "未知"
		}
		key := provider + "\x00" + method
		agg := groups[key]
		if agg == nil {
			agg = &providerAgg{health: TopUpProviderHealth{Provider: provider, Method: method}}
			groups[key] = agg
		}

		status := topUpStatusBucket(fmt.Sprintf("%v", row["status"]))
		money := toFloat64(row["money"])
		createTime := toInt64(row["create_time"])
		completeTime := toInt64(row["complete_time"])

		agg.health.TotalCount++
		switch status {
		case "success":
			agg.health.SuccessCount++
			agg.health.Revenue += money
			if dur := topUpCompletionSeconds(createTime, completeTime); dur > 0 {
				agg.durations = append(agg.durations, dur)
				agg.durationSum += dur
			}
		case "failed":
			agg.health.FailedCount++
		case "expired":
			agg.health.ExpiredCount++
		case "pending":
			agg.health.PendingCount++
		default:
			agg.health.UnknownCount++
		}
	}

	result := make([]TopUpProviderHealth, 0, len(groups))
	for _, agg := range groups {
		h := agg.health
		if h.TotalCount > 0 {
			h.SuccessRate = round4(float64(h.SuccessCount) / float64(h.TotalCount))
			h.FailureRate = round4(float64(h.FailedCount) / float64(h.TotalCount))
			h.ExpiredRate = round4(float64(h.ExpiredCount) / float64(h.TotalCount))
		}
		if len(agg.durations) > 0 {
			sort.Slice(agg.durations, func(i, j int) bool { return agg.durations[i] < agg.durations[j] })
			h.AvgCompletionSecs = round2(float64(agg.durationSum) / float64(len(agg.durations)))
			idx := int(math.Ceil(float64(len(agg.durations))*0.95)) - 1
			if idx < 0 {
				idx = 0
			}
			if idx >= len(agg.durations) {
				idx = len(agg.durations) - 1
			}
			h.P95CompletionSecs = float64(agg.durations[idx])
		}
		h.Revenue = round2(h.Revenue)
		result = append(result, h)
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].Revenue == result[j].Revenue {
			return result[i].TotalCount > result[j].TotalCount
		}
		return result[i].Revenue > result[j].Revenue
	})

	cm.Set(cacheKey, result, 5*time.Minute)
	return result, nil
}

func GetTopUpAnomalies(days int, pendingHours int, limit int) (*TopUpAnomalies, error) {
	days = normalizeTopUpDays(days, 30, 365)
	if pendingHours < 1 || pendingHours > 168 {
		pendingHours = defaultPendingAnomalyHours
	}
	if limit < 1 || limit > 200 {
		limit = 50
	}

	cm := cache.Get()
	cacheKey := fmt.Sprintf("topup:anomalies:%d:%d:%d", days, pendingHours, limit)
	var cached TopUpAnomalies
	if found, _ := cm.GetJSON(cacheKey, &cached); found {
		return &cached, nil
	}

	db := database.Get()
	startTime := time.Now().AddDate(0, 0, -days).Unix()
	now := time.Now().Unix()
	statusBucketSQL := topUpStatusBucketSQL("t.status")
	filters := buildTopUpAnomalySQLFilters(statusBucketSQL, now, pendingHours)

	summaryQuery := db.RebindQuery(fmt.Sprintf(`
		SELECT
			COALESCE(SUM(CASE WHEN %s THEN 1 ELSE 0 END), 0) as total_anomalies,
			COALESCE(SUM(CASE WHEN %s THEN 1 ELSE 0 END), 0) as overdue_pending,
			COALESCE(SUM(CASE WHEN %s THEN 1 ELSE 0 END), 0) as pending_30m,
			COALESCE(SUM(CASE WHEN %s THEN 1 ELSE 0 END), 0) as pending_2h,
			COALESCE(SUM(CASE WHEN %s THEN 1 ELSE 0 END), 0) as pending_24h,
			COALESCE(SUM(CASE WHEN %s THEN 1 ELSE 0 END), 0) as complete_before_create,
			COALESCE(SUM(CASE WHEN %s THEN 1 ELSE 0 END), 0) as invalid_money,
			COALESCE(SUM(CASE WHEN %s THEN 1 ELSE 0 END), 0) as invalid_amount,
			COALESCE(SUM(CASE WHEN %s THEN 1 ELSE 0 END), 0) as empty_trade_no,
			COALESCE(SUM(CASE WHEN %s THEN 1 ELSE 0 END), 0) as unknown_status
		FROM top_ups t
		WHERE t.create_time >= ?`,
		filters.any,
		filters.overduePending,
		filters.pending30m,
		filters.pending2h,
		filters.pending24h,
		filters.completeBeforeCreate,
		filters.invalidMoney,
		filters.invalidAmount,
		filters.emptyTradeNo,
		filters.unknownStatus))

	summaryRow, err := db.QueryOneWithTimeout(10*time.Second, summaryQuery, startTime)
	if err != nil {
		return nil, fmt.Errorf("top-up anomaly summary query failed: %w", err)
	}
	summary := TopUpAuditSummary{}
	if summaryRow != nil {
		summary.TotalAnomalies = toInt64(summaryRow["total_anomalies"])
		summary.OverduePending = toInt64(summaryRow["overdue_pending"])
		summary.Pending30m = toInt64(summaryRow["pending_30m"])
		summary.Pending2h = toInt64(summaryRow["pending_2h"])
		summary.Pending24h = toInt64(summaryRow["pending_24h"])
		summary.CompleteBeforeCreate = toInt64(summaryRow["complete_before_create"])
		summary.InvalidMoney = toInt64(summaryRow["invalid_money"])
		summary.InvalidAmount = toInt64(summaryRow["invalid_amount"])
		summary.EmptyTradeNo = toInt64(summaryRow["empty_trade_no"])
		summary.UnknownStatus = toInt64(summaryRow["unknown_status"])
	}

	query := db.RebindQuery(fmt.Sprintf(`
		SELECT %s
		FROM top_ups t
		LEFT JOIN users u ON t.user_id = u.id
		WHERE t.create_time >= ? AND %s
		ORDER BY t.create_time DESC
		LIMIT ?`, topUpSelectColumns(), filters.any))

	rows, err := db.QueryWithTimeout(15*time.Second, query, startTime, limit)
	if err != nil {
		return nil, fmt.Errorf("top-up anomalies query failed: %w", err)
	}

	items := make([]TopUpAnomalyRecord, 0, limit)
	for _, row := range rows {
		rec := TopUpRecord{
			ID:                toInt64(row["id"]),
			UserID:            toInt64(row["user_id"]),
			Amount:            toInt64(row["amount"]),
			Money:             toFloat64(row["money"]),
			TradeNo:           fmt.Sprintf("%v", row["trade_no"]),
			PaymentMethod:     fmt.Sprintf("%v", row["payment_method"]),
			PaymentProvider:   fmt.Sprintf("%v", row["payment_provider"]),
			CreateTime:        toInt64(row["create_time"]),
			CompleteTime:      toInt64(row["complete_time"]),
			Status:            fmt.Sprintf("%v", row["status"]),
			StatusBucket:      fmt.Sprintf("%v", row["status_bucket"]),
			CompletionSeconds: toInt64(row["completion_seconds"]),
		}
		if username := strings.TrimSpace(fmt.Sprintf("%v", row["username"])); username != "" && username != "<nil>" {
			rec.Username = &username
		}
		enrichTopUpRecord(&rec, now, pendingHours)

		if len(rec.AnomalyReasons) == 0 {
			continue
		}

		ageHours := float64(0)
		if rec.CreateTime > 0 && now >= rec.CreateTime {
			ageHours = round2(float64(now-rec.CreateTime) / 3600)
		}
		items = append(items, TopUpAnomalyRecord{TopUpRecord: rec, AgeHours: ageHours})
	}

	result := &TopUpAnomalies{
		Days:         days,
		PendingHours: pendingHours,
		Summary:      summary,
		Items:        items,
	}
	cm.Set(cacheKey, result, 2*time.Minute)
	return result, nil
}

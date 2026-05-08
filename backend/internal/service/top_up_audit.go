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
	query := db.RebindQuery(fmt.Sprintf(`
		SELECT t.user_id,
			COALESCE(u.created_at, 0) as user_created_at,
			COALESCE(t.money, 0) as money,
			COALESCE(t.create_time, 0) as create_time
		FROM top_ups t
		LEFT JOIN users u ON t.user_id = u.id
		WHERE (%s) = 'success'
		ORDER BY t.create_time ASC`, topUpStatusBucketSQL("t.status")))

	rows, err := db.QueryWithTimeout(15*time.Second, query)
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
		createTime := toInt64(row["create_time"])
		money := toFloat64(row["money"])

		agg := byUser[userID]
		if agg == nil {
			agg = &payerAgg{userCreatedAt: createdAt}
			byUser[userID] = agg
		}
		if agg.userCreatedAt == 0 && createdAt > 0 {
			agg.userCreatedAt = createdAt
		}
		if agg.firstSuccess == 0 || (createTime > 0 && createTime < agg.firstSuccess) {
			agg.firstSuccess = createTime
		}
		if createTime >= startTime {
			agg.windowCount++
			agg.windowMoney += money
			totalOrders++
			totalRevenue += money
		}
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
	query := db.RebindQuery(`
		SELECT COALESCE(payment_provider, '') as payment_provider,
			COALESCE(payment_method, '') as payment_method,
			COALESCE(status, '') as status,
			COALESCE(money, 0) as money,
			COALESCE(create_time, 0) as create_time,
			COALESCE(complete_time, 0) as complete_time
		FROM top_ups
		WHERE create_time >= ?`)

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
	query := db.RebindQuery(fmt.Sprintf(`
		SELECT %s
		FROM top_ups t
		LEFT JOIN users u ON t.user_id = u.id
		WHERE t.create_time >= ?
		ORDER BY t.create_time DESC`, topUpSelectColumns()))

	rows, err := db.QueryWithTimeout(15*time.Second, query, startTime)
	if err != nil {
		return nil, fmt.Errorf("top-up anomalies query failed: %w", err)
	}

	now := time.Now().Unix()
	summary := TopUpAuditSummary{}
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

		if rec.StatusBucket == "pending" && rec.CreateTime > 0 {
			ageSecs := now - rec.CreateTime
			if ageSecs >= 30*60 {
				summary.Pending30m++
			}
			if ageSecs >= 2*3600 {
				summary.Pending2h++
			}
			if ageSecs >= 24*3600 {
				summary.Pending24h++
			}
		}

		if len(rec.AnomalyReasons) == 0 {
			continue
		}

		summary.TotalAnomalies++
		for _, reason := range rec.AnomalyReasons {
			switch reason {
			case "超时待支付":
				summary.OverduePending++
			case "成功但无完成时间":
				summary.SuccessMissingComplete++
			case "完成早于创建":
				summary.CompleteBeforeCreate++
			case "金额异常":
				summary.InvalidMoney++
			case "额度异常":
				summary.InvalidAmount++
			case "空交易号":
				summary.EmptyTradeNo++
			case "未知状态":
				summary.UnknownStatus++
			}
		}

		if len(items) < limit {
			ageHours := float64(0)
			if rec.CreateTime > 0 && now >= rec.CreateTime {
				ageHours = round2(float64(now-rec.CreateTime) / 3600)
			}
			items = append(items, TopUpAnomalyRecord{TopUpRecord: rec, AgeHours: ageHours})
		}
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

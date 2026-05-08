package service

import (
	"strings"
	"testing"
	"time"

	"github.com/new-api-tools/backend/internal/cache"
)

// TestMondayOf 锁定周分桶的对齐：所有结果必须落在某个周一 00:00:00 本地时间。
func TestMondayOf(t *testing.T) {
	loc := time.Local

	cases := []struct {
		name string
		in   time.Time
	}{
		{"sunday", time.Date(2026, 5, 3, 23, 59, 59, 0, loc)},  // Sun
		{"monday", time.Date(2026, 5, 4, 0, 0, 1, 0, loc)},     // Mon
		{"wednesday", time.Date(2026, 5, 6, 12, 0, 0, 0, loc)}, // Wed
		{"saturday", time.Date(2026, 5, 9, 9, 0, 0, 0, loc)},   // Sat
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m := mondayOf(c.in)
			if m.Weekday() != time.Monday {
				t.Errorf("mondayOf(%v) = %v, want Monday", c.in, m.Weekday())
			}
			if m.Hour() != 0 || m.Minute() != 0 || m.Second() != 0 {
				t.Errorf("mondayOf(%v) not midnight: %v", c.in, m)
			}
			// 结果必须 <= 输入（同周或上周一）。
			if m.After(c.in) {
				t.Errorf("mondayOf(%v) = %v is after input", c.in, m)
			}
			// 输入与结果之间不能跨过 7 天。
			if c.in.Sub(m) >= 7*24*time.Hour {
				t.Errorf("mondayOf(%v) = %v is more than 7d before input", c.in, m)
			}
		})
	}
}

// TestWeeklyBucketAlignment 验证 SQL 端使用的算术分桶 -345600 偏移确实让周一对齐。
// 两个同周的不同周中天，bucket 应相同；周日 23:59 与下周一 00:00 应不同 bucket。
func TestWeeklyBucketAlignment(t *testing.T) {
	tz := localTZOffset()

	bucket := func(ts int64) int64 {
		return (ts + int64(tz) - 345600) / 604800
	}

	loc := time.Local
	mon := time.Date(2026, 5, 4, 0, 0, 0, 0, loc).Unix()        // 周一 00:00
	wed := time.Date(2026, 5, 6, 12, 0, 0, 0, loc).Unix()       // 周三 12:00
	sun := time.Date(2026, 5, 10, 23, 59, 59, 0, loc).Unix()    // 周日 23:59
	nextMon := time.Date(2026, 5, 11, 0, 0, 0, 0, loc).Unix()   // 下周一 00:00
	prevSun := time.Date(2026, 5, 3, 23, 59, 59, 0, loc).Unix() // 上周日 23:59

	if bucket(mon) != bucket(wed) || bucket(mon) != bucket(sun) {
		t.Errorf("monday/wednesday/sunday should share one bucket, got %d/%d/%d",
			bucket(mon), bucket(wed), bucket(sun))
	}
	if bucket(mon) == bucket(nextMon) {
		t.Errorf("week boundary not respected: monday == next monday bucket")
	}
	if bucket(mon) == bucket(prevSun) {
		t.Errorf("week boundary not respected: monday == previous sunday bucket")
	}
	if bucket(nextMon)-bucket(mon) != 1 {
		t.Errorf("adjacent week buckets should differ by 1, got delta %d", bucket(nextMon)-bucket(mon))
	}
}

// TestResolveTrendsRange_Defaults 验证粒度白名单 + 天数兜底。
func TestResolveTrendsRange_Defaults(t *testing.T) {
	g, s, e := resolveTrendsRange(TopUpTrendsParams{Granularity: "garbage", Days: 0})
	if g != "daily" {
		t.Errorf("invalid granularity should fall back to daily, got %s", g)
	}
	if s >= e {
		t.Errorf("start should be before end, got %d >= %d", s, e)
	}
	// days=0 走 30 天兜底，区间约为 30*86400 秒（含跨天 endOfToday 取 23:59:59 略大）
	span := e - s
	if span < 29*86400 || span > 31*86400 {
		t.Errorf("default days should produce ~30d span, got %d seconds (~%.1fd)", span, float64(span)/86400)
	}
}

func TestResolveTrendsRange_CustomRange(t *testing.T) {
	g, s, e := resolveTrendsRange(TopUpTrendsParams{
		Granularity: "weekly",
		StartDate:   "2026-04-01",
		EndDate:     "2026-04-30",
		Days:        9999, // 自定义区间生效时 Days 应被忽略
	})
	if g != "weekly" {
		t.Errorf("expected weekly, got %s", g)
	}
	loc := time.Local
	wantStart := time.Date(2026, 4, 1, 0, 0, 0, 0, loc).Unix()
	wantEnd := time.Date(2026, 4, 30, 23, 59, 59, 0, loc).Unix()
	if s != wantStart {
		t.Errorf("start: got %d, want %d", s, wantStart)
	}
	if e != wantEnd {
		t.Errorf("end: got %d, want %d", e, wantEnd)
	}
}

func TestResolveTrendsRange_DaysClamp(t *testing.T) {
	// 越界天数（负数 / 0 / 超过 365）都回落 30 天
	for _, days := range []int{-5, 0, 366, 100000} {
		_, s, e := resolveTrendsRange(TopUpTrendsParams{Days: days})
		span := e - s
		if span < 29*86400 || span > 31*86400 {
			t.Errorf("days=%d should clamp to 30d, got span=%d (~%.1fd)", days, span, float64(span)/86400)
		}
	}
}

func TestGetTopUpTopUsers_QualifiesStatusWhenJoiningUsers(t *testing.T) {
	seedTopUpAnalyticsTables(t)

	got, err := GetTopUpTopUsers(10, 365)
	if err != nil {
		t.Fatalf("GetTopUpTopUsers returned error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected only the successful user, got %d rows: %#v", len(got), got)
	}
	if got[0].UserID != 1 || got[0].Username != "alice" {
		t.Fatalf("unexpected top user: %#v", got[0])
	}
	if got[0].Count != 2 || got[0].Money != 30 || got[0].Amount != 150 {
		t.Fatalf("unexpected aggregate: %#v", got[0])
	}
	if got[1].UserID != 99 || got[1].Username != "99" {
		t.Fatalf("expected missing user to fall back to user id, got %#v", got[1])
	}
	if got[1].Count != 1 || got[1].Money != 5 || got[1].Amount != 10 {
		t.Fatalf("unexpected fallback-user aggregate: %#v", got[1])
	}
}

func TestSuccessStatusCondition_QualifiesAndTrimsStatus(t *testing.T) {
	qualified := successStatusCondition("t.status")
	for _, frag := range []string{"TRIM(t.status)", "LOWER(TRIM(t.status))", "= '1'"} {
		if !strings.Contains(qualified, frag) {
			t.Fatalf("qualified success condition missing %q: %s", frag, qualified)
		}
	}
	if strings.Contains(qualified, "LOWER(status)") {
		t.Fatalf("qualified success condition must not use ambiguous bare status: %s", qualified)
	}

	unqualified := successStatusCondition()
	if !strings.Contains(unqualified, "TRIM(status)") {
		t.Fatalf("default success condition should still target status: %s", unqualified)
	}
}

func TestTopUpHeatmapTimeExpressions_PostgresCastsDayBucketBeforeModulo(t *testing.T) {
	_, dowExpr := topUpHeatmapTimeExpressions(28800, true)
	for _, frag := range []string{"CAST(FLOOR", "AS BIGINT", "% 7"} {
		if !strings.Contains(dowExpr, frag) {
			t.Fatalf("PostgreSQL DOW expression missing %q: %s", frag, dowExpr)
		}
	}
}

func TestTopUpHeatmapGrid_FillsFullGridAndIgnoresInvalidCells(t *testing.T) {
	rows := []map[string]interface{}{
		{"day_of_week": int64(1), "hour": int64(10), "count": int64(2), "money": float64(30.5)},
		{"day_of_week": "6", "hour": "23", "count": "1", "money": "9.99"},
		{"day_of_week": int64(7), "hour": int64(12), "count": int64(99), "money": float64(99)},
		{"day_of_week": int64(2), "hour": int64(24), "count": int64(99), "money": float64(99)},
	}

	got := topUpHeatmapGrid(rows)
	if len(got) != 7*24 {
		t.Fatalf("expected full 7x24 grid, got %d cells", len(got))
	}

	assertHeatmapCell(t, got, 1, 10, 2, 30.5)
	assertHeatmapCell(t, got, 6, 23, 1, 9.99)
	assertHeatmapCell(t, got, 0, 0, 0, 0)

	var totalCount int64
	for _, cell := range got {
		totalCount += cell.Count
	}
	if totalCount != 3 {
		t.Fatalf("invalid cells should be ignored, total count=%d", totalCount)
	}
}

func TestGetTopUpPayerCohorts_UsersCreatedAtIsOptional(t *testing.T) {
	clearTopUpAnalyticsCache(t)
	t.Cleanup(func() { clearTopUpAnalyticsCache(t) })

	db := installSQLiteForTests(t)
	db.MustExec(`
		CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			username TEXT,
			status INTEGER
		);
		CREATE TABLE top_ups (
			id INTEGER PRIMARY KEY,
			user_id INTEGER,
			amount INTEGER,
			money REAL,
			create_time INTEGER,
			status TEXT
		);
	`)

	now := time.Now().Unix()
	old := now - 60*86400
	db.MustExec(`INSERT INTO users (id, username, status) VALUES (1, 'alice', 1), (2, 'bob', 1)`)
	db.MustExec(`INSERT INTO top_ups (id, user_id, amount, money, create_time, status) VALUES
		(1, 1, 100, 10, ?, 'success'),
		(2, 1, 200, 20, ?, ' Completed '),
		(3, 2, 300, 30, ?, 'success'),
		(4, 2, 400, 5, ?, 'success'),
		(5, 99, 500, 7, ?, '1')`,
		now-5*86400,
		now-4*86400,
		old,
		now-2*86400,
		now-1*86400,
	)

	got, err := GetTopUpPayerCohorts(30)
	if err != nil {
		t.Fatalf("GetTopUpPayerCohorts returned error without users.created_at: %v", err)
	}
	if got.PayingUsers != 3 {
		t.Fatalf("paying users = %d, want 3", got.PayingUsers)
	}
	if got.FirstTimePayers != 2 {
		t.Fatalf("first-time payers = %d, want 2", got.FirstTimePayers)
	}
	if got.RepeatPayers != 1 {
		t.Fatalf("repeat payers = %d, want 1", got.RepeatPayers)
	}
	if got.TotalRevenue != 42 {
		t.Fatalf("total revenue = %v, want 42", got.TotalRevenue)
	}
	if got.AvgFirstPayDelayHours != 0 {
		t.Fatalf("missing users.created_at should disable first-pay delay, got %v", got.AvgFirstPayDelayHours)
	}
}

func TestGetTopUpAnomalies_CompleteTimeIsNullable(t *testing.T) {
	clearTopUpAnalyticsCache(t)
	t.Cleanup(func() { clearTopUpAnalyticsCache(t) })

	db := installSQLiteForTests(t)
	db.MustExec(`
		CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			username TEXT
		);
		CREATE TABLE top_ups (
			id INTEGER PRIMARY KEY,
			user_id INTEGER,
			amount INTEGER,
			money REAL,
			trade_no TEXT,
			payment_method TEXT,
			payment_provider TEXT,
			create_time INTEGER,
			complete_time INTEGER,
			status TEXT
		);
	`)

	now := time.Now().Unix()
	db.MustExec(`INSERT INTO users (id, username) VALUES (1, 'alice')`)
	db.MustExec(`INSERT INTO top_ups (id, user_id, amount, money, trade_no, payment_method, payment_provider, create_time, complete_time, status) VALUES
		(1, 1, 100, 10, 'ok-missing-complete', 'stripe', 'stripe', ?, NULL, 'success'),
		(2, 1, 100, 10, 'bad-time', 'stripe', 'stripe', ?, ?, 'success'),
		(3, 1, 100, 10, 'pending-old', 'stripe', 'stripe', ?, NULL, 'pending')`,
		now-3600,
		now-1000, now-2000,
		now-3*3600,
	)

	got, err := GetTopUpAnomalies(30, 2, 50)
	if err != nil {
		t.Fatalf("GetTopUpAnomalies returned error: %v", err)
	}
	if got.Summary.SuccessMissingComplete != 0 {
		t.Fatalf("success_missing_complete = %d, want 0", got.Summary.SuccessMissingComplete)
	}
	if got.Summary.TotalAnomalies != 2 {
		t.Fatalf("total anomalies = %d, want 2", got.Summary.TotalAnomalies)
	}
	if len(got.Items) != 2 {
		t.Fatalf("items = %d, want 2: %#v", len(got.Items), got.Items)
	}
	for _, item := range got.Items {
		if item.TradeNo == "ok-missing-complete" {
			t.Fatalf("nullable complete_time-only row should not be returned: %#v", item)
		}
		for _, reason := range item.AnomalyReasons {
			if reason == "成功但无完成时间" {
				t.Fatalf("nullable complete_time reason should not be emitted: %#v", item)
			}
		}
	}
}

func TestGetTopUpProviderHealth_PaymentProviderColumnOptional(t *testing.T) {
	clearTopUpAnalyticsCache(t)
	t.Cleanup(func() { clearTopUpAnalyticsCache(t) })

	db := installSQLiteForTests(t)
	db.MustExec(`
		CREATE TABLE top_ups (
			id INTEGER PRIMARY KEY,
			user_id INTEGER,
			amount INTEGER,
			money REAL,
			trade_no TEXT,
			payment_method TEXT,
			create_time INTEGER,
			complete_time INTEGER,
			status TEXT
		);
	`)

	now := time.Now().Unix()
	db.MustExec(`INSERT INTO top_ups (id, user_id, amount, money, trade_no, payment_method, create_time, complete_time, status)
		VALUES (1, 1, 100, 10, 'trade-1', 'alipay', ?, ?, 'success')`, now-3600, now-3500)

	got, err := GetTopUpProviderHealth(30)
	if err != nil {
		t.Fatalf("GetTopUpProviderHealth returned error without payment_provider column: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("provider health rows = %d, want 1: %#v", len(got), got)
	}
	if got[0].Provider != "未知" {
		t.Fatalf("provider = %q, want fallback 未知", got[0].Provider)
	}
	if got[0].Method != "alipay" {
		t.Fatalf("method = %q, want alipay", got[0].Method)
	}
}

func seedTopUpAnalyticsTables(t *testing.T) {
	t.Helper()
	clearTopUpAnalyticsCache(t)
	t.Cleanup(func() { clearTopUpAnalyticsCache(t) })

	db := installSQLiteForTests(t)
	db.MustExec(`
		CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			username TEXT,
			status INTEGER
		);
		CREATE TABLE top_ups (
			id INTEGER PRIMARY KEY,
			user_id INTEGER,
			amount INTEGER,
			money REAL,
			payment_method TEXT,
			create_time INTEGER,
			complete_time INTEGER,
			status TEXT
		);
	`)

	now := time.Now().Unix()
	db.MustExec(`INSERT INTO users (id, username, status) VALUES (1, 'alice', 1), (2, 'bob', 1)`)
	db.MustExec(`INSERT INTO top_ups (id, user_id, amount, money, payment_method, create_time, complete_time, status) VALUES
		(1, 1, 100, 20, 'stripe', ?, ?, 'success'),
		(2, 1, 50, 10, 'stripe', ?, ?, ' Completed '),
		(3, 2, 500, 500, 'stripe', ?, 0, 'pending'),
		(4, 99, 10, 5, 'stripe', ?, ?, '1')`,
		now-3600, now-3000,
		now-7200, now-7000,
		now-1800,
		now-1200, now-1100,
	)
}

func assertHeatmapCell(t *testing.T, cells []HourlyHeatmapPoint, dow, hour int, wantCount int64, wantMoney float64) {
	t.Helper()
	for _, cell := range cells {
		if cell.DayOfWeek == dow && cell.Hour == hour {
			if cell.Count != wantCount || cell.Money != wantMoney {
				t.Fatalf("cell %d/%d = count %d money %v, want count %d money %v",
					dow, hour, cell.Count, cell.Money, wantCount, wantMoney)
			}
			return
		}
	}
	t.Fatalf("missing cell %d/%d", dow, hour)
}

func clearTopUpAnalyticsCache(t *testing.T) {
	t.Helper()
	if _, err := cache.Get().DeleteByPrefix("topup:"); err != nil {
		t.Fatalf("clear top-up analytics cache: %v", err)
	}
}

package service

import (
	"testing"
	"time"
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
	mon := time.Date(2026, 5, 4, 0, 0, 0, 0, loc).Unix()           // 周一 00:00
	wed := time.Date(2026, 5, 6, 12, 0, 0, 0, loc).Unix()          // 周三 12:00
	sun := time.Date(2026, 5, 10, 23, 59, 59, 0, loc).Unix()       // 周日 23:59
	nextMon := time.Date(2026, 5, 11, 0, 0, 0, 0, loc).Unix()      // 下周一 00:00
	prevSun := time.Date(2026, 5, 3, 23, 59, 59, 0, loc).Unix()    // 上周日 23:59

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

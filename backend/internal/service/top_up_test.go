package service

import (
	"strings"
	"testing"

	"github.com/jmoiron/sqlx"
	"github.com/new-api-tools/backend/internal/database"
	_ "modernc.org/sqlite"
)

// installSQLiteForTests replaces the global manager with an in-memory SQLite.
// Sufficient for buildTopUpWhere (only Placeholder is touched) and ExportTopUpsToCSV
// (real query execution).
func installSQLiteForTests(t *testing.T) *sqlx.DB {
	t.Helper()
	db, err := sqlx.Connect("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	database.SetForTesting(&database.Manager{DB: db, IsPG: false})
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestBuildTopUpWhere_PendingIncludesNULL(t *testing.T) {
	installSQLiteForTests(t)

	where, _, _ := buildTopUpWhere(ListTopUpParams{Status: "pending"})

	// 关键诉求：pending 走统一归一化状态桶，必须涵盖 NULL / 空值，
	// 同时不能把 expired 或 unknown 混入待处理。
	for _, marker := range []string{"COALESCE(t.status, '')", "'pending'", "'expired'", "'unknown'"} {
		if !strings.Contains(where, marker) {
			t.Errorf("pending where missing marker %s, got: %s", marker, where)
		}
	}
	if !strings.Contains(where, "= ?") {
		t.Fatalf("pending where should compare normalized bucket with a placeholder, got: %s", where)
	}
}

func TestBuildTopUpWhere_StatusFiltersUseNormalizedBucket(t *testing.T) {
	installSQLiteForTests(t)

	for _, status := range []string{"success", "failed", "pending", "expired", "unknown"} {
		where, _, _ := buildTopUpWhere(ListTopUpParams{Status: status})
		if !strings.Contains(where, "CASE") || !strings.Contains(where, "= ?") {
			t.Errorf("status=%s should use normalized CASE bucket, got: %s", status, where)
		}
	}
}

func TestBuildTopUpWhere_FilterCombination(t *testing.T) {
	installSQLiteForTests(t)

	uid := int64(42)
	where, args, next := buildTopUpWhere(ListTopUpParams{
		UserID:        &uid,
		Status:        "success",
		PaymentMethod: "alipay",
		TradeNo:       "ABC",
		StartDate:     "2026-01-01",
		EndDate:       "2026-01-31",
	})

	// SQLite 走 ? 占位符，placeholder index 用 1 起，结束后 next 应等于已用 placeholder 数 + 1
	if next < 6 {
		t.Errorf("next placeholder index too low: %d", next)
	}
	if len(args) < 5 {
		t.Errorf("expected >=5 args, got %d", len(args))
	}
	for _, frag := range []string{
		"t.user_id = ?",
		"t.payment_method = ?",
		"t.trade_no LIKE ?",
		"t.create_time >= ?",
		"t.create_time <= ?",
	} {
		if !strings.Contains(where, frag) {
			t.Errorf("missing fragment %q in: %s", frag, where)
		}
	}
}

func TestBuildTopUpWhere_NoParams(t *testing.T) {
	installSQLiteForTests(t)

	where, args, _ := buildTopUpWhere(ListTopUpParams{})
	if where != "1=1" {
		t.Errorf("empty params should yield 1=1, got: %s", where)
	}
	if len(args) != 0 {
		t.Errorf("expected 0 args, got %d", len(args))
	}
}

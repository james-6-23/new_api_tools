package service

import (
	"strings"
	"testing"

	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
	"github.com/new-api-tools/backend/internal/database"
)

// installSQLiteForTests replaces the global manager with an in-memory SQLite.
// Sufficient for buildTopUpWhere (only Placeholder is touched) and ExportTopUpsToCSV
// (real query execution).
func installSQLiteForTests(t *testing.T) *sqlx.DB {
	t.Helper()
	db, err := sqlx.Connect("sqlite3", ":memory:")
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

	// 关键诉求：pending 必须涵盖 status IS NULL —— 否则 NULL 行既不算成功也不算失败也不算 pending，
	// 与 funnel 里 ELSE 'pending' 的兜底分桶口径不一致。
	if !strings.Contains(where, "t.status IS NULL") {
		t.Fatalf("pending where must explicitly include NULL, got: %s", where)
	}
	// 也必须排除已成功 / 已失败的所有别名。
	for _, marker := range []string{"'success'", "'failed'", "'completed'", "'error'", "'1'", "'-1'"} {
		if !strings.Contains(where, marker) {
			t.Errorf("pending where missing exclusion marker %s, got: %s", marker, where)
		}
	}
}

func TestBuildTopUpWhere_SuccessAndFailedDoNotIncludeNULL(t *testing.T) {
	installSQLiteForTests(t)

	for _, status := range []string{"success", "failed"} {
		where, _, _ := buildTopUpWhere(ListTopUpParams{Status: status})
		// success/failed 是显式枚举值匹配，必须不含 IS NULL —— NULL 应只走 pending。
		if strings.Contains(where, "IS NULL") {
			t.Errorf("status=%s where must NOT include IS NULL, got: %s", status, where)
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

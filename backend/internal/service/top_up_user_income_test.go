package service

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func seedUserIncomeTables(t *testing.T) {
	t.Helper()
	db := installSQLiteForTests(t)

	schema := `
	CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
	CREATE TABLE top_ups (
		id INTEGER PRIMARY KEY,
		user_id INTEGER NOT NULL,
		amount INTEGER NOT NULL DEFAULT 0,
		money REAL NOT NULL DEFAULT 0,
		trade_no TEXT,
		payment_method TEXT,
		payment_provider TEXT,
		create_time INTEGER,
		complete_time INTEGER,
		status TEXT
	);
	CREATE TABLE redemptions (
		id INTEGER PRIMARY KEY,
		user_id INTEGER,
		"key" TEXT,
		name TEXT,
		quota INTEGER,
		created_time INTEGER,
		redeemed_time INTEGER,
		used_user_id INTEGER,
		deleted_at TEXT,
		expired_time INTEGER
	);`
	if _, err := db.Exec(schema); err != nil {
		t.Fatalf("schema: %v", err)
	}

	db.MustExec(`INSERT INTO users (id, username) VALUES (42, 'alice')`)
	// 2 成功 + 1 待支付
	db.MustExec(`INSERT INTO top_ups (id, user_id, amount, money, trade_no, payment_method, create_time, complete_time, status) VALUES
		(1, 42, 10, 70.00, 'T1', 'alipay', 1000, 1100, 'success'),
		(2, 42, 20, 140.00, 'T2', 'wechat', 2000, 2100, 'success'),
		(3, 42, 5, 35.00, 'T3', 'alipay', 3000, 0, 'pending')`)
	// 兑换码：配额 500000 = $1
	db.MustExec(`INSERT INTO redemptions (id, user_id, "key", name, quota, created_time, redeemed_time, used_user_id, deleted_at, expired_time) VALUES
		(1, 1, 'CODEAAA', '拉新', 500000, 900, 2500, 42, NULL, 0),
		(2, 1, 'CODEBBB', '活动', 1000000, 900, 2600, 42, NULL, 0)`)
}

func TestGetUserQuotaIncomeSummary(t *testing.T) {
	seedUserIncomeTables(t)

	sum, err := GetUserQuotaIncomeSummary(42, "", "")
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if sum.Username != "alice" {
		t.Errorf("username=%q want alice", sum.Username)
	}
	if sum.PaidCount != 2 {
		t.Errorf("paid_count=%d want 2", sum.PaidCount)
	}
	if sum.PaidAmount != 30 {
		t.Errorf("paid_amount=%v want 30", sum.PaidAmount)
	}
	if sum.PaidMoney != 210 {
		t.Errorf("paid_money=%v want 210", sum.PaidMoney)
	}
	if sum.RedemptionCount != 2 {
		t.Errorf("redemption_count=%d want 2", sum.RedemptionCount)
	}
	// 500000+1000000 = 1500000 / 500000 = 3 USD
	if sum.RedemptionQuotaUSD != 3 {
		t.Errorf("redemption_quota_usd=%v want 3", sum.RedemptionQuotaUSD)
	}
	if sum.NetPaidAmountUSD != 30 {
		t.Errorf("net_paid=%v want 30 (exclude redemptions)", sum.NetPaidAmountUSD)
	}
	if sum.TotalIncomeUSD != 33 {
		t.Errorf("total_income=%v want 33", sum.TotalIncomeUSD)
	}
}

func TestExportUserIncomeCSV_MarksRedemptions(t *testing.T) {
	seedUserIncomeTables(t)

	uid := int64(42)
	var buf bytes.Buffer
	err := ExportTopUpsToCSV(context.Background(), &buf, ListTopUpParams{UserID: &uid})
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	out := buf.String()

	if !strings.Contains(out, "类型") || !strings.Contains(out, "计入实付统计") {
		t.Errorf("missing enhanced header columns, got:\n%s", out)
	}
	if !strings.Contains(out, "在线充值") {
		t.Errorf("expected online top-up rows")
	}
	if !strings.Contains(out, "兑换码") {
		t.Errorf("expected redemption rows marked as 兑换码")
	}
	if !strings.Contains(out, "兑换码兑换额度，已从实付统计中剔除") {
		t.Errorf("expected redemption exclusion note")
	}
	if !strings.Contains(out, "剔除兑换码后实付额度(USD)") {
		t.Errorf("expected summary footer")
	}
	// 成功充值应计入实付
	if !strings.Contains(out, "是") {
		t.Errorf("expected 计入实付=是 for success top-ups")
	}
}

func TestExportTopUpsToCSV_WithoutUserID_KeepsLegacyHeader(t *testing.T) {
	seedUserIncomeTables(t)

	var buf bytes.Buffer
	if err := ExportTopUpsToCSV(context.Background(), &buf, ListTopUpParams{}); err != nil {
		t.Fatalf("plain export: %v", err)
	}
	out := buf.String()
	if strings.Contains(out, "计入实付统计") {
		t.Errorf("global export should not use user-income headers")
	}
	if strings.Contains(out, "===== 统计摘要 =====") {
		t.Errorf("global export should not append user summary")
	}
}

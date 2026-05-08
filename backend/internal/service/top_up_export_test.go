package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"strings"
	"testing"
)

// seedTopUps creates the top_ups table on the in-memory SQLite and inserts n rows.
// SQLite 接受 ? 占位符并兼容 LOWER/COALESCE，足够覆盖 ExportTopUpsToCSV 的查询面。
func seedTopUps(t *testing.T, n int) {
	t.Helper()
	db := installSQLiteForTests(t)

	schema := `
	CREATE TABLE top_ups (
		id INTEGER PRIMARY KEY,
		user_id INTEGER NOT NULL,
		amount INTEGER NOT NULL DEFAULT 0,
		money REAL NOT NULL DEFAULT 0,
		trade_no TEXT,
		payment_method TEXT,
		payment_provider TEXT,
		create_time INTEGER NOT NULL DEFAULT 0,
		complete_time INTEGER NOT NULL DEFAULT 0,
		status TEXT
	);
	CREATE TABLE users (
		id INTEGER PRIMARY KEY,
		username TEXT
	);`
	if _, err := db.Exec(schema); err != nil {
		t.Fatalf("schema: %v", err)
	}

	tx, err := db.Beginx()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	for i := 1; i <= n; i++ {
		_, err := tx.Exec(
			`INSERT INTO top_ups (id, user_id, amount, money, trade_no, payment_method, payment_provider, create_time, complete_time, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			i, i%5+1, 100, 1.5, fmt.Sprintf("T%06d", i), "alipay", "epay", 1700000000+int64(i), 1700000010+int64(i), "success",
		)
		if err != nil {
			t.Fatalf("insert %d: %v", i, err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
}

func countCSVRows(t *testing.T, buf []byte) int {
	t.Helper()
	// 跳过 UTF-8 BOM
	if len(buf) >= 3 && buf[0] == 0xEF && buf[1] == 0xBB && buf[2] == 0xBF {
		buf = buf[3:]
	}
	r := csv.NewReader(strings.NewReader(string(buf)))
	r.FieldsPerRecord = -1
	rows, err := r.ReadAll()
	if err != nil {
		t.Fatalf("parse csv: %v", err)
	}
	return len(rows)
}

func TestExportTopUpsToCSV_BOMAndHeader(t *testing.T) {
	seedTopUps(t, 3)

	var buf bytes.Buffer
	if err := ExportTopUpsToCSV(context.Background(), &buf, ListTopUpParams{}); err != nil {
		t.Fatalf("export: %v", err)
	}
	out := buf.Bytes()

	if len(out) < 3 || out[0] != 0xEF || out[1] != 0xBB || out[2] != 0xBF {
		t.Errorf("missing UTF-8 BOM at start of CSV")
	}
	rows := countCSVRows(t, out)
	// 1 header + 3 data
	if rows != 4 {
		t.Errorf("expected 4 csv rows (1 header + 3 data), got %d", rows)
	}
	if !bytes.Contains(out, []byte("ID")) {
		t.Errorf("CSV should contain header column 'ID'")
	}
}

// TestExportTopUpsToCSV_HardLimitBreaks 验证当 SELECT 实际结果超过 TopUpExportLimit 时
// 流式写入精确停在上限行，不会写出第 limit+1 行。模拟 count 与 select 之间有新行插入的 race。
// 临时把全局上限调小，运行结束恢复。
func TestExportTopUpsToCSV_HardLimitBreaks(t *testing.T) {
	original := TopUpExportLimit
	TopUpExportLimit = 10
	t.Cleanup(func() { TopUpExportLimit = original })

	// 模拟 race：插入 limit + 5 行（count 时只看到 10 行，select 时已涌入 5 行）。
	seedTopUps(t, 15)

	var buf bytes.Buffer
	if err := ExportTopUpsToCSV(context.Background(), &buf, ListTopUpParams{}); err != nil {
		t.Fatalf("export: %v", err)
	}
	rows := countCSVRows(t, buf.Bytes())
	// header(1) + 至多 limit(10) 数据行
	wantMax := 1 + int(TopUpExportLimit)
	if rows > wantMax {
		t.Errorf("rows=%d exceeded header(1)+limit(%d), break didn't fire",
			rows, TopUpExportLimit)
	}
	// 也要确保确实写到了上限（否则不算覆盖 break 路径）。
	if rows < wantMax {
		t.Errorf("rows=%d less than expected %d, break may have fired too early",
			rows, wantMax)
	}
}

// TestExportTopUpsToCSV_ContextCancel 验证 ctx 取消后立即停止流，不再继续写。
func TestExportTopUpsToCSV_ContextCancel(t *testing.T) {
	seedTopUps(t, 200)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // 提前取消

	var buf bytes.Buffer
	err := ExportTopUpsToCSV(ctx, &buf, ListTopUpParams{})
	// 取消可能在 query 阶段（返回 err）或 next 阶段（返回 ctx.Err()），两种都接受
	if err == nil {
		// 也允许 query 已经完成但 rows.Next 检查 ctx 时返回。检查写入量很小。
		rows := countCSVRows(t, buf.Bytes())
		if rows > 1 { // header 之外不应有数据
			t.Errorf("expected ctx cancel to abort early, but got %d rows", rows)
		}
		return
	}
	if ctx.Err() == nil {
		t.Errorf("expected ctx error, got: %v", err)
	}
}

func TestExportTopUpsToCSV_StatusFilter(t *testing.T) {
	db := installSQLiteForTests(t)
	schema := `
	CREATE TABLE top_ups (
		id INTEGER PRIMARY KEY,
		user_id INTEGER NOT NULL,
		amount INTEGER NOT NULL DEFAULT 0,
		money REAL NOT NULL DEFAULT 0,
		trade_no TEXT,
		payment_method TEXT,
		payment_provider TEXT,
		create_time INTEGER NOT NULL DEFAULT 0,
		complete_time INTEGER NOT NULL DEFAULT 0,
		status TEXT
	);
	CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);`
	if _, err := db.Exec(schema); err != nil {
		t.Fatalf("schema: %v", err)
	}
	seedRows := []struct {
		id     int
		status interface{} // 用 interface 允许塞 nil
	}{
		{1, "success"},
		{2, "completed"},
		{3, "failed"},
		{4, "pending"},
		{5, nil}, // NULL
		{6, "1"},
	}
	for _, r := range seedRows {
		_, err := db.Exec(
			`INSERT INTO top_ups (id, user_id, amount, money, create_time, status) VALUES (?, 1, 0, 0, ?, ?)`,
			r.id, 1700000000+r.id, r.status,
		)
		if err != nil {
			t.Fatalf("insert: %v", err)
		}
	}

	// pending 必须捞到 id=4 (pending) 和 id=5 (NULL)
	var buf bytes.Buffer
	if err := ExportTopUpsToCSV(context.Background(), &buf, ListTopUpParams{Status: "pending"}); err != nil {
		t.Fatalf("export: %v", err)
	}
	out := string(buf.Bytes())
	if !strings.Contains(out, ",4,") && !strings.Contains(out, "\n4,") {
		t.Errorf("pending export should include id=4, got:\n%s", out)
	}
	if !strings.Contains(out, ",5,") && !strings.Contains(out, "\n5,") {
		t.Errorf("pending export should include id=5 (NULL status), got:\n%s", out)
	}
	if strings.Contains(out, ",1,success") || strings.Contains(out, ",3,failed") {
		t.Errorf("pending export must NOT include success/failed rows, got:\n%s", out)
	}
}

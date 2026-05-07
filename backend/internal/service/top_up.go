package service

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/new-api-tools/backend/internal/database"
	"github.com/new-api-tools/backend/internal/util"
)

// TopUpRecord represents a top-up record
type TopUpRecord struct {
	ID            int64   `json:"id" db:"id"`
	UserID        int64   `json:"user_id" db:"user_id"`
	Username      *string `json:"username" db:"username"`
	Amount        int64   `json:"amount" db:"amount"`
	Money         float64 `json:"money" db:"money"`
	TradeNo       string  `json:"trade_no" db:"trade_no"`
	PaymentMethod string  `json:"payment_method" db:"payment_method"`
	CreateTime    int64   `json:"create_time" db:"create_time"`
	CompleteTime  int64   `json:"complete_time" db:"complete_time"`
	Status        string  `json:"status" db:"status"`
}

// TopUpStatistics holds aggregate top-up statistics
type TopUpStatistics struct {
	TotalCount    int64   `json:"total_count"`
	TotalAmount   int64   `json:"total_amount"`
	TotalMoney    float64 `json:"total_money"`
	SuccessCount  int64   `json:"success_count"`
	SuccessAmount int64   `json:"success_amount"`
	SuccessMoney  float64 `json:"success_money"`
	PendingCount  int64   `json:"pending_count"`
	PendingAmount int64   `json:"pending_amount"`
	PendingMoney  float64 `json:"pending_money"`
	FailedCount   int64   `json:"failed_count"`
	FailedAmount  int64   `json:"failed_amount"`
	FailedMoney   float64 `json:"failed_money"`
}

// ListTopUpParams holds list query parameters
type ListTopUpParams struct {
	Page          int    `json:"page"`
	PageSize      int    `json:"page_size"`
	UserID        *int64 `json:"user_id"`
	Status        string `json:"status"`
	PaymentMethod string `json:"payment_method"`
	TradeNo       string `json:"trade_no"`
	StartDate     string `json:"start_date"`
	EndDate       string `json:"end_date"`
}

// PaginatedTopUps holds paginated top-up results
type PaginatedTopUps struct {
	Items      []TopUpRecord `json:"items"`
	Total      int64         `json:"total"`
	Page       int           `json:"page"`
	PageSize   int           `json:"page_size"`
	TotalPages int           `json:"total_pages"`
}

// buildTopUpWhere translates filter params into a parameterised WHERE clause.
// Returns the WHERE body (without the leading "WHERE"), the corresponding args,
// and the next placeholder index that the caller should use for additional args
// (e.g. LIMIT/OFFSET when paginating).
func buildTopUpWhere(params ListTopUpParams) (string, []interface{}, int) {
	db := database.Get()

	where := []string{}
	args := []interface{}{}
	argIdx := 1

	if params.UserID != nil {
		where = append(where, fmt.Sprintf("t.user_id = %s", db.Placeholder(argIdx)))
		args = append(args, *params.UserID)
		argIdx++
	}

	if params.Status != "" {
		switch params.Status {
		case "success":
			where = append(where, "(LOWER(t.status) IN ('success', 'completed') OR t.status = '1')")
		case "failed":
			where = append(where, "(LOWER(t.status) IN ('failed', 'error') OR t.status = '-1')")
		case "pending":
			// NULL 走 ELSE 兜底归入 pending（与 funnel 的 status 分桶一致）；
			// 用 IS NULL 显式短路，避免 LOWER(NULL)/NOT IN 整体为 NULL 时被剔除。
			where = append(where, "(t.status IS NULL OR (LOWER(t.status) NOT IN ('success', 'failed', 'completed', 'error') AND t.status NOT IN ('1', '-1')))")
		}
	}

	if params.PaymentMethod != "" {
		where = append(where, fmt.Sprintf("t.payment_method = %s", db.Placeholder(argIdx)))
		args = append(args, params.PaymentMethod)
		argIdx++
	}

	if params.TradeNo != "" {
		where = append(where, fmt.Sprintf("t.trade_no LIKE %s", db.Placeholder(argIdx)))
		args = append(args, "%"+params.TradeNo+"%")
		argIdx++
	}

	if params.StartDate != "" {
		ts, err := util.ParseDateToTimestampPublic(params.StartDate, false)
		if err == nil {
			where = append(where, fmt.Sprintf("t.create_time >= %s", db.Placeholder(argIdx)))
			args = append(args, ts)
			argIdx++
		}
	}

	if params.EndDate != "" {
		ts, err := util.ParseDateToTimestampPublic(params.EndDate, true)
		if err == nil {
			where = append(where, fmt.Sprintf("t.create_time <= %s", db.Placeholder(argIdx)))
			args = append(args, ts)
			argIdx++
		}
	}

	whereSQL := "1=1"
	if len(where) > 0 {
		whereSQL = strings.Join(where, " AND ")
	}
	return whereSQL, args, argIdx
}

// ListTopUpRecords lists top-up records with pagination and filtering
func ListTopUpRecords(params ListTopUpParams) (*PaginatedTopUps, error) {
	if params.Page < 1 {
		params.Page = 1
	}
	if params.PageSize < 1 || params.PageSize > 100 {
		params.PageSize = 20
	}

	db := database.Get()

	whereSQL, args, argIdx := buildTopUpWhere(params)

	// Count
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM top_ups t WHERE %s", whereSQL)
	var total int64
	if err := db.DB.Get(&total, countSQL, args...); err != nil {
		return nil, fmt.Errorf("count query failed: %w", err)
	}

	totalPages := int((total + int64(params.PageSize) - 1) / int64(params.PageSize))
	if totalPages < 1 {
		totalPages = 1
	}
	offset := (params.Page - 1) * params.PageSize

	// Select with user join
	selectSQL := fmt.Sprintf(`SELECT t.id, t.user_id, u.username, t.amount, t.money, COALESCE(t.trade_no,'') as trade_no, COALESCE(t.payment_method,'') as payment_method, COALESCE(t.create_time,0) as create_time, COALESCE(t.complete_time,0) as complete_time, COALESCE(t.status,'') as status FROM top_ups t LEFT JOIN users u ON t.user_id = u.id WHERE %s ORDER BY t.create_time DESC LIMIT %s OFFSET %s`,
		whereSQL, db.Placeholder(argIdx), db.Placeholder(argIdx+1))
	args = append(args, params.PageSize, offset)

	rows, err := db.DB.Queryx(selectSQL, args...)
	if err != nil {
		return nil, fmt.Errorf("select query failed: %w", err)
	}
	defer rows.Close()

	var items []TopUpRecord
	for rows.Next() {
		var rec TopUpRecord
		if err := rows.StructScan(&rec); err != nil {
			continue
		}
		items = append(items, rec)
	}

	if items == nil {
		items = []TopUpRecord{}
	}

	return &PaginatedTopUps{
		Items:      items,
		Total:      total,
		Page:       params.Page,
		PageSize:   params.PageSize,
		TotalPages: totalPages,
	}, nil
}

// CountTopUps returns the total number of top-ups matching the filter.
// Used by ExportTopUpsToCSV to enforce the export size cap before streaming.
func CountTopUps(params ListTopUpParams) (int64, error) {
	db := database.Get()
	whereSQL, args, _ := buildTopUpWhere(params)
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM top_ups t WHERE %s", whereSQL)
	var total int64
	if err := db.DB.Get(&total, countSQL, args...); err != nil {
		return 0, fmt.Errorf("count query failed: %w", err)
	}
	return total, nil
}

// ErrExportTooLarge is returned when an export request exceeds the row cap.
var ErrExportTooLarge = errors.New("export exceeds row limit")

// TopUpExportLimit caps how many rows a single CSV export may contain.
// Streaming the table is fine, but the user-side cost (download size, Excel
// load time) makes a hard ceiling kinder than letting them request millions.
// Declared as var (not const) so tests can shrink it temporarily and verify
// the streaming break — production code should treat it as immutable.
var TopUpExportLimit int64 = 100000

// ExportTopUpsToCSV streams top-up records as CSV to the writer. The caller is
// responsible for setting response headers and (recommended) running CountTopUps
// first to short-circuit oversized exports — this function only flips on the
// limit if the count exceeds it mid-stream.
func ExportTopUpsToCSV(ctx context.Context, w io.Writer, params ListTopUpParams) error {
	db := database.Get()
	whereSQL, args, _ := buildTopUpWhere(params)

	// UTF-8 BOM so Excel (especially zh-CN locale) auto-detects encoding.
	if _, err := w.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		return err
	}

	csvW := csv.NewWriter(w)
	defer csvW.Flush()

	header := []string{
		"ID", "用户ID", "用户名", "额度(USD)", "金额(CNY)",
		"交易号", "支付方式", "状态", "创建时间", "完成时间",
	}
	if err := csvW.Write(header); err != nil {
		return err
	}

	selectSQL := fmt.Sprintf(`SELECT t.id, t.user_id, u.username, t.amount, t.money, COALESCE(t.trade_no,'') as trade_no, COALESCE(t.payment_method,'') as payment_method, COALESCE(t.create_time,0) as create_time, COALESCE(t.complete_time,0) as complete_time, COALESCE(t.status,'') as status FROM top_ups t LEFT JOIN users u ON t.user_id = u.id WHERE %s ORDER BY t.create_time DESC`, whereSQL)

	rows, err := db.DB.QueryxContext(ctx, selectSQL, args...)
	if err != nil {
		return fmt.Errorf("export query failed: %w", err)
	}
	defer rows.Close()

	var written int64
	for rows.Next() {
		// Surface ctx cancellation (timeout / client disconnect) without finishing the loop.
		if err := ctx.Err(); err != nil {
			return err
		}

		var rec TopUpRecord
		if err := rows.StructScan(&rec); err != nil {
			continue
		}

		username := ""
		if rec.Username != nil {
			username = *rec.Username
		}
		createTimeStr := ""
		if rec.CreateTime > 0 {
			createTimeStr = time.Unix(rec.CreateTime, 0).Format(time.RFC3339)
		}
		completeTimeStr := ""
		if rec.CompleteTime > 0 {
			completeTimeStr = time.Unix(rec.CompleteTime, 0).Format(time.RFC3339)
		}

		if err := csvW.Write([]string{
			strconv.FormatInt(rec.ID, 10),
			strconv.FormatInt(rec.UserID, 10),
			username,
			strconv.FormatInt(rec.Amount, 10),
			strconv.FormatFloat(rec.Money, 'f', 2, 64),
			rec.TradeNo,
			rec.PaymentMethod,
			rec.Status,
			createTimeStr,
			completeTimeStr,
		}); err != nil {
			return err
		}

		written++
		if written >= TopUpExportLimit {
			// 写满上限就停手，不再吐第 100001 行 —— handler 的 CountTopUps 预检通常已经
			// 把超限请求挡在 400 上，这里只是兜底 race（count 之后又有新插入）。
			break
		}
		// Periodic flush so the browser begins receiving bytes promptly.
		if written%500 == 0 {
			csvW.Flush()
			if err := csvW.Error(); err != nil {
				return err
			}
		}
	}

	return rows.Err()
}

// GetTopUpStatistics returns aggregate top-up statistics
func GetTopUpStatistics(startDate, endDate string) (*TopUpStatistics, error) {
	db := database.Get()

	where := []string{}
	args := []interface{}{}
	argIdx := 1

	if startDate != "" {
		ts, err := util.ParseDateToTimestampPublic(startDate, false)
		if err == nil {
			where = append(where, fmt.Sprintf("create_time >= %s", db.Placeholder(argIdx)))
			args = append(args, ts)
			argIdx++
		}
	}
	if endDate != "" {
		ts, err := util.ParseDateToTimestampPublic(endDate, true)
		if err == nil {
			where = append(where, fmt.Sprintf("create_time <= %s", db.Placeholder(argIdx)))
			args = append(args, ts)
			argIdx++
		}
	}

	whereSQL := "1=1"
	if len(where) > 0 {
		whereSQL = strings.Join(where, " AND ")
	}

	sql := fmt.Sprintf(`SELECT
		COUNT(*) as total_count,
		COALESCE(SUM(amount), 0) as total_amount,
		COALESCE(SUM(money), 0) as total_money,
		COALESCE(SUM(CASE WHEN LOWER(status) IN ('success', 'completed') OR status = '1' THEN 1 ELSE 0 END), 0) as success_count,
		COALESCE(SUM(CASE WHEN LOWER(status) IN ('success', 'completed') OR status = '1' THEN amount ELSE 0 END), 0) as success_amount,
		COALESCE(SUM(CASE WHEN LOWER(status) IN ('success', 'completed') OR status = '1' THEN money ELSE 0 END), 0) as success_money,
		COALESCE(SUM(CASE WHEN LOWER(status) IN ('failed', 'error') OR status = '-1' THEN 1 ELSE 0 END), 0) as failed_count,
		COALESCE(SUM(CASE WHEN LOWER(status) IN ('failed', 'error') OR status = '-1' THEN amount ELSE 0 END), 0) as failed_amount,
		COALESCE(SUM(CASE WHEN LOWER(status) IN ('failed', 'error') OR status = '-1' THEN money ELSE 0 END), 0) as failed_money
		FROM top_ups WHERE %s`, whereSQL)

	type rawStats struct {
		TotalCount    int64   `db:"total_count"`
		TotalAmount   int64   `db:"total_amount"`
		TotalMoney    float64 `db:"total_money"`
		SuccessCount  int64   `db:"success_count"`
		SuccessAmount int64   `db:"success_amount"`
		SuccessMoney  float64 `db:"success_money"`
		FailedCount   int64   `db:"failed_count"`
		FailedAmount  int64   `db:"failed_amount"`
		FailedMoney   float64 `db:"failed_money"`
	}

	var raw rawStats
	if err := db.DB.Get(&raw, sql, args...); err != nil {
		return nil, fmt.Errorf("statistics query failed: %w", err)
	}

	return &TopUpStatistics{
		TotalCount:    raw.TotalCount,
		TotalAmount:   raw.TotalAmount,
		TotalMoney:    raw.TotalMoney,
		SuccessCount:  raw.SuccessCount,
		SuccessAmount: raw.SuccessAmount,
		SuccessMoney:  raw.SuccessMoney,
		PendingCount:  raw.TotalCount - raw.SuccessCount - raw.FailedCount,
		PendingAmount: raw.TotalAmount - raw.SuccessAmount - raw.FailedAmount,
		PendingMoney:  raw.TotalMoney - raw.SuccessMoney - raw.FailedMoney,
		FailedCount:   raw.FailedCount,
		FailedAmount:  raw.FailedAmount,
		FailedMoney:   raw.FailedMoney,
	}, nil
}

// GetPaymentMethods returns distinct payment methods
func GetPaymentMethods() ([]string, error) {
	db := database.Get()
	var methods []string
	err := db.DB.Select(&methods, "SELECT DISTINCT payment_method FROM top_ups WHERE payment_method IS NOT NULL AND payment_method != '' ORDER BY payment_method")
	if err != nil {
		return nil, err
	}
	if methods == nil {
		methods = []string{}
	}
	return methods, nil
}

// GetTopUpByID returns a single top-up record
func GetTopUpByID(id int64) (*TopUpRecord, error) {
	db := database.Get()
	sql := fmt.Sprintf(`SELECT t.id, t.user_id, u.username, t.amount, t.money, COALESCE(t.trade_no,'') as trade_no, COALESCE(t.payment_method,'') as payment_method, COALESCE(t.create_time,0) as create_time, COALESCE(t.complete_time,0) as complete_time, COALESCE(t.status,'') as status FROM top_ups t LEFT JOIN users u ON t.user_id = u.id WHERE t.id = %s`, db.Placeholder(1))

	var rec TopUpRecord
	if err := db.DB.Get(&rec, sql, id); err != nil {
		return nil, err
	}
	return &rec, nil
}

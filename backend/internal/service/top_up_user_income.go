package service

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/new-api-tools/backend/internal/database"
	"github.com/new-api-tools/backend/internal/util"
)

// UserQuotaIncomeSummary 单用户额度入账汇总：在线充值 vs 兑换码（可剔除）。
type UserQuotaIncomeSummary struct {
	UserID   int64  `json:"user_id"`
	Username string `json:"username"`

	// 在线充值（成功）
	PaidCount  int64   `json:"paid_count"`
	PaidMoney  float64 `json:"paid_money"`  // 实付金额 CNY（top_ups.money）
	PaidAmount float64 `json:"paid_amount"` // 获得额度 USD（top_ups.amount）

	// 未成功（待处理 + 已过期）
	UnsuccessCount int64   `json:"unsuccess_count"`
	UnsuccessMoney float64 `json:"unsuccess_money"` // 金额 CNY（top_ups.money）

	// 兑换码使用
	RedemptionCount    int64   `json:"redemption_count"`
	RedemptionQuotaRaw int64   `json:"redemption_quota_raw"`
	RedemptionQuotaUSD float64 `json:"redemption_quota_usd"` // 兑换获得额度 USD

	// 在线充值获得额度（= PaidAmount，不含兑换码）
	NetPaidAmountUSD float64 `json:"net_paid_amount_usd"`
	// 总入账额度（在线充值获得 + 兑换码获得）
	TotalIncomeUSD float64 `json:"total_income_usd"`
}

// GetUserQuotaIncomeSummary 汇总指定用户的在线充值与兑换码入账。
// startDate/endDate 可选；充值按 create_time，兑换按 redeemed_time。
func GetUserQuotaIncomeSummary(userID int64, startDate, endDate string) (*UserQuotaIncomeSummary, error) {
	if userID <= 0 {
		return nil, fmt.Errorf("user_id is required")
	}

	db := database.Get()
	out := &UserQuotaIncomeSummary{UserID: userID}

	// username
	var uname string
	if err := db.DB.Get(&uname, fmt.Sprintf("SELECT username FROM users WHERE id = %s", db.Placeholder(1)), userID); err == nil {
		out.Username = uname
	}

	// ---- 在线充值（成功）----
	paidWhere := []string{
		fmt.Sprintf("user_id = %s", db.Placeholder(1)),
		fmt.Sprintf("(%s) = 'success'", topUpStatusBucketSQL("status")),
	}
	paidArgs := []interface{}{userID}
	argIdx := 2

	if startDate != "" {
		if ts, err := util.ParseDateToTimestampPublic(startDate, false); err == nil {
			paidWhere = append(paidWhere, fmt.Sprintf("create_time >= %s", db.Placeholder(argIdx)))
			paidArgs = append(paidArgs, ts)
			argIdx++
		}
	}
	if endDate != "" {
		if ts, err := util.ParseDateToTimestampPublic(endDate, true); err == nil {
			paidWhere = append(paidWhere, fmt.Sprintf("create_time <= %s", db.Placeholder(argIdx)))
			paidArgs = append(paidArgs, ts)
			argIdx++
		}
	}

	type paidAgg struct {
		Cnt    int64   `db:"cnt"`
		Money  float64 `db:"money"`
		Amount float64 `db:"amount"`
	}
	var paid paidAgg
	paidSQL := fmt.Sprintf(`SELECT COUNT(*) as cnt,
		COALESCE(SUM(money), 0) as money,
		COALESCE(SUM(amount), 0) as amount
		FROM top_ups WHERE %s`, strings.Join(paidWhere, " AND "))
	if err := db.DB.Get(&paid, paidSQL, paidArgs...); err != nil {
		return nil, fmt.Errorf("paid top-up aggregate failed: %w", err)
	}
	out.PaidCount = paid.Cnt
	out.PaidMoney = paid.Money
	out.PaidAmount = paid.Amount

	// ---- 未成功（待处理 + 已过期）----
	unsuccessWhere := []string{
		fmt.Sprintf("user_id = %s", db.Placeholder(1)),
		fmt.Sprintf("(%s) IN ('pending', 'expired')", topUpStatusBucketSQL("status")),
	}
	unsuccessArgs := []interface{}{userID}
	argIdx = 2

	if startDate != "" {
		if ts, err := util.ParseDateToTimestampPublic(startDate, false); err == nil {
			unsuccessWhere = append(unsuccessWhere, fmt.Sprintf("create_time >= %s", db.Placeholder(argIdx)))
			unsuccessArgs = append(unsuccessArgs, ts)
			argIdx++
		}
	}
	if endDate != "" {
		if ts, err := util.ParseDateToTimestampPublic(endDate, true); err == nil {
			unsuccessWhere = append(unsuccessWhere, fmt.Sprintf("create_time <= %s", db.Placeholder(argIdx)))
			unsuccessArgs = append(unsuccessArgs, ts)
			argIdx++
		}
	}

	type unsuccessAgg struct {
		Cnt   int64   `db:"cnt"`
		Money float64 `db:"money"`
	}
	var unsuccess unsuccessAgg
	unsuccessSQL := fmt.Sprintf(`SELECT COUNT(*) as cnt,
		COALESCE(SUM(money), 0) as money
		FROM top_ups WHERE %s`, strings.Join(unsuccessWhere, " AND "))
	if err := db.DB.Get(&unsuccess, unsuccessSQL, unsuccessArgs...); err != nil {
		return nil, fmt.Errorf("unsuccess top-up aggregate failed: %w", err)
	}
	out.UnsuccessCount = unsuccess.Cnt
	out.UnsuccessMoney = unsuccess.Money

	// ---- 兑换码 ----
	redWhere := []string{
		fmt.Sprintf("used_user_id = %s", db.Placeholder(1)),
		"redeemed_time IS NOT NULL",
		"redeemed_time > 0",
		"deleted_at IS NULL",
	}
	redArgs := []interface{}{userID}
	argIdx = 2

	if startDate != "" {
		if ts, err := util.ParseDateToTimestampPublic(startDate, false); err == nil {
			redWhere = append(redWhere, fmt.Sprintf("redeemed_time >= %s", db.Placeholder(argIdx)))
			redArgs = append(redArgs, ts)
			argIdx++
		}
	}
	if endDate != "" {
		if ts, err := util.ParseDateToTimestampPublic(endDate, true); err == nil {
			redWhere = append(redWhere, fmt.Sprintf("redeemed_time <= %s", db.Placeholder(argIdx)))
			redArgs = append(redArgs, ts)
			argIdx++
		}
	}

	type redAgg struct {
		Cnt   int64 `db:"cnt"`
		Quota int64 `db:"quota"`
	}
	var red redAgg
	redSQL := fmt.Sprintf(`SELECT COUNT(*) as cnt, COALESCE(SUM(quota), 0) as quota
		FROM redemptions WHERE %s`, strings.Join(redWhere, " AND "))
	if err := db.DB.Get(&red, redSQL, redArgs...); err != nil {
		return nil, fmt.Errorf("redemption aggregate failed: %w", err)
	}
	out.RedemptionCount = red.Cnt
	out.RedemptionQuotaRaw = red.Quota
	out.RedemptionQuotaUSD = float64(red.Quota) / float64(util.TokensPerUSD)

	out.NetPaidAmountUSD = out.PaidAmount
	out.TotalIncomeUSD = out.PaidAmount + out.RedemptionQuotaUSD
	return out, nil
}

// exportUserIncomeCSV 导出单用户「充值 + 兑换码」明细，并在 CSV 中标注类型与是否计入实付。
// 底部附统计摘要：实付 / 兑换 / 剔除兑换后净入账。
func exportUserIncomeCSV(ctx context.Context, w io.Writer, params ListTopUpParams) error {
	if params.UserID == nil || *params.UserID <= 0 {
		return fmt.Errorf("user_id is required for user income export")
	}
	userID := *params.UserID
	db := database.Get()
	whereSQL, args, _ := buildTopUpWhere(params)

	if _, err := w.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		return err
	}
	csvW := csv.NewWriter(w)
	defer csvW.Flush()

	// 统一表头：在线充值与兑换码共用，便于 Excel 筛选
	// 获得额度 = top_ups.amount / redemptions 换算后的 USD；实付金额 = top_ups.money（兑换码为空）
	header := []string{
		"类型", "计入实付统计", "ID", "用户ID", "用户名", "获得额度(USD)", "实付金额(CNY)",
		"交易号/兑换码", "名称/支付方式", "支付渠道", "状态", "归一状态",
		"完成耗时(秒)", "异常标记", "创建/兑换时间", "完成时间", "备注",
	}
	if err := csvW.Write(header); err != nil {
		return err
	}

	var (
		written      int64
		paidCount    int64
		paidMoney    float64
		paidAmount   float64
		redCount     int64
		redQuotaUSD  float64
		usernameHint string
	)
	now := time.Now().Unix()

	// ---- 在线充值行 ----
	selectSQL := fmt.Sprintf(
		`SELECT %s FROM top_ups t LEFT JOIN users u ON t.user_id = u.id WHERE %s ORDER BY t.create_time DESC`,
		topUpSelectColumns(), whereSQL)
	rows, err := db.DB.QueryxContext(ctx, selectSQL, args...)
	if err != nil {
		return fmt.Errorf("export top-ups query failed: %w", err)
	}

	for rows.Next() {
		if err := ctx.Err(); err != nil {
			rows.Close()
			return err
		}
		var rec TopUpRecord
		if err := rows.StructScan(&rec); err != nil {
			continue
		}
		enrichTopUpRecord(&rec, now, defaultPendingAnomalyHours)

		username := ""
		if rec.Username != nil {
			username = *rec.Username
		}
		if usernameHint == "" && username != "" {
			usernameHint = username
		}

		createTimeStr := formatUnixRFC3339(rec.CreateTime)
		completeTimeStr := formatUnixRFC3339(rec.CompleteTime)

		countInPaid := "否"
		note := ""
		if rec.StatusBucket == "success" {
			countInPaid = "是"
			paidCount++
			paidMoney += rec.Money
			paidAmount += float64(rec.Amount)
			note = "在线充值成功，计入实付"
		} else {
			note = "非成功充值，不计入实付统计"
		}

		if err := csvW.Write([]string{
			"在线充值",
			countInPaid,
			strconv.FormatInt(rec.ID, 10),
			strconv.FormatInt(rec.UserID, 10),
			username,
			strconv.FormatInt(rec.Amount, 10),
			strconv.FormatFloat(rec.Money, 'f', 2, 64),
			rec.TradeNo,
			rec.PaymentMethod,
			rec.PaymentProvider,
			rec.Status,
			rec.StatusBucket,
			strconv.FormatInt(rec.CompletionSeconds, 10),
			strings.Join(rec.AnomalyReasons, "; "),
			createTimeStr,
			completeTimeStr,
			note,
		}); err != nil {
			rows.Close()
			return err
		}

		written++
		if written >= TopUpExportLimit {
			break
		}
		if written%500 == 0 {
			csvW.Flush()
			if err := csvW.Error(); err != nil {
				rows.Close()
				return err
			}
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	// ---- 兑换码行（不计入实付）----
	if written < TopUpExportLimit {
		kc := keyCol(db.IsPG)
		redWhere := []string{
			fmt.Sprintf("r.used_user_id = %s", db.Placeholder(1)),
			"r.redeemed_time IS NOT NULL",
			"r.redeemed_time > 0",
			"r.deleted_at IS NULL",
		}
		redArgs := []interface{}{userID}
		argIdx := 2
		if params.StartDate != "" {
			if ts, err := util.ParseDateToTimestampPublic(params.StartDate, false); err == nil {
				redWhere = append(redWhere, fmt.Sprintf("r.redeemed_time >= %s", db.Placeholder(argIdx)))
				redArgs = append(redArgs, ts)
				argIdx++
			}
		}
		if params.EndDate != "" {
			if ts, err := util.ParseDateToTimestampPublic(params.EndDate, true); err == nil {
				redWhere = append(redWhere, fmt.Sprintf("r.redeemed_time <= %s", db.Placeholder(argIdx)))
				redArgs = append(redArgs, ts)
				argIdx++
			}
		}
		// 剩余额度上限
		limitPh := db.Placeholder(argIdx)
		redArgs = append(redArgs, TopUpExportLimit-written)

		redSQL := fmt.Sprintf(`SELECT r.id, COALESCE(r.%s,'') as "key", COALESCE(r.name,'') as name,
			COALESCE(r.quota,0) as quota, COALESCE(r.redeemed_time,0) as redeemed_time,
			COALESCE(u.username,'') as username
			FROM redemptions r
			LEFT JOIN users u ON r.used_user_id = u.id
			WHERE %s
			ORDER BY r.redeemed_time DESC
			LIMIT %s`,
			kc, strings.Join(redWhere, " AND "), limitPh)

		redRows, err := db.DB.QueryxContext(ctx, redSQL, redArgs...)
		if err != nil {
			return fmt.Errorf("export redemptions query failed: %w", err)
		}
		defer redRows.Close()

		type redRow struct {
			ID           int64  `db:"id"`
			Key          string `db:"key"`
			Name         string `db:"name"`
			Quota        int64  `db:"quota"`
			RedeemedTime int64  `db:"redeemed_time"`
			Username     string `db:"username"`
		}

		for redRows.Next() {
			if err := ctx.Err(); err != nil {
				return err
			}
			var rr redRow
			if err := redRows.StructScan(&rr); err != nil {
				continue
			}
			if usernameHint == "" && rr.Username != "" {
				usernameHint = rr.Username
			}
			quotaUSD := float64(rr.Quota) / float64(util.TokensPerUSD)
			redCount++
			redQuotaUSD += quotaUSD

			if err := csvW.Write([]string{
				"兑换码",
				"否", // 明确不计入实付
				strconv.FormatInt(rr.ID, 10),
				strconv.FormatInt(userID, 10),
				rr.Username,
				strconv.FormatFloat(quotaUSD, 'f', 4, 64),
				"0.00",
				rr.Key,
				rr.Name,
				"",
				"used",
				"success",
				"",
				"",
				formatUnixRFC3339(rr.RedeemedTime),
				formatUnixRFC3339(rr.RedeemedTime),
				"兑换码兑换额度，已从实付统计中剔除",
			}); err != nil {
				return err
			}
			written++
			if written >= TopUpExportLimit {
				break
			}
		}
		if err := redRows.Err(); err != nil {
			return err
		}
	}

	// ---- 统计摘要（空行分隔，Excel 可一眼看到）----
	_ = csvW.Write([]string{})
	_ = csvW.Write([]string{"===== 统计摘要 ====="})
	_ = csvW.Write([]string{"用户ID", strconv.FormatInt(userID, 10)})
	_ = csvW.Write([]string{"用户名", usernameHint})
	_ = csvW.Write([]string{"成功充值笔数", strconv.FormatInt(paidCount, 10)})
	_ = csvW.Write([]string{"实付金额(CNY)", strconv.FormatFloat(paidMoney, 'f', 2, 64)})
	_ = csvW.Write([]string{"在线充值获得额度(USD)", strconv.FormatFloat(paidAmount, 'f', 2, 64)})
	// 未成功：从本导出明细中按归一状态汇总（与 API 统计口径一致：pending + expired）
	var unsuccessCount int64
	var unsuccessMoney float64
	// 摘要行只依赖上方循环累计；此处再扫一遍代价高，改为在在线充值循环中累计更合适。
	// 为保持改动局部，导出摘要的未成功数通过二次查询补齐（同一 user_id）。
	if summary, err := GetUserQuotaIncomeSummary(userID, params.StartDate, params.EndDate); err == nil {
		unsuccessCount = summary.UnsuccessCount
		unsuccessMoney = summary.UnsuccessMoney
	}
	_ = csvW.Write([]string{"未成功充值笔数", strconv.FormatInt(unsuccessCount, 10)})
	_ = csvW.Write([]string{"未成功金额(CNY)", strconv.FormatFloat(unsuccessMoney, 'f', 2, 64)})
	_ = csvW.Write([]string{"兑换码使用笔数", strconv.FormatInt(redCount, 10)})
	_ = csvW.Write([]string{"兑换码获得额度(USD)", strconv.FormatFloat(redQuotaUSD, 'f', 4, 64)})
	// 兼容旧字段名：剔除兑换后仅含在线充值成功单的获得额度
	_ = csvW.Write([]string{"剔除兑换码后实付额度(USD)", strconv.FormatFloat(paidAmount, 'f', 2, 64)})
	_ = csvW.Write([]string{"含兑换总入账额度(USD)", strconv.FormatFloat(paidAmount+redQuotaUSD, 'f', 4, 64)})
	_ = csvW.Write([]string{"说明", "实付金额=用户实际支付；获得额度=入账额度；未成功=待处理+已过期。「计入实付统计=否」的兑换码行不计入实付；净入账仅统计在线充值成功单"})

	csvW.Flush()
	return csvW.Error()
}

func formatUnixRFC3339(ts int64) string {
	if ts <= 0 {
		return ""
	}
	return time.Unix(ts, 0).Format(time.RFC3339)
}

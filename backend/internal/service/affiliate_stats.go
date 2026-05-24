package service

import (
	"fmt"
	"strings"

	"github.com/new-api-tools/backend/internal/database"
	"github.com/new-api-tools/backend/internal/util"
)

// AffiliateStatsRow 表示按 inviter_id 聚合后的一行返利统计
type AffiliateStatsRow struct {
	InviterID          int64   `db:"inviter_id" json:"inviter_id"`
	InviterUsername    *string `db:"inviter_username" json:"inviter_username"`
	InviterDisplayName *string `db:"inviter_display_name" json:"inviter_display_name"`
	AffCount           int64   `db:"aff_count" json:"aff_count"`
	InviteeCount       int64   `db:"invitee_count" json:"invitee_count"`
	SuccessTopUpCount  int64   `db:"success_topup_count" json:"success_topup_count"`
	SuccessAmount      int64   `db:"success_amount" json:"success_amount"`
	SuccessMoney       float64 `db:"success_money" json:"success_money"`
	LastTopUpAt        *int64  `db:"last_topup_at" json:"last_topup_at"`
}

// AffiliateStatsParams 列表查询参数
type AffiliateStatsParams struct {
	Page      int    `json:"page"`
	PageSize  int    `json:"page_size"`
	Search    string `json:"search"`
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
	SortBy    string `json:"sort_by"`
	SortDir   string `json:"sort_dir"`
}

// AffiliateStatsSummary 汇总卡片数据
type AffiliateStatsSummary struct {
	TotalInviters   int64   `db:"total_inviters" json:"total_inviters"`
	TotalInvitees   int64   `db:"total_invitees" json:"total_invitees"`
	TotalTopUpCount int64   `db:"total_topup_count" json:"total_topup_count"`
	TotalAmount     int64   `db:"total_amount" json:"total_amount"`
	TotalMoney      float64 `db:"total_money" json:"total_money"`
}

// PaginatedAffiliateStats 列表分页响应
type PaginatedAffiliateStats struct {
	Items      []AffiliateStatsRow `json:"items"`
	Total      int64               `json:"total"`
	Page       int                 `json:"page"`
	PageSize   int                 `json:"page_size"`
	TotalPages int                 `json:"total_pages"`
}

// 聚合阶段 WHERE：作用于 top_ups t JOIN users u 上。
// 此处 search 不在聚合阶段过滤（邀请人字段在外层 JOIN 后才可用），
// 仅过滤 status / 日期 / inviter_id 非空。
func buildAffiliateAggWhere(params AffiliateStatsParams) (string, []interface{}, int) {
	db := database.Get()
	where := []string{
		"t.status = " + db.Placeholder(1),
		"u.inviter_id IS NOT NULL",
		"u.inviter_id > 0",
	}
	args := []interface{}{"success"}
	argIdx := 2

	if params.StartDate != "" {
		if ts, err := util.ParseDateToTimestampPublic(params.StartDate, false); err == nil {
			where = append(where, fmt.Sprintf("t.complete_time >= %s", db.Placeholder(argIdx)))
			args = append(args, ts)
			argIdx++
		}
	}
	if params.EndDate != "" {
		if ts, err := util.ParseDateToTimestampPublic(params.EndDate, true); err == nil {
			where = append(where, fmt.Sprintf("t.complete_time <= %s", db.Placeholder(argIdx)))
			args = append(args, ts)
			argIdx++
		}
	}

	return strings.Join(where, " AND "), args, argIdx
}

// affiliateSortColumn 把前端 sort_by 映射成安全的列引用。
// 任何不在白名单内的输入都回退到默认排序。
func affiliateSortColumn(sortBy string) string {
	switch sortBy {
	case "success_money":
		return "a.success_money"
	case "success_amount":
		return "a.success_amount"
	case "success_topup_count":
		return "a.success_topup_count"
	case "invitee_count":
		return "a.invitee_count"
	case "last_topup_at":
		return "a.last_topup_at"
	case "aff_count":
		return "COALESCE(iu.aff_count, 0)"
	default:
		return "a.success_money"
	}
}

func affiliateSortDir(dir string) string {
	if strings.EqualFold(dir, "asc") {
		return "ASC"
	}
	return "DESC"
}

// ListAffiliateStats 按 inviter_id 聚合 top_ups（只算 success），返回分页列表。
func ListAffiliateStats(params AffiliateStatsParams) (*PaginatedAffiliateStats, error) {
	if params.Page < 1 {
		params.Page = 1
	}
	if params.PageSize < 1 || params.PageSize > 100 {
		params.PageSize = 20
	}

	db := database.Get()
	aggWhere, aggArgs, aggNextIdx := buildAffiliateAggWhere(params)

	// 外层 search 过滤：作用于邀请人 iu.username / iu.display_name
	outerWhere := []string{}
	outerArgs := []interface{}{}
	argIdx := aggNextIdx
	if params.Search != "" {
		like := "%" + params.Search + "%"
		outerWhere = append(outerWhere,
			fmt.Sprintf("(iu.username LIKE %s OR iu.display_name LIKE %s)",
				db.Placeholder(argIdx), db.Placeholder(argIdx+1)))
		outerArgs = append(outerArgs, like, like)
		argIdx += 2
	}
	outerWhereSQL := "1=1"
	if len(outerWhere) > 0 {
		outerWhereSQL = strings.Join(outerWhere, " AND ")
	}

	aggSQL := fmt.Sprintf(`
		SELECT u.inviter_id AS inviter_id,
		       COUNT(DISTINCT t.user_id) AS invitee_count,
		       COUNT(t.id)               AS success_topup_count,
		       COALESCE(SUM(t.amount), 0) AS success_amount,
		       COALESCE(SUM(t.money), 0)  AS success_money,
		       MAX(t.complete_time)       AS last_topup_at
		FROM top_ups t
		JOIN users u ON u.id = t.user_id
		WHERE %s
		GROUP BY u.inviter_id
	`, aggWhere)

	// COUNT(*) over the aggregated set (with outer search applied)
	countSQL := fmt.Sprintf(`
		SELECT COUNT(*) FROM (%s) a
		LEFT JOIN users iu ON iu.id = a.inviter_id
		WHERE %s
	`, aggSQL, outerWhereSQL)

	countArgs := append([]interface{}{}, aggArgs...)
	countArgs = append(countArgs, outerArgs...)

	var total int64
	if err := db.DB.Get(&total, countSQL, countArgs...); err != nil {
		return nil, fmt.Errorf("count affiliate stats failed: %w", err)
	}

	totalPages := int((total + int64(params.PageSize) - 1) / int64(params.PageSize))
	if totalPages < 1 {
		totalPages = 1
	}
	offset := (params.Page - 1) * params.PageSize

	listSQL := fmt.Sprintf(`
		SELECT a.inviter_id,
		       iu.username      AS inviter_username,
		       iu.display_name  AS inviter_display_name,
		       COALESCE(iu.aff_count, 0) AS aff_count,
		       a.invitee_count,
		       a.success_topup_count,
		       a.success_amount,
		       a.success_money,
		       a.last_topup_at
		FROM (%s) a
		LEFT JOIN users iu ON iu.id = a.inviter_id
		WHERE %s
		ORDER BY %s %s, a.inviter_id ASC
		LIMIT %s OFFSET %s
	`, aggSQL, outerWhereSQL,
		affiliateSortColumn(params.SortBy), affiliateSortDir(params.SortDir),
		db.Placeholder(argIdx), db.Placeholder(argIdx+1))

	listArgs := append([]interface{}{}, aggArgs...)
	listArgs = append(listArgs, outerArgs...)
	listArgs = append(listArgs, params.PageSize, offset)

	rows, err := db.DB.Queryx(listSQL, listArgs...)
	if err != nil {
		return nil, fmt.Errorf("query affiliate stats failed: %w", err)
	}
	defer rows.Close()

	items := []AffiliateStatsRow{}
	for rows.Next() {
		var r AffiliateStatsRow
		if err := rows.StructScan(&r); err != nil {
			continue
		}
		items = append(items, r)
	}

	return &PaginatedAffiliateStats{
		Items:      items,
		Total:      total,
		Page:       params.Page,
		PageSize:   params.PageSize,
		TotalPages: totalPages,
	}, nil
}

// GetAffiliateStatsSummary 计算顶部统计卡片所需的整体汇总。
// 与列表用同一组过滤（status / 日期 / 邀请人关键字），保证卡片与表格口径一致。
func GetAffiliateStatsSummary(params AffiliateStatsParams) (*AffiliateStatsSummary, error) {
	db := database.Get()
	aggWhere, aggArgs, aggNextIdx := buildAffiliateAggWhere(params)

	outerWhere := []string{}
	outerArgs := []interface{}{}
	argIdx := aggNextIdx
	if params.Search != "" {
		like := "%" + params.Search + "%"
		outerWhere = append(outerWhere,
			fmt.Sprintf("(iu.username LIKE %s OR iu.display_name LIKE %s)",
				db.Placeholder(argIdx), db.Placeholder(argIdx+1)))
		outerArgs = append(outerArgs, like, like)
		argIdx += 2
	}
	outerWhereSQL := "1=1"
	if len(outerWhere) > 0 {
		outerWhereSQL = strings.Join(outerWhere, " AND ")
	}

	aggSQL := fmt.Sprintf(`
		SELECT u.inviter_id AS inviter_id,
		       COUNT(DISTINCT t.user_id) AS invitee_count,
		       COUNT(t.id)               AS success_topup_count,
		       COALESCE(SUM(t.amount), 0) AS success_amount,
		       COALESCE(SUM(t.money), 0)  AS success_money,
		       MAX(t.complete_time)       AS last_topup_at
		FROM top_ups t
		JOIN users u ON u.id = t.user_id
		WHERE %s
		GROUP BY u.inviter_id
	`, aggWhere)

	summarySQL := fmt.Sprintf(`
		SELECT COUNT(*)                          AS total_inviters,
		       COALESCE(SUM(a.invitee_count),0)  AS total_invitees,
		       COALESCE(SUM(a.success_topup_count),0) AS total_topup_count,
		       COALESCE(SUM(a.success_amount),0) AS total_amount,
		       COALESCE(SUM(a.success_money),0)  AS total_money
		FROM (%s) a
		LEFT JOIN users iu ON iu.id = a.inviter_id
		WHERE %s
	`, aggSQL, outerWhereSQL)

	args := append([]interface{}{}, aggArgs...)
	args = append(args, outerArgs...)

	var s AffiliateStatsSummary
	if err := db.DB.Get(&s, summarySQL, args...); err != nil {
		return nil, fmt.Errorf("query affiliate summary failed: %w", err)
	}
	return &s, nil
}

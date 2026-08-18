package service

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/new-api-tools/backend/internal/database"
	"github.com/new-api-tools/backend/internal/logger"
)

// TokenInfo represents a token record with joined user info
type TokenInfo struct {
	ID             int64  `json:"id"`
	Key            string `json:"key"`
	Name           string `json:"name"`
	UserID         int64  `json:"user_id"`
	Username       string `json:"username"`
	Status         int    `json:"status"`
	Quota          int64  `json:"quota"`
	UsedQuota      int64  `json:"used_quota"`
	RemainQuota    int64  `json:"remain_quota"`
	UnlimitedQuota bool   `json:"unlimited_quota"`
	Models         string `json:"models"`
	Subnet         string `json:"subnet"`
	CreatedTime    int64  `json:"created_time"`
	AccessedTime   int64  `json:"accessed_time"`
	ExpiredTime    int64  `json:"expired_time"`
	Group          string `json:"group"`
}

// TokenStatistics holds aggregate token counts
type TokenStatistics struct {
	Total    int64 `json:"total"`
	Active   int64 `json:"active"`
	Disabled int64 `json:"disabled"`
	Expired  int64 `json:"expired"`
}

// TokenListParams holds query parameters for listing tokens
type TokenListParams struct {
	Page     int
	PageSize int
	Status   string // "active", "disabled", "expired", ""
	Name     string
	Key      string // exact token key match (sk- prefix is stripped)
	UserID   int64
	Group    string
	Expired  string // "yes", "no", ""
	Risk     string // "no_ip_limit", "never_expire", "unlimited", ""
}

// TokenService handles token-related queries
type TokenService struct {
	db    *database.Manager
	logDB *database.Manager
}

// NewTokenService creates a new TokenService
func NewTokenService() *TokenService {
	return &TokenService{db: database.Get(), logDB: database.GetLog()}
}

// keyCol returns the properly quoted column name for 'key' (reserved word)
func (s *TokenService) keyCol() string {
	return s.db.QuoteIdentifier("key")
}

// groupCol returns the properly quoted column name for 'group' (reserved word)
func (s *TokenService) groupCol() string {
	return s.db.QuoteIdentifier("group")
}

// MaskTokenKey masks a token key, showing only the first 8 chars
func MaskTokenKey(key string) string {
	if len(key) <= 8 {
		return key + "****"
	}
	return key[:8] + "****"
}

// ListTokens returns paginated, filtered token list
func (s *TokenService) ListTokens(params TokenListParams) (map[string]interface{}, error) {
	if params.Page < 1 {
		params.Page = 1
	}
	if params.PageSize < 1 || params.PageSize > 100 {
		params.PageSize = 20
	}

	now := time.Now().Unix()
	keyCol := s.keyCol()
	groupCol := s.groupCol()

	// Build WHERE clause
	var conditions []string
	var args []interface{}

	conditions = append(conditions, "t.deleted_at IS NULL")

	if params.Name != "" {
		conditions = append(conditions, "t.name LIKE ?")
		args = append(args, "%"+params.Name+"%")
	}
	// Exact token-key lookup. NewAPI stores the key without the "sk-" prefix,
	// so strip it (and any surrounding whitespace) before matching the unique
	// idx_tokens_key index.
	exactKey := strings.TrimPrefix(strings.TrimSpace(params.Key), "sk-")
	if exactKey != "" {
		conditions = append(conditions, fmt.Sprintf("t.%s = ?", keyCol))
		args = append(args, exactKey)
	}
	if params.UserID > 0 {
		conditions = append(conditions, "t.user_id = ?")
		args = append(args, params.UserID)
	} else if exactKey == "" {
		// 面板白名单只作用于常规运营列表；粘贴完整 key 的精确查找是显式定位行为，
		// 不受白名单过滤（与批量禁用弹窗的 LookupTokensByKeys 行为保持一致）。
		if cond, wlArgs := PanelWhitelistNotInClause("t.user_id"); cond != "" {
			conditions = append(conditions, cond)
			args = append(args, wlArgs...)
		}
	}
	if params.Group != "" {
		conditions = append(conditions, fmt.Sprintf("t.%s = ?", groupCol))
		args = append(args, params.Group)
	}

	switch params.Status {
	case "active":
		conditions = append(conditions, "t.status = 1")
	case "disabled":
		conditions = append(conditions, "t.status != 1")
	case "expired":
		conditions = append(conditions, fmt.Sprintf("t.expired_time > 0 AND t.expired_time <= %d", now))
	}

	// 安全审计筛选
	switch params.Risk {
	case "no_ip_limit":
		conditions = append(conditions, "(t.allow_ips IS NULL OR t.allow_ips = '')")
	case "never_expire":
		conditions = append(conditions, "(t.expired_time = 0 OR t.expired_time = -1)")
	case "unlimited":
		conditions = append(conditions, "t.unlimited_quota = ?")
		args = append(args, true)
	}

	if params.Expired == "yes" {
		conditions = append(conditions, fmt.Sprintf("t.expired_time > 0 AND t.expired_time <= %d", now))
	} else if params.Expired == "no" {
		conditions = append(conditions, fmt.Sprintf("(t.expired_time = 0 OR t.expired_time = -1 OR t.expired_time > %d)", now))
	}

	whereClause := strings.Join(conditions, " AND ")

	// Count total
	countQuery := s.db.RebindQuery(fmt.Sprintf("SELECT COUNT(*) as total FROM tokens t WHERE %s", whereClause))
	countRow, err := s.db.QueryOne(countQuery, args...)
	if err != nil {
		return nil, err
	}
	total := int64(0)
	if countRow != nil {
		total = toInt64(countRow["total"])
	}

	totalPages := (total + int64(params.PageSize) - 1) / int64(params.PageSize)
	if totalPages < 1 {
		totalPages = 1
	}

	// Fetch page
	offset := (params.Page - 1) * params.PageSize
	selectQuery := s.db.RebindQuery(fmt.Sprintf(`
		SELECT t.id, t.%s as token_key, t.name, t.user_id,
			COALESCE(u.username, '') as username,
			t.status, COALESCE(u.quota, 0) as quota, COALESCE(u.used_quota, 0) as used_quota, t.remain_quota, t.unlimited_quota,
			COALESCE(t.model_limits, '') as models,
			COALESCE(t.allow_ips, '') as subnet,
			t.%s as token_group,
			COALESCE(t.created_time, 0) as created_time,
			COALESCE(t.expired_time, 0) as expired_time
		FROM tokens t
		LEFT JOIN users u ON t.user_id = u.id
		WHERE %s
		ORDER BY t.id DESC
		LIMIT ? OFFSET ?`,
		keyCol, groupCol, whereClause))

	queryArgs := append(args, params.PageSize, offset)
	rows, err := s.db.Query(selectQuery, queryArgs...)
	if err != nil {
		return nil, err
	}

	// 仅将 logs(type IN 2/5) 视为“最后使用时间”
	lastUsedByToken := make(map[int64]int64)
	tokenIDs := make([]int64, 0, len(rows))
	for _, row := range rows {
		tokenIDs = append(tokenIDs, toInt64(row["id"]))
	}
	if len(tokenIDs) > 0 {
		// 90-day window so the query can hit idx_logs_created_token_ip instead of
		// scanning each token's full history via idx_logs_token_id.
		windowStart := time.Now().Unix() - 90*86400
		placeholders := make([]string, 0, len(tokenIDs))
		aggArgs := make([]interface{}, 0, len(tokenIDs)+1)
		aggArgs = append(aggArgs, windowStart)
		for i, tokenID := range tokenIDs {
			placeholders = append(placeholders, s.logDB.Placeholder(i+2))
			aggArgs = append(aggArgs, tokenID)
		}

		lastUsedQuery := fmt.Sprintf(`
			SELECT token_id, MAX(created_at) as accessed_time
			FROM logs
			WHERE created_at >= %s AND type IN (2, 5) AND token_id IN (%s)
			GROUP BY token_id`, s.logDB.Placeholder(1), strings.Join(placeholders, ","))

		lastUsedRows, err := s.logDB.Query(lastUsedQuery, aggArgs...)
		if err != nil {
			return nil, err
		}
		for _, row := range lastUsedRows {
			lastUsedByToken[toInt64(row["token_id"])] = toInt64(row["accessed_time"])
		}
	}

	// Convert to TokenInfo-like maps
	items := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		tokenID := toInt64(row["id"])
		items = append(items, map[string]interface{}{
			"id":              row["id"],
			"key":             MaskTokenKey(fmt.Sprintf("%v", row["token_key"])),
			"name":            row["name"],
			"user_id":         row["user_id"],
			"username":        row["username"],
			"status":          row["status"],
			"quota":           row["quota"],
			"used_quota":      row["used_quota"],
			"remain_quota":    row["remain_quota"],
			"unlimited_quota": row["unlimited_quota"],
			"models":          row["models"],
			"subnet":          row["subnet"],
			"group":           row["token_group"],
			"created_time":    row["created_time"],
			"accessed_time":   lastUsedByToken[tokenID],
			"expired_time":    row["expired_time"],
		})
	}

	return map[string]interface{}{
		"items":       items,
		"total":       total,
		"page":        params.Page,
		"page_size":   params.PageSize,
		"total_pages": totalPages,
	}, nil
}

// TokenLookupItem 批量 key 查询的单条结果（按输入顺序返回）
type TokenLookupItem struct {
	InputKey    string `json:"input_key"`  // 归一化后的完整 key（含 sk- 前缀），供前端对照
	KeyMasked   string `json:"key_masked"` // 脱敏展示
	Found       bool   `json:"found"`
	ID          int64  `json:"id,omitempty"`
	Name        string `json:"name,omitempty"`
	UserID      int64  `json:"user_id,omitempty"`
	Username    string `json:"username,omitempty"`
	Status      int64  `json:"status,omitempty"`
	ExpiredTime int64  `json:"expired_time,omitempty"`
	Group       string `json:"group,omitempty"`
	UsedQuota   int64  `json:"used_quota,omitempty"`
}

// maxBatchKeys 限制单次批量查询/禁用的规模，避免超长 IN 列表
const maxBatchKeys = 1000

// LookupTokensByKeys 按粘贴的 key 列表批量查库（精确匹配 idx_tokens_key），
// 返回与归一化去重后输入同序的结果，未匹配的 key 以 found=false 占位。
func (s *TokenService) LookupTokensByKeys(inputKeys []string) ([]TokenLookupItem, error) {
	seen := make(map[string]bool)
	normalized := make([]string, 0, len(inputKeys))
	for _, raw := range inputKeys {
		// NewAPI 存储的 key 不含 "sk-" 前缀
		k := strings.TrimPrefix(strings.TrimSpace(raw), "sk-")
		if k == "" || seen[k] {
			continue
		}
		seen[k] = true
		normalized = append(normalized, k)
	}
	if len(normalized) == 0 {
		return []TokenLookupItem{}, nil
	}
	if len(normalized) > maxBatchKeys {
		return nil, fmt.Errorf("单次最多查询 %d 个 key", maxBatchKeys)
	}

	keyCol := s.keyCol()
	groupCol := s.groupCol()
	placeholders := make([]string, len(normalized))
	args := make([]interface{}, len(normalized))
	for i, k := range normalized {
		placeholders[i] = s.db.Placeholder(i + 1)
		args[i] = k
	}

	query := fmt.Sprintf(`
		SELECT t.id, t.%s as token_key, t.name, t.user_id,
			COALESCE(u.username, '') as username,
			t.status, COALESCE(t.expired_time, 0) as expired_time,
			t.%s as token_group,
			COALESCE(t.used_quota, 0) as used_quota
		FROM tokens t
		LEFT JOIN users u ON t.user_id = u.id
		WHERE t.deleted_at IS NULL AND t.%s IN (%s)`,
		keyCol, groupCol, keyCol, strings.Join(placeholders, ", "))

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}

	byKey := make(map[string]map[string]interface{}, len(rows))
	for _, row := range rows {
		byKey[fmt.Sprintf("%v", row["token_key"])] = row
	}

	items := make([]TokenLookupItem, 0, len(normalized))
	for _, k := range normalized {
		item := TokenLookupItem{InputKey: "sk-" + k, KeyMasked: "sk-" + MaskTokenKey(k)}
		if row, ok := byKey[k]; ok {
			item.Found = true
			item.ID = toInt64(row["id"])
			item.Name = fmt.Sprintf("%v", row["name"])
			item.UserID = toInt64(row["user_id"])
			item.Username = fmt.Sprintf("%v", row["username"])
			item.Status = toInt64(row["status"])
			item.ExpiredTime = toInt64(row["expired_time"])
			item.Group = fmt.Sprintf("%v", row["token_group"])
			item.UsedQuota = toInt64(row["used_quota"])
		}
		items = append(items, item)
	}
	return items, nil
}

// BatchDisableTokens 将指定 ID 的令牌置为禁用（NewAPI TokenStatusDisabled = 2）。
// 不限定当前状态：已过期/已耗尽的令牌一并置 2，防止上游充值后自动恢复可用。
func (s *TokenService) BatchDisableTokens(ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, fmt.Errorf("at least one token id is required")
	}
	if len(ids) > maxBatchKeys {
		return 0, fmt.Errorf("单次最多禁用 %d 个令牌", maxBatchKeys)
	}

	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = s.db.Placeholder(i + 1)
		args[i] = id
	}

	query := fmt.Sprintf(
		"UPDATE tokens SET status = 2 WHERE id IN (%s) AND deleted_at IS NULL AND status != 2",
		strings.Join(placeholders, ", "))

	affected, err := s.db.Execute(query, args...)
	if err != nil {
		return 0, fmt.Errorf("disable failed: %w", err)
	}
	logger.L.Business(fmt.Sprintf("令牌批量禁用 | requested=%d affected=%d", len(ids), affected))
	return affected, nil
}

// BatchEnableTokens 将手动禁用（status=2）的令牌恢复启用。
// 不碰过期(3)/耗尽(4)状态——那是 NewAPI 自动管理的。
func (s *TokenService) BatchEnableTokens(ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, fmt.Errorf("at least one token id is required")
	}
	if len(ids) > maxBatchKeys {
		return 0, fmt.Errorf("单次最多启用 %d 个令牌", maxBatchKeys)
	}

	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = s.db.Placeholder(i + 1)
		args[i] = id
	}

	query := fmt.Sprintf(
		"UPDATE tokens SET status = 1 WHERE id IN (%s) AND deleted_at IS NULL AND status = 2",
		strings.Join(placeholders, ", "))

	affected, err := s.db.Execute(query, args...)
	if err != nil {
		return 0, fmt.Errorf("enable failed: %w", err)
	}
	logger.L.Business(fmt.Sprintf("令牌批量启用 | requested=%d affected=%d", len(ids), affected))
	return affected, nil
}

// GetTokenIPStats 统计指定令牌在窗口期内的去重来源 IP 数（泄漏信号）。
// 只查当前页的令牌 id，配合 idx_logs_created_token_ip 索引，代价可控。
func (s *TokenService) GetTokenIPStats(hours int, ids []int64) ([]map[string]interface{}, error) {
	if hours <= 0 || hours > 24*30 {
		hours = 24
	}
	if len(ids) == 0 {
		return []map[string]interface{}{}, nil
	}
	if len(ids) > 200 {
		ids = ids[:200]
	}
	windowStart := time.Now().Unix() - int64(hours)*3600

	placeholders := make([]string, len(ids))
	args := make([]interface{}, 0, len(ids)+1)
	args = append(args, windowStart)
	for i, id := range ids {
		placeholders[i] = s.logDB.Placeholder(i + 2)
		args = append(args, id)
	}

	query := fmt.Sprintf(`
		SELECT token_id, COUNT(DISTINCT ip) as ip_count
		FROM logs
		WHERE created_at >= %s AND type IN (2, 5)
			AND ip IS NOT NULL AND ip != ''
			AND token_id IN (%s)
		GROUP BY token_id`, s.logDB.Placeholder(1), strings.Join(placeholders, ", "))

	rows, err := s.logDB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	return rows, nil
}

// GetSuspectedLeaks 找出窗口期内来源 IP 数 >= 阈值的令牌（疑似泄漏/共享），
// 并从主库补齐令牌与所属用户信息。
func (s *TokenService) GetSuspectedLeaks(hours, minIPs, limit int) ([]map[string]interface{}, error) {
	if hours <= 0 || hours > 24*30 {
		hours = 24
	}
	if minIPs < 2 {
		minIPs = 5
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	windowStart := time.Now().Unix() - int64(hours)*3600

	// 第一步：logs 库聚合（logs 可能是独立日志库，不能跨库 JOIN tokens）
	aggQuery := s.logDB.RebindQuery(fmt.Sprintf(`
		SELECT token_id, COUNT(DISTINCT ip) as ip_count, COUNT(*) as request_count,
			%s as ips
		FROM logs
		WHERE created_at >= ? AND type IN (2, 5)
			AND ip IS NOT NULL AND ip != ''
			AND token_id > 0
		GROUP BY token_id
		HAVING COUNT(DISTINCT ip) >= ?
		ORDER BY COUNT(DISTINCT ip) DESC
		LIMIT ?`, s.logDB.StringAggDistinct("ip")))

	aggRows, err := s.logDB.Query(aggQuery, windowStart, minIPs, limit)
	if err != nil {
		return nil, err
	}
	if len(aggRows) == 0 {
		return []map[string]interface{}{}, nil
	}

	statByToken := make(map[int64]map[string]interface{}, len(aggRows))
	tokenIDs := make([]int64, 0, len(aggRows))
	for _, row := range aggRows {
		id := toInt64(row["token_id"])
		statByToken[id] = row
		tokenIDs = append(tokenIDs, id)
	}

	// 第二步：主库补齐令牌与用户信息
	keyCol := s.keyCol()
	groupCol := s.groupCol()
	placeholders := make([]string, len(tokenIDs))
	args := make([]interface{}, 0, len(tokenIDs))
	for i, id := range tokenIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	conditions := []string{
		"t.deleted_at IS NULL",
		fmt.Sprintf("t.id IN (%s)", strings.Join(placeholders, ", ")),
	}
	if cond, wlArgs := PanelWhitelistNotInClause("t.user_id"); cond != "" {
		conditions = append(conditions, cond)
		args = append(args, wlArgs...)
	}

	tokenQuery := s.db.RebindQuery(fmt.Sprintf(`
		SELECT t.id, t.%s as token_key, t.name, t.user_id,
			COALESCE(u.username, '') as username,
			t.status, t.remain_quota, t.unlimited_quota, t.used_quota,
			COALESCE(t.allow_ips, '') as subnet,
			t.%s as token_group,
			COALESCE(t.expired_time, 0) as expired_time
		FROM tokens t
		LEFT JOIN users u ON t.user_id = u.id
		WHERE %s`, keyCol, groupCol, strings.Join(conditions, " AND ")))

	tokenRows, err := s.db.Query(tokenQuery, args...)
	if err != nil {
		return nil, err
	}

	items := make([]map[string]interface{}, 0, len(tokenRows))
	for _, row := range tokenRows {
		id := toInt64(row["id"])
		stat := statByToken[id]
		if stat == nil {
			continue
		}
		items = append(items, map[string]interface{}{
			"id":              id,
			"key":             MaskTokenKey(fmt.Sprintf("%v", row["token_key"])),
			"name":            row["name"],
			"user_id":         row["user_id"],
			"username":        row["username"],
			"status":          row["status"],
			"remain_quota":    row["remain_quota"],
			"unlimited_quota": row["unlimited_quota"],
			"used_quota":      row["used_quota"],
			"subnet":          row["subnet"],
			"group":           row["token_group"],
			"expired_time":    row["expired_time"],
			"ip_count":        stat["ip_count"],
			"request_count":   stat["request_count"],
			"ips":             stat["ips"],
		})
	}

	// 按 IP 数降序（主库查询不保证顺序）
	sort.Slice(items, func(i, j int) bool {
		return toInt64(items[i]["ip_count"]) > toInt64(items[j]["ip_count"])
	})
	return items, nil
}

// GetTokenGroups 返回所有不同的令牌分组及其令牌数量
func (s *TokenService) GetTokenGroups() ([]map[string]interface{}, error) {
	groupCol := s.groupCol()
	query := s.db.RebindQuery(fmt.Sprintf(`
		SELECT COALESCE(NULLIF(%s, ''), 'default') as group_name,
			COUNT(*) as token_count,
			SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active_count
		FROM tokens
		WHERE deleted_at IS NULL
		GROUP BY COALESCE(NULLIF(%s, ''), 'default')
		ORDER BY token_count DESC`, groupCol, groupCol))

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		return []map[string]interface{}{}, nil
	}
	return rows, nil
}

// GetTokenStatistics returns aggregate token counts
func (s *TokenService) GetTokenStatistics() (*TokenStatistics, error) {
	now := time.Now().Unix()

	query := s.db.RebindQuery(fmt.Sprintf(`
		SELECT
			COUNT(*) as total,
			SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active,
			SUM(CASE WHEN status != 1 THEN 1 ELSE 0 END) as disabled,
			SUM(CASE WHEN expired_time > 0 AND expired_time <= %d THEN 1 ELSE 0 END) as expired
		FROM tokens
		WHERE deleted_at IS NULL`, now))

	row, err := s.db.QueryOne(query)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return &TokenStatistics{}, nil
	}

	return &TokenStatistics{
		Total:    toInt64(row["total"]),
		Active:   toInt64(row["active"]),
		Disabled: toInt64(row["disabled"]),
		Expired:  toInt64(row["expired"]),
	}, nil
}

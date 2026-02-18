package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/new-api-tools/backend/internal/database"
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
	UserID   int64
	Group    string
	Expired  string // "yes", "no", ""
}

// TokenService handles token-related queries
type TokenService struct {
	db *database.Manager
}

// NewTokenService creates a new TokenService
func NewTokenService() *TokenService {
	return &TokenService{db: database.Get()}
}

// keyCol returns the properly quoted column name for 'key' (reserved word)
func (s *TokenService) keyCol() string {
	if s.db.IsPG {
		return `"key"`
	}
	return "`key`"
}

// groupCol returns the properly quoted column name for 'group' (reserved word)
func (s *TokenService) groupCol() string {
	if s.db.IsPG {
		return `"group"`
	}
	return "`group`"
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
	if params.UserID > 0 {
		conditions = append(conditions, "t.user_id = ?")
		args = append(args, params.UserID)
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
		placeholders := make([]string, 0, len(tokenIDs))
		aggArgs := make([]interface{}, 0, len(tokenIDs))
		for i, tokenID := range tokenIDs {
			placeholders = append(placeholders, s.db.Placeholder(i+1))
			aggArgs = append(aggArgs, tokenID)
		}

		lastUsedQuery := fmt.Sprintf(`
			SELECT token_id, MAX(created_at) as accessed_time
			FROM logs
			WHERE type IN (2, 5) AND token_id IN (%s)
			GROUP BY token_id`, strings.Join(placeholders, ","))

		lastUsedRows, err := s.db.Query(lastUsedQuery, aggArgs...)
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

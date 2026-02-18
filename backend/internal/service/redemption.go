package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/new-api-tools/backend/internal/database"
	"github.com/new-api-tools/backend/internal/logger"
	"github.com/new-api-tools/backend/internal/util"
)

// RedemptionCode represents a redemption code from the database
type RedemptionCode struct {
	ID           int64  `json:"id" db:"id"`
	Key          string `json:"key" db:"key"`
	Name         string `json:"name" db:"name"`
	Quota        int64  `json:"quota" db:"quota"`
	CreatedTime  int64  `json:"created_time" db:"created_time"`
	RedeemedTime int64  `json:"redeemed_time" db:"redeemed_time"`
	UsedUserID   int64  `json:"used_user_id" db:"used_user_id"`
	UsedUsername string `json:"used_username" db:"used_username"`
	ExpiredTime  int64  `json:"expired_time" db:"expired_time"`
	Status       string `json:"status"` // "unused", "used", "expired"
}

// RedemptionStatistics holds aggregate statistics
type RedemptionStatistics struct {
	TotalCount   int64 `json:"total_count" db:"total_count"`
	UnusedCount  int64 `json:"unused_count" db:"unused_count"`
	UsedCount    int64 `json:"used_count" db:"used_count"`
	ExpiredCount int64 `json:"expired_count" db:"expired_count"`
	TotalQuota   int64 `json:"total_quota" db:"total_quota"`
	UnusedQuota  int64 `json:"unused_quota" db:"unused_quota"`
	UsedQuota    int64 `json:"used_quota" db:"used_quota"`
	ExpiredQuota int64 `json:"expired_quota" db:"expired_quota"`
}

// GenerateParams holds parameters for code generation
type GenerateParams struct {
	Name        string   `json:"name"`
	Count       int      `json:"count"`
	KeyPrefix   string   `json:"key_prefix"`
	QuotaMode   string   `json:"quota_mode"` // "fixed" or "random"
	FixedAmount *float64 `json:"fixed_amount"`
	MinAmount   *float64 `json:"min_amount"`
	MaxAmount   *float64 `json:"max_amount"`
	ExpireMode  string   `json:"expire_mode"` // "never", "days", "date"
	ExpireDays  *int     `json:"expire_days"`
	ExpireDate  *string  `json:"expire_date"`
}

// GenerateResult holds the result of code generation
type GenerateResult struct {
	Keys    []string `json:"keys"`
	Count   int      `json:"count"`
	SQL     string   `json:"sql"`
	Success bool     `json:"success"`
	Message string   `json:"message"`
}

// ListRedemptionParams holds list query parameters
type ListRedemptionParams struct {
	Page      int    `json:"page"`
	PageSize  int    `json:"page_size"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
}

// PaginatedRedemptions holds paginated redemption results
type PaginatedRedemptions struct {
	Items      []RedemptionCode `json:"items"`
	Total      int64            `json:"total"`
	Page       int              `json:"page"`
	PageSize   int              `json:"page_size"`
	TotalPages int              `json:"total_pages"`
}

// keyCol returns the properly quoted 'key' column name
func keyCol(isPG bool) string {
	if isPG {
		return `"key"`
	}
	return "`key`"
}

// GenerateCodes generates redemption codes and inserts into database
func GenerateCodes(params GenerateParams) (*GenerateResult, error) {
	// Validate
	if strings.TrimSpace(params.Name) == "" {
		return nil, fmt.Errorf("name is required")
	}
	if params.Count < 1 || params.Count > 1000 {
		return nil, fmt.Errorf("count must be between 1 and 1000")
	}

	// Generate keys
	keys, err := util.GenerateBatch(params.Count, params.KeyPrefix)
	if err != nil {
		return nil, fmt.Errorf("failed to generate keys: %w", err)
	}

	// Calculate quotas
	quotaMode := params.QuotaMode
	if quotaMode == "" {
		quotaMode = "fixed"
	}
	fixedAmt := float64(0)
	if params.FixedAmount != nil {
		fixedAmt = *params.FixedAmount
	}
	minAmt := float64(0)
	if params.MinAmount != nil {
		minAmt = *params.MinAmount
	}
	maxAmt := float64(0)
	if params.MaxAmount != nil {
		maxAmt = *params.MaxAmount
	}
	quotas, err := util.GenerateQuotas(params.Count, quotaMode, fixedAmt, minAmt, maxAmt)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate quotas: %w", err)
	}

	// Calculate expiration
	expireMode := params.ExpireMode
	if expireMode == "" {
		expireMode = "never"
	}
	expireDays := 0
	if params.ExpireDays != nil {
		expireDays = *params.ExpireDays
	}
	expireDate := ""
	if params.ExpireDate != nil {
		expireDate = *params.ExpireDate
	}
	expiredTime, err := util.CalculateExpiration(expireMode, expireDays, expireDate)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate expiration: %w", err)
	}

	createdTime := time.Now().Unix()
	db := database.Get()
	kc := keyCol(db.IsPG)

	// Build SQL for display
	sql := buildInsertSQL(keys, params.Name, quotas, createdTime, expiredTime, kc)

	// Execute batch insert
	insertSQL := fmt.Sprintf(`INSERT INTO redemptions (user_id, %s, name, quota, created_time, redeemed_time, used_user_id, expired_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, kc)
	insertSQL = db.RebindQuery(insertSQL)

	tx, err := db.DB.Beginx()
	if err != nil {
		return &GenerateResult{Keys: keys, Count: len(keys), SQL: sql, Success: false, Message: "Failed to start transaction: " + err.Error()}, nil
	}

	for i, key := range keys {
		_, err := tx.Exec(insertSQL, 1, key, params.Name, quotas[i], createdTime, 0, 0, expiredTime)
		if err != nil {
			tx.Rollback()
			return &GenerateResult{Keys: keys, Count: len(keys), SQL: sql, Success: false, Message: "Failed to insert codes: " + err.Error()}, nil
		}
	}

	if err := tx.Commit(); err != nil {
		return &GenerateResult{Keys: keys, Count: len(keys), SQL: sql, Success: false, Message: "Failed to commit: " + err.Error()}, nil
	}

	logger.L.Business(fmt.Sprintf("兑换码生成 | count=%d | name=%s", len(keys), params.Name))

	return &GenerateResult{
		Keys:    keys,
		Count:   len(keys),
		SQL:     sql,
		Success: true,
		Message: fmt.Sprintf("Successfully generated %d redemption codes", len(keys)),
	}, nil
}

func buildInsertSQL(keys []string, name string, quotas []int64, createdTime, expiredTime int64, kc string) string {
	var values []string
	for i, key := range keys {
		values = append(values, fmt.Sprintf("(1, '%s', '%s', %d, %d, 0, 0, %d)", key, name, quotas[i], createdTime, expiredTime))
	}
	return fmt.Sprintf("INSERT INTO redemptions (user_id, %s, name, quota, created_time, redeemed_time, used_user_id, expired_time) VALUES\n%s;", kc, strings.Join(values, ",\n"))
}

// ListCodes lists redemption codes with pagination and filtering
func ListCodes(params ListRedemptionParams) (*PaginatedRedemptions, error) {
	if params.Page < 1 {
		params.Page = 1
	}
	if params.PageSize < 1 || params.PageSize > 100 {
		params.PageSize = 20
	}

	db := database.Get()
	kc := keyCol(db.IsPG)
	currentTime := time.Now().Unix()

	// Build WHERE clause (use r. prefix for JOIN query)
	where := []string{"r.deleted_at IS NULL"}
	args := []interface{}{}
	argIdx := 1

	if params.Name != "" {
		where = append(where, fmt.Sprintf("r.name LIKE %s", db.Placeholder(argIdx)))
		args = append(args, "%"+params.Name+"%")
		argIdx++
	}

	if params.Status != "" {
		switch params.Status {
		case "used":
			where = append(where, "(r.redeemed_time IS NOT NULL AND r.redeemed_time > 0)")
		case "expired":
			where = append(where, "(r.redeemed_time IS NULL OR r.redeemed_time = 0)")
			where = append(where, "r.expired_time IS NOT NULL")
			where = append(where, "r.expired_time > 0")
			where = append(where, fmt.Sprintf("r.expired_time < %s", db.Placeholder(argIdx)))
			args = append(args, currentTime)
			argIdx++
		case "unused":
			where = append(where, "(r.redeemed_time IS NULL OR r.redeemed_time = 0)")
			where = append(where, fmt.Sprintf("(r.expired_time IS NULL OR r.expired_time = 0 OR r.expired_time >= %s)", db.Placeholder(argIdx)))
			args = append(args, currentTime)
			argIdx++
		}
	}

	if params.StartDate != "" {
		ts, err := util.ParseDateToTimestampPublic(params.StartDate, false)
		if err == nil {
			where = append(where, fmt.Sprintf("r.created_time >= %s", db.Placeholder(argIdx)))
			args = append(args, ts)
			argIdx++
		}
	}

	if params.EndDate != "" {
		ts, err := util.ParseDateToTimestampPublic(params.EndDate, true)
		if err == nil {
			where = append(where, fmt.Sprintf("r.created_time <= %s", db.Placeholder(argIdx)))
			args = append(args, ts)
			argIdx++
		}
	}

	whereSQL := strings.Join(where, " AND ")

	// Count total
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM redemptions r WHERE %s", whereSQL)
	var total int64
	if err := db.DB.Get(&total, countSQL, args...); err != nil {
		return nil, fmt.Errorf("count query failed: %w", err)
	}

	totalPages := int((total + int64(params.PageSize) - 1) / int64(params.PageSize))
	if totalPages < 1 {
		totalPages = 1
	}
	offset := (params.Page - 1) * params.PageSize

	// Query items with LEFT JOIN to get used username
	selectSQL := fmt.Sprintf(`SELECT r.id, r.%s as "key", COALESCE(r.name,'') as name, COALESCE(r.quota,0) as quota, COALESCE(r.created_time,0) as created_time, COALESCE(r.redeemed_time,0) as redeemed_time, COALESCE(r.used_user_id,0) as used_user_id, COALESCE(u.username,'') as used_username, COALESCE(r.expired_time,0) as expired_time FROM redemptions r LEFT JOIN users u ON r.used_user_id = u.id AND r.used_user_id > 0 WHERE %s ORDER BY r.created_time DESC LIMIT %s OFFSET %s`,
		kc, whereSQL, db.Placeholder(argIdx), db.Placeholder(argIdx+1))
	args = append(args, params.PageSize, offset)

	rows, err := db.DB.Queryx(selectSQL, args...)
	if err != nil {
		return nil, fmt.Errorf("select query failed: %w", err)
	}
	defer rows.Close()

	var items []RedemptionCode
	for rows.Next() {
		var code RedemptionCode
		if err := rows.StructScan(&code); err != nil {
			continue
		}
		// Determine status
		if code.RedeemedTime > 0 {
			code.Status = "used"
		} else if code.ExpiredTime > 0 && code.ExpiredTime < currentTime {
			code.Status = "expired"
		} else {
			code.Status = "unused"
		}
		items = append(items, code)
	}

	if items == nil {
		items = []RedemptionCode{}
	}

	return &PaginatedRedemptions{
		Items:      items,
		Total:      total,
		Page:       params.Page,
		PageSize:   params.PageSize,
		TotalPages: totalPages,
	}, nil
}

// DeleteCodes soft-deletes redemption codes by IDs
func DeleteCodes(ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, fmt.Errorf("at least one ID is required")
	}

	db := database.Get()

	// Build placeholders
	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids)+1)
	args[0] = time.Now().Format(time.RFC3339)
	for i, id := range ids {
		placeholders[i] = db.Placeholder(i + 2)
		args[i+1] = id
	}

	sql := fmt.Sprintf("UPDATE redemptions SET deleted_at = %s WHERE id IN (%s) AND deleted_at IS NULL",
		db.Placeholder(1), strings.Join(placeholders, ", "))

	result, err := db.DB.Exec(sql, args...)
	if err != nil {
		return 0, fmt.Errorf("delete failed: %w", err)
	}

	affected, _ := result.RowsAffected()
	logger.L.Business(fmt.Sprintf("兑换码删除 | count=%d", affected))
	return affected, nil
}

// GetRedemptionStatistics returns aggregate stats for redemption codes
func GetRedemptionStatistics(startDate, endDate string) (*RedemptionStatistics, error) {
	db := database.Get()
	currentTime := time.Now().Unix()

	where := []string{"deleted_at IS NULL"}
	args := []interface{}{currentTime, currentTime, currentTime, currentTime}
	argIdx := 5

	if startDate != "" {
		ts, err := util.ParseDateToTimestampPublic(startDate, false)
		if err == nil {
			where = append(where, fmt.Sprintf("created_time >= %s", db.Placeholder(argIdx)))
			args = append(args, ts)
			argIdx++
		}
	}
	if endDate != "" {
		ts, err := util.ParseDateToTimestampPublic(endDate, true)
		if err == nil {
			where = append(where, fmt.Sprintf("created_time <= %s", db.Placeholder(argIdx)))
			args = append(args, ts)
			argIdx++
		}
	}

	whereSQL := strings.Join(where, " AND ")
	p := db.Placeholder

	sql := fmt.Sprintf(`SELECT 
		COUNT(*) as total_count,
		SUM(CASE WHEN (redeemed_time IS NULL OR redeemed_time = 0) AND (expired_time IS NULL OR expired_time = 0 OR expired_time >= %s) THEN 1 ELSE 0 END) as unused_count,
		SUM(CASE WHEN redeemed_time IS NOT NULL AND redeemed_time > 0 THEN 1 ELSE 0 END) as used_count,
		SUM(CASE WHEN (redeemed_time IS NULL OR redeemed_time = 0) AND expired_time IS NOT NULL AND expired_time > 0 AND expired_time < %s THEN 1 ELSE 0 END) as expired_count,
		COALESCE(SUM(quota), 0) as total_quota,
		COALESCE(SUM(CASE WHEN (redeemed_time IS NULL OR redeemed_time = 0) AND (expired_time IS NULL OR expired_time = 0 OR expired_time >= %s) THEN quota ELSE 0 END), 0) as unused_quota,
		COALESCE(SUM(CASE WHEN redeemed_time IS NOT NULL AND redeemed_time > 0 THEN quota ELSE 0 END), 0) as used_quota,
		COALESCE(SUM(CASE WHEN (redeemed_time IS NULL OR redeemed_time = 0) AND expired_time IS NOT NULL AND expired_time > 0 AND expired_time < %s THEN quota ELSE 0 END), 0) as expired_quota
		FROM redemptions WHERE %s`,
		p(1), p(2), p(3), p(4), whereSQL)

	var stats RedemptionStatistics
	if err := db.DB.Get(&stats, sql, args...); err != nil {
		return nil, fmt.Errorf("statistics query failed: %w", err)
	}

	return &stats, nil
}

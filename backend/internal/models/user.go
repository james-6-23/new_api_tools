package models

import (
	"database/sql"
	"time"
)

// User represents the users table
type User struct {
	ID           int64          `db:"id" json:"id"`
	Username     string         `db:"username" json:"username"`
	DisplayName  sql.NullString `db:"display_name" json:"display_name"`
	Email        sql.NullString `db:"email" json:"email"`
	Role         int            `db:"role" json:"role"`
	Status       int            `db:"status" json:"status"`
	Quota        int64          `db:"quota" json:"quota"`
	UsedQuota    int64          `db:"used_quota" json:"used_quota"`
	RequestCount int64          `db:"request_count" json:"request_count"`
	Group        sql.NullString `db:"group" json:"group"`
	AffCode      sql.NullString `db:"aff_code" json:"aff_code"`
	InviterID    sql.NullInt64  `db:"inviter_id" json:"inviter_id"`
	AccessToken  sql.NullString `db:"access_token" json:"-"`
	CreatedAt    time.Time      `db:"created_at" json:"created_at"`
	DeletedAt    sql.NullTime   `db:"deleted_at" json:"deleted_at"`
}

// Token represents the tokens table
type Token struct {
	ID             int64          `db:"id" json:"id"`
	UserID         int64          `db:"user_id" json:"user_id"`
	Key            string         `db:"key" json:"key"`
	Name           sql.NullString `db:"name" json:"name"`
	Status         int            `db:"status" json:"status"`
	Subnet         sql.NullString `db:"subnet" json:"subnet"`
	Models         sql.NullString `db:"models" json:"models"`
	Quota          int64          `db:"quota" json:"quota"`
	UsedQuota      int64          `db:"used_quota" json:"used_quota"`
	RequestCount   int64          `db:"request_count" json:"request_count"`
	RemainQuota    int64          `db:"remain_quota" json:"remain_quota"`
	UnlimitedQuota int            `db:"unlimited_quota" json:"unlimited_quota"`
	ExpiredTime    sql.NullInt64  `db:"expired_time" json:"expired_time"`
	CreatedAt      time.Time      `db:"created_at" json:"created_at"`
	DeletedAt      sql.NullTime   `db:"deleted_at" json:"deleted_at"`
}

// Redemption represents the redemptions table
type Redemption struct {
	ID        int64          `db:"id" json:"id"`
	UserID    sql.NullInt64  `db:"user_id" json:"user_id"`
	Key       string         `db:"key" json:"key"`
	Name      sql.NullString `db:"name" json:"name"`
	Status    int            `db:"status" json:"status"`
	Quota     int64          `db:"quota" json:"quota"`
	Count     int            `db:"count" json:"count"`
	CreatedAt time.Time      `db:"created_at" json:"created_at"`
	UsedAt    sql.NullTime   `db:"redeemed_time" json:"redeemed_time"`
}

// TopUp represents the top_ups table
type TopUp struct {
	ID        int64     `db:"id" json:"id"`
	UserID    int64     `db:"user_id" json:"user_id"`
	Amount    int64     `db:"amount" json:"amount"`
	Money     float64   `db:"money" json:"money"`
	TradeNo   string    `db:"trade_no" json:"trade_no"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}

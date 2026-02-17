package models

import (
	"database/sql"
	"time"
)

// Log represents the logs table
type Log struct {
	ID               int64          `db:"id" json:"id"`
	UserID           int64          `db:"user_id" json:"user_id"`
	CreatedAt        time.Time      `db:"created_at" json:"created_at"`
	Type             int            `db:"type" json:"type"`
	Content          sql.NullString `db:"content" json:"content"`
	TokenName        sql.NullString `db:"token_name" json:"token_name"`
	TokenID          sql.NullInt64  `db:"token_id" json:"token_id"`
	ModelName        sql.NullString `db:"model_name" json:"model_name"`
	Quota            int64          `db:"quota" json:"quota"`
	PromptTokens     int64          `db:"prompt_tokens" json:"prompt_tokens"`
	CompletionTokens int64          `db:"completion_tokens" json:"completion_tokens"`
	ChannelID        sql.NullInt64  `db:"channel_id" json:"channel_id"`
	IP               sql.NullString `db:"ip" json:"ip"`
	Duration         sql.NullInt64  `db:"duration" json:"duration"`
}

// LogType constants matching Python's log types
const (
	LogTypeTopUp    = 1 // 充值
	LogTypeConsume  = 2 // 消费
	LogTypeManage   = 3 // 管理
	LogTypeSystem   = 4 // 系统
	LogTypeRecharge = 5 // 充值
)

package models

import (
	"time"
)

// User NewAPI 用户表
type User struct {
	ID               int        `gorm:"column:id;primaryKey" json:"id"`
	Username         string     `gorm:"column:username" json:"username"`
	Password         string     `gorm:"column:password" json:"-"`
	DisplayName      string     `gorm:"column:display_name" json:"display_name"`
	Role             int        `gorm:"column:role" json:"role"`
	Status           int        `gorm:"column:status" json:"status"`
	Email            string     `gorm:"column:email" json:"email"`
	GitHubID         string     `gorm:"column:github_id" json:"github_id"`
	WeChatID         string     `gorm:"column:wechat_id" json:"wechat_id"`
	VerificationCode string     `gorm:"column:verification_code" json:"-"`
	AccessToken      string     `gorm:"column:access_token" json:"-"`
	Quota            int64      `gorm:"column:quota" json:"quota"`
	UsedQuota        int64      `gorm:"column:used_quota" json:"used_quota"`
	RequestCount     int        `gorm:"column:request_count" json:"request_count"`
	Group            string     `gorm:"column:group" json:"group"`
	AffCode          string     `gorm:"column:aff_code" json:"aff_code"`
	InviterID        int        `gorm:"column:inviter_id" json:"inviter_id"`
	CreatedAt        time.Time  `gorm:"column:created_at" json:"created_at"`
	DeletedAt        *time.Time `gorm:"column:deleted_at" json:"deleted_at,omitempty"`
}

func (User) TableName() string {
	return "users"
}

// Token NewAPI 令牌表
type Token struct {
	ID             int        `gorm:"column:id;primaryKey" json:"id"`
	UserID         int        `gorm:"column:user_id" json:"user_id"`
	Key            string     `gorm:"column:key" json:"key"`
	Status         int        `gorm:"column:status" json:"status"`
	Name           string     `gorm:"column:name" json:"name"`
	CreatedAt      time.Time  `gorm:"column:created_at" json:"created_at"`
	AccessedAt     *time.Time `gorm:"column:accessed_at" json:"accessed_at,omitempty"`
	ExpiredAt      *time.Time `gorm:"column:expired_at" json:"expired_at,omitempty"`
	RemainQuota    int64      `gorm:"column:remain_quota" json:"remain_quota"`
	UnlimitedQuota bool       `gorm:"column:unlimited_quota" json:"unlimited_quota"`
	UsedQuota      int64      `gorm:"column:used_quota" json:"used_quota"`
	DeletedAt      *time.Time `gorm:"column:deleted_at" json:"deleted_at,omitempty"`
}

func (Token) TableName() string {
	return "tokens"
}

// Log NewAPI 日志表
type Log struct {
	ID               int       `gorm:"column:id;primaryKey" json:"id"`
	UserID           int       `gorm:"column:user_id" json:"user_id"`
	CreatedAt        time.Time `gorm:"column:created_at" json:"created_at"`
	Type             int       `gorm:"column:type" json:"type"`
	Content          string    `gorm:"column:content" json:"content"`
	Username         string    `gorm:"column:username" json:"username"`
	TokenID          int       `gorm:"column:token_id" json:"token_id"`
	TokenName        string    `gorm:"column:token_name" json:"token_name"`
	ModelName        string    `gorm:"column:model_name" json:"model_name"`
	Quota            int       `gorm:"column:quota" json:"quota"`
	PromptTokens     int       `gorm:"column:prompt_tokens" json:"prompt_tokens"`
	CompletionTokens int       `gorm:"column:completion_tokens" json:"completion_tokens"`
	IP               string    `gorm:"column:ip" json:"ip"`
	ChannelID        int       `gorm:"column:channel_id" json:"channel_id"`
}

func (Log) TableName() string {
	return "logs"
}

// Channel NewAPI 渠道表
type Channel struct {
	ID               int        `gorm:"column:id;primaryKey" json:"id"`
	Type             int        `gorm:"column:type" json:"type"`
	Key              string     `gorm:"column:key" json:"key"`
	Status           int        `gorm:"column:status" json:"status"`
	Name             string     `gorm:"column:name" json:"name"`
	Weight           int        `gorm:"column:weight" json:"weight"`
	CreatedAt        time.Time  `gorm:"column:created_at" json:"created_at"`
	TestAt           *time.Time `gorm:"column:test_at" json:"test_at,omitempty"`
	ResponseTime     int        `gorm:"column:response_time" json:"response_time"`
	BaseURL          string     `gorm:"column:base_url" json:"base_url"`
	Other            string     `gorm:"column:other" json:"other"`
	Balance          float64    `gorm:"column:balance" json:"balance"`
	BalanceUpdatedAt *time.Time `gorm:"column:balance_updated_at" json:"balance_updated_at,omitempty"`
	Models           string     `gorm:"column:models" json:"models"`
	Group            string     `gorm:"column:group" json:"group"`
	UsedQuota        int64      `gorm:"column:used_quota" json:"used_quota"`
	ModelMapping     string     `gorm:"column:model_mapping" json:"model_mapping"`
	Priority         int        `gorm:"column:priority" json:"priority"`
	DeletedAt        *time.Time `gorm:"column:deleted_at" json:"deleted_at,omitempty"`
}

func (Channel) TableName() string {
	return "channels"
}

// Redemption NewAPI 兑换码表
type Redemption struct {
	ID         int        `gorm:"column:id;primaryKey" json:"id"`
	UserID     int        `gorm:"column:user_id" json:"user_id"`
	Key        string     `gorm:"column:key" json:"key"`
	Status     int        `gorm:"column:status" json:"status"`
	Name       string     `gorm:"column:name" json:"name"`
	Quota      int64      `gorm:"column:quota" json:"quota"`
	CreatedAt  time.Time  `gorm:"column:created_at" json:"created_at"`
	RedeemedAt *time.Time `gorm:"column:redeemed_at" json:"redeemed_at,omitempty"`
	RedeemedBy int        `gorm:"column:redeemed_by" json:"redeemed_by"`
	DeletedAt  *time.Time `gorm:"column:deleted_at" json:"deleted_at,omitempty"`
}

func (Redemption) TableName() string {
	return "redemptions"
}

// TopUp NewAPI 充值记录表
type TopUp struct {
	ID        int       `gorm:"column:id;primaryKey" json:"id"`
	UserID    int       `gorm:"column:user_id" json:"user_id"`
	Amount    int64     `gorm:"column:amount" json:"amount"`
	Quota     int64     `gorm:"column:quota" json:"quota"`
	Method    string    `gorm:"column:method" json:"method"`
	TradeNo   string    `gorm:"column:trade_no" json:"trade_no"`
	Status    int       `gorm:"column:status" json:"status"`
	CreatedAt time.Time `gorm:"column:created_at" json:"created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at" json:"updated_at"`
}

func (TopUp) TableName() string {
	return "top_ups"
}

// Ability NewAPI 能力表（用于模型配置）
type Ability struct {
	ID        int       `gorm:"column:id;primaryKey" json:"id"`
	Group     string    `gorm:"column:group" json:"group"`
	Model     string    `gorm:"column:model" json:"model"`
	ChannelID int       `gorm:"column:channel_id" json:"channel_id"`
	Enabled   bool      `gorm:"column:enabled" json:"enabled"`
	Priority  int       `gorm:"column:priority" json:"priority"`
	Weight    int       `gorm:"column:weight" json:"weight"`
	CreatedAt time.Time `gorm:"column:created_at" json:"created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at" json:"updated_at"`
}

func (Ability) TableName() string {
	return "abilities"
}

// Option NewAPI 配置表
type Option struct {
	Key   string `gorm:"column:key;primaryKey" json:"key"`
	Value string `gorm:"column:value" json:"value"`
}

func (Option) TableName() string {
	return "options"
}

// 常量定义

// 用户状态
const (
	UserStatusEnabled  = 1
	UserStatusDisabled = 2
	UserStatusBanned   = 3
)

// 用户角色
const (
	RoleCommonUser = 1
	RoleAdmin      = 10
	RoleRootUser   = 100
)

// 令牌状态
const (
	TokenStatusEnabled   = 1
	TokenStatusDisabled  = 2
	TokenStatusExpired   = 3
	TokenStatusExhausted = 4
)

// 日志类型
const (
	LogTypeTopUp   = 1
	LogTypeConsume = 2
	LogTypeManage  = 3
	LogTypeSystem  = 4
)

// 渠道状态
const (
	ChannelStatusUnknown      = 0
	ChannelStatusEnabled      = 1
	ChannelStatusDisabled     = 2
	ChannelStatusAutoDisabled = 3
)

// 兑换码状态
const (
	RedemptionStatusEnabled  = 1
	RedemptionStatusDisabled = 2
	RedemptionStatusUsed     = 3
)

// 充值状态
const (
	TopUpStatusPending  = 1
	TopUpStatusSuccess  = 2
	TopUpStatusFailed   = 3
	TopUpStatusRefunded = 4
)

// 辅助方法

// IsDeleted 检查用户是否已删除
func (u *User) IsDeleted() bool {
	return u.DeletedAt != nil
}

// IsBanned 检查用户是否被封禁
func (u *User) IsBanned() bool {
	return u.Status == UserStatusBanned
}

// IsActive 检查用户是否活跃
func (u *User) IsActive() bool {
	return u.Status == UserStatusEnabled && !u.IsDeleted()
}

// IsAdmin 检查是否是管理员
func (u *User) IsAdmin() bool {
	return u.Role >= RoleAdmin
}

// IsDeleted 检查令牌是否已删除
func (t *Token) IsDeleted() bool {
	return t.DeletedAt != nil
}

// IsActive 检查令牌是否可用
func (t *Token) IsActive() bool {
	if t.IsDeleted() || t.Status != TokenStatusEnabled {
		return false
	}
	if t.ExpiredAt != nil && t.ExpiredAt.Before(time.Now()) {
		return false
	}
	if !t.UnlimitedQuota && t.RemainQuota <= 0 {
		return false
	}
	return true
}

// IsDeleted 检查渠道是否已删除
func (c *Channel) IsDeleted() bool {
	return c.DeletedAt != nil
}

// IsActive 检查渠道是否可用
func (c *Channel) IsActive() bool {
	return c.Status == ChannelStatusEnabled && !c.IsDeleted()
}

// IsUsed 检查兑换码是否已使用
func (r *Redemption) IsUsed() bool {
	return r.Status == RedemptionStatusUsed
}

// IsDeleted 检查兑换码是否已删除
func (r *Redemption) IsDeleted() bool {
	return r.DeletedAt != nil
}

// IsAvailable 检查兑换码是否可用
func (r *Redemption) IsAvailable() bool {
	return r.Status == RedemptionStatusEnabled && !r.IsDeleted() && !r.IsUsed()
}

// IsSuccess 检查充值是否成功
func (t *TopUp) IsSuccess() bool {
	return t.Status == TopUpStatusSuccess
}

// IsRefunded 检查充值是否已退款
func (t *TopUp) IsRefunded() bool {
	return t.Status == TopUpStatusRefunded
}

package service

import (
	"fmt"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/models"
)

// RiskService 风控服务
type RiskService struct{}

// NewRiskService 创建风控服务
func NewRiskService() *RiskService {
	return &RiskService{}
}

// LeaderboardUser 排行榜用户
type LeaderboardUser struct {
	Rank         int     `json:"rank"`
	UserID       int     `json:"user_id"`
	Username     string  `json:"username"`
	Requests     int64   `json:"requests"`
	Quota        int64   `json:"quota"`
	AvgQuota     float64 `json:"avg_quota"`
	UniqueIPs    int     `json:"unique_ips"`
	TokenCount   int     `json:"token_count"`
	RiskScore    float64 `json:"risk_score"`
	LastActivity string  `json:"last_activity"`
}

// LeaderboardData 排行榜数据
type LeaderboardData struct {
	Period        string            `json:"period"`
	ByRequests    []LeaderboardUser `json:"by_requests"`
	ByQuota       []LeaderboardUser `json:"by_quota"`
	ByAvgQuota    []LeaderboardUser `json:"by_avg_quota"`
	HighRiskUsers []LeaderboardUser `json:"high_risk_users"`
}

// UserRiskAnalysis 用户风险分析
type UserRiskAnalysis struct {
	UserID         int                    `json:"user_id"`
	Username       string                 `json:"username"`
	RiskScore      float64                `json:"risk_score"`
	RiskLevel      string                 `json:"risk_level"`
	RiskFactors    []string               `json:"risk_factors"`
	RequestPattern map[string]interface{} `json:"request_pattern"`
	IPBehavior     map[string]interface{} `json:"ip_behavior"`
	QuotaBehavior  map[string]interface{} `json:"quota_behavior"`
	Recommendation string                 `json:"recommendation"`
}

// BanRecord 封禁记录
type BanRecord struct {
	ID         int    `json:"id"`
	UserID     int    `json:"user_id"`
	Username   string `json:"username"`
	Reason     string `json:"reason"`
	BanType    string `json:"ban_type"`
	BannedBy   string `json:"banned_by"`
	BannedAt   string `json:"banned_at"`
	UnbannedAt string `json:"unbanned_at"`
}

// TokenRotation 令牌轮换记录
type TokenRotation struct {
	UserID        int     `json:"user_id"`
	Username      string  `json:"username"`
	TokenCount    int     `json:"token_count"`
	NewTokens     int     `json:"new_tokens_24h"`
	ExpiredTokens int     `json:"expired_tokens_24h"`
	RotationRate  float64 `json:"rotation_rate"`
}

// GetLeaderboards 获取排行榜
func (s *RiskService) GetLeaderboards(period string, limit int) (*LeaderboardData, error) {
	cacheKey := cache.CacheKey("risk", "leaderboard", period)

	var data LeaderboardData
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 1 * time.Minute, // 排行榜缓存时间短
	}

	err := wrapper.GetOrSet(&data, func() (interface{}, error) {
		return s.fetchLeaderboards(period, limit)
	})

	return &data, err
}

// fetchLeaderboards 获取排行榜数据
func (s *RiskService) fetchLeaderboards(period string, limit int) (*LeaderboardData, error) {
	db := database.GetMainDB()
	data := &LeaderboardData{Period: period}

	// 计算时间范围（Unix 时间戳）
	now := time.Now()
	var startTime int64
	switch period {
	case "hour":
		startTime = now.Add(-1 * time.Hour).Unix()
	case "today":
		startTime = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	case "week":
		startTime = now.AddDate(0, 0, -7).Unix()
	case "month":
		startTime = now.AddDate(0, -1, 0).Unix()
	default:
		startTime = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	}

	// 按请求数排行
	data.ByRequests = s.getLeaderboardByMetric(db, startTime, "requests", limit)

	// 按消耗额度排行
	data.ByQuota = s.getLeaderboardByMetric(db, startTime, "quota", limit)

	// 按平均额度排行
	data.ByAvgQuota = s.getLeaderboardByMetric(db, startTime, "avg_quota", limit)

	return data, nil
}

// getLeaderboardByMetric 按指标获取排行榜
func (s *RiskService) getLeaderboardByMetric(db interface{}, startTime int64, metric string, limit int) []LeaderboardUser {
	gormDB := database.GetMainDB()

	orderClause := "requests DESC"
	switch metric {
	case "quota":
		orderClause = "quota DESC"
	case "avg_quota":
		orderClause = "avg_quota DESC"
	}

	var results []struct {
		UserID   int
		Username string
		Requests int64
		Quota    int64
		AvgQuota float64
		LastAt   int64
	}

	gormDB.Table("logs").
		Select(`
			logs.user_id,
			users.username,
			COUNT(*) as requests,
			COALESCE(SUM(logs.quota), 0) as quota,
			COALESCE(AVG(logs.quota), 0) as avg_quota,
			MAX(logs.created_at) as last_at
		`).
		Joins("LEFT JOIN users ON logs.user_id = users.id").
		Where("logs.created_at >= ? AND logs.type = ?", startTime, models.LogTypeConsume).
		Group("logs.user_id, users.username").
		Order(orderClause).
		Limit(limit).
		Scan(&results)

	leaderboard := make([]LeaderboardUser, len(results))
	for i, r := range results {
		leaderboard[i] = LeaderboardUser{
			Rank:         i + 1,
			UserID:       r.UserID,
			Username:     r.Username,
			Requests:     r.Requests,
			Quota:        r.Quota,
			AvgQuota:     r.AvgQuota,
			LastActivity: time.Unix(r.LastAt, 0).Format("2006-01-02 15:04:05"),
		}
	}

	return leaderboard
}

// GetUserRiskAnalysis 获取用户风险分析
func (s *RiskService) GetUserRiskAnalysis(userID int) (*UserRiskAnalysis, error) {
	db := database.GetMainDB()

	// 获取用户信息
	var user models.User
	if err := db.First(&user, userID).Error; err != nil {
		return nil, fmt.Errorf("用户不存在")
	}

	analysis := &UserRiskAnalysis{
		UserID:         userID,
		Username:       user.Username,
		RiskFactors:    []string{},
		RequestPattern: make(map[string]interface{}),
		IPBehavior:     make(map[string]interface{}),
		QuotaBehavior:  make(map[string]interface{}),
	}

	// 计算风险分数
	riskScore := 0.0

	// 1. 请求频率分析（Unix 时间戳）
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	var todayRequests int64
	db.Model(&models.Log{}).
		Where("user_id = ? AND created_at >= ? AND type = ?", userID, todayStart, models.LogTypeConsume).
		Count(&todayRequests)

	analysis.RequestPattern["today_requests"] = todayRequests
	if todayRequests > 10000 {
		riskScore += 30
		analysis.RiskFactors = append(analysis.RiskFactors, "高频请求")
	} else if todayRequests > 5000 {
		riskScore += 15
		analysis.RiskFactors = append(analysis.RiskFactors, "中等请求频率")
	}

	// 2. 额度使用分析
	usageRate := float64(0)
	if user.Quota > 0 {
		usageRate = float64(user.UsedQuota) / float64(user.Quota) * 100
	}
	analysis.QuotaBehavior["usage_rate"] = usageRate
	analysis.QuotaBehavior["total_quota"] = user.Quota
	analysis.QuotaBehavior["used_quota"] = user.UsedQuota

	if usageRate > 90 {
		riskScore += 20
		analysis.RiskFactors = append(analysis.RiskFactors, "额度使用率极高")
	}

	// 3. IP 行为分析
	var uniqueIPs int64
	db.Model(&models.Log{}).
		Where("user_id = ? AND created_at >= ?", userID, todayStart).
		Distinct("ip").
		Count(&uniqueIPs)

	analysis.IPBehavior["unique_ips_today"] = uniqueIPs
	if uniqueIPs > 50 {
		riskScore += 25
		analysis.RiskFactors = append(analysis.RiskFactors, "IP 来源过于分散")
	} else if uniqueIPs > 20 {
		riskScore += 10
		analysis.RiskFactors = append(analysis.RiskFactors, "多 IP 访问")
	}

	// 4. 令牌数量分析
	var tokenCount int64
	db.Model(&models.Token{}).
		Where("user_id = ? AND deleted_at IS NULL", userID).
		Count(&tokenCount)

	analysis.RequestPattern["token_count"] = tokenCount
	if tokenCount > 20 {
		riskScore += 15
		analysis.RiskFactors = append(analysis.RiskFactors, "令牌数量过多")
	}

	// 设置风险分数和等级
	analysis.RiskScore = riskScore
	if riskScore >= 60 {
		analysis.RiskLevel = "high"
		analysis.Recommendation = "建议立即审核该用户，考虑临时封禁"
	} else if riskScore >= 30 {
		analysis.RiskLevel = "medium"
		analysis.Recommendation = "建议密切监控该用户行为"
	} else {
		analysis.RiskLevel = "low"
		analysis.Recommendation = "用户行为正常"
	}

	return analysis, nil
}

// GetBanRecords 获取封禁记录
func (s *RiskService) GetBanRecords(page, pageSize int) ([]BanRecord, int64, error) {
	db := database.GetMainDB()

	// 查询被封禁的用户
	var users []models.User
	var total int64

	db.Model(&models.User{}).
		Where("status = ? AND deleted_at IS NULL", models.UserStatusBanned).
		Count(&total)

	offset := (page - 1) * pageSize
	db.Where("status = ? AND deleted_at IS NULL", models.UserStatusBanned).
		Order("updated_at DESC").
		Offset(offset).
		Limit(pageSize).
		Find(&users)

	records := make([]BanRecord, len(users))
	for i, u := range users {
		records[i] = BanRecord{
			ID:       u.ID,
			UserID:   u.ID,
			Username: u.Username,
			BanType:  "manual",
			BannedBy: "admin",
			BannedAt: u.CreatedAt.Format("2006-01-02 15:04:05"), // 使用创建时间作为封禁时间的近似
		}
	}

	return records, total, nil
}

// GetTokenRotation 获取令牌轮换情况
func (s *RiskService) GetTokenRotation(limit int) ([]TokenRotation, error) {
	db := database.GetMainDB()

	// 获取24小时内令牌变动较大的用户（Unix 时间戳）
	yesterday := time.Now().Add(-24 * time.Hour).Unix()

	var results []struct {
		UserID     int
		Username   string
		TokenCount int
		NewTokens  int
	}

	db.Table("users").
		Select(`
			users.id as user_id,
			users.username,
			(SELECT COUNT(*) FROM tokens WHERE tokens.user_id = users.id AND tokens.deleted_at IS NULL) as token_count,
			(SELECT COUNT(*) FROM tokens WHERE tokens.user_id = users.id AND tokens.created_at >= ?) as new_tokens
		`, yesterday).
		Where("users.deleted_at IS NULL").
		Order("new_tokens DESC").
		Limit(limit).
		Scan(&results)

	rotations := make([]TokenRotation, len(results))
	for i, r := range results {
		rotationRate := float64(0)
		if r.TokenCount > 0 {
			rotationRate = float64(r.NewTokens) / float64(r.TokenCount) * 100
		}
		rotations[i] = TokenRotation{
			UserID:       r.UserID,
			Username:     r.Username,
			TokenCount:   r.TokenCount,
			NewTokens:    r.NewTokens,
			RotationRate: rotationRate,
		}
	}

	return rotations, nil
}

// GetAffiliatedAccounts 获取关联账户
func (s *RiskService) GetAffiliatedAccounts(userID int) ([]map[string]interface{}, error) {
	db := database.GetMainDB()

	// 获取该用户使用过的 IP
	var userIPs []string
	db.Model(&models.Log{}).
		Where("user_id = ?", userID).
		Distinct("ip").
		Limit(100).
		Pluck("ip", &userIPs)

	if len(userIPs) == 0 {
		return []map[string]interface{}{}, nil
	}

	// 查找使用相同 IP 的其他用户
	var results []struct {
		UserID    int
		Username  string
		SharedIPs int
	}

	db.Table("logs").
		Select("logs.user_id, users.username, COUNT(DISTINCT logs.ip) as shared_ips").
		Joins("LEFT JOIN users ON logs.user_id = users.id").
		Where("logs.ip IN ? AND logs.user_id != ?", userIPs, userID).
		Group("logs.user_id, users.username").
		Having("shared_ips >= 3").
		Order("shared_ips DESC").
		Limit(20).
		Scan(&results)

	accounts := make([]map[string]interface{}, len(results))
	for i, r := range results {
		accounts[i] = map[string]interface{}{
			"user_id":    r.UserID,
			"username":   r.Username,
			"shared_ips": r.SharedIPs,
			"relation":   "shared_ip",
		}
	}

	return accounts, nil
}

// GetSameIPRegistrations 获取同 IP 注册用户
func (s *RiskService) GetSameIPRegistrations(limit int) ([]map[string]interface{}, error) {
	db := database.GetMainDB()

	// 查找注册 IP 相同的用户组
	// 注意：这里假设 users 表有 register_ip 字段
	var results []struct {
		RegisterIP string
		UserCount  int
	}

	// 由于可能没有 register_ip 字段，这里使用 logs 表的首次访问 IP
	db.Table("logs").
		Select("ip as register_ip, COUNT(DISTINCT user_id) as user_count").
		Group("ip").
		Having("user_count > 1").
		Order("user_count DESC").
		Limit(limit).
		Scan(&results)

	data := make([]map[string]interface{}, len(results))
	for i, r := range results {
		// 获取该 IP 下的用户列表
		var users []struct {
			UserID   int
			Username string
		}
		db.Table("logs").
			Select("DISTINCT logs.user_id, users.username").
			Joins("LEFT JOIN users ON logs.user_id = users.id").
			Where("logs.ip = ?", r.RegisterIP).
			Limit(10).
			Scan(&users)

		userList := make([]map[string]interface{}, len(users))
		for j, u := range users {
			userList[j] = map[string]interface{}{
				"user_id":  u.UserID,
				"username": u.Username,
			}
		}

		data[i] = map[string]interface{}{
			"ip":         r.RegisterIP,
			"user_count": r.UserCount,
			"users":      userList,
		}
	}

	return data, nil
}

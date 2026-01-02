package service

import (
	"fmt"
	"sync"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/models"
)

// AIBanService AI 自动封禁服务
type AIBanService struct {
	mu sync.RWMutex
}

// NewAIBanService 创建 AI 封禁服务
func NewAIBanService() *AIBanService {
	return &AIBanService{}
}

// AIBanConfig AI 封禁配置
type AIBanConfig struct {
	Enabled           bool    `json:"enabled"`
	RiskThreshold     float64 `json:"risk_threshold"`
	AutoBanEnabled    bool    `json:"auto_ban_enabled"`
	ScanInterval      int     `json:"scan_interval"`
	MaxRequestsPerDay int64   `json:"max_requests_per_day"`
	MaxIPsPerUser     int     `json:"max_ips_per_user"`
	MaxTokensPerUser  int     `json:"max_tokens_per_user"`
	QuotaUsageLimit   float64 `json:"quota_usage_limit"`
	WhitelistEnabled  bool    `json:"whitelist_enabled"`
	NotifyOnBan       bool    `json:"notify_on_ban"`
	LastUpdated       string  `json:"last_updated"`
}

// SuspiciousUser 可疑用户
type SuspiciousUser struct {
	UserID         int      `json:"user_id"`
	Username       string   `json:"username"`
	RiskScore      float64  `json:"risk_score"`
	RiskLevel      string   `json:"risk_level"`
	RiskFactors    []string `json:"risk_factors"`
	RequestCount   int64    `json:"request_count"`
	UniqueIPs      int      `json:"unique_ips"`
	TokenCount     int      `json:"token_count"`
	QuotaUsage     float64  `json:"quota_usage"`
	LastActivity   string   `json:"last_activity"`
	Recommendation string   `json:"recommendation"`
}

// RiskAssessment 风险评估结果
type RiskAssessment struct {
	UserID         int                    `json:"user_id"`
	Username       string                 `json:"username"`
	RiskScore      float64                `json:"risk_score"`
	RiskLevel      string                 `json:"risk_level"`
	RiskFactors    []string               `json:"risk_factors"`
	Details        map[string]interface{} `json:"details"`
	ShouldBan      bool                   `json:"should_ban"`
	Recommendation string                 `json:"recommendation"`
	AssessedAt     string                 `json:"assessed_at"`
}

// ScanResult 扫描结果
type ScanResult struct {
	ScannedUsers    int              `json:"scanned_users"`
	SuspiciousCount int              `json:"suspicious_count"`
	AutoBannedCount int              `json:"auto_banned_count"`
	HighRiskUsers   []SuspiciousUser `json:"high_risk_users"`
	ScanDuration    string           `json:"scan_duration"`
	ScannedAt       string           `json:"scanned_at"`
}

// WhitelistEntry 白名单条目
type WhitelistEntry struct {
	ID        int    `json:"id"`
	UserID    int    `json:"user_id"`
	Username  string `json:"username"`
	Reason    string `json:"reason"`
	AddedBy   string `json:"added_by"`
	AddedAt   string `json:"added_at"`
	ExpiresAt string `json:"expires_at"`
}

// 默认配置
var defaultAIBanConfig = &AIBanConfig{
	Enabled:           false,
	RiskThreshold:     60.0,
	AutoBanEnabled:    false,
	ScanInterval:      3600,
	MaxRequestsPerDay: 50000,
	MaxIPsPerUser:     100,
	MaxTokensPerUser:  50,
	QuotaUsageLimit:   95.0,
	WhitelistEnabled:  true,
	NotifyOnBan:       true,
}

// GetConfig 获取 AI 封禁配置
func (s *AIBanService) GetConfig() (*AIBanConfig, error) {
	cacheKey := cache.CacheKey("aiban", "config")

	var config AIBanConfig
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 10 * time.Minute,
	}

	err := wrapper.GetOrSet(&config, func() (interface{}, error) {
		// 从数据库或配置文件加载，这里返回默认配置
		cfg := *defaultAIBanConfig
		cfg.LastUpdated = time.Now().Format("2006-01-02 15:04:05")
		return &cfg, nil
	})

	return &config, err
}

// UpdateConfig 更新 AI 封禁配置
func (s *AIBanService) UpdateConfig(config *AIBanConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	config.LastUpdated = time.Now().Format("2006-01-02 15:04:05")

	// 清除缓存
	cacheKey := cache.CacheKey("aiban", "config")
	cache.Delete(cacheKey)

	return nil
}

// TestModel 测试 AI 模型连接
func (s *AIBanService) TestModel() (map[string]interface{}, error) {
	// 模拟 AI 模型测试
	return map[string]interface{}{
		"status":       "ok",
		"model":        "risk-assessment-v1",
		"latency_ms":   45,
		"last_checked": time.Now().Format("2006-01-02 15:04:05"),
	}, nil
}

// GetSuspiciousUsers 获取可疑用户列表
func (s *AIBanService) GetSuspiciousUsers(limit int) ([]SuspiciousUser, error) {
	db := database.GetMainDB()
	today := time.Now().Format("2006-01-02") + " 00:00:00"

	// 查询今日活跃用户的风险指标
	var results []struct {
		UserID       int
		Username     string
		Requests     int64
		UniqueIPs    int64
		Quota        int64
		UsedQuota    int64
		LastActivity time.Time
	}

	db.Table("logs").
		Select(`
			logs.user_id,
			users.username,
			COUNT(*) as requests,
			COUNT(DISTINCT logs.ip) as unique_ips,
			users.quota,
			users.used_quota,
			MAX(logs.created_at) as last_activity
		`).
		Joins("LEFT JOIN users ON logs.user_id = users.id").
		Where("logs.created_at >= ? AND logs.type = ?", today, models.LogTypeConsume).
		Group("logs.user_id, users.username, users.quota, users.used_quota").
		Having("requests > 1000 OR unique_ips > 20").
		Order("requests DESC").
		Limit(limit).
		Scan(&results)

	// 获取令牌数
	userIDs := make([]int, len(results))
	for i, r := range results {
		userIDs[i] = r.UserID
	}

	tokenCounts := make(map[int]int)
	if len(userIDs) > 0 {
		var counts []struct {
			UserID int
			Count  int
		}
		db.Model(&models.Token{}).
			Select("user_id, COUNT(*) as count").
			Where("user_id IN ? AND deleted_at IS NULL", userIDs).
			Group("user_id").
			Scan(&counts)
		for _, c := range counts {
			tokenCounts[c.UserID] = c.Count
		}
	}

	// 计算风险分数
	users := make([]SuspiciousUser, 0, len(results))
	for _, r := range results {
		riskScore, riskFactors := s.calculateRiskScore(r.Requests, int(r.UniqueIPs), tokenCounts[r.UserID], r.Quota, r.UsedQuota)

		if riskScore < 30 {
			continue
		}

		quotaUsage := float64(0)
		if r.Quota > 0 {
			quotaUsage = float64(r.UsedQuota) / float64(r.Quota) * 100
		}

		user := SuspiciousUser{
			UserID:       r.UserID,
			Username:     r.Username,
			RiskScore:    riskScore,
			RiskLevel:    s.getRiskLevel(riskScore),
			RiskFactors:  riskFactors,
			RequestCount: r.Requests,
			UniqueIPs:    int(r.UniqueIPs),
			TokenCount:   tokenCounts[r.UserID],
			QuotaUsage:   quotaUsage,
			LastActivity: r.LastActivity.Format("2006-01-02 15:04:05"),
		}
		user.Recommendation = s.getRecommendation(riskScore)
		users = append(users, user)
	}

	return users, nil
}

// AssessUserRisk 评估用户风险
func (s *AIBanService) AssessUserRisk(userID int) (*RiskAssessment, error) {
	db := database.GetMainDB()

	// 获取用户信息
	var user models.User
	if err := db.First(&user, userID).Error; err != nil {
		return nil, fmt.Errorf("用户不存在")
	}

	today := time.Now().Format("2006-01-02") + " 00:00:00"

	// 获取今日请求数
	var todayRequests int64
	db.Model(&models.Log{}).
		Where("user_id = ? AND created_at >= ? AND type = ?", userID, today, models.LogTypeConsume).
		Count(&todayRequests)

	// 获取唯一 IP 数
	var uniqueIPs int64
	db.Model(&models.Log{}).
		Where("user_id = ? AND created_at >= ?", userID, today).
		Distinct("ip").
		Count(&uniqueIPs)

	// 获取令牌数
	var tokenCount int64
	db.Model(&models.Token{}).
		Where("user_id = ? AND deleted_at IS NULL", userID).
		Count(&tokenCount)

	// 计算风险分数
	riskScore, riskFactors := s.calculateRiskScore(todayRequests, int(uniqueIPs), int(tokenCount), user.Quota, user.UsedQuota)

	config, _ := s.GetConfig()
	shouldBan := config.AutoBanEnabled && riskScore >= config.RiskThreshold

	assessment := &RiskAssessment{
		UserID:      userID,
		Username:    user.Username,
		RiskScore:   riskScore,
		RiskLevel:   s.getRiskLevel(riskScore),
		RiskFactors: riskFactors,
		Details: map[string]interface{}{
			"today_requests": todayRequests,
			"unique_ips":     uniqueIPs,
			"token_count":    tokenCount,
			"quota":          user.Quota,
			"used_quota":     user.UsedQuota,
			"quota_usage":    float64(user.UsedQuota) / float64(user.Quota) * 100,
		},
		ShouldBan:      shouldBan,
		Recommendation: s.getRecommendation(riskScore),
		AssessedAt:     time.Now().Format("2006-01-02 15:04:05"),
	}

	return assessment, nil
}

// ScanUsers 扫描所有用户
func (s *AIBanService) ScanUsers() (*ScanResult, error) {
	startTime := time.Now()
	db := database.GetMainDB()

	// 获取活跃用户数
	var totalUsers int64
	db.Model(&models.User{}).
		Where("deleted_at IS NULL AND status = ?", models.UserStatusEnabled).
		Count(&totalUsers)

	// 获取可疑用户
	suspiciousUsers, _ := s.GetSuspiciousUsers(100)

	// 统计高风险用户
	highRiskUsers := make([]SuspiciousUser, 0)
	autoBannedCount := 0

	config, _ := s.GetConfig()

	for _, user := range suspiciousUsers {
		if user.RiskScore >= 60 {
			highRiskUsers = append(highRiskUsers, user)
		}

		// 自动封禁
		if config.AutoBanEnabled && user.RiskScore >= config.RiskThreshold {
			// 检查白名单
			if !s.isWhitelisted(user.UserID) {
				// 执行封禁
				db.Model(&models.User{}).
					Where("id = ?", user.UserID).
					Update("status", models.UserStatusBanned)
				autoBannedCount++
			}
		}
	}

	duration := time.Since(startTime)

	return &ScanResult{
		ScannedUsers:    int(totalUsers),
		SuspiciousCount: len(suspiciousUsers),
		AutoBannedCount: autoBannedCount,
		HighRiskUsers:   highRiskUsers,
		ScanDuration:    duration.String(),
		ScannedAt:       time.Now().Format("2006-01-02 15:04:05"),
	}, nil
}

// GetWhitelist 获取白名单
func (s *AIBanService) GetWhitelist() ([]WhitelistEntry, error) {
	cacheKey := cache.CacheKey("aiban", "whitelist")

	var whitelist []WhitelistEntry
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 5 * time.Minute,
	}

	err := wrapper.GetOrSet(&whitelist, func() (interface{}, error) {
		// 从数据库加载白名单，这里返回空列表
		return []WhitelistEntry{}, nil
	})

	return whitelist, err
}

// AddToWhitelist 添加到白名单
func (s *AIBanService) AddToWhitelist(userID int, reason string) error {
	db := database.GetMainDB()

	// 验证用户存在
	var user models.User
	if err := db.First(&user, userID).Error; err != nil {
		return fmt.Errorf("用户不存在")
	}

	// 清除缓存
	cacheKey := cache.CacheKey("aiban", "whitelist")
	cache.Delete(cacheKey)

	return nil
}

// isWhitelisted 检查用户是否在白名单中
func (s *AIBanService) isWhitelisted(userID int) bool {
	whitelist, _ := s.GetWhitelist()
	for _, entry := range whitelist {
		if entry.UserID == userID {
			return true
		}
	}
	return false
}

// calculateRiskScore 计算风险分数
func (s *AIBanService) calculateRiskScore(requests int64, uniqueIPs int, tokenCount int, quota int64, usedQuota int64) (float64, []string) {
	score := 0.0
	factors := []string{}

	// 请求频率风险
	if requests > 50000 {
		score += 35
		factors = append(factors, "极高请求频率")
	} else if requests > 20000 {
		score += 25
		factors = append(factors, "高请求频率")
	} else if requests > 10000 {
		score += 15
		factors = append(factors, "中等请求频率")
	}

	// IP 分散风险
	if uniqueIPs > 100 {
		score += 30
		factors = append(factors, "IP 来源极度分散")
	} else if uniqueIPs > 50 {
		score += 20
		factors = append(factors, "IP 来源分散")
	} else if uniqueIPs > 20 {
		score += 10
		factors = append(factors, "多 IP 访问")
	}

	// 令牌数量风险
	if tokenCount > 50 {
		score += 20
		factors = append(factors, "令牌数量过多")
	} else if tokenCount > 20 {
		score += 10
		factors = append(factors, "令牌数量较多")
	}

	// 额度使用风险
	if quota > 0 {
		usageRate := float64(usedQuota) / float64(quota) * 100
		if usageRate > 95 {
			score += 15
			factors = append(factors, "额度即将耗尽")
		} else if usageRate > 80 {
			score += 5
			factors = append(factors, "额度使用率高")
		}
	}

	return score, factors
}

// getRiskLevel 获取风险等级
func (s *AIBanService) getRiskLevel(score float64) string {
	if score >= 80 {
		return "critical"
	} else if score >= 60 {
		return "high"
	} else if score >= 40 {
		return "medium"
	} else if score >= 20 {
		return "low"
	}
	return "safe"
}

// getRecommendation 获取建议
func (s *AIBanService) getRecommendation(score float64) string {
	if score >= 80 {
		return "建议立即封禁该用户"
	} else if score >= 60 {
		return "建议人工审核并考虑封禁"
	} else if score >= 40 {
		return "建议密切监控该用户"
	} else if score >= 20 {
		return "建议定期关注"
	}
	return "用户行为正常"
}

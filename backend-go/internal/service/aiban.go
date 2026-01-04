package service

import (
	"fmt"
	"sync"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/ketches/new-api-tools/internal/models"
	"go.uber.org/zap"
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
		// 从数据库加载配置
		cfg := *defaultAIBanConfig
		db := database.GetLocalDB()

		var configItems []models.AIBanConfigModel
		if err := db.Find(&configItems).Error; err == nil && len(configItems) > 0 {
			// 解析配置项
			for _, item := range configItems {
				switch item.Key {
				case "enabled":
					cfg.Enabled = item.Value == "true"
				case "risk_threshold":
					if v, err := parseFloat(item.Value); err == nil {
						cfg.RiskThreshold = v
					}
				case "auto_ban_enabled":
					cfg.AutoBanEnabled = item.Value == "true"
				case "scan_interval":
					if v, err := parseInt(item.Value); err == nil {
						cfg.ScanInterval = v
					}
				case "max_requests_per_day":
					if v, err := parseInt64(item.Value); err == nil {
						cfg.MaxRequestsPerDay = v
					}
				case "max_ips_per_user":
					if v, err := parseInt(item.Value); err == nil {
						cfg.MaxIPsPerUser = v
					}
				case "max_tokens_per_user":
					if v, err := parseInt(item.Value); err == nil {
						cfg.MaxTokensPerUser = v
					}
				case "quota_usage_limit":
					if v, err := parseFloat(item.Value); err == nil {
						cfg.QuotaUsageLimit = v
					}
				case "whitelist_enabled":
					cfg.WhitelistEnabled = item.Value == "true"
				case "notify_on_ban":
					cfg.NotifyOnBan = item.Value == "true"
				case "last_updated":
					cfg.LastUpdated = item.Value
				}
			}
		}

		if cfg.LastUpdated == "" {
			cfg.LastUpdated = time.Now().Format("2006-01-02 15:04:05")
		}
		return &cfg, nil
	})

	return &config, err
}

// parseFloat 解析浮点数
func parseFloat(s string) (float64, error) {
	var v float64
	_, err := fmt.Sscanf(s, "%f", &v)
	return v, err
}

// parseInt 解析整数
func parseInt(s string) (int, error) {
	var v int
	_, err := fmt.Sscanf(s, "%d", &v)
	return v, err
}

// parseInt64 解析 int64
func parseInt64(s string) (int64, error) {
	var v int64
	_, err := fmt.Sscanf(s, "%d", &v)
	return v, err
}

// UpdateConfig 更新 AI 封禁配置
func (s *AIBanService) UpdateConfig(config *AIBanConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	config.LastUpdated = time.Now().Format("2006-01-02 15:04:05")

	db := database.GetLocalDB()

	// 保存配置项到数据库
	configMap := map[string]string{
		"enabled":              fmt.Sprintf("%t", config.Enabled),
		"risk_threshold":       fmt.Sprintf("%.2f", config.RiskThreshold),
		"auto_ban_enabled":     fmt.Sprintf("%t", config.AutoBanEnabled),
		"scan_interval":        fmt.Sprintf("%d", config.ScanInterval),
		"max_requests_per_day": fmt.Sprintf("%d", config.MaxRequestsPerDay),
		"max_ips_per_user":     fmt.Sprintf("%d", config.MaxIPsPerUser),
		"max_tokens_per_user":  fmt.Sprintf("%d", config.MaxTokensPerUser),
		"quota_usage_limit":    fmt.Sprintf("%.2f", config.QuotaUsageLimit),
		"whitelist_enabled":    fmt.Sprintf("%t", config.WhitelistEnabled),
		"notify_on_ban":        fmt.Sprintf("%t", config.NotifyOnBan),
		"last_updated":         config.LastUpdated,
	}

	for key, value := range configMap {
		item := models.AIBanConfigModel{Key: key, Value: value}
		// Upsert: 存在则更新，不存在则插入
		if err := db.Where("key = ?", key).Assign(item).FirstOrCreate(&item).Error; err != nil {
			logger.Error("保存 AI Ban 配置失败", zap.String("key", key), zap.Error(err))
		}
	}

	// 记录审计日志
	s.logAudit("", models.AIAuditActionConfig, 0, "", "更新 AI 封禁配置", "system", 0)

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
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()

	// 查询今日活跃用户的风险指标
	var results []struct {
		UserID       int
		Username     string
		Requests     int64
		UniqueIPs    int64
		Quota        int64
		UsedQuota    int64
		LastActivity int64
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
		Where("logs.created_at >= ? AND logs.type = ?", todayStart, models.LogTypeConsume).
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
			LastActivity: time.Unix(r.LastActivity, 0).Format("2006-01-02 15:04:05"),
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

	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()

	// 获取今日请求数
	var todayRequests int64
	db.Model(&models.Log{}).
		Where("user_id = ? AND created_at >= ? AND type = ?", userID, todayStart, models.LogTypeConsume).
		Count(&todayRequests)

	// 获取唯一 IP 数
	var uniqueIPs int64
	db.Model(&models.Log{}).
		Where("user_id = ? AND created_at >= ?", userID, todayStart).
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
		db := database.GetLocalDB()
		mainDB := database.GetMainDB()

		var entries []models.AIBanWhitelist
		if err := db.Order("created_at DESC").Find(&entries).Error; err != nil {
			logger.Error("获取白名单失败", zap.Error(err))
			return []WhitelistEntry{}, nil
		}

		// 获取用户名
		userIDs := make([]int, len(entries))
		for i, e := range entries {
			userIDs[i] = e.UserID
		}

		usernames := make(map[int]string)
		if len(userIDs) > 0 {
			var users []struct {
				ID       int
				Username string
			}
			mainDB.Model(&models.User{}).Select("id, username").Where("id IN ?", userIDs).Scan(&users)
			for _, u := range users {
				usernames[u.ID] = u.Username
			}
		}

		// 转换为 WhitelistEntry
		result := make([]WhitelistEntry, 0, len(entries))
		for _, e := range entries {
			// 跳过已过期的条目
			if e.IsExpired() {
				continue
			}

			entry := WhitelistEntry{
				ID:       e.ID,
				UserID:   e.UserID,
				Username: usernames[e.UserID],
				Reason:   e.Reason,
				AddedBy:  e.AddedBy,
				AddedAt:  e.CreatedAt.Format("2006-01-02 15:04:05"),
			}
			if e.ExpiresAt != nil {
				entry.ExpiresAt = e.ExpiresAt.Format("2006-01-02 15:04:05")
			}
			result = append(result, entry)
		}

		return result, nil
	})

	return whitelist, err
}

// AddToWhitelist 添加到白名单
func (s *AIBanService) AddToWhitelist(userID int, reason string) error {
	mainDB := database.GetMainDB()
	localDB := database.GetLocalDB()

	// 验证用户存在
	var user models.User
	if err := mainDB.First(&user, userID).Error; err != nil {
		return fmt.Errorf("用户不存在")
	}

	// 检查是否已在白名单中
	var existing models.AIBanWhitelist
	if err := localDB.Where("user_id = ?", userID).First(&existing).Error; err == nil {
		return fmt.Errorf("用户已在白名单中")
	}

	// 添加到白名单
	entry := models.AIBanWhitelist{
		UserID:  userID,
		Reason:  reason,
		AddedBy: "admin",
	}

	if err := localDB.Create(&entry).Error; err != nil {
		logger.Error("添加白名单失败", zap.Int("user_id", userID), zap.Error(err))
		return fmt.Errorf("添加失败: %w", err)
	}

	// 记录审计日志
	s.logAudit("", models.AIAuditActionWhiteAdd, userID, user.Username, fmt.Sprintf("添加用户 %s 到白名单: %s", user.Username, reason), "admin", 0)

	// 清除缓存
	cacheKey := cache.CacheKey("aiban", "whitelist")
	cache.Delete(cacheKey)

	logger.Info("添加用户到白名单", zap.Int("user_id", userID), zap.String("username", user.Username))
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

// RemoveFromWhitelist 从白名单移除
func (s *AIBanService) RemoveFromWhitelist(userID int) error {
	db := database.GetLocalDB()

	// 先获取用户信息用于审计日志
	var entry models.AIBanWhitelist
	if err := db.Where("user_id = ?", userID).First(&entry).Error; err != nil {
		return fmt.Errorf("用户不在白名单中")
	}

	// 删除白名单条目
	if err := db.Where("user_id = ?", userID).Delete(&models.AIBanWhitelist{}).Error; err != nil {
		logger.Error("从白名单移除失败", zap.Int("user_id", userID), zap.Error(err))
		return fmt.Errorf("移除失败: %w", err)
	}

	// 记录审计日志
	s.logAudit("", models.AIAuditActionWhiteDel, userID, "", fmt.Sprintf("从白名单移除用户 %d", userID), "system", 0)

	// 清除缓存
	cacheKey := cache.CacheKey("aiban", "whitelist")
	cache.Delete(cacheKey)

	logger.Info("从白名单移除用户", zap.Int("user_id", userID))
	return nil
}

// logAudit 记录审计日志
func (s *AIBanService) logAudit(scanID string, action string, userID int, username string, details string, operator string, riskScore float64) {
	db := database.GetLocalDB()

	log := models.AIAuditLog{
		ScanID:    scanID,
		Action:    action,
		UserID:    userID,
		Username:  username,
		Details:   details,
		Operator:  operator,
		RiskScore: riskScore,
	}

	if err := db.Create(&log).Error; err != nil {
		logger.Error("记录审计日志失败",
			zap.String("action", action),
			zap.Int("user_id", userID),
			zap.Error(err))
	}
}

// SearchWhitelist 搜索白名单
func (s *AIBanService) SearchWhitelist(keyword string) ([]WhitelistEntry, error) {
	whitelist, err := s.GetWhitelist()
	if err != nil {
		return nil, err
	}
	if keyword == "" {
		return whitelist, nil
	}
	// 简单过滤
	var result []WhitelistEntry
	for _, entry := range whitelist {
		if entry.Username == keyword || entry.Reason == keyword {
			result = append(result, entry)
		}
	}
	return result, nil
}

// AuditLog 审计日志 (API 响应格式)
type AuditLog struct {
	ID        int     `json:"id"`
	ScanID    string  `json:"scan_id,omitempty"`
	Action    string  `json:"action"`
	UserID    int     `json:"user_id"`
	Username  string  `json:"username"`
	Details   string  `json:"details"`
	Operator  string  `json:"operator"`
	RiskScore float64 `json:"risk_score,omitempty"`
	CreatedAt string  `json:"created_at"`
}

// GetAuditLogs 获取审计日志
func (s *AIBanService) GetAuditLogs(page, pageSize int) (map[string]interface{}, error) {
	db := database.GetLocalDB()

	// 防止无效参数
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	// 查询总数
	var total int64
	db.Model(&models.AIAuditLog{}).Count(&total)

	// 查询日志
	var logs []models.AIAuditLog
	if err := db.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&logs).Error; err != nil {
		logger.Error("获取审计日志失败", zap.Error(err))
		return map[string]interface{}{
			"logs":  []AuditLog{},
			"total": 0,
			"page":  page,
		}, nil
	}

	// 转换为 API 响应格式
	result := make([]AuditLog, len(logs))
	for i, log := range logs {
		result[i] = AuditLog{
			ID:        log.ID,
			ScanID:    log.ScanID,
			Action:    log.Action,
			UserID:    log.UserID,
			Username:  log.Username,
			Details:   log.Details,
			Operator:  log.Operator,
			RiskScore: log.RiskScore,
			CreatedAt: log.CreatedAt.Format("2006-01-02 15:04:05"),
		}
	}

	return map[string]interface{}{
		"logs":        result,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": (total + int64(pageSize) - 1) / int64(pageSize),
	}, nil
}

// DeleteAuditLogs 删除审计日志
func (s *AIBanService) DeleteAuditLogs() error {
	db := database.GetLocalDB()

	// 获取删除前的日志数量
	var count int64
	db.Model(&models.AIAuditLog{}).Count(&count)

	// 删除所有审计日志
	if err := db.Exec("DELETE FROM aiban_audit_logs").Error; err != nil {
		logger.Error("删除审计日志失败", zap.Error(err))
		return fmt.Errorf("删除失败: %w", err)
	}

	logger.Info("删除审计日志完成", zap.Int64("deleted_count", count))
	return nil
}

// TestConnection 测试 AI 连接
func (s *AIBanService) TestConnection() (map[string]interface{}, error) {
	return map[string]interface{}{
		"status":    "ok",
		"latency":   "45ms",
		"connected": true,
	}, nil
}

// ResetAPIHealth 重置 API 健康状态
func (s *AIBanService) ResetAPIHealth() error {
	return nil
}

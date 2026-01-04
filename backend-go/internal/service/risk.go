package service

import (
	"fmt"
	"sort"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/models"
	"github.com/ketches/new-api-tools/pkg/geoip"
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
	UserID            int                    `json:"user_id"`
	Username          string                 `json:"username"`
	RiskScore         float64                `json:"risk_score"`
	RiskLevel         string                 `json:"risk_level"`
	RiskFactors       []string               `json:"risk_factors"`
	RequestPattern    map[string]interface{} `json:"request_pattern"`
	IPBehavior        map[string]interface{} `json:"ip_behavior"`
	QuotaBehavior     map[string]interface{} `json:"quota_behavior"`
	RealSwitchCount   int                    `json:"real_switch_count"`   // 真实 IP 切换次数
	DualStackSwitches int                    `json:"dual_stack_switches"` // 双栈切换次数
	IPSwitchAnalysis  *IPSwitchAnalysis      `json:"ip_switch_analysis"`  // IP 切换分析
	Recommendation    string                 `json:"recommendation"`
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

// IPSwitchDetail IP 切换详情
type IPSwitchDetail struct {
	Timestamp       string `json:"timestamp"`
	FromIP          string `json:"from_ip"`
	ToIP            string `json:"to_ip"`
	IsDualStack     bool   `json:"is_dual_stack"`
	IntervalSeconds int64  `json:"interval_seconds"`
	FromVersion     string `json:"from_version"` // v4/v6
	ToVersion       string `json:"to_version"`   // v4/v6
}

// IPSwitchAnalysis IP 切换分析结果
type IPSwitchAnalysis struct {
	SwitchCount       int              `json:"switch_count"`        // 总切换次数
	RealSwitchCount   int              `json:"real_switch_count"`   // 真实切换次数（非双栈）
	RapidSwitchCount  int              `json:"rapid_switch_count"`  // 快速切换次数（5分钟内）
	DualStackSwitches int              `json:"dual_stack_switches"` // 双栈切换次数
	UniqueLocations   int              `json:"unique_locations"`    // 唯一位置数
	HasDualStack      bool             `json:"has_dual_stack"`      // 是否有双栈行为
	Switches          []IPSwitchDetail `json:"switches"`            // 切换详情（最近20条）
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

	// 5. IP 切换分析（区分真实切换和双栈切换）
	ipSwitchAnalysis := s.analyzeIPSwitches(userID)
	analysis.IPSwitchAnalysis = ipSwitchAnalysis
	analysis.RealSwitchCount = ipSwitchAnalysis.RealSwitchCount
	analysis.DualStackSwitches = ipSwitchAnalysis.DualStackSwitches

	// 记录 IP 切换相关信息到 IPBehavior
	analysis.IPBehavior["switch_count"] = ipSwitchAnalysis.SwitchCount
	analysis.IPBehavior["real_switch_count"] = ipSwitchAnalysis.RealSwitchCount
	analysis.IPBehavior["dual_stack_switches"] = ipSwitchAnalysis.DualStackSwitches
	analysis.IPBehavior["rapid_switch_count"] = ipSwitchAnalysis.RapidSwitchCount
	analysis.IPBehavior["unique_locations"] = ipSwitchAnalysis.UniqueLocations
	analysis.IPBehavior["has_dual_stack"] = ipSwitchAnalysis.HasDualStack

	// 基于真实切换次数（非双栈）调整风险分数
	// 只有真实的 IP 位置切换才计入风险评估
	if ipSwitchAnalysis.RealSwitchCount > 30 {
		riskScore += 25
		analysis.RiskFactors = append(analysis.RiskFactors, "真实 IP 切换频繁")
	} else if ipSwitchAnalysis.RealSwitchCount > 15 {
		riskScore += 10
		analysis.RiskFactors = append(analysis.RiskFactors, "真实 IP 切换较多")
	}

	// 快速切换（5 分钟内）是更强的风险信号
	if ipSwitchAnalysis.RapidSwitchCount > 10 {
		riskScore += 20
		analysis.RiskFactors = append(analysis.RiskFactors, "频繁快速切换 IP")
	}

	// 如果用户有双栈行为，降低 IP 分散的风险权重
	// 因为双栈用户的 unique_ips 会自然较高
	if ipSwitchAnalysis.HasDualStack && uniqueIPs > 20 && uniqueIPs <= 50 {
		// 撤销之前的 "多 IP 访问" 风险因素
		for i, factor := range analysis.RiskFactors {
			if factor == "多 IP 访问" {
				analysis.RiskFactors = append(analysis.RiskFactors[:i], analysis.RiskFactors[i+1:]...)
				riskScore -= 10
				break
			}
		}
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

// analyzeIPSwitches 分析用户 IP 切换行为
// 区分真实 IP 切换和 IPv4/IPv6 双栈切换
func (s *RiskService) analyzeIPSwitches(userID int) *IPSwitchAnalysis {
	db := database.GetMainDB()

	// 获取用户最近 7 天的 IP 访问记录（按时间排序）
	weekAgo := time.Now().Add(-7 * 24 * time.Hour).Unix()

	var logs []struct {
		IP        string
		CreatedAt int64
	}

	db.Table("logs").
		Select("ip, created_at").
		Where("user_id = ? AND created_at >= ? AND ip != ''", userID, weekAgo).
		Order("created_at ASC").
		Limit(1000). // 限制查询数量
		Scan(&logs)

	if len(logs) < 2 {
		return &IPSwitchAnalysis{
			Switches: []IPSwitchDetail{},
		}
	}

	analysis := &IPSwitchAnalysis{
		Switches: []IPSwitchDetail{},
	}

	// 用于统计唯一位置
	locationSet := make(map[string]bool)

	// 遍历日志，检测 IP 切换
	var switches []IPSwitchDetail
	prevIP := logs[0].IP
	prevTime := logs[0].CreatedAt

	// 记录第一个 IP 的位置
	if geo := geoip.Lookup(prevIP); geo.IsValid {
		if key := geo.GetLocationKey(); key != "" {
			locationSet[key] = true
		}
	}

	for i := 1; i < len(logs); i++ {
		currentIP := logs[i].IP
		currentTime := logs[i].CreatedAt

		// 检测到 IP 变化
		if currentIP != prevIP {
			analysis.SwitchCount++

			// 计算时间间隔
			interval := currentTime - prevTime

			// 获取 IP 版本
			fromVersion := string(geoip.GetIPVersion(prevIP))
			toVersion := string(geoip.GetIPVersion(currentIP))

			// 检查是否为双栈切换
			isDualStack := geoip.IsDualStackPair(prevIP, currentIP)

			if isDualStack {
				analysis.DualStackSwitches++
				analysis.HasDualStack = true
			} else {
				analysis.RealSwitchCount++
			}

			// 检查是否为快速切换（5 分钟内）
			if interval < 300 {
				analysis.RapidSwitchCount++
			}

			// 记录切换详情
			switchDetail := IPSwitchDetail{
				Timestamp:       time.Unix(currentTime, 0).Format("2006-01-02 15:04:05"),
				FromIP:          prevIP,
				ToIP:            currentIP,
				IsDualStack:     isDualStack,
				IntervalSeconds: interval,
				FromVersion:     fromVersion,
				ToVersion:       toVersion,
			}
			switches = append(switches, switchDetail)

			// 记录当前 IP 的位置
			if geo := geoip.Lookup(currentIP); geo.IsValid {
				if key := geo.GetLocationKey(); key != "" {
					locationSet[key] = true
				}
			}
		}

		prevIP = currentIP
		prevTime = currentTime
	}

	// 统计唯一位置数
	analysis.UniqueLocations = len(locationSet)

	// 只保留最近 20 条切换记录
	if len(switches) > 20 {
		// 按时间倒序，保留最新的 20 条
		sort.Slice(switches, func(i, j int) bool {
			return switches[i].Timestamp > switches[j].Timestamp
		})
		switches = switches[:20]
	}
	analysis.Switches = switches

	return analysis
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

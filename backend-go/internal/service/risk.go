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
	AvgIPDuration     int              `json:"avg_ip_duration"`     // 平均 IP 停留时间（秒）
	Switches          []IPSwitchDetail `json:"switches"`            // 切换详情（最近20条）- 兼容旧字段
	SwitchDetails     []IPSwitchDetail `json:"switch_details"`      // 切换详情（最近20条）
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

// GetBanRecords 获取封禁记录（简化版：以 users.status=ban 为准）
func (s *RiskService) GetBanRecords(page, pageSize int, userID int) ([]BanRecord, int64, error) {
	db := database.GetMainDB()

	// 查询被封禁的用户
	var users []models.User
	var total int64

	tx := db.Model(&models.User{}).Where("status = ? AND deleted_at IS NULL", models.UserStatusBanned)
	if userID > 0 {
		tx = tx.Where("id = ?", userID)
	}
	tx.Count(&total)

	offset := (page - 1) * pageSize
	listTx := db.Where("status = ? AND deleted_at IS NULL", models.UserStatusBanned)
	if userID > 0 {
		listTx = listTx.Where("id = ?", userID)
	}
	listTx.
		Order("id DESC"). // users 表没有 updated_at，按 id 降序
		Offset(offset).
		Limit(pageSize).
		Find(&users)

	// 获取每个用户的最后请求时间（作为封禁时间的近似值）
	userIDs := make([]int, len(users))
	for i, u := range users {
		userIDs[i] = u.ID
	}

	lastSeenMap := make(map[int]int64)
	if len(userIDs) > 0 {
		var logTimes []struct {
			UserID   int   `gorm:"column:user_id"`
			LastSeen int64 `gorm:"column:last_seen"`
		}
		db.Table("logs").
			Select("user_id, MAX(created_at) as last_seen").
			Where("user_id IN ?", userIDs).
			Group("user_id").
			Scan(&logTimes)
		for _, lt := range logTimes {
			lastSeenMap[lt.UserID] = lt.LastSeen
		}
	}

	records := make([]BanRecord, len(users))
	for i, u := range users {
		bannedAt := ""
		// 使用最后请求时间作为封禁时间的近似值（封禁后用户无法再请求）
		if lastSeen, ok := lastSeenMap[u.ID]; ok && lastSeen > 0 {
			bannedAt = time.Unix(lastSeen, 0).Format("2006-01-02 15:04:05")
		}
		records[i] = BanRecord{
			ID:       u.ID,
			UserID:   u.ID,
			Username: u.Username,
			BanType:  "manual",
			BannedBy: "admin",
			BannedAt: bannedAt,
		}
	}

	return records, total, nil
}

// GetTokenRotationUsers 检测 Token 轮换行为（与 Python /api/risk/token-rotation 对齐）
func (s *RiskService) GetTokenRotationUsers(windowSeconds int64, minTokens int, maxRequestsPerToken int, limit int) (map[string]interface{}, error) {
	db := database.GetMainDB()
	now := time.Now().Unix()
	startTime := now - windowSeconds

	if minTokens <= 0 {
		minTokens = 5
	}
	if maxRequestsPerToken <= 0 {
		maxRequestsPerToken = 10
	}
	if limit <= 0 {
		limit = 50
	}

	type row struct {
		UserID        int
		Username      string
		TokenCount    int
		TotalRequests int64
	}

	var rows []row
	if err := db.Table("logs").
		Select(`
			logs.user_id as user_id,
			MAX(users.username) as username,
			COUNT(DISTINCT logs.token_id) as token_count,
			COUNT(*) as total_requests
		`).
		Joins("LEFT JOIN users ON logs.user_id = users.id").
		Where("logs.created_at >= ? AND logs.created_at <= ? AND logs.type IN ? AND logs.user_id IS NOT NULL AND logs.token_id IS NOT NULL AND logs.token_id > 0",
			startTime, now, []int{models.LogTypeConsume, models.LogTypeFailure},
		).
		Group("logs.user_id").
		Having("COUNT(DISTINCT logs.token_id) >= ?", minTokens).
		Order("token_count DESC, total_requests DESC").
		Limit(limit).
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	items := make([]map[string]interface{}, 0, len(rows))
	for _, r := range rows {
		if r.TokenCount <= 0 {
			continue
		}
		avg := float64(r.TotalRequests) / float64(r.TokenCount)
		if avg > float64(maxRequestsPerToken) {
			continue
		}

		// Token 详情（最多 10 个）
		type tokenRow struct {
			TokenID   int
			TokenName string
			Requests  int64
			FirstUsed int64
			LastUsed  int64
		}
		var tokenRows []tokenRow
		db.Table("logs").
			Select(`
				token_id as token_id,
				MAX(token_name) as token_name,
				COUNT(*) as requests,
				MIN(created_at) as first_used,
				MAX(created_at) as last_used
			`).
			Where("created_at >= ? AND created_at <= ? AND user_id = ? AND token_id IS NOT NULL AND token_id > 0 AND type IN ?",
				startTime, now, r.UserID, []int{models.LogTypeConsume, models.LogTypeFailure},
			).
			Group("token_id").
			Order("requests DESC").
			Limit(10).
			Scan(&tokenRows)

		tokens := make([]map[string]interface{}, 0, len(tokenRows))
		for _, t := range tokenRows {
			tokens = append(tokens, map[string]interface{}{
				"token_id":   t.TokenID,
				"token_name": t.TokenName,
				"requests":   t.Requests,
				"first_used": t.FirstUsed,
				"last_used":  t.LastUsed,
			})
		}

		riskLevel := "medium"
		if r.TokenCount >= 10 {
			riskLevel = "high"
		}

		items = append(items, map[string]interface{}{
			"user_id":                r.UserID,
			"username":               r.Username,
			"token_count":            r.TokenCount,
			"total_requests":         r.TotalRequests,
			"avg_requests_per_token": avg,
			"tokens":                 tokens,
			"risk_level":             riskLevel,
		})
	}

	return map[string]interface{}{
		"items":          items,
		"total":          len(items),
		"window_seconds": windowSeconds,
		"thresholds": map[string]interface{}{
			"min_tokens":             minTokens,
			"max_requests_per_token": maxRequestsPerToken,
		},
	}, nil
}

// GetAffiliatedAccounts 检测关联账号（邀请链）（与 Python /api/risk/affiliated-accounts 对齐）
func (s *RiskService) GetAffiliatedAccounts(minInvited int, includeActivity bool, limit int) (map[string]interface{}, error) {
	db := database.GetMainDB()

	if minInvited <= 0 {
		minInvited = 3
	}
	if limit <= 0 {
		limit = 50
	}

	type inviterRow struct {
		InviterID    int
		InvitedCount int64
	}
	var inviters []inviterRow
	if err := db.Model(&models.User{}).
		Select("inviter_id as inviter_id, COUNT(*) as invited_count").
		Where("inviter_id IS NOT NULL AND inviter_id <> 0 AND deleted_at IS NULL AND status != ?", models.UserStatusBanned).
		Group("inviter_id").
		Having("COUNT(*) >= ?", minInvited).
		Order("invited_count DESC").
		Limit(limit).
		Scan(&inviters).Error; err != nil {
		return nil, err
	}

	items := make([]map[string]interface{}, 0, len(inviters))
	for _, row := range inviters {
		// inviter info
		var inviter models.User
		db.Where("id = ? AND deleted_at IS NULL", row.InviterID).First(&inviter)

		// invited users (include banned for risk stats)
		var invited []models.User
		db.Where("inviter_id = ? AND deleted_at IS NULL", row.InviterID).
			Order("id").
			Find(&invited)

		invitedUsers := make([]map[string]interface{}, 0, len(invited))
		totalUsedQuota := int64(0)
		totalRequests := int64(0)
		activeCount := 0
		bannedCount := 0

		for _, u := range invited {
			invitedUsers = append(invitedUsers, map[string]interface{}{
				"user_id":       u.ID,
				"username":      u.Username,
				"display_name":  u.DisplayName,
				"status":        u.Status,
				"used_quota":    u.UsedQuota,
				"request_count": u.RequestCount,
				"group":         u.Group,
			})

			totalUsedQuota += u.UsedQuota
			totalRequests += int64(u.RequestCount)
			if u.RequestCount > 0 {
				activeCount++
			}
			if u.Status == models.UserStatusBanned {
				bannedCount++
			}
		}

		riskLevel := "low"
		riskReasons := []string{}
		if row.InvitedCount >= 10 {
			riskLevel = "high"
			riskReasons = append(riskReasons, fmt.Sprintf("邀请账号数量过多(%d)", row.InvitedCount))
		} else if row.InvitedCount >= 5 {
			riskLevel = "medium"
			riskReasons = append(riskReasons, fmt.Sprintf("邀请账号数量较多(%d)", row.InvitedCount))
		}
		if includeActivity && activeCount > 0 && float64(totalRequests)/float64(activeCount) < 10 {
			if riskLevel == "low" {
				riskLevel = "medium"
			} else {
				riskLevel = "high"
			}
			riskReasons = append(riskReasons, "被邀请账号活跃度低")
		}
		if bannedCount > 0 {
			riskLevel = "high"
			riskReasons = append(riskReasons, fmt.Sprintf("有%d个账号已被封禁", bannedCount))
		}

		items = append(items, map[string]interface{}{
			"inviter_id":       row.InviterID,
			"inviter_username": inviter.Username,
			"inviter_status":   inviter.Status,
			"invited_count":    row.InvitedCount,
			"invited_users":    invitedUsers,
			"stats": map[string]interface{}{
				"total_used_quota": totalUsedQuota,
				"total_requests":   totalRequests,
				"active_count":     activeCount,
				"banned_count":     bannedCount,
			},
			"risk_level":   riskLevel,
			"risk_reasons": riskReasons,
		})
	}

	return map[string]interface{}{
		"items": items,
		"total": len(items),
		"thresholds": map[string]interface{}{
			"min_invited": minInvited,
		},
	}, nil
}

// GetSameIPRegistrations 检测同 IP 注册（以窗口内首次请求 IP 近似）（与 Python /api/risk/same-ip-registrations 对齐）
func (s *RiskService) GetSameIPRegistrations(windowSeconds int64, minUsers int, limit int) (map[string]interface{}, error) {
	db := database.GetMainDB()
	now := time.Now().Unix()
	startTime := now - windowSeconds

	if minUsers <= 0 {
		minUsers = 3
	}
	if limit <= 0 {
		limit = 50
	}

	firstTimes := db.Table("logs").
		Select("user_id, MIN(created_at) as first_request_time").
		Where("created_at >= ? AND created_at <= ? AND user_id IS NOT NULL AND ip IS NOT NULL AND ip <> ''", startTime, now).
		Group("user_id")

	type ipRow struct {
		IP        string
		UserCount int64
	}
	var ipRows []ipRow
	if err := db.Table("(?) t", firstTimes).
		Select("l.ip as ip, COUNT(*) as user_count").
		Joins("JOIN logs l ON l.user_id = t.user_id AND l.created_at = t.first_request_time").
		Group("l.ip").
		Having("COUNT(*) >= ?", minUsers).
		Order("user_count DESC").
		Limit(limit).
		Scan(&ipRows).Error; err != nil {
		return nil, err
	}

	items := make([]map[string]interface{}, 0, len(ipRows))
	for _, r := range ipRows {
		// user_ids under this ip
		var userIDs []int
		db.Table("(?) t", firstTimes).
			Select("t.user_id").
			Joins("JOIN logs l ON l.user_id = t.user_id AND l.created_at = t.first_request_time").
			Where("l.ip = ?", r.IP).
			Order("t.first_request_time ASC").
			Pluck("t.user_id", &userIDs)

		var users []models.User
		if len(userIDs) > 0 {
			db.Where("id IN ? AND deleted_at IS NULL", userIDs).Find(&users)
		}

		userItems := make([]map[string]interface{}, 0, len(users))
		bannedCount := 0
		for _, u := range users {
			userItems = append(userItems, map[string]interface{}{
				"user_id":       u.ID,
				"username":      u.Username,
				"status":        u.Status,
				"used_quota":    u.UsedQuota,
				"request_count": u.RequestCount,
			})
			if u.Status == models.UserStatusBanned {
				bannedCount++
			}
		}

		riskLevel := "medium"
		if r.UserCount >= 5 || bannedCount > 0 {
			riskLevel = "high"
		}

		items = append(items, map[string]interface{}{
			"ip":           r.IP,
			"user_count":   r.UserCount,
			"users":        userItems,
			"banned_count": bannedCount,
			"risk_level":   riskLevel,
		})
	}

	return map[string]interface{}{
		"items":          items,
		"total":          len(items),
		"window_seconds": windowSeconds,
		"thresholds": map[string]interface{}{
			"min_users": minUsers,
		},
	}, nil
}

// GetRealtimeLeaderboard 获取单窗口实时排行（与 Python /api/risk/leaderboards 对齐）
func (s *RiskService) GetRealtimeLeaderboard(windowSeconds int64, limit int, sortBy string) ([]map[string]interface{}, error) {
	db := database.GetMainDB()
	now := time.Now().Unix()
	startTime := now - windowSeconds

	if limit <= 0 {
		limit = 10
	}
	if sortBy == "" {
		sortBy = "requests"
	}

	type row struct {
		UserID           int
		Username         string
		UserStatus       int
		TotalRequests    int64
		FailureRequests  int64
		QuotaUsed        int64
		PromptTokens     int64
		CompletionTokens int64
		UniqueIPs        int64
	}

	var rows []row
	orderClause := "total_requests DESC"
	switch sortBy {
	case "quota":
		orderClause = "quota_used DESC"
	case "failure_rate":
		orderClause = "failure_requests DESC"
	}

	if err := db.Table("logs").
		Select(`
			logs.user_id as user_id,
			MAX(users.username) as username,
			MAX(users.status) as user_status,
			COUNT(*) as total_requests,
			SUM(CASE WHEN logs.type = 5 THEN 1 ELSE 0 END) as failure_requests,
			COALESCE(SUM(logs.quota), 0) as quota_used,
			COALESCE(SUM(logs.prompt_tokens), 0) as prompt_tokens,
			COALESCE(SUM(logs.completion_tokens), 0) as completion_tokens,
			COUNT(DISTINCT NULLIF(logs.ip, '')) as unique_ips
		`).
		Joins("LEFT JOIN users ON logs.user_id = users.id").
		Where("logs.created_at >= ? AND logs.created_at <= ? AND logs.type IN ? AND logs.user_id IS NOT NULL",
			startTime, now, []int{models.LogTypeConsume, models.LogTypeFailure},
		).
		Group("logs.user_id").
		Order(orderClause).
		Limit(limit).
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	items := make([]map[string]interface{}, 0, len(rows))
	for _, r := range rows {
		total := r.TotalRequests
		failureRate := float64(0)
		if total > 0 {
			failureRate = float64(r.FailureRequests) / float64(total)
		}
		items = append(items, map[string]interface{}{
			"user_id":           r.UserID,
			"username":          r.Username,
			"user_status":       r.UserStatus,
			"request_count":     r.TotalRequests,
			"failure_requests":  r.FailureRequests,
			"failure_rate":      failureRate,
			"quota_used":        r.QuotaUsed,
			"prompt_tokens":     r.PromptTokens,
			"completion_tokens": r.CompletionTokens,
			"unique_ips":        r.UniqueIPs,
		})
	}

	return items, nil
}

// GetUserAnalysis 获取用户分析（与 Python /api/risk/users/{user_id}/analysis 对齐的简化版）
func (s *RiskService) GetUserAnalysis(userID int, windowSeconds int64) (map[string]interface{}, error) {
	db := database.GetMainDB()
	now := time.Now().Unix()
	startTime := now - windowSeconds

	var user models.User
	if err := db.Where("id = ? AND deleted_at IS NULL", userID).First(&user).Error; err != nil {
		return nil, fmt.Errorf("用户不存在")
	}

	type summaryRow struct {
		TotalRequests    int64
		SuccessRequests  int64
		FailureRequests  int64
		QuotaUsed        int64
		PromptTokens     int64
		CompletionTokens int64
		AvgUseTime       float64
		UniqueIPs        int64
		UniqueTokens     int64
		UniqueModels     int64
		UniqueChannels   int64
		EmptyCount       int64
	}
	var summary summaryRow
	if err := db.Table("logs").
		Select(`
			COUNT(*) as total_requests,
			SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as success_requests,
			SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_requests,
			COALESCE(SUM(quota), 0) as quota_used,
			COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
			COALESCE(SUM(completion_tokens), 0) as completion_tokens,
			COALESCE(AVG(use_time), 0) as avg_use_time,
			COUNT(DISTINCT NULLIF(ip, '')) as unique_ips,
			COUNT(DISTINCT token_id) as unique_tokens,
			COUNT(DISTINCT model_name) as unique_models,
			COUNT(DISTINCT channel_id) as unique_channels,
			SUM(CASE WHEN type = 2 AND completion_tokens = 0 THEN 1 ELSE 0 END) as empty_count
		`).
		Where("user_id = ? AND created_at >= ? AND created_at <= ? AND type IN ?", userID, startTime, now, []int{models.LogTypeConsume, models.LogTypeFailure}).
		Scan(&summary).Error; err != nil {
		return nil, err
	}

	// top models
	type modelRow struct {
		ModelName       string
		Requests        int64
		QuotaUsed       int64
		SuccessRequests int64
		FailureRequests int64
		EmptyCount      int64
	}
	var modelRows []modelRow
	db.Table("logs").
		Select(`
			COALESCE(model_name, 'unknown') as model_name,
			COUNT(*) as requests,
			COALESCE(SUM(quota), 0) as quota_used,
			SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as success_requests,
			SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_requests,
			SUM(CASE WHEN type = 2 AND completion_tokens = 0 THEN 1 ELSE 0 END) as empty_count
		`).
		Where("user_id = ? AND created_at >= ? AND created_at <= ? AND type IN ?", userID, startTime, now, []int{models.LogTypeConsume, models.LogTypeFailure}).
		Group("COALESCE(model_name, 'unknown')").
		Order("requests DESC").
		Limit(10).
		Scan(&modelRows)

	topModels := make([]map[string]interface{}, 0, len(modelRows))
	for _, m := range modelRows {
		topModels = append(topModels, map[string]interface{}{
			"model_name":       m.ModelName,
			"requests":         m.Requests,
			"quota_used":       m.QuotaUsed,
			"success_requests": m.SuccessRequests,
			"failure_requests": m.FailureRequests,
			"empty_count":      m.EmptyCount,
		})
	}

	// top IPs
	type ipRow struct {
		IP       string
		Requests int64
	}
	var ipRows []ipRow
	db.Table("logs").
		Select("ip, COUNT(*) as requests").
		Where("user_id = ? AND created_at >= ? AND created_at <= ? AND type IN ? AND ip IS NOT NULL AND ip <> ''", userID, startTime, now, []int{models.LogTypeConsume, models.LogTypeFailure}).
		Group("ip").
		Order("requests DESC").
		Limit(10).
		Scan(&ipRows)

	topIPs := make([]map[string]interface{}, 0, len(ipRows))
	for _, ip := range ipRows {
		topIPs = append(topIPs, map[string]interface{}{
			"ip":       ip.IP,
			"requests": ip.Requests,
		})
	}

	// 计算风险指标
	windowMinutes := float64(windowSeconds) / 60
	requestsPerMinute := float64(0)
	if windowMinutes > 0 {
		requestsPerMinute = float64(summary.TotalRequests) / windowMinutes
	}
	avgQuotaPerRequest := float64(0)
	if summary.TotalRequests > 0 {
		avgQuotaPerRequest = float64(summary.QuotaUsed) / float64(summary.TotalRequests)
	}

	// 风险标记
	riskFlags := []string{}
	if requestsPerMinute > 10 {
		riskFlags = append(riskFlags, "high_rpm")
	}
	if summary.UniqueIPs > 20 {
		riskFlags = append(riskFlags, "many_ips")
	}
	failureRate := float64(0)
	if summary.TotalRequests > 0 {
		failureRate = float64(summary.FailureRequests) / float64(summary.TotalRequests)
	}
	if failureRate > 0.5 {
		riskFlags = append(riskFlags, "high_failure_rate")
	}

	// IP 切换分析
	ipSwitchAnalysis := s.analyzeIPSwitchesInWindow(userID, startTime, now)

	// recent logs
	type logRow struct {
		ID               int
		CreatedAt        int64
		Type             int
		ModelName        string
		Quota            int64
		PromptTokens     int64
		CompletionTokens int64
		UseTime          float64
		IP               string
		ChannelID        int
		TokenName        string
	}
	var logRows []logRow
	db.Table("logs").
		Select("id, created_at, type, model_name, quota, prompt_tokens, completion_tokens, use_time, ip, channel_id, COALESCE(token_name, '') as token_name").
		Where("user_id = ? AND created_at >= ? AND created_at <= ? AND type IN ?", userID, startTime, now, []int{models.LogTypeConsume, models.LogTypeFailure}).
		Order("created_at DESC").
		Limit(10).
		Scan(&logRows)

	recentLogs := make([]map[string]interface{}, 0, len(logRows))
	for _, l := range logRows {
		recentLogs = append(recentLogs, map[string]interface{}{
			"id":                l.ID,
			"created_at":        l.CreatedAt,
			"type":              l.Type,
			"model_name":        l.ModelName,
			"quota":             l.Quota,
			"prompt_tokens":     l.PromptTokens,
			"completion_tokens": l.CompletionTokens,
			"use_time":          l.UseTime,
			"ip":                l.IP,
			"channel_name":      fmt.Sprintf("Channel #%d", l.ChannelID),
			"token_name":        l.TokenName,
		})
	}

	return map[string]interface{}{
		"user": map[string]interface{}{
			"id":           user.ID,
			"username":     user.Username,
			"display_name": user.DisplayName,
			"email":        user.Email,
			"status":       user.Status,
			"group":        user.Group,
			"linux_do_id":  user.LinuxDoID,
		},
		"summary": map[string]interface{}{
			"total_requests":    summary.TotalRequests,
			"success_requests":  summary.SuccessRequests,
			"failure_requests":  summary.FailureRequests,
			"quota_used":        summary.QuotaUsed,
			"prompt_tokens":     summary.PromptTokens,
			"completion_tokens": summary.CompletionTokens,
			"avg_use_time":      summary.AvgUseTime,
			"unique_ips":        summary.UniqueIPs,
			"unique_tokens":     summary.UniqueTokens,
			"unique_models":     summary.UniqueModels,
			"unique_channels":   summary.UniqueChannels,
			"empty_count":       summary.EmptyCount,
			"empty_rate": func() float64 {
				if summary.SuccessRequests == 0 {
					return 0
				}
				return float64(summary.EmptyCount) / float64(summary.SuccessRequests)
			}(),
			"failure_rate": failureRate,
		},
		"risk": map[string]interface{}{
			"requests_per_minute":   requestsPerMinute,
			"avg_quota_per_request": avgQuotaPerRequest,
			"risk_flags":            riskFlags,
			"ip_switch_analysis":    ipSwitchAnalysis,
		},
		"top_models":  topModels,
		"top_ips":     topIPs,
		"recent_logs": recentLogs,
	}, nil
}

// analyzeIPSwitchesInWindow 分析指定时间窗口内的 IP 切换行为
func (s *RiskService) analyzeIPSwitchesInWindow(userID int, startTime, endTime int64) *IPSwitchAnalysis {
	db := database.GetMainDB()

	var logs []struct {
		IP        string
		CreatedAt int64
	}

	db.Table("logs").
		Select("ip, created_at").
		Where("user_id = ? AND created_at >= ? AND created_at <= ? AND ip != ''", userID, startTime, endTime).
		Order("created_at ASC").
		Limit(500).
		Scan(&logs)

	if len(logs) < 2 {
		return &IPSwitchAnalysis{
			Switches:      []IPSwitchDetail{},
			SwitchDetails: []IPSwitchDetail{},
		}
	}

	analysis := &IPSwitchAnalysis{
		SwitchDetails: []IPSwitchDetail{},
	}

	var switches []IPSwitchDetail
	prevIP := logs[0].IP
	ipStartTime := logs[0].CreatedAt // IP 段开始时间
	totalDuration := int64(0)
	ipCount := 0

	for i := 1; i < len(logs); i++ {
		currentIP := logs[i].IP
		currentTime := logs[i].CreatedAt

		if currentIP != prevIP {
			analysis.SwitchCount++
			duration := currentTime - ipStartTime // 该 IP 段的停留时间
			totalDuration += duration
			ipCount++

			fromVersion := string(geoip.GetIPVersion(prevIP))
			toVersion := string(geoip.GetIPVersion(currentIP))
			isDualStack := geoip.IsDualStackPair(prevIP, currentIP)

			if isDualStack {
				analysis.DualStackSwitches++
				analysis.HasDualStack = true
			} else {
				analysis.RealSwitchCount++
			}

			if duration < 300 {
				analysis.RapidSwitchCount++
			}

			switches = append(switches, IPSwitchDetail{
				Timestamp:       time.Unix(currentTime, 0).Format("2006-01-02 15:04:05"),
				FromIP:          prevIP,
				ToIP:            currentIP,
				IsDualStack:     isDualStack,
				IntervalSeconds: duration,
				FromVersion:     fromVersion,
				ToVersion:       toVersion,
			})

			ipStartTime = currentTime // 新 IP 段开始
		}

		prevIP = currentIP
	}

	if ipCount > 0 {
		analysis.AvgIPDuration = int(totalDuration / int64(ipCount))
	}

	if len(switches) > 20 {
		sort.Slice(switches, func(i, j int) bool {
			return switches[i].Timestamp > switches[j].Timestamp
		})
		switches = switches[:20]
	}
	analysis.SwitchDetails = switches
	analysis.Switches = switches // 兼容旧字段

	return analysis
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

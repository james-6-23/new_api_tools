package service

import (
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/models"
	"github.com/ketches/new-api-tools/pkg/geoip"
)

// IPService IP 监控服务
type IPService struct{}

// NewIPService 创建 IP 监控服务
func NewIPService() *IPService {
	return &IPService{}
}

// IPStats IP 统计
type IPStats struct {
	TotalUniqueIPs    int64           `json:"total_unique_ips"`
	TodayUniqueIPs    int64           `json:"today_unique_ips"`
	HourUniqueIPs     int64           `json:"hour_unique_ips"`
	TopCountries      []CountryStat   `json:"top_countries"`
	TopContinents     []ContinentStat `json:"top_continents"`
	SuspiciousIPCount int64           `json:"suspicious_ip_count"`
	PrivateIPCount    int64           `json:"private_ip_count"`
}

// CountryStat 国家统计
type CountryStat struct {
	Country     string  `json:"country"`
	CountryCode string  `json:"country_code"`
	Count       int64   `json:"count"`
	Percentage  float64 `json:"percentage"`
}

// ContinentStat 大洲统计
type ContinentStat struct {
	Continent  string  `json:"continent"`
	Count      int64   `json:"count"`
	Percentage float64 `json:"percentage"`
}

// SharedIPInfo 共享 IP 信息
type SharedIPInfo struct {
	IP         string                   `json:"ip"`
	UserCount  int                      `json:"user_count"`
	Users      []map[string]interface{} `json:"users"`
	GeoInfo    *geoip.GeoInfo           `json:"geo_info"`
	TotalReqs  int64                    `json:"total_requests"`
	LastActive string                   `json:"last_active"`
}

// MultiIPTokenInfo 多 IP 令牌信息
type MultiIPTokenInfo struct {
	TokenID   int      `json:"token_id"`
	TokenName string   `json:"token_name"`
	UserID    int      `json:"user_id"`
	Username  string   `json:"username"`
	IPCount   int      `json:"ip_count"`
	IPs       []string `json:"ips"`
	Requests  int64    `json:"requests"`
	RiskLevel string   `json:"risk_level"`
}

// MultiIPUserInfo 多 IP 用户信息
type MultiIPUserInfo struct {
	UserID    int      `json:"user_id"`
	Username  string   `json:"username"`
	IPCount   int      `json:"ip_count"`
	IPs       []string `json:"ips"`
	Countries []string `json:"countries"`
	Requests  int64    `json:"requests"`
	RiskScore float64  `json:"risk_score"`
}

// IPGeoResult IP 地理信息结果
type IPGeoResult struct {
	IP          string `json:"ip"`
	Country     string `json:"country"`
	CountryCode string `json:"country_code"`
	Continent   string `json:"continent"`
	IsValid     bool   `json:"is_valid"`
	IsPrivate   bool   `json:"is_private"`
}

// GetIPStats 获取 IP 统计
func (s *IPService) GetIPStats() (*IPStats, error) {
	cacheKey := cache.CacheKey("ip", "stats")

	var data IPStats
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 2 * time.Minute,
	}

	err := wrapper.GetOrSet(&data, func() (interface{}, error) {
		return s.fetchIPStats()
	})

	return &data, err
}

// fetchIPStats 获取 IP 统计数据
func (s *IPService) fetchIPStats() (*IPStats, error) {
	db := database.GetMainDB()
	data := &IPStats{
		TopCountries:  []CountryStat{},
		TopContinents: []ContinentStat{},
	}

	// 总唯一 IP 数
	db.Model(&models.Log{}).
		Distinct("ip").
		Count(&data.TotalUniqueIPs)

	// 今日唯一 IP 数
	today := time.Now().Format("2006-01-02") + " 00:00:00"
	db.Model(&models.Log{}).
		Where("created_at >= ?", today).
		Distinct("ip").
		Count(&data.TodayUniqueIPs)

	// 最近一小时唯一 IP 数
	hourAgo := time.Now().Add(-1 * time.Hour).Format("2006-01-02 15:04:05")
	db.Model(&models.Log{}).
		Where("created_at >= ?", hourAgo).
		Distinct("ip").
		Count(&data.HourUniqueIPs)

	// 获取今日 Top IPs 并分析地理分布
	var topIPs []struct {
		IP    string
		Count int64
	}
	db.Model(&models.Log{}).
		Select("ip, COUNT(*) as count").
		Where("created_at >= ?", today).
		Group("ip").
		Order("count DESC").
		Limit(100).
		Scan(&topIPs)

	// 统计国家分布
	countryMap := make(map[string]int64)
	continentMap := make(map[string]int64)
	var totalCount int64

	for _, ipInfo := range topIPs {
		geo := geoip.Lookup(ipInfo.IP)
		if geo.IsValid {
			if geo.CountryCode == "LAN" {
				data.PrivateIPCount++
			} else {
				countryMap[geo.Country] += ipInfo.Count
				continentMap[geo.Continent] += ipInfo.Count
				totalCount += ipInfo.Count
			}
		}
	}

	// 转换为排序后的列表
	for country, count := range countryMap {
		percentage := float64(0)
		if totalCount > 0 {
			percentage = float64(count) / float64(totalCount) * 100
		}
		data.TopCountries = append(data.TopCountries, CountryStat{
			Country:    country,
			Count:      count,
			Percentage: percentage,
		})
	}

	for continent, count := range continentMap {
		percentage := float64(0)
		if totalCount > 0 {
			percentage = float64(count) / float64(totalCount) * 100
		}
		data.TopContinents = append(data.TopContinents, ContinentStat{
			Continent:  continent,
			Count:      count,
			Percentage: percentage,
		})
	}

	return data, nil
}

// GetSharedIPs 获取共享 IP（多用户使用同一 IP）
func (s *IPService) GetSharedIPs(minUsers int, limit int) ([]SharedIPInfo, error) {
	db := database.GetMainDB()

	if minUsers <= 0 {
		minUsers = 2
	}
	if limit <= 0 {
		limit = 50
	}

	// 查找被多个用户使用的 IP
	var results []struct {
		IP        string
		UserCount int
		TotalReqs int64
		LastAt    time.Time
	}

	db.Model(&models.Log{}).
		Select("ip, COUNT(DISTINCT user_id) as user_count, COUNT(*) as total_reqs, MAX(created_at) as last_at").
		Group("ip").
		Having("user_count >= ?", minUsers).
		Order("user_count DESC").
		Limit(limit).
		Scan(&results)

	sharedIPs := make([]SharedIPInfo, len(results))
	for i, r := range results {
		// 获取该 IP 下的用户列表
		var users []struct {
			UserID   int
			Username string
			Requests int64
		}
		db.Table("logs").
			Select("logs.user_id, users.username, COUNT(*) as requests").
			Joins("LEFT JOIN users ON logs.user_id = users.id").
			Where("logs.ip = ?", r.IP).
			Group("logs.user_id, users.username").
			Order("requests DESC").
			Limit(10).
			Scan(&users)

		userList := make([]map[string]interface{}, len(users))
		for j, u := range users {
			userList[j] = map[string]interface{}{
				"user_id":  u.UserID,
				"username": u.Username,
				"requests": u.Requests,
			}
		}

		sharedIPs[i] = SharedIPInfo{
			IP:         r.IP,
			UserCount:  r.UserCount,
			Users:      userList,
			GeoInfo:    geoip.Lookup(r.IP),
			TotalReqs:  r.TotalReqs,
			LastActive: r.LastAt.Format("2006-01-02 15:04:05"),
		}
	}

	return sharedIPs, nil
}

// GetMultiIPTokens 获取多 IP 令牌（一个令牌被多个 IP 使用）
func (s *IPService) GetMultiIPTokens(minIPs int, limit int) ([]MultiIPTokenInfo, error) {
	db := database.GetMainDB()

	if minIPs <= 0 {
		minIPs = 5
	}
	if limit <= 0 {
		limit = 50
	}

	// 查找被多个 IP 使用的令牌
	var results []struct {
		TokenID   int
		TokenName string
		UserID    int
		Username  string
		IPCount   int
		Requests  int64
	}

	db.Table("logs").
		Select(`
			logs.token_id,
			tokens.name as token_name,
			logs.user_id,
			users.username,
			COUNT(DISTINCT logs.ip) as ip_count,
			COUNT(*) as requests
		`).
		Joins("LEFT JOIN tokens ON logs.token_id = tokens.id").
		Joins("LEFT JOIN users ON logs.user_id = users.id").
		Where("logs.token_id > 0").
		Group("logs.token_id, tokens.name, logs.user_id, users.username").
		Having("ip_count >= ?", minIPs).
		Order("ip_count DESC").
		Limit(limit).
		Scan(&results)

	tokens := make([]MultiIPTokenInfo, len(results))
	for i, r := range results {
		// 获取该令牌使用的 IP 列表
		var ips []string
		db.Model(&models.Log{}).
			Where("token_id = ?", r.TokenID).
			Distinct("ip").
			Limit(20).
			Pluck("ip", &ips)

		// 计算风险等级
		riskLevel := "low"
		if r.IPCount >= 20 {
			riskLevel = "high"
		} else if r.IPCount >= 10 {
			riskLevel = "medium"
		}

		tokens[i] = MultiIPTokenInfo{
			TokenID:   r.TokenID,
			TokenName: r.TokenName,
			UserID:    r.UserID,
			Username:  r.Username,
			IPCount:   r.IPCount,
			IPs:       ips,
			Requests:  r.Requests,
			RiskLevel: riskLevel,
		}
	}

	return tokens, nil
}

// GetMultiIPUsers 获取多 IP 用户
func (s *IPService) GetMultiIPUsers(minIPs int, limit int) ([]MultiIPUserInfo, error) {
	db := database.GetMainDB()

	if minIPs <= 0 {
		minIPs = 10
	}
	if limit <= 0 {
		limit = 50
	}

	today := time.Now().Format("2006-01-02") + " 00:00:00"

	// 查找今日使用多个 IP 的用户
	var results []struct {
		UserID   int
		Username string
		IPCount  int
		Requests int64
	}

	db.Table("logs").
		Select(`
			logs.user_id,
			users.username,
			COUNT(DISTINCT logs.ip) as ip_count,
			COUNT(*) as requests
		`).
		Joins("LEFT JOIN users ON logs.user_id = users.id").
		Where("logs.created_at >= ?", today).
		Group("logs.user_id, users.username").
		Having("ip_count >= ?", minIPs).
		Order("ip_count DESC").
		Limit(limit).
		Scan(&results)

	users := make([]MultiIPUserInfo, len(results))
	for i, r := range results {
		// 获取该用户使用的 IP 列表
		var ips []string
		db.Model(&models.Log{}).
			Where("user_id = ? AND created_at >= ?", r.UserID, today).
			Distinct("ip").
			Limit(30).
			Pluck("ip", &ips)

		// 获取国家分布
		countrySet := make(map[string]bool)
		for _, ip := range ips {
			geo := geoip.Lookup(ip)
			if geo.IsValid && geo.CountryCode != "LAN" {
				countrySet[geo.Country] = true
			}
		}
		countries := make([]string, 0, len(countrySet))
		for country := range countrySet {
			countries = append(countries, country)
		}

		// 计算风险分数
		riskScore := float64(r.IPCount) * 2
		if len(countries) > 3 {
			riskScore += float64(len(countries)) * 10
		}

		users[i] = MultiIPUserInfo{
			UserID:    r.UserID,
			Username:  r.Username,
			IPCount:   r.IPCount,
			IPs:       ips,
			Countries: countries,
			Requests:  r.Requests,
			RiskScore: riskScore,
		}
	}

	return users, nil
}

// GetIPGeo 获取单个 IP 地理信息
func (s *IPService) GetIPGeo(ip string) *IPGeoResult {
	geo := geoip.Lookup(ip)

	return &IPGeoResult{
		IP:          geo.IP,
		Country:     geo.Country,
		CountryCode: geo.CountryCode,
		Continent:   geo.Continent,
		IsValid:     geo.IsValid,
		IsPrivate:   geo.CountryCode == "LAN",
	}
}

// BatchGetIPGeo 批量获取 IP 地理信息
func (s *IPService) BatchGetIPGeo(ips []string) map[string]*IPGeoResult {
	results := make(map[string]*IPGeoResult)

	geoResults := geoip.BatchLookup(ips)
	for ip, geo := range geoResults {
		results[ip] = &IPGeoResult{
			IP:          geo.IP,
			Country:     geo.Country,
			CountryCode: geo.CountryCode,
			Continent:   geo.Continent,
			IsValid:     geo.IsValid,
			IsPrivate:   geo.CountryCode == "LAN",
		}
	}

	return results
}

// GetIPAccessHistory 获取 IP 访问历史
func (s *IPService) GetIPAccessHistory(ip string, limit int) ([]map[string]interface{}, error) {
	db := database.GetMainDB()

	if limit <= 0 {
		limit = 100
	}

	var results []struct {
		UserID    int
		Username  string
		TokenID   int
		TokenName string
		Model     string
		Quota     int64
		CreatedAt time.Time
	}

	db.Table("logs").
		Select(`
			logs.user_id,
			users.username,
			logs.token_id,
			tokens.name as token_name,
			logs.model,
			logs.quota,
			logs.created_at
		`).
		Joins("LEFT JOIN users ON logs.user_id = users.id").
		Joins("LEFT JOIN tokens ON logs.token_id = tokens.id").
		Where("logs.ip = ?", ip).
		Order("logs.created_at DESC").
		Limit(limit).
		Scan(&results)

	history := make([]map[string]interface{}, len(results))
	for i, r := range results {
		history[i] = map[string]interface{}{
			"user_id":    r.UserID,
			"username":   r.Username,
			"token_id":   r.TokenID,
			"token_name": r.TokenName,
			"model":      r.Model,
			"quota":      r.Quota,
			"created_at": r.CreatedAt.Format("2006-01-02 15:04:05"),
		}
	}

	return history, nil
}

// GetSuspiciousIPs 获取可疑 IP（高频请求、多用户共享等）
func (s *IPService) GetSuspiciousIPs(limit int) ([]map[string]interface{}, error) {
	db := database.GetMainDB()

	if limit <= 0 {
		limit = 50
	}

	hourAgo := time.Now().Add(-1 * time.Hour).Format("2006-01-02 15:04:05")

	// 查找过去一小时内高频请求的 IP
	var results []struct {
		IP        string
		UserCount int
		Requests  int64
	}

	db.Model(&models.Log{}).
		Select("ip, COUNT(DISTINCT user_id) as user_count, COUNT(*) as requests").
		Where("created_at >= ?", hourAgo).
		Group("ip").
		Having("requests > 1000 OR user_count > 3").
		Order("requests DESC").
		Limit(limit).
		Scan(&results)

	suspicious := make([]map[string]interface{}, len(results))
	for i, r := range results {
		geo := geoip.Lookup(r.IP)

		reason := []string{}
		if r.Requests > 1000 {
			reason = append(reason, "高频请求")
		}
		if r.UserCount > 3 {
			reason = append(reason, "多用户共享")
		}

		suspicious[i] = map[string]interface{}{
			"ip":         r.IP,
			"user_count": r.UserCount,
			"requests":   r.Requests,
			"geo_info":   geo,
			"reasons":    reason,
		}
	}

	return suspicious, nil
}

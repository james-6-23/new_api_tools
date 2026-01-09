package service

import (
	"fmt"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/models"
	"github.com/ketches/new-api-tools/pkg/geoip"
	"gorm.io/gorm"
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

	// 今日唯一 IP 数（Unix 时间戳）
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	db.Model(&models.Log{}).
		Where("created_at >= ?", todayStart).
		Distinct("ip").
		Count(&data.TodayUniqueIPs)

	// 最近一小时唯一 IP 数
	hourAgo := now.Add(-1 * time.Hour).Unix()
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
		Where("created_at >= ?", todayStart).
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
// windowSeconds: 时间窗口（秒），0 表示不限制时间
func (s *IPService) GetSharedIPs(minUsers int, limit int, windowSeconds int64) ([]SharedIPInfo, error) {
	db := database.GetMainDB()

	if minUsers <= 0 {
		minUsers = 2
	}
	if limit <= 0 {
		limit = 50
	}

	// 计算时间窗口
	var startTime int64
	if windowSeconds > 0 {
		startTime = time.Now().Add(-time.Duration(windowSeconds) * time.Second).Unix()
	}

	// 查找被多个用户使用的 IP
	var results []struct {
		IP        string
		UserCount int
		TotalReqs int64
		LastAt    int64
	}

	query := db.Model(&models.Log{}).
		Select("ip, COUNT(DISTINCT user_id) as user_count, COUNT(*) as total_reqs, MAX(created_at) as last_at")

	if startTime > 0 {
		query = query.Where("created_at >= ?", startTime)
	}

	query.Group("ip").
		Having("user_count >= ?", minUsers).
		Order("user_count DESC").
		Limit(limit).
		Scan(&results)

	sharedIPs := make([]SharedIPInfo, len(results))
	for i, r := range results {
		// 获取该 IP 下的用户列表（应用相同的时间窗口过滤）
		var users []struct {
			UserID   int
			Username string
			Requests int64
		}
		userQuery := db.Table("logs").
			Select("logs.user_id, users.username, COUNT(*) as requests").
			Joins("LEFT JOIN users ON logs.user_id = users.id").
			Where("logs.ip = ?", r.IP)

		// 应用相同的时间窗口过滤
		if startTime > 0 {
			userQuery = userQuery.Where("logs.created_at >= ?", startTime)
		}

		userQuery.Group("logs.user_id, users.username").
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
			LastActive: time.Unix(r.LastAt, 0).Format("2006-01-02 15:04:05"),
		}
	}

	return sharedIPs, nil
}

// GetMultiIPTokens 获取多 IP 令牌（一个令牌被多个 IP 使用）
// windowSeconds: 时间窗口（秒），0 表示不限制时间
func (s *IPService) GetMultiIPTokens(minIPs int, limit int, windowSeconds int64) ([]MultiIPTokenInfo, error) {
	db := database.GetMainDB()

	if minIPs <= 0 {
		minIPs = 5
	}
	if limit <= 0 {
		limit = 50
	}

	// 计算时间窗口
	var startTime int64
	if windowSeconds > 0 {
		startTime = time.Now().Add(-time.Duration(windowSeconds) * time.Second).Unix()
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

	query := db.Table("logs").
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
		Where("logs.token_id > 0")

	if startTime > 0 {
		query = query.Where("logs.created_at >= ?", startTime)
	}

	query.Group("logs.token_id, tokens.name, logs.user_id, users.username").
		Having("ip_count >= ?", minIPs).
		Order("ip_count DESC").
		Limit(limit).
		Scan(&results)

	tokens := make([]MultiIPTokenInfo, len(results))
	for i, r := range results {
		// 获取该令牌使用的 IP 列表（应用相同的时间窗口过滤）
		var ips []string
		ipQuery := db.Model(&models.Log{}).
			Where("token_id = ?", r.TokenID)

		// 应用相同的时间窗口过滤
		if startTime > 0 {
			ipQuery = ipQuery.Where("created_at >= ?", startTime)
		}

		ipQuery.Distinct("ip").
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
// windowSeconds: 时间窗口（秒），0 表示使用今日
func (s *IPService) GetMultiIPUsers(minIPs int, limit int, windowSeconds int64) ([]MultiIPUserInfo, error) {
	db := database.GetMainDB()

	if minIPs <= 0 {
		minIPs = 10
	}
	if limit <= 0 {
		limit = 50
	}

	// 计算时间窗口
	var startTime int64
	if windowSeconds > 0 {
		startTime = time.Now().Add(-time.Duration(windowSeconds) * time.Second).Unix()
	} else {
		// 默认使用今日
		now := time.Now()
		startTime = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	}

	// 查找指定时间窗口内使用多个 IP 的用户
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
		Where("logs.created_at >= ?", startTime).
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
			Where("user_id = ? AND created_at >= ?", r.UserID, startTime).
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
		CreatedAt int64
	}

	db.Table("logs").
		Select(`
			logs.user_id,
			users.username,
			logs.token_id,
			tokens.name as token_name,
			logs.model_name as model,
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
			"created_at": time.Unix(r.CreatedAt, 0).Format("2006-01-02 15:04:05"),
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

	hourAgo := time.Now().Add(-1 * time.Hour).Unix()

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

// UserIPInfo 用户 IP 信息
type UserIPInfo struct {
	IP         string                 `json:"ip"`
	Requests   int64                  `json:"requests"`
	LastActive string                 `json:"last_active"`
	GeoInfo    map[string]interface{} `json:"geo_info"`
}

// GetUserIPs 获取用户在时间窗口内的唯一 IP 列表（与 Python /api/ip/users/{user_id}/ips 对齐）
func (s *IPService) GetUserIPs(userID int, limit int, windowSeconds int64) ([]string, error) {
	db := database.GetMainDB()

	if limit <= 0 {
		limit = 100
	}
	if windowSeconds <= 0 {
		windowSeconds = 24 * 3600
	}

	since := time.Now().Unix() - windowSeconds

	var ips []string
	if err := db.Model(&models.Log{}).
		Select("ip").
		Where("user_id = ? AND created_at >= ? AND ip IS NOT NULL AND ip <> ''", userID, since).
		Group("ip").
		Order("COUNT(*) DESC").
		Limit(limit).
		Pluck("ip", &ips).Error; err != nil {
		return nil, err
	}

	return ips, nil
}

type IndexStatus struct {
	Indexes  map[string]map[string]interface{} `json:"indexes"`
	Total    int                               `json:"total"`
	Existing int                               `json:"existing"`
	Missing  int                               `json:"missing"`
	AllReady bool                              `json:"all_ready"`
}

var ipRecommendedIndexes = []struct {
	name    string
	table   string
	columns string
}{
	{"idx_logs_user_created_ip", "logs", "user_id, created_at, ip"},
	{"idx_logs_created_token_ip", "logs", "created_at, token_id, ip"},
	{"idx_logs_created_ip_token", "logs", "created_at, ip, token_id"},
}

// GetIndexStatus 获取 IP 监控推荐索引状态
func (s *IPService) GetIndexStatus() (*IndexStatus, error) {
	db := database.GetMainDB()
	dialect := db.Dialector.Name()

	status := &IndexStatus{
		Indexes: map[string]map[string]interface{}{},
		Total:   len(ipRecommendedIndexes),
	}

	for _, idx := range ipRecommendedIndexes {
		exists, err := indexExists(db, dialect, idx.table, idx.name)
		entry := map[string]interface{}{"exists": exists, "table": idx.table}
		if err != nil {
			entry["exists"] = false
			entry["error"] = true
		}
		status.Indexes[idx.name] = entry
		if exists {
			status.Existing++
		} else {
			status.Missing++
		}
	}

	status.AllReady = status.Missing == 0
	return status, nil
}

// EnsureIndexes 确保 IP 监控推荐索引存在，返回每个索引是否新建
func (s *IPService) EnsureIndexes() (map[string]bool, int, int, error) {
	db := database.GetMainDB()
	dialect := db.Dialector.Name()

	results := make(map[string]bool, len(ipRecommendedIndexes))
	created := 0
	existing := 0

	for _, idx := range ipRecommendedIndexes {
		exists, err := indexExists(db, dialect, idx.table, idx.name)
		if err == nil && exists {
			results[idx.name] = false
			existing++
			continue
		}

		if err := createIndex(db, dialect, idx.table, idx.name, idx.columns); err != nil {
			return nil, 0, 0, err
		}

		results[idx.name] = true
		created++
	}

	return results, created, existing, nil
}

func indexExists(db *gorm.DB, dialect string, tableName string, indexName string) (bool, error) {
	switch dialect {
	case "postgres":
		var count int64
		if err := db.Raw(
			"SELECT COUNT(1) FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ?",
			indexName,
		).Scan(&count).Error; err != nil {
			return false, err
		}
		return count > 0, nil
	case "sqlite":
		var count int64
		if err := db.Raw(
			fmt.Sprintf("SELECT COUNT(1) FROM pragma_index_list('%s') WHERE name = ?", tableName),
			indexName,
		).Scan(&count).Error; err != nil {
			return false, err
		}
		return count > 0, nil
	default: // mysql / mariadb
		var count int64
		if err := db.Raw(
			`SELECT COUNT(1) FROM information_schema.statistics
			 WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
			tableName, indexName,
		).Scan(&count).Error; err != nil {
			return false, err
		}
		return count > 0, nil
	}
}

func createIndex(db *gorm.DB, dialect string, tableName string, indexName string, columns string) error {
	switch dialect {
	case "postgres":
		return db.Exec(fmt.Sprintf(`CREATE INDEX IF NOT EXISTS "%s" ON %s (%s)`, indexName, tableName, columns)).Error
	case "sqlite":
		return db.Exec(fmt.Sprintf(`CREATE INDEX IF NOT EXISTS "%s" ON %s (%s)`, indexName, tableName, columns)).Error
	default:
		return db.Exec(fmt.Sprintf("CREATE INDEX %s ON %s (%s)", indexName, tableName, columns)).Error
	}
}

// EnableAllIPRecordingResult 批量开启 IP 记录结果
type EnableAllIPRecordingResult struct {
	UpdatedCount int64 `json:"updated_count"`
	SkippedCount int64 `json:"skipped_count"`
	TotalUsers   int64 `json:"total_users"`
}

// EnableAllIPRecording 为所有用户开启 IP 记录
// 更新 users 表的 setting 字段，添加 record_ip_log: true
func (s *IPService) EnableAllIPRecording() (*EnableAllIPRecordingResult, error) {
	db := database.GetMainDB()
	dialect := db.Dialector.Name()

	result := &EnableAllIPRecordingResult{}

	// 统计总用户数
	if err := db.Model(&models.User{}).Where("deleted_at IS NULL").Count(&result.TotalUsers).Error; err != nil {
		return nil, fmt.Errorf("统计总用户数失败: %w", err)
	}

	// 更新未开启的用户
	// 对于无效 JSON 的行，重置为包含 record_ip_log 的新对象
	var totalUpdated int64
	if dialect == "postgres" {
		// PostgreSQL: 分两步处理以避免无效 JSON 导致整个批量更新失败
		// 第一步：将无效 JSON 或空值重置为默认值
		step1Result := db.Exec(`
			UPDATE users
			SET setting = '{"record_ip_log": true}'
			WHERE deleted_at IS NULL
				AND (setting IS NULL OR setting = '' OR setting !~ '^\s*\{.*\}\s*$')
		`)
		if step1Result.Error == nil {
			totalUpdated += step1Result.RowsAffected
		}

		// 第二步：更新有效 JSON 但未开启 record_ip_log 的用户
		step2Result := db.Exec(`
			UPDATE users
			SET setting = (setting::jsonb || '{"record_ip_log": true}'::jsonb)::text
			WHERE deleted_at IS NULL
				AND setting IS NOT NULL AND setting <> '' AND setting ~ '^\s*\{.*\}\s*$'
				AND ((setting::jsonb->>'record_ip_log') IS NULL OR (setting::jsonb->>'record_ip_log') <> 'true')
		`)
		if step2Result.Error != nil {
			return nil, fmt.Errorf("批量更新用户设置失败: %w", step2Result.Error)
		}
		totalUpdated += step2Result.RowsAffected
	} else {
		// MySQL: 使用 JSON_VALID 检查，无效的直接替换
		updateResult := db.Exec(`
			UPDATE users
			SET setting = CASE
				WHEN setting IS NULL OR setting = '' OR NOT JSON_VALID(setting) THEN '{"record_ip_log": true}'
				ELSE JSON_SET(setting, '$.record_ip_log', true)
			END
			WHERE deleted_at IS NULL
				AND (setting IS NULL
					OR setting = ''
					OR NOT JSON_VALID(setting)
					OR JSON_EXTRACT(setting, '$.record_ip_log') IS NULL
					OR JSON_EXTRACT(setting, '$.record_ip_log') <> true)
		`)
		if updateResult.Error != nil {
			return nil, fmt.Errorf("批量更新用户设置失败: %w", updateResult.Error)
		}
		totalUpdated = updateResult.RowsAffected
	}

	// 使用实际更新的行数
	result.UpdatedCount = totalUpdated
	result.SkippedCount = result.TotalUsers - result.UpdatedCount

	return result, nil
}

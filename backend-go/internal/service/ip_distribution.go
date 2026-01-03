package service

import (
	"fmt"
	"sort"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/ketches/new-api-tools/internal/models"
	"github.com/ketches/new-api-tools/pkg/geoip"
	"go.uber.org/zap"
)

// IPDistributionService IP 分布统计服务
type IPDistributionService struct{}

// NewIPDistributionService 创建 IP 分布服务
func NewIPDistributionService() *IPDistributionService {
	return &IPDistributionService{}
}

// 时间窗口映射（秒）
var windowSeconds = map[string]int64{
	"1h":  3600,
	"6h":  6 * 3600,
	"24h": 24 * 3600,
	"7d":  7 * 24 * 3600,
}

// 缓存 TTL（秒）
var cacheTTL = map[string]time.Duration{
	"1h":  5 * time.Minute,
	"6h":  10 * time.Minute,
	"24h": 30 * time.Minute,
	"7d":  1 * time.Hour,
}

// 国内地区代码
var domesticCountryCodes = map[string]bool{
	"CN": true,
	"HK": true,
	"MO": true,
	"TW": true,
}

// IPDistributionResult IP 分布统计结果
type IPDistributionResult struct {
	TotalIPs           int                    `json:"total_ips"`
	TotalRequests      int64                  `json:"total_requests"`
	DomesticPercentage float64                `json:"domestic_percentage"`
	OverseasPercentage float64                `json:"overseas_percentage"`
	ByCountry          []CountryDistribution  `json:"by_country"`
	ByProvince         []ProvinceDistribution `json:"by_province"`
	TopCities          []CityDistribution     `json:"top_cities"`
	SnapshotTime       int64                  `json:"snapshot_time"`
}

// CountryDistribution 国家分布
type CountryDistribution struct {
	Country      string  `json:"country"`
	CountryCode  string  `json:"country_code"`
	IPCount      int     `json:"ip_count"`
	RequestCount int64   `json:"request_count"`
	UserCount    int     `json:"user_count"`
	Percentage   float64 `json:"percentage"`
}

// ProvinceDistribution 省份分布
type ProvinceDistribution struct {
	Country      string  `json:"country"`
	CountryCode  string  `json:"country_code"`
	Region       string  `json:"region"`
	IPCount      int     `json:"ip_count"`
	RequestCount int64   `json:"request_count"`
	UserCount    int     `json:"user_count"`
	Percentage   float64 `json:"percentage"`
}

// CityDistribution 城市分布
type CityDistribution struct {
	Country      string  `json:"country"`
	CountryCode  string  `json:"country_code"`
	Region       string  `json:"region"`
	City         string  `json:"city"`
	IPCount      int     `json:"ip_count"`
	RequestCount int64   `json:"request_count"`
	UserCount    int     `json:"user_count"`
	Percentage   float64 `json:"percentage"`
}

// ipStats IP 统计数据
type ipStats struct {
	RequestCount int64
	UserCount    int
}

// GetDistribution 获取 IP 分布统计
func (s *IPDistributionService) GetDistribution(window string) (*IPDistributionResult, error) {
	// 验证窗口参数
	if _, ok := windowSeconds[window]; !ok {
		window = "24h"
	}

	cacheKey := cache.CacheKey("ip_distribution", window)
	ttl := cacheTTL[window]

	var data IPDistributionResult
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: ttl,
	}

	err := wrapper.GetOrSet(&data, func() (interface{}, error) {
		return s.fetchDistribution(window)
	})

	return &data, err
}

// fetchDistribution 获取 IP 分布数据
func (s *IPDistributionService) fetchDistribution(window string) (*IPDistributionResult, error) {
	// 计算时间范围
	seconds := windowSeconds[window]
	startTime := time.Now().Unix() - seconds

	// 查询 IP 统计
	ipStatsMap, err := s.queryIPStats(startTime)
	if err != nil {
		return nil, err
	}

	if len(ipStatsMap) == 0 {
		return s.emptyResult(), nil
	}

	// 批量查询 IP 地理位置
	ips := make([]string, 0, len(ipStatsMap))
	for ip := range ipStatsMap {
		ips = append(ips, ip)
	}

	geoResults := geoip.BatchLookup(ips)

	// 聚合统计
	result := s.aggregateStats(ipStatsMap, geoResults)
	result.SnapshotTime = time.Now().Unix()

	logger.Info("IP 分布统计完成",
		zap.String("window", window),
		zap.Int("total_ips", result.TotalIPs),
		zap.Int64("total_requests", result.TotalRequests),
		zap.Int("countries", len(result.ByCountry)),
	)

	return result, nil
}

// queryIPStats 查询 IP 统计数据
func (s *IPDistributionService) queryIPStats(startTime int64) (map[string]*ipStats, error) {
	db := database.GetMainDB()

	var results []struct {
		IP           string
		RequestCount int64
		UserCount    int
	}

	// 查询 IP 统计，限制最多 3000 个 IP
	// 注意：数据库中 created_at 是 bigint (Unix 时间戳)
	err := db.Model(&models.Log{}).
		Select("ip, COUNT(*) as request_count, COUNT(DISTINCT user_id) as user_count").
		Where("created_at >= ? AND ip != '' AND ip IS NOT NULL AND type = ?", startTime, models.LogTypeConsume).
		Group("ip").
		Order("request_count DESC").
		Limit(3000).
		Scan(&results).Error

	if err != nil {
		return nil, fmt.Errorf("查询 IP 统计失败: %w", err)
	}

	// 转换为 map
	statsMap := make(map[string]*ipStats)
	for _, r := range results {
		if r.IP != "" {
			statsMap[r.IP] = &ipStats{
				RequestCount: r.RequestCount,
				UserCount:    r.UserCount,
			}
		}
	}

	return statsMap, nil
}

// aggregateStats 聚合统计数据
func (s *IPDistributionService) aggregateStats(ipStatsMap map[string]*ipStats, geoResults map[string]*geoip.GeoInfo) *IPDistributionResult {
	totalIPs := len(ipStatsMap)
	var totalRequests int64
	for _, stats := range ipStatsMap {
		totalRequests += stats.RequestCount
	}

	// 按国家聚合
	byCountry := make(map[string]*CountryDistribution)
	// 按省份聚合（仅中国）
	byProvince := make(map[string]*ProvinceDistribution)
	// 按城市聚合
	byCity := make(map[string]*CityDistribution)

	var domesticRequests, overseasRequests int64

	for ip, stats := range ipStatsMap {
		geo := geoResults[ip]

		var country, countryCode, region, city string
		if geo == nil || !geo.IsValid {
			country = "未知"
			countryCode = "XX"
		} else {
			country = geo.Country
			if country == "" {
				country = "未知"
			}
			countryCode = geo.CountryCode
			if countryCode == "" {
				countryCode = "XX"
			}
			// 注意：当前 GeoIP 使用 Country 数据库，没有 region 和 city
			// 如果需要更详细的地理信息，需要使用 City 数据库
		}

		reqCount := stats.RequestCount
		userCount := stats.UserCount

		// 国内/海外统计
		if domesticCountryCodes[countryCode] {
			domesticRequests += reqCount
		} else {
			overseasRequests += reqCount
		}

		// 按国家聚合
		if _, ok := byCountry[country]; !ok {
			byCountry[country] = &CountryDistribution{
				Country:     country,
				CountryCode: countryCode,
			}
		}
		byCountry[country].IPCount++
		byCountry[country].RequestCount += reqCount
		byCountry[country].UserCount += userCount

		// 按省份聚合（仅中国大陆且有省份信息）
		if countryCode == "CN" && region != "" {
			if _, ok := byProvince[region]; !ok {
				byProvince[region] = &ProvinceDistribution{
					Country:     country,
					CountryCode: countryCode,
					Region:      region,
				}
			}
			byProvince[region].IPCount++
			byProvince[region].RequestCount += reqCount
			byProvince[region].UserCount += userCount
		}

		// 按城市聚合
		if city != "" {
			cityKey := fmt.Sprintf("%s:%s:%s", country, region, city)
			if _, ok := byCity[cityKey]; !ok {
				byCity[cityKey] = &CityDistribution{
					Country:     country,
					CountryCode: countryCode,
					Region:      region,
					City:        city,
				}
			}
			byCity[cityKey].IPCount++
			byCity[cityKey].RequestCount += reqCount
			byCity[cityKey].UserCount += userCount
		}
	}

	// 转换为列表并计算百分比
	countryList := make([]CountryDistribution, 0, len(byCountry))
	for _, c := range byCountry {
		if totalRequests > 0 {
			c.Percentage = float64(c.RequestCount) / float64(totalRequests) * 100
		}
		countryList = append(countryList, *c)
	}
	sort.Slice(countryList, func(i, j int) bool {
		return countryList[i].RequestCount > countryList[j].RequestCount
	})
	if len(countryList) > 50 {
		countryList = countryList[:50]
	}

	provinceList := make([]ProvinceDistribution, 0, len(byProvince))
	for _, p := range byProvince {
		if totalRequests > 0 {
			p.Percentage = float64(p.RequestCount) / float64(totalRequests) * 100
		}
		provinceList = append(provinceList, *p)
	}
	sort.Slice(provinceList, func(i, j int) bool {
		return provinceList[i].RequestCount > provinceList[j].RequestCount
	})
	if len(provinceList) > 30 {
		provinceList = provinceList[:30]
	}

	cityList := make([]CityDistribution, 0, len(byCity))
	for _, c := range byCity {
		if totalRequests > 0 {
			c.Percentage = float64(c.RequestCount) / float64(totalRequests) * 100
		}
		cityList = append(cityList, *c)
	}
	sort.Slice(cityList, func(i, j int) bool {
		return cityList[i].RequestCount > cityList[j].RequestCount
	})
	if len(cityList) > 50 {
		cityList = cityList[:50]
	}

	// 计算国内/海外占比
	var domesticPct, overseasPct float64
	if totalRequests > 0 {
		domesticPct = float64(domesticRequests) / float64(totalRequests) * 100
		overseasPct = float64(overseasRequests) / float64(totalRequests) * 100
	}

	return &IPDistributionResult{
		TotalIPs:           totalIPs,
		TotalRequests:      totalRequests,
		DomesticPercentage: domesticPct,
		OverseasPercentage: overseasPct,
		ByCountry:          countryList,
		ByProvince:         provinceList,
		TopCities:          cityList,
	}
}

// emptyResult 返回空结果
func (s *IPDistributionService) emptyResult() *IPDistributionResult {
	return &IPDistributionResult{
		TotalIPs:           0,
		TotalRequests:      0,
		DomesticPercentage: 0,
		OverseasPercentage: 0,
		ByCountry:          []CountryDistribution{},
		ByProvince:         []ProvinceDistribution{},
		TopCities:          []CityDistribution{},
		SnapshotTime:       time.Now().Unix(),
	}
}

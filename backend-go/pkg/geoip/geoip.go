package geoip

import (
	"net"
	"sync"

	"github.com/ketches/new-api-tools/internal/config"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/oschwald/geoip2-golang"
	"go.uber.org/zap"
)

var (
	db   *geoip2.Reader
	once sync.Once
	mu   sync.RWMutex
)

// GeoInfo IP 地理信息
type GeoInfo struct {
	IP          string `json:"ip"`
	Country     string `json:"country"`
	CountryCode string `json:"country_code"`
	Continent   string `json:"continent"`
	IsValid     bool   `json:"is_valid"`
}

// Init 初始化 GeoIP 数据库
func Init() error {
	var initErr error
	once.Do(func() {
		cfg := config.Get()
		dbPath := cfg.GeoIP.DBPath

		if dbPath == "" {
			dbPath = "./data/GeoLite2-Country.mmdb"
		}

		reader, err := geoip2.Open(dbPath)
		if err != nil {
			logger.Warn("GeoIP 数据库加载失败，IP 地理查询将不可用",
				zap.String("path", dbPath),
				zap.Error(err))
			initErr = err
			return
		}

		mu.Lock()
		db = reader
		mu.Unlock()

		logger.Info("GeoIP 数据库加载成功", zap.String("path", dbPath))
	})

	return initErr
}

// Close 关闭 GeoIP 数据库
func Close() {
	mu.Lock()
	defer mu.Unlock()

	if db != nil {
		db.Close()
		db = nil
	}
}

// Lookup 查询 IP 地理信息
func Lookup(ipStr string) *GeoInfo {
	info := &GeoInfo{
		IP:      ipStr,
		IsValid: false,
	}

	// 解析 IP
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return info
	}

	// 检查是否为内网 IP
	if isPrivateIP(ip) {
		info.Country = "本地网络"
		info.CountryCode = "LAN"
		info.Continent = "Local"
		info.IsValid = true
		return info
	}

	mu.RLock()
	reader := db
	mu.RUnlock()

	if reader == nil {
		return info
	}

	// 查询 GeoIP
	record, err := reader.Country(ip)
	if err != nil {
		return info
	}

	info.Country = record.Country.Names["zh-CN"]
	if info.Country == "" {
		info.Country = record.Country.Names["en"]
	}
	info.CountryCode = record.Country.IsoCode
	info.Continent = record.Continent.Names["zh-CN"]
	if info.Continent == "" {
		info.Continent = record.Continent.Names["en"]
	}
	info.IsValid = true

	return info
}

// BatchLookup 批量查询 IP 地理信息
func BatchLookup(ips []string) map[string]*GeoInfo {
	results := make(map[string]*GeoInfo)

	for _, ip := range ips {
		results[ip] = Lookup(ip)
	}

	return results
}

// isPrivateIP 判断是否为内网 IP
func isPrivateIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}

	// 检查 RFC1918 私有地址
	privateBlocks := []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"169.254.0.0/16",
		"fc00::/7",
		"fe80::/10",
	}

	for _, block := range privateBlocks {
		_, cidr, err := net.ParseCIDR(block)
		if err == nil && cidr.Contains(ip) {
			return true
		}
	}

	return false
}

// IsAvailable 检查 GeoIP 服务是否可用
func IsAvailable() bool {
	mu.RLock()
	defer mu.RUnlock()
	return db != nil
}

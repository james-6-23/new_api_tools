package geoip

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"

	"github.com/ketches/new-api-tools/internal/config"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/oschwald/geoip2-golang"
	"go.uber.org/zap"
)

var (
	countryDB *geoip2.Reader
	asnDB     *geoip2.Reader
	cityDB    *geoip2.Reader
	mu        sync.RWMutex
	initOnce  sync.Once
)

// GeoInfo IP 地理信息
type GeoInfo struct {
	IP           string `json:"ip"`
	Country      string `json:"country"`
	CountryCode  string `json:"country_code"`
	Continent    string `json:"continent"`
	City         string `json:"city,omitempty"`
	ASN          uint   `json:"asn,omitempty"`
	Organization string `json:"organization,omitempty"`
	IsValid      bool   `json:"is_valid"`
}

// Init 初始化 GeoIP 数据库
func Init() error {
	var initErr error
	initOnce.Do(func() {
		initErr = loadDatabases()
	})
	return initErr
}

// loadDatabases 加载所有 GeoIP 数据库
func loadDatabases() error {
	cfg := config.Get()
	dbPath := cfg.GeoIP.DBPath

	if dbPath == "" {
		dbPath = "./data"
	}

	mu.Lock()
	defer mu.Unlock()

	// 加载 Country 数据库（必需）
	countryPath := filepath.Join(dbPath, "GeoLite2-Country.mmdb")
	if _, err := os.Stat(countryPath); err == nil {
		reader, err := geoip2.Open(countryPath)
		if err != nil {
			logger.Warn("GeoIP Country 数据库加载失败",
				zap.String("path", countryPath),
				zap.Error(err))
		} else {
			countryDB = reader
			logger.Info("GeoIP Country 数据库加载成功", zap.String("path", countryPath))
		}
	} else {
		// 尝试旧的单文件路径
		if reader, err := geoip2.Open(dbPath); err == nil {
			countryDB = reader
			logger.Info("GeoIP Country 数据库加载成功", zap.String("path", dbPath))
		} else {
			logger.Warn("GeoIP Country 数据库加载失败，IP 地理查询将不可用",
				zap.String("path", dbPath),
				zap.Error(err))
		}
	}

	// 加载 ASN 数据库（可选）
	asnPath := filepath.Join(dbPath, "GeoLite2-ASN.mmdb")
	if _, err := os.Stat(asnPath); err == nil {
		reader, err := geoip2.Open(asnPath)
		if err != nil {
			logger.Warn("GeoIP ASN 数据库加载失败",
				zap.String("path", asnPath),
				zap.Error(err))
		} else {
			asnDB = reader
			logger.Info("GeoIP ASN 数据库加载成功", zap.String("path", asnPath))
		}
	}

	// 加载 City 数据库（可选）
	cityPath := filepath.Join(dbPath, "GeoLite2-City.mmdb")
	if _, err := os.Stat(cityPath); err == nil {
		reader, err := geoip2.Open(cityPath)
		if err != nil {
			logger.Warn("GeoIP City 数据库加载失败",
				zap.String("path", cityPath),
				zap.Error(err))
		} else {
			cityDB = reader
			logger.Info("GeoIP City 数据库加载成功", zap.String("path", cityPath))
		}
	}

	return nil
}

// Reload 热重载 GeoIP 数据库
func Reload() error {
	mu.Lock()
	// 关闭旧的数据库
	if countryDB != nil {
		countryDB.Close()
		countryDB = nil
	}
	if asnDB != nil {
		asnDB.Close()
		asnDB = nil
	}
	if cityDB != nil {
		cityDB.Close()
		cityDB = nil
	}
	mu.Unlock()

	return loadDatabases()
}

// Close 关闭 GeoIP 数据库
func Close() {
	mu.Lock()
	defer mu.Unlock()

	if countryDB != nil {
		countryDB.Close()
		countryDB = nil
	}
	if asnDB != nil {
		asnDB.Close()
		asnDB = nil
	}
	if cityDB != nil {
		cityDB.Close()
		cityDB = nil
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
	country := countryDB
	asn := asnDB
	city := cityDB
	mu.RUnlock()

	if country == nil {
		return info
	}

	// 查询 Country
	record, err := country.Country(ip)
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

	// 查询 ASN（如果可用）
	if asn != nil {
		if asnRecord, err := asn.ASN(ip); err == nil {
			info.ASN = asnRecord.AutonomousSystemNumber
			info.Organization = asnRecord.AutonomousSystemOrganization
		}
	}

	// 查询 City（如果可用）
	if city != nil {
		if cityRecord, err := city.City(ip); err == nil {
			info.City = cityRecord.City.Names["zh-CN"]
			if info.City == "" {
				info.City = cityRecord.City.Names["en"]
			}
		}
	}

	return info
}

// LookupASN 仅查询 ASN 信息
func LookupASN(ipStr string) (uint, string) {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return 0, ""
	}

	if isPrivateIP(ip) {
		return 0, "Private Network"
	}

	mu.RLock()
	asn := asnDB
	mu.RUnlock()

	if asn == nil {
		return 0, ""
	}

	record, err := asn.ASN(ip)
	if err != nil {
		return 0, ""
	}

	return record.AutonomousSystemNumber, record.AutonomousSystemOrganization
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
	return countryDB != nil
}

// IsASNAvailable 检查 ASN 服务是否可用
func IsASNAvailable() bool {
	mu.RLock()
	defer mu.RUnlock()
	return asnDB != nil
}

// IsCityAvailable 检查 City 服务是否可用
func IsCityAvailable() bool {
	mu.RLock()
	defer mu.RUnlock()
	return cityDB != nil
}

// GetStatus 获取 GeoIP 服务状态
func GetStatus() map[string]bool {
	mu.RLock()
	defer mu.RUnlock()
	return map[string]bool{
		"country": countryDB != nil,
		"asn":     asnDB != nil,
		"city":    cityDB != nil,
	}
}

// IPVersion IP 版本类型
type IPVersion string

const (
	IPVersionV4      IPVersion = "v4"
	IPVersionV6      IPVersion = "v6"
	IPVersionUnknown IPVersion = "unknown"
)

// GetIPVersion 获取 IP 版本
func GetIPVersion(ipStr string) IPVersion {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return IPVersionUnknown
	}

	// 检查是否为 IPv4
	// net.ParseIP 对于 IPv4 会返回 16 字节格式（IPv4-mapped IPv6）
	// 使用 To4() 来检测是否为 IPv4
	if ip.To4() != nil {
		return IPVersionV4
	}

	// 如果不是 IPv4，则为 IPv6
	return IPVersionV6
}

// GetLocationKey 获取位置键（用于双栈识别）
// 格式: ASN:city:country_code
func (g *GeoInfo) GetLocationKey() string {
	if !g.IsValid {
		return ""
	}

	// 使用 ASN + 城市 + 国家代码作为位置标识
	city := g.City
	if city == "" {
		city = "unknown"
	}

	return fmt.Sprintf("%d:%s:%s", g.ASN, city, g.CountryCode)
}

// IsDualStackPair 检查两个 IP 是否为双栈对（同一位置的 IPv4/IPv6）
func IsDualStackPair(ip1, ip2 string) bool {
	v1 := GetIPVersion(ip1)
	v2 := GetIPVersion(ip2)

	// 必须是一个 v4 一个 v6
	if !((v1 == IPVersionV4 && v2 == IPVersionV6) || (v1 == IPVersionV6 && v2 == IPVersionV4)) {
		return false
	}

	// 查询地理信息
	geo1 := Lookup(ip1)
	geo2 := Lookup(ip2)

	// 两个都必须有效
	if !geo1.IsValid || !geo2.IsValid {
		return false
	}

	// 检查位置键是否相同
	return geo1.GetLocationKey() == geo2.GetLocationKey()
}

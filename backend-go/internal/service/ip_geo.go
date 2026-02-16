package service

import (
	"fmt"
	"net"
	"os"
	"sync"

	"github.com/oschwald/geoip2-golang"
)

// IPGeoInfo represents IP geolocation information
type IPGeoInfo struct {
	IP          string
	Country     string
	CountryCode string
	Region      string
	City        string
	Success     bool
}

// IPGeoService provides IP geolocation queries using MaxMind GeoLite2
type IPGeoService struct {
	cityReader *geoip2.Reader
	mu         sync.RWMutex
	available  bool
}

var (
	geoService     *IPGeoService
	geoServiceOnce sync.Once
)

// domesticCountryCodes defines Chinese domestic country codes
var domesticCountryCodes = map[string]bool{
	"CN": true,
	"HK": true,
	"MO": true,
	"TW": true,
}

// GetIPGeoService returns the singleton IPGeoService
func GetIPGeoService() *IPGeoService {
	geoServiceOnce.Do(func() {
		geoService = &IPGeoService{}
		geoService.init()
	})
	return geoService
}

func (s *IPGeoService) init() {
	// Try to find GeoLite2-City.mmdb in common paths
	paths := []string{
		os.Getenv("GEOIP_DATA_DIR") + "/GeoLite2-City.mmdb",
		"/app/data/geoip/GeoLite2-City.mmdb",
		"./data/geoip/GeoLite2-City.mmdb",
		"/usr/share/GeoIP/GeoLite2-City.mmdb",
	}

	for _, path := range paths {
		if path == "/GeoLite2-City.mmdb" {
			continue // skip empty GEOIP_DATA_DIR + path
		}
		if _, err := os.Stat(path); err == nil {
			reader, err := geoip2.Open(path)
			if err != nil {
				fmt.Printf("[GeoIP] Failed to open %s: %v\n", path, err)
				continue
			}
			s.cityReader = reader
			s.available = true
			fmt.Printf("[GeoIP] Loaded database: %s\n", path)
			return
		}
	}
	fmt.Println("[GeoIP] No GeoLite2-City.mmdb found, IP geolocation disabled")
}

// IsAvailable returns whether the GeoIP service is available
func (s *IPGeoService) IsAvailable() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.available
}

// QuerySingle looks up a single IP address
func (s *IPGeoService) QuerySingle(ip string) IPGeoInfo {
	result := IPGeoInfo{IP: ip}

	if !s.available || s.cityReader == nil {
		return result
	}

	parsedIP := net.ParseIP(ip)
	if parsedIP == nil {
		return result
	}

	// Skip private IPs
	if parsedIP.IsPrivate() || parsedIP.IsLoopback() {
		result.Country = "本地网络"
		result.CountryCode = "LO"
		result.Success = true
		return result
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	record, err := s.cityReader.City(parsedIP)
	if err != nil {
		return result
	}

	result.Success = true

	// Country
	if name, ok := record.Country.Names["zh-CN"]; ok {
		result.Country = name
	} else if name, ok := record.Country.Names["en"]; ok {
		result.Country = name
	}
	result.CountryCode = record.Country.IsoCode

	// Region/Province
	if len(record.Subdivisions) > 0 {
		if name, ok := record.Subdivisions[0].Names["zh-CN"]; ok {
			result.Region = name
		} else if name, ok := record.Subdivisions[0].Names["en"]; ok {
			result.Region = name
		}
	}

	// City
	if name, ok := record.City.Names["zh-CN"]; ok {
		result.City = name
	} else if name, ok := record.City.Names["en"]; ok {
		result.City = name
	}

	return result
}

// QueryBatch looks up multiple IPs and returns a map of IP -> IPGeoInfo
func (s *IPGeoService) QueryBatch(ips []string) map[string]IPGeoInfo {
	results := make(map[string]IPGeoInfo, len(ips))
	for _, ip := range ips {
		results[ip] = s.QuerySingle(ip)
	}
	return results
}

// Close releases the GeoIP database resources
func (s *IPGeoService) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cityReader != nil {
		s.cityReader.Close()
		s.cityReader = nil
		s.available = false
	}
}

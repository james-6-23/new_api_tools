package service

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

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

// GeoIP database download URLs (multiple mirrors for reliability)
var geoipDownloadURLs = []string{
	"https://raw.githubusercontent.com/adysec/IP_database/main/geolite/GeoLite2-City.mmdb",
	"https://raw.gitmirror.com/adysec/IP_database/main/geolite/GeoLite2-City.mmdb",
	"https://cdn.jsdelivr.net/gh/adysec/IP_database@main/geolite/GeoLite2-City.mmdb",
}

// geoipUpdateInterval is the interval between automatic database updates (24 hours)
const geoipUpdateInterval = 24 * time.Hour

// geoipMinFileSize is the minimum valid database file size (1 MB)
const geoipMinFileSize = 1024 * 1024

// IPGeoService provides IP geolocation queries using MaxMind GeoLite2
type IPGeoService struct {
	cityReader *geoip2.Reader
	dbPath     string
	mu         sync.RWMutex
	available  bool
	stopCh     chan struct{}
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
	s.stopCh = make(chan struct{})

	// Determine the preferred database directory
	geoipDir := os.Getenv("GEOIP_DATA_DIR")
	if geoipDir == "" {
		geoipDir = "/app/data/geoip"
	}

	// Try to find GeoLite2-City.mmdb in common paths
	paths := []string{
		filepath.Join(geoipDir, "GeoLite2-City.mmdb"),
		"/app/data/geoip/GeoLite2-City.mmdb",
		"./data/geoip/GeoLite2-City.mmdb",
		"/usr/share/GeoIP/GeoLite2-City.mmdb",
	}

	for _, path := range paths {
		if path == "/GeoLite2-City.mmdb" || path == "" {
			continue
		}
		if _, err := os.Stat(path); err == nil {
			reader, err := geoip2.Open(path)
			if err != nil {
				fmt.Printf("[GeoIP] Failed to open %s: %v\n", path, err)
				continue
			}
			s.cityReader = reader
			s.dbPath = path
			s.available = true
			fmt.Printf("[GeoIP] Loaded database: %s\n", path)
			// Start background updater
			go s.backgroundUpdater()
			return
		}
	}

	// Database not found — try to download it
	fmt.Println("[GeoIP] No GeoLite2-City.mmdb found, attempting auto-download...")
	downloadPath := filepath.Join(geoipDir, "GeoLite2-City.mmdb")
	if err := s.downloadDatabase(downloadPath); err != nil {
		fmt.Printf("[GeoIP] Auto-download failed: %v\n", err)
		fmt.Println("[GeoIP] IP geolocation disabled. Will retry in background.")
		s.dbPath = downloadPath
		// Start background updater which will keep retrying
		go s.backgroundUpdater()
		return
	}

	// Load the downloaded database
	reader, err := geoip2.Open(downloadPath)
	if err != nil {
		fmt.Printf("[GeoIP] Failed to open downloaded database: %v\n", err)
		return
	}
	s.cityReader = reader
	s.dbPath = downloadPath
	s.available = true
	fmt.Printf("[GeoIP] Database downloaded and loaded: %s\n", downloadPath)

	// Start background updater
	go s.backgroundUpdater()
}

// downloadDatabase downloads the GeoLite2-City.mmdb file from mirror URLs
func (s *IPGeoService) downloadDatabase(destPath string) error {
	// Ensure directory exists
	dir := filepath.Dir(destPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create directory %s: %w", dir, err)
	}

	tempPath := destPath + ".tmp"
	defer os.Remove(tempPath) // clean up temp file on any failure

	client := &http.Client{Timeout: 120 * time.Second}

	for _, url := range geoipDownloadURLs {
		fmt.Printf("[GeoIP] Downloading from %s ...\n", url)

		resp, err := client.Get(url)
		if err != nil {
			fmt.Printf("[GeoIP] Download failed from %s: %v\n", url, err)
			continue
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			fmt.Printf("[GeoIP] Download failed from %s: HTTP %d\n", url, resp.StatusCode)
			continue
		}

		out, err := os.Create(tempPath)
		if err != nil {
			resp.Body.Close()
			return fmt.Errorf("create temp file: %w", err)
		}

		written, err := io.Copy(out, resp.Body)
		out.Close()
		resp.Body.Close()

		if err != nil {
			fmt.Printf("[GeoIP] Download write failed from %s: %v\n", url, err)
			os.Remove(tempPath)
			continue
		}

		// Validate file size
		if written < geoipMinFileSize {
			fmt.Printf("[GeoIP] Downloaded file too small (%d bytes), skipping\n", written)
			os.Remove(tempPath)
			continue
		}

		// Validate it's a valid mmdb by trying to open it
		testReader, err := geoip2.Open(tempPath)
		if err != nil {
			fmt.Printf("[GeoIP] Downloaded file is not valid mmdb: %v\n", err)
			os.Remove(tempPath)
			continue
		}
		testReader.Close()

		// Atomically replace the old file
		if err := os.Rename(tempPath, destPath); err != nil {
			return fmt.Errorf("rename %s -> %s: %w", tempPath, destPath, err)
		}

		sizeMB := float64(written) / (1024 * 1024)
		fmt.Printf("[GeoIP] Download complete: %.1f MB\n", sizeMB)
		return nil
	}

	return fmt.Errorf("all download mirrors failed")
}

// backgroundUpdater periodically checks and updates the GeoIP database
func (s *IPGeoService) backgroundUpdater() {
	// First check: if database is not available, retry download after 5 minutes
	if !s.IsAvailable() {
		select {
		case <-time.After(5 * time.Minute):
		case <-s.stopCh:
			return
		}
		s.tryUpdateDatabase()
	}

	ticker := time.NewTicker(geoipUpdateInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.tryUpdateDatabase()
		case <-s.stopCh:
			return
		}
	}
}

// tryUpdateDatabase attempts to download and reload the GeoIP database
func (s *IPGeoService) tryUpdateDatabase() {
	if s.dbPath == "" {
		return
	}

	// Check if the existing database is fresh enough
	if info, err := os.Stat(s.dbPath); err == nil {
		age := time.Since(info.ModTime())
		if age < geoipUpdateInterval {
			return // database is fresh, skip update
		}
	}

	fmt.Println("[GeoIP] Checking for database update...")

	if err := s.downloadDatabase(s.dbPath); err != nil {
		fmt.Printf("[GeoIP] Update failed: %v\n", err)
		return
	}

	// Reload the database
	newReader, err := geoip2.Open(s.dbPath)
	if err != nil {
		fmt.Printf("[GeoIP] Failed to reload updated database: %v\n", err)
		return
	}

	s.mu.Lock()
	oldReader := s.cityReader
	s.cityReader = newReader
	s.available = true
	s.mu.Unlock()

	if oldReader != nil {
		oldReader.Close()
	}

	fmt.Println("[GeoIP] Database updated and reloaded successfully")
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

// Close releases the GeoIP database resources and stops the background updater
func (s *IPGeoService) Close() {
	// Stop background updater
	if s.stopCh != nil {
		select {
		case <-s.stopCh:
			// already closed
		default:
			close(s.stopCh)
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cityReader != nil {
		s.cityReader.Close()
		s.cityReader = nil
		s.available = false
	}
}

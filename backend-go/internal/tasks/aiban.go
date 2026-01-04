package tasks

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/ketches/new-api-tools/internal/config"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/ketches/new-api-tools/internal/service"
	"github.com/ketches/new-api-tools/pkg/geoip"
	"go.uber.org/zap"
)

// AIBanScanTask AI 自动封禁扫描任务
// 定时扫描可疑用户并进行风险评估
func AIBanScanTask(ctx context.Context) error {
	aiBanService := service.NewAIBanService()

	// 检查 AI 封禁是否启用
	cfg, err := aiBanService.GetConfig()
	if err != nil {
		return err
	}

	if !cfg.Enabled {
		logger.Debug("AI 自动封禁未启用，跳过扫描")
		return nil
	}

	// 执行扫描
	result, err := aiBanService.ScanUsers()
	if err != nil {
		return err
	}

	logger.Info("AI 自动封禁扫描完成",
		zap.Int("scanned", result.ScannedUsers),
		zap.Int("suspicious", result.SuspiciousCount),
		zap.Int("banned", result.AutoBannedCount))

	return nil
}

// GeoIPDatabase GeoIP 数据库信息
type GeoIPDatabase struct {
	Name     string   // 数据库名称
	Filename string   // 本地文件名
	URLs     []string // 下载 URL 列表
	MinSize  int64    // 最小文件大小（字节）
	Required bool     // 是否必需
}

// GeoIP 数据库列表
var geoIPDatabases = []GeoIPDatabase{
	{
		Name:     "Country",
		Filename: "GeoLite2-Country.mmdb",
		URLs: []string{
			"https://raw.githubusercontent.com/adysec/IP_database/main/geolite/GeoLite2-Country.mmdb",
			"https://raw.gitmirror.com/adysec/IP_database/main/geolite/GeoLite2-Country.mmdb",
		},
		MinSize:  1024 * 1024, // 1MB
		Required: true,
	},
	{
		Name:     "ASN",
		Filename: "GeoLite2-ASN.mmdb",
		URLs: []string{
			"https://raw.githubusercontent.com/adysec/IP_database/main/geolite/GeoLite2-ASN.mmdb",
			"https://raw.gitmirror.com/adysec/IP_database/main/geolite/GeoLite2-ASN.mmdb",
		},
		MinSize:  5 * 1024 * 1024, // 5MB
		Required: false,
	},
	{
		Name:     "City",
		Filename: "GeoLite2-City.mmdb",
		URLs: []string{
			"https://raw.githubusercontent.com/adysec/IP_database/main/geolite/GeoLite2-City.mmdb",
			"https://raw.gitmirror.com/adysec/IP_database/main/geolite/GeoLite2-City.mmdb",
		},
		MinSize:  30 * 1024 * 1024, // 30MB
		Required: false,
	},
}

// GeoIPUpdateTask GeoIP 数据库更新任务
// 每天检查并更新 GeoIP 数据库
func GeoIPUpdateTask(ctx context.Context) error {
	cfg := config.Get()
	dbPath := cfg.GeoIP.DBPath
	if dbPath == "" {
		dbPath = "./data"
	}

	// 确保目录存在
	if err := os.MkdirAll(dbPath, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %w", err)
	}

	updated := false
	client := &http.Client{Timeout: 5 * time.Minute}

	for _, db := range geoIPDatabases {
		fullPath := filepath.Join(dbPath, db.Filename)

		// 检查是否需要更新
		needsUpdate := false
		info, err := os.Stat(fullPath)
		if err != nil {
			if os.IsNotExist(err) {
				if db.Required {
					logger.Info("GeoIP 数据库不存在，需要下载",
						zap.String("db", db.Name))
					needsUpdate = true
				} else {
					logger.Debug("GeoIP 可选数据库不存在，尝试下载",
						zap.String("db", db.Name))
					needsUpdate = true
				}
			} else {
				logger.Warn("检查 GeoIP 数据库失败",
					zap.String("db", db.Name),
					zap.Error(err))
				continue
			}
		} else if time.Since(info.ModTime()) >= 7*24*time.Hour {
			logger.Info("GeoIP 数据库已过期，需要更新",
				zap.String("db", db.Name),
				zap.Time("modified", info.ModTime()))
			needsUpdate = true
		}

		if !needsUpdate {
			continue
		}

		// 下载数据库
		if err := downloadGeoIPFile(ctx, client, db, fullPath); err != nil {
			if db.Required {
				logger.Error("下载必需的 GeoIP 数据库失败",
					zap.String("db", db.Name),
					zap.Error(err))
			} else {
				logger.Warn("下载可选的 GeoIP 数据库失败",
					zap.String("db", db.Name),
					zap.Error(err))
			}
			continue
		}

		updated = true
		logger.Info("GeoIP 数据库更新完成",
			zap.String("db", db.Name),
			zap.String("path", fullPath))
	}

	// 如果有更新，热重载 GeoIP 数据库
	if updated {
		if err := geoip.Reload(); err != nil {
			logger.Warn("重新加载 GeoIP 数据库失败", zap.Error(err))
		} else {
			logger.Info("GeoIP 数据库热重载完成")
		}
	}

	return nil
}

// downloadGeoIPFile 下载单个 GeoIP 数据库文件
func downloadGeoIPFile(ctx context.Context, client *http.Client, db GeoIPDatabase, destPath string) error {
	for _, url := range db.URLs {
		urlShort := url
		if len(url) > 60 {
			urlShort = url[:60] + "..."
		}

		logger.Info("正在下载 GeoIP 数据库",
			zap.String("db", db.Name),
			zap.String("url", urlShort))

		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			logger.Warn("创建请求失败", zap.Error(err))
			continue
		}

		resp, err := client.Do(req)
		if err != nil {
			logger.Warn("下载失败",
				zap.String("db", db.Name),
				zap.Error(err))
			continue
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			logger.Warn("下载失败",
				zap.String("db", db.Name),
				zap.Int("status", resp.StatusCode))
			continue
		}

		// 写入临时文件
		tmpPath := destPath + ".tmp"
		tmpFile, err := os.Create(tmpPath)
		if err != nil {
			resp.Body.Close()
			logger.Warn("创建临时文件失败", zap.Error(err))
			continue
		}

		written, err := io.Copy(tmpFile, resp.Body)
		tmpFile.Close()
		resp.Body.Close()

		if err != nil {
			os.Remove(tmpPath)
			logger.Warn("写入文件失败", zap.Error(err))
			continue
		}

		// 验证文件大小
		if written < db.MinSize {
			os.Remove(tmpPath)
			logger.Warn("文件太小，可能下载不完整",
				zap.String("db", db.Name),
				zap.Int64("size", written),
				zap.Int64("min_size", db.MinSize))
			continue
		}

		// 替换旧文件
		if err := os.Rename(tmpPath, destPath); err != nil {
			os.Remove(tmpPath)
			logger.Warn("替换文件失败", zap.Error(err))
			continue
		}

		logger.Info("GeoIP 数据库下载完成",
			zap.String("db", db.Name),
			zap.String("path", destPath),
			zap.Float64("size_mb", float64(written)/1024/1024))

		return nil
	}

	return fmt.Errorf("所有下载源都失败: %s", db.Name)
}

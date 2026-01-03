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

// GeoIPUpdateTask GeoIP 数据库更新任务
// 每天检查并更新 GeoIP 数据库
func GeoIPUpdateTask(ctx context.Context) error {
	cfg := config.Get()
	dbPath := cfg.GeoIP.DBPath
	if dbPath == "" {
		dbPath = "./data/GeoLite2-Country.mmdb"
	}

	// 检查数据库文件是否存在
	info, err := os.Stat(dbPath)
	if err != nil {
		if os.IsNotExist(err) {
			logger.Info("GeoIP 数据库不存在，尝试下载")
			return downloadGeoIPDatabase(ctx, dbPath)
		}
		return err
	}

	// 检查文件是否超过 7 天
	if time.Since(info.ModTime()) < 7*24*time.Hour {
		logger.Debug("GeoIP 数据库较新，无需更新",
			zap.Time("modified", info.ModTime()))
		return nil
	}

	logger.Info("GeoIP 数据库已过期，尝试更新",
		zap.Time("modified", info.ModTime()))

	return downloadGeoIPDatabase(ctx, dbPath)
}

// GeoIP 免费下载源（无需 License Key）
var geoIPDownloadURLs = []string{
	"https://raw.githubusercontent.com/adysec/IP_database/main/geolite/GeoLite2-Country.mmdb",
	"https://raw.gitmirror.com/adysec/IP_database/main/geolite/GeoLite2-Country.mmdb",
}

// downloadGeoIPDatabase 下载 GeoIP 数据库
func downloadGeoIPDatabase(ctx context.Context, dbPath string) error {
	// 确保目录存在
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		return fmt.Errorf("创建目录失败: %w", err)
	}

	client := &http.Client{Timeout: 2 * time.Minute}

	// 尝试从多个源下载
	for _, url := range geoIPDownloadURLs {
		logger.Info("正在下载 GeoIP 数据库", zap.String("url", url[:50]+"..."))

		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			logger.Warn("创建请求失败", zap.Error(err))
			continue
		}

		resp, err := client.Do(req)
		if err != nil {
			logger.Warn("下载失败", zap.String("url", url[:50]+"..."), zap.Error(err))
			continue
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			logger.Warn("下载失败", zap.String("url", url[:50]+"..."), zap.Int("status", resp.StatusCode))
			continue
		}

		// 写入临时文件
		tmpPath := dbPath + ".tmp"
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

		// 验证文件大小（至少 1MB）
		if written < 1024*1024 {
			os.Remove(tmpPath)
			logger.Warn("文件太小，可能下载不完整", zap.Int64("size", written))
			continue
		}

		// 替换旧文件
		if err := os.Rename(tmpPath, dbPath); err != nil {
			os.Remove(tmpPath)
			logger.Warn("替换文件失败", zap.Error(err))
			continue
		}

		logger.Info("GeoIP 数据库下载完成",
			zap.String("path", dbPath),
			zap.Float64("size_mb", float64(written)/1024/1024))

		// 重新加载 GeoIP 数据库
		if err := geoip.Init(); err != nil {
			logger.Warn("重新加载 GeoIP 数据库失败", zap.Error(err))
		}

		return nil
	}

	return fmt.Errorf("所有下载源都失败")
}

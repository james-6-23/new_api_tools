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

// downloadGeoIPDatabase 下载 GeoIP 数据库
func downloadGeoIPDatabase(ctx context.Context, dbPath string) error {
	cfg := config.Get()

	// 检查是否配置了 License Key
	if cfg.GeoIP.LicenseKey == "" {
		logger.Warn("未配置 GeoIP License Key，无法自动更新")
		return nil
	}

	// 构建下载 URL
	downloadURL := fmt.Sprintf(
		"https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country&license_key=%s&suffix=tar.gz",
		cfg.GeoIP.LicenseKey,
	)

	// 创建临时文件
	tmpFile, err := os.CreateTemp("", "geoip-*.tar.gz")
	if err != nil {
		return fmt.Errorf("创建临时文件失败: %w", err)
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	// 下载文件
	req, err := http.NewRequestWithContext(ctx, "GET", downloadURL, nil)
	if err != nil {
		return fmt.Errorf("创建请求失败: %w", err)
	}

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("下载失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载失败: HTTP %d", resp.StatusCode)
	}

	// 写入临时文件
	if _, err := io.Copy(tmpFile, resp.Body); err != nil {
		return fmt.Errorf("写入临时文件失败: %w", err)
	}

	// 确保目录存在
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		return fmt.Errorf("创建目录失败: %w", err)
	}

	// 解压并移动文件（简化处理，实际需要解压 tar.gz）
	// 这里假设下载的是直接的 mmdb 文件
	logger.Info("GeoIP 数据库下载完成，需要手动解压")

	// 重新加载 GeoIP 数据库
	if err := geoip.Init(); err != nil {
		logger.Warn("重新加载 GeoIP 数据库失败", zap.Error(err))
	}

	return nil
}

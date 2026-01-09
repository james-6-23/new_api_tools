package tasks

import (
	"time"

	"github.com/ketches/new-api-tools/internal/logger"
)

// InitTasks 初始化所有后台任务
// 任务分为两类：
// 1. 启动时立即执行的任务（使用 Register）
// 2. 预热完成后才启动的任务（使用 StartAfterWarmup）
func InitTasks() {
	manager := GetManager()

	logger.Info("初始化后台任务...")

	// ==================== 启动时立即执行的任务 ====================

	// 1. 缓存预热任务（启动时立即执行，之后每 24 小时执行一次）
	// 这是最重要的任务，负责预热所有缓存数据
	manager.Register("cache_warmup", 24*time.Hour, CacheWarmupTask)

	// 2. 索引创建任务（启动时执行一次，之后每 24 小时检查）
	// 确保数据库索引存在，提高查询性能
	manager.Register("index_ensure", 24*time.Hour, IndexEnsureTask)

	// 3. IP 记录强制开启任务（每 30 分钟）
	// 防止用户关闭 IP 记录导致风控数据缺失
	manager.Register("ip_recording_enforce", 30*time.Minute, IPRecordingEnforceTask)

	// 4. GeoIP 数据库更新任务（每 24 小时）
	// 自动下载和更新 GeoIP 数据库
	manager.Register("geoip_update", 24*time.Hour, GeoIPUpdateTask)

	// 5. 过期缓存清理任务（每 1 小时）
	// 清理 SQLite 中过期的缓存数据
	manager.Register("cache_cleanup", 1*time.Hour, CacheCleanupTask)

	// ==================== 预热完成后启动的任务 ====================

	// 6. 缓存刷新任务（预热完成后启动，每 5 分钟）
	// 定时刷新热点数据，保持缓存新鲜
	manager.StartAfterWarmup("cache_refresh", 5*time.Minute, CacheRefreshTask)

	// 7. 日志同步任务（预热完成后启动，每 5 分钟）
	// 处理新日志，更新统计数据
	manager.StartAfterWarmup("log_sync", 5*time.Minute, LogSyncTask)

	// 8. AI 自动封禁扫描任务（预热完成后启动，间隔由配置决定）
	// 定时扫描可疑用户并进行风险评估
	manager.StartAfterWarmup("ai_ban_scan", 10*time.Minute, AIBanScanTask)

	// 9. 模型状态刷新任务（预热完成后启动，每 30 分钟）
	// 刷新模型列表和状态缓存
	manager.StartAfterWarmup("model_status_refresh", 30*time.Minute, ModelStatusRefreshTask)

	logger.Info("后台任务初始化完成")
}

package tasks

import (
	"time"
)

// InitTasks 初始化所有后台任务
func InitTasks() {
	manager := GetManager()

	// 1. 缓存预热任务（启动时立即执行一次）
	manager.Register("cache_warmup", 24*time.Hour, CacheWarmupTask)

	// 2. 索引创建任务（启动时执行一次）
	manager.Register("index_ensure", 24*time.Hour, IndexEnsureTask)

	// 3. IP 记录强制开启任务（每 30 分钟）
	manager.Register("ip_recording_enforce", 30*time.Minute, IPRecordingEnforceTask)

	// 4. GeoIP 数据库更新任务（每天）
	manager.Register("geoip_update", 24*time.Hour, GeoIPUpdateTask)

	// 5. 缓存刷新任务（预热完成后启动，每 5 分钟）
	manager.StartAfterWarmup("cache_refresh", 5*time.Minute, CacheRefreshTask)

	// 6. 日志同步任务（预热完成后启动，每 5 分钟）
	manager.StartAfterWarmup("log_sync", 5*time.Minute, LogSyncTask)

	// 7. AI 自动封禁扫描任务（预热完成后启动，每 10 分钟）
	manager.StartAfterWarmup("ai_ban_scan", 10*time.Minute, AIBanScanTask)
}

package tasks

import (
	"context"
	"sync"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/ketches/new-api-tools/internal/service"
	"go.uber.org/zap"
)

// WarmupStatus 预热状态
type WarmupStatus struct {
	Status      string       `json:"status"`       // pending, initializing, ready
	Phase       string       `json:"phase"`        // 当前阶段
	Progress    int          `json:"progress"`     // 总体进度 0-100
	Total       int          `json:"total"`        // 当前阶段总项目数
	StartTime   time.Time    `json:"start_time"`   // 开始时间
	CompletedAt *time.Time   `json:"completed_at"` // 完成时间
	CurrentTask string       `json:"current_task"` // 当前任务
	Message     string       `json:"message"`      // 状态消息
	Steps       []WarmupStep `json:"steps"`        // 预热步骤
	Completed   bool         `json:"completed"`    // 是否完成
}

// WarmupStep 预热步骤
type WarmupStep struct {
	Name   string `json:"name"`
	Status string `json:"status"` // pending, done, error
}

var (
	warmupStatus = &WarmupStatus{
		Status:  "pending",
		Message: "等待启动...",
		Steps: []WarmupStep{
			{Name: "恢复缓存", Status: "pending"},
			{Name: "检查缓存有效性", Status: "pending"},
			{Name: "预热排行榜数据", Status: "pending"},
			{Name: "预热 Dashboard", Status: "pending"},
			{Name: "预热用户活跃度", Status: "pending"},
			{Name: "预热 IP 监控", Status: "pending"},
			{Name: "预热 IP 分布", Status: "pending"},
			{Name: "预热模型状态", Status: "pending"},
		},
	}
	warmupMu sync.RWMutex
)

// GetWarmupStatus 获取预热状态
func GetWarmupStatus() *WarmupStatus {
	warmupMu.RLock()
	defer warmupMu.RUnlock()
	// 返回副本
	status := *warmupStatus
	steps := make([]WarmupStep, len(warmupStatus.Steps))
	copy(steps, warmupStatus.Steps)
	status.Steps = steps
	return &status
}

// updateWarmupStatus 更新预热状态
func updateWarmupStatus(status string, progress int, message string, phase string) {
	warmupMu.Lock()
	defer warmupMu.Unlock()
	warmupStatus.Status = status
	warmupStatus.Progress = progress
	warmupStatus.Message = message
	if phase != "" {
		warmupStatus.Phase = phase
	}
	if status == "initializing" && warmupStatus.StartTime.IsZero() {
		warmupStatus.StartTime = time.Now()
	}
	if status == "ready" {
		now := time.Now()
		warmupStatus.CompletedAt = &now
		warmupStatus.Completed = true
	}
}

// updateWarmupStep 更新预热步骤状态
func updateWarmupStep(index int, status string) {
	warmupMu.Lock()
	defer warmupMu.Unlock()
	if index >= 0 && index < len(warmupStatus.Steps) {
		warmupStatus.Steps[index].Status = status
	}
}

// CacheWarmupTask 缓存预热任务 - 多阶段渐进式预热
func CacheWarmupTask(ctx context.Context) error {
	warmupMu.Lock()
	warmupStatus.StartTime = time.Now()
	warmupStatus.Completed = false
	warmupStatus.CompletedAt = nil // 重置完成时间，避免后续运行时返回旧的完成时间
	warmupStatus.Status = "initializing"
	warmupStatus.Progress = 0
	warmupStatus.Message = "正在初始化..."
	warmupStatus.Phase = ""
	// 重置所有步骤状态
	for i := range warmupStatus.Steps {
		warmupStatus.Steps[i].Status = "pending"
	}
	warmupMu.Unlock()

	logger.Info("🚀 缓存预热任务启动")

	// 获取缓存管理器
	cacheManager := cache.GetCacheManager()

	// 阶段 1: 从 SQLite 恢复缓存到 Redis
	updateWarmupStatus("initializing", 5, "正在恢复缓存...", "restore")
	updateWarmupStep(0, "done")

	if cacheManager.IsRedisAvailable() {
		restored, _ := cacheManager.RestoreToRedis()
		if restored > 0 {
			logger.Info("从 SQLite 恢复缓存到 Redis", zap.Int("count", restored))
		}
	}

	// 阶段 2: 检查缓存有效性
	updateWarmupStatus("initializing", 10, "正在检查缓存有效性...", "check")
	updateWarmupStep(1, "done")

	// 阶段 3: 预热排行榜数据
	updateWarmupStatus("initializing", 15, "正在预热排行榜数据...", "leaderboard")
	if err := warmupLeaderboard(ctx); err != nil {
		logger.Error("排行榜预热失败", zap.Error(err))
		updateWarmupStep(2, "error")
	} else {
		updateWarmupStep(2, "done")
	}

	// 阶段 4: 预热 Dashboard 数据
	updateWarmupStatus("initializing", 40, "正在预热 Dashboard 数据...", "dashboard")
	if err := warmupDashboard(ctx); err != nil {
		logger.Error("Dashboard 预热失败", zap.Error(err))
		updateWarmupStep(3, "error")
	} else {
		updateWarmupStep(3, "done")
	}

	// 阶段 5: 预热用户活跃度（仅大型系统）
	updateWarmupStatus("initializing", 55, "正在预热用户活跃度...", "user_activity")
	if err := warmupUserActivity(ctx); err != nil {
		logger.Warn("用户活跃度预热失败", zap.Error(err))
		updateWarmupStep(4, "error")
	} else {
		updateWarmupStep(4, "done")
	}

	// 阶段 6: 预热 IP 监控数据
	updateWarmupStatus("initializing", 65, "正在预热 IP 监控数据...", "ip_monitoring")
	if err := warmupIPMonitoring(ctx); err != nil {
		logger.Error("IP 监控预热失败", zap.Error(err))
		updateWarmupStep(5, "error")
	} else {
		updateWarmupStep(5, "done")
	}

	// 阶段 7: 预热 IP 分布数据
	updateWarmupStatus("initializing", 80, "正在预热 IP 分布数据...", "ip_distribution")
	if err := warmupIPDistribution(ctx); err != nil {
		logger.Error("IP 分布预热失败", zap.Error(err))
		updateWarmupStep(6, "error")
	} else {
		updateWarmupStep(6, "done")
	}

	// 阶段 8: 预热模型状态
	updateWarmupStatus("initializing", 90, "正在预热模型状态...", "model_status")
	if err := warmupModelStatus(ctx); err != nil {
		logger.Warn("模型状态预热失败", zap.Error(err))
		updateWarmupStep(7, "error")
	} else {
		updateWarmupStep(7, "done")
	}

	// 完成
	elapsed := time.Since(warmupStatus.StartTime)
	updateWarmupStatus("ready", 100, "预热完成，耗时 "+elapsed.Round(time.Second).String(), "completed")

	logger.Info("✅ 缓存预热完成",
		zap.Duration("elapsed", elapsed))

	// 通知预热完成
	GetManager().SignalWarmupDone()

	return nil
}

// warmupDashboard 预热 Dashboard 数据
func warmupDashboard(ctx context.Context) error {
	dashboardService := service.NewDashboardService()

	// 预热项目列表（按前端加载顺序）
	items := []struct {
		name   string
		action func() error
	}{
		// 核心 Dashboard API
		{"overview_7d", func() error { _, err := dashboardService.GetOverview(); return err }},
		{"usage_7d", func() error { _, err := dashboardService.GetUsage("7d"); return err }},
		{"models_7d", func() error { _, err := dashboardService.GetModelUsage(8); return err }},
		{"daily_trends_7d", func() error { _, err := dashboardService.GetDailyTrends(7); return err }},
		{"top_users_7d", func() error { _, err := dashboardService.GetTopUsers(10, "requests"); return err }},
		// 其他时间周期
		{"usage_24h", func() error { _, err := dashboardService.GetUsage("24h"); return err }},
		{"hourly_trends_24h", func() error { _, err := dashboardService.GetHourlyTrends(24); return err }},
		// 3天周期
		{"usage_3d", func() error { _, err := dashboardService.GetUsage("3d"); return err }},
		{"daily_trends_3d", func() error { _, err := dashboardService.GetDailyTrends(3); return err }},
		// 渠道状态
		{"channels", func() error { _, err := dashboardService.GetChannelStatus(); return err }},
	}

	warmupMu.Lock()
	warmupStatus.Total = len(items)
	warmupMu.Unlock()

	successCount := 0
	for i, item := range items {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		warmupMu.Lock()
		warmupStatus.CurrentTask = item.name
		warmupStatus.Progress = 40 + (i * 15 / len(items)) // 40% -> 55%
		warmupMu.Unlock()

		start := time.Now()
		if err := item.action(); err != nil {
			logger.Warn("Dashboard 预热项失败",
				zap.String("item", item.name),
				zap.Error(err))
		} else {
			successCount++
			logger.Debug("Dashboard 预热项完成",
				zap.String("item", item.name),
				zap.Duration("elapsed", time.Since(start)))
		}
	}

	logger.Info("Dashboard 预热完成",
		zap.Int("success", successCount),
		zap.Int("total", len(items)))

	return nil
}

// warmupIPDistribution 预热 IP 分布数据
func warmupIPDistribution(ctx context.Context) error {
	ipService := service.NewIPDistributionService()

	windows := []string{"1h", "6h", "24h", "7d"}

	successCount := 0
	for _, window := range windows {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		start := time.Now()
		if _, err := ipService.GetDistribution(window); err != nil {
			logger.Warn("IP 分布预热失败",
				zap.String("window", window),
				zap.Error(err))
		} else {
			successCount++
			logger.Debug("IP 分布预热完成",
				zap.String("window", window),
				zap.Duration("elapsed", time.Since(start)))
		}
	}

	logger.Info("IP 分布预热完成",
		zap.Int("success", successCount),
		zap.Int("total", len(windows)))

	return nil
}

// warmupLeaderboard 预热排行榜数据
func warmupLeaderboard(ctx context.Context) error {
	riskService := service.NewRiskService()

	// 预热所有时间窗口
	periods := []string{"today", "week", "month"}

	successCount := 0
	for _, period := range periods {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		start := time.Now()
		if _, err := riskService.GetLeaderboards(period, 50); err != nil {
			logger.Warn("排行榜预热失败",
				zap.String("period", period),
				zap.Error(err))
		} else {
			successCount++
			logger.Debug("排行榜预热完成",
				zap.String("period", period),
				zap.Duration("elapsed", time.Since(start)))
		}

		// 延迟，避免数据库压力
		time.Sleep(500 * time.Millisecond)
	}

	logger.Info("排行榜预热完成",
		zap.Int("success", successCount),
		zap.Int("total", len(periods)))

	return nil
}

// warmupIPMonitoring 预热 IP 监控数据
func warmupIPMonitoring(ctx context.Context) error {
	ipService := service.NewIPService()

	// 预热多个时间窗口
	windows := []string{"1h", "24h", "7d"}
	types := []string{"shared_ips", "multi_ip_tokens", "multi_ip_users"}

	successCount := 0
	totalCount := len(windows) * len(types)

	for _, window := range windows {
		for _, monitorType := range types {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}

			start := time.Now()
			var err error

			switch monitorType {
			case "shared_ips":
				_, err = ipService.GetSharedIPs(2, 200)
			case "multi_ip_tokens":
				_, err = ipService.GetMultiIPTokens(2, 200)
			case "multi_ip_users":
				_, err = ipService.GetMultiIPUsers(3, 200)
			}

			if err != nil {
				logger.Warn("IP 监控预热失败",
					zap.String("type", monitorType),
					zap.String("window", window),
					zap.Error(err))
			} else {
				successCount++
				logger.Debug("IP 监控预热完成",
					zap.String("type", monitorType),
					zap.String("window", window),
					zap.Duration("elapsed", time.Since(start)))
			}
		}
	}

	// 预热 IP Stats
	if _, err := ipService.GetIPStats(); err != nil {
		logger.Warn("IP Stats 预热失败", zap.Error(err))
	} else {
		successCount++
		totalCount++
	}

	logger.Info("IP 监控预热完成",
		zap.Int("success", successCount),
		zap.Int("total", totalCount))

	return nil
}

func warmupUserActivity(ctx context.Context) error {
	// 检查系统规模
	systemService := service.NewSystemService()
	scaleResult, err := systemService.DetectScale(false)
	if err != nil {
		return err
	}

	// 只有大型/超大型系统才预热
	if scaleResult.Scale != "large" && scaleResult.Scale != "xlarge" {
		logger.Debug("用户活跃度预热：跳过（系统规模较小）",
			zap.String("scale", scaleResult.Scale))
		return nil
	}

	userService := service.NewUserService()

	// 预热不同排序方式的用户列表
	orderByOptions := []string{"quota", "used_quota", "request_count"}

	successCount := 0
	for _, orderBy := range orderByOptions {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		start := time.Now()
		query := &service.UserQuery{
			Page:     1,
			PageSize: 20,
			OrderBy:  orderBy,
		}

		if _, err := userService.GetUsers(query); err != nil {
			logger.Warn("用户列表预热失败",
				zap.String("order_by", orderBy),
				zap.Error(err))
		} else {
			successCount++
			logger.Debug("用户列表预热完成",
				zap.String("order_by", orderBy),
				zap.Duration("elapsed", time.Since(start)))
		}

		// 延迟
		time.Sleep(time.Second)
	}

	logger.Info("用户列表预热完成",
		zap.Int("success", successCount),
		zap.Int("total", len(orderByOptions)))

	return nil
}

// warmupModelStatus 预热模型状态数据
func warmupModelStatus(ctx context.Context) error {
	modelService := service.NewModelStatusService()

	start := time.Now()

	// 获取可用模型列表
	models, err := modelService.GetAvailableModels()
	if err != nil {
		return err
	}

	logger.Debug("模型状态预热完成",
		zap.Int("models", len(models)),
		zap.Duration("elapsed", time.Since(start)))

	return nil
}

// CacheRefreshTask 缓存刷新任务（定时刷新热点数据）
func CacheRefreshTask(ctx context.Context) error {
	dashboardService := service.NewDashboardService()
	riskService := service.NewRiskService()

	// 刷新 Dashboard 核心数据
	if _, err := dashboardService.GetOverview(); err != nil {
		logger.Warn("刷新 Dashboard 概览失败", zap.Error(err))
	}

	if _, err := dashboardService.GetUsage("7d"); err != nil {
		logger.Warn("刷新 Dashboard 使用统计失败", zap.Error(err))
	}

	if _, err := dashboardService.GetHourlyTrends(24); err != nil {
		logger.Warn("刷新每小时趋势失败", zap.Error(err))
	}

	if _, err := dashboardService.GetDailyTrends(7); err != nil {
		logger.Warn("刷新每日趋势失败", zap.Error(err))
	}

	if _, err := dashboardService.GetTopUsers(10, "requests"); err != nil {
		logger.Warn("刷新 Top 用户失败", zap.Error(err))
	}

	// 刷新排行榜数据
	periods := []string{"today", "week", "month"}
	for _, period := range periods {
		if _, err := riskService.GetLeaderboards(period, 50); err != nil {
			logger.Warn("刷新排行榜失败",
				zap.String("period", period),
				zap.Error(err))
		}
		time.Sleep(500 * time.Millisecond)
	}

	logger.Debug("定时缓存刷新完成")

	return nil
}

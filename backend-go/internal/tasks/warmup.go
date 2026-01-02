package tasks

import (
	"context"
	"time"

	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/ketches/new-api-tools/internal/service"
	"go.uber.org/zap"
)

// WarmupStatus 预热状态
type WarmupStatus struct {
	Phase       string    `json:"phase"`
	Progress    int       `json:"progress"`
	Total       int       `json:"total"`
	StartTime   time.Time `json:"start_time"`
	CurrentTask string    `json:"current_task"`
	Completed   bool      `json:"completed"`
}

var warmupStatus = &WarmupStatus{}

// GetWarmupStatus 获取预热状态
func GetWarmupStatus() *WarmupStatus {
	return warmupStatus
}

// CacheWarmupTask 缓存预热任务
func CacheWarmupTask(ctx context.Context) error {
	warmupStatus.StartTime = time.Now()
	warmupStatus.Completed = false

	logger.Info("开始缓存预热...")

	// 阶段 1: Dashboard 数据预热
	warmupStatus.Phase = "dashboard"
	warmupStatus.Progress = 0
	warmupStatus.Total = 5

	if err := warmupDashboard(ctx); err != nil {
		logger.Error("Dashboard 预热失败", zap.Error(err))
	}

	// 阶段 2: IP 分布预热
	warmupStatus.Phase = "ip_distribution"
	warmupStatus.Progress = 0
	warmupStatus.Total = 4

	if err := warmupIPDistribution(ctx); err != nil {
		logger.Error("IP 分布预热失败", zap.Error(err))
	}

	// 阶段 3: 排行榜预热
	warmupStatus.Phase = "leaderboard"
	warmupStatus.Progress = 0
	warmupStatus.Total = 3

	if err := warmupLeaderboard(ctx); err != nil {
		logger.Error("排行榜预热失败", zap.Error(err))
	}

	warmupStatus.Completed = true
	warmupStatus.Phase = "completed"

	elapsed := time.Since(warmupStatus.StartTime)
	logger.Info("缓存预热完成", zap.Duration("elapsed", elapsed))

	// 通知预热完成
	GetManager().SignalWarmupDone()

	return nil
}

// warmupDashboard 预热 Dashboard 数据
func warmupDashboard(ctx context.Context) error {
	dashboardService := service.NewDashboardService()

	items := []struct {
		name   string
		action func() error
	}{
		{"overview", func() error { _, err := dashboardService.GetOverview(); return err }},
		{"usage_today", func() error { _, err := dashboardService.GetUsage("today"); return err }},
		{"usage_week", func() error { _, err := dashboardService.GetUsage("week"); return err }},
		{"models", func() error { _, err := dashboardService.GetModelUsage(10); return err }},
		{"daily_trends", func() error { _, err := dashboardService.GetDailyTrends(7); return err }},
		{"hourly_trends", func() error { _, err := dashboardService.GetHourlyTrends(24); return err }},
		{"top_users", func() error { _, err := dashboardService.GetTopUsers(20, "requests"); return err }},
		{"channels", func() error { _, err := dashboardService.GetChannelStatus(); return err }},
	}

	warmupStatus.Total = len(items)

	for i, item := range items {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		warmupStatus.CurrentTask = item.name
		warmupStatus.Progress = i

		start := time.Now()
		if err := item.action(); err != nil {
			logger.Warn("Dashboard 预热项失败",
				zap.String("item", item.name),
				zap.Error(err))
		} else {
			logger.Info("Dashboard 预热项完成",
				zap.String("item", item.name),
				zap.Duration("elapsed", time.Since(start)))
		}
	}

	warmupStatus.Progress = len(items)
	return nil
}

// warmupIPDistribution 预热 IP 分布数据
func warmupIPDistribution(ctx context.Context) error {
	ipService := service.NewIPDistributionService()

	windows := []string{"1h", "6h", "24h", "7d"}
	warmupStatus.Total = len(windows)

	for i, window := range windows {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		warmupStatus.CurrentTask = "ip_distribution_" + window
		warmupStatus.Progress = i

		start := time.Now()
		if _, err := ipService.GetDistribution(window); err != nil {
			logger.Warn("IP 分布预热失败",
				zap.String("window", window),
				zap.Error(err))
		} else {
			logger.Info("IP 分布预热完成",
				zap.String("window", window),
				zap.Duration("elapsed", time.Since(start)))
		}
	}

	warmupStatus.Progress = len(windows)
	return nil
}

// warmupLeaderboard 预热排行榜数据
func warmupLeaderboard(ctx context.Context) error {
	riskService := service.NewRiskService()

	periods := []string{"today", "week", "month"}
	warmupStatus.Total = len(periods)

	for i, period := range periods {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		warmupStatus.CurrentTask = "leaderboard_" + period
		warmupStatus.Progress = i

		start := time.Now()
		if _, err := riskService.GetLeaderboards(period, 50); err != nil {
			logger.Warn("排行榜预热失败",
				zap.String("period", period),
				zap.Error(err))
		} else {
			logger.Info("排行榜预热完成",
				zap.String("period", period),
				zap.Duration("elapsed", time.Since(start)))
		}
	}

	warmupStatus.Progress = len(periods)
	return nil
}

// CacheRefreshTask 缓存刷新任务（定时刷新热点数据）
func CacheRefreshTask(ctx context.Context) error {
	dashboardService := service.NewDashboardService()

	// 刷新 Dashboard 概览
	if _, err := dashboardService.GetOverview(); err != nil {
		logger.Warn("刷新 Dashboard 概览失败", zap.Error(err))
	}

	// 刷新每小时趋势
	if _, err := dashboardService.GetHourlyTrends(24); err != nil {
		logger.Warn("刷新每小时趋势失败", zap.Error(err))
	}

	return nil
}

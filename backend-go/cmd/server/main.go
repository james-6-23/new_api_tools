package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/ketches/new-api-tools/frontend"
	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/config"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/handler"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/ketches/new-api-tools/internal/middleware"
	"github.com/ketches/new-api-tools/internal/tasks"
	"github.com/ketches/new-api-tools/pkg/geoip"
	"github.com/ketches/new-api-tools/pkg/jwt"
	"go.uber.org/zap"
)

// 版本信息（构建时注入）
var (
	Version   = "dev"
	BuildTime = "unknown"
	GitCommit = "unknown"
)

func main() {
	// 1. 加载配置
	cfg, err := config.Load()
	if err != nil {
		fmt.Printf("加载配置失败: %v\n", err)
		os.Exit(1)
	}

	// 2. 初始化日志
	if err := logger.Init(cfg.Server.Mode); err != nil {
		fmt.Printf("初始化日志失败: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()

	logger.Info("NewAPI Tools (Golang) 启动中...",
		zap.String("version", Version),
		zap.String("build_time", BuildTime),
		zap.String("git_commit", GitCommit),
	)

	// 3. 初始化数据库
	if err := database.Init(cfg); err != nil {
		logger.Fatal("初始化数据库失败", zap.Error(err))
	}
	defer database.Close()

	// 4. 初始化 Redis
	if err := cache.Init(cfg); err != nil {
		logger.Fatal("初始化 Redis 失败", zap.Error(err))
	}
	defer cache.Close()

	// 5. 初始化 JWT
	jwt.Init(cfg)

	// 6. 初始化 GeoIP
	if err := geoip.Init(); err != nil {
		logger.Warn("GeoIP 初始化失败，IP 地理查询将不可用", zap.Error(err))
	}
	defer geoip.Close()

	// 7. 初始化并启动后台任务
	tasks.InitTasks()
	taskManager := tasks.GetManager()
	taskManager.Start()
	defer taskManager.Stop()

	// 8. 设置 Gin 模式
	gin.SetMode(cfg.Server.Mode)

	// 9. 创建路由
	router := setupRouter(cfg)

	// 10. 创建 HTTP 服务器
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Server.Port),
		Handler:      router,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}

	// 11. 启动服务器（优雅关闭）
	go func() {
		logger.Info("服务器启动",
			zap.Int("port", cfg.Server.Port),
			zap.String("mode", cfg.Server.Mode),
		)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("服务器启动失败", zap.Error(err))
		}
	}()

	// 12. 等待中断信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("服务器正在关闭...")

	// 13. 优雅关闭（5秒超时）
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("服务器强制关闭", zap.Error(err))
	}

	logger.Info("服务器已关闭")
}

// setupRouter 设置路由
func setupRouter(cfg *config.Config) *gin.Engine {
	router := gin.New()

	// 全局中间件
	router.Use(middleware.RecoveryMiddleware())
	router.Use(middleware.CORSMiddleware())
	router.Use(gin.Logger())

	// 健康检查（无需认证）
	router.GET("/health", handler.HealthCheck)
	router.GET("/api/health", handler.HealthCheck)
	router.GET("/api/health/db", handler.DatabaseHealthCheck)

	// API 路由组
	api := router.Group("/api")
	{
		// 认证路由（无需 JWT）
		auth := api.Group("/auth")
		{
			auth.POST("/login", handler.Login)
			auth.POST("/logout", handler.Logout)
		}

		// 需要认证的路由
		authenticated := api.Group("")
		authenticated.Use(middleware.AuthMiddleware())
		{
			// Dashboard
			dashboard := authenticated.Group("/dashboard")
			{
				dashboard.GET("/overview", handler.GetDashboardOverview)
				dashboard.GET("/usage", handler.GetDashboardUsage)
				dashboard.GET("/models", handler.GetDashboardModels)
				dashboard.GET("/trends/daily", handler.GetDailyTrends)
				dashboard.GET("/trends/hourly", handler.GetHourlyTrends)
				dashboard.GET("/top-users", handler.GetTopUsers)
				dashboard.GET("/channels", handler.GetChannelStatus)
				dashboard.GET("/ip-distribution", handler.GetIPDistribution)
				dashboard.GET("/system-info", handler.GetSystemInfo)
				dashboard.POST("/cache/invalidate", handler.InvalidateCache)
				dashboard.GET("/refresh-estimate", handler.GetRefreshEstimate)
			}

			// 充值记录
			topups := authenticated.Group("/top-ups")
			{
				topups.GET("", handler.GetTopUps)
				topups.GET("/statistics", handler.GetTopUpStatistics)
				topups.GET("/payment-methods", handler.GetPaymentMethods)
				topups.GET("/:id", handler.GetTopUpByIDHandler)
				topups.POST("/:id/refund", handler.RefundTopUp)
			}

			// 兑换码
			redemptions := authenticated.Group("/redemptions")
			{
				redemptions.POST("/generate", handler.GenerateRedemptions)
				redemptions.GET("", handler.GetRedemptions)
				redemptions.GET("/statistics", handler.GetRedemptionStatistics)
				redemptions.DELETE("/:id", handler.DeleteRedemption)
				redemptions.DELETE("/batch", handler.BatchDeleteRedemptions)
			}

			// 用户管理
			users := authenticated.Group("/users")
			{
				users.GET("", handler.GetUsers)
				users.GET("/stats", handler.GetUserStats)
				users.GET("/banned", handler.GetBannedUsers)
				users.DELETE("/:user_id", handler.DeleteUser)
				users.POST("/batch-delete", handler.BatchDeleteUsers)
				users.POST("/:user_id/ban", handler.BanUser)
				users.POST("/:user_id/unban", handler.UnbanUser)
				users.POST("/tokens/:token_id/disable", handler.DisableToken)
				users.GET("/:user_id/invited", handler.GetInvitedUsers)
			}

			// 风控监控
			risk := authenticated.Group("/risk")
			{
				risk.GET("/leaderboards", handler.GetLeaderboards)
				risk.GET("/users/:user_id/analysis", handler.GetUserRiskAnalysis)
				risk.GET("/ban-records", handler.GetBanRecords)
				risk.GET("/token-rotation", handler.GetTokenRotation)
				risk.GET("/affiliated-accounts", handler.GetAffiliatedAccounts)
				risk.GET("/same-ip-registrations", handler.GetSameIPRegistrations)
			}

			// IP 监控
			ipMonitoring := authenticated.Group("/ip-monitoring")
			{
				ipMonitoring.GET("/stats", handler.GetIPStats)
				ipMonitoring.GET("/shared-ips", handler.GetSharedIPs)
				ipMonitoring.GET("/multi-ip-tokens", handler.GetMultiIPTokens)
				ipMonitoring.GET("/multi-ip-users", handler.GetMultiIPUsers)
				ipMonitoring.POST("/enable-all", handler.EnableAllIPRecording)
				ipMonitoring.GET("/geo/:ip", handler.GetIPGeo)
				ipMonitoring.POST("/geo/batch", handler.BatchGetIPGeo)
				ipMonitoring.GET("/users/:user_id/ips", handler.GetUserIPsHandler)
				ipMonitoring.GET("/index-status", handler.GetIPIndexStatusHandler)
				ipMonitoring.POST("/ensure-indexes", handler.EnsureIPIndexesHandler)
			}

			// AI 自动封禁
			aiBan := authenticated.Group("/ai-ban")
			{
				aiBan.GET("/config", handler.GetAIBanConfig)
				aiBan.POST("/config", handler.UpdateAIBanConfig)
				aiBan.POST("/test-model", handler.TestAIModel)
				aiBan.GET("/suspicious-users", handler.GetSuspiciousUsers)
				aiBan.POST("/assess", handler.AssessUserRisk)
				aiBan.POST("/scan", handler.ScanUsers)
				aiBan.GET("/whitelist", handler.GetWhitelist)
				aiBan.POST("/whitelist/add", handler.AddToWhitelist)
				aiBan.POST("/whitelist/remove", handler.RemoveFromWhitelistHandler)
				aiBan.GET("/whitelist/search", handler.SearchWhitelistHandler)
				aiBan.GET("/audit-logs", handler.GetAuditLogsHandler)
				aiBan.DELETE("/audit-logs", handler.DeleteAuditLogsHandler)
				aiBan.POST("/test-connection", handler.TestConnectionHandler)
				aiBan.POST("/reset-api-health", handler.ResetAPIHealthHandler)
				aiBan.POST("/models", handler.UpdateAIModelsHandler)
			}

			// 日志分析
			analytics := authenticated.Group("/analytics")
			{
				analytics.GET("/state", handler.GetAnalyticsState)
				analytics.POST("/process", handler.ProcessLogs)
				analytics.GET("/users/requests", handler.GetUserRequestRanking)
				analytics.GET("/users/quota", handler.GetUserQuotaRanking)
				analytics.GET("/models", handler.GetModelStats)
				analytics.GET("/summary", handler.GetAnalyticsSummary)
				analytics.POST("/reset", handler.ResetAnalytics)
				analytics.POST("/batch", handler.BatchProcessLogsHandler)
				analytics.GET("/sync-status", handler.GetSyncStatusHandler)
				analytics.POST("/check-consistency", handler.CheckConsistencyHandler)
			}

			// 模型状态监控
			modelStatus := authenticated.Group("/model-status")
			{
				modelStatus.GET("/models", handler.GetAvailableModels)
				modelStatus.GET("/windows", handler.GetTimeWindowsHandler)
				modelStatus.GET("/status/:model_name", handler.GetModelStatus)
				modelStatus.POST("/status/batch", handler.BatchGetModelStatus)
				modelStatus.GET("/status", handler.GetAllModelStatusHandler)
				modelStatus.GET("/config/selected", handler.GetSelectedModels)
				modelStatus.POST("/config/selected", handler.UpdateSelectedModels)
				modelStatus.GET("/config/window", handler.GetTimeWindow)
				modelStatus.POST("/config/window", handler.UpdateTimeWindowHandler)
				modelStatus.GET("/config/theme", handler.GetThemeConfigHandler)
				modelStatus.POST("/config/theme", handler.UpdateThemeConfigHandler)
				modelStatus.GET("/config/refresh", handler.GetRefreshIntervalHandler)
				modelStatus.POST("/config/refresh", handler.UpdateRefreshIntervalHandler)
			}

			// 系统管理
			system := authenticated.Group("/system")
			{
				system.GET("/scale", handler.GetSystemScale)
				system.POST("/scale/refresh", handler.RefreshSystemScale)
				system.GET("/warmup-status", handler.GetWarmupStatus)
				system.GET("/indexes", handler.GetIndexes)
				system.POST("/indexes/ensure", handler.EnsureIndexes)
			}

			// 存储管理
			storage := authenticated.Group("/storage")
			{
				storage.GET("/config", handler.GetStorageConfig)
				storage.GET("/config/:key", handler.GetStorageConfigByKeyHandler)
				storage.POST("/config", handler.UpdateStorageConfig)
				storage.DELETE("/config/:key", handler.DeleteStorageConfigHandler)
				storage.GET("/cache/info", handler.GetCacheInfoHandler)
				storage.POST("/cache/cleanup", handler.CleanupCache)
				storage.DELETE("/cache", handler.ClearAllCacheHandler)
				storage.DELETE("/cache/dashboard", handler.ClearDashboardCacheHandler)
				storage.GET("/cache/stats", handler.GetCacheStatsHandler)
				storage.POST("/cache/cleanup-expired", handler.CleanupExpiredCacheHandler)
				storage.GET("/info", handler.GetStorageInfoHandler)
			}

			// IP 监控别名路由 (兼容 Python 版本的 /api/ip/* 路径)
			ip := authenticated.Group("/ip")
			{
				ip.GET("/stats", handler.GetIPStats)
				ip.GET("/shared-ips", handler.GetSharedIPs)
				ip.GET("/multi-ip-tokens", handler.GetMultiIPTokens)
				ip.GET("/multi-ip-users", handler.GetMultiIPUsers)
				ip.POST("/enable-all", handler.EnableAllIPRecording)
				ip.GET("/users/:user_id/ips", handler.GetUserIPsHandler)
				ip.GET("/index-status", handler.GetIPIndexStatusHandler)
				ip.POST("/ensure-indexes", handler.EnsureIPIndexesHandler)
				ip.GET("/geo/:ip", handler.GetIPGeo)
				ip.POST("/geo/batch", handler.BatchGetIPGeo)
			}
		}

		// 模型状态嵌入接口（公开，无需认证）
		modelStatusEmbed := api.Group("/model-status/embed")
		{
			modelStatusEmbed.GET("/windows", handler.GetEmbedTimeWindowsHandler)
			modelStatusEmbed.GET("/models", handler.GetEmbedAvailableModelsHandler)
			modelStatusEmbed.GET("/status/:model_name", handler.GetEmbedModelStatusHandler)
			modelStatusEmbed.POST("/status/batch", handler.BatchGetEmbedModelStatusHandler)
			modelStatusEmbed.GET("/status", handler.GetEmbedAllModelStatusHandler)
			modelStatusEmbed.GET("/config/selected", handler.GetEmbedSelectedModelsHandler)
		}
	}

	// 前端静态文件服务（放在最后，作为 fallback）
	frontend.ServeFrontend(router)

	return router
}

package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/ketches/new-api-tools/internal/service"
	"go.uber.org/zap"
)

var dashboardService = service.NewDashboardService()
var ipDistributionService = service.NewIPDistributionService()

// GetDashboardOverview 获取系统概览
func GetDashboardOverview(c *gin.Context) {
	data, err := dashboardService.GetOverview()
	if err != nil {
		logger.Error("获取系统概览失败", zap.Error(err))
		Error(c, 500, "获取系统概览失败")
		return
	}

	Success(c, data)
}

// GetDashboardUsage 获取使用统计
func GetDashboardUsage(c *gin.Context) {
	period := c.DefaultQuery("period", "today")

	data, err := dashboardService.GetUsage(period)
	if err != nil {
		logger.Error("获取使用统计失败", zap.Error(err))
		Error(c, 500, "获取使用统计失败")
		return
	}

	Success(c, data)
}

// GetDashboardModels 获取模型使用统计
func GetDashboardModels(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))

	data, err := dashboardService.GetModelUsage(limit)
	if err != nil {
		logger.Error("获取模型统计失败", zap.Error(err))
		Error(c, 500, "获取模型统计失败")
		return
	}

	Success(c, data)
}

// GetDailyTrends 获取每日趋势
func GetDailyTrends(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))

	data, err := dashboardService.GetDailyTrends(days)
	if err != nil {
		logger.Error("获取每日趋势失败", zap.Error(err))
		Error(c, 500, "获取每日趋势失败")
		return
	}

	Success(c, data)
}

// GetHourlyTrends 获取每小时趋势
func GetHourlyTrends(c *gin.Context) {
	hours, _ := strconv.Atoi(c.DefaultQuery("hours", "24"))
	if hours <= 0 || hours > 168 { // 最多 7 天
		hours = 24
	}

	data, err := dashboardService.GetHourlyTrends(hours)
	if err != nil {
		logger.Error("获取每小时趋势失败", zap.Error(err))
		Error(c, 500, "获取每小时趋势失败")
		return
	}

	Success(c, data)
}

// GetTopUsers 获取用户排行
func GetTopUsers(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	orderBy := c.DefaultQuery("order_by", "requests")

	data, err := dashboardService.GetTopUsers(limit, orderBy)
	if err != nil {
		logger.Error("获取用户排行失败", zap.Error(err))
		Error(c, 500, "获取用户排行失败")
		return
	}

	Success(c, data)
}

// GetChannelStatus 获取渠道状态
func GetChannelStatus(c *gin.Context) {
	data, err := dashboardService.GetChannelStatus()
	if err != nil {
		logger.Error("获取渠道状态失败", zap.Error(err))
		Error(c, 500, "获取渠道状态失败")
		return
	}

	Success(c, data)
}

// GetIPDistribution 获取 IP 分布
func GetIPDistribution(c *gin.Context) {
	window := c.DefaultQuery("window", "24h")

	data, err := ipDistributionService.GetDistribution(window)
	if err != nil {
		logger.Error("获取 IP 分布失败", zap.Error(err))
		Error(c, 500, "获取 IP 分布失败")
		return
	}

	Success(c, data)
}

// ==================== Top-Ups ====================
func GetTopUps(c *gin.Context)          { GetTopUpsHandler(c) }
func GetTopUpStatistics(c *gin.Context) { GetTopUpStatisticsHandler(c) }
func GetPaymentMethods(c *gin.Context)  { GetPaymentMethodsHandler(c) }
func RefundTopUp(c *gin.Context)        { RefundTopUpHandler(c) }

// ==================== Redemptions ====================
func GenerateRedemptions(c *gin.Context)     { GenerateRedemptionsHandler(c) }
func GetRedemptions(c *gin.Context)          { GetRedemptionsHandler(c) }
func GetRedemptionStatistics(c *gin.Context) { GetRedemptionStatisticsHandler(c) }
func DeleteRedemption(c *gin.Context)        { DeleteRedemptionHandler(c) }
func BatchDeleteRedemptions(c *gin.Context)  { BatchDeleteRedemptionsHandler(c) }

// ==================== Users ====================
func GetUsers(c *gin.Context)         { GetUsersHandler(c) }
func GetUserStats(c *gin.Context)     { GetUserStatsHandler(c) }
func GetBannedUsers(c *gin.Context)   { GetBannedUsersHandler(c) }
func DeleteUser(c *gin.Context)       { DeleteUserHandler(c) }
func BatchDeleteUsers(c *gin.Context) { BatchDeleteUsersHandler(c) }
func BanUser(c *gin.Context)          { BanUserHandler(c) }
func UnbanUser(c *gin.Context)        { UnbanUserHandler(c) }
func DisableToken(c *gin.Context)     { DisableTokenHandler(c) }
func GetInvitedUsers(c *gin.Context)  { GetInvitedUsersHandler(c) }

// ==================== Risk Monitoring ====================
func GetLeaderboards(c *gin.Context)        { GetLeaderboardsHandler(c) }
func GetUserRiskAnalysis(c *gin.Context)    { GetUserRiskAnalysisHandler(c) }
func GetBanRecords(c *gin.Context)          { GetBanRecordsHandler(c) }
func GetTokenRotation(c *gin.Context)       { GetTokenRotationHandler(c) }
func GetAffiliatedAccounts(c *gin.Context)  { GetAffiliatedAccountsHandler(c) }
func GetSameIPRegistrations(c *gin.Context) { GetSameIPRegistrationsHandler(c) }

// ==================== IP Monitoring ====================
func GetIPStats(c *gin.Context)           { GetIPStatsHandler(c) }
func GetSharedIPs(c *gin.Context)         { GetSharedIPsHandler(c) }
func GetMultiIPTokens(c *gin.Context)     { GetMultiIPTokensHandler(c) }
func GetMultiIPUsers(c *gin.Context)      { GetMultiIPUsersHandler(c) }
func EnableAllIPRecording(c *gin.Context) { Success(c, gin.H{"message": "已开启"}) }
func GetIPGeo(c *gin.Context)             { GetIPGeoHandler(c) }
func BatchGetIPGeo(c *gin.Context)        { BatchGetIPGeoHandler(c) }

// ==================== AI Ban ====================
func GetAIBanConfig(c *gin.Context)     { GetAIBanConfigHandler(c) }
func UpdateAIBanConfig(c *gin.Context)  { UpdateAIBanConfigHandler(c) }
func TestAIModel(c *gin.Context)        { TestAIModelHandler(c) }
func GetSuspiciousUsers(c *gin.Context) { GetSuspiciousUsersHandler(c) }
func AssessUserRisk(c *gin.Context)     { AssessUserRiskHandler(c) }
func ScanUsers(c *gin.Context)          { ScanUsersHandler(c) }
func GetWhitelist(c *gin.Context)       { GetWhitelistHandler(c) }
func AddToWhitelist(c *gin.Context)     { AddToWhitelistHandler(c) }

// ==================== Analytics ====================
func GetAnalyticsState(c *gin.Context)     { GetAnalyticsStateHandler(c) }
func ProcessLogs(c *gin.Context)           { ProcessLogsHandler(c) }
func GetUserRequestRanking(c *gin.Context) { GetUserRequestRankingHandler(c) }
func GetUserQuotaRanking(c *gin.Context)   { GetUserQuotaRankingHandler(c) }
func GetModelStats(c *gin.Context)         { GetModelStatsHandler(c) }
func GetAnalyticsSummary(c *gin.Context)   { GetAnalyticsSummaryHandler(c) }
func ResetAnalytics(c *gin.Context)        { ResetAnalyticsHandler(c) }

// ==================== Model Status ====================
func GetAvailableModels(c *gin.Context)   { GetAvailableModelsHandler(c) }
func GetModelStatus(c *gin.Context)       { GetModelStatusHandler(c) }
func BatchGetModelStatus(c *gin.Context)  { BatchGetModelStatusHandler(c) }
func GetSelectedModels(c *gin.Context)    { GetSelectedModelsHandler(c) }
func UpdateSelectedModels(c *gin.Context) { UpdateSelectedModelsHandler(c) }
func GetTimeWindow(c *gin.Context)        { GetTimeWindowHandler(c) }

// ==================== System ====================
func GetSystemScale(c *gin.Context)     { GetSystemScaleHandler(c) }
func RefreshSystemScale(c *gin.Context) { RefreshSystemScaleHandler(c) }
func GetWarmupStatus(c *gin.Context)    { GetWarmupStatusHandler(c) }
func GetIndexes(c *gin.Context)         { GetIndexesHandler(c) }
func EnsureIndexes(c *gin.Context)      { EnsureIndexesHandler(c) }

// ==================== Storage ====================
func GetStorageConfig(c *gin.Context)    { GetStorageConfigHandler(c) }
func UpdateStorageConfig(c *gin.Context) { UpdateStorageConfigHandler(c) }
func CleanupCache(c *gin.Context)        { CleanupCacheHandler(c) }

package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/ketches/new-api-tools/internal/service"
	"github.com/ketches/new-api-tools/internal/tasks"
	"go.uber.org/zap"
)

// Service instances for new modules
var (
	aiBanService       = service.NewAIBanService()
	analyticsService   = service.NewAnalyticsService()
	modelStatusService = service.NewModelStatusService()
	systemService      = service.NewSystemService()
	storageService     = service.NewStorageService()
)

// ==================== AI Ban Handlers ====================

// GetAIBanConfigHandler 获取 AI 封禁配置
func GetAIBanConfigHandler(c *gin.Context) {
	data, err := aiBanService.GetConfig()
	if err != nil {
		logger.Error("获取 AI 封禁配置失败", zap.Error(err))
		Error(c, 500, "获取配置失败")
		return
	}

	Success(c, data)
}

// UpdateAIBanConfigHandler 更新 AI 封禁配置
func UpdateAIBanConfigHandler(c *gin.Context) {
	var config service.AIBanConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		Error(c, 400, "参数错误")
		return
	}

	if err := aiBanService.UpdateConfig(&config); err != nil {
		logger.Error("更新 AI 封禁配置失败", zap.Error(err))
		Error(c, 500, err.Error())
		return
	}

	Success(c, gin.H{"message": "更新成功"})
}

// TestAIModelHandler 测试 AI 模型
func TestAIModelHandler(c *gin.Context) {
	data, err := aiBanService.TestModel()
	if err != nil {
		logger.Error("测试 AI 模型失败", zap.Error(err))
		Error(c, 500, err.Error())
		return
	}

	Success(c, data)
}

// GetSuspiciousUsersHandler 获取可疑用户
func GetSuspiciousUsersHandler(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))

	data, err := aiBanService.GetSuspiciousUsers(limit)
	if err != nil {
		logger.Error("获取可疑用户失败", zap.Error(err))
		Error(c, 500, "获取可疑用户失败")
		return
	}

	Success(c, data)
}

// AssessUserRiskHandler 评估用户风险
func AssessUserRiskHandler(c *gin.Context) {
	var req struct {
		UserID int    `json:"user_id"`
		Window string `json:"window"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, 400, "参数错误")
		return
	}

	if req.UserID <= 0 {
		Error(c, 400, "无效的用户 ID")
		return
	}

	if req.Window == "" {
		req.Window = "1h"
	}

	data, err := aiBanService.AssessUserRisk(req.UserID)
	if err != nil {
		logger.Error("评估用户风险失败", zap.Error(err))
		Error(c, 500, err.Error())
		return
	}

	Success(c, data)
}

// ScanUsersHandler 扫描用户
func ScanUsersHandler(c *gin.Context) {
	data, err := aiBanService.ScanUsers()
	if err != nil {
		logger.Error("扫描用户失败", zap.Error(err))
		Error(c, 500, "扫描失败")
		return
	}

	Success(c, data)
}

// GetWhitelistHandler 获取白名单
func GetWhitelistHandler(c *gin.Context) {
	data, err := aiBanService.GetWhitelist()
	if err != nil {
		logger.Error("获取白名单失败", zap.Error(err))
		Error(c, 500, "获取白名单失败")
		return
	}

	Success(c, data)
}

// AddToWhitelistHandler 添加到白名单
func AddToWhitelistHandler(c *gin.Context) {
	var req struct {
		UserID int    `json:"user_id"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, 400, "参数错误")
		return
	}

	if err := aiBanService.AddToWhitelist(req.UserID, req.Reason); err != nil {
		logger.Error("添加白名单失败", zap.Error(err))
		Error(c, 500, err.Error())
		return
	}

	Success(c, gin.H{"message": "添加成功"})
}

// RemoveFromWhitelistHandler 从白名单移除
func RemoveFromWhitelistHandler(c *gin.Context) {
	var req struct {
		UserID int `json:"user_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, 400, "参数错误")
		return
	}
	if err := aiBanService.RemoveFromWhitelist(req.UserID); err != nil {
		logger.Error("移除白名单失败", zap.Error(err))
		Error(c, 500, err.Error())
		return
	}
	Success(c, gin.H{"message": "移除成功"})
}

// SearchWhitelistHandler 搜索白名单
func SearchWhitelistHandler(c *gin.Context) {
	// 支持 q 和 keyword 两种参数名，优先使用 q（与前端一致）
	keyword := c.Query("q")
	if keyword == "" {
		keyword = c.Query("keyword")
	}
	data, err := aiBanService.SearchWhitelist(keyword)
	if err != nil {
		Error(c, 500, "搜索失败")
		return
	}
	Success(c, data)
}

// GetAuditLogsHandler 获取审计日志
func GetAuditLogsHandler(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	data, err := aiBanService.GetAuditLogs(page, pageSize)
	if err != nil {
		Error(c, 500, "获取审计日志失败")
		return
	}
	Success(c, data)
}

// DeleteAuditLogsHandler 删除审计日志
func DeleteAuditLogsHandler(c *gin.Context) {
	if err := aiBanService.DeleteAuditLogs(); err != nil {
		Error(c, 500, "删除失败")
		return
	}
	Success(c, gin.H{"message": "删除成功"})
}

// TestConnectionHandler 测试 AI 连接
func TestConnectionHandler(c *gin.Context) {
	data, err := aiBanService.TestConnection()
	if err != nil {
		Error(c, 500, err.Error())
		return
	}
	Success(c, data)
}

// ResetAPIHealthHandler 重置 API 健康状态
func ResetAPIHealthHandler(c *gin.Context) {
	if err := aiBanService.ResetAPIHealth(); err != nil {
		Error(c, 500, err.Error())
		return
	}
	Success(c, gin.H{"message": "重置成功"})
}

// UpdateAIModelsHandler 更新 AI 模型列表
func UpdateAIModelsHandler(c *gin.Context) {
	var req struct {
		Models []string `json:"models"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, 400, "参数错误")
		return
	}
	Success(c, gin.H{"message": "更新成功", "models": req.Models})
}

// ==================== Analytics Handlers ====================

// GetAnalyticsStateHandler 获取分析状态
func GetAnalyticsStateHandler(c *gin.Context) {
	data, err := analyticsService.GetState()
	if err != nil {
		logger.Error("获取分析状态失败", zap.Error(err))
		Error(c, 500, "获取状态失败")
		return
	}

	Success(c, data)
}

// ProcessLogsHandler 处理日志
func ProcessLogsHandler(c *gin.Context) {
	var req struct {
		BatchSize int `json:"batch_size"`
	}
	c.ShouldBindJSON(&req)

	data, err := analyticsService.ProcessLogs(req.BatchSize)
	if err != nil {
		logger.Error("处理日志失败", zap.Error(err))
		Error(c, 500, "处理失败")
		return
	}

	Success(c, data)
}

// GetUserRequestRankingHandler 获取用户请求排行
func GetUserRequestRankingHandler(c *gin.Context) {
	period := c.DefaultQuery("period", "today")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))

	data, err := analyticsService.GetUserRequestRanking(period, limit)
	if err != nil {
		logger.Error("获取用户请求排行失败", zap.Error(err))
		Error(c, 500, "获取排行失败")
		return
	}

	Success(c, data)
}

// GetUserQuotaRankingHandler 获取用户额度排行
func GetUserQuotaRankingHandler(c *gin.Context) {
	period := c.DefaultQuery("period", "today")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))

	data, err := analyticsService.GetUserQuotaRanking(period, limit)
	if err != nil {
		logger.Error("获取用户额度排行失败", zap.Error(err))
		Error(c, 500, "获取排行失败")
		return
	}

	Success(c, data)
}

// GetModelStatsHandler 获取模型统计
func GetModelStatsHandler(c *gin.Context) {
	period := c.DefaultQuery("period", "today")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))

	data, err := analyticsService.GetModelStats(period, limit)
	if err != nil {
		logger.Error("获取模型统计失败", zap.Error(err))
		Error(c, 500, "获取统计失败")
		return
	}

	Success(c, data)
}

// GetAnalyticsSummaryHandler 获取分析摘要
func GetAnalyticsSummaryHandler(c *gin.Context) {
	period := c.DefaultQuery("period", "today")

	data, err := analyticsService.GetSummary(period)
	if err != nil {
		logger.Error("获取分析摘要失败", zap.Error(err))
		Error(c, 500, "获取摘要失败")
		return
	}

	Success(c, data)
}

// ResetAnalyticsHandler 重置分析
func ResetAnalyticsHandler(c *gin.Context) {
	if err := analyticsService.Reset(); err != nil {
		logger.Error("重置分析失败", zap.Error(err))
		Error(c, 500, "重置失败")
		return
	}

	Success(c, gin.H{"message": "重置成功"})
}

// ==================== Model Status Handlers ====================

// GetAvailableModelsHandler 获取可用模型
func GetAvailableModelsHandler(c *gin.Context) {
	data, err := modelStatusService.GetAvailableModels()
	if err != nil {
		logger.Error("获取可用模型失败", zap.Error(err))
		Error(c, 500, "获取模型失败")
		return
	}

	Success(c, data)
}

// GetModelStatusHandler 获取模型状态
func GetModelStatusHandler(c *gin.Context) {
	modelName := c.Param("model_name")
	if modelName == "" {
		Error(c, 400, "缺少模型名称")
		return
	}

	data, err := modelStatusService.GetModelStatus(modelName)
	if err != nil {
		logger.Error("获取模型状态失败", zap.Error(err))
		Error(c, 500, err.Error())
		return
	}

	Success(c, data)
}

// BatchGetModelStatusHandler 批量获取模型状态
func BatchGetModelStatusHandler(c *gin.Context) {
	var req struct {
		Models []string `json:"models"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, 400, "参数错误")
		return
	}

	data, err := modelStatusService.BatchGetModelStatus(req.Models)
	if err != nil {
		logger.Error("批量获取模型状态失败", zap.Error(err))
		Error(c, 500, "获取状态失败")
		return
	}

	Success(c, data)
}

// GetSelectedModelsHandler 获取选中的模型
func GetSelectedModelsHandler(c *gin.Context) {
	data, err := modelStatusService.GetSelectedModels()
	if err != nil {
		logger.Error("获取选中模型失败", zap.Error(err))
		Error(c, 500, "获取失败")
		return
	}

	Success(c, data)
}

// UpdateSelectedModelsHandler 更新选中的模型
func UpdateSelectedModelsHandler(c *gin.Context) {
	var req struct {
		Models []string `json:"models"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, 400, "参数错误")
		return
	}

	if err := modelStatusService.UpdateSelectedModels(req.Models); err != nil {
		logger.Error("更新选中模型失败", zap.Error(err))
		Error(c, 500, err.Error())
		return
	}

	Success(c, gin.H{"message": "更新成功"})
}

// GetTimeWindowHandler 获取时间窗口
func GetTimeWindowHandler(c *gin.Context) {
	data, err := modelStatusService.GetTimeWindow()
	if err != nil {
		logger.Error("获取时间窗口失败", zap.Error(err))
		Error(c, 500, "获取失败")
		return
	}

	Success(c, data)
}

// UpdateTimeWindowHandler 更新时间窗口
func UpdateTimeWindowHandler(c *gin.Context) {
	var req struct {
		Window string `json:"window"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, 400, "参数错误")
		return
	}
	Success(c, gin.H{"window": req.Window})
}

// GetTimeWindowsHandler 获取所有时间窗口选项
func GetTimeWindowsHandler(c *gin.Context) {
	Success(c, gin.H{
		"windows": []gin.H{
			{"value": "1h", "label": "1 小时"},
			{"value": "6h", "label": "6 小时"},
			{"value": "24h", "label": "24 小时"},
			{"value": "7d", "label": "7 天"},
		},
	})
}

// GetAllModelStatusHandler 获取所有模型状态
func GetAllModelStatusHandler(c *gin.Context) {
	data, err := modelStatusService.GetAllModelStatus()
	if err != nil {
		Error(c, 500, "获取失败")
		return
	}
	Success(c, data)
}

// GetThemeConfigHandler 获取主题配置
func GetThemeConfigHandler(c *gin.Context) {
	Success(c, gin.H{"theme": "light"})
}

// UpdateThemeConfigHandler 更新主题配置
func UpdateThemeConfigHandler(c *gin.Context) {
	var req struct {
		Theme string `json:"theme"`
	}
	c.ShouldBindJSON(&req)
	Success(c, gin.H{"theme": req.Theme})
}

// GetRefreshIntervalHandler 获取刷新间隔
func GetRefreshIntervalHandler(c *gin.Context) {
	Success(c, gin.H{"interval": 30})
}

// UpdateRefreshIntervalHandler 更新刷新间隔
func UpdateRefreshIntervalHandler(c *gin.Context) {
	var req struct {
		Interval int `json:"interval"`
	}
	c.ShouldBindJSON(&req)
	Success(c, gin.H{"interval": req.Interval})
}

// ==================== System Handlers ====================

// GetSystemScaleHandler 获取系统规模
func GetSystemScaleHandler(c *gin.Context) {
	// 使用新的 DetectScale 方法
	data, err := systemService.DetectScale(false)
	if err != nil {
		logger.Error("获取系统规模失败", zap.Error(err))
		Error(c, 500, "获取失败")
		return
	}

	Success(c, data)
}

// RefreshSystemScaleHandler 刷新系统规模
func RefreshSystemScaleHandler(c *gin.Context) {
	// 强制刷新
	data, err := systemService.DetectScale(true)
	if err != nil {
		logger.Error("刷新系统规模失败", zap.Error(err))
		Error(c, 500, "刷新失败")
		return
	}

	Success(c, data)
}

// GetWarmupStatusHandler 获取预热状态
// 直接使用 tasks.WarmupStatus 中维护的状态，避免重复计算
func GetWarmupStatusHandler(c *gin.Context) {
	// 从 tasks 包获取预热状态（已包含完整的 8 阶段信息）
	warmupStatus := tasks.GetWarmupStatus()

	// 直接使用 WarmupStatus 中的 Steps 构建响应
	steps := make([]gin.H, len(warmupStatus.Steps))
	for i, step := range warmupStatus.Steps {
		steps[i] = gin.H{
			"name":   step.Name,
			"status": step.Status,
		}
	}

	// 返回前端期望的格式
	data := gin.H{
		"status":       warmupStatus.Status,
		"progress":     warmupStatus.Progress,
		"message":      warmupStatus.Message,
		"steps":        steps,
		"started_at":   nil,
		"completed_at": nil,
	}

	if !warmupStatus.StartTime.IsZero() {
		data["started_at"] = warmupStatus.StartTime.Unix()
	}
	if warmupStatus.CompletedAt != nil {
		data["completed_at"] = warmupStatus.CompletedAt.Unix()
	}

	Success(c, data)
}

// GetIndexesHandler 获取索引
func GetIndexesHandler(c *gin.Context) {
	data, err := systemService.GetIndexes()
	if err != nil {
		logger.Error("获取索引失败", zap.Error(err))
		Error(c, 500, "获取失败")
		return
	}

	Success(c, data)
}

// EnsureIndexesHandler 确保索引
func EnsureIndexesHandler(c *gin.Context) {
	data, err := systemService.EnsureIndexes()
	if err != nil {
		logger.Error("确保索引失败", zap.Error(err))
		Error(c, 500, "操作失败")
		return
	}

	Success(c, data)
}

// ==================== Storage Handlers ====================

// GetStorageConfigHandler 获取存储配置
func GetStorageConfigHandler(c *gin.Context) {
	data, err := storageService.GetConfig()
	if err != nil {
		logger.Error("获取存储配置失败", zap.Error(err))
		Error(c, 500, "获取失败")
		return
	}

	Success(c, data)
}

// UpdateStorageConfigHandler 更新存储配置
func UpdateStorageConfigHandler(c *gin.Context) {
	var config service.StorageConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		Error(c, 400, "参数错误")
		return
	}

	if err := storageService.UpdateConfig(&config); err != nil {
		logger.Error("更新存储配置失败", zap.Error(err))
		Error(c, 500, err.Error())
		return
	}

	Success(c, gin.H{"message": "更新成功"})
}

// CleanupCacheHandler 清理缓存
func CleanupCacheHandler(c *gin.Context) {
	data, err := storageService.CleanupCache()
	if err != nil {
		logger.Error("清理缓存失败", zap.Error(err))
		Error(c, 500, "清理失败")
		return
	}

	Success(c, data)
}

// GetStorageConfigByKeyHandler 获取单个配置项
func GetStorageConfigByKeyHandler(c *gin.Context) {
	key := c.Param("key")
	data, err := storageService.GetConfigByKey(key)
	if err != nil {
		Error(c, 500, "获取失败")
		return
	}
	Success(c, data)
}

// DeleteStorageConfigHandler 删除配置项
func DeleteStorageConfigHandler(c *gin.Context) {
	key := c.Param("key")
	if err := storageService.DeleteConfig(key); err != nil {
		Error(c, 500, "删除失败")
		return
	}
	Success(c, gin.H{"message": "删除成功"})
}

// GetCacheInfoHandler 获取缓存信息
func GetCacheInfoHandler(c *gin.Context) {
	data, err := storageService.GetCacheInfo()
	if err != nil {
		Error(c, 500, "获取失败")
		return
	}
	Success(c, data)
}

// ClearAllCacheHandler 清空所有缓存
func ClearAllCacheHandler(c *gin.Context) {
	if err := storageService.ClearAllCache(); err != nil {
		Error(c, 500, "清空失败")
		return
	}
	Success(c, gin.H{"message": "缓存已清空"})
}

// ClearDashboardCacheHandler 清空仪表板缓存
func ClearDashboardCacheHandler(c *gin.Context) {
	if err := storageService.ClearDashboardCache(); err != nil {
		Error(c, 500, "清空失败")
		return
	}
	Success(c, gin.H{"message": "仪表板缓存已清空"})
}

// GetCacheStatsHandler 获取缓存统计
func GetCacheStatsHandler(c *gin.Context) {
	data, err := storageService.GetCacheStats()
	if err != nil {
		Error(c, 500, "获取失败")
		return
	}
	Success(c, data)
}

// CleanupExpiredCacheHandler 清理过期缓存
func CleanupExpiredCacheHandler(c *gin.Context) {
	data, err := storageService.CleanupExpiredCache()
	if err != nil {
		Error(c, 500, "清理失败")
		return
	}
	Success(c, data)
}

// GetStorageInfoHandler 获取存储信息
func GetStorageInfoHandler(c *gin.Context) {
	data, err := storageService.GetStorageInfo()
	if err != nil {
		Error(c, 500, "获取失败")
		return
	}
	Success(c, data)
}

// ==================== Analytics Extended Handlers ====================

// BatchProcessLogsHandler 批量处理日志
func BatchProcessLogsHandler(c *gin.Context) {
	var req struct {
		BatchSize int `json:"batch_size"`
	}
	c.ShouldBindJSON(&req)
	if req.BatchSize <= 0 {
		req.BatchSize = 1000
	}
	data, err := analyticsService.BatchProcessLogs(req.BatchSize)
	if err != nil {
		Error(c, 500, "处理失败")
		return
	}
	Success(c, data)
}

// GetSyncStatusHandler 获取同步状态
func GetSyncStatusHandler(c *gin.Context) {
	data, err := analyticsService.GetSyncStatus()
	if err != nil {
		Error(c, 500, "获取失败")
		return
	}
	Success(c, data)
}

// CheckConsistencyHandler 检查数据一致性
func CheckConsistencyHandler(c *gin.Context) {
	data, err := analyticsService.CheckConsistency()
	if err != nil {
		Error(c, 500, "检查失败")
		return
	}
	Success(c, data)
}

// ==================== TopUp Extended Handlers ====================

// GetTopUpByIDHandler 获取单个充值记录
func GetTopUpByIDHandler(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		Error(c, 400, "无效的 ID")
		return
	}
	data, err := topUpService.GetTopUpByID(id)
	if err != nil {
		Error(c, 500, err.Error())
		return
	}
	Success(c, data)
}

// ==================== Model Status Embed Handlers (Public) ====================

// GetEmbedTimeWindowsHandler [公开] 获取时间窗口
func GetEmbedTimeWindowsHandler(c *gin.Context) {
	GetTimeWindowsHandler(c)
}

// GetEmbedAvailableModelsHandler [公开] 获取可用模型
func GetEmbedAvailableModelsHandler(c *gin.Context) {
	GetAvailableModelsHandler(c)
}

// GetEmbedModelStatusHandler [公开] 获取模型状态
func GetEmbedModelStatusHandler(c *gin.Context) {
	GetModelStatusHandler(c)
}

// BatchGetEmbedModelStatusHandler [公开] 批量获取模型状态
func BatchGetEmbedModelStatusHandler(c *gin.Context) {
	BatchGetModelStatusHandler(c)
}

// GetEmbedAllModelStatusHandler [公开] 获取所有模型状态
func GetEmbedAllModelStatusHandler(c *gin.Context) {
	GetAllModelStatusHandler(c)
}

// GetEmbedSelectedModelsHandler [公开] 获取选中模型配置
func GetEmbedSelectedModelsHandler(c *gin.Context) {
	GetSelectedModelsHandler(c)
}

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
	userID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		Error(c, 400, "无效的用户 ID")
		return
	}

	data, err := aiBanService.AssessUserRisk(userID)
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
func GetWarmupStatusHandler(c *gin.Context) {
	// 从 tasks 包获取预热状态
	warmupStatus := tasks.GetWarmupStatus()

	// 获取系统内存状态
	sysStatus, _ := systemService.GetWarmupStatus()

	// 合并状态
	data := gin.H{
		"is_warmed_up":    warmupStatus.Completed,
		"warmup_progress": warmupStatus.Progress,
		"warmup_total":    warmupStatus.Total,
		"warmup_phase":    warmupStatus.Phase,
		"current_task":    warmupStatus.CurrentTask,
		"started_at":      warmupStatus.StartTime.Format("2006-01-02 15:04:05"),
		"cache_stats":     sysStatus.CacheStats,
		"database_stats":  sysStatus.DatabaseStats,
		"memory_stats":    sysStatus.MemoryStats,
		"task_manager":    tasks.GetManager().GetStatus(),
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

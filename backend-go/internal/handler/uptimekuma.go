package handler

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/ketches/new-api-tools/internal/service"
	"go.uber.org/zap"
)

var uptimeKumaService = service.NewUptimeKumaService()

const defaultUptimeKumaWindow = "24h"

// GetUptimeKumaMonitorsHandler 获取所有监控器（uptime-kuma 格式）
func GetUptimeKumaMonitorsHandler(c *gin.Context) {
	window := c.DefaultQuery("window", defaultUptimeKumaWindow)

	monitors, err := uptimeKumaService.GetMonitors(window)
	if err != nil {
		logger.Error("获取 uptime-kuma 监控器失败", zap.Error(err))
		Error(c, 500, "获取监控器失败")
		return
	}

	Success(c, monitors)
}

// GetUptimeKumaMonitorHandler 获取单个监控器（带心跳）
func GetUptimeKumaMonitorHandler(c *gin.Context) {
	modelName := c.Param("model_name")
	window := c.DefaultQuery("window", defaultUptimeKumaWindow)

	monitor, err := uptimeKumaService.GetMonitor(modelName, window)
	if err != nil {
		logger.Error("获取 uptime-kuma 监控器失败", zap.Error(err), zap.String("model", modelName))
		Error(c, 500, "获取监控器失败")
		return
	}

	if monitor == nil {
		c.JSON(200, Response{
			Success: false,
			Message: "Model '" + modelName + "' not found or has no recent logs",
		})
		return
	}

	Success(c, monitor)
}

// GetUptimeKumaHeartbeatsHandler 获取心跳数据
func GetUptimeKumaHeartbeatsHandler(c *gin.Context) {
	modelName := c.Param("model_name")
	window := c.DefaultQuery("window", defaultUptimeKumaWindow)

	heartbeats, monitorID, err := uptimeKumaService.GetHeartbeats(modelName, window)
	if err != nil {
		logger.Error("获取 uptime-kuma 心跳失败", zap.Error(err), zap.String("model", modelName))
		Error(c, 500, "获取心跳失败")
		return
	}

	c.JSON(200, gin.H{
		"success":    true,
		"data":       heartbeats,
		"monitor_id": monitorID,
	})
}

// GetUptimeKumaStatusPageHandler 获取状态页数据
func GetUptimeKumaStatusPageHandler(c *gin.Context) {
	window := c.DefaultQuery("window", defaultUptimeKumaWindow)
	modelsParam := c.Query("models")

	var modelNames []string
	if modelsParam != "" {
		// 解析逗号分隔的模型名
		for _, name := range strings.Split(modelsParam, ",") {
			name = strings.TrimSpace(name)
			if name != "" {
				modelNames = append(modelNames, name)
			}
		}
	}

	statusPage, err := uptimeKumaService.GetStatusPage(window, modelNames)
	if err != nil {
		logger.Error("获取 uptime-kuma 状态页失败", zap.Error(err))
		Error(c, 500, "获取状态页失败")
		return
	}

	Success(c, statusPage)
}

// PostUptimeKumaStatusPageBatchHandler 批量获取状态页数据
func PostUptimeKumaStatusPageBatchHandler(c *gin.Context) {
	window := c.DefaultQuery("window", defaultUptimeKumaWindow)

	var modelNames []string
	if err := c.ShouldBindJSON(&modelNames); err != nil {
		Error(c, 400, "参数错误")
		return
	}

	statusPage, err := uptimeKumaService.GetStatusPage(window, modelNames)
	if err != nil {
		logger.Error("获取 uptime-kuma 状态页失败", zap.Error(err))
		Error(c, 500, "获取状态页失败")
		return
	}

	Success(c, statusPage)
}

// GetUptimeKumaOverallHandler 获取整体状态摘要
func GetUptimeKumaOverallHandler(c *gin.Context) {
	window := c.DefaultQuery("window", defaultUptimeKumaWindow)

	overall, err := uptimeKumaService.GetOverallStatus(window)
	if err != nil {
		logger.Error("获取 uptime-kuma 整体状态失败", zap.Error(err))
		Error(c, 500, "获取整体状态失败")
		return
	}

	c.JSON(200, gin.H{
		"success":          true,
		"status":           overall.Status,
		"status_text":      overall.StatusText,
		"uptime":           overall.Uptime,
		"total_monitors":   overall.TotalMonitors,
		"monitors_up":      overall.MonitorsUp,
		"monitors_down":    overall.MonitorsDown,
		"monitors_pending": overall.MonitorsPending,
		"last_updated":     overall.LastUpdated,
	})
}

// GetUptimeKumaPushHandler Push 心跳端点（兼容 uptime-kuma push monitor）
func GetUptimeKumaPushHandler(c *gin.Context) {
	pushToken := c.Param("push_token")
	status := c.DefaultQuery("status", "up")
	msg := c.DefaultQuery("msg", "OK")

	logger.Debug("Uptime-Kuma Push received",
		zap.String("token", pushToken),
		zap.String("status", status),
		zap.String("msg", msg),
	)

	// 兼容端点 - 不实际使用 push 数据，状态从日志分析得出
	c.JSON(200, gin.H{
		"ok":  true,
		"msg": "OK (push data received but not used - status derived from logs)",
	})
}

package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/ketches/new-api-tools/internal/service"
	"go.uber.org/zap"
)

var uptimeKumaService = service.NewUptimeKumaService()

const defaultUptimeKumaWindow = "24h"

// GetStatusPageConfigHandler 获取状态页配置（uptime-kuma 格式）
// GET /api/status-page/:slug
func GetStatusPageConfigHandler(c *gin.Context) {
	slug := c.Param("slug")
	window := c.DefaultQuery("window", defaultUptimeKumaWindow)

	data, err := uptimeKumaService.GetStatusPageConfig(slug, window)
	if err != nil {
		logger.Error("获取状态页配置失败", zap.Error(err), zap.String("slug", slug))
		Error(c, 500, "获取状态页配置失败")
		return
	}

	c.JSON(200, data)
}

// GetStatusPageHeartbeatHandler 获取心跳数据（uptime-kuma 格式）
// GET /api/status-page/heartbeat/:slug
func GetStatusPageHeartbeatHandler(c *gin.Context) {
	slug := c.Param("slug")
	window := c.DefaultQuery("window", defaultUptimeKumaWindow)

	data, err := uptimeKumaService.GetHeartbeatData(slug, window)
	if err != nil {
		logger.Error("获取心跳数据失败", zap.Error(err), zap.String("slug", slug))
		Error(c, 500, "获取心跳数据失败")
		return
	}

	c.JSON(200, data)
}

// GetStatusPageBadgeHandler 获取徽章数据
// GET /api/status-page/:slug/badge
func GetStatusPageBadgeHandler(c *gin.Context) {
	slug := c.Param("slug")
	window := c.DefaultQuery("window", defaultUptimeKumaWindow)
	label := c.DefaultQuery("label", "")

	data, err := uptimeKumaService.GetBadgeData(slug, window, label)
	if err != nil {
		logger.Error("获取徽章数据失败", zap.Error(err), zap.String("slug", slug))
		Error(c, 500, "获取徽章数据失败")
		return
	}

	c.JSON(200, data)
}

// GetStatusPageSummaryHandler 获取摘要数据
// GET /api/status-page/:slug/summary
func GetStatusPageSummaryHandler(c *gin.Context) {
	slug := c.Param("slug")
	window := c.DefaultQuery("window", defaultUptimeKumaWindow)

	data, err := uptimeKumaService.GetSummaryData(slug, window)
	if err != nil {
		logger.Error("获取摘要数据失败", zap.Error(err), zap.String("slug", slug))
		Error(c, 500, "获取摘要数据失败")
		return
	}

	c.JSON(200, data)
}

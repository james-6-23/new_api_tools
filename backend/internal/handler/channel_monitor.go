package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/service"
)

// RegisterChannelMonitorRoutes registers /api/channels endpoints
func RegisterChannelMonitorRoutes(r *gin.RouterGroup) {
	g := r.Group("/channels")
	{
		g.GET("/overview", GetChannelOverview)
		g.GET("/log-stats", GetChannelLogStats)
		g.GET("/ability-matrix", GetChannelAbilityMatrix)
		g.GET("/model-health", GetChannelModelHealth)
		g.GET("/error-analysis", GetChannelErrorAnalysis)
	}
}

func channelHours(c *gin.Context) int {
	hours, _ := strconv.Atoi(c.DefaultQuery("hours", "24"))
	return hours
}

// GET /api/channels/overview
func GetChannelOverview(c *gin.Context) {
	svc := service.NewChannelMonitorService()
	items, err := svc.GetChannelOverview()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to get channel overview: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

// GET /api/channels/log-stats?hours=24
func GetChannelLogStats(c *gin.Context) {
	svc := service.NewChannelMonitorService()
	items, err := svc.GetChannelLogStats(channelHours(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to get channel log stats: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

// GET /api/channels/ability-matrix
func GetChannelAbilityMatrix(c *gin.Context) {
	svc := service.NewChannelMonitorService()
	result, err := svc.GetAbilityMatrix()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to get ability matrix: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

// GET /api/channels/model-health?hours=24
func GetChannelModelHealth(c *gin.Context) {
	svc := service.NewChannelMonitorService()
	items, err := svc.GetModelHealth(channelHours(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to get model health: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

// GET /api/channels/error-analysis?hours=24&limit=200
func GetChannelErrorAnalysis(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200"))
	svc := service.NewChannelMonitorService()
	result, err := svc.GetErrorAnalysis(channelHours(c), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to get error analysis: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

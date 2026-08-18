package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/service"
)

// RegisterCheckinRoutes registers /api/checkins endpoints
func RegisterCheckinRoutes(r *gin.RouterGroup) {
	g := r.Group("/checkins")
	{
		g.GET("/overview", GetCheckinOverview)
		g.GET("/trend", GetCheckinTrend)
		g.GET("/freeloaders", GetCheckinFreeloaders)
	}
}

// GET /api/checkins/overview
func GetCheckinOverview(c *gin.Context) {
	svc := service.NewCheckinAnalyticsService()
	result, err := svc.GetCheckinOverview()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to get checkin overview: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

// GET /api/checkins/trend?days=30
func GetCheckinTrend(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	svc := service.NewCheckinAnalyticsService()
	items, err := svc.GetCheckinTrend(days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to get checkin trend: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

// GET /api/checkins/freeloaders?days=30&limit=50
func GetCheckinFreeloaders(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	svc := service.NewCheckinAnalyticsService()
	items, err := svc.GetFreeloaders(days, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to get freeloaders: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

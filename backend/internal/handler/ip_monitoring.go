package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/models"
	"github.com/new-api-tools/backend/internal/service"
)

const maxIPLimit = 500

// RegisterIPMonitoringRoutes registers /api/ip endpoints
func RegisterIPMonitoringRoutes(r *gin.RouterGroup) {
	g := r.Group("/ip")
	{
		g.GET("/stats", GetIPStats)
		g.GET("/shared", GetSharedIPs)
		g.GET("/shared-ips", GetSharedIPs)
		g.GET("/multi-ip-tokens", GetMultiIPTokens)
		g.GET("/multi-ip-users", GetMultiIPUsers)
		g.POST("/enable-all-recording", EnableAllIPRecording)
		g.POST("/enable-all", EnableAllIPRecording)
		g.GET("/lookup/:ip", LookupIPUsers)
		g.GET("/users/:user_id/ips", GetUserIPs)
		g.GET("/indexes", GetIPIndexStatus)
		g.POST("/indexes/ensure", EnsureIPIndexes)
		g.GET("/geo/:ip", GetIPGeo)
		g.POST("/geo/batch", GetIPGeoBatch)
	}
}

// GET /api/ip/stats
func GetIPStats(c *gin.Context) {
	svc := service.NewIPMonitoringService()
	data, err := svc.GetIPStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/ip/shared
func GetSharedIPs(c *gin.Context) {
	window := c.DefaultQuery("window", "24h")
	if !validWindow(window) {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid window value", ""))
		return
	}
	minTokens, _ := strconv.Atoi(c.DefaultQuery("min_tokens", "2"))
	limit := parseLimit(c, 50, maxIPLimit)

	svc := service.NewIPMonitoringService()
	data, err := svc.GetSharedIPs(window, minTokens, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/ip/multi-ip-tokens
func GetMultiIPTokens(c *gin.Context) {
	window := c.DefaultQuery("window", "24h")
	if !validWindow(window) {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid window value", ""))
		return
	}
	minIPs, _ := strconv.Atoi(c.DefaultQuery("min_ips", "2"))
	limit := parseLimit(c, 50, maxIPLimit)

	svc := service.NewIPMonitoringService()
	data, err := svc.GetMultiIPTokens(window, minIPs, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/ip/multi-ip-users
func GetMultiIPUsers(c *gin.Context) {
	window := c.DefaultQuery("window", "24h")
	if !validWindow(window) {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid window value", ""))
		return
	}
	minIPs, _ := strconv.Atoi(c.DefaultQuery("min_ips", "3"))
	limit := parseLimit(c, 50, maxIPLimit)

	svc := service.NewIPMonitoringService()
	data, err := svc.GetMultiIPUsers(window, minIPs, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// POST /api/ip/enable-all-recording
func EnableAllIPRecording(c *gin.Context) {
	svc := service.NewIPMonitoringService()
	data, err := svc.EnableAllIPRecording()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("UPDATE_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data, "message": data["message"]})
}

// GET /api/ip/lookup/:ip
func LookupIPUsers(c *gin.Context) {
	ip := c.Param("ip")
	window := c.DefaultQuery("window", "24h")
	if !validWindow(window) {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid window value", ""))
		return
	}
	limit := parseLimit(c, 100, maxIPLimit)

	svc := service.NewIPMonitoringService()
	data, err := svc.LookupIPUsers(ip, window, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/ip/users/:user_id/ips
func GetUserIPs(c *gin.Context) {
	userID, err := strconv.ParseInt(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid user ID", ""))
		return
	}
	window := c.DefaultQuery("window", "24h")
	if !validWindow(window) {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid window value", ""))
		return
	}

	svc := service.NewIPMonitoringService()
	data, err := svc.GetUserIPs(userID, window)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/ip/indexes — placeholder
func GetIPIndexStatus(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"indexes":  []interface{}{},
			"total":    0,
			"existing": 0,
		},
	})
}

// POST /api/ip/indexes/ensure — placeholder
func EnsureIPIndexes(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "IP indexes ensured",
	})
}

// GET /api/ip/geo/:ip — placeholder
func GetIPGeo(c *gin.Context) {
	ip := c.Param("ip")
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"ip":      ip,
			"country": "Unknown",
			"region":  "Unknown",
			"city":    "Unknown",
		},
	})
}

// POST /api/ip/geo/batch — placeholder
func GetIPGeoBatch(c *gin.Context) {
	var req struct {
		IPs []string `json:"ips"`
	}
	c.ShouldBindJSON(&req)

	results := make([]gin.H, 0, len(req.IPs))
	for _, ip := range req.IPs {
		results = append(results, gin.H{
			"ip":      ip,
			"country": "Unknown",
			"region":  "Unknown",
			"city":    "Unknown",
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": results})
}

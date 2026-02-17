package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/models"
	"github.com/new-api-tools/backend/internal/service"
)

// RegisterRiskMonitoringRoutes registers /api/risk endpoints
func RegisterRiskMonitoringRoutes(r *gin.RouterGroup) {
	g := r.Group("/risk")
	{
		g.GET("/leaderboards", GetLeaderboards)
		g.GET("/users/:user_id/analysis", GetUserRiskAnalysis)
		g.GET("/ban-records", ListBanRecords)
		g.GET("/token-rotation", GetTokenRotationUsers)
		g.GET("/affiliated-accounts", GetAffiliatedAccounts)
		g.GET("/same-ip-registrations", GetSameIPRegistrations)
	}
}

// GET /api/risk/leaderboards
func GetLeaderboards(c *gin.Context) {
	windowsStr := c.DefaultQuery("windows", "1h,3h,6h,12h,24h")
	windows := strings.Split(windowsStr, ",")
	limit := parseLimit(c, 10, 100)
	sortBy := c.DefaultQuery("sort_by", "requests")

	if sortBy != "requests" && sortBy != "quota" && sortBy != "failure_rate" {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid sort_by: "+sortBy, ""))
		return
	}

	svc := service.NewRiskMonitoringService()
	data, err := svc.GetLeaderboards(windows, limit, sortBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/risk/users/:user_id/analysis
func GetUserRiskAnalysis(c *gin.Context) {
	userID, err := strconv.ParseInt(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid user ID", ""))
		return
	}
	window := c.DefaultQuery("window", "24h")
	seconds, ok := service.WindowSeconds[window]
	if !ok {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid window: "+window, ""))
		return
	}

	var endTime *int64
	if et := c.Query("end_time"); et != "" {
		v, err := strconv.ParseInt(et, 10, 64)
		if err == nil {
			endTime = &v
		}
	}

	svc := service.NewRiskMonitoringService()
	data, err := svc.GetUserAnalysis(userID, seconds, endTime)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/risk/ban-records
func ListBanRecords(c *gin.Context) {
	page := parsePage(c)
	pageSize := parsePageSize(c, 50, 200)
	action := c.Query("action")

	var userID *int64
	if uid := c.Query("user_id"); uid != "" {
		v, err := strconv.ParseInt(uid, 10, 64)
		if err == nil {
			userID = &v
		}
	}

	svc := service.NewRiskMonitoringService()
	data := svc.ListBanRecords(page, pageSize, action, userID)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/risk/token-rotation
func GetTokenRotationUsers(c *gin.Context) {
	window := c.DefaultQuery("window", "24h")
	if !validWindow(window) {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid window value", ""))
		return
	}
	minTokens, _ := strconv.Atoi(c.DefaultQuery("min_tokens", "5"))
	maxReqPerToken, _ := strconv.Atoi(c.DefaultQuery("max_requests_per_token", "10"))
	limit := parseLimit(c, 50, 500)

	svc := service.NewRiskMonitoringService()
	data, err := svc.GetTokenRotationUsers(window, minTokens, maxReqPerToken, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/risk/affiliated-accounts
func GetAffiliatedAccounts(c *gin.Context) {
	minInvited, _ := strconv.Atoi(c.DefaultQuery("min_invited", "3"))
	limit := parseLimit(c, 50, 500)

	svc := service.NewRiskMonitoringService()
	data, err := svc.GetAffiliatedAccounts(minInvited, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/risk/same-ip-registrations
func GetSameIPRegistrations(c *gin.Context) {
	window := c.DefaultQuery("window", "7d")
	if !validWindow(window) {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid window value", ""))
		return
	}
	minUsers, _ := strconv.Atoi(c.DefaultQuery("min_users", "3"))
	limit := parseLimit(c, 50, 500)

	svc := service.NewRiskMonitoringService()
	data, err := svc.GetSameIPRegistrations(window, minUsers, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

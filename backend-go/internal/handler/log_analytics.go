package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/models"
	"github.com/new-api-tools/backend/internal/service"
)

// RegisterLogAnalyticsRoutes registers /api/analytics endpoints
func RegisterLogAnalyticsRoutes(r *gin.RouterGroup) {
	g := r.Group("/analytics")
	{
		g.GET("/state", GetAnalyticsState)
		g.POST("/process", ProcessLogs)
		g.POST("/batch-process", BatchProcessLogs)
		g.POST("/batch", BatchProcessLogs)
		g.GET("/ranking/requests", GetUserRequestRanking)
		g.GET("/ranking/quota", GetUserQuotaRanking)
		g.GET("/models", GetModelStatistics)
		g.GET("/summary", GetAnalyticsSummary)
		g.POST("/reset", ResetAnalytics)
		g.GET("/sync-status", GetSyncStatus)
		g.POST("/check-consistency", CheckDataConsistency)
	}
}

// GET /api/analytics/state
func GetAnalyticsState(c *gin.Context) {
	svc := service.NewLogAnalyticsService()
	state := svc.GetAnalyticsState()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": state})
}

// POST /api/analytics/process
func ProcessLogs(c *gin.Context) {
	svc := service.NewLogAnalyticsService()
	result, err := svc.ProcessLogs()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("PROCESS_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"processed": result["processed"],
		"message":   result["message"],
	})
}

// POST /api/analytics/batch-process
func BatchProcessLogs(c *gin.Context) {
	maxIter, _ := strconv.Atoi(c.DefaultQuery("max_iterations", "100"))
	svc := service.NewLogAnalyticsService()
	result, err := svc.BatchProcess(maxIter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("PROCESS_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":          true,
		"total_processed":  result["total_processed"],
		"iterations":       result["iterations"],
		"elapsed_seconds":  result["elapsed_seconds"],
		"logs_per_second":  result["logs_per_second"],
		"progress_percent": result["progress_percent"],
		"remaining_logs":   result["remaining_logs"],
		"last_log_id":      result["last_log_id"],
		"completed":        result["completed"],
		"timed_out":        result["timed_out"],
	})
}

// GET /api/analytics/ranking/requests
func GetUserRequestRanking(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
	svc := service.NewLogAnalyticsService()
	data, err := svc.GetUserRequestRanking(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/analytics/ranking/quota
func GetUserQuotaRanking(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
	svc := service.NewLogAnalyticsService()
	data, err := svc.GetUserQuotaRanking(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/analytics/models
func GetModelStatistics(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	svc := service.NewLogAnalyticsService()
	data, err := svc.GetModelStatistics(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/analytics/summary
func GetAnalyticsSummary(c *gin.Context) {
	svc := service.NewLogAnalyticsService()
	data, err := svc.GetSummary()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// POST /api/analytics/reset
func ResetAnalytics(c *gin.Context) {
	svc := service.NewLogAnalyticsService()
	if err := svc.ResetAnalytics(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("RESET_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "分析数据已重置",
	})
}

// GET /api/analytics/sync-status
func GetSyncStatus(c *gin.Context) {
	svc := service.NewLogAnalyticsService()
	data, err := svc.GetSyncStatus()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// POST /api/analytics/check-consistency
func CheckDataConsistency(c *gin.Context) {
	autoReset := c.DefaultQuery("auto_reset", "false") == "true"
	svc := service.NewLogAnalyticsService()
	data, err := svc.CheckDataConsistency(autoReset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("CHECK_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

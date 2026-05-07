package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/models"
	"github.com/new-api-tools/backend/internal/service"
)

// RegisterTopUpAnalyticsRoutes registers /api/top-ups/analytics endpoints
func RegisterTopUpAnalyticsRoutes(r *gin.RouterGroup) {
	g := r.Group("/top-ups/analytics")
	{
		g.GET("/trends", GetTopUpTrends)
		g.GET("/financial-summary", GetTopUpFinancialSummary)
		g.GET("/top-users", GetTopUpTopUsers)
		g.GET("/payment-distribution", GetPaymentMethodDistribution)
		g.GET("/realtime", GetTopUpRealtimeStats)
		g.GET("/heatmap", GetTopUpHourlyHeatmap)
		g.GET("/funnel", GetTopUpFunnel)
	}
}

// GET /api/top-ups/analytics/trends
func GetTopUpTrends(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	if days < 1 || days > 365 {
		days = 30
	}

	params := service.TopUpTrendsParams{
		Granularity: c.DefaultQuery("granularity", "daily"),
		StartDate:   c.Query("start_date"),
		EndDate:     c.Query("end_date"),
		Days:        days,
	}

	data, err := service.GetTopUpTrends(params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
	})
}

// GET /api/top-ups/analytics/financial-summary
func GetTopUpFinancialSummary(c *gin.Context) {
	months, _ := strconv.Atoi(c.DefaultQuery("months", "12"))
	if months < 1 || months > 24 {
		months = 12
	}

	data, err := service.GetTopUpFinancialSummary(months)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
	})
}

// GET /api/top-ups/analytics/top-users
func GetTopUpTopUsers(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
	if limit < 1 || limit > 50 {
		limit = 10
	}
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	if days < 1 || days > 365 {
		days = 30
	}

	data, err := service.GetTopUpTopUsers(limit, days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
	})
}

// GET /api/top-ups/analytics/payment-distribution
func GetPaymentMethodDistribution(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	if days < 1 || days > 365 {
		days = 30
	}

	data, err := service.GetPaymentMethodDistribution(days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
	})
}

// GET /api/top-ups/analytics/realtime
func GetTopUpRealtimeStats(c *gin.Context) {
	data, err := service.GetTopUpRealtimeStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
	})
}

// GET /api/top-ups/analytics/heatmap
func GetTopUpHourlyHeatmap(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	if days < 1 || days > 90 {
		days = 30
	}

	data, err := service.GetTopUpHourlyHeatmap(days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
	})
}

// GET /api/top-ups/analytics/funnel
func GetTopUpFunnel(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	if days < 1 || days > 365 {
		days = 30
	}

	data, err := service.GetTopUpFunnel(days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
	})
}

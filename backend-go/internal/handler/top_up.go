package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/models"
	"github.com/new-api-tools/backend/internal/service"
)

// RegisterTopUpRoutes registers /api/top-ups endpoints
func RegisterTopUpRoutes(r *gin.RouterGroup) {
	g := r.Group("/top-ups")
	{
		g.GET("", ListTopUps)
		g.GET("/statistics", GetTopUpStatistics)
		g.GET("/payment-methods", GetPaymentMethods)
		g.GET("/:id", GetTopUpRecord)
	}
}

// GET /api/top-ups
func ListTopUps(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	params := service.ListTopUpParams{
		Page:          page,
		PageSize:      pageSize,
		Status:        c.Query("status"),
		PaymentMethod: c.Query("payment_method"),
		TradeNo:       c.Query("trade_no"),
		StartDate:     c.Query("start_date"),
		EndDate:       c.Query("end_date"),
	}

	// Parse optional user_id
	if userIDStr := c.Query("user_id"); userIDStr != "" {
		uid, err := strconv.ParseInt(userIDStr, 10, 64)
		if err == nil {
			params.UserID = &uid
		}
	}

	result, err := service.ListTopUpRecords(params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// GET /api/top-ups/statistics
func GetTopUpStatistics(c *gin.Context) {
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")

	stats, err := service.GetTopUpStatistics(startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    stats,
	})
}

// GET /api/top-ups/payment-methods
func GetPaymentMethods(c *gin.Context) {
	methods, err := service.GetPaymentMethods()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    methods,
	})
}

// GET /api/top-ups/:id
func GetTopUpRecord(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid ID", ""))
		return
	}

	record, err := service.GetTopUpByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResp("NOT_FOUND", "Top up record not found", ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    record,
	})
}

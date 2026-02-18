package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/service"
)

// RegisterTokenRoutes registers /api/tokens endpoints
func RegisterTokenRoutes(r *gin.RouterGroup) {
	g := r.Group("/tokens")
	{
		g.GET("", ListTokens)
		g.GET("/statistics", GetTokenStatistics)
	}
}

// GET /api/tokens
func ListTokens(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	userID, _ := strconv.ParseInt(c.Query("user_id"), 10, 64)

	params := service.TokenListParams{
		Page:     page,
		PageSize: pageSize,
		Status:   c.Query("status"),
		Name:     c.Query("name"),
		UserID:   userID,
		Group:    c.Query("group"),
		Expired:  c.Query("expired"),
	}

	svc := service.NewTokenService()
	result, err := svc.ListTokens(params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to list tokens: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// GET /api/tokens/statistics
func GetTokenStatistics(c *gin.Context) {
	svc := service.NewTokenService()
	stats, err := svc.GetTokenStatistics()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to get token statistics: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    stats,
	})
}

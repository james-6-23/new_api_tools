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
		g.GET("/groups", GetTokenGroups)
		g.POST("/lookup", LookupTokens)
		g.POST("/batch-disable", BatchDisableTokens)
	}
}

// POST /api/tokens/lookup
// Body: {"keys": ["sk-xxx", ...]} — 批量按 key 精确查找令牌
func LookupTokens(c *gin.Context) {
	var req struct {
		Keys []string `json:"keys"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Keys) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请提供要查询的 key 列表",
		})
		return
	}

	svc := service.NewTokenService()
	items, err := svc.LookupTokensByKeys(req.Keys)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to lookup tokens: " + err.Error(),
		})
		return
	}

	found := 0
	for _, item := range items {
		if item.Found {
			found++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items":     items,
			"total":     len(items),
			"found":     found,
			"not_found": len(items) - found,
		},
	})
}

// POST /api/tokens/batch-disable
// Body: {"ids": [1, 2, ...]} — 批量禁用令牌（status 置 2）
func BatchDisableTokens(c *gin.Context) {
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请提供要禁用的令牌 ID 列表",
		})
		return
	}

	svc := service.NewTokenService()
	affected, err := svc.BatchDisableTokens(req.IDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to disable tokens: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"requested": len(req.IDs),
			"disabled":  affected,
		},
	})
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
		Key:      c.Query("key"),
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

// GET /api/tokens/groups
func GetTokenGroups(c *gin.Context) {
	svc := service.NewTokenService()
	groups, err := svc.GetTokenGroups()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to get token groups: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    groups,
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

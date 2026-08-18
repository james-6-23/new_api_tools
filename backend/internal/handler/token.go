package handler

import (
	"net/http"
	"strconv"
	"strings"

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
		g.POST("/batch-enable", BatchEnableTokens)
		g.GET("/ip-stats", GetTokenIPStats)
		g.GET("/suspected-leaks", GetSuspectedLeaks)
		g.GET("/:id/analysis", GetTokenAnalysis)
	}
}

// GET /api/tokens/:id/analysis?window=24h&end_time= — 单令牌画像分析
func GetTokenAnalysis(c *gin.Context) {
	tokenID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || tokenID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid token ID"})
		return
	}
	window := c.DefaultQuery("window", "24h")
	seconds, ok := service.WindowSeconds[window]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid window: " + window})
		return
	}
	var endTime *int64
	if et := c.Query("end_time"); et != "" {
		if v, err := strconv.ParseInt(et, 10, 64); err == nil {
			endTime = &v
		}
	}

	svc := service.NewTokenService()
	data, err := svc.GetTokenAnalysis(tokenID, seconds, endTime)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to get token analysis: " + err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// POST /api/tokens/batch-enable
// Body: {"ids": [1, 2, ...]} — 批量启用手动禁用的令牌（status 2 → 1）
func BatchEnableTokens(c *gin.Context) {
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请提供要启用的令牌 ID 列表",
		})
		return
	}

	svc := service.NewTokenService()
	affected, err := svc.BatchEnableTokens(req.IDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to enable tokens: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"requested": len(req.IDs),
			"enabled":   affected,
		},
	})
}

// GET /api/tokens/ip-stats?hours=24&ids=1,2,3 — 指定令牌窗口期去重 IP 数
func GetTokenIPStats(c *gin.Context) {
	hours, _ := strconv.Atoi(c.DefaultQuery("hours", "24"))
	var ids []int64
	for _, part := range strings.Split(c.Query("ids"), ",") {
		if id, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64); err == nil && id > 0 {
			ids = append(ids, id)
		}
	}

	svc := service.NewTokenService()
	items, err := svc.GetTokenIPStats(hours, ids)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to get token ip stats: " + err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

// GET /api/tokens/suspected-leaks?hours=24&min_ips=5&limit=100 — 多 IP 疑似泄漏令牌
func GetSuspectedLeaks(c *gin.Context) {
	hours, _ := strconv.Atoi(c.DefaultQuery("hours", "24"))
	minIPs, _ := strconv.Atoi(c.DefaultQuery("min_ips", "5"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))

	svc := service.NewTokenService()
	items, err := svc.GetSuspectedLeaks(hours, minIPs, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to get suspected leaks: " + err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
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
		Risk:     c.Query("risk"),
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

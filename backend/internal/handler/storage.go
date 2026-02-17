package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/cache"
	"github.com/new-api-tools/backend/internal/models"
)

// RegisterStorageRoutes registers /api/storage endpoints
func RegisterStorageRoutes(r *gin.RouterGroup) {
	g := r.Group("/storage")
	{
		// Config endpoints
		g.GET("/config", GetAllConfigs)
		g.GET("/config/:key", GetConfig)
		g.POST("/config", SetConfig)
		g.DELETE("/config/:key", DeleteConfig)

		// Cache management
		g.GET("/cache/info", GetCacheInfo)
		g.GET("/cache/stats", GetCacheStats)
		g.POST("/cache/cleanup", CleanupCache)
		g.POST("/cache/cleanup-expired", CleanupExpiredCache)
		g.DELETE("/cache", ClearAllCache)
		g.DELETE("/cache/dashboard", ClearDashboardCache)

		// Storage info
		g.GET("/info", GetStorageInfo)
	}
}

// GET /api/storage/config
func GetAllConfigs(c *gin.Context) {
	cm := cache.Get()
	configs, err := cm.GetAllHashFields("app:config")
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": map[string]interface{}{}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": configs})
}

// GET /api/storage/config/:key
func GetConfig(c *gin.Context) {
	key := c.Param("key")
	cm := cache.Get()

	value, err := cm.HashGet("app:config", key)
	if err != nil || value == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "Configuration key '" + key + "' not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"key": key, "value": value},
	})
}

// POST /api/storage/config
func SetConfig(c *gin.Context) {
	var req struct {
		Key         string      `json:"key" binding:"required"`
		Value       interface{} `json:"value" binding:"required"`
		Description string      `json:"description"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid request body", err.Error()))
		return
	}

	cm := cache.Get()
	if err := cm.HashSet("app:config", req.Key, req.Value); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("STORAGE_ERROR", "Failed to save config", err.Error()))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Configuration '" + req.Key + "' saved successfully",
		"data":    gin.H{"key": req.Key, "value": req.Value},
	})
}

// DELETE /api/storage/config/:key
func DeleteConfig(c *gin.Context) {
	key := c.Param("key")
	cm := cache.Get()

	deleted, err := cm.HashDelete("app:config", key)
	if err != nil || !deleted {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "Configuration '" + key + "' not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Configuration '" + key + "' deleted successfully",
	})
}

// GET /api/storage/cache/info
func GetCacheInfo(c *gin.Context) {
	cm := cache.Get()
	info := cm.GetStats()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    info,
	})
}

// GET /api/storage/cache/stats
func GetCacheStats(c *gin.Context) {
	cm := cache.Get()
	stats := cm.GetStats()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    stats,
	})
}

// POST /api/storage/cache/cleanup
func CleanupCache(c *gin.Context) {
	// Redis handles TTL-based expiration automatically
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Cache cleanup completed",
		"data":    gin.H{"deleted": 0},
	})
}

// POST /api/storage/cache/cleanup-expired
func CleanupExpiredCache(c *gin.Context) {
	// Redis handles expiration automatically
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Cleaned up expired cache entries",
		"data":    gin.H{"deleted": 0},
	})
}

// DELETE /api/storage/cache
func ClearAllCache(c *gin.Context) {
	cm := cache.Get()
	cm.ClearLocal()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Cache cleared",
		"data":    gin.H{"deleted": 0},
	})
}

// DELETE /api/storage/cache/dashboard
func ClearDashboardCache(c *gin.Context) {
	cm := cache.Get()
	cm.DeleteLocal("dashboard:")

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Dashboard cache cleared",
		"data":    gin.H{"deleted": 0},
	})
}

// GET /api/storage/info
func GetStorageInfo(c *gin.Context) {
	cm := cache.Get()
	stats := cm.GetStats()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    stats,
	})
}

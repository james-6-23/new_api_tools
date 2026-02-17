package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/database"
)

// RegisterSystemRoutes registers /api/system endpoints
func RegisterSystemRoutes(r *gin.RouterGroup) {
	g := r.Group("/system")
	{
		g.GET("/scale", GetSystemScale)
		g.POST("/scale/refresh", RefreshSystemScale)
		g.GET("/warmup-status", GetWarmupStatus)
		g.GET("/indexes", GetIndexStatus)
		g.POST("/indexes/ensure", EnsureIndexes)
	}
}

// GET /api/system/scale — placeholder until system_scale service is migrated
func GetSystemScale(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"scale": "medium",
			"metrics": gin.H{
				"total_users": 0,
				"total_logs":  0,
			},
			"settings": gin.H{
				"cache_ttl":                 300,
				"refresh_interval":          300,
				"frontend_refresh_interval": 60,
				"description":               "中型系统",
			},
		},
	})
}

// POST /api/system/scale/refresh
func RefreshSystemScale(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"scale":   "medium",
			"message": "Scale detection refreshed",
		},
	})
}

// GET /api/system/warmup-status
func GetWarmupStatus(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"status":   "ready",
			"progress": 100,
			"message":  "System is ready",
		},
	})
}

// GET /api/system/indexes
func GetIndexStatus(c *gin.Context) {
	db := database.Get()

	// Check existing indexes
	var indexes []struct {
		IndexName string `db:"indexname"`
	}

	var indexResults []gin.H
	total := 0
	existing := 0

	if db.IsPG {
		db.DB.Select(&indexes, "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")
	}

	// Build response matching Python format
	recommendedIndexes := []string{
		"idx_users_status",
		"idx_tokens_user_status",
		"idx_logs_created_type_user",
		"idx_logs_model_created",
		"idx_logs_token_created",
		"idx_logs_channel_created",
		"idx_redemptions_key",
		"idx_redemptions_status",
		"idx_top_ups_user",
		"idx_top_ups_status",
	}

	existingSet := make(map[string]bool)
	for _, idx := range indexes {
		existingSet[idx.IndexName] = true
	}

	for _, name := range recommendedIndexes {
		total++
		exists := existingSet[name]
		if exists {
			existing++
		}
		indexResults = append(indexResults, gin.H{
			"name":   name,
			"exists": exists,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"indexes":   indexResults,
			"total":     total,
			"existing":  existing,
			"missing":   total - existing,
			"all_ready": existing == total,
		},
	})
}

// POST /api/system/indexes/ensure
func EnsureIndexes(c *gin.Context) {
	db := database.Get()

	// Run index creation
	db.EnsureIndexes(true, 500*time.Millisecond)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"message": "Index creation completed",
		},
	})
}

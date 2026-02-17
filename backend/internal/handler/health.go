package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/database"
	"github.com/new-api-tools/backend/internal/models"
)

// RegisterHealthRoutes registers health check endpoints
func RegisterHealthRoutes(r *gin.Engine) {
	r.GET("/api/health", HealthCheck)
	r.GET("/api/health/db", DatabaseHealthCheck)
}

// HealthCheck handles GET /api/health
// Matches Python: {"status": "healthy", "version": "0.1.0"}
func HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, models.HealthResponse{
		Status:  "healthy",
		Version: "0.1.0",
	})
}

// DatabaseHealthCheck handles GET /api/health/db
// Matches Python's database_health_check
func DatabaseHealthCheck(c *gin.Context) {
	db := database.Get()

	if err := db.Ping(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"status":  "disconnected",
			"error": gin.H{
				"code":    "DB_CONNECTION_FAILED",
				"message": err.Error(),
			},
		})
		return
	}

	engineStr := "mysql"
	if db.IsPG {
		engineStr = "postgresql"
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"status":  "connected",
		"engine":  engineStr,
	})
}

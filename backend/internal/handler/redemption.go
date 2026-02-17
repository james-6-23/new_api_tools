package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/models"
	"github.com/new-api-tools/backend/internal/service"
)

// RegisterRedemptionRoutes registers /api/redemptions endpoints
func RegisterRedemptionRoutes(r *gin.RouterGroup) {
	g := r.Group("/redemptions")
	{
		g.POST("/generate", GenerateRedemptionCodes)
		g.GET("", ListRedemptionCodes)
		g.GET("/statistics", GetRedemptionStatistics)
		g.POST("/batch-delete", BatchDeleteRedemptionCodes)
		g.DELETE("/batch", BatchDeleteRedemptionCodes)
		g.POST("/batch", BatchDeleteRedemptionCodes)
		g.DELETE("/:id", DeleteRedemptionCode)
	}
}

// POST /api/redemption/generate
func GenerateRedemptionCodes(c *gin.Context) {
	var req service.GenerateParams
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid request body", err.Error()))
		return
	}

	result, err := service.GenerateCodes(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("GENERATION_ERROR", err.Error(), ""))
		return
	}

	if !result.Success {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("GENERATION_FAILED", result.Message, ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": result.Message,
		"data": gin.H{
			"keys":  result.Keys,
			"count": result.Count,
		},
	})
}

// GET /api/redemption
func ListRedemptionCodes(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	params := service.ListRedemptionParams{
		Page:      page,
		PageSize:  pageSize,
		Name:      c.Query("name"),
		Status:    c.Query("status"),
		StartDate: c.Query("start_date"),
		EndDate:   c.Query("end_date"),
	}

	result, err := service.ListCodes(params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// GET /api/redemption/statistics
func GetRedemptionStatistics(c *gin.Context) {
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")

	stats, err := service.GetRedemptionStatistics(startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    stats,
	})
}

// POST /api/redemption/batch-delete
func BatchDeleteRedemptionCodes(c *gin.Context) {
	var req struct {
		IDs []int64 `json:"ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid request body", err.Error()))
		return
	}

	affected, err := service.DeleteCodes(req.IDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("DELETE_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Redemption codes deleted successfully",
		"data":    gin.H{"deleted": affected},
	})
}

// DELETE /api/redemption/:id
func DeleteRedemptionCode(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid ID", ""))
		return
	}

	affected, err := service.DeleteCodes([]int64{id})
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("DELETE_ERROR", err.Error(), ""))
		return
	}

	if affected == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResp("NOT_FOUND", "Redemption code not found", ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Redemption code deleted successfully",
	})
}

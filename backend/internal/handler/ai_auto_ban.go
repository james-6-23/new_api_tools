package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/models"
	"github.com/new-api-tools/backend/internal/service"
)

// RegisterAIAutoBanRoutes registers /api/ai-ban endpoints
func RegisterAIAutoBanRoutes(r *gin.RouterGroup) {
	g := r.Group("/ai-ban")
	{
		g.GET("/config", GetAIBanConfig)
		g.POST("/config", SaveAIBanConfig)
		g.POST("/reset-api-health", ResetAPIHealth)
		g.GET("/audit-logs", GetAuditLogs)
		g.DELETE("/audit-logs", ClearAuditLogs)
		g.GET("/groups", GetAvailableGroupsForBan)
		g.GET("/available-groups", GetAvailableGroupsForBan)
		g.GET("/models", GetAvailableModelsForExclude)
		g.GET("/available-models-for-exclude", GetAvailableModelsForExclude)
		g.GET("/suspicious", GetSuspiciousUsers)
		g.GET("/suspicious-users", GetSuspiciousUsers)
		g.POST("/assess", ManualAssess)
		g.POST("/scan", RunAIBanScan)
		g.POST("/test-connection", TestAIConnection)
		g.GET("/whitelist", GetAIBanWhitelist)
		g.POST("/whitelist/add", AddToAIBanWhitelist)
		g.POST("/whitelist/remove", RemoveFromAIBanWhitelist)
		g.GET("/whitelist/search", SearchUserForAIWhitelist)
		// Model fetching / testing
		g.POST("/models", FetchAIModels)       // 前端实际调用的路径
		g.POST("/fetch-models", FetchAIModels) // 保持向后兼容
		g.POST("/test-model", TestAIModel)
	}
}

// GET /api/ai-ban/config
func GetAIBanConfig(c *gin.Context) {
	svc := service.NewAIAutoBanService()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": svc.GetConfig()})
}

// POST /api/ai-ban/config
func SaveAIBanConfig(c *gin.Context) {
	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid request body", err.Error()))
		return
	}
	svc := service.NewAIAutoBanService()
	if err := svc.SaveConfig(req); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("SAVE_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "配置已保存",
		"data":    svc.GetConfig(),
	})
}

// POST /api/ai-ban/reset-api-health
func ResetAPIHealth(c *gin.Context) {
	svc := service.NewAIAutoBanService()
	data := svc.ResetAPIHealth()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/ai-ban/audit-logs
func GetAuditLogs(c *gin.Context) {
	limit := parseLimit(c, 50, 500)
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if offset < 0 {
		offset = 0
	}
	status := c.Query("status")

	svc := service.NewAIAutoBanService()
	data := svc.GetAuditLogs(limit, offset, status)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// DELETE /api/ai-ban/audit-logs
func ClearAuditLogs(c *gin.Context) {
	svc := service.NewAIAutoBanService()
	data := svc.ClearAuditLogs()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/ai-ban/groups
func GetAvailableGroupsForBan(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	svc := service.NewAIAutoBanService()
	data, err := svc.GetAvailableGroups(days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/ai-ban/models
func GetAvailableModelsForExclude(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	svc := service.NewAIAutoBanService()
	data, err := svc.GetAvailableModelsForExclude(days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/ai-ban/suspicious
func GetSuspiciousUsers(c *gin.Context) {
	window := c.DefaultQuery("window", "1h")
	if !validWindow(window) {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid window value", ""))
		return
	}
	limit := parseLimit(c, 20, 200)

	svc := service.NewAIAutoBanService()
	data, err := svc.GetSuspiciousUsers(window, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// POST /api/ai-ban/assess
func ManualAssess(c *gin.Context) {
	var req struct {
		UserID int64  `json:"user_id"`
		Window string `json:"window"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid request", err.Error()))
		return
	}
	if req.Window == "" {
		req.Window = "1h"
	}
	svc := service.NewAIAutoBanService()
	data := svc.ManualAssess(req.UserID, req.Window)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// POST /api/ai-ban/scan
func RunAIBanScan(c *gin.Context) {
	window := c.DefaultQuery("window", "1h")
	if !validWindow(window) {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid window value", ""))
		return
	}
	limit := parseLimit(c, 10, 100)

	svc := service.NewAIAutoBanService()
	data := svc.RunScan(window, limit)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// POST /api/ai-ban/test-connection
func TestAIConnection(c *gin.Context) {
	svc := service.NewAIAutoBanService()
	data := svc.TestConnection()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/ai-ban/whitelist
func GetAIBanWhitelist(c *gin.Context) {
	svc := service.NewAIAutoBanService()
	data := svc.GetWhitelist()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// POST /api/ai-ban/whitelist/add
func AddToAIBanWhitelist(c *gin.Context) {
	var req struct {
		UserID int64 `json:"user_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid request", err.Error()))
		return
	}
	svc := service.NewAIAutoBanService()
	data := svc.AddToWhitelist(req.UserID)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// POST /api/ai-ban/whitelist/remove
func RemoveFromAIBanWhitelist(c *gin.Context) {
	var req struct {
		UserID int64 `json:"user_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid request", err.Error()))
		return
	}
	svc := service.NewAIAutoBanService()
	data := svc.RemoveFromWhitelist(req.UserID)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/ai-ban/whitelist/search
func SearchUserForAIWhitelist(c *gin.Context) {
	q := c.Query("q")
	if q == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Missing search keyword", ""))
		return
	}
	svc := service.NewAIAutoBanService()
	data, err := svc.SearchUserForWhitelist(q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// POST /api/ai-ban/models or /api/ai-ban/fetch-models
func FetchAIModels(c *gin.Context) {
	var req struct {
		BaseURL      string `json:"base_url"`
		APIKey       string `json:"api_key"`
		ForceRefresh bool   `json:"force_refresh"`
	}
	c.ShouldBindJSON(&req)
	svc := service.NewAIAutoBanService()
	result := svc.FetchModels(req.BaseURL, req.APIKey, req.ForceRefresh)
	c.JSON(http.StatusOK, result)
}

// POST /api/ai-ban/test-model
func TestAIModel(c *gin.Context) {
	var req struct {
		BaseURL string `json:"base_url"`
		APIKey  string `json:"api_key"`
		Model   string `json:"model"`
	}
	c.ShouldBindJSON(&req)
	svc := service.NewAIAutoBanService()
	result := svc.TestModel(req.BaseURL, req.APIKey, req.Model)
	c.JSON(http.StatusOK, result)
}

package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/models"
	"github.com/new-api-tools/backend/internal/service"
)

// RegisterPanelWhitelistRoutes registers /api/panel-whitelist endpoints (#17)
func RegisterPanelWhitelistRoutes(r *gin.RouterGroup) {
	g := r.Group("/panel-whitelist")
	{
		g.GET("", GetPanelWhitelist)
		g.PUT("", SavePanelWhitelist)
		g.POST("/add", AddPanelWhitelistUser)
		g.POST("/remove", RemovePanelWhitelistUser)
		g.GET("/search", SearchPanelWhitelistUsers)
	}
}

// GET /api/panel-whitelist
func GetPanelWhitelist(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    service.ListPanelWhitelistUsers(),
	})
}

// PUT /api/panel-whitelist
func SavePanelWhitelist(c *gin.Context) {
	var req struct {
		UserIDs       []int64 `json:"user_ids"`
		ExcludeAdmins *bool   `json:"exclude_admins"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid request body", err.Error()))
		return
	}
	cfg := service.GetPanelWhitelistConfig()
	if req.UserIDs != nil {
		cfg.UserIDs = req.UserIDs
	}
	if req.ExcludeAdmins != nil {
		cfg.ExcludeAdmins = *req.ExcludeAdmins
	}
	if err := service.SavePanelWhitelistConfig(cfg); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("SAVE_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "全局面板白名单已保存",
		"data":    service.ListPanelWhitelistUsers(),
	})
}

// POST /api/panel-whitelist/add
func AddPanelWhitelistUser(c *gin.Context) {
	var req struct {
		UserID int64 `json:"user_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.UserID <= 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "user_id is required", ""))
		return
	}
	if err := service.AddPanelWhitelistUser(req.UserID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("SAVE_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "已加入全局面板白名单",
		"data":    service.ListPanelWhitelistUsers(),
	})
}

// POST /api/panel-whitelist/remove
func RemovePanelWhitelistUser(c *gin.Context) {
	var req struct {
		UserID int64 `json:"user_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.UserID <= 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "user_id is required", ""))
		return
	}
	if err := service.RemovePanelWhitelistUser(req.UserID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("SAVE_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "已从全局面板白名单移除",
		"data":    service.ListPanelWhitelistUsers(),
	})
}

// GET /api/panel-whitelist/search?q=
func SearchPanelWhitelistUsers(c *gin.Context) {
	q := c.Query("q")
	if q == "" {
		q = c.Query("keyword")
	}
	rows, err := service.SearchUsersForPanelWhitelist(q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

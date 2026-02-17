package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/models"
	"github.com/new-api-tools/backend/internal/service"
)

func RegisterUserManagementRoutes(r *gin.RouterGroup) {
	g := r.Group("/users")
	{
		g.GET("/activity-stats", GetActivityStats)
		g.GET("/stats", GetActivityStats)
		g.GET("/banned", GetBannedUsers)
		g.GET("", GetUsers)
		g.DELETE("/:user_id", DeleteUser)
		g.POST("/batch-delete", BatchDeleteInactiveUsers)
		g.GET("/soft-deleted/count", GetSoftDeletedCount)
		g.POST("/soft-deleted/purge", PurgeSoftDeletedUsers)
		g.POST("/:user_id/ban", BanUser)
		g.POST("/:user_id/unban", UnbanUser)
		g.GET("/:user_id/invited", GetInvitedUsers)
		g.POST("/tokens/:token_id/disable", DisableToken)
	}
}

// GET /api/users/activity-stats
func GetActivityStats(c *gin.Context) {
	quick := c.DefaultQuery("quick", "false") == "true"
	svc := service.NewUserManagementService()

	stats, err := svc.GetActivityStats(quick)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": stats})
}

// GET /api/users/banned
func GetBannedUsers(c *gin.Context) {
	page := parsePage(c)
	pageSize := parsePageSize(c, 50, 200)
	search := c.Query("search")

	svc := service.NewUserManagementService()
	result, err := svc.GetBannedUsers(page, pageSize, search)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

// GET /api/users
func GetUsers(c *gin.Context) {
	page := parsePage(c)
	pageSize := parsePageSize(c, 20, 200)

	params := service.ListUsersParams{
		Page:           page,
		PageSize:       pageSize,
		ActivityFilter: c.Query("activity"),
		GroupFilter:    c.Query("group"),
		SourceFilter:   c.Query("source"),
		Search:         c.Query("search"),
		OrderBy:        c.DefaultQuery("order_by", "request_count"),
		OrderDir:       c.DefaultQuery("order_dir", "DESC"),
	}

	svc := service.NewUserManagementService()
	result, err := svc.GetUsers(params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

// DELETE /api/users/:user_id
func DeleteUser(c *gin.Context) {
	userID, err := strconv.ParseInt(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid user ID", ""))
		return
	}

	hardDelete := c.DefaultQuery("hard_delete", "false") == "true"
	svc := service.NewUserManagementService()
	affected, err := svc.DeleteUser(userID, hardDelete)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("DELETE_ERROR", err.Error(), ""))
		return
	}
	if affected == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResp("NOT_FOUND", "User not found", ""))
		return
	}

	action := "注销"
	if hardDelete {
		action = "彻底删除"
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "用户已" + action,
		"data":    gin.H{"affected": affected},
	})
}

// POST /api/users/batch-delete
func BatchDeleteInactiveUsers(c *gin.Context) {
	var req struct {
		ActivityLevel string `json:"activity_level"`
		DryRun        bool   `json:"dry_run"`
		HardDelete    bool   `json:"hard_delete"`
	}
	req.ActivityLevel = "very_inactive"
	req.DryRun = true

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid request body", err.Error()))
		return
	}

	svc := service.NewUserManagementService()
	result, err := svc.BatchDeleteInactiveUsers(req.ActivityLevel, req.DryRun, req.HardDelete)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("DELETE_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

// GET /api/users/soft-deleted/count
func GetSoftDeletedCount(c *gin.Context) {
	svc := service.NewUserManagementService()
	count, err := svc.GetSoftDeletedCount()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"count": count}})
}

// POST /api/users/soft-deleted/purge
func PurgeSoftDeletedUsers(c *gin.Context) {
	var req struct {
		DryRun bool `json:"dry_run"`
	}
	req.DryRun = true
	c.ShouldBindJSON(&req)

	svc := service.NewUserManagementService()
	affected, err := svc.PurgeSoftDeleted(req.DryRun)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("DELETE_ERROR", err.Error(), ""))
		return
	}

	message := "预览完成"
	if !req.DryRun {
		message = "清理完成"
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": message,
		"data":    gin.H{"affected": affected},
	})
}

// POST /api/users/:user_id/ban
func BanUser(c *gin.Context) {
	userID, err := strconv.ParseInt(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid user ID", ""))
		return
	}

	var req struct {
		Reason        string `json:"reason"`
		DisableTokens bool   `json:"disable_tokens"`
	}
	req.DisableTokens = true
	c.ShouldBindJSON(&req)

	svc := service.NewUserManagementService()
	if err := svc.BanUser(userID, req.DisableTokens); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("BAN_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "用户已封禁",
	})
}

// POST /api/users/:user_id/unban
func UnbanUser(c *gin.Context) {
	userID, err := strconv.ParseInt(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid user ID", ""))
		return
	}

	var req struct {
		Reason       string `json:"reason"`
		EnableTokens bool   `json:"enable_tokens"`
	}
	c.ShouldBindJSON(&req)

	svc := service.NewUserManagementService()
	if err := svc.UnbanUser(userID, req.EnableTokens); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("UNBAN_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "用户已解封",
	})
}

// POST /api/users/tokens/:token_id/disable
func DisableToken(c *gin.Context) {
	tokenID, err := strconv.ParseInt(c.Param("token_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid token ID", ""))
		return
	}

	svc := service.NewUserManagementService()
	if err := svc.DisableToken(tokenID); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("DISABLE_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Token 已禁用",
	})
}

// GET /api/users/:user_id/invited
func GetInvitedUsers(c *gin.Context) {
	userID, err := strconv.ParseInt(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid user ID", ""))
		return
	}

	page := parsePage(c)
	pageSize := parsePageSize(c, 20, 200)

	svc := service.NewUserManagementService()
	data, err := svc.GetInvitedUsers(userID, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

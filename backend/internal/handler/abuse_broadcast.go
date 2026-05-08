package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/models"
	"github.com/new-api-tools/backend/internal/service"
)

// RegisterAbuseBroadcastRoutes registers /api/abuse-broadcast endpoints.
func RegisterAbuseBroadcastRoutes(r *gin.RouterGroup) {
	g := r.Group("/abuse-broadcast")
	{
		g.GET("/status", GetAbuseBroadcastStatus)
		g.GET("/settings", GetAbuseBroadcastSettings)
		g.PUT("/settings", UpdateAbuseBroadcastSettings)
		g.POST("/connect", ConnectAbuseBroadcast)
		g.POST("/sync", SyncAbuseBroadcast)
		g.GET("/reports", ListAbuseBroadcastReports)
		g.POST("/reports/:report_id/read", MarkAbuseBroadcastReportRead)
		g.GET("/reports/:report_id/matches", MatchAbuseBroadcastReport)
		g.GET("/unread-count", GetAbuseBroadcastUnreadCount)
		g.GET("/outgoing-reports", ListAbuseBroadcastOutgoingReports)
		g.POST("/report-user", ReportAbuseBroadcastUser)
	}
}

// GET /api/abuse-broadcast/settings
func GetAbuseBroadcastSettings(c *gin.Context) {
	svc := service.NewAbuseBroadcastService()
	data, err := svc.GetSettings(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("ABUSE_BROADCAST_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// PUT /api/abuse-broadcast/settings
func UpdateAbuseBroadcastSettings(c *gin.Context) {
	var input service.AbuseBroadcastSettingsInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "invalid JSON body", ""))
		return
	}
	svc := service.NewAbuseBroadcastService()
	data, err := svc.UpdateSettings(c.Request.Context(), input)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("ABUSE_BROADCAST_SETTINGS_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data, "message": "已保存"})
}

// GET /api/abuse-broadcast/status
func GetAbuseBroadcastStatus(c *gin.Context) {
	svc := service.NewAbuseBroadcastService()
	data, err := svc.Status(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("ABUSE_BROADCAST_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// POST /api/abuse-broadcast/connect
func ConnectAbuseBroadcast(c *gin.Context) {
	svc := service.NewAbuseBroadcastService()
	data, err := svc.Connect(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("ABUSE_BROADCAST_CONNECT_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// POST /api/abuse-broadcast/sync
func SyncAbuseBroadcast(c *gin.Context) {
	svc := service.NewAbuseBroadcastService()
	data, err := svc.SyncOnce(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("ABUSE_BROADCAST_SYNC_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/abuse-broadcast/reports
func ListAbuseBroadcastReports(c *gin.Context) {
	limit := parseLimit(c, 50, 200)
	svc := service.NewAbuseBroadcastService()
	data, err := svc.ListReports(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("ABUSE_BROADCAST_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// POST /api/abuse-broadcast/report-user
func ReportAbuseBroadcastUser(c *gin.Context) {
	var req service.AbuseBroadcastReportUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "invalid JSON body", ""))
		return
	}
	svc := service.NewAbuseBroadcastService()
	data, err := svc.ReportUser(c.Request.Context(), req)
	if err != nil {
		if errors.Is(err, service.ErrAbuseBroadcastNotConnected) {
			c.JSON(http.StatusBadRequest, models.ErrorResp("ABUSE_BROADCAST_NOT_CONNECTED", err.Error(), ""))
			return
		}
		c.JSON(http.StatusBadRequest, models.ErrorResp("ABUSE_BROADCAST_REPORT_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data, "message": "通报成功"})
}

// GET /api/abuse-broadcast/outgoing-reports
func ListAbuseBroadcastOutgoingReports(c *gin.Context) {
	limit := parseLimit(c, 50, 200)
	svc := service.NewAbuseBroadcastService()
	data, err := svc.ListOutgoingReports(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("ABUSE_BROADCAST_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /api/abuse-broadcast/unread-count
func GetAbuseBroadcastUnreadCount(c *gin.Context) {
	svc := service.NewAbuseBroadcastService()
	data, err := svc.UnreadCount(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("ABUSE_BROADCAST_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// POST /api/abuse-broadcast/reports/:report_id/read
func MarkAbuseBroadcastReportRead(c *gin.Context) {
	reportID := strings.TrimSpace(c.Param("report_id"))
	svc := service.NewAbuseBroadcastService()
	if err := svc.MarkReportRead(c.Request.Context(), reportID); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("ABUSE_BROADCAST_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"ok": true}})
}

// GET /api/abuse-broadcast/reports/:report_id/matches
func MatchAbuseBroadcastReport(c *gin.Context) {
	reportID := strings.TrimSpace(c.Param("report_id"))
	svc := service.NewAbuseBroadcastService()
	data, err := svc.MatchReport(c.Request.Context(), reportID)
	if err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "not found") {
			status = http.StatusNotFound
		}
		c.JSON(status, models.ErrorResp("ABUSE_BROADCAST_MATCH_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

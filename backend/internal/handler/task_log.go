package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/service"
)

// RegisterTaskLogRoutes registers /api/task-logs endpoints
func RegisterTaskLogRoutes(r *gin.RouterGroup) {
	g := r.Group("/task-logs")
	{
		g.GET("", ListTaskLogs)
		g.GET("/statistics", GetTaskLogStatistics)
		g.GET("/:id/related-logs", GetTaskRelatedLogs)
	}
}

// GET /api/task-logs
func ListTaskLogs(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	userID, _ := strconv.ParseInt(c.Query("user_id"), 10, 64)

	params := service.TaskListParams{
		Page:     page,
		PageSize: pageSize,
		Username: c.Query("username"),
		UserID:   userID,
		Platform: c.Query("platform"),
		Status:   c.Query("status"),
		TaskID:   c.Query("task_id"),
	}

	svc := service.NewTaskLogService()
	result, err := svc.ListTasks(params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to list tasks: " + err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

// GET /api/task-logs/statistics
func GetTaskLogStatistics(c *gin.Context) {
	svc := service.NewTaskLogService()
	result, err := svc.GetTaskStatistics()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to get task statistics: " + err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

// GET /api/task-logs/:id/related-logs — 任务关联的使用日志（精确 + 启发式）
func GetTaskRelatedLogs(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid task ID"})
		return
	}

	svc := service.NewTaskLogService()
	result, err := svc.GetTaskRelatedLogs(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to get related logs: " + err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

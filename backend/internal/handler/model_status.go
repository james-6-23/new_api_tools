package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/models"
	"github.com/new-api-tools/backend/internal/service"
)

// RegisterModelStatusRoutes registers /api/model-status endpoints (auth required)
func RegisterModelStatusRoutes(r *gin.RouterGroup) {
	g := r.Group("/model-status")
	{
		g.GET("/time-windows", GetTimeWindows)
		g.GET("/models", GetAvailableModels)
		g.GET("/status/:model_name", GetSingleModelStatus)
		g.POST("/status/multiple", GetMultipleModelsStatusHandler)
		g.POST("/status/batch", GetMultipleModelsStatusHandler)
		g.GET("/status/all", GetAllModelsStatusHandler)
		g.GET("/selected", GetSelectedModels)
		g.PUT("/selected", SetSelectedModels)
		g.GET("/config/selected", GetSelectedModels)
		g.POST("/config/selected", SetSelectedModels)
		g.GET("/config/time-window", GetTimeWindowConfig)
		g.PUT("/config/time-window", SetTimeWindowConfig)
		g.PUT("/config/window", SetTimeWindowConfig)
		g.POST("/config/window", SetTimeWindowConfig)
		g.GET("/config/theme", GetThemeConfig)
		g.PUT("/config/theme", SetThemeConfig)
		g.POST("/config/theme", SetThemeConfig)
		g.GET("/config/refresh-interval", GetRefreshIntervalConfig)
		g.PUT("/config/refresh-interval", SetRefreshIntervalConfig)
		g.PUT("/config/refresh", SetRefreshIntervalConfig)
		g.POST("/config/refresh", SetRefreshIntervalConfig)
		g.GET("/config/sort-mode", GetSortModeConfig)
		g.PUT("/config/sort-mode", SetSortModeConfig)
		g.PUT("/config/sort", SetSortModeConfig)
		g.POST("/config/sort", SetSortModeConfig)
		g.PUT("/config/custom-order", SetCustomOrderConfig)
	}

}

// RegisterModelStatusEmbedRoutes registers public embed endpoints (no auth)
// Supports both /api/embed/model-status/... and /api/model-status/embed/... paths
func RegisterModelStatusEmbedRoutes(r *gin.Engine) {
	// Original embed path: /api/embed/model-status/...
	g := r.Group("/api/embed/model-status")
	{
		g.GET("/time-windows", GetTimeWindows)
		g.GET("/models", GetAvailableModels)
		g.GET("/status/:model_name", GetSingleModelStatus)
		g.POST("/status/multiple", GetMultipleModelsStatusHandler)
		g.POST("/status/batch", GetMultipleModelsStatusHandler)
		g.GET("/status/all", GetAllModelsStatusHandler)
		g.GET("/config", GetEmbedConfig)
		g.GET("/config/selected", GetSelectedModels)
	}

	// Compat embed path: /api/model-status/embed/... (used by embed.html frontend)
	e := r.Group("/api/model-status/embed")
	{
		e.GET("/time-windows", GetTimeWindows)
		e.GET("/models", GetAvailableModels)
		e.GET("/status/:model_name", GetSingleModelStatus)
		e.POST("/status/multiple", GetMultipleModelsStatusHandler)
		e.POST("/status/batch", GetMultipleModelsStatusHandler)
		e.GET("/status/all", GetAllModelsStatusHandler)
		e.GET("/config", GetEmbedConfig)
		e.GET("/config/selected", GetSelectedModels)
	}
}

// GET /time-windows
func GetTimeWindows(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    service.AvailableTimeWindows,
		"default": service.DefaultTimeWindow,
	})
}

// GET /models
func GetAvailableModels(c *gin.Context) {
	svc := service.NewModelStatusService()
	data, err := svc.GetAvailableModels()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// GET /status/:model_name
func GetSingleModelStatus(c *gin.Context) {
	modelName := c.Param("model_name")
	window := c.DefaultQuery("window", service.DefaultTimeWindow)

	svc := service.NewModelStatusService()
	data, err := svc.GetModelStatus(modelName, window)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// POST /status/multiple
func GetMultipleModelsStatusHandler(c *gin.Context) {
	var modelNames []string
	if err := c.ShouldBindJSON(&modelNames); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Expected array of model names", err.Error()))
		return
	}
	window := c.DefaultQuery("window", service.DefaultTimeWindow)

	svc := service.NewModelStatusService()
	data, err := svc.GetMultipleModelsStatus(modelNames, window)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"data":        data,
		"time_window": window,
		"cache_ttl":   60,
	})
}

// GET /status/all
func GetAllModelsStatusHandler(c *gin.Context) {
	window := c.DefaultQuery("window", service.DefaultTimeWindow)

	svc := service.NewModelStatusService()
	data, err := svc.GetAllModelsStatus(window)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"data":        data,
		"time_window": window,
		"cache_ttl":   60,
	})
}

// GET /selected
func GetSelectedModels(c *gin.Context) {
	svc := service.NewModelStatusService()
	config := svc.GetConfig()
	c.JSON(http.StatusOK, gin.H{
		"success":          true,
		"data":             config["selected_models"],
		"time_window":      config["time_window"],
		"theme":            config["theme"],
		"refresh_interval": config["refresh_interval"],
		"sort_mode":        config["sort_mode"],
		"custom_order":     config["custom_order"],
	})
}

// PUT /selected
func SetSelectedModels(c *gin.Context) {
	var req struct {
		Models []string `json:"models"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid request", err.Error()))
		return
	}
	svc := service.NewModelStatusService()
	svc.SetSelectedModels(req.Models)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    req.Models,
		"message": "Selected models updated",
	})
}

// GET /config/time-window
func GetTimeWindowConfig(c *gin.Context) {
	svc := service.NewModelStatusService()
	config := svc.GetConfig()
	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"time_window": config["time_window"],
	})
}

// PUT /config/time-window
func SetTimeWindowConfig(c *gin.Context) {
	var req struct {
		TimeWindow string `json:"time_window"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid request", err.Error()))
		return
	}
	// Validate
	valid := false
	for _, w := range service.AvailableTimeWindows {
		if w == req.TimeWindow {
			valid = true
			break
		}
	}
	if !valid {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid time window", ""))
		return
	}
	svc := service.NewModelStatusService()
	svc.SetTimeWindow(req.TimeWindow)
	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"time_window": req.TimeWindow,
		"message":     "Time window updated",
	})
}

// GET /config/theme
func GetThemeConfig(c *gin.Context) {
	svc := service.NewModelStatusService()
	config := svc.GetConfig()
	c.JSON(http.StatusOK, gin.H{
		"success":          true,
		"theme":            config["theme"],
		"available_themes": service.AvailableThemes,
	})
}

// PUT /config/theme
func SetThemeConfig(c *gin.Context) {
	var req struct {
		Theme string `json:"theme"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid request", err.Error()))
		return
	}
	// Map legacy theme names to valid ones
	theme := req.Theme
	if mapped, ok := service.LegacyThemeMap[theme]; ok {
		theme = mapped
	}
	valid := false
	for _, t := range service.AvailableThemes {
		if t == theme {
			valid = true
			break
		}
	}
	if !valid {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid theme", ""))
		return
	}
	svc := service.NewModelStatusService()
	svc.SetTheme(theme)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"theme":   theme,
		"message": "Theme updated",
	})
}

// GET /config/refresh-interval
func GetRefreshIntervalConfig(c *gin.Context) {
	svc := service.NewModelStatusService()
	config := svc.GetConfig()
	c.JSON(http.StatusOK, gin.H{
		"success":          true,
		"refresh_interval": config["refresh_interval"],
		"available":        service.AvailableRefreshIntervals,
	})
}

// PUT /config/refresh-interval
func SetRefreshIntervalConfig(c *gin.Context) {
	var req struct {
		RefreshInterval int `json:"refresh_interval"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid request", err.Error()))
		return
	}
	valid := false
	for _, i := range service.AvailableRefreshIntervals {
		if i == req.RefreshInterval {
			valid = true
			break
		}
	}
	if !valid {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid refresh interval", ""))
		return
	}
	svc := service.NewModelStatusService()
	svc.SetRefreshInterval(req.RefreshInterval)
	c.JSON(http.StatusOK, gin.H{
		"success":          true,
		"refresh_interval": req.RefreshInterval,
		"message":          "Refresh interval updated",
	})
}

// GET /config/sort-mode
func GetSortModeConfig(c *gin.Context) {
	svc := service.NewModelStatusService()
	config := svc.GetConfig()
	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"sort_mode": config["sort_mode"],
		"available": service.AvailableSortModes,
	})
}

// PUT /config/sort-mode
func SetSortModeConfig(c *gin.Context) {
	var req struct {
		SortMode string `json:"sort_mode"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid request", err.Error()))
		return
	}
	valid := false
	for _, m := range service.AvailableSortModes {
		if m == req.SortMode {
			valid = true
			break
		}
	}
	if !valid {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid sort mode", ""))
		return
	}
	svc := service.NewModelStatusService()
	svc.SetSortMode(req.SortMode)
	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"sort_mode": req.SortMode,
		"message":   "Sort mode updated",
	})
}

// PUT /config/custom-order
func SetCustomOrderConfig(c *gin.Context) {
	var req struct {
		CustomOrder []string `json:"custom_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid request", err.Error()))
		return
	}
	svc := service.NewModelStatusService()
	svc.SetCustomOrder(req.CustomOrder)
	c.JSON(http.StatusOK, gin.H{
		"success":      true,
		"custom_order": req.CustomOrder,
		"message":      "Custom order updated",
	})
}

// GET /config (embed)
func GetEmbedConfig(c *gin.Context) {
	svc := service.NewModelStatusService()
	config := svc.GetEmbedConfig()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": config})
}

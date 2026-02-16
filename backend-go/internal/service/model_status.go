package service

import (
	"fmt"
	"time"

	"github.com/new-api-tools/backend/internal/cache"
	"github.com/new-api-tools/backend/internal/database"
)

// Constants for model status
var (
	AvailableTimeWindows      = []string{"1h", "6h", "12h", "24h"}
	DefaultTimeWindow         = "6h"
	AvailableThemes           = []string{"light", "dark", "system"}
	AvailableRefreshIntervals = []int{0, 30, 60, 120, 300}
	AvailableSortModes        = []string{"default", "availability", "custom"}
)

// ModelStatusService handles model availability monitoring
type ModelStatusService struct {
	db *database.Manager
}

// NewModelStatusService creates a new ModelStatusService
func NewModelStatusService() *ModelStatusService {
	return &ModelStatusService{db: database.Get()}
}

// GetAvailableModels returns all models with 24h request counts
func (s *ModelStatusService) GetAvailableModels() ([]map[string]interface{}, error) {
	cm := cache.Get()
	var cached []map[string]interface{}
	found, _ := cm.GetJSON("model_status:available_models", &cached)
	if found {
		return cached, nil
	}

	startTime := time.Now().Unix() - 86400

	query := fmt.Sprintf(`
		SELECT model_name, COUNT(*) as request_count_24h
		FROM logs
		WHERE type IN (2, 5) AND model_name != '' AND created_at >= %d
		GROUP BY model_name
		ORDER BY request_count_24h DESC`, startTime)

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}

	cm.Set("model_status:available_models", rows, 5*time.Minute)
	return rows, nil
}

// GetModelStatus returns status for a specific model
func (s *ModelStatusService) GetModelStatus(modelName, window string) (map[string]interface{}, error) {
	cacheKey := fmt.Sprintf("model_status:%s:%s", modelName, window)
	cm := cache.Get()
	var cached map[string]interface{}
	found, _ := cm.GetJSON(cacheKey, &cached)
	if found {
		return cached, nil
	}

	seconds, ok := WindowSeconds[window]
	if !ok {
		seconds = 21600 // default 6h
	}
	now := time.Now().Unix()
	startTime := now - seconds

	// Overall stats
	statsQuery := fmt.Sprintf(`
		SELECT COUNT(*) as total_requests,
			SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as success_count,
			SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_count
		FROM logs
		WHERE model_name = '%s' AND created_at >= %d AND type IN (2, 5)`,
		modelName, startTime)

	statsRow, _ := s.db.QueryOne(statsQuery)

	totalReqs := int64(0)
	successCount := int64(0)
	successRate := float64(100)
	currentStatus := "healthy"

	if statsRow != nil {
		totalReqs = toInt64(statsRow["total_requests"])
		successCount = toInt64(statsRow["success_count"])
		if totalReqs > 0 {
			successRate = float64(successCount) / float64(totalReqs) * 100
		}
	}

	if totalReqs == 0 {
		currentStatus = "unknown"
	} else if successRate < 50 {
		currentStatus = "down"
	} else if successRate < 80 {
		currentStatus = "degraded"
	}

	// Time slots (divide window into 12 slots)
	slotCount := 12
	slotDuration := seconds / int64(slotCount)
	slotData := make([]map[string]interface{}, 0, slotCount)

	for i := 0; i < slotCount; i++ {
		slotStart := startTime + int64(i)*slotDuration
		slotEnd := slotStart + slotDuration

		slotQuery := fmt.Sprintf(`
			SELECT COUNT(*) as total,
				SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as success
			FROM logs
			WHERE model_name = '%s' AND created_at >= %d AND created_at < %d AND type IN (2, 5)`,
			modelName, slotStart, slotEnd)

		slotRow, _ := s.db.QueryOne(slotQuery)

		slotTotal := int64(0)
		slotSuccess := int64(0)
		slotRate := float64(100)
		slotStatus := "healthy"

		if slotRow != nil {
			slotTotal = toInt64(slotRow["total"])
			slotSuccess = toInt64(slotRow["success"])
			if slotTotal > 0 {
				slotRate = float64(slotSuccess) / float64(slotTotal) * 100
			}
		}

		if slotTotal == 0 {
			slotStatus = "unknown"
		} else if slotRate < 50 {
			slotStatus = "down"
		} else if slotRate < 80 {
			slotStatus = "degraded"
		}

		slotData = append(slotData, map[string]interface{}{
			"slot":           i,
			"start_time":     slotStart,
			"end_time":       slotEnd,
			"total_requests": slotTotal,
			"success_count":  slotSuccess,
			"success_rate":   slotRate,
			"status":         slotStatus,
		})
	}

	result := map[string]interface{}{
		"model_name":     modelName,
		"display_name":   modelName,
		"time_window":    window,
		"total_requests": totalReqs,
		"success_count":  successCount,
		"success_rate":   successRate,
		"current_status": currentStatus,
		"slot_data":      slotData,
	}

	cm.Set(cacheKey, result, 1*time.Minute)
	return result, nil
}

// GetMultipleModelsStatus returns status for multiple models
func (s *ModelStatusService) GetMultipleModelsStatus(modelNames []string, window string) ([]map[string]interface{}, error) {
	results := make([]map[string]interface{}, 0, len(modelNames))
	for _, name := range modelNames {
		status, err := s.GetModelStatus(name, window)
		if err != nil {
			continue
		}
		results = append(results, status)
	}
	return results, nil
}

// GetAllModelsStatus returns status for all models that have requests
func (s *ModelStatusService) GetAllModelsStatus(window string) ([]map[string]interface{}, error) {
	models, err := s.GetAvailableModels()
	if err != nil {
		return nil, err
	}

	names := make([]string, 0, len(models))
	for _, m := range models {
		if name, ok := m["model_name"].(string); ok {
			names = append(names, name)
		}
	}

	return s.GetMultipleModelsStatus(names, window)
}

// Config management via cache

// GetSelectedModels returns selected model names from cache
func (s *ModelStatusService) GetSelectedModels() []string {
	cm := cache.Get()
	var models []string
	found, _ := cm.GetJSON("model_status:selected_models", &models)
	if found {
		return models
	}
	return []string{}
}

// SetSelectedModels saves selected models to cache
func (s *ModelStatusService) SetSelectedModels(models []string) {
	cm := cache.Get()
	cm.Set("model_status:selected_models", models, 0) // no expiry
}

// GetConfig returns all model status config
func (s *ModelStatusService) GetConfig() map[string]interface{} {
	cm := cache.Get()

	var timeWindow string
	found, _ := cm.GetJSON("model_status:time_window", &timeWindow)
	if !found {
		timeWindow = DefaultTimeWindow
	}

	var theme string
	found, _ = cm.GetJSON("model_status:theme", &theme)
	if !found {
		theme = "system"
	}

	var refreshInterval int
	found, _ = cm.GetJSON("model_status:refresh_interval", &refreshInterval)
	if !found {
		refreshInterval = 60
	}

	var sortMode string
	found, _ = cm.GetJSON("model_status:sort_mode", &sortMode)
	if !found {
		sortMode = "default"
	}

	var customOrder []string
	cm.GetJSON("model_status:custom_order", &customOrder)

	return map[string]interface{}{
		"time_window":      timeWindow,
		"theme":            theme,
		"refresh_interval": refreshInterval,
		"sort_mode":        sortMode,
		"custom_order":     customOrder,
		"selected_models":  s.GetSelectedModels(),
	}
}

// SetTimeWindow saves time window to cache
func (s *ModelStatusService) SetTimeWindow(window string) {
	cm := cache.Get()
	cm.Set("model_status:time_window", window, 0)
}

// SetTheme saves theme to cache
func (s *ModelStatusService) SetTheme(theme string) {
	cm := cache.Get()
	cm.Set("model_status:theme", theme, 0)
}

// SetRefreshInterval saves refresh interval to cache
func (s *ModelStatusService) SetRefreshInterval(interval int) {
	cm := cache.Get()
	cm.Set("model_status:refresh_interval", interval, 0)
}

// SetSortMode saves sort mode to cache
func (s *ModelStatusService) SetSortMode(mode string) {
	cm := cache.Get()
	cm.Set("model_status:sort_mode", mode, 0)
}

// SetCustomOrder saves custom order to cache
func (s *ModelStatusService) SetCustomOrder(order []string) {
	cm := cache.Get()
	cm.Set("model_status:custom_order", order, 0)
}

// GetEmbedConfig returns embed page configuration
func (s *ModelStatusService) GetEmbedConfig() map[string]interface{} {
	config := s.GetConfig()
	config["available_time_windows"] = AvailableTimeWindows
	config["available_themes"] = AvailableThemes
	config["available_refresh_intervals"] = AvailableRefreshIntervals
	config["available_sort_modes"] = AvailableSortModes
	return config
}

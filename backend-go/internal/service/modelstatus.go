package service

import (
	"fmt"
	"sync"
	"time"

	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/models"
)

// ModelStatusService 模型状态服务
type ModelStatusService struct {
	mu sync.RWMutex
}

// NewModelStatusService 创建模型状态服务
func NewModelStatusService() *ModelStatusService {
	return &ModelStatusService{}
}

// AvailableModel 可用模型
type AvailableModel struct {
	Name         string `json:"name"`
	DisplayName  string `json:"display_name"`
	Provider     string `json:"provider"`
	Type         string `json:"type"`
	IsEnabled    bool   `json:"is_enabled"`
	RequestCount int64  `json:"request_count"`
	LastUsed     string `json:"last_used"`
}

// ModelStatus 模型状态
type ModelStatus struct {
	ModelName     string             `json:"model_name"`
	IsAvailable   bool               `json:"is_available"`
	Status        string             `json:"status"`
	SuccessRate   float64            `json:"success_rate"`
	AvgLatency    float64            `json:"avg_latency"`
	RequestCount  int64              `json:"request_count"`
	ErrorCount    int64              `json:"error_count"`
	LastError     string             `json:"last_error"`
	LastErrorTime string             `json:"last_error_time"`
	ChannelStats  []ChannelModelStat `json:"channel_stats"`
	HourlyStats   []HourlyModelStat  `json:"hourly_stats"`
	CheckedAt     string             `json:"checked_at"`
}

// ChannelModelStat 渠道模型统计
type ChannelModelStat struct {
	ChannelID    int     `json:"channel_id"`
	ChannelName  string  `json:"channel_name"`
	RequestCount int64   `json:"request_count"`
	SuccessRate  float64 `json:"success_rate"`
	AvgLatency   float64 `json:"avg_latency"`
	IsEnabled    bool    `json:"is_enabled"`
}

// HourlyModelStat 每小时模型统计
type HourlyModelStat struct {
	Hour         int     `json:"hour"`
	RequestCount int64   `json:"request_count"`
	SuccessRate  float64 `json:"success_rate"`
	AvgLatency   float64 `json:"avg_latency"`
}

// SelectedModelsConfig 选中模型配置
type SelectedModelsConfig struct {
	Models    []string `json:"models"`
	UpdatedAt string   `json:"updated_at"`
}

// TimeWindowConfig 时间窗口配置
type TimeWindowConfig struct {
	Window      string `json:"window"`
	StartTime   string `json:"start_time"`
	EndTime     string `json:"end_time"`
	Description string `json:"description"`
}

// GetAvailableModels 获取可用模型列表
func (s *ModelStatusService) GetAvailableModels() ([]AvailableModel, error) {
	cacheKey := cache.CacheKey("modelstatus", "available_models")

	var models []AvailableModel
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 5 * time.Minute,
	}

	err := wrapper.GetOrSet(&models, func() (interface{}, error) {
		return s.fetchAvailableModels()
	})

	return models, err
}

// fetchAvailableModels 获取可用模型数据
func (s *ModelStatusService) fetchAvailableModels() ([]AvailableModel, error) {
	db := database.GetMainDB()

	// 从日志中获取使用过的模型
	var results []struct {
		ModelName    string
		RequestCount int64
		LastUsed     int64
	}

	db.Table("logs").
		Select("model_name, COUNT(*) as request_count, MAX(created_at) as last_used").
		Where("type = ?", models.LogTypeConsume).
		Group("model_name").
		Order("request_count DESC").
		Scan(&results)

	availableModels := make([]AvailableModel, len(results))
	for i, r := range results {
		availableModels[i] = AvailableModel{
			Name:         r.ModelName,
			DisplayName:  r.ModelName,
			Provider:     s.guessProvider(r.ModelName),
			Type:         s.guessModelType(r.ModelName),
			IsEnabled:    true,
			RequestCount: r.RequestCount,
			LastUsed:     time.Unix(r.LastUsed, 0).Format("2006-01-02 15:04:05"),
		}
	}

	return availableModels, nil
}

// GetModelStatus 获取单个模型状态
func (s *ModelStatusService) GetModelStatus(modelName string) (*ModelStatus, error) {
	cacheKey := cache.CacheKey("modelstatus", "status", modelName)

	var status ModelStatus
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 1 * time.Minute,
	}

	err := wrapper.GetOrSet(&status, func() (interface{}, error) {
		return s.fetchModelStatus(modelName)
	})

	return &status, err
}

// fetchModelStatus 获取模型状态数据
func (s *ModelStatusService) fetchModelStatus(modelName string) (*ModelStatus, error) {
	db := database.GetMainDB()

	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()

	status := &ModelStatus{
		ModelName:   modelName,
		IsAvailable: true,
		Status:      "healthy",
		CheckedAt:   now.Format("2006-01-02 15:04:05"),
	}

	// 获取今日请求统计
	var stats struct {
		RequestCount int64
		ErrorCount   int64
	}

	db.Table("logs").
		Select("COUNT(*) as request_count, SUM(CASE WHEN quota = 0 THEN 1 ELSE 0 END) as error_count").
		Where("model_name = ? AND created_at >= ? AND type = ?", modelName, todayStart, models.LogTypeConsume).
		Scan(&stats)

	status.RequestCount = stats.RequestCount
	status.ErrorCount = stats.ErrorCount

	if stats.RequestCount > 0 {
		status.SuccessRate = float64(stats.RequestCount-stats.ErrorCount) / float64(stats.RequestCount) * 100
	} else {
		status.SuccessRate = 100.0
	}

	// 获取渠道统计
	status.ChannelStats = s.getChannelStats(modelName, todayStart)

	// 获取每小时统计
	status.HourlyStats = s.getHourlyStats(modelName, todayStart)

	// 判断状态
	if status.SuccessRate < 50 {
		status.Status = "critical"
		status.IsAvailable = false
	} else if status.SuccessRate < 80 {
		status.Status = "degraded"
	}

	return status, nil
}

// getChannelStats 获取渠道统计
func (s *ModelStatusService) getChannelStats(modelName string, startTime int64) []ChannelModelStat {
	db := database.GetMainDB()

	var results []struct {
		ChannelID    int
		RequestCount int64
	}

	db.Table("logs").
		Select("channel_id, COUNT(*) as request_count").
		Where("model_name = ? AND created_at >= ? AND type = ?", modelName, startTime, models.LogTypeConsume).
		Group("channel_id").
		Scan(&results)

	stats := make([]ChannelModelStat, len(results))
	for i, r := range results {
		// 获取渠道名称
		var channel models.Channel
		db.First(&channel, r.ChannelID)

		stats[i] = ChannelModelStat{
			ChannelID:    r.ChannelID,
			ChannelName:  channel.Name,
			RequestCount: r.RequestCount,
			SuccessRate:  100.0,
			IsEnabled:    channel.Status == models.ChannelStatusEnabled,
		}
	}

	return stats
}

// getHourlyStats 获取每小时统计
func (s *ModelStatusService) getHourlyStats(modelName string, startTime int64) []HourlyModelStat {
	db := database.GetMainDB()

	var results []struct {
		Hour         int
		RequestCount int64
	}

	// 根据数据库类型使用不同的小时格式化
	var hourFormat string
	if database.GetMainDB().Dialector.Name() == "postgres" {
		hourFormat = "EXTRACT(HOUR FROM TO_TIMESTAMP(created_at))"
	} else {
		hourFormat = "HOUR(FROM_UNIXTIME(created_at))"
	}

	db.Table("logs").
		Select(hourFormat+" as hour, COUNT(*) as request_count").
		Where("model_name = ? AND created_at >= ? AND type = ?", modelName, startTime, models.LogTypeConsume).
		Group(hourFormat).
		Order("hour").
		Scan(&results)

	stats := make([]HourlyModelStat, len(results))
	for i, r := range results {
		stats[i] = HourlyModelStat{
			Hour:         r.Hour,
			RequestCount: r.RequestCount,
			SuccessRate:  100.0,
		}
	}

	return stats
}

// BatchGetModelStatus 批量获取模型状态
func (s *ModelStatusService) BatchGetModelStatus(modelNames []string) ([]ModelStatus, error) {
	statuses := make([]ModelStatus, len(modelNames))

	for i, name := range modelNames {
		status, err := s.GetModelStatus(name)
		if err != nil {
			statuses[i] = ModelStatus{
				ModelName:   name,
				IsAvailable: false,
				Status:      "unknown",
				CheckedAt:   time.Now().Format("2006-01-02 15:04:05"),
			}
		} else {
			statuses[i] = *status
		}
	}

	return statuses, nil
}

// GetSelectedModels 获取选中的模型
func (s *ModelStatusService) GetSelectedModels() (*SelectedModelsConfig, error) {
	cacheKey := cache.CacheKey("modelstatus", "selected_models")

	var config SelectedModelsConfig
	wrapper := &cache.CacheWrapper{
		Key: cacheKey,
		TTL: 10 * time.Minute,
	}

	err := wrapper.GetOrSet(&config, func() (interface{}, error) {
		// 默认返回所有模型
		models, _ := s.GetAvailableModels()
		names := make([]string, len(models))
		for i, m := range models {
			names[i] = m.Name
		}
		return &SelectedModelsConfig{
			Models:    names,
			UpdatedAt: time.Now().Format("2006-01-02 15:04:05"),
		}, nil
	})

	return &config, err
}

// UpdateSelectedModels 更新选中的模型
func (s *ModelStatusService) UpdateSelectedModels(modelNames []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 清除缓存
	cacheKey := cache.CacheKey("modelstatus", "selected_models")
	cache.Delete(cacheKey)

	return nil
}

// GetTimeWindow 获取时间窗口配置
func (s *ModelStatusService) GetTimeWindow() (*TimeWindowConfig, error) {
	now := time.Now()
	today := now.Format("2006-01-02")

	return &TimeWindowConfig{
		Window:      "today",
		StartTime:   today + " 00:00:00",
		EndTime:     now.Format("2006-01-02 15:04:05"),
		Description: "今日数据",
	}, nil
}

// guessProvider 猜测模型提供商
func (s *ModelStatusService) guessProvider(modelName string) string {
	switch {
	case contains(modelName, "gpt"):
		return "OpenAI"
	case contains(modelName, "claude"):
		return "Anthropic"
	case contains(modelName, "gemini"):
		return "Google"
	case contains(modelName, "llama"):
		return "Meta"
	case contains(modelName, "qwen"):
		return "Alibaba"
	case contains(modelName, "glm"):
		return "Zhipu"
	case contains(modelName, "deepseek"):
		return "DeepSeek"
	default:
		return "Unknown"
	}
}

// guessModelType 猜测模型类型
func (s *ModelStatusService) guessModelType(modelName string) string {
	switch {
	case contains(modelName, "vision") || contains(modelName, "4o"):
		return "multimodal"
	case contains(modelName, "embedding"):
		return "embedding"
	case contains(modelName, "whisper"):
		return "audio"
	case contains(modelName, "dall") || contains(modelName, "image"):
		return "image"
	default:
		return "chat"
	}
}

// contains 检查字符串是否包含子串（不区分大小写）
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsLower(s, substr))
}

func containsLower(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if equalFoldAt(s, i, substr) {
			return true
		}
	}
	return false
}

func equalFoldAt(s string, i int, substr string) bool {
	for j := 0; j < len(substr); j++ {
		c1 := s[i+j]
		c2 := substr[j]
		if c1 != c2 && toLower(c1) != toLower(c2) {
			return false
		}
	}
	return true
}

func toLower(c byte) byte {
	if c >= 'A' && c <= 'Z' {
		return c + 32
	}
	return c
}

// GetModelHealth 获取模型健康状态摘要
func (s *ModelStatusService) GetModelHealth() (map[string]interface{}, error) {
	models, err := s.GetAvailableModels()
	if err != nil {
		return nil, fmt.Errorf("获取模型列表失败: %v", err)
	}

	healthy := 0
	degraded := 0
	critical := 0

	for _, m := range models {
		status, _ := s.GetModelStatus(m.Name)
		switch status.Status {
		case "healthy":
			healthy++
		case "degraded":
			degraded++
		case "critical":
			critical++
		}
	}

	return map[string]interface{}{
		"total":      len(models),
		"healthy":    healthy,
		"degraded":   degraded,
		"critical":   critical,
		"checked_at": time.Now().Format("2006-01-02 15:04:05"),
	}, nil
}

package service

import (
	"crypto/md5"
	"encoding/binary"
	"fmt"
	"time"
)

// Uptime-Kuma 状态常量
const (
	StatusDown        = 0
	StatusUp          = 1
	StatusPending     = 2
	StatusMaintenance = 3
)

// UptimeKumaService uptime-kuma 兼容服务
type UptimeKumaService struct {
	modelStatusService *ModelStatusService
}

// NewUptimeKumaService 创建 uptime-kuma 服务
func NewUptimeKumaService() *UptimeKumaService {
	return &UptimeKumaService{
		modelStatusService: NewModelStatusService(),
	}
}

// StatusPageConfig 状态页配置（uptime-kuma 格式）
type StatusPageConfig struct {
	Slug                string `json:"slug"`
	Title               string `json:"title"`
	Description         string `json:"description,omitempty"`
	Icon                string `json:"icon"`
	Theme               string `json:"theme"`
	Published           bool   `json:"published"`
	ShowTags            bool   `json:"showTags"`
	AutoRefreshInterval int    `json:"autoRefreshInterval"`
}

// MonitorItem 监控项（uptime-kuma 格式）
type MonitorItem struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	Type    string `json:"type"`
	SendUrl int    `json:"sendUrl"`
}

// MonitorGroup 监控组（uptime-kuma 格式）
type MonitorGroup struct {
	ID          int           `json:"id"`
	Name        string        `json:"name"`
	Weight      int           `json:"weight"`
	MonitorList []MonitorItem `json:"monitorList"`
}

// StatusPageData 状态页数据（uptime-kuma 格式）
type StatusPageData struct {
	Config          StatusPageConfig `json:"config"`
	Incident        interface{}      `json:"incident"`
	PublicGroupList []MonitorGroup   `json:"publicGroupList"`
	MaintenanceList []interface{}    `json:"maintenanceList"`
}

// HeartbeatItem 心跳项（uptime-kuma 格式）
type HeartbeatItem struct {
	Status int    `json:"status"`
	Time   string `json:"time"`
	Msg    string `json:"msg"`
	Ping   *int   `json:"ping"`
}

// HeartbeatData 心跳数据（uptime-kuma 格式）
type HeartbeatData struct {
	HeartbeatList map[string][]HeartbeatItem `json:"heartbeatList"`
	UptimeList    map[string]float64         `json:"uptimeList"`
}

// BadgeData 徽章数据
type BadgeData struct {
	Label  string `json:"label"`
	Status string `json:"status"`
	Color  string `json:"color"`
}

// SummaryData 摘要数据
type SummaryData struct {
	Success         bool    `json:"success"`
	Status          int     `json:"status"`
	StatusText      string  `json:"status_text"`
	Uptime          float64 `json:"uptime"`
	TotalMonitors   int     `json:"total_monitors"`
	MonitorsUp      int     `json:"monitors_up"`
	MonitorsDown    int     `json:"monitors_down"`
	MonitorsPending int     `json:"monitors_pending"`
	LastUpdated     string  `json:"last_updated"`
}

// modelNameToID 将模型名转换为稳定的数字 ID（使用 MD5）
func modelNameToID(modelName string) int {
	hash := md5.Sum([]byte(modelName))
	id := binary.BigEndian.Uint32(hash[:4])
	return int(id % 1000000000)
}

// mapStatusToUptimeKuma 将成功率映射为 uptime-kuma 状态码
func mapStatusToUptimeKuma(successRate float64, totalRequests int64) int {
	if totalRequests == 0 {
		return StatusUp
	}
	if successRate >= 95 {
		return StatusUp
	}
	if successRate >= 80 {
		return StatusPending
	}
	return StatusDown
}

// GetStatusPageConfig 获取状态页配置（uptime-kuma 格式）
func (s *UptimeKumaService) GetStatusPageConfig(slug, window string) (*StatusPageData, error) {
	models, err := s.modelStatusService.GetAvailableModelsWithStats24h()
	if err != nil {
		return nil, err
	}

	// 获取所有模型状态
	names := make([]string, len(models))
	for i, m := range models {
		names[i] = m.ModelName
	}

	statuses, err := s.modelStatusService.GetMultipleModelsStatusItems(names, window, true)
	if err != nil {
		return nil, err
	}

	// 构建监控列表
	monitorList := make([]MonitorItem, 0, len(statuses))
	for _, status := range statuses {
		monitorID := modelNameToID(status.ModelName)
		monitorList = append(monitorList, MonitorItem{
			ID:      monitorID,
			Name:    status.DisplayName,
			Type:    "http",
			SendUrl: 0,
		})
	}

	// 构建状态页数据
	return &StatusPageData{
		Config: StatusPageConfig{
			Slug:                slug,
			Title:               "Model Status",
			Description:         "AI Model Health Status",
			Icon:                "/icon.svg",
			Theme:               "auto",
			Published:           true,
			ShowTags:            false,
			AutoRefreshInterval: 60,
		},
		Incident: nil,
		PublicGroupList: []MonitorGroup{
			{
				ID:          1,
				Name:        "AI Models",
				Weight:      1,
				MonitorList: monitorList,
			},
		},
		MaintenanceList: []interface{}{},
	}, nil
}

// GetHeartbeatData 获取心跳数据（uptime-kuma 格式）
func (s *UptimeKumaService) GetHeartbeatData(slug, window string) (*HeartbeatData, error) {
	models, err := s.modelStatusService.GetAvailableModelsWithStats24h()
	if err != nil {
		return nil, err
	}

	names := make([]string, len(models))
	for i, m := range models {
		names[i] = m.ModelName
	}

	statuses, err := s.modelStatusService.GetMultipleModelsStatusItems(names, window, true)
	if err != nil {
		return nil, err
	}

	heartbeatList := make(map[string][]HeartbeatItem)
	uptimeList := make(map[string]float64)

	for _, status := range statuses {
		monitorID := modelNameToID(status.ModelName)
		monitorIDStr := fmt.Sprintf("%d", monitorID)

		// 构建心跳列表
		heartbeats := make([]HeartbeatItem, 0, len(status.SlotData))
		for _, slot := range status.SlotData {
			slotStatus := mapStatusToUptimeKuma(slot.SuccessRate, slot.TotalRequests)

			var msg string
			if slot.TotalRequests == 0 {
				msg = ""
			} else {
				msg = fmt.Sprintf("%d/%d (%.1f%%)", slot.SuccessCount, slot.TotalRequests, slot.SuccessRate)
			}

			utcTime := time.Unix(slot.EndTime, 0).UTC()

			heartbeats = append(heartbeats, HeartbeatItem{
				Status: slotStatus,
				Time:   utcTime.Format("2006-01-02 15:04:05"),
				Msg:    msg,
				Ping:   nil,
			})
		}

		heartbeatList[monitorIDStr] = heartbeats
		uptimeList[monitorIDStr+"_24"] = status.SuccessRate / 100.0
	}

	return &HeartbeatData{
		HeartbeatList: heartbeatList,
		UptimeList:    uptimeList,
	}, nil
}

// GetBadgeData 获取徽章数据
func (s *UptimeKumaService) GetBadgeData(slug, window, label string) (*BadgeData, error) {
	models, err := s.modelStatusService.GetAvailableModelsWithStats24h()
	if err != nil {
		return nil, err
	}

	names := make([]string, len(models))
	for i, m := range models {
		names[i] = m.ModelName
	}

	statuses, err := s.modelStatusService.GetMultipleModelsStatusItems(names, window, true)
	if err != nil {
		return nil, err
	}

	hasUp := false
	hasDown := false

	for _, status := range statuses {
		currentStatus := mapStatusToUptimeKuma(status.SuccessRate, status.TotalRequests)
		if currentStatus == StatusUp {
			hasUp = true
		} else if currentStatus == StatusDown {
			hasDown = true
		}
	}

	var badgeStatus, color string
	if hasUp && !hasDown {
		badgeStatus = "Up"
		color = "#4CAF50"
	} else if hasUp && hasDown {
		badgeStatus = "Degraded"
		color = "#F6BE00"
	} else if hasDown {
		badgeStatus = "Down"
		color = "#DC3545"
	} else {
		badgeStatus = "N/A"
		color = "#808080"
	}

	return &BadgeData{
		Label:  label,
		Status: badgeStatus,
		Color:  color,
	}, nil
}

// GetSummaryData 获取摘要数据
func (s *UptimeKumaService) GetSummaryData(slug, window string) (*SummaryData, error) {
	models, err := s.modelStatusService.GetAvailableModelsWithStats24h()
	if err != nil {
		return nil, err
	}

	names := make([]string, len(models))
	for i, m := range models {
		names[i] = m.ModelName
	}

	statuses, err := s.modelStatusService.GetMultipleModelsStatusItems(names, window, true)
	if err != nil {
		return nil, err
	}

	var monitorsUp, monitorsDown, monitorsPending int
	var totalUptime float64

	for _, status := range statuses {
		currentStatus := mapStatusToUptimeKuma(status.SuccessRate, status.TotalRequests)

		switch currentStatus {
		case StatusUp:
			monitorsUp++
		case StatusDown:
			monitorsDown++
		default:
			monitorsPending++
		}

		totalUptime += status.SuccessRate
	}

	totalMonitors := len(statuses)
	overallUptime := 100.0
	if totalMonitors > 0 {
		overallUptime = totalUptime / float64(totalMonitors)
	}

	// 确定整体状态
	overallStatus := StatusUp
	statusText := "UP"
	if monitorsDown > 0 {
		overallStatus = StatusDown
		statusText = "DOWN"
	} else if monitorsPending > 0 {
		overallStatus = StatusPending
		statusText = "PENDING"
	}

	return &SummaryData{
		Success:         true,
		Status:          overallStatus,
		StatusText:      statusText,
		Uptime:          overallUptime,
		TotalMonitors:   totalMonitors,
		MonitorsUp:      monitorsUp,
		MonitorsDown:    monitorsDown,
		MonitorsPending: monitorsPending,
		LastUpdated:     time.Now().UTC().Format(time.RFC3339),
	}, nil
}

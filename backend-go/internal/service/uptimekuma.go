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

// UptimeKumaHeartbeat 心跳数据（uptime-kuma 格式）
type UptimeKumaHeartbeat struct {
	MonitorID int    `json:"monitorID"`
	Status    int    `json:"status"`
	Time      string `json:"time"`
	Msg       string `json:"msg"`
	Ping      *int   `json:"ping"`
	Important bool   `json:"important"`
	Duration  int64  `json:"duration"`
}

// UptimeKumaMonitor 监控器数据（uptime-kuma 格式）
type UptimeKumaMonitor struct {
	ID            int     `json:"id"`
	Name          string  `json:"name"`
	Description   string  `json:"description,omitempty"`
	URL           string  `json:"url,omitempty"`
	Type          string  `json:"type"`
	Interval      int     `json:"interval"`
	Active        bool    `json:"active"`
	ModelName     string  `json:"model_name"`
	SuccessRate   float64 `json:"success_rate"`
	TotalRequests int64   `json:"total_requests"`
	TimeWindow    string  `json:"time_window"`
}

// UptimeKumaMonitorWithHeartbeats 带心跳的监控器
type UptimeKumaMonitorWithHeartbeats struct {
	UptimeKumaMonitor
	Heartbeats []UptimeKumaHeartbeat `json:"heartbeats"`
	Uptime24h  float64               `json:"uptime_24h"`
}

// UptimeKumaStatusPageMonitor 状态页监控器
type UptimeKumaStatusPageMonitor struct {
	ID         int                   `json:"id"`
	Name       string                `json:"name"`
	Status     int                   `json:"status"`
	Uptime     float64               `json:"uptime"`
	Heartbeats []UptimeKumaHeartbeat `json:"heartbeats"`
}

// UptimeKumaStatusPage 状态页数据
type UptimeKumaStatusPage struct {
	Title         string                        `json:"title"`
	Description   string                        `json:"description"`
	Monitors      []UptimeKumaStatusPageMonitor `json:"monitors"`
	OverallStatus int                           `json:"overall_status"`
	OverallUptime float64                       `json:"overall_uptime"`
	LastUpdated   string                        `json:"last_updated"`
}

// UptimeKumaOverallStatus 整体状态摘要
type UptimeKumaOverallStatus struct {
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
	// 取前 4 字节转换为 int
	id := binary.BigEndian.Uint32(hash[:4])
	return int(id % 1000000000) // 限制在 10^9 以内
}

// mapStatusToUptimeKuma 将成功率映射为 uptime-kuma 状态码
func mapStatusToUptimeKuma(successRate float64, totalRequests int64) int {
	if totalRequests == 0 {
		return StatusUp // 无请求 = 无问题
	}
	if successRate >= 95 {
		return StatusUp
	}
	if successRate >= 80 {
		return StatusPending
	}
	return StatusDown
}

// getStatusText 获取状态文本
func getStatusText(status int) string {
	switch status {
	case StatusUp:
		return "UP"
	case StatusDown:
		return "DOWN"
	case StatusPending:
		return "PENDING"
	case StatusMaintenance:
		return "MAINTENANCE"
	default:
		return "UNKNOWN"
	}
}

// slotToHeartbeat 将时间槽转换为心跳数据
func slotToHeartbeat(slot SlotStatusItem, monitorID int) UptimeKumaHeartbeat {
	status := mapStatusToUptimeKuma(slot.SuccessRate, slot.TotalRequests)

	var msg string
	if slot.TotalRequests == 0 {
		msg = "No requests in this period"
	} else {
		msg = formatHeartbeatMsg(slot.SuccessCount, slot.TotalRequests, slot.SuccessRate)
	}

	// 使用 UTC 时间
	utcTime := time.Unix(slot.EndTime, 0).UTC()

	return UptimeKumaHeartbeat{
		MonitorID: monitorID,
		Status:    status,
		Time:      utcTime.Format(time.RFC3339),
		Msg:       msg,
		Ping:      nil, // 不适用于模型状态
		Important: status != StatusUp,
		Duration:  slot.EndTime - slot.StartTime,
	}
}

func formatHeartbeatMsg(success, total int64, rate float64) string {
	return fmt.Sprintf("%d/%d requests successful (%.1f%%)", success, total, rate)
}

// GetMonitors 获取所有监控器
func (s *UptimeKumaService) GetMonitors(window string) ([]UptimeKumaMonitor, error) {
	models, err := s.modelStatusService.GetAvailableModelsWithStats24h()
	if err != nil {
		return nil, err
	}

	monitors := make([]UptimeKumaMonitor, 0, len(models))
	for _, m := range models {
		status, err := s.modelStatusService.GetModelStatusItem(m.ModelName, window, true)
		if err != nil || status == nil {
			continue
		}

		monitors = append(monitors, UptimeKumaMonitor{
			ID:            modelNameToID(m.ModelName),
			Name:          status.DisplayName,
			Description:   "AI Model: " + m.ModelName,
			Type:          "model",
			Interval:      60,
			Active:        true,
			ModelName:     m.ModelName,
			SuccessRate:   status.SuccessRate,
			TotalRequests: status.TotalRequests,
			TimeWindow:    window,
		})
	}

	return monitors, nil
}

// GetMonitor 获取单个监控器（带心跳）
func (s *UptimeKumaService) GetMonitor(modelName, window string) (*UptimeKumaMonitorWithHeartbeats, error) {
	status, err := s.modelStatusService.GetModelStatusItem(modelName, window, true)
	if err != nil {
		return nil, err
	}
	if status == nil {
		return nil, nil
	}

	monitorID := modelNameToID(modelName)

	// 转换时间槽为心跳
	heartbeats := make([]UptimeKumaHeartbeat, len(status.SlotData))
	for i, slot := range status.SlotData {
		heartbeats[i] = slotToHeartbeat(slot, monitorID)
	}

	return &UptimeKumaMonitorWithHeartbeats{
		UptimeKumaMonitor: UptimeKumaMonitor{
			ID:            monitorID,
			Name:          status.DisplayName,
			Description:   "AI Model: " + modelName,
			Type:          "model",
			Interval:      60,
			Active:        true,
			ModelName:     modelName,
			SuccessRate:   status.SuccessRate,
			TotalRequests: status.TotalRequests,
			TimeWindow:    window,
		},
		Heartbeats: heartbeats,
		Uptime24h:  status.SuccessRate,
	}, nil
}

// GetHeartbeats 获取心跳数据
func (s *UptimeKumaService) GetHeartbeats(modelName, window string) ([]UptimeKumaHeartbeat, int, error) {
	monitorID := modelNameToID(modelName)

	status, err := s.modelStatusService.GetModelStatusItem(modelName, window, true)
	if err != nil {
		return nil, monitorID, err
	}
	if status == nil {
		return []UptimeKumaHeartbeat{}, monitorID, nil
	}

	heartbeats := make([]UptimeKumaHeartbeat, len(status.SlotData))
	for i, slot := range status.SlotData {
		heartbeats[i] = slotToHeartbeat(slot, monitorID)
	}

	return heartbeats, monitorID, nil
}

// GetStatusPage 获取状态页数据
func (s *UptimeKumaService) GetStatusPage(window string, modelNames []string) (*UptimeKumaStatusPage, error) {
	var statuses []ModelStatusItem

	if len(modelNames) > 0 {
		items, err := s.modelStatusService.GetMultipleModelsStatusItems(modelNames, window, true)
		if err != nil {
			return nil, err
		}
		statuses = items
	} else {
		models, err := s.modelStatusService.GetAvailableModelsWithStats24h()
		if err != nil {
			return nil, err
		}
		names := make([]string, len(models))
		for i, m := range models {
			names[i] = m.ModelName
		}
		items, err := s.modelStatusService.GetMultipleModelsStatusItems(names, window, true)
		if err != nil {
			return nil, err
		}
		statuses = items
	}

	pageMonitors := make([]UptimeKumaStatusPageMonitor, 0, len(statuses))
	var totalUptime float64
	worstStatus := StatusUp

	for _, status := range statuses {
		monitorID := modelNameToID(status.ModelName)
		currentStatus := mapStatusToUptimeKuma(status.SuccessRate, status.TotalRequests)

		if currentStatus < worstStatus {
			worstStatus = currentStatus
		}

		// 最近 24 个槽的心跳
		slotCount := len(status.SlotData)
		startIdx := 0
		if slotCount > 24 {
			startIdx = slotCount - 24
		}

		heartbeats := make([]UptimeKumaHeartbeat, 0, 24)
		for i := startIdx; i < slotCount; i++ {
			heartbeats = append(heartbeats, slotToHeartbeat(status.SlotData[i], monitorID))
		}

		pageMonitors = append(pageMonitors, UptimeKumaStatusPageMonitor{
			ID:         monitorID,
			Name:       status.DisplayName,
			Status:     currentStatus,
			Uptime:     status.SuccessRate,
			Heartbeats: heartbeats,
		})

		totalUptime += status.SuccessRate
	}

	overallUptime := 100.0
	if len(statuses) > 0 {
		overallUptime = totalUptime / float64(len(statuses))
	}

	return &UptimeKumaStatusPage{
		Title:         "Model Status",
		Description:   "AI Model Health Status",
		Monitors:      pageMonitors,
		OverallStatus: worstStatus,
		OverallUptime: overallUptime,
		LastUpdated:   time.Now().UTC().Format(time.RFC3339),
	}, nil
}

// GetOverallStatus 获取整体状态摘要
func (s *UptimeKumaService) GetOverallStatus(window string) (*UptimeKumaOverallStatus, error) {
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
	if monitorsDown > 0 {
		overallStatus = StatusDown
	} else if monitorsPending > 0 {
		overallStatus = StatusPending
	}

	return &UptimeKumaOverallStatus{
		Status:          overallStatus,
		StatusText:      getStatusText(overallStatus),
		Uptime:          overallUptime,
		TotalMonitors:   totalMonitors,
		MonitorsUp:      monitorsUp,
		MonitorsDown:    monitorsDown,
		MonitorsPending: monitorsPending,
		LastUpdated:     time.Now().UTC().Format(time.RFC3339),
	}, nil
}

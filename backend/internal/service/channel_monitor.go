package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/new-api-tools/backend/internal/database"
)

// ChannelMonitorService 渠道健康监控：余额/性能/错误率/能力矩阵。
// 只读 channels/abilities/logs 表；绝不查询 channels.key（渠道密钥）。
type ChannelMonitorService struct {
	db    *database.Manager
	logDB *database.Manager
}

func NewChannelMonitorService() *ChannelMonitorService {
	return &ChannelMonitorService{db: database.Get(), logDB: database.GetLog()}
}

// GetChannelOverview 返回全部渠道的运营字段（不含密钥）
func (s *ChannelMonitorService) GetChannelOverview() ([]map[string]interface{}, error) {
	groupCol := s.db.QuoteIdentifier("group")
	query := fmt.Sprintf(`
		SELECT id, COALESCE(name, '') as name, type, status,
			COALESCE(priority, 0) as priority,
			COALESCE(weight, 0) as weight,
			COALESCE(balance, 0) as balance,
			COALESCE(balance_updated_time, 0) as balance_updated_time,
			COALESCE(response_time, 0) as response_time,
			COALESCE(test_time, 0) as test_time,
			COALESCE(used_quota, 0) as used_quota,
			COALESCE(%s, '') as channel_group,
			COALESCE(tag, '') as tag,
			COALESCE(models, '') as models,
			COALESCE(created_time, 0) as created_time
		FROM channels
		ORDER BY status ASC, priority DESC, id ASC`, groupCol)

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}

	items := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		// models 是逗号分隔文本，只返回数量，避免超长响应
		modelsStr := fmt.Sprintf("%v", row["models"])
		modelCount := 0
		if modelsStr != "" {
			modelCount = len(strings.Split(modelsStr, ","))
		}
		items = append(items, map[string]interface{}{
			"id":                   row["id"],
			"name":                 row["name"],
			"type":                 row["type"],
			"status":               row["status"],
			"priority":             row["priority"],
			"weight":               row["weight"],
			"balance":              row["balance"],
			"balance_updated_time": row["balance_updated_time"],
			"response_time":        row["response_time"],
			"test_time":            row["test_time"],
			"used_quota":           row["used_quota"],
			"group":                row["channel_group"],
			"tag":                  row["tag"],
			"model_count":          modelCount,
			"created_time":         row["created_time"],
		})
	}
	return items, nil
}

// GetChannelLogStats 按渠道统计窗口期内的请求量/错误率/平均耗时
func (s *ChannelMonitorService) GetChannelLogStats(hours int) ([]map[string]interface{}, error) {
	if hours <= 0 || hours > 24*30 {
		hours = 24
	}
	windowStart := time.Now().Unix() - int64(hours)*3600

	query := s.logDB.RebindQuery(`
		SELECT channel_id,
			COUNT(*) as total,
			SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as errors,
			AVG(CASE WHEN type = 2 THEN use_time END) as avg_use_time
		FROM logs
		WHERE created_at >= ? AND type IN (2, 5)
		GROUP BY channel_id`)

	rows, err := s.logDB.Query(query, windowStart)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	return rows, nil
}

// AbilityMatrix 渠道能力矩阵 + 单点模型（仅一个启用渠道支撑的模型）
func (s *ChannelMonitorService) GetAbilityMatrix() (map[string]interface{}, error) {
	groupCol := s.db.QuoteIdentifier("group")
	query := fmt.Sprintf(`
		SELECT a.%s as ability_group, a.model, a.channel_id, a.enabled,
			COALESCE(a.priority, 0) as priority,
			COALESCE(c.name, '') as channel_name
		FROM abilities a
		LEFT JOIN channels c ON c.id = a.channel_id
		ORDER BY a.model ASC, a.%s ASC`, groupCol, groupCol)

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}

	// 单点模型：启用状态下仅由 1 个渠道支撑
	channelsByModel := make(map[string]map[int64]bool)
	for _, row := range rows {
		enabled := fmt.Sprintf("%v", row["enabled"])
		if enabled != "true" && enabled != "1" {
			continue
		}
		model := fmt.Sprintf("%v", row["model"])
		if channelsByModel[model] == nil {
			channelsByModel[model] = make(map[int64]bool)
		}
		channelsByModel[model][toInt64(row["channel_id"])] = true
	}
	singlePoint := make([]map[string]interface{}, 0)
	for _, row := range rows {
		model := fmt.Sprintf("%v", row["model"])
		enabled := fmt.Sprintf("%v", row["enabled"])
		if (enabled == "true" || enabled == "1") && len(channelsByModel[model]) == 1 {
			singlePoint = append(singlePoint, map[string]interface{}{
				"model":        model,
				"channel_id":   row["channel_id"],
				"channel_name": row["channel_name"],
				"group":        row["ability_group"],
			})
		}
	}

	if rows == nil {
		rows = []map[string]interface{}{}
	}
	return map[string]interface{}{
		"abilities":           rows,
		"single_point_models": singlePoint,
	}, nil
}

// GetModelHealth 按模型统计窗口期内错误率/空回复率/耗时分布
func (s *ChannelMonitorService) GetModelHealth(hours int) ([]map[string]interface{}, error) {
	if hours <= 0 || hours > 24*30 {
		hours = 24
	}
	windowStart := time.Now().Unix() - int64(hours)*3600

	// 耗时分桶（秒），跨库兼容（不用 percentile_cont，MySQL 没有）
	query := s.logDB.RebindQuery(`
		SELECT model_name,
			COUNT(*) as total,
			SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as errors,
			SUM(CASE WHEN type = 2 AND completion_tokens = 0 THEN 1 ELSE 0 END) as empty_count,
			AVG(CASE WHEN type = 2 THEN use_time END) as avg_use_time,
			MAX(CASE WHEN type = 2 THEN use_time END) as max_use_time,
			SUM(CASE WHEN type = 2 AND use_time < 3 THEN 1 ELSE 0 END) as bucket_fast,
			SUM(CASE WHEN type = 2 AND use_time >= 3 AND use_time < 10 THEN 1 ELSE 0 END) as bucket_mid,
			SUM(CASE WHEN type = 2 AND use_time >= 10 AND use_time < 30 THEN 1 ELSE 0 END) as bucket_slow,
			SUM(CASE WHEN type = 2 AND use_time >= 30 THEN 1 ELSE 0 END) as bucket_very_slow
		FROM logs
		WHERE created_at >= ? AND type IN (2, 5)
		GROUP BY model_name
		ORDER BY total DESC
		LIMIT 100`)

	rows, err := s.logDB.Query(query, windowStart)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	return rows, nil
}

// errorCategory 对错误内容做关键字归类
func errorCategory(content string) string {
	c := strings.ToLower(content)
	switch {
	case strings.Contains(c, "429") || strings.Contains(c, "rate limit") || strings.Contains(c, "too many"):
		return "rate_limit"
	case strings.Contains(c, "401") || strings.Contains(c, "403") || strings.Contains(c, "unauthorized") ||
		strings.Contains(c, "api key") || strings.Contains(c, "无效") || strings.Contains(c, "invalid key"):
		return "auth"
	case strings.Contains(c, "timeout") || strings.Contains(c, "deadline") || strings.Contains(c, "超时"):
		return "timeout"
	case strings.Contains(c, "500") || strings.Contains(c, "502") || strings.Contains(c, "503") ||
		strings.Contains(c, "bad gateway") || strings.Contains(c, "upstream"):
		return "upstream"
	case strings.Contains(c, "quota") || strings.Contains(c, "余额") || strings.Contains(c, "额度") ||
		strings.Contains(c, "insufficient"):
		return "quota"
	default:
		return "other"
	}
}

// GetErrorAnalysis 抓取窗口期内最近的错误日志并按类别归类
func (s *ChannelMonitorService) GetErrorAnalysis(hours, limit int) (map[string]interface{}, error) {
	if hours <= 0 || hours > 24*30 {
		hours = 24
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	windowStart := time.Now().Unix() - int64(hours)*3600

	query := s.logDB.RebindQuery(`
		SELECT created_at, COALESCE(model_name, '') as model_name,
			COALESCE(channel_id, 0) as channel_id,
			COALESCE(username, '') as username,
			COALESCE(content, '') as content
		FROM logs
		WHERE type = 5 AND created_at >= ?
		ORDER BY created_at DESC
		LIMIT ?`)

	rows, err := s.logDB.Query(query, windowStart, limit)
	if err != nil {
		return nil, err
	}

	categories := map[string]int{}
	samples := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		content := fmt.Sprintf("%v", row["content"])
		cat := errorCategory(content)
		categories[cat]++
		// 样本内容截断，避免超长响应
		if len(content) > 300 {
			content = content[:300] + "..."
		}
		samples = append(samples, map[string]interface{}{
			"created_at": row["created_at"],
			"model_name": row["model_name"],
			"channel_id": row["channel_id"],
			"username":   row["username"],
			"content":    content,
			"category":   cat,
		})
	}

	return map[string]interface{}{
		"categories": categories,
		"samples":    samples,
		"sampled":    len(rows),
	}, nil
}

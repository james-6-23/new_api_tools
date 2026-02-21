package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/new-api-tools/backend/internal/cache"
	"github.com/new-api-tools/backend/internal/database"
)

// AIAutoBanService handles AI-assisted automatic user banning
type AIAutoBanService struct {
	db *database.Manager
}

// NewAIAutoBanService creates a new AIAutoBanService
func NewAIAutoBanService() *AIAutoBanService {
	return &AIAutoBanService{db: database.Get()}
}

// Default config
var defaultAIBanConfig = map[string]interface{}{
	"base_url":              "",
	"api_key":               "",
	"model":                 "",
	"enabled":               false,
	"dry_run":               true,
	"scan_interval_minutes": 30,
	"custom_prompt":         "",
	"whitelist_ips":         []string{},
	"blacklist_ips":         []string{},
	"excluded_models":       []string{},
	"excluded_groups":       []string{},
}

// GetConfig returns AI auto ban configuration with computed fields
func (s *AIAutoBanService) GetConfig() map[string]interface{} {
	cm := cache.Get()
	var config map[string]interface{}
	found, _ := cm.GetJSON("ai_ban:config", &config)
	if !found {
		config = make(map[string]interface{})
		for k, v := range defaultAIBanConfig {
			config[k] = v
		}
	}

	// Compute has_api_key and masked_api_key (matching Python backend behavior)
	apiKey, _ := config["api_key"].(string)
	config["has_api_key"] = apiKey != ""

	maskedKey := ""
	if apiKey != "" {
		if len(apiKey) > 8 {
			maskedKey = apiKey[:4] + strings.Repeat("*", len(apiKey)-8) + apiKey[len(apiKey)-4:]
		} else {
			maskedKey = strings.Repeat("*", len(apiKey))
		}
	}
	config["masked_api_key"] = maskedKey

	return config
}

// SaveConfig saves AI auto ban configuration
func (s *AIAutoBanService) SaveConfig(updates map[string]interface{}) error {
	cm := cache.Get()
	// Read raw config from Redis (not via GetConfig which adds computed fields)
	var config map[string]interface{}
	found, _ := cm.GetJSON("ai_ban:config", &config)
	if !found {
		config = make(map[string]interface{})
		for k, v := range defaultAIBanConfig {
			config[k] = v
		}
	}

	// Apply updates
	for k, v := range updates {
		config[k] = v
	}

	// Strip computed fields before saving (they are re-computed in GetConfig)
	delete(config, "has_api_key")
	delete(config, "masked_api_key")

	cm.Set("ai_ban:config", config, 0)
	return nil
}

// ResetAPIHealth resets the API health status
func (s *AIAutoBanService) ResetAPIHealth() map[string]interface{} {
	cm := cache.Get()
	cm.Delete("ai_ban:api_paused")
	return map[string]interface{}{
		"message": "API 健康状态已重置",
		"status":  "healthy",
	}
}

// GetAuditLogs returns AI audit logs
func (s *AIAutoBanService) GetAuditLogs(limit, offset int, status string) map[string]interface{} {
	cm := cache.Get()
	var allLogs []map[string]interface{}
	cm.GetJSON("ai_ban:audit_logs", &allLogs)

	// Filter by status if provided
	filtered := allLogs
	if status != "" {
		filtered = make([]map[string]interface{}, 0)
		for _, log := range allLogs {
			if logStatus, ok := log["status"].(string); ok && logStatus == status {
				filtered = append(filtered, log)
			}
		}
	}

	total := len(filtered)
	// Paginate
	start := offset
	end := offset + limit
	if start > total {
		start = total
	}
	if end > total {
		end = total
	}

	return map[string]interface{}{
		"items":  filtered[start:end],
		"total":  total,
		"limit":  limit,
		"offset": offset,
	}
}

// ClearAuditLogs clears all AI audit logs
func (s *AIAutoBanService) ClearAuditLogs() map[string]interface{} {
	cm := cache.Get()
	cm.Set("ai_ban:audit_logs", []map[string]interface{}{}, 0)
	return map[string]interface{}{
		"message": "审查记录已清空",
	}
}

// GetAvailableGroups returns groups used in recent logs
func (s *AIAutoBanService) GetAvailableGroups(days int) ([]map[string]interface{}, error) {
	startTime := time.Now().Unix() - int64(days*86400)
	query := s.db.RebindQuery(`
		SELECT DISTINCT group_id as name, COUNT(*) as count
		FROM logs
		WHERE created_at >= ? AND group_id IS NOT NULL AND group_id != ''
		GROUP BY group_id
		ORDER BY count DESC`)

	rows, err := s.db.Query(query, startTime)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// GetAvailableModelsForExclude returns models used in recent logs
func (s *AIAutoBanService) GetAvailableModelsForExclude(days int) ([]map[string]interface{}, error) {
	startTime := time.Now().Unix() - int64(days*86400)
	query := s.db.RebindQuery(`
		SELECT DISTINCT model_name as name, COUNT(*) as count
		FROM logs
		WHERE created_at >= ? AND model_name IS NOT NULL AND model_name != ''
		GROUP BY model_name
		ORDER BY count DESC`)

	rows, err := s.db.Query(query, startTime)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// GetSuspiciousUsers returns users with suspicious behavior patterns
func (s *AIAutoBanService) GetSuspiciousUsers(window string, limit int) ([]map[string]interface{}, error) {
	seconds, ok := WindowSeconds[window]
	if !ok {
		seconds = 3600
	}
	startTime := time.Now().Unix() - seconds

	cacheKey := fmt.Sprintf("ai_ban:suspicious:%s:%d", window, limit)
	cm := cache.Get()
	var cached []map[string]interface{}
	found, _ := cm.GetJSON(cacheKey, &cached)
	if found {
		return cached, nil
	}

	// Find users with high failure rates or unusual patterns
	query := s.db.RebindQuery(`
		SELECT l.user_id, COALESCE(u.username, '') as username,
			COUNT(*) as total_requests,
			SUM(CASE WHEN l.type = 5 THEN 1 ELSE 0 END) as failure_count,
			COALESCE(SUM(l.quota), 0) as total_quota,
			COUNT(DISTINCT l.ip) as unique_ips,
			COUNT(DISTINCT l.model_name) as unique_models
		FROM logs l
		LEFT JOIN users u ON l.user_id = u.id
		WHERE l.created_at >= ? AND l.type IN (2, 5)
		GROUP BY l.user_id, u.username
		HAVING COUNT(*) >= 10
		ORDER BY failure_count DESC, total_requests DESC
		LIMIT ?`)

	rows, err := s.db.Query(query, startTime, limit)
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		total := toInt64(row["total_requests"])
		failures := toInt64(row["failure_count"])
		if total > 0 {
			row["failure_rate"] = float64(failures) / float64(total) * 100
		} else {
			row["failure_rate"] = 0.0
		}
	}

	cm.Set(cacheKey, rows, 2*time.Minute)
	return rows, nil
}

// ManualAssess performs AI assessment on a single user (placeholder)
func (s *AIAutoBanService) ManualAssess(userID int64, window string) map[string]interface{} {
	return map[string]interface{}{
		"user_id":     userID,
		"window":      window,
		"risk_score":  0,
		"risk_level":  "unknown",
		"suggestion":  "AI 评估功能需要配置 API",
		"assessed":    false,
		"assessed_at": time.Now().Unix(),
	}
}

// RunScan performs a scan (placeholder)
func (s *AIAutoBanService) RunScan(window string, limit int) map[string]interface{} {
	return map[string]interface{}{
		"scanned":  0,
		"assessed": 0,
		"banned":   0,
		"dry_run":  true,
		"window":   window,
		"message":  "扫描功能需要配置 AI API",
	}
}

// TestConnection tests the configured API connection (placeholder)
func (s *AIAutoBanService) TestConnection() map[string]interface{} {
	config := s.GetConfig()
	baseURL, _ := config["base_url"].(string)
	if baseURL == "" {
		return map[string]interface{}{
			"success": false,
			"message": "未配置 API Base URL",
		}
	}
	return map[string]interface{}{
		"success": true,
		"message": "连接测试需要在运行时执行",
	}
}

// getEndpointURL builds the API URL, auto-appending /v1 if needed
func getEndpointURL(baseURL, endpoint string) string {
	base := strings.TrimRight(baseURL, "/")
	if strings.HasSuffix(base, "/v1") {
		return base + endpoint
	}
	return base + "/v1" + endpoint
}

// FetchModels fetches available models from OpenAI-compatible /v1/models API with caching
func (s *AIAutoBanService) FetchModels(baseURL, apiKey string, forceRefresh bool) map[string]interface{} {
	config := s.GetConfig()

	if baseURL == "" {
		baseURL, _ = config["base_url"].(string)
	}
	base := strings.TrimRight(baseURL, "/")

	if apiKey == "" {
		apiKey, _ = config["api_key"].(string)
	}
	if apiKey == "" {
		return map[string]interface{}{
			"success": false,
			"message": "API Key 未配置",
			"models":  []interface{}{},
		}
	}

	cm := cache.Get()
	cacheKey := "ai_ban:models_cache"
	cacheURLKey := "ai_ban:models_cache_url"

	// Check if API URL changed
	var cachedURL string
	if found, _ := cm.GetJSON(cacheURLKey, &cachedURL); found && cachedURL != base {
		forceRefresh = true
	}

	// Check cache (permanent, 30 days TTL)
	if !forceRefresh {
		var cached []map[string]interface{}
		if found, _ := cm.GetJSON(cacheKey, &cached); found && len(cached) > 0 {
			return map[string]interface{}{
				"success": true,
				"message": fmt.Sprintf("获取到 %d 个模型", len(cached)),
				"models":  cached,
			}
		}
	}

	// Call external API
	url := getEndpointURL(base, "/models")
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("创建请求失败: %s", err.Error()),
			"models":  []interface{}{},
		}
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		msg := "连接失败，请检查 API 地址"
		if strings.Contains(err.Error(), "timeout") {
			msg = "请求超时，请检查网络或 API 地址"
		}
		return map[string]interface{}{
			"success": false,
			"message": msg,
			"models":  []interface{}{},
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("请求失败: %d", resp.StatusCode),
			"models":  []interface{}{},
		}
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("读取响应失败: %s", err.Error()),
			"models":  []interface{}{},
		}
	}

	var data struct {
		Data []struct {
			ID      string `json:"id"`
			OwnedBy string `json:"owned_by"`
			Created int64  `json:"created"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("解析响应失败: %s", err.Error()),
			"models":  []interface{}{},
		}
	}

	// Build model list
	models := make([]map[string]interface{}, 0, len(data.Data))
	for _, m := range data.Data {
		if m.ID != "" {
			models = append(models, map[string]interface{}{
				"id":       m.ID,
				"owned_by": m.OwnedBy,
				"created":  m.Created,
			})
		}
	}

	// Sort by model ID
	sort.Slice(models, func(i, j int) bool {
		return models[i]["id"].(string) < models[j]["id"].(string)
	})

	// Cache permanently (30 days TTL)
	cacheTTL := 30 * 24 * time.Hour
	cm.Set(cacheKey, models, cacheTTL)
	cm.Set(cacheURLKey, base, cacheTTL)

	return map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("获取到 %d 个模型", len(models)),
		"models":  models,
	}
}

// TestModel tests if a specific model is available by sending a chat completion request
func (s *AIAutoBanService) TestModel(baseURL, apiKey, model string) map[string]interface{} {
	config := s.GetConfig()

	if baseURL == "" {
		baseURL, _ = config["base_url"].(string)
	}
	base := strings.TrimRight(baseURL, "/")

	if apiKey == "" {
		apiKey, _ = config["api_key"].(string)
	}
	if apiKey == "" {
		return map[string]interface{}{
			"success": false,
			"message": "API Key 未配置",
		}
	}

	testMessage := "你好，这是一条 API 连接测试消息，请简短回复确认连接正常。"

	payload := map[string]interface{}{
		"model": model,
		"messages": []map[string]string{
			{"role": "user", "content": testMessage},
		},
		"max_tokens": 100,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("序列化请求失败: %s", err.Error()),
		}
	}

	url := getEndpointURL(base, "/chat/completions")
	req, err := http.NewRequest("POST", url, bytes.NewReader(payloadBytes))
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("创建请求失败: %s", err.Error()),
		}
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	startTime := time.Now()
	resp, err := client.Do(req)
	elapsed := time.Since(startTime)

	if err != nil {
		msg := "连接失败，请检查 API 地址"
		if strings.Contains(err.Error(), "timeout") {
			msg = "请求超时"
		}
		return map[string]interface{}{
			"success": false,
			"message": msg,
		}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("读取响应失败: %s", err.Error()),
		}
	}

	if resp.StatusCode != 200 {
		// Try to extract error detail
		var errResp struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		errorDetail := string(body)
		if len(errorDetail) > 200 {
			errorDetail = errorDetail[:200]
		}
		if json.Unmarshal(body, &errResp) == nil && errResp.Error.Message != "" {
			errorDetail = errResp.Error.Message
		}
		return map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("请求失败 (%d): %s", resp.StatusCode, errorDetail),
		}
	}

	var chatResp struct {
		Model   string `json:"model"`
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
	}

	if err := json.Unmarshal(body, &chatResp); err != nil {
		return map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("解析响应失败: %s", err.Error()),
		}
	}

	content := ""
	if len(chatResp.Choices) > 0 {
		content = chatResp.Choices[0].Message.Content
	}
	actualModel := chatResp.Model
	if actualModel == "" {
		actualModel = model
	}

	return map[string]interface{}{
		"success":      true,
		"message":      "连接成功",
		"model":        actualModel,
		"test_message": testMessage,
		"response":     content,
		"latency_ms":   elapsed.Milliseconds(),
		"usage": map[string]int{
			"prompt_tokens":     chatResp.Usage.PromptTokens,
			"completion_tokens": chatResp.Usage.CompletionTokens,
		},
	}
}

// Whitelist management

// GetWhitelist returns the whitelist user IDs
func (s *AIAutoBanService) GetWhitelist() map[string]interface{} {
	cm := cache.Get()
	var whitelist []int64
	cm.GetJSON("ai_ban:whitelist", &whitelist)

	items := make([]map[string]interface{}, 0)
	if len(whitelist) > 0 {
		// Batch query all whitelist users in one query
		placeholders := buildPlaceholders(s.db.IsPG, len(whitelist), 1)
		args := make([]interface{}, len(whitelist))
		for i, uid := range whitelist {
			args[i] = uid
		}
		query := s.db.RebindQuery(fmt.Sprintf(
			"SELECT id, username, status FROM users WHERE id IN (%s)", placeholders))
		rows, err := s.db.Query(query, args...)
		if err == nil && rows != nil {
			items = rows
		}
	}

	return map[string]interface{}{
		"items": items,
		"total": len(items),
	}
}

// AddToWhitelist adds a user to the whitelist
func (s *AIAutoBanService) AddToWhitelist(userID int64) map[string]interface{} {
	cm := cache.Get()
	var whitelist []int64
	cm.GetJSON("ai_ban:whitelist", &whitelist)

	for _, uid := range whitelist {
		if uid == userID {
			return map[string]interface{}{"message": "用户已在白名单中"}
		}
	}
	whitelist = append(whitelist, userID)
	cm.Set("ai_ban:whitelist", whitelist, 0)
	return map[string]interface{}{"message": fmt.Sprintf("用户 %d 已加入白名单", userID)}
}

// RemoveFromWhitelist removes a user from the whitelist
func (s *AIAutoBanService) RemoveFromWhitelist(userID int64) map[string]interface{} {
	cm := cache.Get()
	var whitelist []int64
	cm.GetJSON("ai_ban:whitelist", &whitelist)

	newList := make([]int64, 0)
	for _, uid := range whitelist {
		if uid != userID {
			newList = append(newList, uid)
		}
	}
	cm.Set("ai_ban:whitelist", newList, 0)
	return map[string]interface{}{"message": fmt.Sprintf("用户 %d 已从白名单移除", userID)}
}

// SearchUserForWhitelist searches users for whitelist addition
func (s *AIAutoBanService) SearchUserForWhitelist(keyword string) ([]map[string]interface{}, error) {
	// Try numeric first (user ID)
	var query string
	var args []interface{}
	if id, err := strconv.ParseInt(keyword, 10, 64); err == nil {
		query = s.db.RebindQuery(
			"SELECT id, username, status FROM users WHERE id = ? OR username LIKE ? LIMIT 20")
		args = []interface{}{id, "%" + keyword + "%"}
	} else {
		query = s.db.RebindQuery(
			"SELECT id, username, status FROM users WHERE username LIKE ? LIMIT 20")
		args = []interface{}{"%" + keyword + "%"}
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

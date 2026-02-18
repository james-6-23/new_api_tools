package service

import (
	"fmt"
	"math"
	"time"

	"github.com/new-api-tools/backend/internal/cache"
	"github.com/new-api-tools/backend/internal/database"
	"github.com/new-api-tools/backend/internal/logger"
)

const (
	analyticsStatePrefix = "analytics:"
	defaultBatchSize     = 5000
	defaultMaxIterations = 100
)

// LogAnalyticsService handles log analytics via direct DB queries + cache
type LogAnalyticsService struct {
	db *database.Manager
}

// NewLogAnalyticsService creates a new LogAnalyticsService
func NewLogAnalyticsService() *LogAnalyticsService {
	return &LogAnalyticsService{db: database.Get()}
}

// GetAnalyticsState returns current processing state from DB
// Goes directly to DB to count processed logs (type=2 and type=5)
func (s *LogAnalyticsService) GetAnalyticsState() map[string]interface{} {
	cm := cache.Get()
	var cached map[string]interface{}
	found, _ := cm.GetJSON("analytics:state", &cached)
	if found {
		return cached
	}

	// Get actual counts from database
	row, err := s.db.QueryOne(`
		SELECT COUNT(*) as total_processed, COALESCE(MAX(id), 0) as last_log_id
		FROM logs WHERE type IN (2, 5)`)
	if err != nil || row == nil {
		return map[string]interface{}{
			"last_log_id":       0,
			"last_processed_at": 0,
			"total_processed":   0,
		}
	}

	result := map[string]interface{}{
		"last_log_id":       toInt64(row["last_log_id"]),
		"last_processed_at": time.Now().Unix(),
		"total_processed":   toInt64(row["total_processed"]),
	}

	cm.Set("analytics:state", result, 60*time.Second)
	return result
}

// GetUserRequestRanking returns top users by request count
func (s *LogAnalyticsService) GetUserRequestRanking(limit int) ([]map[string]interface{}, error) {
	cm := cache.Get()
	var cached []map[string]interface{}
	found, _ := cm.GetJSON("analytics:user_request_ranking", &cached)
	if found && len(cached) > 0 {
		if limit > 0 && limit < len(cached) {
			return cached[:limit], nil
		}
		return cached, nil
	}

	var rows []map[string]interface{}
	var err error

	if IsQuotaDataAvailable() {
		// Fast path: aggregate from quota_data
		query := s.db.RebindQuery(`
			SELECT q.user_id,
				COALESCE(u.username, '') as username,
				COALESCE(SUM(q.count), 0) as request_count,
				COALESCE(SUM(q.quota), 0) as quota_used
			FROM quota_data q
			LEFT JOIN users u ON q.user_id = u.id
			WHERE q.user_id > 0
			GROUP BY q.user_id, u.username
			ORDER BY request_count DESC
			LIMIT ?`)
		rows, err = s.db.QueryWithTimeout(30*time.Second, query, limit)
	} else {
		// Fallback: scan logs with 30-day filter
		thirtyDaysAgo := time.Now().AddDate(0, 0, -30).Unix()
		query := s.db.RebindQuery(`
			SELECT l.user_id,
				COALESCE(l.username, '') as username,
				COUNT(*) as request_count,
				COALESCE(SUM(l.quota), 0) as quota_used
			FROM logs l
			WHERE l.type IN (2, 5) AND l.user_id > 0 AND l.created_at >= ?
			GROUP BY l.user_id, l.username
			ORDER BY request_count DESC
			LIMIT ?`)
		rows, err = s.db.QueryWithTimeout(30*time.Second, query, thirtyDaysAgo, limit)
	}
	if err != nil {
		return nil, err
	}

	cm.Set("analytics:user_request_ranking", rows, 5*time.Minute)
	return rows, nil
}

// GetUserQuotaRanking returns top users by quota consumption
func (s *LogAnalyticsService) GetUserQuotaRanking(limit int) ([]map[string]interface{}, error) {
	cm := cache.Get()
	var cached []map[string]interface{}
	found, _ := cm.GetJSON("analytics:user_quota_ranking", &cached)
	if found && len(cached) > 0 {
		if limit > 0 && limit < len(cached) {
			return cached[:limit], nil
		}
		return cached, nil
	}

	var rows []map[string]interface{}
	var err error

	if IsQuotaDataAvailable() {
		query := s.db.RebindQuery(`
			SELECT q.user_id,
				COALESCE(u.username, '') as username,
				COALESCE(SUM(q.count), 0) as request_count,
				COALESCE(SUM(q.quota), 0) as quota_used
			FROM quota_data q
			LEFT JOIN users u ON q.user_id = u.id
			WHERE q.user_id > 0
			GROUP BY q.user_id, u.username
			ORDER BY quota_used DESC
			LIMIT ?`)
		rows, err = s.db.QueryWithTimeout(30*time.Second, query, limit)
	} else {
		thirtyDaysAgo := time.Now().AddDate(0, 0, -30).Unix()
		query := s.db.RebindQuery(`
			SELECT l.user_id,
				COALESCE(l.username, '') as username,
				COUNT(*) as request_count,
				COALESCE(SUM(l.quota), 0) as quota_used
			FROM logs l
			WHERE l.type IN (2, 5) AND l.user_id > 0 AND l.created_at >= ?
			GROUP BY l.user_id, l.username
			ORDER BY quota_used DESC
			LIMIT ?`)
		rows, err = s.db.QueryWithTimeout(30*time.Second, query, thirtyDaysAgo, limit)
	}
	if err != nil {
		return nil, err
	}

	cm.Set("analytics:user_quota_ranking", rows, 5*time.Minute)
	return rows, nil
}

// GetModelStatistics returns model usage statistics with success_rate and empty_rate
func (s *LogAnalyticsService) GetModelStatistics(limit int) ([]map[string]interface{}, error) {
	cm := cache.Get()
	var cached []map[string]interface{}
	found, _ := cm.GetJSON("analytics:model_statistics", &cached)
	if found && len(cached) > 0 {
		if limit > 0 && limit < len(cached) {
			return cached[:limit], nil
		}
		return cached, nil
	}

	thirtyDaysAgo := time.Now().AddDate(0, 0, -30).Unix()
	query := s.db.RebindQuery(`
		SELECT model_name,
			COUNT(*) as total_requests,
			SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as success_count,
			SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_count,
			SUM(CASE WHEN type = 2 AND completion_tokens = 0 THEN 1 ELSE 0 END) as empty_count
		FROM logs
		WHERE type IN (2, 5) AND model_name != '' AND created_at >= ?
		GROUP BY model_name
		ORDER BY total_requests DESC
		LIMIT ?`)

	rows, err := s.db.QueryWithTimeout(30*time.Second, query, thirtyDaysAgo, limit)
	if err != nil {
		return nil, err
	}

	// Calculate success_rate and empty_rate
	for _, row := range rows {
		total := toInt64(row["total_requests"])
		success := toInt64(row["success_count"])
		empty := toInt64(row["empty_count"])

		successRate := float64(0)
		if total > 0 {
			successRate = float64(success) / float64(total) * 100
		}
		emptyRate := float64(0)
		if success > 0 {
			emptyRate = float64(empty) / float64(success) * 100
		}

		row["success_rate"] = math.Round(successRate*100) / 100
		row["empty_rate"] = math.Round(emptyRate*100) / 100
	}

	cm.Set("analytics:model_statistics", rows, 5*time.Minute)
	return rows, nil
}

// GetSummary returns analytics summary matching Python backend format
// Frontend expects: state, user_request_ranking, user_quota_ranking, model_statistics
func (s *LogAnalyticsService) GetSummary() (map[string]interface{}, error) {
	state := s.GetAnalyticsState()

	requestRanking, err := s.GetUserRequestRanking(10)
	if err != nil {
		requestRanking = []map[string]interface{}{}
	}

	quotaRanking, err := s.GetUserQuotaRanking(10)
	if err != nil {
		quotaRanking = []map[string]interface{}{}
	}

	modelStats, err := s.GetModelStatistics(20)
	if err != nil {
		modelStats = []map[string]interface{}{}
	}

	return map[string]interface{}{
		"state":                state,
		"user_request_ranking": requestRanking,
		"user_quota_ranking":   quotaRanking,
		"model_statistics":     modelStats,
	}, nil
}

// ProcessLogs clears caches and returns actual total count
// In Go implementation, data is queried live from DB — "processing" means refreshing cache
func (s *LogAnalyticsService) ProcessLogs() (map[string]interface{}, error) {
	s.clearAllCaches()

	// Get actual counts to return meaningful response
	row, _ := s.db.QueryOne(`
		SELECT COUNT(*) as total, COALESCE(MAX(id), 0) as max_id
		FROM logs WHERE type IN (2, 5)`)

	total := int64(0)
	maxID := int64(0)
	if row != nil {
		total = toInt64(row["total"])
		maxID = toInt64(row["max_id"])
	}

	logger.L.Business(fmt.Sprintf("日志分析处理完成，共 %d 条日志", total))

	return map[string]interface{}{
		"success":        true,
		"processed":      total,
		"message":        "Analytics cache refreshed, data will reload on next query",
		"last_log_id":    maxID,
		"users_updated":  0,
		"models_updated": 0,
	}, nil
}

// BatchProcess clears caches and returns completion status
// Since Go queries DB directly (no incremental state), batch process just refreshes everything
func (s *LogAnalyticsService) BatchProcess(maxIterations int) (map[string]interface{}, error) {
	if maxIterations <= 0 {
		maxIterations = defaultMaxIterations
	}

	start := time.Now()
	s.clearAllCaches()

	// Get total log count for progress reporting
	row, _ := s.db.QueryOne(`
		SELECT COUNT(*) as total, COALESCE(MAX(id), 0) as max_id
		FROM logs WHERE type IN (2, 5)`)

	total := int64(0)
	maxID := int64(0)
	if row != nil {
		total = toInt64(row["total"])
		maxID = toInt64(row["max_id"])
	}

	elapsed := time.Since(start).Seconds()
	logsPerSec := float64(0)
	if elapsed > 0 {
		logsPerSec = float64(total) / elapsed
	}

	return map[string]interface{}{
		"success":          true,
		"total_processed":  total,
		"iterations":       1,
		"batch_size":       defaultBatchSize,
		"elapsed_seconds":  math.Round(elapsed*100) / 100,
		"logs_per_second":  math.Round(logsPerSec*10) / 10,
		"progress_percent": 100.0,
		"remaining_logs":   0,
		"last_log_id":      maxID,
		"completed":        true,
		"timed_out":        false,
	}, nil
}

// ResetAnalytics clears all analytics caches
func (s *LogAnalyticsService) ResetAnalytics() error {
	s.clearAllCaches()
	logger.L.Business("分析数据已重置")
	return nil
}

// GetSyncStatus returns sync status matching frontend SyncStatus interface
func (s *LogAnalyticsService) GetSyncStatus() (map[string]interface{}, error) {
	// Since Go queries DB directly, we are always "synced"
	row, err := s.db.QueryOne(`
		SELECT COUNT(*) as total, COALESCE(MAX(id), 0) as max_id
		FROM logs WHERE type IN (2, 5)`)
	if err != nil {
		return nil, err
	}

	total := int64(0)
	maxID := int64(0)
	if row != nil {
		total = toInt64(row["total"])
		maxID = toInt64(row["max_id"])
	}

	return map[string]interface{}{
		"last_log_id":        maxID,
		"max_log_id":         maxID,
		"init_cutoff_id":     nil,
		"total_logs_in_db":   total,
		"total_processed":    total,
		"progress_percent":   100.0,
		"remaining_logs":     0,
		"is_synced":          true,
		"is_initializing":    false,
		"needs_initial_sync": false,
		"data_inconsistent":  false,
		"needs_reset":        false,
	}, nil
}

// CheckDataConsistency checks data consistency
func (s *LogAnalyticsService) CheckDataConsistency(autoReset bool) (map[string]interface{}, error) {
	syncStatus, err := s.GetSyncStatus()
	if err != nil {
		return nil, err
	}

	// Since Go queries DB directly, data is always consistent
	return map[string]interface{}{
		"consistent":        true,
		"reset":             false,
		"message":           "Data is consistent (Go backend queries DB directly)",
		"data_inconsistent": false,
		"needs_reset":       false,
		"details":           syncStatus,
	}, nil
}

// clearAllCaches removes all analytics-related caches
func (s *LogAnalyticsService) clearAllCaches() {
	cm := cache.Get()
	cm.Delete("analytics:state")
	cm.Delete("analytics:user_request_ranking")
	cm.Delete("analytics:user_quota_ranking")
	cm.Delete("analytics:model_statistics")
	cm.Delete(analyticsStatePrefix)
}

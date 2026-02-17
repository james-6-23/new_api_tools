package database

import (
	"fmt"
	"strings"
	"time"

	"github.com/new-api-tools/backend/internal/logger"
)

// IndexDef defines a recommended index
type IndexDef struct {
	Name    string
	Table   string
	Columns []string
}

// RecommendedIndexes matches Python's RECOMMENDED_INDEXES
var RecommendedIndexes = []IndexDef{
	// === 最高优先级：排行榜查询 ===
	{"idx_logs_created_type_user", "logs", []string{"created_at", "type", "user_id"}},

	// === 高优先级：大窗口补充 ===
	{"idx_logs_type_created_user", "logs", []string{"type", "created_at", "user_id"}},

	// === 高优先级：Dashboard 活跃 Token 统计 ===
	{"idx_logs_type_created_token", "logs", []string{"type", "created_at", "token_id"}},

	// === 中优先级：Dashboard 模型统计 ===
	{"idx_logs_type_created_model", "logs", []string{"type", "created_at", "model_name"}},

	// === 高优先级：用户活跃度查询 ===
	{"idx_logs_user_type_created", "logs", []string{"user_id", "type", "created_at"}},

	// === IP 监控索引 ===
	{"idx_logs_user_created_ip", "logs", []string{"user_id", "created_at", "ip"}},
	{"idx_logs_created_token_ip", "logs", []string{"created_at", "token_id", "ip"}},
	{"idx_logs_created_ip_token", "logs", []string{"created_at", "ip", "token_id"}},

	// === 其他表索引 ===
	{"idx_users_deleted_status", "users", []string{"deleted_at", "status"}},
	{"idx_tokens_user_deleted", "tokens", []string{"user_id", "deleted_at"}},

	// === 自动分组查询优化 ===
	{"idx_users_group", "users", []string{"group"}},
}

// reservedWords are SQL reserved keywords that need quoting in DDL
var reservedWords = map[string]bool{
	"group": true, "order": true, "key": true, "index": true,
	"table": true, "column": true, "select": true, "where": true,
}

// quoteColumn quotes a column name if it is a SQL reserved word
func (m *Manager) quoteColumn(col string) string {
	if reservedWords[strings.ToLower(col)] {
		if m.IsPG {
			return fmt.Sprintf(`"%s"`, col)
		}
		return fmt.Sprintf("`%s`", col)
	}
	return col
}

// EnsureIndexes creates recommended indexes if they don't exist
func (m *Manager) EnsureIndexes(logProgress bool, delayBetween time.Duration) {
	created := 0
	skipped := 0
	total := len(RecommendedIndexes)

	for i, idx := range RecommendedIndexes {
		// Check if index already exists
		exists, err := m.indexExists(idx.Name, idx.Table)
		if err != nil {
			if logProgress {
				logger.L.Warn(fmt.Sprintf("检查索引失败 %s: %v", idx.Name, err), logger.CatDatabase)
			}
			continue
		}

		if exists {
			skipped++
			continue
		}

		// Check if table exists
		tableExists, err := m.TableExists(idx.Table)
		if err != nil || !tableExists {
			continue
		}

		if logProgress {
			logger.L.System(fmt.Sprintf("创建索引 (%d/%d): %s ON %s...", i+1, total, idx.Name, idx.Table))
		}

		// Create index (quote reserved words in column names)
		quotedCols := make([]string, len(idx.Columns))
		for j, col := range idx.Columns {
			quotedCols[j] = m.quoteColumn(col)
		}
		columnsStr := strings.Join(quotedCols, ", ")
		var createSQL string
		if m.IsPG {
			createSQL = fmt.Sprintf(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "%s" ON %s (%s)`, idx.Name, idx.Table, columnsStr)
			if err := m.ExecuteDDL(createSQL); err != nil {
				if logProgress {
					logger.L.Warn(fmt.Sprintf("创建索引失败 %s: %v", idx.Name, err), logger.CatDatabase)
				}
				continue
			}
		} else {
			createSQL = fmt.Sprintf("CREATE INDEX `%s` ON %s (%s)", idx.Name, idx.Table, columnsStr)
			if _, err := m.Execute(createSQL); err != nil {
				if logProgress {
					logger.L.Warn(fmt.Sprintf("创建索引失败 %s: %v", idx.Name, err), logger.CatDatabase)
				}
				continue
			}
		}

		created++
		if logProgress {
			logger.L.System(fmt.Sprintf("索引创建完成: %s", idx.Name))
		}

		// Delay between creations to reduce DB load
		if delayBetween > 0 && i < total-1 {
			time.Sleep(delayBetween)
		}
	}

	if created > 0 {
		logger.L.System(fmt.Sprintf("索引初始化完成，新建 %d 个，跳过 %d 个已存在", created, skipped))
	} else if skipped > 0 {
		logger.L.System(fmt.Sprintf("索引检查完成，%d 个索引已存在", skipped))
	}
}

// indexExists checks if an index exists
func (m *Manager) indexExists(indexName, tableName string) (bool, error) {
	var query string
	if m.IsPG {
		query = `SELECT 1 FROM pg_indexes WHERE indexname = $1`
		row, err := m.QueryOne(query, indexName)
		return row != nil, err
	}

	query = `SELECT 1 FROM information_schema.statistics
		WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`
	row, err := m.QueryOne(query, tableName, indexName)
	return row != nil, err
}

// CleanupRedundantIndexes removes indexes that are covered by other indexes
func (m *Manager) CleanupRedundantIndexes(logProgress bool) (int, error) {
	// Get all indexes on the logs table
	var indexes []struct {
		Name    string
		Columns string
	}

	if m.IsPG {
		query := `
			SELECT indexname as name, 
				   array_to_string(array_agg(attname ORDER BY attnum), ',') as columns
			FROM pg_indexes 
			JOIN pg_index ON indexrelid = (indexname::regclass)
			JOIN pg_attribute ON attrelid = indrelid AND attnum = ANY(indkey)
			WHERE tablename = 'logs' AND indexname LIKE 'idx_%'
			GROUP BY indexname`
		rows, err := m.DB.Queryx(query)
		if err != nil {
			return 0, err
		}
		defer rows.Close()
		for rows.Next() {
			var idx struct {
				Name    string `db:"name"`
				Columns string `db:"columns"`
			}
			if err := rows.StructScan(&idx); err == nil {
				indexes = append(indexes, struct {
					Name    string
					Columns string
				}{idx.Name, idx.Columns})
			}
		}
	}

	// For now, just return 0 deleted - full cleanup logic can mirror Python's
	deleted := 0
	if logProgress && deleted > 0 {
		logger.L.System(fmt.Sprintf("清理了 %d 个冗余索引", deleted))
	}
	return deleted, nil
}

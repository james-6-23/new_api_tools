package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/new-api-tools/backend/internal/config"
	"github.com/new-api-tools/backend/internal/logger"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// Manager handles database connections and operations
type Manager struct {
	DB     *sqlx.DB
	Config *config.Config
	IsPG   bool
}

// Global database manager
var mgr *Manager

// Global log database manager. Points at the dedicated log DB (LOG_SQL_DSN) when
// configured, otherwise aliases the main manager (mgr). Queries against the
// `logs` table go through GetLog(); everything else uses Get().
var logMgr *Manager

// Init creates and configures the database connection pool
func Init(cfg *config.Config) (*Manager, error) {
	driverName := cfg.DriverName()
	dsn := cfg.DSN()

	if dsn == "" {
		return nil, fmt.Errorf("SQL_DSN environment variable is required")
	}

	db, err := sqlx.Connect(driverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("database connection failed: %w", err)
	}

	// Configure connection pool
	maxOpen := cfg.DBMaxOpenConns
	if maxOpen <= 0 {
		maxOpen = 50
	}
	maxIdle := cfg.DBMaxIdleConns
	if maxIdle <= 0 {
		maxIdle = 15
	}
	db.SetMaxOpenConns(maxOpen)
	db.SetMaxIdleConns(maxIdle)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(3 * time.Minute)

	isPG := cfg.DatabaseEngine == config.PostgreSQL

	mgr = &Manager{
		DB:     db,
		Config: cfg,
		IsPG:   isPG,
	}

	// Log connection info
	engineStr := "MySQL"
	if isPG {
		engineStr = "PostgreSQL"
	}
	logger.L.DBConnected(engineStr, extractHost(dsn), extractDB(dsn))

	// Initialize the log database connection (or alias the main one).
	if err := initLogDB(cfg, maxOpen, maxIdle); err != nil {
		return nil, err
	}

	return mgr, nil
}

// initLogDB sets up logMgr. When LOG_SQL_DSN is unset or identical to the main
// DSN, the log manager simply aliases mgr (zero extra connections). Otherwise it
// opens a dedicated pool against the log database.
func initLogDB(cfg *config.Config, maxOpen, maxIdle int) error {
	if !cfg.HasSeparateLogDB() {
		logMgr = mgr
		return nil
	}

	driverName := cfg.LogDriverName()
	dsn := cfg.LogDSN()

	db, err := sqlx.Connect(driverName, dsn)
	if err != nil {
		// 日志库是增强功能（读独立的 logs 库），连不上时绝不能拖垮整个后端。
		// 优雅降级：回退到主库（日志类查询将读主库那张可能已冻结的 logs 表），
		// 并告警提示用户修复网络/DSN（通常重跑 setup-log-db.sh 即可）。
		logger.L.Warn(fmt.Sprintf("日志库连接失败，已降级为读取主库（日志/流量可能为空）: %v", err), logger.CatSystem)
		logMgr = mgr
		return nil
	}

	db.SetMaxOpenConns(maxOpen)
	db.SetMaxIdleConns(maxIdle)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(3 * time.Minute)

	isPG := cfg.LogDatabaseEngine == config.PostgreSQL

	logMgr = &Manager{
		DB:     db,
		Config: cfg,
		IsPG:   isPG,
	}

	engineStr := "MySQL"
	if isPG {
		engineStr = "PostgreSQL"
	}
	logger.L.DBConnected(engineStr+" [日志库]", extractHost(dsn), extractDB(dsn))

	return nil
}

// Get returns the global database manager
func Get() *Manager {
	if mgr == nil {
		panic("database not initialized, call database.Init() first")
	}
	return mgr
}

// GetLog returns the manager for the log database. It is the dedicated log DB
// when LOG_SQL_DSN is configured, otherwise it falls back to the main manager.
// Use this for any query that reads the `logs` table.
func GetLog() *Manager {
	if logMgr == nil {
		// Init not called, or log DB not wired — fall back to main manager.
		return Get()
	}
	return logMgr
}

// SetForTesting overrides the package-level manager. Tests use this to inject
// an in-memory SQLite backend or a stub Manager — production code never calls it.
func SetForTesting(m *Manager) {
	mgr = m
	logMgr = m
}

// Close closes the database connection(s)
func Close() error {
	// Close the dedicated log DB first if it is a distinct connection.
	if logMgr != nil && logMgr != mgr && logMgr.DB != nil {
		_ = logMgr.DB.Close()
	}
	if mgr != nil && mgr.DB != nil {
		logger.L.DBDisconnected("正常关闭")
		return mgr.DB.Close()
	}
	return nil
}

// Ping checks the database connection
func (m *Manager) Ping() error {
	return m.DB.Ping()
}

// QueryWithTimeout executes a query with a context timeout
func (m *Manager) QueryWithTimeout(timeout time.Duration, query string, args ...interface{}) ([]map[string]interface{}, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	rows, err := m.DB.QueryxContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		row := make(map[string]interface{})
		if err := rows.MapScan(row); err != nil {
			return nil, err
		}
		for k, v := range row {
			if b, ok := v.([]byte); ok {
				row[k] = string(b)
			}
		}
		results = append(results, row)
	}

	return results, rows.Err()
}

// Query executes a query that returns rows
func (m *Manager) Query(query string, args ...interface{}) ([]map[string]interface{}, error) {
	rows, err := m.DB.Queryx(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		row := make(map[string]interface{})
		if err := rows.MapScan(row); err != nil {
			return nil, err
		}
		// Convert []byte to string for readability
		for k, v := range row {
			if b, ok := v.([]byte); ok {
				row[k] = string(b)
			}
		}
		results = append(results, row)
	}

	return results, rows.Err()
}

// QueryOne executes a query that returns a single row
func (m *Manager) QueryOne(query string, args ...interface{}) (map[string]interface{}, error) {
	rows, err := m.Query(query, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}

// QueryOneWithTimeout executes a query with a context timeout that returns a single row
func (m *Manager) QueryOneWithTimeout(timeout time.Duration, query string, args ...interface{}) (map[string]interface{}, error) {
	rows, err := m.QueryWithTimeout(timeout, query, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}

// Execute runs a query that doesn't return rows (INSERT, UPDATE, DELETE)
func (m *Manager) Execute(query string, args ...interface{}) (int64, error) {
	result, err := m.DB.Exec(query, args...)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// ExecuteDDL runs a DDL statement (CREATE, ALTER, DROP)
// For PostgreSQL, this uses a separate connection for CONCURRENTLY operations
func (m *Manager) ExecuteDDL(query string) error {
	if m.IsPG {
		// PostgreSQL DDL with CONCURRENTLY needs its own connection
		ctx := context.Background()
		conn, err := m.DB.DB.Conn(ctx)
		if err != nil {
			return err
		}
		defer conn.Close()
		_, err = conn.ExecContext(ctx, query)
		return err
	}

	_, err := m.DB.Exec(query)
	return err
}

// Placeholder returns the correct placeholder for the database engine
// MySQL uses ?, PostgreSQL uses $1, $2, etc.
func (m *Manager) Placeholder(index int) string {
	if m.IsPG {
		return fmt.Sprintf("$%d", index)
	}
	return "?"
}

// RebindQuery converts ? placeholders to $1, $2 for PostgreSQL
func (m *Manager) RebindQuery(query string) string {
	return m.DB.Rebind(query)
}

// TableExists checks if a table exists in the database
func (m *Manager) TableExists(tableName string) (bool, error) {
	var query string
	if m.IsPG {
		query = `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`
	} else {
		query = `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`
	}

	row, err := m.QueryOne(query, tableName)
	if err != nil {
		return false, err
	}
	return row != nil, nil
}

// ColumnExists checks if a column exists in a table
func (m *Manager) ColumnExists(tableName, columnName string) bool {
	var query string
	if m.IsPG {
		query = `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`
	} else {
		query = `SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`
	}

	row, err := m.QueryOne(query, tableName, columnName)
	if err != nil {
		return false
	}
	return row != nil
}

// Helper functions to extract connection info from DSN (for logging)

func extractHost(dsn string) string {
	// PostgreSQL: postgres://user:pass@host:port/db
	if strings.Contains(dsn, "@") {
		parts := strings.Split(dsn, "@")
		if len(parts) > 1 {
			hostPart := parts[len(parts)-1]
			// Remove /database and ?params
			if idx := strings.Index(hostPart, "/"); idx > 0 {
				hostPart = hostPart[:idx]
			}
			// Remove tcp(...) wrapper for MySQL
			hostPart = strings.TrimPrefix(hostPart, "tcp(")
			hostPart = strings.TrimSuffix(hostPart, ")")
			return hostPart
		}
	}
	return "unknown"
}

func extractDB(dsn string) string {
	// Try to extract database name from DSN
	if idx := strings.LastIndex(dsn, "/"); idx >= 0 {
		dbPart := dsn[idx+1:]
		// Remove ?params
		if qIdx := strings.Index(dbPart, "?"); qIdx >= 0 {
			dbPart = dbPart[:qIdx]
		}
		if dbPart != "" {
			return dbPart
		}
	}
	return "unknown"
}

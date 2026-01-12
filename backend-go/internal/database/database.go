package database

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/ketches/new-api-tools/internal/config"
	"github.com/ketches/new-api-tools/internal/logger"
	"go.uber.org/zap"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

var (
	mainDB      *gorm.DB // NewAPI 主数据库
	localDB     *gorm.DB // SQLite 本地存储
	dbEngine    string   // 当前数据库引擎类型: mysql, postgres, sqlite
	localEngine string   // 本地数据库引擎类型
)

// Init 初始化数据库连接
func Init(cfg *config.Config) error {
	var err error

	// 记录数据库引擎类型
	dbEngine = cfg.Database.Engine

	// 初始化主数据库
	mainDB, err = initMainDB(cfg)
	if err != nil {
		return fmt.Errorf("初始化主数据库失败: %w", err)
	}

	// 本地数据库始终使用独立的 SQLite 文件
	// 如果未配置 LocalDBPath，使用默认路径
	localDBPath := cfg.Database.LocalDBPath
	if localDBPath == "" {
		localDBPath = "./data/local.db"
	}
	localDB, err = initLocalDBWithPath(localDBPath, cfg.Server.Mode)
	if err != nil {
		return fmt.Errorf("初始化本地数据库失败: %w", err)
	}
	localEngine = "sqlite"

	logger.Info("数据库连接初始化成功")
	return nil
}

// initMainDB 初始化主数据库（NewAPI 数据库）
func initMainDB(cfg *config.Config) (*gorm.DB, error) {
	var dialector gorm.Dialector

	switch cfg.Database.Engine {
	case "postgres":
		dialector = postgres.Open(cfg.Database.DSN)
	case "mysql":
		dialector = mysql.Open(cfg.Database.DSN)
	default:
		return nil, fmt.Errorf("不支持的数据库类型: %s", cfg.Database.Engine)
	}

	// GORM 配置
	gormConfig := &gorm.Config{
		Logger: newGormLogger(cfg.Server.Mode),
		NowFunc: func() time.Time {
			return time.Now().Local()
		},
		// 禁用外键约束（NewAPI 数据库可能没有外键）
		DisableForeignKeyConstraintWhenMigrating: true,
	}

	db, err := gorm.Open(dialector, gormConfig)
	if err != nil {
		return nil, fmt.Errorf("连接数据库失败: %w", err)
	}

	// 配置连接池
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("获取数据库实例失败: %w", err)
	}

	sqlDB.SetMaxOpenConns(cfg.Database.MaxOpenConns)
	sqlDB.SetMaxIdleConns(cfg.Database.MaxIdleConns)
	sqlDB.SetConnMaxLifetime(cfg.Database.ConnMaxLifetime)

	// 测试连接
	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("数据库连接测试失败: %w", err)
	}

	logger.Info("主数据库连接成功",
		zap.String("engine", cfg.Database.Engine),
		zap.String("host", cfg.Database.Host),
		zap.Int("port", cfg.Database.Port),
		zap.String("database", cfg.Database.Name),
	)

	return db, nil
}

// initLocalDB 初始化本地 SQLite 数据库
func initLocalDB(cfg *config.Config) (*gorm.DB, error) {
	return initLocalDBWithPath(cfg.Database.LocalDBPath, cfg.Server.Mode)
}

// initLocalDBWithPath 使用指定路径初始化本地 SQLite 数据库
func initLocalDBWithPath(dbPath string, mode string) (*gorm.DB, error) {
	// 确保目录存在
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("创建本地数据库目录失败: %w", err)
	}

	gormConfig := &gorm.Config{
		Logger: newGormLogger(mode),
	}

	db, err := gorm.Open(sqlite.Open(dbPath), gormConfig)
	if err != nil {
		return nil, fmt.Errorf("连接本地数据库失败: %w", err)
	}

	// 自动迁移本地表结构（SQLite）
	if err := migrateLocalTables(db, "sqlite"); err != nil {
		return nil, fmt.Errorf("迁移本地表结构失败: %w", err)
	}

	logger.Info("本地数据库连接成功", zap.String("path", dbPath))
	return db, nil
}

// migrateLocalTables 迁移本地表结构
func migrateLocalTables(db *gorm.DB, engine string) error {
	// 根据数据库类型选择语法
	autoIncrement := "SERIAL PRIMARY KEY"
	textType := "TEXT"
	keyType := "TEXT" // 主键类型（MySQL 不支持 TEXT 作为主键）
	intType := "INTEGER"
	realType := "REAL"
	timestampDefault := "CURRENT_TIMESTAMP"

	switch engine {
	case "mysql":
		autoIncrement = "INT AUTO_INCREMENT PRIMARY KEY"
		keyType = "VARCHAR(255)" // MySQL 主键必须使用 VARCHAR
		realType = "DOUBLE"
	case "sqlite":
		autoIncrement = "INTEGER PRIMARY KEY AUTOINCREMENT"
	}

	// 配置表
	if err := db.Exec(fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS config (
			`+"`key`"+` %s PRIMARY KEY,
			value %s NOT NULL,
			updated_at TIMESTAMP DEFAULT %s
		)
	`, keyType, textType, timestampDefault)).Error; err != nil {
		return err
	}

	// 缓存表
	if err := db.Exec(fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS cache (
			`+"`key`"+` %s PRIMARY KEY,
			value %s NOT NULL,
			expire_at TIMESTAMP NOT NULL,
			created_at TIMESTAMP DEFAULT %s
		)
	`, keyType, textType, timestampDefault)).Error; err != nil {
		return err
	}

	// 统计快照表
	if err := db.Exec(fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS stats_snapshots (
			id %s,
			snapshot_type %s NOT NULL,
			data %s NOT NULL,
			created_at TIMESTAMP DEFAULT %s
		)
	`, autoIncrement, textType, textType, timestampDefault)).Error; err != nil {
		return err
	}

	// 安全审计日志表
	if err := db.Exec(fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS security_audit (
			id %s,
			action %s NOT NULL,
			user_id %s,
			details %s,
			ip_address %s,
			created_at TIMESTAMP DEFAULT %s
		)
	`, autoIncrement, textType, intType, textType, textType, timestampDefault)).Error; err != nil {
		return err
	}

	// AI 审计日志表
	if err := db.Exec(fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS ai_audit_logs (
			id %s,
			user_id %s NOT NULL,
			risk_score %s NOT NULL,
			decision %s NOT NULL,
			reason %s,
			created_at TIMESTAMP DEFAULT %s
		)
	`, autoIncrement, intType, realType, textType, textType, timestampDefault)).Error; err != nil {
		return err
	}

	// 日志分析状态表（兼容 Python 版本的 key-value 结构）
	if err := db.Exec(fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS analytics_state (
			`+"`key`"+` %s PRIMARY KEY,
			value %s NOT NULL DEFAULT 0,
			updated_at %s NOT NULL DEFAULT 0
		)
	`, keyType, intType, intType)).Error; err != nil {
		return err
	}

	// 日志分析元数据表（用于初始化截止点、轻量缓存等）
	if err := db.Exec(fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS analytics_meta (
			`+"`key`"+` %s PRIMARY KEY,
			value %s DEFAULT 0,
			updated_at TIMESTAMP DEFAULT %s
		)
	`, keyType, intType, timestampDefault)).Error; err != nil {
		return err
	}

	// 用户排行缓存表
	if err := db.Exec(fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS user_rankings (
			id %s,
			ranking_type %s NOT NULL,
			data %s NOT NULL,
			updated_at TIMESTAMP DEFAULT %s
		)
	`, autoIncrement, textType, textType, timestampDefault)).Error; err != nil {
		return err
	}

	// 模型统计缓存表
	if err := db.Exec(fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS model_stats (
			id %s,
			model_name %s NOT NULL,
			stats_data %s NOT NULL,
			updated_at TIMESTAMP DEFAULT %s
		)
	`, autoIncrement, textType, textType, timestampDefault)).Error; err != nil {
		return err
	}

	// AI Ban 白名单表
	if err := db.Exec(fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS aiban_whitelist (
			id %s,
			user_id %s NOT NULL UNIQUE,
			reason %s,
			added_by %s,
			expires_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT %s
		)
	`, autoIncrement, intType, textType, textType, timestampDefault)).Error; err != nil {
		return err
	}

	// AI Ban 审计日志表
	if err := db.Exec(fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS aiban_audit_logs (
			id %s,
			scan_id %s,
			action %s NOT NULL,
			user_id %s,
			username %s,
			details %s,
			operator %s,
			risk_score %s DEFAULT 0,
			created_at TIMESTAMP DEFAULT %s
		)
	`, autoIncrement, textType, textType, intType, textType, textType, textType, realType, timestampDefault)).Error; err != nil {
		return err
	}

	// AI Ban 配置表
	if err := db.Exec(fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS aiban_config (
			`+"`key`"+` %s PRIMARY KEY,
			value %s NOT NULL,
			updated_at TIMESTAMP DEFAULT %s
		)
	`, keyType, textType, timestampDefault)).Error; err != nil {
		return err
	}

	// 创建索引（忽略已存在的错误）
	db.Exec("CREATE INDEX IF NOT EXISTS idx_cache_expire ON cache(expire_at)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_stats_type ON stats_snapshots(snapshot_type)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_audit_user ON security_audit(user_id)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_ai_audit_user ON ai_audit_logs(user_id)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_aiban_audit_scan ON aiban_audit_logs(scan_id)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_aiban_audit_user ON aiban_audit_logs(user_id)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_aiban_audit_created ON aiban_audit_logs(created_at)")

	return nil
}

// newGormLogger 创建 GORM 日志适配器
func newGormLogger(mode string) gormlogger.Interface {
	logLevel := gormlogger.Warn
	if mode == "debug" {
		logLevel = gormlogger.Info
	}

	return gormlogger.New(
		&gormLogWriter{},
		gormlogger.Config{
			SlowThreshold:             200 * time.Millisecond,
			LogLevel:                  logLevel,
			IgnoreRecordNotFoundError: true,
			Colorful:                  mode == "debug",
		},
	)
}

// gormLogWriter GORM 日志写入器
type gormLogWriter struct{}

func (w *gormLogWriter) Printf(format string, args ...interface{}) {
	logger.GetSugar().Debugf(format, args...)
}

// GetMainDB 获取主数据库连接
func GetMainDB() *gorm.DB {
	return mainDB
}

// GetLocalDB 获取本地数据库连接
func GetLocalDB() *gorm.DB {
	return localDB
}

// Close 关闭数据库连接
func Close() error {
	if mainDB != nil {
		sqlDB, err := mainDB.DB()
		if err == nil {
			sqlDB.Close()
		}
	}

	if localDB != nil {
		sqlDB, err := localDB.DB()
		if err == nil {
			sqlDB.Close()
		}
	}

	logger.Info("数据库连接已关闭")
	return nil
}

// Transaction 执行事务
func Transaction(fn func(*gorm.DB) error) error {
	return mainDB.Transaction(fn)
}

// HealthCheck 健康检查
func HealthCheck() error {
	// 检查主数据库
	sqlDB, err := mainDB.DB()
	if err != nil {
		return fmt.Errorf("获取主数据库实例失败: %w", err)
	}
	if err := sqlDB.Ping(); err != nil {
		return fmt.Errorf("主数据库连接失败: %w", err)
	}

	// 检查本地数据库
	localSQLDB, err := localDB.DB()
	if err != nil {
		return fmt.Errorf("获取本地数据库实例失败: %w", err)
	}
	if err := localSQLDB.Ping(); err != nil {
		return fmt.Errorf("本地数据库连接失败: %w", err)
	}

	return nil
}

// IsConnected 检查数据库是否连接
func IsConnected() bool {
	if mainDB == nil {
		return false
	}

	sqlDB, err := mainDB.DB()
	if err != nil {
		return false
	}

	return sqlDB.Ping() == nil
}

// SetTestDB 设置测试数据库（仅用于单元测试）
func SetTestDB(db *gorm.DB) {
	mainDB = db
}

// ClearTestDB 清除测试数据库（仅用于单元测试）
func ClearTestDB() {
	mainDB = nil
}

// GetDBEngine 获取主数据库引擎类型
func GetDBEngine() string {
	return dbEngine
}

// GetLocalDBEngine 获取本地数据库引擎类型
func GetLocalDBEngine() string {
	return localEngine
}

// UpsertSQL 生成兼容多数据库的 UPSERT SQL 语句
// table: 表名
// conflictKey: 冲突键（主键或唯一键）
// columns: 列名列表
// updateColumns: 需要更新的列名列表（为空则更新所有列）
// engine: 数据库引擎类型 (mysql, postgres, sqlite)
func UpsertSQL(table, conflictKey string, columns []string, updateColumns []string, engine string) string {
	if len(updateColumns) == 0 {
		updateColumns = columns
	}

	// 构建列名和占位符
	colStr := ""
	placeholders := ""
	for i, col := range columns {
		if i > 0 {
			colStr += ", "
			placeholders += ", "
		}
		colStr += col
		placeholders += "?"
	}

	// 构建更新语句
	updateStr := ""
	for i, col := range updateColumns {
		if i > 0 {
			updateStr += ", "
		}
		switch engine {
		case "mysql":
			updateStr += fmt.Sprintf("%s = VALUES(%s)", col, col)
		default: // postgres, sqlite
			updateStr += fmt.Sprintf("%s = EXCLUDED.%s", col, col)
		}
	}

	// 根据数据库类型生成 SQL
	switch engine {
	case "mysql":
		return fmt.Sprintf(
			"INSERT INTO %s (%s) VALUES (%s) ON DUPLICATE KEY UPDATE %s",
			table, colStr, placeholders, updateStr,
		)
	default: // postgres, sqlite
		return fmt.Sprintf(
			"INSERT INTO %s (%s) VALUES (%s) ON CONFLICT(%s) DO UPDATE SET %s",
			table, colStr, placeholders, conflictKey, updateStr,
		)
	}
}

// UpsertWithIncrement 生成带累加功能的 UPSERT SQL 语句
// incrementColumn: 需要累加的列名
func UpsertWithIncrement(table, conflictKey string, columns []string, incrementColumn string, engine string) string {
	// 构建列名和占位符
	colStr := ""
	placeholders := ""
	for i, col := range columns {
		if i > 0 {
			colStr += ", "
			placeholders += ", "
		}
		colStr += col
		placeholders += "?"
	}

	// 构建更新语句（累加指定列）
	updateStr := ""
	for i, col := range columns {
		if i > 0 {
			updateStr += ", "
		}
		if col == incrementColumn {
			switch engine {
			case "mysql":
				updateStr += fmt.Sprintf("%s = %s.%s + VALUES(%s)", col, table, col, col)
			default: // postgres, sqlite
				updateStr += fmt.Sprintf("%s = %s.%s + EXCLUDED.%s", col, table, col, col)
			}
		} else {
			switch engine {
			case "mysql":
				updateStr += fmt.Sprintf("%s = VALUES(%s)", col, col)
			default: // postgres, sqlite
				updateStr += fmt.Sprintf("%s = EXCLUDED.%s", col, col)
			}
		}
	}

	// 根据数据库类型生成 SQL
	switch engine {
	case "mysql":
		return fmt.Sprintf(
			"INSERT INTO %s (%s) VALUES (%s) ON DUPLICATE KEY UPDATE %s",
			table, colStr, placeholders, updateStr,
		)
	default: // postgres, sqlite
		return fmt.Sprintf(
			"INSERT INTO %s (%s) VALUES (%s) ON CONFLICT(%s) DO UPDATE SET %s",
			table, colStr, placeholders, conflictKey, updateStr,
		)
	}
}

package database

import (
	"fmt"
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
	mainDB  *gorm.DB // NewAPI 主数据库
	localDB *gorm.DB // SQLite 本地存储
)

// Init 初始化数据库连接
func Init(cfg *config.Config) error {
	var err error

	// 初始化主数据库
	mainDB, err = initMainDB(cfg)
	if err != nil {
		return fmt.Errorf("初始化主数据库失败: %w", err)
	}

	// 初始化本地 SQLite 数据库
	localDB, err = initLocalDB(cfg)
	if err != nil {
		return fmt.Errorf("初始化本地数据库失败: %w", err)
	}

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
	gormConfig := &gorm.Config{
		Logger: newGormLogger(cfg.Server.Mode),
	}

	db, err := gorm.Open(sqlite.Open(cfg.Database.LocalDBPath), gormConfig)
	if err != nil {
		return nil, fmt.Errorf("连接本地数据库失败: %w", err)
	}

	// 自动迁移本地表结构
	if err := migrateLocalTables(db); err != nil {
		return nil, fmt.Errorf("迁移本地表结构失败: %w", err)
	}

	logger.Info("本地数据库连接成功", zap.String("path", cfg.Database.LocalDBPath))
	return db, nil
}

// migrateLocalTables 迁移本地表结构
func migrateLocalTables(db *gorm.DB) error {
	// 配置表
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS config (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`).Error; err != nil {
		return err
	}

	// 缓存表
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS cache (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			expire_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`).Error; err != nil {
		return err
	}

	// 统计快照表
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS stats_snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			snapshot_type TEXT NOT NULL,
			data TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`).Error; err != nil {
		return err
	}

	// 安全审计日志表
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS security_audit (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			action TEXT NOT NULL,
			user_id INTEGER,
			details TEXT,
			ip_address TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`).Error; err != nil {
		return err
	}

	// AI 审计日志表
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS ai_audit_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			risk_score REAL NOT NULL,
			decision TEXT NOT NULL,
			reason TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`).Error; err != nil {
		return err
	}

	// 日志分析状态表
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS analytics_state (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			last_processed_id INTEGER DEFAULT 0,
			last_processed_at DATETIME,
			total_processed INTEGER DEFAULT 0,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`).Error; err != nil {
		return err
	}

	// 用户排行缓存表
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS user_rankings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ranking_type TEXT NOT NULL,
			data TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`).Error; err != nil {
		return err
	}

	// 模型统计缓存表
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS model_stats (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			model_name TEXT NOT NULL,
			stats_data TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`).Error; err != nil {
		return err
	}

	// AI Ban 白名单表
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS aiban_whitelist (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL UNIQUE,
			reason TEXT,
			added_by TEXT,
			expires_at DATETIME,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`).Error; err != nil {
		return err
	}

	// AI Ban 审计日志表
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS aiban_audit_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			scan_id TEXT,
			action TEXT NOT NULL,
			user_id INTEGER,
			username TEXT,
			details TEXT,
			operator TEXT,
			risk_score REAL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`).Error; err != nil {
		return err
	}

	// AI Ban 配置表
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS aiban_config (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`).Error; err != nil {
		return err
	}

	// 创建索引
	db.Exec("CREATE INDEX IF NOT EXISTS idx_cache_expire ON cache(expire_at)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_stats_type ON stats_snapshots(snapshot_type)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_audit_user ON security_audit(user_id)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_ai_audit_user ON ai_audit_logs(user_id)")
	// AI Ban 相关索引
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

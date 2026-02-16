package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// DatabaseEngine represents the database type
type DatabaseEngine string

const (
	MySQL      DatabaseEngine = "mysql"
	PostgreSQL DatabaseEngine = "postgresql"
)

// Config holds all application configuration
type Config struct {
	// Server
	ServerPort int    `json:"server_port"`
	ServerHost string `json:"server_host"`
	TimeZone   string `json:"timezone"`

	// Database
	SQLDSN         string         `json:"sql_dsn"`
	DatabaseEngine DatabaseEngine `json:"database_engine"`

	// Redis
	RedisConnString string `json:"redis_conn_string"`

	// Authentication
	APIKey         string        `json:"api_key"`
	AdminPassword  string        `json:"admin_password"`
	JWTSecretKey   string        `json:"jwt_secret_key"`
	JWTAlgorithm   string        `json:"jwt_algorithm"`
	JWTExpireHours time.Duration `json:"jwt_expire_hours"`

	// NewAPI
	NewAPIBaseURL string `json:"newapi_base_url"`
	NewAPIKey     string `json:"newapi_api_key"`

	// Logging
	LogFile  string `json:"log_file"`
	LogLevel string `json:"log_level"`

	// Data directory (for persistent local storage)
	DataDir string `json:"data_dir"`
}

// Global config instance
var cfg *Config

// Load reads configuration from environment variables
func Load() *Config {
	cfg = &Config{
		// Server defaults
		ServerPort: getEnvInt("PORT", 8000),
		ServerHost: getEnvStr("HOST", "0.0.0.0"),
		TimeZone:   getEnvStr("TZ", "Asia/Shanghai"),

		// Database
		SQLDSN: getEnvStr("SQL_DSN", ""),

		// Redis
		RedisConnString: getEnvStr("REDIS_CONN_STRING", ""),

		// Authentication
		APIKey:         getEnvStr("API_KEY", ""),
		AdminPassword:  getEnvStr("ADMIN_PASSWORD", ""),
		JWTSecretKey:   getEnvStr("JWT_SECRET_KEY", "newapi-middleware-secret-key-change-in-production"),
		JWTAlgorithm:   "HS256",
		JWTExpireHours: time.Duration(getEnvInt("JWT_EXPIRE_HOURS", 24)) * time.Hour,

		// NewAPI
		NewAPIBaseURL: getEnvStr("NEWAPI_BASE_URL", "http://localhost:3000"),
		NewAPIKey:     getEnvStr("NEWAPI_API_KEY", ""),

		// Logging
		LogFile:  getEnvStr("LOG_FILE", ""),
		LogLevel: getEnvStr("LOG_LEVEL", "info"),

		// Data
		DataDir: getEnvStr("DATA_DIR", "./data"),
	}

	// Auto-detect database engine from DSN
	cfg.DatabaseEngine = detectEngine(cfg.SQLDSN)

	// Set timezone
	if cfg.TimeZone != "" {
		loc, err := time.LoadLocation(cfg.TimeZone)
		if err != nil {
			log.Warn().Str("timezone", cfg.TimeZone).Err(err).Msg("无法加载时区，使用 UTC")
		} else {
			time.Local = loc
		}
	}

	return cfg
}

// Get returns the global config, panics if not loaded
func Get() *Config {
	if cfg == nil {
		panic("config not loaded, call config.Load() first")
	}
	return cfg
}

// detectEngine determines the database engine from DSN format
func detectEngine(dsn string) DatabaseEngine {
	if dsn == "" {
		return MySQL // default
	}

	lower := strings.ToLower(dsn)

	// PostgreSQL DSN patterns:
	//   postgresql://user:pass@host:5432/db
	//   postgres://user:pass@host:5432/db
	//   host=localhost user=postgres ...
	if strings.HasPrefix(lower, "postgres://") ||
		strings.HasPrefix(lower, "postgresql://") ||
		strings.Contains(lower, "host=") {
		return PostgreSQL
	}

	// MySQL DSN patterns:
	//   user:pass@tcp(host:3306)/db
	//   mysql://user:pass@host:3306/db
	if strings.Contains(lower, "@tcp(") ||
		strings.HasPrefix(lower, "mysql://") {
		return MySQL
	}

	// Default to MySQL
	return MySQL
}

// DSN returns a driver-compatible DSN string
func (c *Config) DSN() string {
	dsn := c.SQLDSN

	// Strip protocol prefix if present
	if strings.HasPrefix(dsn, "mysql://") {
		dsn = strings.TrimPrefix(dsn, "mysql://")
	}

	return dsn
}

// DriverName returns the database driver name for sqlx
func (c *Config) DriverName() string {
	switch c.DatabaseEngine {
	case PostgreSQL:
		return "pgx"
	default:
		return "mysql"
	}
}

// ServerAddr returns the full server address
func (c *Config) ServerAddr() string {
	return fmt.Sprintf("%s:%d", c.ServerHost, c.ServerPort)
}

// Helper functions

func getEnvStr(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}

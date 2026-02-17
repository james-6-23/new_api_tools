package config

import (
	"crypto/rand"
	"encoding/hex"
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

	// LinuxDo Lookup proxy (optional, e.g. socks5://user:pass@host:port)
	LinuxDoProxyURL string `json:"linuxdo_proxy_url"`
}

// Global config instance
var cfg *Config

// Load reads configuration from environment variables
func Load() *Config {
	cfg = &Config{
		// Server defaults (support both SERVER_PORT/PORT and SERVER_HOST/HOST)
		ServerPort: getEnvIntMulti([]string{"SERVER_PORT", "PORT"}, 8000),
		ServerHost: getEnvStrMulti([]string{"SERVER_HOST", "HOST"}, "0.0.0.0"),
		TimeZone:   getEnvStrMulti([]string{"TIMEZONE", "TZ"}, "Asia/Shanghai"),

		// Database
		SQLDSN: getEnvStr("SQL_DSN", ""),

		// Redis
		RedisConnString: getEnvStr("REDIS_CONN_STRING", ""),

		// Authentication
		APIKey:         getEnvStr("API_KEY", ""),
		AdminPassword:  getEnvStr("ADMIN_PASSWORD", ""),
		JWTSecretKey:   getEnvStrMulti([]string{"JWT_SECRET_KEY", "JWT_SECRET"}, ""),
		JWTAlgorithm:   "HS256",
		JWTExpireHours: time.Duration(getEnvInt("JWT_EXPIRE_HOURS", 24)) * time.Hour,

		// NewAPI
		NewAPIBaseURL: getEnvStrMulti([]string{"NEWAPI_BASEURL", "NEWAPI_BASE_URL"}, "http://localhost:3000"),
		NewAPIKey:     getEnvStrMulti([]string{"NEWAPI_API_KEY", "API_KEY"}, ""),

		// Logging
		LogFile:  getEnvStr("LOG_FILE", ""),
		LogLevel: getEnvStr("LOG_LEVEL", "info"),

		// Data
		DataDir: getEnvStr("DATA_DIR", "./data"),

		// LinuxDo proxy
		LinuxDoProxyURL: getEnvStrMulti([]string{"LINUXDO_PROXY_URL", "LINUXDO_PROXY"}, ""),
	}

	// ======== Backward compatibility: build SQL_DSN from split fields ========
	if cfg.SQLDSN == "" {
		cfg.SQLDSN = buildDSNFromSplitFields()
	}

	// ======== Backward compatibility: build Redis conn string ========
	if cfg.RedisConnString == "" {
		cfg.RedisConnString = buildRedisConnString()
	}

	// Auto-detect database engine from DSN
	cfg.DatabaseEngine = detectEngine(cfg.SQLDSN)

	// Generate random JWT secret if not explicitly configured
	if cfg.JWTSecretKey == "" {
		cfg.JWTSecretKey = generateRandomSecret(32)
		log.Warn().Msg("JWT_SECRET_KEY 未配置，已自动生成随机密钥（重启后 token 将失效，建议显式配置）")
	}

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

// buildDSNFromSplitFields constructs SQL_DSN from legacy DB_ENGINE/DB_DNS/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD
func buildDSNFromSplitFields() string {
	engine := strings.ToLower(getEnvStr("DB_ENGINE", ""))
	host := getEnvStr("DB_DNS", "")
	port := getEnvStr("DB_PORT", "")
	name := getEnvStr("DB_NAME", "")
	user := getEnvStr("DB_USER", "")
	pass := getEnvStr("DB_PASSWORD", "")

	if host == "" {
		return ""
	}

	switch engine {
	case "postgres", "postgresql":
		// PostgreSQL: host=xxx port=5432 user=xxx password=xxx dbname=xxx sslmode=disable
		dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s sslmode=disable", host, user, pass, name)
		if port != "" {
			dsn = fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable", host, port, user, pass, name)
		}
		return dsn
	default:
		// MySQL: user:pass@tcp(host:port)/dbname?charset=utf8mb4&parseTime=True
		if port == "" {
			port = "3306"
		}
		return fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True", user, pass, host, port, name)
	}
}

// buildRedisConnString constructs Redis connection string from legacy REDIS_HOST/REDIS_PORT/REDIS_PASSWORD
func buildRedisConnString() string {
	host := getEnvStrMulti([]string{"REDIS_HOST"}, "")
	port := getEnvStrMulti([]string{"REDIS_PORT"}, "6379")
	pass := getEnvStr("REDIS_PASSWORD", "")

	if host == "" {
		return ""
	}

	if pass != "" {
		return fmt.Sprintf("redis://:%s@%s:%s/0", pass, host, port)
	}
	return fmt.Sprintf("redis://%s:%s/0", host, port)
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

// getEnvStrMulti tries multiple env var keys in order, returns first found or default
func getEnvStrMulti(keys []string, defaultVal string) string {
	for _, key := range keys {
		if val := os.Getenv(key); val != "" {
			return val
		}
	}
	return defaultVal
}

// getEnvIntMulti tries multiple env var keys in order, returns first found or default
func getEnvIntMulti(keys []string, defaultVal int) int {
	for _, key := range keys {
		if val := os.Getenv(key); val != "" {
			if i, err := strconv.Atoi(val); err == nil {
				return i
			}
		}
	}
	return defaultVal
}

// generateRandomSecret generates a cryptographically secure random hex string
func generateRandomSecret(bytes int) string {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		// Fallback: use timestamp-based key (still better than hardcoded)
		return fmt.Sprintf("auto-%d-%d", time.Now().UnixNano(), os.Getpid())
	}
	return hex.EncodeToString(b)
}

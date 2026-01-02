package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Config 全局配置结构
type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	Redis    RedisConfig
	Auth     AuthConfig
	GeoIP    GeoIPConfig
	Cache    CacheConfig
}

// ServerConfig 服务器配置
type ServerConfig struct {
	Port         int
	Mode         string // debug, release, test
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
}

// DatabaseConfig 数据库配置
type DatabaseConfig struct {
	Engine   string // mysql, postgres
	Host     string
	Port     int
	Name     string
	User     string
	Password string
	DSN      string // 完整连接字符串（优先级高于分离配置）

	// 连接池配置
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration

	// SQLite 本地存储
	LocalDBPath string
}

// RedisConfig Redis 配置
type RedisConfig struct {
	Host         string
	Port         int
	Password     string
	DB           int
	ConnString   string // 完整连接字符串（优先级高于分离配置）
	PoolSize     int
	MinIdleConns int
}

// AuthConfig 认证配置
type AuthConfig struct {
	AdminPassword  string
	APIKey         string
	JWTSecret      string
	JWTExpireHours int
}

// GeoIPConfig GeoIP 配置
type GeoIPConfig struct {
	DBPath       string
	UpdateURL    string
	UpdatePeriod time.Duration
	LicenseKey   string
}

// CacheConfig 缓存配置
type CacheConfig struct {
	DefaultTTL      time.Duration
	DashboardTTL    time.Duration
	LeaderboardTTL  time.Duration
	IPMonitoringTTL time.Duration
}

var globalConfig *Config

// Load 加载配置
func Load() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./config")
	viper.AddConfigPath("/app/config")

	// 设置环境变量前缀
	viper.SetEnvPrefix("")
	viper.AutomaticEnv()
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	// 尝试读取配置文件（可选）
	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("读取配置文件失败: %w", err)
		}
		// 配置文件不存在，使用环境变量
	}

	// 设置默认值
	setDefaults()

	cfg := &Config{}

	// 服务器配置
	cfg.Server.Port = viper.GetInt("server.port")
	cfg.Server.Mode = viper.GetString("server.mode")
	cfg.Server.ReadTimeout = viper.GetDuration("server.read_timeout")
	cfg.Server.WriteTimeout = viper.GetDuration("server.write_timeout")

	// 数据库配置
	cfg.Database = parseDatabaseConfig()

	// Redis 配置
	cfg.Redis = parseRedisConfig()

	// 认证配置 - 支持多种环境变量名
	cfg.Auth.AdminPassword = viper.GetString("auth.admin_password")
	if cfg.Auth.AdminPassword == "" {
		cfg.Auth.AdminPassword = viper.GetString("admin_password")
	}
	cfg.Auth.APIKey = viper.GetString("auth.api_key")
	if cfg.Auth.APIKey == "" {
		cfg.Auth.APIKey = viper.GetString("api_key")
	}
	cfg.Auth.JWTSecret = viper.GetString("auth.jwt_secret")
	if cfg.Auth.JWTSecret == "" {
		cfg.Auth.JWTSecret = viper.GetString("jwt_secret")
	}
	cfg.Auth.JWTExpireHours = viper.GetInt("auth.jwt_expire_hours")

	// 自动生成密钥（如果未设置）
	if cfg.Auth.AdminPassword == "" {
		cfg.Auth.AdminPassword = "admin123" // 默认密码，生产环境应设置 ADMIN_PASSWORD
	}
	if cfg.Auth.APIKey == "" {
		cfg.Auth.APIKey = generateRandomKey(32)
	}
	if cfg.Auth.JWTSecret == "" {
		cfg.Auth.JWTSecret = generateRandomKey(64)
	}

	// GeoIP 配置
	cfg.GeoIP.DBPath = viper.GetString("geoip.db_path")
	cfg.GeoIP.UpdateURL = viper.GetString("geoip.update_url")
	cfg.GeoIP.UpdatePeriod = viper.GetDuration("geoip.update_period")
	cfg.GeoIP.LicenseKey = viper.GetString("geoip.license_key")
	if cfg.GeoIP.LicenseKey == "" {
		cfg.GeoIP.LicenseKey = viper.GetString("geoip_license_key")
	}

	// 缓存配置
	cfg.Cache.DefaultTTL = viper.GetDuration("cache.default_ttl")
	cfg.Cache.DashboardTTL = viper.GetDuration("cache.dashboard_ttl")
	cfg.Cache.LeaderboardTTL = viper.GetDuration("cache.leaderboard_ttl")
	cfg.Cache.IPMonitoringTTL = viper.GetDuration("cache.ip_monitoring_ttl")

	// 验证必需配置
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	globalConfig = cfg
	return cfg, nil
}

// setDefaults 设置默认值
func setDefaults() {
	// 服务器默认值
	viper.SetDefault("server.port", 8000)
	viper.SetDefault("server.mode", "release")
	viper.SetDefault("server.read_timeout", 30*time.Second)
	viper.SetDefault("server.write_timeout", 30*time.Second)

	// 数据库默认值
	viper.SetDefault("database.engine", "mysql")
	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", 3306)
	viper.SetDefault("database.name", "new-api")
	viper.SetDefault("database.max_open_conns", 100)
	viper.SetDefault("database.max_idle_conns", 10)
	viper.SetDefault("database.conn_max_lifetime", 3600*time.Second)
	viper.SetDefault("database.local_db_path", "/app/data/local.db")

	// Redis 默认值
	viper.SetDefault("redis.host", "localhost")
	viper.SetDefault("redis.port", 6379)
	viper.SetDefault("redis.db", 0)
	viper.SetDefault("redis.pool_size", 10)
	viper.SetDefault("redis.min_idle_conns", 5)

	// 认证默认值
	viper.SetDefault("auth.jwt_expire_hours", 24)

	// GeoIP 默认值
	viper.SetDefault("geoip.db_path", "/app/data/GeoLite2-Country.mmdb")
	viper.SetDefault("geoip.update_url", "https://github.com/P3TERX/GeoLite.mmdb/raw/download/GeoLite2-Country.mmdb")
	viper.SetDefault("geoip.update_period", 24*time.Hour)

	// 缓存默认值
	viper.SetDefault("cache.default_ttl", 5*time.Minute)
	viper.SetDefault("cache.dashboard_ttl", 5*time.Minute)
	viper.SetDefault("cache.leaderboard_ttl", 1*time.Minute)
	viper.SetDefault("cache.ip_monitoring_ttl", 10*time.Minute)
}

// parseDatabaseConfig 解析数据库配置（支持 SQL_DSN 和分离配置）
func parseDatabaseConfig() DatabaseConfig {
	cfg := DatabaseConfig{
		Engine:          viper.GetString("database.engine"),
		Host:            viper.GetString("database.host"),
		Port:            viper.GetInt("database.port"),
		Name:            viper.GetString("database.name"),
		User:            viper.GetString("database.user"),
		Password:        viper.GetString("database.password"),
		DSN:             viper.GetString("sql_dsn"),
		MaxOpenConns:    viper.GetInt("database.max_open_conns"),
		MaxIdleConns:    viper.GetInt("database.max_idle_conns"),
		ConnMaxLifetime: viper.GetDuration("database.conn_max_lifetime"),
		LocalDBPath:     viper.GetString("database.local_db_path"),
	}

	// 兼容 NewAPI 的 SQL_DSN 格式
	if cfg.DSN != "" {
		// 解析 DSN 以确定数据库类型
		if strings.HasPrefix(cfg.DSN, "postgresql://") || strings.HasPrefix(cfg.DSN, "postgres://") {
			cfg.Engine = "postgres"
		} else if strings.Contains(cfg.DSN, "@tcp(") {
			cfg.Engine = "mysql"
			// 转换 MySQL DSN 格式: user:pass@tcp(host:port)/dbname
			// 保持原样，GORM 可以直接使用
		}
	} else {
		// 构建 DSN
		if cfg.Engine == "postgres" {
			cfg.DSN = fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=disable",
				cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.Name)
		} else {
			cfg.DSN = fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=True&loc=Local",
				cfg.User, cfg.Password, cfg.Host, cfg.Port, cfg.Name)
		}
	}

	// 兼容环境变量别名
	if dbDNS := viper.GetString("db_dns"); dbDNS != "" {
		cfg.Host = dbDNS
	}
	if dbPort := viper.GetInt("db_port"); dbPort != 0 {
		cfg.Port = dbPort
	}
	if dbName := viper.GetString("db_name"); dbName != "" {
		cfg.Name = dbName
	}
	if dbUser := viper.GetString("db_user"); dbUser != "" {
		cfg.User = dbUser
	}
	if dbPassword := viper.GetString("db_password"); dbPassword != "" {
		cfg.Password = dbPassword
	}
	if dbEngine := viper.GetString("db_engine"); dbEngine != "" {
		cfg.Engine = dbEngine
	}

	return cfg
}

// parseRedisConfig 解析 Redis 配置（支持 REDIS_CONN_STRING 和分离配置）
func parseRedisConfig() RedisConfig {
	cfg := RedisConfig{
		Host:         viper.GetString("redis.host"),
		Port:         viper.GetInt("redis.port"),
		Password:     viper.GetString("redis.password"),
		DB:           viper.GetInt("redis.db"),
		ConnString:   viper.GetString("redis_conn_string"),
		PoolSize:     viper.GetInt("redis.pool_size"),
		MinIdleConns: viper.GetInt("redis.min_idle_conns"),
	}

	// 兼容环境变量别名
	if redisHost := viper.GetString("redis_host"); redisHost != "" {
		cfg.Host = redisHost
	}
	if redisPort := viper.GetInt("redis_port"); redisPort != 0 {
		cfg.Port = redisPort
	}
	if redisPassword := viper.GetString("redis_password"); redisPassword != "" {
		cfg.Password = redisPassword
	}
	if redisDB := viper.GetInt("redis_db"); redisDB != 0 {
		cfg.DB = redisDB
	}

	return cfg
}

// Validate 验证配置
func (c *Config) Validate() error {
	// AdminPassword 已有默认值，这里只做警告
	if c.Auth.AdminPassword == "admin123" {
		fmt.Println("⚠️  警告: 使用默认密码 admin123，生产环境请设置 ADMIN_PASSWORD 环境变量")
	}

	if c.Database.DSN == "" {
		return fmt.Errorf("数据库配置不完整，请设置 SQL_DSN 环境变量")
	}

	return nil
}

// Get 获取全局配置
func Get() *Config {
	return globalConfig
}

// generateRandomKey 生成随机密钥
func generateRandomKey(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	for i := range b {
		b[i] = charset[time.Now().UnixNano()%int64(len(charset))]
		time.Sleep(time.Nanosecond)
	}
	return string(b)
}

// GetEnv 获取环境变量（带默认值）
func GetEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

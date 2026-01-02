package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/ketches/new-api-tools/internal/config"
	"github.com/ketches/new-api-tools/pkg/jwt"
)

// AuthMiddleware JWT 认证中间件
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 从 Header 获取 Token
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "未提供认证令牌",
			})
			c.Abort()
			return
		}

		// 解析 Bearer Token
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "认证令牌格式错误",
			})
			c.Abort()
			return
		}

		tokenString := parts[1]

		// 验证 Token
		claims, err := jwt.ParseToken(tokenString)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "无效的认证令牌",
			})
			c.Abort()
			return
		}

		// 将用户信息存入上下文
		c.Set("username", claims.Username)
		c.Set("role", claims.Role)

		c.Next()
	}
}

// APIKeyMiddleware API Key 认证中间件（可选）
func APIKeyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := config.Get()
		if cfg.Auth.APIKey == "" {
			// 未配置 API Key，跳过验证
			c.Next()
			return
		}

		// 从 Header 或 Query 获取 API Key
		apiKey := c.GetHeader("X-API-Key")
		if apiKey == "" {
			apiKey = c.Query("api_key")
		}

		if apiKey == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "未提供 API Key",
			})
			c.Abort()
			return
		}

		if apiKey != cfg.Auth.APIKey {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "无效的 API Key",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// AdminMiddleware 管理员权限中间件
func AdminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, exists := c.Get("role")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "未认证",
			})
			c.Abort()
			return
		}

		// 检查是否是管理员（role >= 10）
		if role.(int) < 10 {
			c.JSON(http.StatusForbidden, gin.H{
				"error": "权限不足",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// CORSMiddleware 跨域中间件
func CORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, X-API-Key")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE, PATCH")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

// RateLimitMiddleware 限流中间件（简单实现）
func RateLimitMiddleware() gin.HandlerFunc {
	// TODO: 实现基于 Redis 的分布式限流
	return func(c *gin.Context) {
		c.Next()
	}
}

// LoggerMiddleware 日志中间件
func LoggerMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 记录请求开始时间
		start := c.GetTime("start")
		if start.IsZero() {
			c.Set("start", c.GetTime("start"))
		}

		c.Next()

		// 记录请求信息（由 Gin 的默认 Logger 处理）
	}
}

// RecoveryMiddleware 恢复中间件
func RecoveryMiddleware() gin.HandlerFunc {
	return gin.Recovery()
}

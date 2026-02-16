package middleware

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/logger"
)

// RequestLoggerMiddleware logs all API requests
// Matches Python's log_requests middleware in main.py
func RequestLoggerMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Skip logging for health check endpoints
		path := c.Request.URL.Path
		if path == "/api/health" || path == "/api/health/db" {
			c.Next()
			return
		}

		start := time.Now()
		clientIP := c.ClientIP()

		// Process request
		c.Next()

		// Calculate duration
		duration := time.Since(start)
		statusCode := c.Writer.Status()
		method := c.Request.Method

		// Log based on status code (matching Python's behavior)
		switch {
		case statusCode >= 500:
			logger.L.APIError(method, path, statusCode, "服务器内部错误", clientIP)
		case statusCode == 401:
			// 401 is normal flow (token expired etc), use WARN level
			logger.L.APIWarn(method, path, statusCode, "认证失败", clientIP)
		case statusCode >= 400:
			logger.L.APIError(method, path, statusCode, "客户端错误", clientIP)
		default:
			logger.L.API(method, path, statusCode, duration, clientIP)
		}
	}
}

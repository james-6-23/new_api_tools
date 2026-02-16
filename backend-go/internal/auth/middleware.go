package auth

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/logger"
	"github.com/new-api-tools/backend/internal/models"
)

// SkipPaths are paths that don't require authentication
var SkipPaths = map[string]bool{
	"/api/health":    true,
	"/api/health/db": true,
}

// SkipPrefixes are path prefixes that don't require authentication
var SkipPrefixes = []string{
	"/api/auth/",
}

// AuthMiddleware provides authentication via API Key or JWT Token
// Matches Python's verify_auth dependency
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path

		// Skip authentication for health check endpoints
		if SkipPaths[path] {
			c.Set("auth_method", "skip")
			c.Next()
			return
		}

		// Skip authentication for auth endpoints (login/logout)
		for _, prefix := range SkipPrefixes {
			if strings.HasPrefix(path, prefix) {
				c.Set("auth_method", "skip")
				c.Next()
				return
			}
		}

		// Try API Key authentication first (X-API-Key header)
		apiKey := c.GetHeader("X-API-Key")
		if apiKey != "" {
			if VerifyAPIKey(apiKey) {
				c.Set("auth_method", "api_key")
				c.Next()
				return
			}

			logger.L.Warn("Invalid API key for request: "+c.Request.Method+" "+path, logger.CatAuth)
			c.AbortWithStatusJSON(http.StatusUnauthorized, models.NewErrorResponse(
				"UNAUTHORIZED",
				"Invalid API key",
			))
			return
		}

		// Try JWT Token authentication (Authorization: Bearer <token>)
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			// Extract token from "Bearer <token>"
			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
				tokenString := parts[1]

				claims, err := ValidateToken(tokenString)
				if err == nil && claims != nil {
					c.Set("auth_method", "jwt")
					c.Set("user_sub", claims.Subject)
					c.Next()
					return
				}

				// Invalid or expired token
				c.AbortWithStatusJSON(http.StatusUnauthorized, models.NewErrorResponse(
					"UNAUTHORIZED",
					"Invalid or expired token",
				))
				return
			}
		}

		// No authentication provided
		logger.L.Warn("Missing authentication for request: "+c.Request.Method+" "+path, logger.CatAuth)
		c.AbortWithStatusJSON(http.StatusUnauthorized, models.NewErrorResponse(
			"UNAUTHORIZED",
			"Authentication required (API Key or JWT Token)",
		))
	}
}

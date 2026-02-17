package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/auth"
	"github.com/new-api-tools/backend/internal/logger"
	"github.com/new-api-tools/backend/internal/models"
)

// RegisterAuthRoutes registers authentication endpoints
func RegisterAuthRoutes(rg *gin.RouterGroup) {
	authGroup := rg.Group("/auth")
	{
		authGroup.POST("/login", Login)
		authGroup.POST("/logout", Logout)
	}
}

// Login handles POST /api/auth/login
// Matches Python's login endpoint in auth_routes.py
//
// 请求体:
//
//	{"password": "admin_password"}
//
// 成功响应 (200):
//
//	{"success": true, "message": "登录成功", "token": "eyJ...", "expires_at": "2024-01-01T00:00:00Z"}
//
// 失败响应 (401):
//
//	{"success": false, "message": "密码错误"}
func Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.LoginResponse{
			Success: false,
			Message: "请求格式错误",
		})
		return
	}

	// Verify password
	if !auth.VerifyPassword(req.Password) {
		clientIP := c.ClientIP()
		logger.L.AuthFail("登录失败 | ip=" + clientIP)
		c.JSON(http.StatusUnauthorized, models.LoginResponse{
			Success: false,
			Message: "密码错误",
		})
		return
	}

	// Generate JWT token
	token, expiresAt, err := auth.GenerateToken("admin")
	if err != nil {
		logger.L.Error("Token 生成失败: "+err.Error(), logger.CatAuth)
		c.JSON(http.StatusInternalServerError, models.LoginResponse{
			Success: false,
			Message: "Token 生成失败",
		})
		return
	}

	clientIP := c.ClientIP()
	logger.L.Auth("登录成功 | ip=" + clientIP)

	c.JSON(http.StatusOK, models.LoginResponse{
		Success:   true,
		Message:   "登录成功",
		Token:     token,
		ExpiresAt: expiresAt.Format(time.RFC3339),
	})
}

// Logout handles POST /api/auth/logout
// Matches Python's logout endpoint
//
// 响应 (200):
//
//	{"success": true, "message": "已登出"}
func Logout(c *gin.Context) {
	c.JSON(http.StatusOK, models.LogoutResponse{
		Success: true,
		Message: "已登出",
	})
}

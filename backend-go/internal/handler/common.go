package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/ketches/new-api-tools/internal/cache"
	"github.com/ketches/new-api-tools/internal/config"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/logger"
	"github.com/ketches/new-api-tools/pkg/jwt"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

// Response 统一响应结构
type Response struct {
	Success bool        `json:"success"`
	Message string      `json:"message,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

// Success 成功响应
func Success(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Response{
		Success: true,
		Data:    data,
	})
}

// Error 错误响应
func Error(c *gin.Context, code int, message string) {
	c.JSON(http.StatusOK, Response{
		Success: false,
		Message: message,
	})
}

// ErrorWithStatus 带 HTTP 状态码的错误响应
func ErrorWithStatus(c *gin.Context, httpStatus int, code int, message string) {
	c.JSON(httpStatus, Response{
		Success: false,
		Message: message,
	})
}

// HealthCheck 健康检查
func HealthCheck(c *gin.Context) {
	// 检查数据库
	if err := database.HealthCheck(); err != nil {
		logger.Error("数据库健康检查失败", zap.Error(err))
		ErrorWithStatus(c, http.StatusServiceUnavailable, 500, "数据库连接失败")
		return
	}

	// 检查 Redis
	if err := cache.HealthCheck(); err != nil {
		logger.Error("Redis 健康检查失败", zap.Error(err))
		ErrorWithStatus(c, http.StatusServiceUnavailable, 500, "Redis 连接失败")
		return
	}

	Success(c, gin.H{
		"status":  "healthy",
		"version": "1.0.0-go",
	})
}

// LoginRequest 登录请求
type LoginRequest struct {
	Password string `json:"password" binding:"required"`
}

// LoginResponse 登录响应
type LoginResponse struct {
	Success   bool   `json:"success"`
	Message   string `json:"message,omitempty"`
	Token     string `json:"token,omitempty"`
	ExpiresAt string `json:"expires_at,omitempty"`
}

// Login 管理员登录
func Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, LoginResponse{Success: false, Message: "请求参数错误"})
		return
	}

	cfg := config.Get()

	// 验证密码
	if err := bcrypt.CompareHashAndPassword([]byte(cfg.Auth.AdminPassword), []byte(req.Password)); err != nil {
		// 如果配置的是明文密码，直接比较
		if req.Password != cfg.Auth.AdminPassword {
			c.JSON(http.StatusOK, LoginResponse{Success: false, Message: "密码错误"})
			return
		}
	}

	// 生成 JWT Token
	token, err := jwt.GenerateToken("admin", 100, cfg.Auth.JWTExpireHours)
	if err != nil {
		logger.Error("生成 Token 失败", zap.Error(err))
		c.JSON(http.StatusOK, LoginResponse{Success: false, Message: "生成令牌失败"})
		return
	}

	logger.Info("管理员登录成功",
		zap.String("ip", c.ClientIP()),
	)

	expiresAt := time.Now().Add(time.Duration(cfg.Auth.JWTExpireHours) * time.Hour).UTC().Format(time.RFC3339)
	c.JSON(http.StatusOK, LoginResponse{
		Success:   true,
		Message:   "Login successful",
		Token:     token,
		ExpiresAt: expiresAt,
	})
}

// Logout 登出
func Logout(c *gin.Context) {
	// JWT 是无状态的，登出只需要客户端删除 Token
	Success(c, gin.H{
		"message": "登出成功",
	})
}

// GetCurrentUser 获取当前用户信息
func GetCurrentUser(c *gin.Context) {
	username, _ := c.Get("username")
	role, _ := c.Get("role")

	Success(c, gin.H{
		"username": username,
		"role":     role,
	})
}

package jwt

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/ketches/new-api-tools/internal/config"
)

// Claims JWT 声明
type Claims struct {
	Username string `json:"username"`
	Role     int    `json:"role"`
	jwt.RegisteredClaims
}

var jwtSecret []byte

// Init 初始化 JWT
func Init(cfg *config.Config) {
	jwtSecret = []byte(cfg.Auth.JWTSecret)
}

// GenerateToken 生成 JWT Token
func GenerateToken(username string, role int, expireHours int) (string, error) {
	now := time.Now()
	expiresAt := now.Add(time.Duration(expireHours) * time.Hour)

	claims := Claims{
		Username: username,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			Issuer:    "newapi-tools",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

// ParseToken 解析 JWT Token
func ParseToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		// 验证签名算法
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return jwtSecret, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}

// RefreshToken 刷新 Token
func RefreshToken(tokenString string, expireHours int) (string, error) {
	claims, err := ParseToken(tokenString)
	if err != nil {
		return "", err
	}

	// 生成新 Token
	return GenerateToken(claims.Username, claims.Role, expireHours)
}

// ValidateToken 验证 Token 是否有效
func ValidateToken(tokenString string) bool {
	_, err := ParseToken(tokenString)
	return err == nil
}

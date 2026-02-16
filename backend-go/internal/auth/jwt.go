package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/new-api-tools/backend/internal/config"
)

// Claims represents the JWT claims
type Claims struct {
	jwt.RegisteredClaims
}

// GenerateToken creates a new JWT token
func GenerateToken(subject string) (string, time.Time, error) {
	cfg := config.Get()

	expiresAt := time.Now().Add(cfg.JWTExpireHours)

	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   subject,
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(cfg.JWTSecretKey))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("failed to sign token: %w", err)
	}

	return tokenString, expiresAt, nil
}

// ValidateToken validates a JWT token and returns the claims
func ValidateToken(tokenString string) (*Claims, error) {
	cfg := config.Get()

	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		// Verify signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(cfg.JWTSecretKey), nil
	})

	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token claims")
}

// VerifyPassword checks if the provided password matches the admin password
func VerifyPassword(password string) bool {
	cfg := config.Get()
	if cfg.AdminPassword == "" {
		return false
	}
	return password == cfg.AdminPassword
}

// VerifyAPIKey checks if the provided API key is valid
func VerifyAPIKey(apiKey string) bool {
	cfg := config.Get()
	if cfg.APIKey == "" {
		// Development mode: allow all
		return true
	}
	return apiKey == cfg.APIKey
}

package auth

import (
	"crypto/subtle"
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
// Uses constant-time comparison to prevent timing attacks
func VerifyPassword(password string) bool {
	cfg := config.Get()
	if cfg.AdminPassword == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(password), []byte(cfg.AdminPassword)) == 1
}

// VerifyAPIKey checks if the provided API key is valid
// Uses constant-time comparison to prevent timing attacks
func VerifyAPIKey(apiKey string) bool {
	cfg := config.Get()
	if cfg.APIKey == "" {
		// API key not configured: reject all requests to enforce explicit configuration
		return false
	}
	return subtle.ConstantTimeCompare([]byte(apiKey), []byte(cfg.APIKey)) == 1
}

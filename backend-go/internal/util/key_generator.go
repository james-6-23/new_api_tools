package util

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strconv"
	"sync"
	"time"
)

const (
	TargetKeyLength = 32
	TimestampLength = 8
	CounterLength   = 4
	MaxPrefixLength = 20
	base36Chars     = "0123456789abcdefghijklmnopqrstuvwxyz"
)

// KeyGenerator generates unique 32-character redemption code keys
// Structure: [prefix][random_part][timestamp_base36][counter_base36]
type KeyGenerator struct {
	counter int64
	mu      sync.Mutex
}

var defaultKeyGen = &KeyGenerator{}

// GenerateKey creates a single unique 32-character key
func GenerateKey(prefix string) (string, error) {
	return defaultKeyGen.Generate(prefix)
}

// GenerateBatch creates a batch of unique keys
func GenerateBatch(count int, prefix string) ([]string, error) {
	return defaultKeyGen.GenerateBatch(count, prefix)
}

// Generate creates a single unique 32-character key
func (g *KeyGenerator) Generate(prefix string) (string, error) {
	if len(prefix) > MaxPrefixLength {
		return "", fmt.Errorf("prefix must not exceed %d characters", MaxPrefixLength)
	}

	// Calculate random part length
	randomLength := TargetKeyLength - len(prefix) - TimestampLength - CounterLength
	if randomLength < 8 {
		randomLength = 8
	}

	// Generate random part
	randomBytes := make([]byte, (randomLength/2)+1)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", fmt.Errorf("failed to generate random bytes: %w", err)
	}
	randomPart := hex.EncodeToString(randomBytes)[:randomLength]

	// Timestamp in base36 (milliseconds)
	timestampMs := time.Now().UnixMilli()
	timestampB36 := Base36Encode(timestampMs)
	if len(timestampB36) > TimestampLength {
		timestampB36 = timestampB36[len(timestampB36)-TimestampLength:]
	}
	for len(timestampB36) < TimestampLength {
		timestampB36 = "0" + timestampB36
	}

	// Counter in base36
	g.mu.Lock()
	g.counter = (g.counter + 1) % 1679616 // 36^4
	counterVal := g.counter
	g.mu.Unlock()

	counterB36 := Base36Encode(counterVal)
	if len(counterB36) > CounterLength {
		counterB36 = counterB36[len(counterB36)-CounterLength:]
	}
	for len(counterB36) < CounterLength {
		counterB36 = "0" + counterB36
	}

	// Combine
	key := prefix + randomPart + timestampB36 + counterB36

	// Ensure exactly 32 characters
	if len(key) > TargetKeyLength {
		key = key[:TargetKeyLength]
	} else if len(key) < TargetKeyLength {
		for len(key) < TargetKeyLength {
			key += "0"
		}
	}

	return key, nil
}

// GenerateBatch creates a batch of unique keys
func (g *KeyGenerator) GenerateBatch(count int, prefix string) ([]string, error) {
	if count < 1 || count > 1000 {
		return nil, fmt.Errorf("count must be between 1 and 1000")
	}
	if len(prefix) > MaxPrefixLength {
		return nil, fmt.Errorf("prefix must not exceed %d characters", MaxPrefixLength)
	}

	keySet := make(map[string]struct{})
	keys := make([]string, 0, count)
	maxAttempts := count * 3

	for len(keys) < count && maxAttempts > 0 {
		key, err := g.Generate(prefix)
		if err != nil {
			return nil, err
		}
		if _, exists := keySet[key]; !exists {
			keySet[key] = struct{}{}
			keys = append(keys, key)
		}
		maxAttempts--
	}

	if len(keys) < count {
		return nil, fmt.Errorf("failed to generate %d unique keys", count)
	}

	return keys, nil
}

// Base36Encode encodes an integer to base36 string
func Base36Encode(n int64) string {
	if n == 0 {
		return "0"
	}
	if n < 0 {
		return "-" + Base36Encode(-n)
	}
	return strconv.FormatInt(n, 36)
}

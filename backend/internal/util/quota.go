package util

import (
	"fmt"
	"math"
	"math/rand"
)

// TokensPerUSD is the conversion rate (1 USD = 500,000 tokens)
const TokensPerUSD = 500000

// CalculateFixedQuota converts a USD amount to tokens
func CalculateFixedQuota(amount float64) (int64, error) {
	if amount < 0 {
		return 0, fmt.Errorf("amount must be non-negative")
	}
	return int64(math.Round(amount * TokensPerUSD)), nil
}

// CalculateRandomQuota generates a random token amount within the specified USD range
func CalculateRandomQuota(minAmount, maxAmount float64) (int64, error) {
	if minAmount < 0 || maxAmount < 0 {
		return 0, fmt.Errorf("amounts must be non-negative")
	}
	if minAmount > maxAmount {
		return 0, fmt.Errorf("min_amount must not exceed max_amount")
	}

	minQuota := int64(math.Round(minAmount * TokensPerUSD))
	maxQuota := int64(math.Round(maxAmount * TokensPerUSD))

	if minQuota == maxQuota {
		return minQuota, nil
	}

	return minQuota + rand.Int63n(maxQuota-minQuota+1), nil
}

// GenerateQuotas generates a list of quotas based on mode
func GenerateQuotas(count int, mode string, fixedAmount, minAmount, maxAmount float64) ([]int64, error) {
	if count < 1 {
		return nil, fmt.Errorf("count must be at least 1")
	}

	quotas := make([]int64, count)

	switch mode {
	case "fixed":
		quota, err := CalculateFixedQuota(fixedAmount)
		if err != nil {
			return nil, err
		}
		for i := range quotas {
			quotas[i] = quota
		}
	case "random":
		for i := range quotas {
			q, err := CalculateRandomQuota(minAmount, maxAmount)
			if err != nil {
				return nil, err
			}
			quotas[i] = q
		}
	default:
		return nil, fmt.Errorf("unknown quota mode: %s", mode)
	}

	return quotas, nil
}

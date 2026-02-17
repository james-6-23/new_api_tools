package util

import (
	"fmt"
	"time"
)

const SecondsPerDay = 86400

// CalculateExpiration calculates expiration timestamp based on mode
// mode: "never" (returns 0), "days" (now + days*86400), "date" (parse date string)
func CalculateExpiration(mode string, days int, expireDate string) (int64, error) {
	switch mode {
	case "never", "":
		return 0, nil
	case "days":
		if days < 0 {
			return 0, fmt.Errorf("days must be non-negative")
		}
		return time.Now().Unix() + int64(days)*SecondsPerDay, nil
	case "date":
		if expireDate == "" {
			return 0, fmt.Errorf("expire_date is required for date mode")
		}
		return parseDateToTimestamp(expireDate, false)
	default:
		return 0, fmt.Errorf("unknown expire mode: %s", mode)
	}
}

// ParseDateToTimestamp parses a date string to Unix timestamp
// Supports ISO 8601 (2024-01-01T00:00:00Z) and date-only (2024-01-01)
func parseDateToTimestamp(dateStr string, endOfDay bool) (int64, error) {
	// Try ISO 8601 with timezone
	layouts := []string{
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02",
	}

	for _, layout := range layouts {
		t, err := time.ParseInLocation(layout, dateStr, time.Local)
		if err == nil {
			if endOfDay && layout == "2006-01-02" {
				t = t.Add(23*time.Hour + 59*time.Minute + 59*time.Second)
			}
			return t.Unix(), nil
		}
	}

	return 0, fmt.Errorf("invalid date format: %s", dateStr)
}

// ParseDateToTimestampPublic is the exported version for use outside util
func ParseDateToTimestampPublic(dateStr string, endOfDay bool) (int64, error) {
	return parseDateToTimestamp(dateStr, endOfDay)
}

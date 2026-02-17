package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/service"
)

// clampInt returns val clamped to [min, max]
func clampInt(val, min, max int) int {
	if val < min {
		return min
	}
	if val > max {
		return max
	}
	return val
}

// parseLimit parses "limit" query param with default and max cap
func parseLimit(c *gin.Context, defaultVal, maxVal int) int {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", strconv.Itoa(defaultVal)))
	return clampInt(limit, 1, maxVal)
}

// parsePage parses "page" query param (minimum 1)
func parsePage(c *gin.Context) int {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	return page
}

// parsePageSize parses "page_size" query param with default and max cap
func parsePageSize(c *gin.Context, defaultVal, maxVal int) int {
	ps, _ := strconv.Atoi(c.DefaultQuery("page_size", strconv.Itoa(defaultVal)))
	return clampInt(ps, 1, maxVal)
}

// validWindow checks if a window string is in the allowed WindowSeconds map
func validWindow(window string) bool {
	_, ok := service.WindowSeconds[window]
	return ok
}

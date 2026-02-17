package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/service"
)

// RegisterLinuxDoRoutes registers /api/linuxdo endpoints
func RegisterLinuxDoRoutes(r *gin.RouterGroup) {
	g := r.Group("/linuxdo")
	{
		g.GET("/lookup/:linux_do_id", LinuxDoLookup)
	}
}

// GET /api/linuxdo/lookup/:linux_do_id
// Looks up the linux.do username for a given user ID via CF bypass.
//
// Success response (200):
//
//	{
//	  "success": true,
//	  "data": {
//	    "linux_do_id": "53144",
//	    "username": "example_user",
//	    "profile_url": "https://linux.do/u/example_user/summary",
//	    "from_cache": false
//	  }
//	}
//
// Rate limit response (429):
//
//	{
//	  "success": false,
//	  "message": "请求被限速，请等待 42 秒后重试",
//	  "error_type": "rate_limit",
//	  "wait_seconds": 42
//	}
//
// Error response (502):
//
//	{
//	  "success": false,
//	  "message": "无法连接到 linux.do，请稍后重试",
//	  "error_type": "network"
//	}
func LinuxDoLookup(c *gin.Context) {
	linuxDoID := c.Param("linux_do_id")
	if linuxDoID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success":    false,
			"message":    "linux_do_id 不能为空",
			"error_type": "invalid_params",
		})
		return
	}

	svc := service.NewLinuxDoLookupService()
	result, lookupErr := svc.LookupUsername(linuxDoID)

	if lookupErr != nil {
		resp := gin.H{
			"success":    false,
			"message":    lookupErr.Message,
			"error_type": lookupErr.ErrorType,
		}
		if lookupErr.WaitSeconds > 0 {
			resp["wait_seconds"] = lookupErr.WaitSeconds
		}
		c.JSON(lookupErr.StatusCode, resp)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

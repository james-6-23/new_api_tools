package models

import (
	"encoding/json"
	"time"
)

// SuccessResponse is the standard success response format
// Matches Python: {"success": true, "data": ...}
type SuccessResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Message string      `json:"message,omitempty"`
}

// ErrorDetail holds the error detail structure
type ErrorDetail struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Details interface{} `json:"details,omitempty"`
}

// ErrorResponse is the standard error response format
// Matches Python: {"success": false, "error": {"code": "...", "message": "...", "details": ...}}
type ErrorResponse struct {
	Success bool        `json:"success"`
	Error   ErrorDetail `json:"error"`
}

// PaginatedResponse wraps paginated data
type PaginatedResponse struct {
	Success  bool        `json:"success"`
	Data     interface{} `json:"data"`
	Total    int64       `json:"total"`
	Page     int         `json:"page"`
	PageSize int         `json:"page_size"`
}

// HealthResponse matches Python's HealthResponse
type HealthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

// DatabaseHealthResponse for /api/health/db
type DatabaseHealthResponse struct {
	Success  bool   `json:"success"`
	Status   string `json:"status"`
	Engine   string `json:"engine,omitempty"`
	Host     string `json:"host,omitempty"`
	Database string `json:"database,omitempty"`
}

// LoginRequest matches Python's LoginRequest
type LoginRequest struct {
	Password string `json:"password" binding:"required"`
}

// LoginResponse matches Python's LoginResponse
type LoginResponse struct {
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	Token     string `json:"token,omitempty"`
	ExpiresAt string `json:"expires_at,omitempty"`
}

// LogoutResponse matches Python's LogoutResponse
type LogoutResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// WarmupStatus represents the cache warmup status
type WarmupStatus struct {
	Status   string                   `json:"status"` // "initializing", "ready"
	Progress int                      `json:"progress"`
	Message  string                   `json:"message"`
	Steps    []map[string]interface{} `json:"steps,omitempty"`
}

// NullTime handles nullable time fields from database
type NullTime struct {
	Time  time.Time
	Valid bool
}

func (nt *NullTime) MarshalJSON() ([]byte, error) {
	if !nt.Valid {
		return json.Marshal(nil)
	}
	return json.Marshal(nt.Time)
}

// NewSuccessResponse creates a standard success response
func NewSuccessResponse(data interface{}) SuccessResponse {
	return SuccessResponse{
		Success: true,
		Data:    data,
	}
}

// NewSuccessMessageResponse creates a success response with message
func NewSuccessMessageResponse(message string) SuccessResponse {
	return SuccessResponse{
		Success: true,
		Message: message,
	}
}

// NewErrorResponse creates a standard error response
func NewErrorResponse(code, message string, details ...interface{}) ErrorResponse {
	resp := ErrorResponse{
		Success: false,
		Error: ErrorDetail{
			Code:    code,
			Message: message,
		},
	}
	if len(details) > 0 {
		resp.Error.Details = details[0]
	}
	return resp
}

// NewPaginatedResponse creates a paginated response
func NewPaginatedResponse(data interface{}, total int64, page, pageSize int) PaginatedResponse {
	return PaginatedResponse{
		Success:  true,
		Data:     data,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}
}

// ErrorResp is a convenience wrapper that returns a gin.H error structure
// Used by handlers for quick error responses
func ErrorResp(code, message, details string) map[string]interface{} {
	resp := map[string]interface{}{
		"success": false,
		"error": map[string]interface{}{
			"code":    code,
			"message": message,
		},
	}
	if details != "" {
		resp["error"].(map[string]interface{})["details"] = details
	}
	return resp
}

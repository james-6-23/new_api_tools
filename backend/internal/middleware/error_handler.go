package middleware

import (
	"fmt"
	"net/http"
	"runtime/debug"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/logger"
	"github.com/new-api-tools/backend/internal/models"
)

// AppError represents an application error with status code
type AppError struct {
	Code       string
	Message    string
	StatusCode int
	Details    interface{}
}

func (e *AppError) Error() string {
	return e.Message
}

// Common error constructors matching Python's exception classes

func NewContainerNotFoundError(message string) *AppError {
	if message == "" {
		message = "NewAPI container not found"
	}
	return &AppError{Code: "CONTAINER_NOT_FOUND", Message: message, StatusCode: http.StatusServiceUnavailable}
}

func NewDatabaseConnectionError(message string, details interface{}) *AppError {
	if message == "" {
		message = "Database connection failed"
	}
	return &AppError{Code: "DB_CONNECTION_FAILED", Message: message, StatusCode: http.StatusServiceUnavailable, Details: details}
}

func NewInvalidParamsError(message string, details interface{}) *AppError {
	if message == "" {
		message = "Invalid parameters"
	}
	return &AppError{Code: "INVALID_PARAMS", Message: message, StatusCode: http.StatusBadRequest, Details: details}
}

func NewUnauthorizedError(message string) *AppError {
	if message == "" {
		message = "Unauthorized"
	}
	return &AppError{Code: "UNAUTHORIZED", Message: message, StatusCode: http.StatusUnauthorized}
}

func NewNotFoundError(message string) *AppError {
	if message == "" {
		message = "Resource not found"
	}
	return &AppError{Code: "NOT_FOUND", Message: message, StatusCode: http.StatusNotFound}
}

func NewInternalError(message string) *AppError {
	if message == "" {
		message = "An unexpected error occurred"
	}
	return &AppError{Code: "INTERNAL_ERROR", Message: message, StatusCode: http.StatusInternalServerError}
}

// ErrorHandlerMiddleware catches panics and returns proper error responses
// Matches Python's general_exception_handler
func ErrorHandlerMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if err := recover(); err != nil {
				// Log the panic with stack trace for debugging
				logger.L.Error("Panic recovered: " + fmt.Sprintf("%v\n%s", err, debug.Stack()))
				c.AbortWithStatusJSON(http.StatusInternalServerError, models.NewErrorResponse(
					"INTERNAL_ERROR",
					"An unexpected error occurred",
				))
			}
		}()
		c.Next()
	}
}

// HandleAppError writes an AppError to the response
func HandleAppError(c *gin.Context, err *AppError) {
	c.JSON(err.StatusCode, models.NewErrorResponse(err.Code, err.Message, err.Details))
}

// HandleError writes a generic error to the response
func HandleError(c *gin.Context, statusCode int, code, message string) {
	c.JSON(statusCode, models.NewErrorResponse(code, message))
}

package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestDeleteUserRequiresConfirmTextBeforeService(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "user_id", Value: "1"}}
	c.Request = httptest.NewRequest(
		http.MethodDelete,
		"/api/users/1?hard_delete=true",
		strings.NewReader(`{"confirm_text":"错误"}`),
	)
	c.Request.Header.Set("Content-Type", "application/json")

	DeleteUser(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d: %s", http.StatusBadRequest, w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "CONFIRM_TEXT_REQUIRED") {
		t.Fatalf("expected confirmation error, got %s", w.Body.String())
	}
}

func TestBatchDeleteRequiresConfirmTextBeforeService(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/users/batch-delete",
		strings.NewReader(`{"activity_level":"never","dry_run":false,"hard_delete":false}`),
	)
	c.Request.Header.Set("Content-Type", "application/json")

	BatchDeleteInactiveUsers(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d: %s", http.StatusBadRequest, w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "CONFIRM_TEXT_REQUIRED") {
		t.Fatalf("expected confirmation error, got %s", w.Body.String())
	}
}

func TestPurgeSoftDeletedRequiresConfirmTextBeforeService(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/users/soft-deleted/purge",
		strings.NewReader(`{"dry_run":false}`),
	)
	c.Request.Header.Set("Content-Type", "application/json")

	PurgeSoftDeletedUsers(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d: %s", http.StatusBadRequest, w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "CONFIRM_TEXT_REQUIRED") {
		t.Fatalf("expected confirmation error, got %s", w.Body.String())
	}
}

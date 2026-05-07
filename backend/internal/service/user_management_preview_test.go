package service

import "testing"

func TestUserPreviewNameUsesUsername(t *testing.T) {
	got := userPreviewName(map[string]interface{}{
		"id":       int64(42),
		"username": "alice",
	})
	if got != "alice" {
		t.Fatalf("expected username, got %q", got)
	}
}

func TestUserPreviewNameFallsBackToID(t *testing.T) {
	got := userPreviewName(map[string]interface{}{
		"id":       int64(42),
		"username": "",
	})
	if got != "用户#42" {
		t.Fatalf("expected ID fallback, got %q", got)
	}
}

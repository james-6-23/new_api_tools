package service

import (
	"strings"
	"testing"
)

func TestNormalizedCreatedAtExprSupportsSecondsAndMilliseconds(t *testing.T) {
	got := normalizedCreatedAtExpr("created_at")
	want := "(CASE WHEN created_at > 9999999999 THEN FLOOR(created_at / 1000) ELSE created_at END)"

	if got != want {
		t.Fatalf("normalizedCreatedAtExpr() = %q, want %q", got, want)
	}
}

func TestBuildAvailableModelsQueryUsesNormalizedTimeWindow(t *testing.T) {
	query := buildAvailableModelsQuery(normalizedCreatedAtExpr("created_at"))

	if !strings.Contains(query, "CASE WHEN created_at > 9999999999 THEN FLOOR(created_at / 1000) ELSE created_at END") {
		t.Fatalf("available models query should normalize created_at, got: %s", query)
	}
	if !strings.Contains(query, ">= ?") || !strings.Contains(query, "< ?") {
		t.Fatalf("available models query should use a bounded time window, got: %s", query)
	}
}

func TestBuildModelStatusSlotQueryFallsBackWithoutCompletionTokens(t *testing.T) {
	query := buildModelStatusSlotQuery(normalizedCreatedAtExpr("created_at"), 100, 60, false)

	if strings.Contains(query, "completion_tokens") {
		t.Fatalf("fallback slot query should not reference completion_tokens, got: %s", query)
	}
	if !strings.Contains(query, "SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as success") {
		t.Fatalf("fallback slot query should count type=2 as success, got: %s", query)
	}
	if !strings.Contains(query, "0 as empty_count") {
		t.Fatalf("fallback slot query should emit a zero empty-count column, got: %s", query)
	}
}

func TestBuildModelStatusSlotQueryUsesNormalizedTimestampExpression(t *testing.T) {
	query := buildModelStatusSlotQuery(normalizedCreatedAtExpr("created_at"), 100, 60, true)

	if !strings.Contains(query, "FLOOR(((CASE WHEN created_at > 9999999999 THEN FLOOR(created_at / 1000) ELSE created_at END) - 100) / 60)") {
		t.Fatalf("slot query should bucket by normalized timestamp, got: %s", query)
	}
	if !strings.Contains(query, "AND (CASE WHEN created_at > 9999999999 THEN FLOOR(created_at / 1000) ELSE created_at END) >= ?") {
		t.Fatalf("slot query should filter by normalized lower bound, got: %s", query)
	}
	if !strings.Contains(query, "AND (CASE WHEN created_at > 9999999999 THEN FLOOR(created_at / 1000) ELSE created_at END) < ?") {
		t.Fatalf("slot query should filter by normalized upper bound, got: %s", query)
	}
	if !strings.Contains(query, "as empty_count") {
		t.Fatalf("slot query should avoid MySQL reserved alias names, got: %s", query)
	}
}

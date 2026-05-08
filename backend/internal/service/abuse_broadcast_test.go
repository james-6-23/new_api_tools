package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/new-api-tools/backend/internal/config"
)

func TestAbuseBroadcastSyncOnceStoresHubReports(t *testing.T) {
	payload := hubReportPayload{
		ReportID:       "rpt_test",
		ReporterNodeID: "node_remote",
		Reason:         "credential_abuse",
		Severity:       "high",
		Status:         "published",
		Description:    "shared abuse signal",
		EvidenceSummary: map[string]interface{}{
			"source": "unit-test",
		},
		CreatedAt: 1710000000,
		UpdatedAt: 1710000001,
		Identities: []hubReportIdentity{
			{Type: "ip", Value: "203.0.113.7", Hash: "abc123", Confidence: 90},
		},
	}
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}

	hub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Node-ID") != "node_local" || r.Header.Get("X-Node-Secret") != "secret_local" {
			t.Fatalf("missing node credentials")
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/live/node/heartbeat" {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"success": true,
				"data": map[string]interface{}{
					"ok":      true,
					"node_id": "node_local",
					"name":    "node_local",
				},
			})
			return
		}
		if r.URL.Path != "/v1/live/reports" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"data": map[string]interface{}{
				"next_cursor": 7,
				"events": []map[string]interface{}{
					{
						"id":         7,
						"event_type": "published",
						"report_id":  "rpt_test",
						"payload":    string(rawPayload),
						"created_at": 1710000000,
					},
				},
			},
		})
	}))
	defer hub.Close()

	t.Setenv("SQL_DSN", "not-used")
	t.Setenv("DATA_DIR", t.TempDir())
	config.Load()

	svc := NewAbuseBroadcastService()
	enabled := true
	hubURL := hub.URL + "/v1/live"
	nodeID := "node_local"
	secret := "secret_local"
	if _, err := svc.UpdateSettings(context.Background(), AbuseBroadcastSettingsInput{
		Enabled: &enabled,
		HubURL:  &hubURL,
		NodeID:  &nodeID,
		Secret:  &secret,
	}); err != nil {
		t.Fatalf("UpdateSettings failed: %v", err)
	}
	connectResult, err := svc.Connect(context.Background())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	if !connectResult.OK || connectResult.NodeID != "node_local" {
		t.Fatalf("unexpected connect result: %+v", connectResult)
	}

	result, err := svc.SyncOnce(context.Background())
	if err != nil {
		t.Fatalf("SyncOnce failed: %v", err)
	}
	if result.PulledEvents != 1 || result.StoredReports != 1 || result.NextCursor != 7 {
		t.Fatalf("unexpected sync result: %+v", result)
	}

	reports, err := svc.ListReports(context.Background(), 20)
	if err != nil {
		t.Fatalf("ListReports failed: %v", err)
	}
	if len(reports) != 1 {
		t.Fatalf("expected 1 report, got %d", len(reports))
	}
	if reports[0].ReportID != "rpt_test" || reports[0].Severity != "high" {
		t.Fatalf("unexpected report: %+v", reports[0])
	}
	if len(reports[0].Identities) != 1 || reports[0].Identities[0].Hash != "abc123" || reports[0].Identities[0].Value != "203.0.113.7" {
		t.Fatalf("unexpected identities: %+v", reports[0].Identities)
	}
	unread, err := svc.UnreadCount(context.Background())
	if err != nil {
		t.Fatalf("UnreadCount failed: %v", err)
	}
	if unread.Unread != 1 {
		t.Fatalf("expected one unread report, got %d", unread.Unread)
	}
	if err := svc.MarkReportRead(context.Background(), "rpt_test"); err != nil {
		t.Fatalf("MarkReportRead failed: %v", err)
	}
	unread, err = svc.UnreadCount(context.Background())
	if err != nil {
		t.Fatalf("UnreadCount after read failed: %v", err)
	}
	if unread.Unread != 0 {
		t.Fatalf("expected unread count to be cleared, got %d", unread.Unread)
	}
}

func TestAbuseBroadcastMatchReportFindsLinuxDoAndIP(t *testing.T) {
	appDB := installSQLiteForTests(t)
	stmts := []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			username TEXT,
			display_name TEXT,
			status INTEGER,
			linux_do_id TEXT,
			deleted_at INTEGER
		)`,
		`CREATE TABLE logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER,
			created_at INTEGER,
			type INTEGER,
			ip TEXT
		)`,
	}
	for _, stmt := range stmts {
		if _, err := appDB.Exec(stmt); err != nil {
			t.Fatalf("create app schema: %v", err)
		}
	}
	now := time.Now().Unix()
	if _, err := appDB.Exec(`
		INSERT INTO users (id, username, display_name, status, linux_do_id, deleted_at)
		VALUES (1, 'alice', 'Alice', 1, 'linux-1', NULL), (2, 'bob', 'Bob', 1, '', NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := appDB.Exec(`
		INSERT INTO logs (user_id, created_at, type, ip)
		VALUES (1, ?, 2, '198.51.100.8'), (1, ?, 2, '198.51.100.8'), (2, ?, 2, '198.51.100.8')`,
		now, now-60, now-120); err != nil {
		t.Fatal(err)
	}

	t.Setenv("SQL_DSN", "not-used")
	t.Setenv("DATA_DIR", t.TempDir())
	config.Load()

	svc := NewAbuseBroadcastService()
	enabled := true
	hubURL := "http://hub.local/v1/live"
	nodeID := "node_local"
	secret := "secret_local"
	if _, err := svc.UpdateSettings(context.Background(), AbuseBroadcastSettingsInput{
		Enabled: &enabled,
		HubURL:  &hubURL,
		NodeID:  &nodeID,
		Secret:  &secret,
	}); err != nil {
		t.Fatalf("UpdateSettings failed: %v", err)
	}
	store, err := svc.openStore()
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	if err := ensureAbuseBroadcastTables(context.Background(), store); err != nil {
		t.Fatalf("ensure store: %v", err)
	}
	tx, err := store.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := upsertAbuseReport(context.Background(), tx, AbuseBroadcastReport{
		ReportID:       "rpt_match",
		ReporterNodeID: "node_remote",
		Reason:         "shared account",
		Severity:       "medium",
		Status:         "published",
		CreatedAt:      now,
		UpdatedAt:      now,
		SyncedAt:       now,
	}); err != nil {
		t.Fatal(err)
	}
	if err := replaceAbuseIdentities(context.Background(), tx, "rpt_match", []AbuseBroadcastIdentity{
		{Type: "linuxdo_id", Value: "linux-1", Confidence: 95},
		{Type: "ip", Value: "198.51.100.8", Confidence: 80},
	}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	matches, err := svc.MatchReport(context.Background(), "rpt_match")
	if err != nil {
		t.Fatalf("MatchReport failed: %v", err)
	}
	if len(matches.Users) != 2 {
		t.Fatalf("expected two matched users, got %+v", matches.Users)
	}
	first := matches.Users[0]
	if first.UserID != 1 || first.RequestCount != 2 || !containsString(first.MatchTypes, "linuxdo_id") || !containsString(first.MatchTypes, "ip") {
		t.Fatalf("unexpected primary match: %+v", first)
	}
}

func containsString(items []string, value string) bool {
	for _, item := range items {
		if item == value {
			return true
		}
	}
	return false
}

package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/new-api-tools/backend/internal/config"
	"github.com/new-api-tools/backend/internal/database"

	_ "modernc.org/sqlite"
)

const (
	defaultAbuseBroadcastLimit       = 200
	defaultAbuseReportMatchDays      = 30
	defaultAbuseReportMatchLimit     = 100
	defaultAbuseReportTopIPLimit     = 10
	defaultAbuseReportRecentLogLimit = 10
)

var ErrAbuseBroadcastNotConnected = errors.New("abuse broadcast hub is not connected")

type AbuseBroadcastService struct {
	cfg        *config.Config
	httpClient *http.Client
}

type AbuseBroadcastStatus struct {
	Enabled            bool   `json:"enabled"`
	Configured         bool   `json:"configured"`
	HubURL             string `json:"hub_url"`
	NodeID             string `json:"node_id"`
	HasSecret          bool   `json:"has_secret"`
	PullIntervalSecond int    `json:"pull_interval_seconds"`
	StorePath          string `json:"store_path"`
	Cursor             int64  `json:"cursor"`
	LastSyncAt         int64  `json:"last_sync_at"`
	LastError          string `json:"last_error,omitempty"`
	Reports            int64  `json:"reports"`
	Identities         int64  `json:"identities"`
	UnreadReports      int64  `json:"unread_reports"`
	OutgoingReports    int64  `json:"outgoing_reports"`
}

type AbuseBroadcastSettings struct {
	Enabled             bool   `json:"enabled"`
	HubURL              string `json:"hub_url"`
	NodeID              string `json:"node_id"`
	HasSecret           bool   `json:"has_secret"`
	PullIntervalSeconds int    `json:"pull_interval_seconds"`
	UpdatedAt           int64  `json:"updated_at"`
}

// AbuseBroadcastSettingsInput is the partial-update payload used by the settings API.
// nil pointer = field unchanged. For Secret, an empty string clears the stored value.
type AbuseBroadcastSettingsInput struct {
	Enabled             *bool   `json:"enabled,omitempty"`
	HubURL              *string `json:"hub_url,omitempty"`
	NodeID              *string `json:"node_id,omitempty"`
	Secret              *string `json:"secret,omitempty"`
	PullIntervalSeconds *int    `json:"pull_interval_seconds,omitempty"`
}

type AbuseBroadcastSyncResult struct {
	PulledEvents  int   `json:"pulled_events"`
	StoredReports int   `json:"stored_reports"`
	NextCursor    int64 `json:"next_cursor"`
	LastSyncAt    int64 `json:"last_sync_at"`
}

type AbuseBroadcastConnectResult struct {
	OK          bool   `json:"ok"`
	NodeID      string `json:"node_id"`
	Name        string `json:"name"`
	ConnectedAt int64  `json:"connected_at"`
}

type AbuseBroadcastReport struct {
	ReportID        string                   `json:"report_id"`
	ReporterNodeID  string                   `json:"reporter_node_id"`
	Reason          string                   `json:"reason"`
	Severity        string                   `json:"severity"`
	Status          string                   `json:"status"`
	Description     string                   `json:"description,omitempty"`
	EvidenceSummary string                   `json:"evidence_summary,omitempty"`
	Raw             string                   `json:"raw,omitempty"`
	CreatedAt       int64                    `json:"created_at"`
	UpdatedAt       int64                    `json:"updated_at"`
	SyncedAt        int64                    `json:"synced_at"`
	ReadAt          int64                    `json:"read_at"`
	MatchedAt       int64                    `json:"matched_at"`
	Identities      []AbuseBroadcastIdentity `json:"identities,omitempty"`
}

type AbuseBroadcastIdentity struct {
	Type       string `json:"type"`
	Value      string `json:"value,omitempty"`
	Hash       string `json:"hash"`
	Confidence int    `json:"confidence"`
}

type AbuseBroadcastReportUserRequest struct {
	UserID       int64  `json:"user_id"`
	Window       string `json:"window"`
	EndTime      *int64 `json:"end_time,omitempty"`
	ReasonPreset string `json:"reason_preset"`
	ReasonText   string `json:"reason_text"`
	Severity     string `json:"severity"`
}

type AbuseBroadcastReportUserResult struct {
	LocalReportID string `json:"local_report_id"`
	HubReportID   string `json:"hub_report_id"`
	Status        string `json:"status"`
	SubmittedAt   int64  `json:"submitted_at"`
}

type AbuseBroadcastOutgoingReport struct {
	LocalReportID string `json:"local_report_id"`
	HubReportID   string `json:"hub_report_id"`
	LocalUserID   int64  `json:"local_user_id"`
	Username      string `json:"username"`
	DisplayName   string `json:"display_name,omitempty"`
	Reason        string `json:"reason"`
	Severity      string `json:"severity"`
	Status        string `json:"status"`
	LastError     string `json:"last_error,omitempty"`
	CreatedAt     int64  `json:"created_at"`
	SubmittedAt   int64  `json:"submitted_at"`
	UpdatedAt     int64  `json:"updated_at"`
}

type AbuseBroadcastUnreadCount struct {
	Unread int64 `json:"unread"`
}

type AbuseBroadcastMatchResult struct {
	ReportID   string                      `json:"report_id"`
	MatchedAt  int64                       `json:"matched_at"`
	Users      []AbuseBroadcastMatchedUser `json:"users"`
	Identities []AbuseBroadcastIdentity    `json:"identities"`
}

type AbuseBroadcastMatchedUser struct {
	UserID       int64    `json:"user_id"`
	Username     string   `json:"username"`
	DisplayName  string   `json:"display_name,omitempty"`
	Status       int64    `json:"status"`
	LinuxDoID    string   `json:"linux_do_id,omitempty"`
	MatchTypes   []string `json:"match_types"`
	MatchedIPs   []string `json:"matched_ips,omitempty"`
	RequestCount int64    `json:"request_count"`
	FirstSeen    int64    `json:"first_seen"`
	LastSeen     int64    `json:"last_seen"`
}

type abuseSyncState struct {
	Cursor     int64
	LastSyncAt int64
	LastError  string
}

type abuseSettings struct {
	Enabled             bool
	HubURL              string
	NodeID              string
	Secret              string
	PullIntervalSeconds int
	UpdatedAt           int64
}

func (s abuseSettings) configured() bool {
	return s.HubURL != "" && s.NodeID != "" && s.Secret != ""
}

func (s abuseSettings) interval() int {
	if s.PullIntervalSeconds <= 0 {
		return 300
	}
	return s.PullIntervalSeconds
}

type hubEnvelope struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Error   json.RawMessage `json:"error"`
}

type hubPullResponse struct {
	NextCursor int64      `json:"next_cursor"`
	Events     []hubEvent `json:"events"`
}

type hubEvent struct {
	ID        int64  `json:"id"`
	EventType string `json:"event_type"`
	ReportID  string `json:"report_id"`
	Payload   string `json:"payload"`
	CreatedAt int64  `json:"created_at"`
}

type hubReportPayload struct {
	ReportID        string              `json:"report_id"`
	ReporterNodeID  string              `json:"reporter_node_id"`
	Reason          string              `json:"reason"`
	Severity        string              `json:"severity"`
	Status          string              `json:"status"`
	Description     string              `json:"description"`
	EvidenceSummary interface{}         `json:"evidence_summary"`
	CreatedAt       int64               `json:"created_at"`
	UpdatedAt       int64               `json:"updated_at"`
	Identities      []hubReportIdentity `json:"identities"`
}

type hubReportIdentity struct {
	Type       string `json:"type"`
	Value      string `json:"value"`
	Hash       string `json:"hash"`
	Confidence int    `json:"confidence"`
}

type hubCreateReportRequest struct {
	Reason          string                 `json:"reason"`
	Severity        string                 `json:"severity"`
	Description     string                 `json:"description"`
	EvidenceSummary map[string]interface{} `json:"evidence_summary"`
	Identities      []hubReportIdentity    `json:"identities"`
}

func NewAbuseBroadcastService() *AbuseBroadcastService {
	return &AbuseBroadcastService{
		cfg: config.Get(),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (s *AbuseBroadcastService) Status(ctx context.Context) (AbuseBroadcastStatus, error) {
	status := AbuseBroadcastStatus{
		StorePath: s.storePath(),
	}

	db, err := s.openStore()
	if err != nil {
		return status, err
	}
	defer db.Close()
	if err := ensureAbuseBroadcastTables(ctx, db); err != nil {
		return status, err
	}
	settings, err := loadAbuseSettings(ctx, db)
	if err != nil {
		return status, err
	}
	status.Enabled = settings.Enabled
	status.Configured = settings.configured()
	status.HubURL = settings.HubURL
	status.NodeID = settings.NodeID
	status.HasSecret = settings.Secret != ""
	status.PullIntervalSecond = settings.interval()

	state, err := getAbuseSyncState(ctx, db, settings.HubURL)
	if err != nil {
		return status, err
	}
	status.Cursor = state.Cursor
	status.LastSyncAt = state.LastSyncAt
	status.LastError = state.LastError
	status.Reports = countAbuseRows(ctx, db, "abuse_broadcast_reports")
	status.Identities = countAbuseRows(ctx, db, "abuse_broadcast_identities")
	status.UnreadReports = countUnreadAbuseReports(ctx, db)
	status.OutgoingReports = countAbuseRows(ctx, db, "abuse_broadcast_outgoing_reports")
	return status, nil
}

// GetSettings returns current Hub access settings (without exposing the secret value).
func (s *AbuseBroadcastService) GetSettings(ctx context.Context) (AbuseBroadcastSettings, error) {
	var view AbuseBroadcastSettings
	db, err := s.openStore()
	if err != nil {
		return view, err
	}
	defer db.Close()
	if err := ensureAbuseBroadcastTables(ctx, db); err != nil {
		return view, err
	}
	settings, err := loadAbuseSettings(ctx, db)
	if err != nil {
		return view, err
	}
	view.Enabled = settings.Enabled
	view.HubURL = settings.HubURL
	view.NodeID = settings.NodeID
	view.HasSecret = settings.Secret != ""
	view.PullIntervalSeconds = settings.interval()
	view.UpdatedAt = settings.UpdatedAt
	return view, nil
}

// UpdateSettings applies a partial settings update. Fields with nil pointers are unchanged.
// For Secret: nil = unchanged, empty string = clear, non-empty = replace.
func (s *AbuseBroadcastService) UpdateSettings(ctx context.Context, input AbuseBroadcastSettingsInput) (AbuseBroadcastSettings, error) {
	db, err := s.openStore()
	if err != nil {
		return AbuseBroadcastSettings{}, err
	}
	defer db.Close()
	if err := ensureAbuseBroadcastTables(ctx, db); err != nil {
		return AbuseBroadcastSettings{}, err
	}
	settings, err := loadAbuseSettings(ctx, db)
	if err != nil {
		return AbuseBroadcastSettings{}, err
	}
	if input.Enabled != nil {
		settings.Enabled = *input.Enabled
	}
	if input.HubURL != nil {
		settings.HubURL = strings.TrimRight(strings.TrimSpace(*input.HubURL), "/")
	}
	if input.NodeID != nil {
		settings.NodeID = strings.TrimSpace(*input.NodeID)
	}
	if input.Secret != nil {
		settings.Secret = *input.Secret
	}
	if input.PullIntervalSeconds != nil {
		val := *input.PullIntervalSeconds
		if val <= 0 {
			val = 300
		}
		settings.PullIntervalSeconds = val
	}
	if settings.Enabled && !settings.configured() {
		return AbuseBroadcastSettings{}, fmt.Errorf("Hub URL、节点名称和密钥都填写后才能开启拉取")
	}
	if err := saveAbuseSettings(ctx, db, settings); err != nil {
		return AbuseBroadcastSettings{}, err
	}
	return s.GetSettings(ctx)
}

func (s *AbuseBroadcastService) SyncOnce(ctx context.Context) (AbuseBroadcastSyncResult, error) {
	settings, loadErr := s.loadSettingsAdHoc(ctx)
	if loadErr != nil {
		return AbuseBroadcastSyncResult{}, loadErr
	}
	result, err := s.syncOnce(ctx, settings)
	if err != nil && settings.HubURL != "" {
		recordCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = s.recordSyncError(recordCtx, settings.HubURL, err.Error())
	}
	return result, err
}

func (s *AbuseBroadcastService) Connect(ctx context.Context) (AbuseBroadcastConnectResult, error) {
	settings, err := s.loadSettingsAdHoc(ctx)
	if err != nil {
		return AbuseBroadcastConnectResult{}, err
	}
	return s.connect(ctx, settings)
}

func (s *AbuseBroadcastService) connect(ctx context.Context, settings abuseSettings) (AbuseBroadcastConnectResult, error) {
	var result AbuseBroadcastConnectResult
	if !settings.configured() {
		return result, fmt.Errorf("Hub URL、节点名称和密钥未配置")
	}

	endpoint := hubEndpointFor(settings.HubURL, "node/heartbeat")
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return result, fmt.Errorf("invalid hub url: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, parsed.String(), nil)
	if err != nil {
		return result, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Node-ID", settings.NodeID)
	req.Header.Set("X-Node-Secret", settings.Secret)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return result, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return result, err
	}
	var envelope hubEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return result, fmt.Errorf("hub returned invalid JSON: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !envelope.Success {
		msg := hubErrorMessage(envelope.Error)
		if msg == "" {
			msg = resp.Status
		}
		return result, fmt.Errorf("hub connect failed: %s", msg)
	}
	if err := json.Unmarshal(envelope.Data, &result); err != nil {
		return result, fmt.Errorf("hub returned invalid connect data: %w", err)
	}
	result.ConnectedAt = time.Now().Unix()
	return result, nil
}

func (s *AbuseBroadcastService) syncOnce(ctx context.Context, settings abuseSettings) (AbuseBroadcastSyncResult, error) {
	var result AbuseBroadcastSyncResult
	if !settings.Enabled {
		return result, fmt.Errorf("abuse broadcast is disabled")
	}
	if !settings.configured() {
		return result, fmt.Errorf("Hub URL、节点名称和密钥未配置")
	}

	db, err := s.openStore()
	if err != nil {
		return result, err
	}
	defer db.Close()
	if err := ensureAbuseBroadcastTables(ctx, db); err != nil {
		return result, err
	}

	state, err := getAbuseSyncState(ctx, db, settings.HubURL)
	if err != nil {
		return result, err
	}
	pull, err := s.fetchEvents(ctx, settings, state.Cursor)
	if err != nil {
		return result, err
	}

	now := time.Now().Unix()
	result.PulledEvents = len(pull.Events)
	result.NextCursor = pull.NextCursor
	result.LastSyncAt = now

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()

	for _, event := range pull.Events {
		report, identities, err := reportFromEvent(event)
		if err != nil {
			return result, err
		}
		if report.ReportID == "" {
			continue
		}
		if report.ReporterNodeID != "" && report.ReporterNodeID == settings.NodeID {
			continue
		}
		report.SyncedAt = now
		if err := upsertAbuseReport(ctx, tx, report); err != nil {
			return result, err
		}
		if err := replaceAbuseIdentities(ctx, tx, report.ReportID, identities); err != nil {
			return result, err
		}
		result.StoredReports++
	}

	if result.NextCursor < state.Cursor {
		result.NextCursor = state.Cursor
	}
	if err := upsertAbuseSyncState(ctx, tx, settings.HubURL, result.NextCursor, now, ""); err != nil {
		return result, err
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	return result, nil
}

func (s *AbuseBroadcastService) ListReports(ctx context.Context, limit int) ([]AbuseBroadcastReport, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	db, err := s.openStore()
	if err != nil {
		return nil, err
	}
	defer db.Close()
	if err := ensureAbuseBroadcastTables(ctx, db); err != nil {
		return nil, err
	}

	rows, err := db.QueryContext(ctx, `
		SELECT report_id, reporter_node_id, reason, severity, status, description, evidence_summary, raw, created_at, updated_at, synced_at, read_at, matched_at
		FROM abuse_broadcast_reports
		ORDER BY synced_at DESC, created_at DESC
		LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	reports := make([]AbuseBroadcastReport, 0)
	for rows.Next() {
		var report AbuseBroadcastReport
		if err := rows.Scan(
			&report.ReportID,
			&report.ReporterNodeID,
			&report.Reason,
			&report.Severity,
			&report.Status,
			&report.Description,
			&report.EvidenceSummary,
			&report.Raw,
			&report.CreatedAt,
			&report.UpdatedAt,
			&report.SyncedAt,
			&report.ReadAt,
			&report.MatchedAt,
		); err != nil {
			return nil, err
		}
		reports = append(reports, report)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for i := range reports {
		identities, err := listAbuseIdentities(ctx, db, reports[i].ReportID)
		if err != nil {
			return nil, err
		}
		reports[i].Identities = identities
	}
	return reports, nil
}

func (s *AbuseBroadcastService) ReportUser(ctx context.Context, req AbuseBroadcastReportUserRequest) (AbuseBroadcastReportUserResult, error) {
	var result AbuseBroadcastReportUserResult
	settings, err := s.loadSettingsAdHoc(ctx)
	if err != nil {
		return result, err
	}
	if !settings.Enabled || !settings.configured() {
		return result, fmt.Errorf("%w: 请先在前端开启并填写 Hub 接入信息", ErrAbuseBroadcastNotConnected)
	}
	if req.UserID <= 0 {
		return result, fmt.Errorf("user_id is required")
	}
	window := strings.TrimSpace(req.Window)
	if window == "" {
		window = "24h"
	}
	windowSeconds, ok := WindowSeconds[window]
	if !ok {
		windowSeconds = WindowSeconds["24h"]
		window = "24h"
	}
	severity := strings.TrimSpace(req.Severity)
	if severity == "" {
		severity = "medium"
	}
	reasonPreset := strings.TrimSpace(req.ReasonPreset)
	reasonText := strings.TrimSpace(req.ReasonText)
	reason := reasonPreset
	if reason == "" {
		reason = reasonText
	}
	if reason == "" {
		return result, fmt.Errorf("report reason is required")
	}

	analysis, err := NewRiskMonitoringService().GetUserAnalysis(req.UserID, windowSeconds, req.EndTime)
	if err != nil {
		return result, err
	}
	identities := buildHubReportIdentities(analysis)
	if len(identities) == 0 {
		return result, fmt.Errorf("no linuxdo id or ip found for this user")
	}
	evidence := buildAbuseEvidenceSummary(analysis, window)
	createReq := hubCreateReportRequest{
		Reason:          reason,
		Severity:        severity,
		Description:     reasonText,
		EvidenceSummary: evidence,
		Identities:      identities,
	}
	requestJSON, _ := json.Marshal(createReq)

	user := mapFromInterface(analysis["user"])
	now := time.Now().Unix()
	localReportID := "local_" + randomAbuseHex(10)
	result.LocalReportID = localReportID
	result.Status = "pending"

	db, err := s.openStore()
	if err != nil {
		return result, err
	}
	defer db.Close()
	if err := ensureAbuseBroadcastTables(ctx, db); err != nil {
		return result, err
	}
	if err := insertOutgoingReport(ctx, db, AbuseBroadcastOutgoingReport{
		LocalReportID: localReportID,
		LocalUserID:   req.UserID,
		Username:      toString(user["username"]),
		DisplayName:   toString(user["display_name"]),
		Reason:        reason,
		Severity:      severity,
		Status:        "pending",
		CreatedAt:     now,
		UpdatedAt:     now,
	}, string(requestJSON)); err != nil {
		return result, err
	}

	if _, err := s.connect(ctx, settings); err != nil {
		_ = updateOutgoingReport(ctx, db, localReportID, "", "failed", "", err.Error(), 0)
		return result, fmt.Errorf("%w: %v", ErrAbuseBroadcastNotConnected, err)
	}

	hubReport, responseJSON, err := s.submitReport(ctx, settings, createReq)
	if err != nil {
		_ = updateOutgoingReport(ctx, db, localReportID, "", "failed", responseJSON, err.Error(), 0)
		return result, err
	}
	submittedAt := time.Now().Unix()
	if err := updateOutgoingReport(ctx, db, localReportID, hubReport.ReportID, "submitted", responseJSON, "", submittedAt); err != nil {
		return result, err
	}
	result.HubReportID = hubReport.ReportID
	result.Status = "submitted"
	result.SubmittedAt = submittedAt
	return result, nil
}

func (s *AbuseBroadcastService) ListOutgoingReports(ctx context.Context, limit int) ([]AbuseBroadcastOutgoingReport, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	db, err := s.openStore()
	if err != nil {
		return nil, err
	}
	defer db.Close()
	if err := ensureAbuseBroadcastTables(ctx, db); err != nil {
		return nil, err
	}

	rows, err := db.QueryContext(ctx, `
		SELECT local_report_id, hub_report_id, local_user_id, username, display_name, reason, severity, status, last_error, created_at, submitted_at, updated_at
		FROM abuse_broadcast_outgoing_reports
		ORDER BY created_at DESC
		LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]AbuseBroadcastOutgoingReport, 0)
	for rows.Next() {
		var item AbuseBroadcastOutgoingReport
		if err := rows.Scan(&item.LocalReportID, &item.HubReportID, &item.LocalUserID, &item.Username, &item.DisplayName, &item.Reason, &item.Severity, &item.Status, &item.LastError, &item.CreatedAt, &item.SubmittedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *AbuseBroadcastService) UnreadCount(ctx context.Context) (AbuseBroadcastUnreadCount, error) {
	db, err := s.openStore()
	if err != nil {
		return AbuseBroadcastUnreadCount{}, err
	}
	defer db.Close()
	if err := ensureAbuseBroadcastTables(ctx, db); err != nil {
		return AbuseBroadcastUnreadCount{}, err
	}
	return AbuseBroadcastUnreadCount{Unread: countUnreadAbuseReports(ctx, db)}, nil
}

func (s *AbuseBroadcastService) MarkReportRead(ctx context.Context, reportID string) error {
	db, err := s.openStore()
	if err != nil {
		return err
	}
	defer db.Close()
	if err := ensureAbuseBroadcastTables(ctx, db); err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `
		UPDATE abuse_broadcast_reports
		SET read_at = CASE WHEN read_at = 0 THEN ? ELSE read_at END
		WHERE report_id = ?`, time.Now().Unix(), strings.TrimSpace(reportID))
	return err
}

func (s *AbuseBroadcastService) MatchReport(ctx context.Context, reportID string) (AbuseBroadcastMatchResult, error) {
	reportID = strings.TrimSpace(reportID)
	if reportID == "" {
		return AbuseBroadcastMatchResult{}, fmt.Errorf("report id is required")
	}
	db, err := s.openStore()
	if err != nil {
		return AbuseBroadcastMatchResult{}, err
	}
	defer db.Close()
	if err := ensureAbuseBroadcastTables(ctx, db); err != nil {
		return AbuseBroadcastMatchResult{}, err
	}
	var exists int64
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM abuse_broadcast_reports WHERE report_id = ?`, reportID).Scan(&exists); err != nil {
		return AbuseBroadcastMatchResult{}, err
	}
	if exists == 0 {
		return AbuseBroadcastMatchResult{}, fmt.Errorf("report not found")
	}
	identities, err := listAbuseIdentities(ctx, db, reportID)
	if err != nil {
		return AbuseBroadcastMatchResult{}, err
	}
	users, err := s.matchLocalUsers(ctx, identities, defaultAbuseReportMatchDays, defaultAbuseReportMatchLimit)
	if err != nil {
		return AbuseBroadcastMatchResult{}, err
	}
	matchedAt := time.Now().Unix()
	if _, err := db.ExecContext(ctx, `UPDATE abuse_broadcast_reports SET matched_at = ? WHERE report_id = ?`, matchedAt, reportID); err != nil {
		return AbuseBroadcastMatchResult{}, err
	}
	return AbuseBroadcastMatchResult{
		ReportID:   reportID,
		MatchedAt:  matchedAt,
		Users:      users,
		Identities: identities,
	}, nil
}

func (s *AbuseBroadcastService) submitReport(ctx context.Context, settings abuseSettings, req hubCreateReportRequest) (hubReportPayload, string, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return hubReportPayload{}, "", err
	}
	endpoint := hubEndpointFor(settings.HubURL, "reports")
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return hubReportPayload{}, "", fmt.Errorf("invalid hub url: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, parsed.String(), strings.NewReader(string(body)))
	if err != nil {
		return hubReportPayload{}, "", err
	}
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-Node-ID", settings.NodeID)
	httpReq.Header.Set("X-Node-Secret", settings.Secret)

	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return hubReportPayload{}, "", err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return hubReportPayload{}, "", err
	}
	responseJSON := string(raw)
	var envelope hubEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return hubReportPayload{}, responseJSON, fmt.Errorf("hub returned invalid JSON: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !envelope.Success {
		msg := hubErrorMessage(envelope.Error)
		if msg == "" {
			msg = resp.Status
		}
		return hubReportPayload{}, responseJSON, fmt.Errorf("hub report failed: %s", msg)
	}
	var report hubReportPayload
	if err := json.Unmarshal(envelope.Data, &report); err != nil {
		return hubReportPayload{}, responseJSON, fmt.Errorf("hub returned invalid report data: %w", err)
	}
	return report, responseJSON, nil
}

func (s *AbuseBroadcastService) matchLocalUsers(ctx context.Context, identities []AbuseBroadcastIdentity, days int, limit int) ([]AbuseBroadcastMatchedUser, error) {
	_ = ctx
	appDB := database.Get()
	if limit <= 0 {
		limit = defaultAbuseReportMatchLimit
	}
	linuxDoIDs := make([]string, 0)
	ips := make([]string, 0)
	seenLinuxDo := map[string]struct{}{}
	seenIP := map[string]struct{}{}
	for _, identity := range identities {
		value := strings.TrimSpace(identity.Value)
		if value == "" {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(identity.Type)) {
		case "linuxdo_id", "linux_do_id":
			key := strings.ToLower(value)
			if _, ok := seenLinuxDo[key]; ok {
				continue
			}
			seenLinuxDo[key] = struct{}{}
			linuxDoIDs = append(linuxDoIDs, value)
		case "ip":
			if _, ok := seenIP[value]; ok {
				continue
			}
			seenIP[value] = struct{}{}
			ips = append(ips, value)
		}
	}

	matched := map[int64]*AbuseBroadcastMatchedUser{}
	if len(linuxDoIDs) > 0 {
		query := fmt.Sprintf(`
			SELECT id, COALESCE(username, '') AS username, COALESCE(display_name, '') AS display_name,
				COALESCE(status, 0) AS status, COALESCE(linux_do_id, '') AS linux_do_id
			FROM users
			WHERE deleted_at IS NULL AND linux_do_id IN (%s)
			LIMIT ?`, placeholders(len(linuxDoIDs)))
		args := make([]interface{}, 0, len(linuxDoIDs)+1)
		for _, value := range linuxDoIDs {
			args = append(args, value)
		}
		args = append(args, limit)
		rows, err := appDB.QueryWithTimeout(30*time.Second, appDB.RebindQuery(query), args...)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			userID := toInt64(row["id"])
			if userID == 0 {
				continue
			}
			user := upsertMatchedUser(matched, userID)
			user.Username = toString(row["username"])
			user.DisplayName = toString(row["display_name"])
			user.Status = toInt64(row["status"])
			user.LinuxDoID = toString(row["linux_do_id"])
			user.MatchTypes = appendUniqueString(user.MatchTypes, "linuxdo_id")
		}
	}

	if len(ips) > 0 {
		if len(ips) > 50 {
			ips = ips[:50]
		}
		startTime := time.Now().AddDate(0, 0, -days).Unix()
		ipAgg := "GROUP_CONCAT(DISTINCT l.ip)"
		if appDB.IsPG {
			ipAgg = "STRING_AGG(DISTINCT l.ip, ',')"
		}
		query := fmt.Sprintf(`
			SELECT l.user_id AS user_id,
				COALESCE(MAX(u.username), '') AS username,
				COALESCE(MAX(u.display_name), '') AS display_name,
				COALESCE(MAX(u.status), 0) AS status,
				COALESCE(MAX(u.linux_do_id), '') AS linux_do_id,
				COUNT(*) AS request_count,
				MIN(l.created_at) AS first_seen,
				MAX(l.created_at) AS last_seen,
				%s AS matched_ips
			FROM logs l
			LEFT JOIN users u ON u.id = l.user_id AND u.deleted_at IS NULL
			WHERE l.created_at >= ? AND l.ip IN (%s) AND l.user_id IS NOT NULL
			GROUP BY l.user_id
			ORDER BY request_count DESC
			LIMIT ?`, ipAgg, placeholders(len(ips)))
		args := make([]interface{}, 0, len(ips)+2)
		args = append(args, startTime)
		for _, value := range ips {
			args = append(args, value)
		}
		args = append(args, limit)
		rows, err := appDB.QueryWithTimeout(30*time.Second, appDB.RebindQuery(query), args...)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			userID := toInt64(row["user_id"])
			if userID == 0 {
				continue
			}
			user := upsertMatchedUser(matched, userID)
			if user.Username == "" {
				user.Username = toString(row["username"])
			}
			if user.DisplayName == "" {
				user.DisplayName = toString(row["display_name"])
			}
			if user.Status == 0 {
				user.Status = toInt64(row["status"])
			}
			if user.LinuxDoID == "" {
				user.LinuxDoID = toString(row["linux_do_id"])
			}
			user.MatchTypes = appendUniqueString(user.MatchTypes, "ip")
			user.RequestCount += toInt64(row["request_count"])
			firstSeen := toInt64(row["first_seen"])
			lastSeen := toInt64(row["last_seen"])
			if user.FirstSeen == 0 || (firstSeen > 0 && firstSeen < user.FirstSeen) {
				user.FirstSeen = firstSeen
			}
			if lastSeen > user.LastSeen {
				user.LastSeen = lastSeen
			}
			for _, ip := range splitCSV(toString(row["matched_ips"])) {
				user.MatchedIPs = appendUniqueString(user.MatchedIPs, ip)
			}
		}
	}

	users := make([]AbuseBroadcastMatchedUser, 0, len(matched))
	for _, user := range matched {
		sort.Strings(user.MatchTypes)
		sort.Strings(user.MatchedIPs)
		users = append(users, *user)
	}
	sort.Slice(users, func(i, j int) bool {
		if users[i].RequestCount == users[j].RequestCount {
			return users[i].UserID < users[j].UserID
		}
		return users[i].RequestCount > users[j].RequestCount
	})
	if len(users) > limit {
		users = users[:limit]
	}
	return users, nil
}

func (s *AbuseBroadcastService) fetchEvents(ctx context.Context, settings abuseSettings, cursor int64) (hubPullResponse, error) {
	endpoint := fmt.Sprintf("%s?cursor=%d&limit=%d", hubEndpointFor(settings.HubURL, "reports"), cursor, defaultAbuseBroadcastLimit)
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return hubPullResponse{}, fmt.Errorf("invalid hub url: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return hubPullResponse{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Node-ID", settings.NodeID)
	req.Header.Set("X-Node-Secret", settings.Secret)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return hubPullResponse{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return hubPullResponse{}, err
	}
	var envelope hubEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return hubPullResponse{}, fmt.Errorf("hub returned invalid JSON: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !envelope.Success {
		msg := hubErrorMessage(envelope.Error)
		if msg == "" {
			msg = resp.Status
		}
		return hubPullResponse{}, fmt.Errorf("hub sync failed: %s", msg)
	}
	var data hubPullResponse
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		return hubPullResponse{}, fmt.Errorf("hub returned invalid pull data: %w", err)
	}
	return data, nil
}

func (s *AbuseBroadcastService) openStore() (*sql.DB, error) {
	path := s.storePath()
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0750); err != nil {
			return nil, err
		}
	}
	db, err := sql.Open("sqlite", sqliteDSN(path))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db, nil
}

func (s *AbuseBroadcastService) storePath() string {
	dataDir := strings.TrimSpace(s.cfg.DataDir)
	if dataDir == "" {
		dataDir = "./data"
	}
	return filepath.Join(dataDir, "abuse-broadcast.db")
}

func (s *AbuseBroadcastService) loadSettingsAdHoc(ctx context.Context) (abuseSettings, error) {
	db, err := s.openStore()
	if err != nil {
		return abuseSettings{}, err
	}
	defer db.Close()
	if err := ensureAbuseBroadcastTables(ctx, db); err != nil {
		return abuseSettings{}, err
	}
	return loadAbuseSettings(ctx, db)
}

func hubEndpointFor(hubURL, path string) string {
	base := strings.TrimRight(hubURL, "/")
	path = strings.TrimLeft(path, "/")
	if strings.HasSuffix(base, "/v1/live") || strings.HasSuffix(base, "/v1") {
		return base + "/" + path
	}
	return base + "/v1/" + path
}

func (s *AbuseBroadcastService) recordSyncError(ctx context.Context, hubURL, message string) error {
	db, err := s.openStore()
	if err != nil {
		return err
	}
	defer db.Close()
	if err := ensureAbuseBroadcastTables(ctx, db); err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO abuse_broadcast_sync_state (hub_url, cursor, last_sync_at, last_error, updated_at)
		VALUES (?, 0, 0, ?, ?)
		ON CONFLICT(hub_url) DO UPDATE SET last_error = excluded.last_error, updated_at = excluded.updated_at`,
		hubURL, message, time.Now().Unix())
	return err
}

func ensureAbuseBroadcastTables(ctx context.Context, db *sql.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS abuse_broadcast_sync_state (
			hub_url TEXT PRIMARY KEY,
			cursor INTEGER NOT NULL DEFAULT 0,
			last_sync_at INTEGER NOT NULL DEFAULT 0,
			last_error TEXT NOT NULL DEFAULT '',
			updated_at INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS abuse_broadcast_reports (
			report_id TEXT PRIMARY KEY,
			reporter_node_id TEXT NOT NULL DEFAULT '',
			reason TEXT NOT NULL DEFAULT '',
			severity TEXT NOT NULL DEFAULT 'medium',
			status TEXT NOT NULL DEFAULT 'published',
			description TEXT NOT NULL DEFAULT '',
			evidence_summary TEXT NOT NULL DEFAULT '',
			raw TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL DEFAULT 0,
			synced_at INTEGER NOT NULL DEFAULT 0,
			read_at INTEGER NOT NULL DEFAULT 0,
			matched_at INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS abuse_broadcast_identities (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			report_id TEXT NOT NULL,
			identity_type TEXT NOT NULL,
			identity_value TEXT NOT NULL DEFAULT '',
			identity_hash TEXT NOT NULL,
			confidence INTEGER NOT NULL DEFAULT 50,
			created_at INTEGER NOT NULL DEFAULT 0,
			UNIQUE(report_id, identity_type, identity_hash)
		)`,
		`CREATE TABLE IF NOT EXISTS abuse_broadcast_outgoing_reports (
			local_report_id TEXT PRIMARY KEY,
			hub_report_id TEXT NOT NULL DEFAULT '',
			local_user_id INTEGER NOT NULL DEFAULT 0,
			username TEXT NOT NULL DEFAULT '',
			display_name TEXT NOT NULL DEFAULT '',
			reason TEXT NOT NULL DEFAULT '',
			severity TEXT NOT NULL DEFAULT 'medium',
			status TEXT NOT NULL DEFAULT 'pending',
			request_json TEXT NOT NULL DEFAULT '',
			response_json TEXT NOT NULL DEFAULT '',
			last_error TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL DEFAULT 0,
			submitted_at INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_abuse_broadcast_reports_synced_at ON abuse_broadcast_reports (synced_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_abuse_broadcast_reports_read_at ON abuse_broadcast_reports (read_at)`,
		`CREATE INDEX IF NOT EXISTS idx_abuse_broadcast_identity_hash ON abuse_broadcast_identities (identity_type, identity_hash)`,
		`CREATE INDEX IF NOT EXISTS idx_abuse_broadcast_identity_report ON abuse_broadcast_identities (report_id)`,
		`CREATE INDEX IF NOT EXISTS idx_abuse_broadcast_outgoing_created ON abuse_broadcast_outgoing_reports (created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS abuse_broadcast_settings (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			enabled INTEGER NOT NULL DEFAULT 0,
			hub_url TEXT NOT NULL DEFAULT '',
			node_id TEXT NOT NULL DEFAULT '',
			secret TEXT NOT NULL DEFAULT '',
			pull_interval_seconds INTEGER NOT NULL DEFAULT 300,
			updated_at INTEGER NOT NULL DEFAULT 0
		)`,
	}
	for _, stmt := range statements {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	if err := ensureSQLiteColumn(ctx, db, "abuse_broadcast_reports", "read_at", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := ensureSQLiteColumn(ctx, db, "abuse_broadcast_reports", "matched_at", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := ensureSQLiteColumn(ctx, db, "abuse_broadcast_identities", "identity_value", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return nil
}

func ensureSQLiteColumn(ctx context.Context, db *sql.DB, tableName, columnName, definition string) error {
	rows, err := db.QueryContext(ctx, fmt.Sprintf("PRAGMA table_info(%s)", tableName))
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			name       string
			columnType string
			notNull    int
			defaultVal interface{}
			pk         int
		)
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultVal, &pk); err != nil {
			return err
		}
		if name == columnName {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", tableName, columnName, definition))
	return err
}

func getAbuseSyncState(ctx context.Context, db *sql.DB, hubURL string) (abuseSyncState, error) {
	var state abuseSyncState
	var lastError string
	err := db.QueryRowContext(ctx, `
		SELECT cursor, last_sync_at, last_error
		FROM abuse_broadcast_sync_state
		WHERE hub_url = ?`, hubURL).Scan(&state.Cursor, &state.LastSyncAt, &lastError)
	if err == sql.ErrNoRows {
		return state, nil
	}
	if err != nil {
		return state, err
	}
	state.LastError = lastError
	return state, nil
}

func insertOutgoingReport(ctx context.Context, db *sql.DB, report AbuseBroadcastOutgoingReport, requestJSON string) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO abuse_broadcast_outgoing_reports (
			local_report_id, hub_report_id, local_user_id, username, display_name, reason, severity, status,
			request_json, response_json, last_error, created_at, submitted_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, 0, ?)`,
		report.LocalReportID,
		report.HubReportID,
		report.LocalUserID,
		report.Username,
		report.DisplayName,
		report.Reason,
		report.Severity,
		report.Status,
		requestJSON,
		report.CreatedAt,
		report.UpdatedAt,
	)
	return err
}

func updateOutgoingReport(ctx context.Context, db *sql.DB, localReportID, hubReportID, status, responseJSON, lastError string, submittedAt int64) error {
	_, err := db.ExecContext(ctx, `
		UPDATE abuse_broadcast_outgoing_reports
		SET hub_report_id = ?, status = ?, response_json = ?, last_error = ?, submitted_at = ?, updated_at = ?
		WHERE local_report_id = ?`,
		hubReportID, status, responseJSON, lastError, submittedAt, time.Now().Unix(), localReportID)
	return err
}

func upsertAbuseSyncState(ctx context.Context, tx *sql.Tx, hubURL string, cursor int64, lastSyncAt int64, lastError string) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO abuse_broadcast_sync_state (hub_url, cursor, last_sync_at, last_error, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(hub_url) DO UPDATE SET
			cursor = excluded.cursor,
			last_sync_at = excluded.last_sync_at,
			last_error = excluded.last_error,
			updated_at = excluded.updated_at`,
		hubURL, cursor, lastSyncAt, lastError, time.Now().Unix())
	return err
}

func upsertAbuseReport(ctx context.Context, tx *sql.Tx, report AbuseBroadcastReport) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO abuse_broadcast_reports (
			report_id, reporter_node_id, reason, severity, status, description, evidence_summary, raw, created_at, updated_at, synced_at, read_at, matched_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(report_id) DO UPDATE SET
			reporter_node_id = excluded.reporter_node_id,
			reason = excluded.reason,
			severity = excluded.severity,
			status = excluded.status,
			description = excluded.description,
			evidence_summary = excluded.evidence_summary,
			raw = excluded.raw,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at,
			synced_at = excluded.synced_at`,
		report.ReportID,
		report.ReporterNodeID,
		report.Reason,
		report.Severity,
		report.Status,
		report.Description,
		report.EvidenceSummary,
		report.Raw,
		report.CreatedAt,
		report.UpdatedAt,
		report.SyncedAt,
		report.ReadAt,
		report.MatchedAt,
	)
	return err
}

func replaceAbuseIdentities(ctx context.Context, tx *sql.Tx, reportID string, identities []AbuseBroadcastIdentity) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM abuse_broadcast_identities WHERE report_id = ?`, reportID); err != nil {
		return err
	}
	now := time.Now().Unix()
	for _, identity := range identities {
		identity.Type = strings.TrimSpace(identity.Type)
		identity.Value = strings.TrimSpace(identity.Value)
		identity.Hash = strings.TrimSpace(identity.Hash)
		if identity.Type == "" || (identity.Value == "" && identity.Hash == "") {
			continue
		}
		if identity.Hash == "" {
			identity.Hash = abuseIdentityHash(identity.Type, identity.Value)
		}
		if identity.Confidence == 0 {
			identity.Confidence = 50
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO abuse_broadcast_identities (report_id, identity_type, identity_value, identity_hash, confidence, created_at)
			VALUES (?, ?, ?, ?, ?, ?)`,
			reportID, identity.Type, identity.Value, identity.Hash, identity.Confidence, now); err != nil {
			return err
		}
	}
	return nil
}

func listAbuseIdentities(ctx context.Context, db *sql.DB, reportID string) ([]AbuseBroadcastIdentity, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT identity_type, identity_value, identity_hash, confidence
		FROM abuse_broadcast_identities
		WHERE report_id = ?
		ORDER BY id ASC`, reportID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	identities := make([]AbuseBroadcastIdentity, 0)
	for rows.Next() {
		var identity AbuseBroadcastIdentity
		if err := rows.Scan(&identity.Type, &identity.Value, &identity.Hash, &identity.Confidence); err != nil {
			return nil, err
		}
		identities = append(identities, identity)
	}
	return identities, rows.Err()
}

func reportFromEvent(event hubEvent) (AbuseBroadcastReport, []AbuseBroadcastIdentity, error) {
	report := AbuseBroadcastReport{
		ReportID:  event.ReportID,
		Status:    event.EventType,
		Severity:  "medium",
		CreatedAt: event.CreatedAt,
		UpdatedAt: event.CreatedAt,
		Raw:       event.Payload,
	}
	if report.Status == "" || report.Status == "published" {
		report.Status = "published"
	}
	if strings.TrimSpace(event.Payload) == "" {
		return report, nil, nil
	}

	var payload hubReportPayload
	if err := json.Unmarshal([]byte(event.Payload), &payload); err != nil {
		return report, nil, fmt.Errorf("decode report payload %s: %w", event.ReportID, err)
	}
	if payload.ReportID != "" {
		report.ReportID = payload.ReportID
	}
	report.ReporterNodeID = payload.ReporterNodeID
	report.Reason = payload.Reason
	report.Severity = payload.Severity
	report.Status = payload.Status
	report.Description = payload.Description
	report.EvidenceSummary = evidenceSummaryString(payload.EvidenceSummary)
	report.CreatedAt = payload.CreatedAt
	report.UpdatedAt = payload.UpdatedAt
	if report.Severity == "" {
		report.Severity = "medium"
	}
	if report.Status == "" {
		report.Status = "published"
	}
	if report.CreatedAt == 0 {
		report.CreatedAt = event.CreatedAt
	}
	if report.UpdatedAt == 0 {
		report.UpdatedAt = report.CreatedAt
	}

	identities := make([]AbuseBroadcastIdentity, 0, len(payload.Identities))
	for _, identity := range payload.Identities {
		identities = append(identities, AbuseBroadcastIdentity{
			Type:       identity.Type,
			Value:      identity.Value,
			Hash:       identity.Hash,
			Confidence: identity.Confidence,
		})
	}
	return report, identities, nil
}

func evidenceSummaryString(value interface{}) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	default:
		raw, err := json.Marshal(v)
		if err != nil {
			return ""
		}
		return string(raw)
	}
}

func buildHubReportIdentities(analysis map[string]interface{}) []hubReportIdentity {
	identities := make([]hubReportIdentity, 0, defaultAbuseReportTopIPLimit+1)
	user := mapFromInterface(analysis["user"])
	seen := map[string]struct{}{}
	if linuxDoID := strings.TrimSpace(toString(user["linux_do_id"])); linuxDoID != "" {
		identities = appendHubIdentity(identities, seen, "linuxdo_id", linuxDoID, 95)
	}
	for _, row := range sliceOfMaps(analysis["top_ips"]) {
		if len(identities) >= defaultAbuseReportTopIPLimit+1 {
			break
		}
		ip := strings.TrimSpace(toString(row["ip"]))
		if ip == "" {
			continue
		}
		identities = appendHubIdentity(identities, seen, "ip", ip, 80)
	}
	return identities
}

func appendHubIdentity(identities []hubReportIdentity, seen map[string]struct{}, identityType, value string, confidence int) []hubReportIdentity {
	key := strings.ToLower(identityType) + "\x00" + strings.ToLower(strings.TrimSpace(value))
	if _, ok := seen[key]; ok {
		return identities
	}
	seen[key] = struct{}{}
	return append(identities, hubReportIdentity{
		Type:       identityType,
		Value:      strings.TrimSpace(value),
		Hash:       abuseIdentityHash(identityType, value),
		Confidence: confidence,
	})
}

func buildAbuseEvidenceSummary(analysis map[string]interface{}, window string) map[string]interface{} {
	user := mapFromInterface(analysis["user"])
	return map[string]interface{}{
		"range":  analysis["range"],
		"window": window,
		"user": map[string]interface{}{
			"id":           user["id"],
			"username":     user["username"],
			"display_name": user["display_name"],
			"status":       user["status"],
			"group":        user["group"],
			"linux_do_id":  user["linux_do_id"],
		},
		"summary":     analysis["summary"],
		"risk":        analysis["risk"],
		"top_ips":     limitMaps(sliceOfMaps(analysis["top_ips"]), defaultAbuseReportTopIPLimit),
		"recent_logs": sanitizeRecentLogs(sliceOfMaps(analysis["recent_logs"]), defaultAbuseReportRecentLogLimit),
	}
}

func sanitizeRecentLogs(rows []map[string]interface{}, limit int) []map[string]interface{} {
	if limit <= 0 || len(rows) == 0 {
		return []map[string]interface{}{}
	}
	if len(rows) > limit {
		rows = rows[:limit]
	}
	result := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		result = append(result, map[string]interface{}{
			"id":                row["id"],
			"created_at":        row["created_at"],
			"type":              row["type"],
			"model_name":        row["model_name"],
			"quota":             row["quota"],
			"prompt_tokens":     row["prompt_tokens"],
			"completion_tokens": row["completion_tokens"],
			"use_time":          row["use_time"],
			"ip":                row["ip"],
			"channel_name":      row["channel_name"],
			"token_name":        row["token_name"],
		})
	}
	return result
}

func limitMaps(rows []map[string]interface{}, limit int) []map[string]interface{} {
	if limit <= 0 || len(rows) == 0 {
		return []map[string]interface{}{}
	}
	if len(rows) <= limit {
		return rows
	}
	return rows[:limit]
}

func mapFromInterface(value interface{}) map[string]interface{} {
	if value == nil {
		return map[string]interface{}{}
	}
	if m, ok := value.(map[string]interface{}); ok {
		return m
	}
	return map[string]interface{}{}
}

func sliceOfMaps(value interface{}) []map[string]interface{} {
	if value == nil {
		return []map[string]interface{}{}
	}
	if rows, ok := value.([]map[string]interface{}); ok {
		return rows
	}
	if rawRows, ok := value.([]interface{}); ok {
		rows := make([]map[string]interface{}, 0, len(rawRows))
		for _, raw := range rawRows {
			if row, ok := raw.(map[string]interface{}); ok {
				rows = append(rows, row)
			}
		}
		return rows
	}
	return []map[string]interface{}{}
}

func upsertMatchedUser(matched map[int64]*AbuseBroadcastMatchedUser, userID int64) *AbuseBroadcastMatchedUser {
	user := matched[userID]
	if user == nil {
		user = &AbuseBroadcastMatchedUser{UserID: userID}
		matched[userID] = user
	}
	return user
}

func appendUniqueString(items []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return items
	}
	for _, item := range items {
		if item == value {
			return items
		}
	}
	return append(items, value)
}

func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if item := strings.TrimSpace(part); item != "" {
			result = append(result, item)
		}
	}
	return result
}

func placeholders(count int) string {
	if count <= 0 {
		return ""
	}
	parts := make([]string, count)
	for i := range parts {
		parts[i] = "?"
	}
	return strings.Join(parts, ",")
}

func hubErrorMessage(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return text
	}
	var obj map[string]interface{}
	if err := json.Unmarshal(raw, &obj); err == nil {
		if message, ok := obj["message"].(string); ok {
			return message
		}
	}
	return string(raw)
}

func sqliteDSN(path string) string {
	if path == ":memory:" || strings.Contains(path, "?") {
		return path
	}
	return path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
}

func countAbuseRows(ctx context.Context, db *sql.DB, table string) int64 {
	var count int64
	query := fmt.Sprintf("SELECT COUNT(*) FROM %s", table)
	if err := db.QueryRowContext(ctx, query).Scan(&count); err != nil {
		return 0
	}
	return count
}

func countUnreadAbuseReports(ctx context.Context, db *sql.DB) int64 {
	var count int64
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM abuse_broadcast_reports WHERE read_at = 0`).Scan(&count); err != nil {
		return 0
	}
	return count
}

func abuseIdentityHash(identityType, value string) string {
	normalized := strings.ToLower(strings.TrimSpace(identityType)) + "\x00" + strings.ToLower(strings.TrimSpace(value))
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])
}

func loadAbuseSettings(ctx context.Context, db *sql.DB) (abuseSettings, error) {
	var (
		settings abuseSettings
		enabled  int
	)
	err := db.QueryRowContext(ctx, `
		SELECT enabled, hub_url, node_id, secret, pull_interval_seconds, updated_at
		FROM abuse_broadcast_settings
		WHERE id = 1`).Scan(
		&enabled,
		&settings.HubURL,
		&settings.NodeID,
		&settings.Secret,
		&settings.PullIntervalSeconds,
		&settings.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return abuseSettings{PullIntervalSeconds: 300}, nil
	}
	if err != nil {
		return abuseSettings{}, err
	}
	settings.Enabled = enabled == 1
	settings.HubURL = strings.TrimRight(settings.HubURL, "/")
	if settings.PullIntervalSeconds <= 0 {
		settings.PullIntervalSeconds = 300
	}
	return settings, nil
}

func saveAbuseSettings(ctx context.Context, db *sql.DB, settings abuseSettings) error {
	enabled := 0
	if settings.Enabled {
		enabled = 1
	}
	now := time.Now().Unix()
	_, err := db.ExecContext(ctx, `
		INSERT INTO abuse_broadcast_settings (id, enabled, hub_url, node_id, secret, pull_interval_seconds, updated_at)
		VALUES (1, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			enabled = excluded.enabled,
			hub_url = excluded.hub_url,
			node_id = excluded.node_id,
			secret = excluded.secret,
			pull_interval_seconds = excluded.pull_interval_seconds,
			updated_at = excluded.updated_at`,
		enabled,
		strings.TrimRight(strings.TrimSpace(settings.HubURL), "/"),
		strings.TrimSpace(settings.NodeID),
		settings.Secret,
		settings.PullIntervalSeconds,
		now,
	)
	return err
}

func randomAbuseHex(bytesLen int) string {
	buf := make([]byte, bytesLen)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

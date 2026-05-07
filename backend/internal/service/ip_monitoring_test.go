package service

import (
	"fmt"
	"testing"
	"time"

	"github.com/new-api-tools/backend/internal/cache"
)

func installIPMonitoringSchema(t *testing.T) {
	t.Helper()
	db := installSQLiteForTests(t)
	stmts := []string{
		`CREATE TABLE logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER,
			created_at INTEGER,
			type INTEGER,
			ip TEXT,
			token_id INTEGER,
			model_name TEXT
		)`,
		`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)`,
		`CREATE TABLE tokens (id INTEGER PRIMARY KEY, name TEXT)`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("create schema: %v", err)
		}
	}
}

func stubGeoIP(t *testing.T) {
	t.Helper()
	restore := SetIPGeoServiceProviderForTesting(func() *IPGeoService {
		return &IPGeoService{}
	})
	t.Cleanup(restore)
}

func clearIPTestCaches(t *testing.T) {
	t.Helper()
	cm := cache.Get()
	cm.DeleteByPrefix("dashboard:ip_distribution:")
	cm.DeleteByPrefix("ip:")
}

func TestLookupIPUsersIncludesGeoAndFullAggregates(t *testing.T) {
	installIPMonitoringSchema(t)
	stubGeoIP(t)
	clearIPTestCaches(t)

	db := NewIPMonitoringService().db.DB
	now := time.Now().Unix()
	if _, err := db.Exec(`INSERT INTO users (id, username) VALUES (1, 'alice'), (2, 'bob')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO tokens (id, name) VALUES (10, 'alpha'), (20, 'beta')`); err != nil {
		t.Fatal(err)
	}
	for _, row := range []struct {
		userID  int
		tokenID int
		model   string
	}{
		{1, 10, "gpt-a"},
		{1, 10, "gpt-a"},
		{2, 20, "gpt-b"},
	} {
		if _, err := db.Exec(
			`INSERT INTO logs (user_id, created_at, type, ip, token_id, model_name) VALUES (?, ?, 2, '10.0.0.1', ?, ?)`,
			row.userID, now, row.tokenID, row.model,
		); err != nil {
			t.Fatal(err)
		}
	}

	res, err := NewIPMonitoringService().LookupIPUsers("10.0.0.1", "24h", 1, true)
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if got := toInt64(res["total_requests"]); got != 3 {
		t.Fatalf("total_requests should be full aggregate, got %d", got)
	}
	if got := toInt64(res["unique_users"]); got != 2 {
		t.Fatalf("unique_users should be full aggregate, got %d", got)
	}
	if got := len(res["items"].([]map[string]interface{})); got != 1 {
		t.Fatalf("items should honor limit, got %d", got)
	}
	geo, ok := res["geo"].(map[string]interface{})
	if !ok {
		t.Fatalf("geo missing or wrong type: %#v", res["geo"])
	}
	if geo["success"] != true || geo["country"] != "本地网络" || geo["country_code"] != "LO" {
		t.Fatalf("unexpected private-IP geo response: %#v", geo)
	}
}

func TestIPDistributionUsesFullTotalsAndSampleCoverage(t *testing.T) {
	installIPMonitoringSchema(t)
	stubGeoIP(t)
	clearIPTestCaches(t)

	oldLimit := ipDistributionSampleLimit
	ipDistributionSampleLimit = 1
	t.Cleanup(func() { ipDistributionSampleLimit = oldLimit })

	db := NewDashboardService().db.DB
	now := time.Now().Unix()
	for _, ip := range []string{"10.0.0.1", "10.0.0.1", "10.0.0.1", "10.0.0.2"} {
		if _, err := db.Exec(`INSERT INTO logs (user_id, created_at, type, ip) VALUES (1, ?, 2, ?)`, now, ip); err != nil {
			t.Fatal(err)
		}
	}

	res, err := NewDashboardService().GetIPDistribution("24h", true)
	if err != nil {
		t.Fatalf("distribution: %v", err)
	}
	if got := toInt64(res["total_ips"]); got != 2 {
		t.Fatalf("total_ips should be full-window distinct count, got %d", got)
	}
	if got := toInt64(res["total_requests"]); got != 4 {
		t.Fatalf("total_requests should be full-window count, got %d", got)
	}
	if got := toInt64(res["sampled_ips"]); got != 1 {
		t.Fatalf("sampled_ips should follow sample limit, got %d", got)
	}
	if got := toFloat64(res["coverage_percentage"]); got != 75 {
		t.Fatalf("coverage_percentage got %.2f, want 75", got)
	}
}

func TestIPDistributionNoCacheBypassesStoredResult(t *testing.T) {
	installIPMonitoringSchema(t)
	stubGeoIP(t)
	clearIPTestCaches(t)

	db := NewDashboardService().db.DB
	now := time.Now().Unix()
	if _, err := db.Exec(`INSERT INTO logs (user_id, created_at, type, ip) VALUES (1, ?, 2, '10.0.0.1')`, now); err != nil {
		t.Fatal(err)
	}
	first, err := NewDashboardService().GetIPDistribution("24h", false)
	if err != nil {
		t.Fatalf("first distribution: %v", err)
	}
	if got := toInt64(first["total_requests"]); got != 1 {
		t.Fatalf("first total_requests got %d", got)
	}

	if _, err := db.Exec(`INSERT INTO logs (user_id, created_at, type, ip) VALUES (1, ?, 2, '10.0.0.2')`, now); err != nil {
		t.Fatal(err)
	}
	cached, err := NewDashboardService().GetIPDistribution("24h", false)
	if err != nil {
		t.Fatalf("cached distribution: %v", err)
	}
	if got := toInt64(cached["total_requests"]); got != 1 {
		t.Fatalf("cached total_requests should remain 1, got %d", got)
	}
	fresh, err := NewDashboardService().GetIPDistribution("24h", true)
	if err != nil {
		t.Fatalf("fresh distribution: %v", err)
	}
	if got := toInt64(fresh["total_requests"]); got != 2 {
		t.Fatalf("no_cache total_requests should refresh to 2, got %d", got)
	}
}

func TestMultiIPTokenDetailsAreLimitedInSQL(t *testing.T) {
	installIPMonitoringSchema(t)
	clearIPTestCaches(t)

	db := NewIPMonitoringService().db.DB
	now := time.Now().Unix()
	if _, err := db.Exec(`INSERT INTO users (id, username) VALUES (1, 'alice')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO tokens (id, name) VALUES (10, 'alpha')`); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 25; i++ {
		ip := fmt.Sprintf("10.0.0.%d", i)
		if _, err := db.Exec(
			`INSERT INTO logs (user_id, created_at, type, ip, token_id) VALUES (1, ?, 2, ?, 10)`,
			now, ip,
		); err != nil {
			t.Fatal(err)
		}
	}

	res, err := NewIPMonitoringService().GetMultiIPTokens("24h", 2, 10, true)
	if err != nil {
		t.Fatalf("multi-ip tokens: %v", err)
	}
	items := res["items"].([]map[string]interface{})
	if len(items) != 1 {
		t.Fatalf("expected one token row, got %d", len(items))
	}
	ips := items[0]["ips"].([]map[string]interface{})
	if len(ips) != tokenIPDetailLimit {
		t.Fatalf("expected %d detailed IPs, got %d", tokenIPDetailLimit, len(ips))
	}
}

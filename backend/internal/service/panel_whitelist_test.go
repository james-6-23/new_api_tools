package service

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPanelWhitelistSaveAndResolve(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "panel_whitelist.json")
	SetPanelWhitelistPersistPathForTest(path)
	InvalidatePanelWhitelistCache()

	// 清空并只放显式 ID（不查管理员，避免依赖真实 DB）
	if err := SavePanelWhitelistConfig(PanelWhitelistConfig{
		UserIDs:       []int64{42, 7, 42, -1, 0},
		ExcludeAdmins: false,
	}); err != nil {
		t.Fatalf("save: %v", err)
	}

	cfg := GetPanelWhitelistConfig()
	if len(cfg.UserIDs) != 2 || cfg.UserIDs[0] != 7 || cfg.UserIDs[1] != 42 {
		t.Fatalf("dedupe/sort failed: %v", cfg.UserIDs)
	}
	if cfg.ExcludeAdmins {
		t.Fatal("exclude_admins should be false")
	}

	ids := ResolvedPanelWhitelistIDs()
	if len(ids) != 2 || ids[0] != 7 || ids[1] != 42 {
		t.Fatalf("resolved=%v", ids)
	}
	if !IsPanelWhitelisted(42) || IsPanelWhitelisted(99) {
		t.Fatal("IsPanelWhitelisted mismatch")
	}

	cond, args := PanelWhitelistNotInClause("u.id")
	if cond == "" || len(args) != 2 {
		t.Fatalf("clause=%q args=%v", cond, args)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("persist file missing: %v", err)
	}

	// cleanup for other tests
	_ = SavePanelWhitelistConfig(PanelWhitelistConfig{UserIDs: nil, ExcludeAdmins: false})
	InvalidatePanelWhitelistCache()
}

func TestPanelWhitelistAddRemove(t *testing.T) {
	dir := t.TempDir()
	SetPanelWhitelistPersistPathForTest(filepath.Join(dir, "wl.json"))
	InvalidatePanelWhitelistCache()
	_ = SavePanelWhitelistConfig(PanelWhitelistConfig{UserIDs: nil, ExcludeAdmins: false})

	if err := AddPanelWhitelistUser(100); err != nil {
		t.Fatal(err)
	}
	if err := AddPanelWhitelistUser(100); err != nil {
		t.Fatal(err)
	}
	cfg := GetPanelWhitelistConfig()
	if len(cfg.UserIDs) != 1 || cfg.UserIDs[0] != 100 {
		t.Fatalf("got %v", cfg.UserIDs)
	}
	if err := RemovePanelWhitelistUser(100); err != nil {
		t.Fatal(err)
	}
	if len(GetPanelWhitelistConfig().UserIDs) != 0 {
		t.Fatal("expected empty")
	}
}

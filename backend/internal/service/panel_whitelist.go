package service

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/new-api-tools/backend/internal/cache"
	"github.com/new-api-tools/backend/internal/database"
)

const (
	panelWhitelistCacheKey = "panel:whitelist:v1"
	// NewAPI: role >= 10 为管理员，100 为 root
	panelAdminRoleMin = 10
)

// PanelWhitelistConfig 全局面板白名单配置（#17）
// 白名单用户从充值/风控/IP/日志/令牌/用户列表等运营面板中过滤。
type PanelWhitelistConfig struct {
	UserIDs       []int64 `json:"user_ids"`
	ExcludeAdmins bool    `json:"exclude_admins"` // 自动排除 role >= 10
}

// panelWhitelistStore 内存缓存解析后的排除 ID 集合，减少重复查库。
type panelWhitelistStore struct {
	mu          sync.RWMutex
	cfg         PanelWhitelistConfig
	resolved    []int64
	resolvedAt  time.Time
	resolveTTL  time.Duration
	persistPath string
}

var globalPanelWL = &panelWhitelistStore{
	cfg: PanelWhitelistConfig{
		UserIDs:       []int64{},
		ExcludeAdmins: true, // 默认过滤管理员
	},
	resolveTTL:  60 * time.Second,
	persistPath: defaultPanelWhitelistPath(),
}

func defaultPanelWhitelistPath() string {
	if d := os.Getenv("DATA_DIR"); d != "" {
		return filepath.Join(d, "panel_whitelist.json")
	}
	// 容器内常见路径
	if _, err := os.Stat("/app/data"); err == nil {
		return "/app/data/panel_whitelist.json"
	}
	return filepath.Join("data", "panel_whitelist.json")
}

func init() {
	// 启动时尽量从磁盘/Redis 加载
	_ = globalPanelWL.load()
}

// GetPanelWhitelistConfig 返回当前配置（不展开管理员）。
func GetPanelWhitelistConfig() PanelWhitelistConfig {
	globalPanelWL.mu.RLock()
	defer globalPanelWL.mu.RUnlock()
	ids := make([]int64, len(globalPanelWL.cfg.UserIDs))
	copy(ids, globalPanelWL.cfg.UserIDs)
	return PanelWhitelistConfig{
		UserIDs:       ids,
		ExcludeAdmins: globalPanelWL.cfg.ExcludeAdmins,
	}
}

// SavePanelWhitelistConfig 保存配置并失效解析缓存。
func SavePanelWhitelistConfig(cfg PanelWhitelistConfig) error {
	// 去重 + 排序 + 过滤非法
	seen := map[int64]struct{}{}
	clean := make([]int64, 0, len(cfg.UserIDs))
	for _, id := range cfg.UserIDs {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		clean = append(clean, id)
	}
	sort.Slice(clean, func(i, j int) bool { return clean[i] < clean[j] })
	cfg.UserIDs = clean

	globalPanelWL.mu.Lock()
	globalPanelWL.cfg = cfg
	globalPanelWL.resolved = nil
	globalPanelWL.resolvedAt = time.Time{}
	path := globalPanelWL.persistPath
	globalPanelWL.mu.Unlock()

	if err := persistPanelWhitelist(path, cfg); err != nil {
		return err
	}
	cm := cache.Get()
	_ = cm.Set(panelWhitelistCacheKey, cfg, 0)
	return nil
}

// AddPanelWhitelistUser 添加用户 ID。
func AddPanelWhitelistUser(userID int64) error {
	if userID <= 0 {
		return fmt.Errorf("invalid user_id")
	}
	cfg := GetPanelWhitelistConfig()
	for _, id := range cfg.UserIDs {
		if id == userID {
			return nil
		}
	}
	cfg.UserIDs = append(cfg.UserIDs, userID)
	return SavePanelWhitelistConfig(cfg)
}

// RemovePanelWhitelistUser 移除用户 ID（不影响「排除管理员」开关带来的隐式过滤）。
func RemovePanelWhitelistUser(userID int64) error {
	cfg := GetPanelWhitelistConfig()
	out := make([]int64, 0, len(cfg.UserIDs))
	for _, id := range cfg.UserIDs {
		if id != userID {
			out = append(out, id)
		}
	}
	cfg.UserIDs = out
	return SavePanelWhitelistConfig(cfg)
}

// ResolvedPanelWhitelistIDs 返回应在面板中排除的全部 user_id（显式 + 可选管理员）。
func ResolvedPanelWhitelistIDs() []int64 {
	globalPanelWL.mu.RLock()
	if len(globalPanelWL.resolved) > 0 && time.Since(globalPanelWL.resolvedAt) < globalPanelWL.resolveTTL {
		out := make([]int64, len(globalPanelWL.resolved))
		copy(out, globalPanelWL.resolved)
		globalPanelWL.mu.RUnlock()
		return out
	}
	cfg := globalPanelWL.cfg
	globalPanelWL.mu.RUnlock()

	resolved := resolvePanelWhitelistIDs(cfg)

	globalPanelWL.mu.Lock()
	globalPanelWL.resolved = resolved
	globalPanelWL.resolvedAt = time.Now()
	globalPanelWL.mu.Unlock()

	out := make([]int64, len(resolved))
	copy(out, resolved)
	return out
}

// IsPanelWhitelisted 判断用户是否应在运营面板中被过滤。
func IsPanelWhitelisted(userID int64) bool {
	if userID <= 0 {
		return false
	}
	for _, id := range ResolvedPanelWhitelistIDs() {
		if id == userID {
			return true
		}
	}
	return false
}

// PanelWhitelistNotInSQL 生成 "AND <col> NOT IN (...)"（无白名单时返回空串）。
// argIdx 为下一个占位符序号（PG 用 $n）；返回 nextIdx。
// 适用于自行用 Placeholder 拼 SQL 的路径（如 top_ups）。
func PanelWhitelistNotInSQL(column string, argIdx int) (cond string, args []interface{}, nextIdx int) {
	ids := ResolvedPanelWhitelistIDs()
	if len(ids) == 0 {
		return "", nil, argIdx
	}
	db := database.Get()
	ph := make([]string, len(ids))
	args = make([]interface{}, len(ids))
	for i, id := range ids {
		ph[i] = db.Placeholder(argIdx)
		args[i] = id
		argIdx++
	}
	return fmt.Sprintf(" AND %s NOT IN (%s)", column, strings.Join(ph, ",")), args, argIdx
}

// PanelWhitelistNotInClause 生成 "<col> NOT IN (?,?,...)"（统一用 ?，配合 RebindQuery）。
func PanelWhitelistNotInClause(column string) (cond string, args []interface{}) {
	ids := ResolvedPanelWhitelistIDs()
	if len(ids) == 0 {
		return "", nil
	}
	ph := make([]string, len(ids))
	args = make([]interface{}, len(ids))
	for i, id := range ids {
		ph[i] = "?"
		args[i] = id
	}
	return fmt.Sprintf("%s NOT IN (%s)", column, strings.Join(ph, ",")), args
}

// ListPanelWhitelistUsers 列出配置中的显式白名单用户详情（含管理员开关状态）。
func ListPanelWhitelistUsers() map[string]interface{} {
	cfg := GetPanelWhitelistConfig()
	items := make([]map[string]interface{}, 0)
	if len(cfg.UserIDs) > 0 {
		db := database.Get()
		ph := make([]string, len(cfg.UserIDs))
		args := make([]interface{}, len(cfg.UserIDs))
		for i, id := range cfg.UserIDs {
			ph[i] = db.Placeholder(i + 1)
			args[i] = id
		}
		q := fmt.Sprintf(
			`SELECT id, username, COALESCE(display_name,'') as display_name, role, status
			 FROM users WHERE id IN (%s) AND deleted_at IS NULL`,
			strings.Join(ph, ","))
		rows, err := db.Query(q, args...)
		if err == nil && rows != nil {
			items = rows
		}
		// 补全已删除/不存在的 ID
		found := map[int64]bool{}
		for _, r := range items {
			found[toInt64(r["id"])] = true
		}
		for _, id := range cfg.UserIDs {
			if !found[id] {
				items = append(items, map[string]interface{}{
					"id": id, "username": fmt.Sprintf("#%d", id), "display_name": "", "role": 0, "status": 0, "missing": true,
				})
			}
		}
	}

	resolved := ResolvedPanelWhitelistIDs()
	return map[string]interface{}{
		"user_ids":       cfg.UserIDs,
		"exclude_admins": cfg.ExcludeAdmins,
		"items":          items,
		"resolved_count": len(resolved),
		"resolved_ids":   resolved,
	}
}

// SearchUsersForPanelWhitelist 搜索可加入白名单的用户。
func SearchUsersForPanelWhitelist(keyword string) ([]map[string]interface{}, error) {
	db := database.Get()
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return []map[string]interface{}{}, nil
	}
	var q string
	var args []interface{}
	if id, err := parseInt64(keyword); err == nil {
		q = db.RebindQuery(
			`SELECT id, username, COALESCE(display_name,'') as display_name, role, status
			 FROM users WHERE deleted_at IS NULL AND (id = ? OR username LIKE ?)
			 ORDER BY id ASC LIMIT 20`)
		args = []interface{}{id, "%" + keyword + "%"}
	} else {
		q = db.RebindQuery(
			`SELECT id, username, COALESCE(display_name,'') as display_name, role, status
			 FROM users WHERE deleted_at IS NULL AND username LIKE ?
			 ORDER BY id ASC LIMIT 20`)
		args = []interface{}{"%" + keyword + "%"}
	}
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		return []map[string]interface{}{}, nil
	}
	return rows, nil
}

func parseInt64(s string) (int64, error) {
	var n int64
	_, err := fmt.Sscan(s, &n)
	return n, err
}

func resolvePanelWhitelistIDs(cfg PanelWhitelistConfig) []int64 {
	seen := map[int64]struct{}{}
	for _, id := range cfg.UserIDs {
		if id > 0 {
			seen[id] = struct{}{}
		}
	}
	if cfg.ExcludeAdmins {
		db := database.Get()
		if db != nil && db.DB != nil {
			q := db.RebindQuery(
				`SELECT id FROM users WHERE deleted_at IS NULL AND role >= ?`)
			rows, err := db.Query(q, panelAdminRoleMin)
			if err == nil {
				for _, r := range rows {
					id := toInt64(r["id"])
					if id > 0 {
						seen[id] = struct{}{}
					}
				}
			}
		}
	}
	out := make([]int64, 0, len(seen))
	for id := range seen {
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func (s *panelWhitelistStore) load() error {
	// 优先磁盘
	if data, err := os.ReadFile(s.persistPath); err == nil && len(data) > 0 {
		var cfg PanelWhitelistConfig
		if json.Unmarshal(data, &cfg) == nil {
			s.mu.Lock()
			s.cfg = cfg
			s.mu.Unlock()
			return nil
		}
	}
	// Redis
	cm := cache.Get()
	var cfg PanelWhitelistConfig
	if ok, _ := cm.GetJSON(panelWhitelistCacheKey, &cfg); ok {
		s.mu.Lock()
		s.cfg = cfg
		s.mu.Unlock()
		return nil
	}
	return nil
}

func persistPanelWhitelist(path string, cfg PanelWhitelistConfig) error {
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// InvalidatePanelWhitelistCache 测试或热更新后强制重算。
func InvalidatePanelWhitelistCache() {
	globalPanelWL.mu.Lock()
	globalPanelWL.resolved = nil
	globalPanelWL.resolvedAt = time.Time{}
	globalPanelWL.mu.Unlock()
}

// SetPanelWhitelistPersistPathForTest 仅测试用。
func SetPanelWhitelistPersistPathForTest(path string) {
	globalPanelWL.mu.Lock()
	globalPanelWL.persistPath = path
	globalPanelWL.mu.Unlock()
}

# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed
- **修复 /analytics 页面 TypeError 错误**：后端 `/api/analytics/summary` 返回数据结构与前端期望不一致
  - 新增 `GetFullSummary()` 方法返回完整的 `state`、`user_request_ranking`、`user_quota_ranking`、`model_statistics` 数据
  - 新增 `ModelStatistics`、`UserRanking`、`AnalyticsSummaryResponse` 等前端期望的数据结构
  - 修复 `fetchModelStatisticsForSummary` 中字面量 `5` 改为 `models.LogTypeFailure` 常量
  - 为 `fetchUserRankingForSummary` 和 `fetchModelStatisticsForSummary` 添加数据库错误检查
  - 涉及文件：`internal/service/analytics.go`、`internal/handler/extended.go`
- **修复 analytics_state 表无限增长**：`updateStateInDB` 从追加写入改为 upsert 模式
  - 涉及文件：`internal/service/analytics.go`

### Added
- **Legacy Analytics 方法**：新增完整的 Legacy 分析功能支持前端同步状态显示
  - `ProcessLegacy()`、`BatchProcessLegacy()`、`ResetLegacy()`、`GetLegacySyncStatus()`、`CheckAndAutoResetLegacy()`
  - 支持动态批量配置、初始化截止点、数据一致性检查
  - 涉及文件：`internal/service/analytics.go`
- **analytics_meta 表**：新增元数据表用于存储初始化截止点等配置
  - 涉及文件：`internal/database/database.go`

### Fixed
- **修复 users 表 created_at 列不存在错误**：NewAPI 原始 users 表没有 created_at 列，Go 后端错误引用导致 SQL 报错
  - 移除 `models.User` 结构体中不存在的 `CreatedAt` 字段
  - 修复 `GetUsers()` 函数中对 `u.created_at` 的日期过滤和排序引用，改用 `u.id DESC`
  - 涉及文件：`internal/models/models.go`、`internal/service/user.go`、`internal/service/risk.go`
- **基于 logs 表实现用户时间戳**：由于 users 表无 created_at，改用 logs 表提供时间信息
  - `GetUsers()` 返回的 `created_at` 改为用户首次请求时间 (`MIN(logs.created_at)`)
  - `GetUsers()` 返回的 `last_login_at` 改为用户最后请求时间 (`MAX(logs.created_at)`)
  - `fetchUserStatistics()` 的今日/本周/本月新增用户统计改为基于首次请求时间
  - `GetBanRecords()` 的 `banned_at` 改为用户最后请求时间（封禁后无法再请求）
  - 涉及文件：`internal/service/user.go`、`internal/service/risk.go`
- **Dashboard 占位接口实现**：修复 3 个 Go 后端占位接口，与 Python 行为对齐
  - `POST /api/dashboard/cache/invalidate`：实现真实 Redis 缓存清除逻辑，支持按 key 模式删除，返回实际删除的 key 数量
  - `GET /api/dashboard/refresh-estimate`：实现基于系统规模的查询时间估算，大型系统返回详细信息
  - `POST /api/ip/enable-all`：实现批量开启用户 IP 记录，支持 PostgreSQL jsonb 和 MySQL JSON_SET
  - 涉及文件：`internal/handler/dashboard.go`、`internal/service/system.go`、`internal/service/ip.go`
- **Redis KEYS 命令阻塞问题**：`DeletePattern` 改用 SCAN 迭代删除，避免大数据量下阻塞 Redis
  - 新增 `ScanKeys` 函数用于安全获取匹配键列表
  - `DeletePattern` 现返回 `(int64, error)`，表示实际删除的键数量
  - 涉及文件：`internal/cache/cache.go`、`internal/cache/slot.go`、`internal/service/storage.go`、`internal/service/analytics.go`
- **用户状态常量恢复**：恢复 `UserStatusDisabled=2`、`UserStatusBanned=3`，保持与历史数据库兼容
  - 涉及文件：`internal/models/models.go`
- **日志类型常量统一**：将 `LogTypeFailure=5` 从 `risk.go` 移至 `models.go` 统一管理
  - 涉及文件：`internal/models/models.go`、`internal/service/risk.go`
- **接口路径参数兼容性修复**：修复多个接口因路径参数名与 handler 读取不一致导致必然 400 错误
  - `/api/users/:user_id/ban`、`/unban`、`DELETE /:user_id`：handler 现使用 `c.Param("user_id")`
  - `/api/users/tokens/:token_id/disable`：handler 现使用 `c.Param("token_id")`
  - `/api/ip/geo/:ip`：同时支持路径参数和 query 参数读取
  - `/api/risk/affiliated-accounts`：改为 query 参数接口（`min_invited`、`include_activity`、`limit`）
  - 涉及文件：`internal/handler/modules.go`
- **IP 监控参数兼容性修复**：`GetSharedIPs` 同时支持 `min_tokens`（Python）和 `min_users`（Go）参数名
  - 涉及文件：`internal/handler/modules.go`
- **model-status/status/batch 请求体兼容**：同时支持数组格式 `["model1"]` 和对象格式 `{"models":["model1"]}`
  - 涉及文件：`internal/handler/extended.go`

### Changed
- **parseWindowToSeconds 扩展**：新增 `3h`、`12h` 窗口支持，与 Python 版本对齐
  - 涉及文件：`internal/handler/modules.go`
- **风控排行榜重构**：`GetLeaderboards` 支持多窗口批量查询（`windows` 参数）和排序方式（`sort_by`）
  - 涉及文件：`internal/handler/modules.go`、`internal/service/risk.go`
- **用户封禁增强**：`BanUser`/`UnbanUser` 支持 `disable_tokens`/`enable_tokens` 选项
  - 涉及文件：`internal/handler/modules.go`、`internal/service/user.go`

### Added
- **GeoIP ASN 支持**：扩展 GeoIP 模块支持 ASN 数据库查询
  - 新增 `GeoInfo.ASN`、`GeoInfo.Organization`、`GeoInfo.City` 字段
  - 实现 ASN 数据库热重载机制（支持运行时更新）
  - 新增 `LookupASN()`、`GetASNInfo()` 方法
  - 涉及文件：`pkg/geoip/geoip.go`
- **Risk 双栈识别**：实现 IPv4/IPv6 双栈切换检测
  - 新增 `UserRiskAnalysis.RealSwitchCount`、`DualStackSwitches` 字段
  - 实现基于 GeoIP 位置键的智能双栈识别逻辑
  - 涉及文件：`internal/service/risk.go`
- **AI Ban 白名单与审计日志**：完整实现 AI 封禁管理功能
  - 新增 `AIBanWhitelist`、`AIBanAuditLog` 数据库模型
  - 实现白名单 CRUD（添加/删除/查询）
  - 实现审计日志查询和批量删除
  - 涉及文件：`internal/models/models.go`、`internal/service/aiban.go`、`internal/database/database.go`
- **Analytics 增量聚合**：实现日志增量处理系统
  - 新增 `AnalyticsState` 状态追踪模型
  - 实现 `last_processed_id` 断点续传
  - 实现分批处理和一致性检查
  - 涉及文件：`internal/service/analytics.go`
- **Storage 存储统计**：实现完整的存储使用情况统计
  - 本地 SQLite 数据库大小和表统计
  - 主数据库日志统计（总数、今日、最早/最新）
  - Redis 缓存信息（key 数量、内存、命中率）
  - 涉及文件：`internal/service/storage.go`
- **Redemption 增强生成**：实现完整的兑换码生成算法
  - 结构化 32 位 Key 格式（随机+时间戳+计数器）
  - 随机额度支持（min/max 范围）
  - 多过期模式（never/days/date）
  - 涉及文件：`internal/service/redemption.go`、`internal/models/models.go`

### Changed
- **Dashboard 周期口径修复**：`fetchUsageData` 现支持 `24h/3d/7d/14d` 周期格式
  - 兼容前端和 warmup 任务使用的周期参数
  - 涉及文件：`internal/service/dashboard.go`
- **IP Monitoring 窗口过滤**：所有 IP 监控 API 现支持时间窗口参数
  - `GetSharedIPs`、`GetMultiIPTokens`、`GetMultiIPUsers` 添加 `windowSeconds` 参数
  - warmup 任务正确传递时间窗口配置
  - 涉及文件：`internal/service/ip.go`、`internal/tasks/warmup.go`
- **GeoIP 更新任务增强**：自动下载并加载 ASN 数据库
  - 涉及文件：`internal/tasks/aiban.go`

### Fixed
- **Dashboard 渠道/模型统计修复**：修复 `/api/dashboard/overview` 接口渠道总数和模型数量返回全零问题
  - 原因：NewAPI 的 `channels` 表没有 `deleted_at` 字段，但 Go 查询错误地添加了 `deleted_at IS NULL` 条件
  - 修复：移除渠道统计和模型统计查询中的 `deleted_at` 条件
  - 涉及文件：`internal/service/dashboard.go`
- **Dashboard 模型统计修复**：修复 `/api/dashboard/models` 接口返回全零问题
- **Dashboard Overview 统计修复**：修复 `/api/dashboard/overview` 接口缺失字段
  - 新增 `total_models`：从 abilities 表统计启用渠道的唯一模型数
  - 新增 `total_redemptions`/`unused_redemptions`：兑换码统计
  - 涉及文件：`internal/service/dashboard.go`
- **Dashboard Usage 统计修复**：修复 `/api/dashboard/usage` 接口缺失字段
  - 新增 `total_prompt_tokens`/`total_completion_tokens`：Token 统计
  - 新增 `average_response_time`：平均响应时间
  - 新增 `total_quota_used`：已使用额度（前端字段兼容）
  - 为 Log 模型添加 `UseTime` 字段
  - 涉及文件：`internal/service/dashboard.go`、`internal/models/models.go`
- **Dashboard 单元测试**：新增完整的 Dashboard 服务测试
  - 添加 `SetTestDB`/`ClearTestDB` 测试辅助函数
  - 涉及文件：`internal/service/dashboard_test.go`、`internal/database/database.go`
  - 添加 `period` 参数支持，支持 `24h/3d/7d/14d/today/week/month` 时间范围
  - 修正返回字段名以匹配前端期望：`requests` → `request_count`，`quota` → `quota_used`
  - 新增 `prompt_tokens`、`completion_tokens` 字段
  - 涉及文件：`internal/service/dashboard.go`、`internal/handler/dashboard.go`
- **GeoIP 目录配置修复**：修复 `geoip.db_path` 默认值错误包含文件名导致目录创建失败
  - 将默认值从 `/app/data/geoip/GeoLite2-Country.mmdb` 改为 `/app/data/geoip`
  - 涉及文件：`internal/config/config.go`
- **IP 监控详情查询一致性**：修复时间窗口过滤未应用于子查询的问题
  - `GetSharedIPs` 的用户列表查询现正确应用 `windowSeconds` 过滤
  - `GetMultiIPTokens` 的 IP 列表查询现正确应用 `windowSeconds` 过滤
  - 涉及文件：`internal/service/ip.go`

### Added
- 完善后台任务系统，新增多阶段渐进式缓存预热机制（8 个阶段）
  - restore: 从 SQLite 恢复缓存到 Redis
  - check: 检查缓存有效性
  - leaderboard: 预热排行榜数据
  - dashboard: 预热 Dashboard 数据
  - user_activity: 预热用户活跃度（仅大型系统）
  - ip_monitoring: 预热 IP 监控数据
  - ip_distribution: 预热 IP 分布数据
  - model_status: 预热模型状态数据
- 新增 `CacheCleanupTask` 任务：定时清理 SQLite 过期缓存（每 1 小时）
- 新增 `ModelStatusRefreshTask` 任务：定时刷新模型列表和状态缓存（每 30 分钟）
- 新增 `warmupIPMonitoring` 函数：预热 IP 监控数据（共享 IP、多 IP Token、多 IP 用户）
- 新增 `warmupUserActivity` 函数：预热用户列表（仅大型/超大型系统）
- 新增 `warmupModelStatus` 函数：预热模型状态数据
- 涉及文件：
  - `internal/tasks/warmup.go` - 多阶段预热逻辑、状态追踪
  - `internal/tasks/background.go` - 新增缓存清理和模型状态刷新任务
  - `internal/tasks/init.go` - 任务注册和初始化

### Changed
- 重构 `WarmupStatus` 结构：新增 `Status`、`Message`、`Steps`、`CompletedAt` 字段，支持更细粒度的进度追踪
- 优化 `CacheRefreshTask`：扩展刷新范围，包含 Dashboard 核心数据和排行榜数据
- 优化 `LogSyncTask`：改为分批处理（每次 1000 条，最多 5 批），避免单次处理过多数据
- 优化 `IndexEnsureTask`：新增创建/已存在索引计数统计
- 改进日志输出：使用 emoji 标识任务启动/完成状态，增加详细的进度日志
- 重构 `GetWarmupStatusHandler`：直接使用 `tasks.WarmupStatus` 中维护的状态，移除冗余的阶段映射逻辑
  - 涉及文件：`internal/handler/extended.go`

### Fixed
- 修复预热任务重启时状态未完全重置的问题：`CompletedAt`、`Progress`、`Message`、`Phase` 及所有步骤状态现在会在每次预热开始时正确重置
  - 涉及文件：`internal/tasks/warmup.go`
- 修复 PostgreSQL 时间戳类型不匹配问题：数据库 `logs.created_at` 字段为 bigint (Unix 时间戳)，但代码使用字符串日期格式比较导致 SQL 错误
  - `date_trunc(unknown, bigint) does not exist`
  - `invalid input syntax for type bigint`
  - `function date(bigint) does not exist`
- 修复 `models.Log.CreatedAt` 类型定义：从 `time.Time` 改为 `int64` 以匹配数据库实际结构
- 涉及文件：
  - `internal/models/models.go` - Log 模型 CreatedAt 字段类型修正
  - `internal/service/ip_distribution.go` - IP 分布统计查询
  - `internal/service/dashboard.go` - Dashboard 概览、使用统计、趋势数据
  - `internal/service/risk.go` - 风控排行榜、用户风险分析
  - `internal/service/analytics.go` - 日志分析、用户排行、模型统计
  - `internal/service/ip.go` - IP 统计、共享 IP、可疑 IP 检测
  - `internal/service/system.go` - 系统指标收集
  - `internal/service/aiban.go` - AI 封禁、可疑用户检测
  - `internal/service/modelstatus.go` - 模型状态、渠道统计
- 修复 channels 表查询中引用不存在的 `deleted_at` 字段问题

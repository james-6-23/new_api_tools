# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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

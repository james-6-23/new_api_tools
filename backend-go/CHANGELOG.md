# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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

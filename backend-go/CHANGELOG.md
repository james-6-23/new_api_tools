# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed
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

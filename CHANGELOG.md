# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- GeoIP 数据库优化：从 City 切换到 Country 数据库，内存占用从 ~70MB 降至 ~4MB
  - 不再提供城市和区域级别的地理位置信息，仅保留国家级别
  - 适用于只需要国家级别 IP 归属地判断的场景
- 内存优化：启动内存从 ~140MB 降至 ~40-60MB
  - GeoIP 数据库延迟加载：首次 IP 查询时才加载 mmdb 文件（节省 60-100MB）
  - SimpleCache 添加容量限制（1000 条）和 5 分钟自动清理，防止内存泄漏
  - 数据库连接池精简：pool_size 3→1, max_overflow 5→2
  - SQLite 初始化改用上下文管理器，防止连接泄漏

### Added
- 充值记录退款功能：支持管理员对已成功充值的订单进行退款操作
  - 后端新增 `REFUNDED` 状态枚举和退款接口 `POST /api/top-ups/{id}/refund`
  - 退款时自动扣减用户对应额度（使用事务 + 原子更新防止双重退款）
  - 前端新增「已退款」统计卡片和退款操作弹窗

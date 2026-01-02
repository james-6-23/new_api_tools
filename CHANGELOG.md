# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Golang 后端重写** (`backend-go/`)：使用 Gin + GORM 完全重写 Python/FastAPI 后端
  - 核心基础设施：配置管理、MySQL/SQLite 双数据库、Redis 缓存、Zap 日志
  - 认证中间件：JWT + API Key 双模式认证
  - Dashboard 模块：系统概览、使用统计、模型统计、趋势分析
  - Top-Up 充值模块：充值记录查询、统计、支付方式分析、退款功能
  - Redemption 兑换码模块：批量生成、查询、统计、删除
  - User Management 用户管理：用户列表、统计、封禁/解封、批量删除
  - Risk Monitoring 风控监控：排行榜、用户风险分析、关联账户检测
  - IP Monitoring IP 监控：IP 统计、共享 IP 检测、多 IP 用户/令牌、GeoIP 地理定位
  - AI Auto Ban 自动封禁：风险评估、可疑用户扫描、白名单管理
  - Log Analytics 日志分析：请求/额度排行、模型统计、分析摘要
  - Model Status 模型状态：可用模型列表、状态监控、渠道统计
  - System Management 系统管理：系统规模、预热状态、索引管理
  - Storage Management 存储管理：配置管理、缓存清理
  - Docker 多阶段构建：生产镜像约 20MB，支持 docker-compose 部署
  - 预期性能提升 3-5x，内存占用降低 50%+

### Changed
- **Docker 配置切换到 Go 后端**：根目录 Dockerfile 和 docker-compose.yml 现在使用 Go 后端
  - 最终镜像基于 Alpine Linux，体积更小
  - 环境变量格式调整以匹配 Go 后端配置
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

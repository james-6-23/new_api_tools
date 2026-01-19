# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- **前端依赖激进升级**：将所有核心依赖升级到最新版本（方案 B）
  - **Vite**: 5.0.8 → 7.3.1（跨 2 个大版本）
  - **@vitejs/plugin-react**: 4.2.1 → 5.1.2
  - **Tailwind CSS**: 3.4.0 → 4.1.18（完全重写，配置从 JS 迁移到 CSS）
  - **ESLint**: 8.55.0 → 9.39.2（强制使用 Flat Config）
  - **TypeScript ESLint**: 6.14.0 → 8.53.0
  - **lucide-react**: 0.468.0 → 0.562.0
  - **tailwind-merge**: 2.6.0 → 3.4.0
  - **eslint-plugin-react-hooks**: 4.6.0 → 7.0.1
  - 删除 `tailwind.config.js` 和 `postcss.config.js`（Tailwind v4 不再需要）
  - 新增 `eslint.config.js`（ESLint 9 Flat Config 格式）
  - 新增 `@tailwindcss/vite` 插件集成
  - 修复 `src/index.css` 中的 `@apply` 指令兼容性（改用原生 CSS）
  - 修复代码中的 ESLint 错误和 TypeScript 类型问题
  - 性能提升：Tailwind 增量构建速度提升 100 倍，Vite 冷启动和热更新优化

### Added
- **统一用户名点击行为**：前端所有显示用户名的地方现在可点击查看用户行为分析
  - 新增共享组件 `UserAnalysisDialog.tsx`：统一的用户行为分析对话框
  - 新增类型定义 `types/user.ts`：共享的 UserAnalysis 接口和常量
  - 充值记录页面 (TopUps)：用户名可点击打开分析对话框
  - 仪表板页面 (Dashboard)：请求之王和土豪榜首排行榜用户名可点击
  - 兑换码管理页面 (Redemptions)：重构使用共享组件，减少约 250 行重复代码
  - 支持时间窗口切换 (1h/3h/6h/12h/24h/3d/7d)
  - 显示账户额度、风险标志、请求统计、模型偏好、IP 来源、最近轨迹

- **Uptime-Kuma 兼容 API**：新增与 Uptime-Kuma 格式兼容的模型状态监控端点（Python 和 Go 双版本）
  - Python: `backend/app/uptime_kuma_routes.py`
  - Go: `backend-go/internal/service/uptimekuma.go`, `backend-go/internal/handler/uptimekuma.go`
  - `/api/uptime-kuma/monitors` - 获取所有模型监控列表
  - `/api/uptime-kuma/monitors/{model_name}` - 获取单个模型详情及心跳数据
  - `/api/uptime-kuma/heartbeats/{model_name}` - 获取模型心跳历史
  - `/api/uptime-kuma/status-page` - 状态页面数据（支持筛选模型）
  - `/api/uptime-kuma/status-page/batch` - 批量获取指定模型的状态页数据
  - `/api/uptime-kuma/overall` - 整体状态摘要
  - `/api/uptime-kuma/push/{push_token}` - Push 监控兼容端点（仅兼容，状态从日志分析得出）
  - 状态映射（基于 success_rate）：
    - UP(1): success_rate ≥ 95% 或无请求
    - PENDING(2): 80% ≤ success_rate < 95%
    - DOWN(0): success_rate < 80%
  - 所有端点无需认证，支持时间窗口参数（1h/6h/12h/24h）

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

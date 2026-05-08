# NewAPI-Tool | NewAPI 增强管理工具

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Docker](https://img.shields.io/badge/docker-ready-blue.svg)

**NewAPI-Tool** 是一个专为 [NewAPI](https://github.com/QuantumNous/new-api) (One API 分支) 设计的现代化增强管理中间件。它通过直观的 Web 界面，补全了原版系统在数据可视化、充值记录审计、批量兑换码管理等方面的功能，帮助管理员更高效地运维系统。

## ✨ 核心特性

- **📊 可视化仪表盘 (Dashboard)**
  - **实时概览**：用户数、Token、渠道、模型、兑换码等关键指标一目了然。
  - **趋势分析**：基于 ECharts/Recharts 的每日请求量、活跃用户趋势图。
  - **排行统计**：请求之王、消费榜首等趣味统计。
  - **模型分布**：Top 8 活跃模型使用占比分析。

- **🎟️ 兑换码增强管理**
  - **批量生成**：支持自定义前缀、固定/随机额度、过期时间（天数/指定日期）。
  - **高级筛选**：按状态（未使用/已使用/过期）、日期范围、名称搜索。
  - **统计卡片**：顶部直观展示未使用、已使用、已过期的数量及总价值。
  - **批量操作**：一键复制、批量删除、软删除机制。

- **💰 充值记录审计**
  - **全量记录**：查看系统内所有用户的充值历史。
  - **财务统计**：统计成功、待处理、失败的充值笔数及总金额（CNY/USD）。
  - **支付分析**：支持按支付方式筛选，快速定位支付渠道状态。

- **🛡️ 安全与架构**
  - **独立认证**：拥有独立的管理后台登录机制，支持 JWT Session。
  - **零侵入性**：作为中间件运行，直接读取 NewAPI 数据库，不修改原版代码。
  - **多数据库支持**：完美支持 MySQL 和 PostgreSQL。

## 🚀 快速部署

### 方式一：一键脚本 (推荐)

如果您的 NewAPI 部署在 Linux 服务器上，可以使用一键脚本自动检测环境并部署。

```bash
bash <(curl -sSL https://raw.githubusercontent.com/james-6-23/new_api_tools/main/install.sh)
```

脚本功能：
1. 自动定位 NewAPI 安装目录
2. 自动读取数据库配置
3. 交互式设置管理员密码
4. 自动配置 Docker 网络并启动服务

### 方式二：Docker Compose 手动部署

适用于熟悉 Docker 的用户或非标准环境。

1. **下载项目**
   ```bash
   git clone https://github.com/james-6-23/new_api_tools.git
   cd new_api_tools
   ```

2. **配置环境变量**
   ```bash
   cp .env.example .env
   vim .env
   ```
   *请参考下方配置说明填写数据库信息。*

3. **启动服务**
   ```bash
   docker-compose up -d
   ```
   部署完成后访问：`http://your-server-ip:1145`

## ⚙️ 配置说明 (.env)

| 变量名 | 说明 | 示例/默认值 |
|--------|------|-------------|
| **基础配置** | | |
| `FRONTEND_PORT` | 服务访问端口 | `1145` |
| `ADMIN_PASSWORD` | 管理后台登录密码 | `123456` |
| `API_KEY` | 后端 API 密钥（可选） | - |
| `JWT_SECRET` | JWT 签名密钥 | `random_string` |
| `JWT_EXPIRE_HOURS` | JWT 过期时间（小时） | `24` |
| **数据库配置** | | |
| `DB_ENGINE` | 数据库类型 | `postgres` 或 `mysql` |
| `DB_DNS` | 数据库地址 (Docker网络名或IP) | `new-api-db` |
| `DB_PORT` | 数据库端口 | `5432` 或 `3306` |
| `DB_NAME` | 数据库名称 | `new-api` |
| `DB_USER` | 数据库用户名 | `postgres` |
| `DB_PASSWORD` | 数据库密码 | - |
| **Redis 缓存配置** | | |
| `REDIS_HOST` | Redis 服务地址 | `redis`（Docker内部） |
| `REDIS_PORT` | Redis 端口 | `6379` |
| `REDIS_PASSWORD` | Redis 密码（可选） | 留空或设置密码 |
| `REDIS_DB` | Redis 数据库编号 | `0` |
| **Docker配置** | | |
| `NEWAPI_NETWORK` | NewAPI 所在的 Docker 网络名称 | `new-api_default` |

### 联合违规广播接入

广播站独立部署在 `newapi-tool-AbuseHub/` 目录，默认使用 SQLite 和 `8888` 端口。Hub 管理员在 `/admin/` 创建命名密钥后，会得到一次性 `Secret`；密钥名称就是 NewAPI-Tool 侧的节点名称。

NewAPI-Tool 接入流程：

1. 进入前端「联合违规广播 → 接入状态」页，填写 Hub URL（推荐使用 `/v1/live` 后缀）、节点名称、密钥、拉取间隔，并勾选「启用拉取」后保存。
2. 配置变更立即生效，不需要重启后端进程。
3. 点击「连接 Hub」，Hub 收到心跳后会把该密钥激活为已连接节点。

之后 NewAPI-Tool 会定时拉取 `GET /v1/reports`，并把收到的通报写入本地 SQLite 缓存（`DATA_DIR/abuse-broadcast.db`），不修改 NewAPI 原有表结构。管理 API：

- `GET  /api/abuse-broadcast/status`
- `GET  /api/abuse-broadcast/settings`
- `PUT  /api/abuse-broadcast/settings`
- `POST /api/abuse-broadcast/connect`
- `POST /api/abuse-broadcast/sync`
- `GET  /api/abuse-broadcast/reports`

## 🛠️ 本地开发

### 后端 (Go)

```bash
cd backend
# 安装依赖
go mod download
# 启动开发服务器（默认端口 8000，可通过 SERVER_PORT 覆盖）
go run ./cmd/server
```

### 前端 (React/Vite)

```bash
cd frontend
npm install
# 启动开发服务器
npm run dev
```

## 🔗 API 端点

主要端点：
- `POST /api/auth/login`: 管理员登录
- `GET /api/dashboard/*`: 仪表盘数据聚合
- `GET /api/top-ups`: 充值记录查询
- `POST /api/redemptions/generate`: 生成兑换码
- `GET /api/redemptions/statistics`: 兑换码统计

## 🤝 贡献与支持

欢迎提交 Issue 和 Pull Request！

## 📄 License

MIT License

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=james-6-23/new_api_tools&type=Date)](https://star-history.com/#james-6-23/new_api_tools&Date)

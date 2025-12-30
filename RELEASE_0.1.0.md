# NewAPI Middleware Tool v0.1.0 发行说明

我们很高兴地宣布 **NewAPI Middleware Tool v0.1.0** 正式发布！该工具为 NewAPI 提供了一个全面的管理界面，具备高级分析、风控监控和高效的资源管理功能。

## 🌟 项目概述

NewAPI Middleware Tool 旨在简化 API 资源的日常管理。它提供关于流量、用户活动和系统健康状况的实时洞察，所有功能都集成在一个现代化、响应式的用户界面中。

## 🚀 核心功能

### 1. 交互式仪表盘 (Dashboard)
全面掌握平台的运行表现。仪表盘提供以下实时数据：
- **平台资源概览：** 用户总数、令牌总数、渠道数量及模型统计。
- **流量分析：** 请求数、额度消耗以及数据吞吐量。
- **每日趋势：** 通过交互式图表展示请求量和消耗随时间的变化趋势。
- **排行榜：** 实时识别高频用户和最受欢迎的模型。

![仪表盘](https://github.com/james-6-23/new_api_tools/raw/main/docs/images/dashboard.png)

### 2. 充值记录管理 (Top-Up Management)
轻松跟踪和管理用户的充值记录。
- **详细历史信息：** 查看所有充值交易及其状态（成功、待处理、失败）。
- **高级筛选：** 支持按状态、支付方式、日期范围或交易 ID 进行筛选。
- **财务概览：** 快速统计总充值笔数和总金额。

![充值记录](https://github.com/james-6-23/new_api_tools/raw/main/docs/images/topups.png)

### 3. 用户管理 (User Management)
高效管理系统用户及其状态。
- **用户画像：** 查看所有用户的角色、状态、额度及活跃度信息。
- **状态筛选：** 快速筛选活跃用户、不活跃用户及从未请求的僵尸用户。
- **快捷操作：** 支持直接删除用户或将其加入 AI 封禁白名单，便于精细化运营。
- **批量清理：** 提供一键清理长期不活跃用户的工具，优化系统资源。

![用户管理](https://github.com/james-6-23/new_api_tools/raw/main/docs/images/user_management.png)

### 4. 风控中心 (Risk Control Center)
利用强大的风险监控工具保护您的平台。风控中心分为几个专业模块：

#### 实时排行
根据请求次数、额度消耗或失败率等关键指标监控高风险用户。
- **多时间维度：** 支持查看过去 1小时、3小时、6小时、12小时或 24小时的数据。
- **快速响应：** 直接从列表中分析用户行为或对可疑用户执行封禁。

![实时排行](https://github.com/james-6-23/new_api_tools/raw/main/docs/images/risk_main.png)

#### IP 监控
跟踪基于 IP 的活动以检测滥用行为。
- **共享 IP 检测：** 识别多个令牌共用同一 IP 的情况，发现潜在的账号共享。
- **高风险 IP 分析：** 突出显示具有异常请求模式的 IP 地址。

![IP 监控](https://github.com/james-6-23/new_api_tools/raw/main/docs/images/risk_ip_monitor.png)

#### 封禁列表
管理系统的访问控制策略。
- **集中管理：** 查看并搜索所有已封禁的用户。
- **解封功能：** 在必要时可快速恢复用户的访问权限。

![封禁列表](https://github.com/james-6-23/new_api_tools/raw/main/docs/images/risk_ban_list.png)

#### AI 封禁与智能配置
利用自动化智能提升安全性。系统支持深度定制 AI 分析参数，以适配不同的业务场景：

- **智能配置：** 支持自定义 API 地址、密钥及模型选择。提供“试运行模式”以在正式执行封禁前进行风险评估，并支持从 15 分钟到 24 小时不等的定时自动扫描频率。
- **运行逻辑：** 系统基于特征筛选（请求量、IP 异常）、AI 模型深度研判（行为指纹分析）以及最终的决策执行（评分制封禁/告警）三个阶段进行工作。
- **提示词自定义：** 允许管理员自定义 AI 研判时的提示词，精细化控制风控标准。

![AI 封禁配置详情](https://github.com/james-6-23/new_api_tools/raw/main/docs/images/risk_ai_settings.png)
![AI 封禁运行逻辑](https://github.com/james-6-23/new_api_tools/raw/main/docs/images/risk_ai_config.png)

### 5. IP 地区分析 (IP Analysis)
深入了解全球访问分布。
- **地理分布可视化：** 通过世界地图直观展示流量来源。
- **精细化统计：** 统计独立 IP 数、总流量、国内/海外访问占比。
- **多维排名：** 提供国家/地区流量排名以及详细的中国省份流量分布。
- **异常提醒：** 自动监测海外流量占比，及时发现潜在的攻击或非法爬取风险。

![IP 地区分析](https://github.com/james-6-23/new_api_tools/raw/main/docs/images/ip_analysis.png)

### 6. 日志分析 (Log Analytics)
深入挖掘系统日志，发现潜在价值与问题。
- **请求数排行 Top 10：** 识别最活跃的用户，分析其使用习惯。
- **额度消耗排行 Top 10：** 找出高价值用户，优化运营策略。
- **模型统计：** 统计各模型的请求总量、成功率及空回复率，帮助判断模型稳定性与质量。

![日志分析](https://github.com/james-6-23/new_api_tools/raw/main/docs/images/analytics.png)

### 7. 模型状态监控 (Model Status Monitoring)
通过细粒度的健康指标确保 AI 模型运行在最佳状态。
- **实时成功率：** 查看每个模型的精确成功百分比（例如 99.97%）。
- **流量趋势：** 24 小时内的趋势图，展示每个模型的请求量波动。
- **状态分类：**
    -   🟢 **正常：** 成功率 ≥ 95%
    -   🟡 **警告：** 成功率 80-95%
    -   🔴 **异常：** 成功率 < 80%
- **自定义监控列表：** 支持从众多模型中灵活选择需要重点监控的核心模型，支持一键筛选和批量管理。

![模型选择](https://github.com/james-6-23/new_api_tools/raw/main/docs/images/model_status_select.png)

#### 嵌入式监控 (Embed Status)
支持通过 iframe 将模型状态监控页面嵌入到您的官方网站或状态页中。
- **公开访问：** 嵌入页面无需认证即可访问。
- **自动同步：** 主题、模型选择及刷新间隔会自动同步。
- **响应式设计：** 提供基础嵌入、16:9 响应式嵌入及全屏页面代码，完美适配各种终端。

![模型嵌入说明](https://github.com/james-6-23/new_api_tools/raw/main/docs/images/model_status_embed.png)

### 8. 兑换码生成器 (Generator)
高效生成和管理额度兑换码。
- **批量生成：** 一次性创建多个兑换码。
- **自定义选项：** 设置前缀、固定或随机额度，以及过期规则（永久、指定天数或指定日期）。

![生成器](https://github.com/james-6-23/new_api_tools/raw/main/docs/images/generator.png)

## 🚀 快速部署

### 方式一：一键脚本 (推荐)

如果您的 NewAPI 部署在 Linux 服务器上，可以使用一键脚本自动检测环境并部署。

```bash
bash <(curl -sSL https://raw.githubusercontent.com/james-6-23/new_api_tools/main/install.sh)
```

**脚本功能：**
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
   # 编辑 .env 文件并参考下方配置说明填写数据库信息
   ```

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

## 🛠️ 技术栈

- **前端：** React, TypeScript, Vite, Tailwind CSS, Shadcn UI, Recharts/ECharts.
- **后端：** Python (FastAPI/Flask), PostgreSQL.
- **部署：** 支持 Docker 一键部署。

---


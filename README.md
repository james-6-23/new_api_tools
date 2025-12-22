# NewAPI Middleware Tool

NewAPI 兑换码管理工具，提供批量生成、查询、删除兑换码的 Web 界面和 API。

## 功能特性

- 批量生成兑换码（支持固定/随机额度）
- 灵活的过期时间设置（永不过期/指定天数/指定日期）
- 兑换码查询、筛选、分页
- 支持 MySQL 和 PostgreSQL 数据库
- JWT 认证 + API Key 双重安全机制
- Docker 一键部署

## 快速开始

### 前置要求

- 运行中的 NewAPI 实例
- Docker 和 Docker Compose
- Git (仅手动安装需要)

### 方式一：一键安装 (推荐)

在服务器上运行以下命令，脚本会自动检测 NewAPI 位置并完成安装：

```bash
bash <(curl -sSL https://raw.githubusercontent.com/james-6-23/new_api_tools/main/install.sh)
```

脚本会自动：
1. 检测 NewAPI 安装目录
2. Clone 项目到 NewAPI 同级目录
3. 检测数据库配置
4. 交互式设置访问密码
5. 启动服务

### 方式二：手动 Clone 安装

```bash
# 1. 进入 NewAPI 所在目录 (与 new-api 同级)
cd /path/to/your/newapi-parent-dir

# 2. Clone 项目
git clone https://github.com/james-6-23/new_api_tools.git

# 3. 进入项目目录并运行部署脚本
cd new_api_tools
./deploy.sh
```

### 方式三：手动配置部署

```bash
# 1. Clone 项目
git clone https://github.com/james-6-23/new_api_tools.git
cd new_api_tools

# 2. 复制并编辑配置文件
cp .env.example .env
# 编辑 .env 填写数据库和认证配置

# 3. 启动服务
docker-compose up -d
```

部署完成后访问 `http://your-server:1145`

## 项目结构

```
├── backend/          # FastAPI 后端服务
├── frontend/         # React + TypeScript 前端
├── install.sh        # 快速安装脚本 (curl 远程执行)
├── deploy.sh         # 本地部署脚本
├── docker-compose.yml
└── .env.example      # 环境变量示例
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录获取 JWT Token |
| POST | `/api/redemptions/generate` | 批量生成兑换码 |
| GET | `/api/redemptions` | 查询兑换码列表 |
| DELETE | `/api/redemptions/{id}` | 删除单个兑换码 |
| DELETE | `/api/redemptions/batch` | 批量删除兑换码 |
| GET | `/api/health` | 健康检查 |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DB_ENGINE` | 数据库类型 (mysql/postgres) | postgres |
| `DB_DNS` | 数据库主机 | localhost |
| `DB_PORT` | 数据库端口 | 5432 |
| `DB_NAME` | 数据库名 | new-api |
| `DB_USER` | 数据库用户 | postgres |
| `DB_PASSWORD` | 数据库密码 | - |
| `ADMIN_PASSWORD` | 前端登录密码 | - |
| `API_KEY` | API 访问密钥 | - |
| `FRONTEND_PORT` | 前端端口 | 1145 |

## 本地开发

### 后端

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

## 技术栈

- 后端: Python 3.11+, FastAPI, SQLAlchemy 2.0
- 前端: React 18, TypeScript, Tailwind CSS, Vite
- 部署: Docker, Nginx

## License

MIT

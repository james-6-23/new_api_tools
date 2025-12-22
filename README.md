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

### 一键部署

```bash
./deploy.sh
```

脚本会自动：
1. 检测 NewAPI 容器和数据库配置
2. 交互式设置访问密码
3. 生成配置文件并启动服务

部署完成后访问 `http://your-server:1145`

### 手动部署

```bash
# 1. 复制并编辑配置文件
cp .env.example .env

# 2. 启动服务
docker-compose up -d
```

## 项目结构

```
├── backend/          # FastAPI 后端服务
├── frontend/         # React + TypeScript 前端
├── deploy.sh         # 一键部署脚本
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

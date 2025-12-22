# NewAPI Middleware Tool - Backend

FastAPI 后端服务，用于管理 NewAPI 兑换码的生成、查询和删除。

## 功能特性

- 支持 MySQL 和 PostgreSQL 数据库
- JWT 认证 + API Key 双重安全机制
- 批量生成兑换码（支持固定/随机额度）
- 灵活的过期时间设置（永不过期/指定天数/指定日期）
- 兑换码查询、筛选、分页
- 软删除支持

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录获取 JWT Token |
| POST | `/api/redemptions/generate` | 批量生成兑换码 |
| GET | `/api/redemptions` | 查询兑换码列表 |
| DELETE | `/api/redemptions/{id}` | 删除单个兑换码 |
| DELETE | `/api/redemptions/batch` | 批量删除兑换码 |
| GET | `/api/health` | 健康检查 |
| GET | `/api/health/db` | 数据库连接检查 |

## 本地开发

```bash
# 安装依赖 (使用 uv)
uv sync

# 配置环境变量
cp ../.env.example .env
# 编辑 .env 设置数据库连接信息

# 启动开发服务器
uv run uvicorn app.main:app --reload --port 8000
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DB_ENGINE` | 数据库类型 (mysql/postgres) | postgres |
| `DB_HOST` | 数据库主机 | localhost |
| `DB_PORT` | 数据库端口 | 5432 |
| `DB_NAME` | 数据库名 | new-api |
| `DB_USER` | 数据库用户 | postgres |
| `DB_PASSWORD` | 数据库密码 | - |
| `API_KEY` | API 访问密钥 | - |
| `ADMIN_PASSWORD` | 前端登录密码 | - |
| `JWT_SECRET` | JWT 签名密钥 | - |
| `JWT_EXPIRE_HOURS` | JWT 过期时间(小时) | 24 |

## Docker 构建

```bash
docker build -t newapi-tools-backend .
```

## 技术栈

- Python 3.11+
- FastAPI
- SQLAlchemy 2.0
- Pydantic v2
- python-jose (JWT)

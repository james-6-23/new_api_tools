# NewAPI 管理工具 - 快速开始指南

本指南将帮助您快速搭建和运行 NewAPI 管理后台。

## 📋 前置要求

### 方式一：本地开发
- Python 3.11+
- Node.js 18+
- PostgreSQL 15+
- Redis 7+

### 方式二：Docker（推荐）
- Docker 20.10+
- Docker Compose 2.0+

---

## 🚀 Docker 快速启动（推荐）

### 1. 克隆/准备项目

```bash
cd new_api_tools
```

### 2. 配置环境变量

编辑 `docker-compose.yml` 中的环境变量（可选）：
- 修改数据库密码
- 修改 SECRET_KEY

### 3. 启动所有服务

```bash
docker-compose up -d
```

### 4. 查看服务状态

```bash
docker-compose ps
```

### 5. 访问应用

- 前端页面: http://localhost
- API 文档: http://localhost/api/docs
- 健康检查: http://localhost/health

### 6. 查看日志

```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f backend
docker-compose logs -f frontend
```

### 7. 停止服务

```bash
docker-compose down

# 删除所有数据（包括数据库）
docker-compose down -v
```

---

## 💻 本地开发模式

### 第一步：启动数据库服务

#### PostgreSQL

```bash
# 使用 Docker 启动 PostgreSQL
docker run -d \
  --name newapi_db \
  -e POSTGRES_DB=newapi_db \
  -e POSTGRES_USER=newapi \
  -e POSTGRES_PASSWORD=password \
  -p 5432:5432 \
  postgres:15-alpine
```

#### Redis

```bash
# 使用 Docker 启动 Redis
docker run -d \
  --name newapi_redis \
  -p 6379:6379 \
  redis:7-alpine
```

### 第二步：启动后端

```bash
cd backend

# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 复制环境变量文件
cp .env.example .env

# 编辑 .env 文件，配置数据库连接等

# 启动后端服务
python -m app.main
```

后端将运行在 http://localhost:8000

### 第三步：启动前端

打开新终端：

```bash
cd frontend

# 安装依赖
npm install

# 复制环境变量文件
cp .env.example .env

# 启动开发服务器
npm run dev
```

前端将运行在 http://localhost:3000

---

## 🔧 开发工具

### 后端开发

#### 代码格式化

```bash
cd backend
black app/
```

#### 代码检查

```bash
flake8 app/
```

#### 运行测试

```bash
pytest
```

### 前端开发

#### 代码格式化

```bash
cd frontend
npm run format
```

#### 代码检查

```bash
npm run lint
```

#### 构建生产版本

```bash
npm run build
```

---

## 📊 数据库管理

### 使用 Alembic 进行数据库迁移

```bash
cd backend

# 创建迁移
alembic revision --autogenerate -m "description"

# 执行迁移
alembic upgrade head

# 回滚
alembic downgrade -1
```

### 直接连接数据库

```bash
# 使用 psql 连接
docker exec -it newapi_db psql -U newapi -d newapi_db

# 或使用任何 PostgreSQL 客户端
# Host: localhost
# Port: 5432
# Database: newapi_db
# User: newapi
# Password: password
```

---

## 🐛 常见问题

### 1. 端口冲突

如果端口被占用，修改 `docker-compose.yml` 中的端口映射：

```yaml
services:
  backend:
    ports:
      - "8001:8000"  # 改为其他端口
```

### 2. 数据库连接失败

检查 `.env` 文件中的 `DATABASE_URL` 是否正确：

```env
DATABASE_URL=postgresql+asyncpg://newapi:password@localhost:5432/newapi_db
```

### 3. Redis 连接失败

检查 Redis 服务是否运行：

```bash
docker ps | grep redis
# 或
redis-cli ping
```

### 4. 前端无法访问后端 API

检查前端 `.env` 文件中的 API 地址：

```env
VITE_API_BASE_URL=http://localhost:8000
```

### 5. Docker 构建失败

清理 Docker 缓存：

```bash
docker-compose down -v
docker system prune -af
docker-compose build --no-cache
docker-compose up -d
```

---

## 📚 下一步

1. 查看 [DESIGN.md](./DESIGN.md) 了解系统架构
2. 查看 [README.md](./README.md) 了解完整功能
3. 访问 http://localhost:8000/api/docs 查看 API 文档
4. 开始开发您的功能！

---

## 🆘 获取帮助

如遇到问题：

1. 查看日志文件
   - 后端: `backend/logs/app.log`
   - Docker: `docker-compose logs`

2. 检查服务状态
   - 后端健康检查: http://localhost:8000/health
   - 数据库连接: 使用 psql 测试

3. 提交 Issue 并附上：
   - 错误信息
   - 相关日志
   - 运行环境信息

---

**祝开发愉快！** 🎉



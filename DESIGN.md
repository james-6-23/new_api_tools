# NewAPI 管理工具集成方案

## 📋 项目概述

基于 NewAPI 系统开发一个现代化的管理后台，提供完整的 API 管理、监控、统计和配额管理功能。

### 技术栈

**前端：**
- React 18.x
- Berry Free React MUI Admin Template
- Material-UI (MUI) v5
- Redux Toolkit (状态管理)
- Recharts / ApexCharts (数据可视化)
- Axios (HTTP 客户端)
- React Router v6 (路由管理)

**后端：**
- Python 3.11+
- FastAPI (异步 Web 框架)
- Pydantic (数据验证)
- SQLAlchemy (ORM)
- Redis (缓存)
- Uvicorn (ASGI 服务器)

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                     前端应用层                           │
│  Berry React Template + Material-UI + Redux              │
│  ┌──────────┬──────────┬──────────┬──────────┐         │
│  │Dashboard │ Logs     │ Channels │ Users    │         │
│  │统计面板  │ 日志管理 │ 渠道管理 │ 用户管理 │         │
│  └──────────┴──────────┴──────────┴──────────┘         │
└─────────────────────────────────────────────────────────┘
                          ↕ REST API
┌─────────────────────────────────────────────────────────┐
│                   后端服务层 (FastAPI)                   │
│  ┌──────────────────────────────────────────────────┐  │
│  │  API 路由层                                       │  │
│  │  /api/dashboard, /api/logs, /api/channels, ...   │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  业务逻辑层                                       │  │
│  │  Statistics Service, Log Service, User Service   │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  数据访问层                                       │  │
│  │  SQLAlchemy Models + Repository Pattern          │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────┐
│              数据存储层                                  │
│  ┌──────────────┐    ┌──────────────┐                  │
│  │ PostgreSQL   │    │   Redis      │                  │
│  │ 主数据库     │    │   缓存       │                  │
│  └──────────────┘    └──────────────┘                  │
└─────────────────────────────────────────────────────────┘
```

---

## 📁 项目目录结构

```
new_api_tools/
├── backend/                        # Python 后端
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                # FastAPI 应用入口
│   │   ├── config.py              # 配置管理
│   │   ├── api/                   # API 路由
│   │   │   ├── __init__.py
│   │   │   ├── deps.py           # 依赖注入
│   │   │   └── v1/
│   │   │       ├── __init__.py
│   │   │       ├── dashboard.py  # 统计面板 API
│   │   │       ├── logs.py       # 日志管理 API
│   │   │       ├── channels.py   # 渠道管理 API
│   │   │       ├── tokens.py     # Token 管理 API
│   │   │       ├── users.py      # 用户管理 API
│   │   │       ├── redemptions.py # 兑换码管理 API
│   │   │       └── models.py     # 模型管理 API
│   │   ├── core/                  # 核心功能
│   │   │   ├── __init__.py
│   │   │   ├── security.py       # 认证授权
│   │   │   └── cache.py          # 缓存服务
│   │   ├── models/                # 数据模型
│   │   │   ├── __init__.py
│   │   │   ├── user.py
│   │   │   ├── token.py
│   │   │   ├── channel.py
│   │   │   ├── log.py
│   │   │   └── redemption.py
│   │   ├── schemas/               # Pydantic 模式
│   │   │   ├── __init__.py
│   │   │   ├── user.py
│   │   │   ├── token.py
│   │   │   ├── channel.py
│   │   │   ├── log.py
│   │   │   ├── dashboard.py
│   │   │   └── common.py
│   │   ├── services/              # 业务逻辑层
│   │   │   ├── __init__.py
│   │   │   ├── statistics.py    # 统计服务
│   │   │   ├── log_service.py   # 日志服务
│   │   │   ├── user_service.py  # 用户服务
│   │   │   └── quota_service.py # 配额服务
│   │   ├── db/                    # 数据库
│   │   │   ├── __init__.py
│   │   │   ├── session.py       # 数据库连接
│   │   │   └── init_db.py       # 数据库初始化
│   │   └── utils/                 # 工具函数
│   │       ├── __init__.py
│   │       └── logger.py
│   ├── tests/                     # 测试
│   ├── requirements.txt           # Python 依赖
│   └── .env.example              # 环境变量示例
│
├── frontend/                      # React 前端
│   ├── public/
│   ├── src/
│   │   ├── assets/               # 静态资源
│   │   ├── components/           # 通用组件
│   │   │   ├── cards/           # 卡片组件
│   │   │   ├── charts/          # 图表组件
│   │   │   └── tables/          # 表格组件
│   │   ├── layout/               # 布局组件
│   │   │   ├── MainLayout/
│   │   │   ├── Header/
│   │   │   └── Sidebar/
│   │   ├── pages/                # 页面
│   │   │   ├── Dashboard/       # 统计面板
│   │   │   │   ├── index.jsx
│   │   │   │   ├── QuotaChart.jsx
│   │   │   │   ├── UsageStats.jsx
│   │   │   │   └── RealtimeMonitor.jsx
│   │   │   ├── Logs/            # 日志管理
│   │   │   │   ├── index.jsx
│   │   │   │   ├── LogTable.jsx
│   │   │   │   └── LogFilter.jsx
│   │   │   ├── Channels/        # 渠道管理
│   │   │   │   ├── index.jsx
│   │   │   │   ├── ChannelList.jsx
│   │   │   │   └── ChannelForm.jsx
│   │   │   ├── Tokens/          # Token 管理
│   │   │   ├── Users/           # 用户管理
│   │   │   ├── Redemptions/     # 兑换码管理
│   │   │   └── Models/          # 模型配置
│   │   ├── store/                # Redux 状态管理
│   │   │   ├── index.js
│   │   │   ├── slices/
│   │   │   │   ├── authSlice.js
│   │   │   │   ├── dashboardSlice.js
│   │   │   │   ├── logSlice.js
│   │   │   │   └── themeSlice.js
│   │   │   └── api/
│   │   │       └── apiClient.js # Axios 配置
│   │   ├── services/             # API 服务
│   │   │   ├── authService.js
│   │   │   ├── dashboardService.js
│   │   │   ├── logService.js
│   │   │   └── channelService.js
│   │   ├── routes/               # 路由配置
│   │   │   ├── index.jsx
│   │   │   └── AuthGuard.jsx
│   │   ├── themes/               # 主题配置
│   │   ├── utils/                # 工具函数
│   │   ├── App.jsx
│   │   └── index.jsx
│   ├── package.json
│   └── .env.example
│
├── docker/                        # Docker 配置
│   ├── backend.Dockerfile
│   ├── frontend.Dockerfile
│   └── nginx.conf
├── docker-compose.yml
└── README.md
```

---

## 🎨 核心功能模块设计

### 1. Dashboard 统计面板

**功能点：**
- 实时统计数据展示
- Quota 配额使用图表（折线图、饼图）
- 今日/本周/本月使用趋势
- 热门模型排行
- 渠道使用分布
- 错误率监控
- Token 使用排行

**数据指标：**
```javascript
{
  overview: {
    totalRequests: number,
    successRate: number,
    totalQuota: number,
    activeUsers: number
  },
  quotaUsage: {
    labels: ['gemini-2.5-pro', 'claude-3.7-sonnet', ...],
    data: [26959, 63393, ...]
  },
  timeSeriesData: [{
    time: '2025-10-01 10:00',
    requests: 150,
    quota: 45000
  }],
  channelStats: [{
    id: 1,
    name: 'paid-pro',
    requests: 1234,
    quota: 567890
  }]
}
```

**可视化组件：**
- 总览卡片（Total Card）
- 折线图（Request Trend Chart）
- 饼图（Model Distribution Chart）
- 柱状图（Channel Comparison Chart）
- 实时滚动日志

---

### 2. Logs 日志管理

**功能点：**
- 日志列表展示（分页）
- 高级筛选（用户、模型、渠道、时间范围、状态）
- 日志详情查看
- 错误日志高亮
- 导出日志功能
- 实时日志流

**日志字段：**
```javascript
{
  id: number,
  user_id: number,
  username: string,
  token_name: string,
  model_name: string,
  type: number, // 2: 成功, 5: 错误
  content: string,
  quota: number,
  prompt_tokens: number,
  completion_tokens: number,
  use_time: number,
  is_stream: boolean,
  channel: number,
  channel_name: string,
  created_at: number,
  ip: string
}
```

**筛选条件：**
- 用户名搜索
- 模型选择（多选）
- 渠道选择（多选）
- 状态（成功/错误）
- 时间范围
- IP 地址

---

### 3. Channels 渠道管理

**功能点：**
- 渠道列表展示
- 添加/编辑/删除渠道
- 渠道状态管理（启用/禁用）
- 渠道优先级配置
- 渠道健康检查
- 渠道使用统计

**渠道数据结构：**
```javascript
{
  id: number,
  name: string,
  type: number, // 1: OpenAI, 24: Gemini, etc.
  key: string,
  base_url: string,
  models: string[],
  model_mapping: object,
  priority: number,
  weight: number,
  status: number, // 1: 启用, 2: 禁用
  test_time: number
}
```

---

### 4. Tokens 令牌管理

**功能点：**
- Token 列表展示
- 创建/删除 Token
- Token 使用统计
- 配额限制设置
- Token 过期管理
- Token 权限配置

---

### 5. Users 用户管理

**功能点：**
- 用户列表展示
- 用户详情查看
- 配额管理（充值/扣减）
- 用户分组管理
- 使用历史记录
- 权限管理

---

### 6. Redemptions 兑换码管理

**功能点：**
- 生成兑换码
- 兑换码列表
- 兑换记录
- 批量生成
- 过期管理

---

## 🔌 API 接口设计

### Dashboard API

```python
# GET /api/v1/dashboard/overview
# 获取总览数据
Response: {
  total_requests: int,
  success_rate: float,
  total_quota: int,
  active_users: int,
  today_requests: int,
  today_quota: int
}

# GET /api/v1/dashboard/quota-trend?range=7d
# 获取配额使用趋势
Response: {
  labels: List[str],  # 时间标签
  data: List[int]     # 配额数据
}

# GET /api/v1/dashboard/model-stats
# 获取模型使用统计
Response: List[{
  model_name: str,
  request_count: int,
  quota_used: int,
  success_rate: float
}]

# GET /api/v1/dashboard/channel-stats
# 获取渠道使用统计
Response: List[{
  channel_id: int,
  channel_name: str,
  request_count: int,
  quota_used: int
}]
```

### Logs API

```python
# GET /api/v1/logs?page=1&page_size=100&user_id=&model=&channel=&type=&start_time=&end_time=
# 获取日志列表
Response: {
  page: int,
  page_size: int,
  total: int,
  items: List[Log]
}

# GET /api/v1/logs/{log_id}
# 获取日志详情
Response: Log

# POST /api/v1/logs/export
# 导出日志
Request: {
  filters: dict,
  format: 'csv' | 'json'
}
Response: file
```

### Channels API

```python
# GET /api/v1/channels?page=1&page_size=50
# 获取渠道列表
Response: {
  page: int,
  total: int,
  items: List[Channel]
}

# POST /api/v1/channels
# 创建渠道
Request: {
  name: str,
  type: int,
  key: str,
  base_url: str,
  models: List[str],
  priority: int
}

# PUT /api/v1/channels/{channel_id}
# 更新渠道

# DELETE /api/v1/channels/{channel_id}
# 删除渠道

# POST /api/v1/channels/{channel_id}/test
# 测试渠道连接
Response: {
  success: bool,
  message: str,
  latency: int
}
```

### Tokens API

```python
# GET /api/v1/tokens?page=1&page_size=50
# 获取 Token 列表

# POST /api/v1/tokens
# 创建 Token
Request: {
  name: str,
  quota: int,
  expired_time: int,
  models: List[str],
  rate_limit: int
}

# DELETE /api/v1/tokens/{token_id}
# 删除 Token

# GET /api/v1/tokens/{token_id}/stats
# 获取 Token 使用统计
```

---

## 💾 数据库设计

### 核心表结构

```sql
-- 用户表
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role INTEGER DEFAULT 1,
    status INTEGER DEFAULT 1,
    group_name VARCHAR(50) DEFAULT 'default',
    quota INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Token 表
CREATE TABLE tokens (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    name VARCHAR(100),
    key VARCHAR(255) UNIQUE NOT NULL,
    status INTEGER DEFAULT 1,
    quota INTEGER DEFAULT 0,
    used_quota INTEGER DEFAULT 0,
    expired_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 渠道表
CREATE TABLE channels (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type INTEGER NOT NULL,
    key VARCHAR(255),
    base_url VARCHAR(255),
    models TEXT,
    model_mapping TEXT,
    priority INTEGER DEFAULT 0,
    weight INTEGER DEFAULT 100,
    status INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 日志表（优化索引）
CREATE TABLE logs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    token_id INTEGER,
    channel_id INTEGER,
    type INTEGER, -- 2: 成功, 5: 错误
    model_name VARCHAR(100),
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    quota INTEGER DEFAULT 0,
    content TEXT,
    use_time INTEGER DEFAULT 0,
    is_stream BOOLEAN DEFAULT FALSE,
    ip VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_user_id (user_id),
    INDEX idx_type (type),
    INDEX idx_created_at (created_at),
    INDEX idx_model (model_name)
);

-- 兑换码表
CREATE TABLE redemptions (
    id INTEGER PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100),
    quota INTEGER,
    count INTEGER,
    used_count INTEGER DEFAULT 0,
    expired_time TIMESTAMP,
    status INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🎯 开发计划

### Phase 1: 基础架构搭建（Week 1-2）

**后端：**
- [ ] FastAPI 项目初始化
- [ ] 数据库模型定义
- [ ] 基础 CRUD API 实现
- [ ] 认证授权中间件
- [ ] Redis 缓存集成

**前端：**
- [ ] Berry 模板集成
- [ ] 路由配置
- [ ] Redux 状态管理搭建
- [ ] API 客户端封装
- [ ] 主题配置（光暗模式）

### Phase 2: 核心功能开发（Week 3-5）

**Dashboard 模块：**
- [ ] 后端统计 API 实现
- [ ] 前端数据可视化组件
- [ ] 实时数据更新（WebSocket）
- [ ] 图表交互优化

**Logs 模块：**
- [ ] 日志列表 API
- [ ] 高级筛选功能
- [ ] 日志详情展示
- [ ] 导出功能实现

**Channels 模块：**
- [ ] 渠道 CRUD API
- [ ] 渠道健康检查
- [ ] 渠道配置表单
- [ ] 渠道统计展示

### Phase 3: 高级功能（Week 6-7）

**Token 管理：**
- [ ] Token 生成和管理
- [ ] Token 使用统计
- [ ] 配额限制

**User 管理：**
- [ ] 用户 CRUD
- [ ] 配额管理
- [ ] 用户统计

**Redemption 管理：**
- [ ] 兑换码生成
- [ ] 兑换记录
- [ ] 批量操作

### Phase 4: 优化与部署（Week 8）

- [ ] 性能优化
- [ ] 安全加固
- [ ] Docker 容器化
- [ ] CI/CD 配置
- [ ] 文档完善

---

## 🔐 安全考虑

1. **认证授权**
   - JWT Token 认证
   - RBAC 权限控制
   - Session 管理

2. **数据安全**
   - 敏感数据加密（API Key）
   - SQL 注入防护（ORM）
   - XSS 防护

3. **API 安全**
   - CORS 配置
   - Rate Limiting
   - Request 验证

---

## 🚀 部署方案

### Docker Compose 部署

```yaml
version: '3.8'
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/newapi
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - backend

  db:
    image: postgres:15
    environment:
      POSTGRES_DB: newapi
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./docker/nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - frontend
      - backend

volumes:
  postgres_data:
  redis_data:
```

---

## 📊 性能优化策略

1. **后端优化**
   - 数据库查询优化（索引、分页）
   - Redis 缓存热点数据
   - 异步任务处理（Celery）
   - 连接池管理

2. **前端优化**
   - 代码分割（React.lazy）
   - 虚拟滚动（大列表）
   - 图片懒加载
   - 打包优化（Tree Shaking）

3. **网络优化**
   - CDN 加速
   - Gzip 压缩
   - HTTP/2
   - 接口聚合

---

## 📝 开发规范

### 代码风格

**Python：**
- PEP 8
- Black 格式化
- Flake8 检查

**JavaScript/React：**
- ESLint + Prettier
- Airbnb Style Guide
- PropTypes 类型检查

### Git 工作流

- `main`: 生产环境
- `develop`: 开发分支
- `feature/*`: 功能分支
- `hotfix/*`: 紧急修复

### 提交规范

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式调整
refactor: 代码重构
test: 测试相关
chore: 构建/工具相关
```

---

## 🎓 技术文档参考

- [Berry React Template](https://github.com/codedthemes/berry-free-react-admin-template)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Material-UI](https://mui.com/)
- [Redux Toolkit](https://redux-toolkit.js.org/)
- [SQLAlchemy](https://www.sqlalchemy.org/)

---

## 📞 总结

本方案提供了一个完整的 NewAPI 管理工具解决方案，包括：

✅ 清晰的技术栈选型
✅ 详细的目录结构
✅ 完整的功能模块设计
✅ RESTful API 接口定义
✅ 数据库设计
✅ 分阶段开发计划
✅ 安全与部署方案

该方案可以直接作为开发蓝图，支持快速迭代和扩展。


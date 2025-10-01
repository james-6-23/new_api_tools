# NewAPI 管理工具

一个现代化的 NewAPI 管理后台系统，提供完整的 API 管理、监控、统计和配额管理功能。

## 📚 技术栈

### 后端
- **框架**: FastAPI (Python 3.11+)
- **数据库**: PostgreSQL + SQLAlchemy
- **缓存**: Redis
- **认证**: JWT
- **服务器**: Uvicorn

### 前端
- **框架**: React 18
- **UI 库**: Material-UI v5
- **状态管理**: Redux Toolkit
- **图表库**: Recharts / ApexCharts
- **构建工具**: Vite
- **模板**: Berry Free React Admin Template

## 🚀 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+
- PostgreSQL 15+
- Redis 7+

### 后端设置

1. 进入后端目录：
```bash
cd backend
```

2. 创建虚拟环境并激活：
```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
# 或
venv\Scripts\activate  # Windows
```

3. 安装依赖：
```bash
pip install -r requirements.txt
```

4. 配置环境变量：
```bash
cp .env.example .env
# 编辑 .env 文件，配置数据库和其他参数
```

5. 初始化数据库：
```bash
# TODO: 添加数据库迁移命令
```

6. 启动后端服务：
```bash
python -m app.main
# 或使用 uvicorn
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

后端服务将运行在 http://localhost:8000
- API 文档: http://localhost:8000/api/docs
- ReDoc: http://localhost:8000/api/redoc

### 前端设置

1. 进入前端目录：
```bash
cd frontend
```

2. 安装依赖：
```bash
npm install
# 或使用 yarn
yarn install
```

3. 配置环境变量：
```bash
cp .env.example .env
# 编辑 .env 文件，配置 API 地址
```

4. 启动开发服务器：
```bash
npm run dev
# 或
yarn dev
```

前端服务将运行在 http://localhost:3000

## 🐳 Docker 部署

使用 Docker Compose 一键部署：

```bash
docker-compose up -d
```

服务访问：
- 前端: http://localhost
- 后端 API: http://localhost/api
- API 文档: http://localhost/api/docs

## 📖 功能模块

### 1. Dashboard 统计面板
- ✅ 实时统计数据展示
- ✅ 配额使用趋势图表
- ✅ 模型使用排行
- ✅ 渠道使用分布
- ✅ 错误率监控
- ✅ 用户排行榜

### 2. Logs 日志管理
- ✅ 日志列表分页
- ✅ 高级筛选功能
- ✅ 日志详情查看
- ✅ 错误日志高亮
- ✅ 日志导出

### 3. Channels 渠道管理
- ✅ 渠道 CRUD 操作
- ✅ 渠道状态管理
- ✅ 渠道健康检查
- ✅ 渠道使用统计

### 4. Tokens 令牌管理
- ✅ Token 创建和删除
- ✅ Token 使用统计
- ✅ 配额限制设置
- ✅ 权限配置

### 5. Users 用户管理
- ✅ 用户列表展示
- ✅ 配额管理
- ✅ 用户分组
- ✅ 使用历史

### 6. Redemptions 兑换码管理
- ✅ 生成兑换码
- ✅ 兑换记录查询
- ✅ 批量操作
- ✅ 过期管理

## 📁 项目结构

```
new_api_tools/
├── backend/          # Python 后端
│   ├── app/
│   │   ├── api/     # API 路由
│   │   ├── core/    # 核心功能
│   │   ├── models/  # 数据模型
│   │   ├── schemas/ # Pydantic 模式
│   │   ├── services/# 业务逻辑
│   │   └── utils/   # 工具函数
│   └── tests/       # 测试
├── frontend/         # React 前端
│   └── src/
│       ├── components/  # 通用组件
│       ├── pages/      # 页面
│       ├── services/   # API 服务
│       ├── store/      # Redux 状态
│       └── utils/      # 工具函数
└── docker/          # Docker 配置
```

详细架构设计请参考 [DESIGN.md](./DESIGN.md)

## 🔧 开发指南

### 代码规范

**Python:**
- 遵循 PEP 8
- 使用 Black 格式化
- 使用 Flake8 检查

**JavaScript/React:**
- ESLint + Prettier
- Airbnb Style Guide

### Git 提交规范

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式
refactor: 代码重构
test: 测试相关
chore: 构建/工具
```

## 📝 API 文档

API 文档在开发模式下可通过以下地址访问：
- Swagger UI: http://localhost:8000/api/docs
- ReDoc: http://localhost:8000/api/redoc

## 🤝 贡献指南

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'feat: Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证

## 🙏 致谢

- [Berry React Template](https://github.com/codedthemes/berry-free-react-admin-template)
- [FastAPI](https://fastapi.tiangolo.com/)
- [Material-UI](https://mui.com/)

## 📧 联系方式

如有问题或建议，请提交 Issue 或 PR。

---

**注意**: 这是一个开发中的项目，某些功能可能尚未完全实现。



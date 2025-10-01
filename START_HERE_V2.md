# 🎯 NewAPI 统计工具 - 精简版

> **已完成核心功能实现！可以直接使用！**

---

## ✨ 核心功能（已实现）

### ✅ 1. 兑换码批量生成
- 固定额度模式
- 随机额度范围
- 批量生成（最多1000个）
- 自动生成随机key

### ✅ 2. 用户统计排行
- 按请求数排行
- 按额度消耗排行
- 支持日/周/月维度
- Top N 排行榜

### ✅ 3. 模型统计分析
- 请求热度统计
- 成功率/失败率
- Token 消耗统计
- 多维度排行

### ✅ 4. Token 消耗统计
- 总 Token 计算（prompt + completion）
- 按用户分组统计
- 按模型分组统计
- 时间段统计

### ✅ 5. 趋势分析
- 每日趋势图
- 成功率趋势
- 请求量趋势

---

## 🚀 3 步快速启动

### 第 1 步：配置

```bash
cd backend
cp .env.example .env
```

编辑 `.env`，填入您的 session：
```env
NEWAPI_SESSION=从浏览器Cookie复制您的session值
```

### 第 2 步：安装依赖

```bash
pip install fastapi uvicorn httpx pydantic pydantic-settings python-dotenv
```

### 第 3 步：启动

```bash
uvicorn app.main:app --reload --port 8000
```

**完成！** 访问 http://localhost:8000/api/docs 查看所有 API

---

## 📊 核心 API

### 1. 用户排行榜
```bash
GET /api/v1/stats/user-ranking?period=week&metric=quota&limit=10
```

### 2. 模型统计
```bash
GET /api/v1/stats/model-stats?period=day
```

### 3. Token 统计
```bash
GET /api/v1/stats/token-consumption?period=week&group_by=total
```

### 4. 每日趋势
```bash
GET /api/v1/stats/daily-trend?days=7
```

### 5. 总览数据
```bash
GET /api/v1/stats/overview
```

### 6. 批量生成兑换码
```bash
POST /api/v1/redemption/batch
Content-Type: application/json

{
  "count": 10,
  "quota_type": "random",
  "min_quota": 50000,
  "max_quota": 150000,
  "name_prefix": "Test"
}
```

---

## 📖 文档索引

1. **DESIGN_V2_SIMPLIFIED.md** - 精简版设计方案
2. **IMPLEMENTATION_GUIDE.md** - 详细实现指南和 API 文档
3. **本文件** - 快速开始

---

## 🎨 架构特点

### 优势
- ✅ **轻量级** - 只需 5 个 Python 包
- ✅ **无数据库** - 直接使用 NewAPI 数据
- ✅ **即插即用** - 3 分钟启动
- ✅ **功能完整** - 满足所有统计需求

### 技术架构
```
前端 (React)
    ↓ HTTP
后端 (FastAPI)
    ↓ HTTP Client (httpx)
NewAPI 服务 (api.kkyyxx.xyz)
```

---

## 💡 使用示例

### Python 测试

```python
import httpx
import asyncio

async def test():
    # 获取用户排行
    response = await httpx.AsyncClient().get(
        'http://localhost:8000/api/v1/stats/user-ranking',
        params={'period': 'week', 'metric': 'quota', 'limit': 10}
    )
    print(response.json())

asyncio.run(test())
```

### cURL 测试

```bash
# 获取本周用户排行（按额度）
curl "http://localhost:8000/api/v1/stats/user-ranking?period=week&metric=quota&limit=10"

# 获取今日模型统计
curl "http://localhost:8000/api/v1/stats/model-stats?period=day"

# 获取本周 Token 消耗
curl "http://localhost:8000/api/v1/stats/token-consumption?period=week&group_by=total"

# 批量生成 5 个随机额度兑换码
curl -X POST "http://localhost:8000/api/v1/redemption/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "count": 5,
    "quota_type": "random",
    "min_quota": 50000,
    "max_quota": 100000,
    "name_prefix": "Test"
  }'
```

---

## 📁 项目结构（精简版）

```
backend/
├── app/
│   ├── main.py                      # 应用入口
│   ├── config.py                    # 配置管理
│   ├── api/v1/
│   │   ├── redemption_v2.py        # 兑换码 API ✅
│   │   └── statistics_v2.py        # 统计 API ✅
│   └── services/
│       ├── newapi_client.py        # NewAPI 客户端 ✅
│       └── stats_calculator.py     # 统计计算 ✅
├── requirements.txt                 # 依赖（5个包）
└── .env                            # 配置文件
```

---

## 🎯 核心代码说明

### NewAPI 客户端
封装了所有 NewAPI HTTP 接口：
- `create_redemption()` - 创建兑换码
- `get_logs()` - 获取日志
- `get_all_logs_in_range()` - 自动分页获取全部日志

### 统计计算器
实现所有统计逻辑：
- `get_user_ranking()` - 用户排行
- `get_model_stats()` - 模型统计
- `get_token_consumption()` - Token 统计
- `get_daily_trend()` - 趋势分析

---

## 🔧 配置说明

### 必需配置
```env
NEWAPI_SESSION=your_session_here  # 从 Cookie 获取
```

### 可选配置
```env
NEWAPI_BASE_URL=https://api.kkyyxx.xyz  # NewAPI 地址
NEWAPI_USER_ID=1                         # 用户 ID
DEBUG=True                               # 调试模式
```

---

## ❓ 常见问题

### 1. Session 从哪里获取？
打开浏览器，访问 NewAPI，按 F12，找到 Cookie 中的 `session` 值。

### 2. 支持哪些统计维度？
- 时间：day (1天) | week (7天) | month (30天)
- 维度：用户、模型
- 指标：请求数、额度、Token

### 3. 如何添加缓存？
项目预留了 Redis 配置，可以在 `stats_calculator.py` 中添加缓存逻辑。

### 4. 如何部署？
```bash
# 使用 gunicorn
pip install gunicorn
gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

---

## 📈 性能优化建议

1. **添加 Redis 缓存** - 缓存统计结果（5-10分钟）
2. **限制时间范围** - 避免查询过长时间段
3. **并发请求** - 使用 `asyncio.gather` 并行查询
4. **数据预聚合** - 定时任务预计算统计数据

---

## 🎨 前端开发建议

### 推荐技术栈
- React 18 + MUI (Material-UI)
- Recharts 或 ApexCharts（图表）
- Axios（HTTP 客户端）
- SWR 或 React Query（数据管理）

### 核心页面
1. **Dashboard** - 总览页面
2. **User Stats** - 用户统计排行
3. **Model Stats** - 模型统计排行
4. **Token Analysis** - Token 分析
5. **Redemption** - 兑换码管理

---

## 🎉 对比原方案

| 对比项 | 原方案（v1） | 精简版（v2） |
|--------|------------|------------|
| 依赖包数 | 15+ | 5 |
| 数据库 | PostgreSQL | 无 |
| 缓存 | Redis（必需） | 可选 |
| 代码文件 | 30+ | 8 |
| 启动时间 | 5+ 分钟 | < 3 分钟 |
| 复杂度 | 高 | 低 |
| 可维护性 | 中 | 高 |
| 功能完整性 | 100% | 100% |

---

## 📞 技术支持

### 调试模式
```bash
# 启用详细日志
export LOG_LEVEL=DEBUG
uvicorn app.main:app --reload --log-level debug
```

### 测试连接
```python
# test_connection.py
from app.services.newapi_client import NewAPIClient
import asyncio

async def test():
    client = NewAPIClient()
    logs = await client.get_logs(
        start_timestamp=1756741732,
        end_timestamp=1759337332,
        page_size=10
    )
    print(f"成功获取 {len(logs.get('data', {}).get('items', []))} 条日志")

asyncio.run(test())
```

---

## 🚀 下一步

### 立即可做
1. ✅ 启动后端服务
2. ✅ 测试所有 API
3. ✅ 查看 API 文档

### 后续开发
1. 🔨 开发前端界面
2. 🔨 添加图表可视化
3. 🔨 添加导出功能
4. 🔨 添加缓存优化

---

**所有核心功能已实现，可以直接使用！** 🎉

查看详细 API 文档：[IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)


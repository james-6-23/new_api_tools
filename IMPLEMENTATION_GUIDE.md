# NewAPI 工具实现指南

## 🚀 立即开始

### 1. 配置 NewAPI 认证

```bash
cd backend
cp .env.example .env
```

编辑 `.env` 文件，填入您的 session cookie：

```env
NEWAPI_SESSION=MTc1OTIyNzE3OHxEWDhFQVFMX2dBQUJFQUVRQUFEX2pmLUFBQVVHYzNSeWFXNW5EQW9BQ0hWelpYSnVZVzFsQm5OMGNtbHVad3dGQUFOcmVYZ0djM1J5YVc1bkRBWUFCSEp2YkdVRGFXNTBCQU1BXzhnR2MzUnlhVzVuREFnQUJuTjBZWFIxY3dOcGJuUUVBZ0FDQm5OMGNtbHVad3dIQUFWbmNtOTFjQVp6ZEhKcGJtY01DUUFIWkdWbVlYVnNkQVp6ZEhKcGJtY01CQUFDYVdRRGFXNTBCQUlBQWc9PXyqhPfvyFuOVoKNDwbcRAgiCR6v-BDC23V7Os3SiI7hng==
```

> 从浏览器的 Cookie 中获取 session 值

### 2. 安装并启动后端

```bash
# 安装依赖（只需5个包）
pip install fastapi uvicorn httpx pydantic pydantic-settings python-dotenv

# 启动服务
uvicorn app.main:app --reload --port 8000
```

访问 API 文档: http://localhost:8000/api/docs

### 3. 测试 API

```bash
# 测试用户排行
curl "http://localhost:8000/api/v1/stats/user-ranking?period=week&metric=quota&limit=10"

# 测试模型统计
curl "http://localhost:8000/api/v1/stats/model-stats?period=day"

# 测试 Token 统计
curl "http://localhost:8000/api/v1/stats/token-consumption?period=week&group_by=total"

# 测试批量生成兑换码
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

## 📊 API 接口说明

### 1. 用户统计 API

#### GET `/api/v1/stats/user-ranking`

获取用户排行榜

**参数:**
- `metric`: `requests` | `quota` (排序指标)
- `period`: `day` | `week` | `month` (时间范围)
- `limit`: 1-100 (返回数量)

**响应示例:**
```json
{
  "success": true,
  "period": "week",
  "metric": "quota",
  "count": 10,
  "ranking": [
    {
      "rank": 1,
      "username": "linuxdo_326",
      "user_id": 326,
      "requests": 1250,
      "quota": 567890,
      "success_requests": 1200,
      "failed_requests": 50
    }
  ]
}
```

### 2. 模型统计 API

#### GET `/api/v1/stats/model-stats`

获取模型请求热度和成功率

**参数:**
- `period`: `day` | `week` | `month`

**响应示例:**
```json
{
  "success": true,
  "period": "day",
  "count": 15,
  "models": [
    {
      "rank": 1,
      "model_name": "gemini-2.5-pro",
      "total_requests": 5678,
      "success_requests": 5500,
      "failed_requests": 178,
      "success_rate": 96.87,
      "total_quota": 1234567,
      "total_tokens": 987654,
      "prompt_tokens": 456789,
      "completion_tokens": 530865
    }
  ]
}
```

### 3. Token 统计 API

#### GET `/api/v1/stats/token-consumption`

获取 Token 消耗统计

**参数:**
- `period`: `day` | `week` | `month`
- `group_by`: `total` | `user` | `model`

**响应示例（total）:**
```json
{
  "success": true,
  "period": "week",
  "total_requests": 50000,
  "total_prompt_tokens": 2500000,
  "total_completion_tokens": 3500000,
  "total_tokens": 6000000,
  "total_quota": 12000000,
  "start_time": "2025-09-24T10:00:00",
  "end_time": "2025-10-01T10:00:00"
}
```

**响应示例（user）:**
```json
{
  "success": true,
  "period": "week",
  "group_by": "user",
  "data": [
    {
      "username": "linuxdo_326",
      "prompt_tokens": 500000,
      "completion_tokens": 700000,
      "total_tokens": 1200000,
      "requests": 5000,
      "quota": 2400000
    }
  ]
}
```

### 4. 趋势统计 API

#### GET `/api/v1/stats/daily-trend`

获取每日趋势数据

**参数:**
- `days`: 1-90 (天数)

**响应示例:**
```json
{
  "success": true,
  "days": 7,
  "data": [
    {
      "date": "2025-09-25",
      "requests": 7500,
      "quota": 1800000,
      "prompt_tokens": 350000,
      "completion_tokens": 450000,
      "total_tokens": 800000,
      "success_requests": 7200,
      "failed_requests": 300,
      "success_rate": 96.0
    }
  ]
}
```

### 5. 总览 API

#### GET `/api/v1/stats/overview`

获取总览数据（今日、本周、本月）

**响应示例:**
```json
{
  "success": true,
  "today": {
    "requests": 8500,
    "quota": 2100000,
    "tokens": 1050000
  },
  "week": {
    "requests": 50000,
    "quota": 12000000,
    "tokens": 6000000
  },
  "month": {
    "requests": 200000,
    "quota": 48000000,
    "tokens": 24000000
  },
  "top_users": [...],
  "top_models": [...]
}
```

### 6. 兑换码 API

#### POST `/api/v1/redemption/batch`

批量生成兑换码

**请求体:**
```json
{
  "count": 10,
  "quota_type": "random",
  "min_quota": 50000,
  "max_quota": 150000,
  "expired_time": 0,
  "name_prefix": "Redemption"
}
```

或固定额度：
```json
{
  "count": 10,
  "quota_type": "fixed",
  "fixed_quota": 100000,
  "expired_time": 0,
  "name_prefix": "Redemption"
}
```

**响应示例:**
```json
{
  "success": true,
  "total": 10,
  "created": 10,
  "failed": 0,
  "redemptions": [
    {
      "name": "Redemption_0001",
      "key": "aB3dE5fG7hI9jK2l",
      "quota": 87650,
      "result": {...}
    }
  ]
}
```

#### GET `/api/v1/redemption/list`

获取兑换码列表

**参数:**
- `page`: 页码
- `page_size`: 每页数量

---

## 🎨 前端集成示例

### React Hooks 示例

```jsx
// services/api.js
import axios from 'axios';

const API_BASE = 'http://localhost:8000/api/v1';

export const statsAPI = {
  getUserRanking: (metric, period, limit) =>
    axios.get(`${API_BASE}/stats/user-ranking`, {
      params: { metric, period, limit }
    }),
  
  getModelStats: (period) =>
    axios.get(`${API_BASE}/stats/model-stats`, {
      params: { period }
    }),
  
  getTokenConsumption: (period, group_by) =>
    axios.get(`${API_BASE}/stats/token-consumption`, {
      params: { period, group_by }
    }),
  
  getDailyTrend: (days) =>
    axios.get(`${API_BASE}/stats/daily-trend`, {
      params: { days }
    }),
  
  getOverview: () =>
    axios.get(`${API_BASE}/stats/overview`)
};

export const redemptionAPI = {
  createBatch: (data) =>
    axios.post(`${API_BASE}/redemption/batch`, data),
  
  getList: (page, page_size) =>
    axios.get(`${API_BASE}/redemption/list`, {
      params: { page, page_size }
    })
};
```

### 使用示例

```jsx
import React, { useState, useEffect } from 'react';
import { statsAPI } from './services/api';

function UserRanking() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const response = await statsAPI.getUserRanking('quota', 'week', 10);
      setData(response.data.ranking);
    } catch (error) {
      console.error('Failed to load:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h2>用户排行榜（本周额度消耗）</h2>
      <table>
        <thead>
          <tr>
            <th>排名</th>
            <th>用户名</th>
            <th>请求数</th>
            <th>额度消耗</th>
            <th>成功率</th>
          </tr>
        </thead>
        <tbody>
          {data.map(user => (
            <tr key={user.username}>
              <td>{user.rank}</td>
              <td>{user.username}</td>
              <td>{user.requests}</td>
              <td>{user.quota.toLocaleString()}</td>
              <td>
                {(user.success_requests / user.requests * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

## 🔍 调试技巧

### 1. 检查 NewAPI 连接

```python
# 在 Python 环境中测试
from app.services.newapi_client import NewAPIClient
import asyncio

async def test():
    client = NewAPIClient()
    result = await client.get_logs(
        start_timestamp=1756741732,
        end_timestamp=1759337332,
        page_size=10
    )
    print(result)

asyncio.run(test())
```

### 2. 查看详细日志

在 `main.py` 中启用调试日志：

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

### 3. API 文档测试

访问 http://localhost:8000/api/docs 使用 Swagger UI 交互式测试 API

---

## 📝 注意事项

1. **Session 过期**: NewAPI 的 session 会过期，需要定期更新 `.env` 文件中的 `NEWAPI_SESSION`

2. **请求限制**: 批量获取日志时，单次最多 1000 条，会自动分页获取全部数据

3. **性能优化**: 对于大量数据，建议：
   - 添加 Redis 缓存
   - 限制时间范围
   - 使用异步并发

4. **错误处理**: 所有 API 都有异常处理，失败会返回 500 错误和详细信息

---

## 🎯 下一步

1. ✅ 后端已完成核心功能
2. 🚧 前端界面开发（使用 React + MUI）
3. 🚧 添加图表可视化（Recharts）
4. 🚧 添加导出功能
5. 🚧 优化性能（添加缓存）

---

**现在就可以使用后端 API 了！** 🚀


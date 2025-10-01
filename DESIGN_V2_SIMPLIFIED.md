# NewAPI 管理工具 - 精简版设计方案 v2.0

> 基于真实 NewAPI 接口的轻量级管理工具

---

## 🎯 核心功能（仅保留必要功能）

### 1. 兑换码管理
- ✅ 批量生成兑换码
- ✅ 自定义固定额度
- ✅ 随机额度范围设置
- ✅ 兑换码列表查看

### 2. 用户统计分析
- ✅ 日/周/月用户请求排行
- ✅ 日/周/月用户额度消耗排行
- ✅ Top N 用户展示

### 3. 模型统计分析
- ✅ 每日模型请求热度
- ✅ 模型成功率/失败率统计
- ✅ 日/周/月模型排行榜
- ✅ 趋势图表展示

### 4. Token 消耗统计
- ✅ 总 Token 消耗（prompt + completion）
- ✅ 按时间段统计
- ✅ 按用户/模型维度统计

---

## 🏗️ 简化架构

```
前端 (React + MUI)
    ↓ HTTP
后端中间层 (FastAPI)
    ↓ HTTP
NewAPI 服务器 (api.kkyyxx.xyz)
```

**说明**：
- 后端只做**数据聚合和统计计算**
- 不需要自己的数据库（可选 Redis 缓存）
- 直接调用现有 NewAPI 接口

---

## 📡 真实 API 接口映射

### 已知的 NewAPI 接口

```python
# 1. 添加兑换码
POST /api/redemption/
Headers: {
    'New-Api-User': '1',
    'Cookie': 'session=xxx',
    'Content-Type': 'application/json'
}
Body: {
    "quota": 100000,
    "count": 1,           # 生成数量
    "expired_time": 0,    # 过期时间
    "name": "Test",
    "key": "xxx"          # 自定义 key
}

# 2. 获取使用数据（统计）
GET /api/data/?username=&start_timestamp=xxx&end_timestamp=xxx&default_time=week
Headers: {
    'Cookie': 'session=xxx',
    'new-api-user': '1'
}

# 3. 获取兑换码列表
GET /api/redemption/?p=2&page_size=50
Headers: {
    'Cookie': 'session=xxx',
    'new-api-user': '1'
}

# 4. 获取日志
GET /api/log/?p=1&page_size=1000&type=0&username=&token_name=&model_name=&start_timestamp=xxx&end_timestamp=xxx&channel=&group=
Headers: {
    'Cookie': 'session=xxx',
    'new-api-user': '1'
}
```

---

## 📁 精简后的项目结构

```
new_api_tools/
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI 入口
│   │   ├── config.py                  # 配置（NewAPI 地址、认证）
│   │   ├── api/
│   │   │   ├── redemption.py         # 兑换码管理
│   │   │   ├── statistics.py         # 统计分析
│   │   │   └── user_stats.py         # 用户统计
│   │   ├── services/
│   │   │   ├── newapi_client.py      # NewAPI 客户端封装
│   │   │   ├── stats_calculator.py   # 统计计算逻辑
│   │   │   └── cache_service.py      # 缓存服务（可选）
│   │   └── schemas/
│   │       ├── redemption.py         # 兑换码模式
│   │       └── statistics.py         # 统计模式
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Redemption/           # 兑换码管理页面
│   │   │   ├── UserStats/            # 用户统计页面
│   │   │   ├── ModelStats/           # 模型统计页面
│   │   │   └── TokenStats/           # Token 统计页面
│   │   ├── components/
│   │   │   ├── RankingTable.jsx      # 排行榜表格
│   │   │   ├── TrendChart.jsx        # 趋势图表
│   │   │   └── StatCard.jsx          # 统计卡片
│   │   └── services/
│   │       └── api.js                # API 服务
│   └── package.json
│
└── docker-compose.yml                 # 简化的 Docker 配置
```

---

## 🔧 核心实现

### 1. 兑换码管理

#### 后端 API

```python
# backend/app/api/redemption.py

from fastapi import APIRouter, HTTPException
from app.services.newapi_client import NewAPIClient
from app.schemas.redemption import BatchRedemptionCreate
import random
import string

router = APIRouter()

@router.post("/batch")
async def create_batch_redemptions(request: BatchRedemptionCreate):
    """
    批量生成兑换码
    
    参数：
    - count: 生成数量
    - quota_type: 'fixed' | 'random'
    - fixed_quota: 固定额度（quota_type=fixed 时）
    - min_quota: 最小额度（quota_type=random 时）
    - max_quota: 最大额度（quota_type=random 时）
    - expired_time: 过期时间戳
    - name_prefix: 名称前缀
    """
    client = NewAPIClient()
    results = []
    
    for i in range(request.count):
        # 计算额度
        if request.quota_type == 'fixed':
            quota = request.fixed_quota
        else:
            quota = random.randint(request.min_quota, request.max_quota)
        
        # 生成随机 key
        key = ''.join(random.choices(string.ascii_letters + string.digits, k=16))
        
        # 调用 NewAPI 创建兑换码
        result = await client.create_redemption(
            quota=quota,
            count=1,
            expired_time=request.expired_time,
            name=f"{request.name_prefix}_{i+1}",
            key=key
        )
        results.append(result)
    
    return {
        "success": True,
        "count": len(results),
        "redemptions": results
    }


@router.get("/list")
async def get_redemption_list(page: int = 1, page_size: int = 50):
    """获取兑换码列表"""
    client = NewAPIClient()
    return await client.get_redemptions(page, page_size)
```

#### Pydantic 模式

```python
# backend/app/schemas/redemption.py

from pydantic import BaseModel, Field
from typing import Literal

class BatchRedemptionCreate(BaseModel):
    count: int = Field(..., ge=1, le=1000, description="生成数量")
    quota_type: Literal['fixed', 'random'] = Field(..., description="额度类型")
    fixed_quota: int = Field(None, ge=0, description="固定额度")
    min_quota: int = Field(None, ge=0, description="最小额度")
    max_quota: int = Field(None, ge=0, description="最大额度")
    expired_time: int = Field(0, description="过期时间戳")
    name_prefix: str = Field("Redemption", description="名称前缀")
```

---

### 2. 用户统计分析

#### 后端 API

```python
# backend/app/api/user_stats.py

from fastapi import APIRouter, Query
from app.services.stats_calculator import StatsCalculator
from datetime import datetime, timedelta

router = APIRouter()

@router.get("/ranking")
async def get_user_ranking(
    metric: str = Query('requests', regex='^(requests|quota)$'),
    period: str = Query('week', regex='^(day|week|month)$'),
    limit: int = Query(10, ge=1, le=100)
):
    """
    获取用户排行榜
    
    参数：
    - metric: 'requests' (请求数) | 'quota' (额度消耗)
    - period: 'day' | 'week' | 'month'
    - limit: 返回数量
    """
    calculator = StatsCalculator()
    
    # 计算时间范围
    end_time = datetime.now()
    if period == 'day':
        start_time = end_time - timedelta(days=1)
    elif period == 'week':
        start_time = end_time - timedelta(weeks=1)
    else:  # month
        start_time = end_time - timedelta(days=30)
    
    # 获取日志数据
    logs = await calculator.get_logs(
        start_timestamp=int(start_time.timestamp()),
        end_timestamp=int(end_time.timestamp())
    )
    
    # 统计计算
    user_stats = {}
    for log in logs:
        username = log['username']
        if username not in user_stats:
            user_stats[username] = {
                'username': username,
                'requests': 0,
                'quota': 0
            }
        
        user_stats[username]['requests'] += 1
        user_stats[username]['quota'] += log.get('quota', 0)
    
    # 排序
    ranking = sorted(
        user_stats.values(),
        key=lambda x: x[metric],
        reverse=True
    )[:limit]
    
    return {
        "period": period,
        "metric": metric,
        "ranking": ranking
    }
```

---

### 3. 模型统计分析

```python
# backend/app/api/statistics.py

@router.get("/model-stats")
async def get_model_stats(
    period: str = Query('day', regex='^(day|week|month)$')
):
    """
    获取模型统计
    
    返回：
    - 模型请求热度
    - 成功率/失败率
    - 排行榜
    """
    calculator = StatsCalculator()
    
    # 获取时间范围的日志
    logs = await calculator.get_logs_by_period(period)
    
    # 统计模型数据
    model_stats = {}
    for log in logs:
        model = log['model_name']
        if model not in model_stats:
            model_stats[model] = {
                'model_name': model,
                'total_requests': 0,
                'success_requests': 0,
                'failed_requests': 0,
                'total_quota': 0
            }
        
        model_stats[model]['total_requests'] += 1
        
        # type: 2=成功, 5=错误
        if log['type'] == 2:
            model_stats[model]['success_requests'] += 1
        else:
            model_stats[model]['failed_requests'] += 1
        
        model_stats[model]['total_quota'] += log.get('quota', 0)
    
    # 计算成功率
    for model in model_stats.values():
        total = model['total_requests']
        if total > 0:
            model['success_rate'] = round(
                model['success_requests'] / total * 100, 2
            )
        else:
            model['success_rate'] = 0
    
    # 按请求数排序
    ranking = sorted(
        model_stats.values(),
        key=lambda x: x['total_requests'],
        reverse=True
    )
    
    return {
        "period": period,
        "models": ranking
    }
```

---

### 4. Token 统计

```python
@router.get("/token-consumption")
async def get_token_consumption(
    period: str = Query('week', regex='^(day|week|month)$'),
    group_by: str = Query('total', regex='^(total|user|model)$')
):
    """
    获取 Token 消耗统计
    
    参数：
    - period: 统计时间段
    - group_by: 'total' | 'user' | 'model'
    """
    calculator = StatsCalculator()
    logs = await calculator.get_logs_by_period(period)
    
    if group_by == 'total':
        # 总计
        total_prompt = sum(log.get('prompt_tokens', 0) for log in logs)
        total_completion = sum(log.get('completion_tokens', 0) for log in logs)
        
        return {
            "period": period,
            "total_prompt_tokens": total_prompt,
            "total_completion_tokens": total_completion,
            "total_tokens": total_prompt + total_completion
        }
    
    elif group_by == 'user':
        # 按用户统计
        user_tokens = {}
        for log in logs:
            username = log['username']
            if username not in user_tokens:
                user_tokens[username] = {
                    'username': username,
                    'prompt_tokens': 0,
                    'completion_tokens': 0
                }
            
            user_tokens[username]['prompt_tokens'] += log.get('prompt_tokens', 0)
            user_tokens[username]['completion_tokens'] += log.get('completion_tokens', 0)
        
        # 计算总和
        for user in user_tokens.values():
            user['total_tokens'] = user['prompt_tokens'] + user['completion_tokens']
        
        ranking = sorted(
            user_tokens.values(),
            key=lambda x: x['total_tokens'],
            reverse=True
        )
        
        return {
            "period": period,
            "group_by": "user",
            "data": ranking
        }
    
    else:  # model
        # 按模型统计
        model_tokens = {}
        for log in logs:
            model = log['model_name']
            if model not in model_tokens:
                model_tokens[model] = {
                    'model_name': model,
                    'prompt_tokens': 0,
                    'completion_tokens': 0
                }
            
            model_tokens[model]['prompt_tokens'] += log.get('prompt_tokens', 0)
            model_tokens[model]['completion_tokens'] += log.get('completion_tokens', 0)
        
        for model in model_tokens.values():
            model['total_tokens'] = model['prompt_tokens'] + model['completion_tokens']
        
        ranking = sorted(
            model_tokens.values(),
            key=lambda x: x['total_tokens'],
            reverse=True
        )
        
        return {
            "period": period,
            "group_by": "model",
            "data": ranking
        }
```

---

### 5. NewAPI 客户端封装

```python
# backend/app/services/newapi_client.py

import httpx
from app.config import settings

class NewAPIClient:
    def __init__(self):
        self.base_url = settings.NEWAPI_BASE_URL
        self.session_cookie = settings.NEWAPI_SESSION
        self.user_id = settings.NEWAPI_USER_ID
    
    def _get_headers(self):
        return {
            'Cookie': f'session={self.session_cookie}',
            'New-Api-User': self.user_id,
            'new-api-user': self.user_id,
            'Content-Type': 'application/json'
        }
    
    async def create_redemption(self, quota: int, count: int, 
                               expired_time: int, name: str, key: str):
        """创建兑换码"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/api/redemption/",
                json={
                    "quota": quota,
                    "count": count,
                    "expired_time": expired_time,
                    "name": name,
                    "key": key
                },
                headers=self._get_headers()
            )
            return response.json()
    
    async def get_redemptions(self, page: int = 1, page_size: int = 50):
        """获取兑换码列表"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/api/redemption/",
                params={'p': page, 'page_size': page_size},
                headers=self._get_headers()
            )
            return response.json()
    
    async def get_logs(self, start_timestamp: int, end_timestamp: int,
                      page: int = 1, page_size: int = 1000, **filters):
        """获取日志"""
        params = {
            'p': page,
            'page_size': page_size,
            'type': filters.get('type', 0),
            'username': filters.get('username', ''),
            'token_name': filters.get('token_name', ''),
            'model_name': filters.get('model_name', ''),
            'start_timestamp': start_timestamp,
            'end_timestamp': end_timestamp,
            'channel': filters.get('channel', ''),
            'group': filters.get('group', '')
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/api/log/",
                params=params,
                headers=self._get_headers()
            )
            return response.json()
    
    async def get_data(self, start_timestamp: int, end_timestamp: int,
                      username: str = '', default_time: str = 'week'):
        """获取使用数据"""
        params = {
            'username': username,
            'start_timestamp': start_timestamp,
            'end_timestamp': end_timestamp,
            'default_time': default_time
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/api/data/",
                params=params,
                headers=self._get_headers()
            )
            return response.json()
```

---

## 🎨 前端页面

### 1. 兑换码管理页面

```jsx
// frontend/src/pages/Redemption/BatchCreate.jsx

import React, { useState } from 'react';
import {
  Card, CardContent, TextField, Button, Radio, 
  RadioGroup, FormControlLabel, FormLabel, Grid, Alert
} from '@mui/material';
import { createBatchRedemptions } from '@services/api';

const BatchCreate = () => {
  const [formData, setFormData] = useState({
    count: 10,
    quotaType: 'fixed',
    fixedQuota: 100000,
    minQuota: 50000,
    maxQuota: 150000,
    namePrefix: 'Redemption',
    expiredTime: 0
  });
  
  const [result, setResult] = useState(null);
  
  const handleSubmit = async () => {
    try {
      const response = await createBatchRedemptions(formData);
      setResult({ type: 'success', message: `成功生成 ${response.count} 个兑换码` });
    } catch (error) {
      setResult({ type: 'error', message: '生成失败' });
    }
  };
  
  return (
    <Card>
      <CardContent>
        <FormLabel>批量生成兑换码</FormLabel>
        
        <Grid container spacing={2} sx={{ mt: 2 }}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="生成数量"
              type="number"
              value={formData.count}
              onChange={(e) => setFormData({...formData, count: e.target.value})}
            />
          </Grid>
          
          <Grid item xs={12}>
            <FormLabel>额度类型</FormLabel>
            <RadioGroup
              value={formData.quotaType}
              onChange={(e) => setFormData({...formData, quotaType: e.target.value})}
            >
              <FormControlLabel value="fixed" control={<Radio />} label="固定额度" />
              <FormControlLabel value="random" control={<Radio />} label="随机额度" />
            </RadioGroup>
          </Grid>
          
          {formData.quotaType === 'fixed' ? (
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="固定额度"
                type="number"
                value={formData.fixedQuota}
                onChange={(e) => setFormData({...formData, fixedQuota: e.target.value})}
              />
            </Grid>
          ) : (
            <>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  label="最小额度"
                  type="number"
                  value={formData.minQuota}
                  onChange={(e) => setFormData({...formData, minQuota: e.target.value})}
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  label="最大额度"
                  type="number"
                  value={formData.maxQuota}
                  onChange={(e) => setFormData({...formData, maxQuota: e.target.value})}
                />
              </Grid>
            </>
          )}
          
          <Grid item xs={12}>
            <Button variant="contained" fullWidth onClick={handleSubmit}>
              批量生成
            </Button>
          </Grid>
          
          {result && (
            <Grid item xs={12}>
              <Alert severity={result.type}>{result.message}</Alert>
            </Grid>
          )}
        </Grid>
      </CardContent>
    </Card>
  );
};

export default BatchCreate;
```

---

## 📊 配置文件

```python
# backend/app/config.py

from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # NewAPI 配置
    NEWAPI_BASE_URL: str = "https://api.kkyyxx.xyz"
    NEWAPI_SESSION: str  # 从环境变量读取
    NEWAPI_USER_ID: str = "1"
    
    # 应用配置
    APP_NAME: str = "NewAPI Statistics Tool"
    DEBUG: bool = False
    
    # 缓存配置（可选）
    REDIS_URL: str = "redis://localhost:6379/0"
    CACHE_TTL: int = 300  # 5分钟缓存
    
    class Config:
        env_file = ".env"

settings = Settings()
```

```env
# backend/.env.example

NEWAPI_BASE_URL=https://api.kkyyxx.xyz
NEWAPI_SESSION=your_session_cookie_here
NEWAPI_USER_ID=1
```

---

## 🚀 快速启动

### 后端

```bash
cd backend
pip install fastapi uvicorn httpx pydantic-settings
cp .env.example .env
# 编辑 .env，填入你的 session
python -m uvicorn app.main:app --reload
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

---

## 📦 精简的依赖

### 后端 requirements.txt

```txt
fastapi==0.109.0
uvicorn[standard]==0.27.0
httpx==0.26.0
pydantic==2.5.3
pydantic-settings==2.1.0
python-dotenv==1.0.0
```

### 前端 package.json

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@mui/material": "^5.15.3",
    "@mui/icons-material": "^5.15.3",
    "axios": "^1.6.5",
    "recharts": "^2.10.3"
  }
}
```

---

## 🎯 总结

### 移除的内容
- ❌ 自己的数据库（直接用 NewAPI 的数据）
- ❌ 复杂的认证系统（使用 NewAPI 的 session）
- ❌ 大量不需要的页面和功能
- ❌ 复杂的 Docker 配置

### 保留的核心
- ✅ 兑换码批量生成（固定/随机额度）
- ✅ 用户请求/额度排行（日/周/月）
- ✅ 模型热度和成功率统计
- ✅ Token 消耗统计
- ✅ 简洁的前端展示

### 优势
- 🚀 **轻量级** - 无需数据库，部署简单
- 🎯 **聚焦** - 只做需要的功能
- 🔌 **灵活** - 对接现有 API，不侵入原系统
- 📈 **实用** - 专注统计和分析

---

**这是一个真正符合需求的精简方案！**


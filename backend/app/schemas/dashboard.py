"""
Dashboard 相关的 Pydantic 模式
"""
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


class DashboardOverview(BaseModel):
    """仪表盘总览数据"""
    total_requests: int = Field(..., description="总请求数")
    success_rate: float = Field(..., ge=0, le=100, description="成功率(%)")
    total_quota: int = Field(..., description="总配额使用")
    active_users: int = Field(..., description="活跃用户数")
    today_requests: int = Field(..., description="今日请求数")
    today_quota: int = Field(..., description="今日配额使用")
    
    class Config:
        json_schema_extra = {
            "example": {
                "total_requests": 381507,
                "success_rate": 95.5,
                "total_quota": 12500000,
                "active_users": 245,
                "today_requests": 5420,
                "today_quota": 280000
            }
        }


class QuotaTrendResponse(BaseModel):
    """配额趋势数据"""
    labels: List[str] = Field(..., description="时间标签")
    data: List[int] = Field(..., description="配额数据")
    
    class Config:
        json_schema_extra = {
            "example": {
                "labels": ["2025-09-25", "2025-09-26", "2025-09-27", "2025-09-28", "2025-09-29", "2025-09-30", "2025-10-01"],
                "data": [180000, 195000, 210000, 185000, 220000, 240000, 280000]
            }
        }


class ModelStatsItem(BaseModel):
    """模型统计项"""
    model_name: str = Field(..., description="模型名称")
    request_count: int = Field(..., description="请求次数")
    quota_used: int = Field(..., description="配额使用")
    success_rate: float = Field(..., ge=0, le=100, description="成功率(%)")
    avg_response_time: Optional[float] = Field(None, description="平均响应时间(ms)")
    
    class Config:
        json_schema_extra = {
            "example": {
                "model_name": "gemini-2.5-pro",
                "request_count": 1234,
                "quota_used": 567890,
                "success_rate": 96.5,
                "avg_response_time": 1250.5
            }
        }


class ModelStatsResponse(BaseModel):
    """模型统计响应"""
    items: List[ModelStatsItem]
    total_count: int


class ChannelStatsItem(BaseModel):
    """渠道统计项"""
    channel_id: int
    channel_name: str
    request_count: int
    quota_used: int
    success_rate: float = Field(..., ge=0, le=100)
    avg_latency: Optional[float] = None
    status: int = Field(..., description="渠道状态: 1-启用, 2-禁用")
    
    class Config:
        json_schema_extra = {
            "example": {
                "channel_id": 1,
                "channel_name": "paid-pro",
                "request_count": 5678,
                "quota_used": 1234567,
                "success_rate": 98.2,
                "avg_latency": 850.3,
                "status": 1
            }
        }


class ChannelStatsResponse(BaseModel):
    """渠道统计响应"""
    items: List[ChannelStatsItem]
    total_count: int


class RealtimeData(BaseModel):
    """实时数据"""
    current_rps: float = Field(..., description="当前每秒请求数")
    current_qps: float = Field(..., description="当前每秒配额")
    recent_logs: List[dict] = Field(..., description="最近日志")
    timestamp: datetime = Field(default_factory=datetime.now)


class ErrorAnalysis(BaseModel):
    """错误分析"""
    total_errors: int
    error_rate: float = Field(..., ge=0, le=100)
    error_types: dict = Field(..., description="错误类型分布")
    top_error_models: List[dict]
    
    class Config:
        json_schema_extra = {
            "example": {
                "total_errors": 125,
                "error_rate": 4.5,
                "error_types": {
                    "quota_exceeded": 45,
                    "bad_response": 35,
                    "timeout": 25,
                    "other": 20
                },
                "top_error_models": [
                    {"model_name": "gpt-5", "error_count": 58},
                    {"model_name": "gemini-2.5-pro", "error_count": 32}
                ]
            }
        }


class UserRankingItem(BaseModel):
    """用户排行项"""
    user_id: int
    username: str
    value: int = Field(..., description="指标值（配额或请求数）")
    rank: int
    
    class Config:
        json_schema_extra = {
            "example": {
                "user_id": 326,
                "username": "linuxdo_326",
                "value": 500000,
                "rank": 1
            }
        }


class UserRankingResponse(BaseModel):
    """用户排行响应"""
    metric: str = Field(..., description="排序指标")
    range: str = Field(..., description="时间范围")
    items: List[UserRankingItem]



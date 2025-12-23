"""
Dashboard API Routes for NewAPI Middleware Tool.
Implements dashboard statistics and analytics endpoints.
"""
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from .auth import verify_auth
from .main import InvalidParamsError
from .dashboard_service import get_dashboard_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


# Response Models

class SystemOverviewResponse(BaseModel):
    """Response model for system overview."""
    success: bool
    data: dict


class UsageStatisticsResponse(BaseModel):
    """Response model for usage statistics."""
    success: bool
    data: dict


class ModelUsageResponse(BaseModel):
    """Response model for model usage."""
    success: bool
    data: list


class TrendsResponse(BaseModel):
    """Response model for trends data."""
    success: bool
    data: list


class TopUsersResponse(BaseModel):
    """Response model for top users."""
    success: bool
    data: list


class ChannelStatusResponse(BaseModel):
    """Response model for channel status."""
    success: bool
    data: list


# API Endpoints

@router.get("/overview", response_model=SystemOverviewResponse)
async def get_system_overview(
    _: str = Depends(verify_auth),
):
    """
    获取系统概览统计数据。

    返回用户数、Token数、渠道数、模型数、兑换码数等统计。
    """
    service = get_dashboard_service()
    overview = service.get_system_overview()

    return SystemOverviewResponse(
        success=True,
        data={
            "total_users": overview.total_users,
            "active_users": overview.active_users,
            "total_tokens": overview.total_tokens,
            "active_tokens": overview.active_tokens,
            "total_channels": overview.total_channels,
            "active_channels": overview.active_channels,
            "total_models": overview.total_models,
            "total_redemptions": overview.total_redemptions,
            "unused_redemptions": overview.unused_redemptions,
        },
    )


@router.get("/usage", response_model=UsageStatisticsResponse)
async def get_usage_statistics(
    period: str = Query(default="24h", description="时间周期 (1h/6h/24h/7d/30d)"),
    _: str = Depends(verify_auth),
):
    """
    获取使用统计数据。

    - **period**: 时间周期
        - 1h: 最近1小时
        - 6h: 最近6小时
        - 24h: 最近24小时
        - 7d: 最近7天
        - 30d: 最近30天
    """
    # Parse period to timestamps
    end_time = int(time.time())
    period_map = {
        "1h": 3600,
        "6h": 6 * 3600,
        "24h": 24 * 3600,
        "7d": 7 * 24 * 3600,
        "30d": 30 * 24 * 3600,
    }

    if period not in period_map:
        raise InvalidParamsError(message=f"Invalid period: {period}")

    start_time = end_time - period_map[period]

    service = get_dashboard_service()
    stats = service.get_usage_statistics(start_time=start_time, end_time=end_time)

    return UsageStatisticsResponse(
        success=True,
        data={
            "period": period,
            "total_requests": stats.total_requests,
            "total_quota_used": stats.total_quota_used,
            "total_prompt_tokens": stats.total_prompt_tokens,
            "total_completion_tokens": stats.total_completion_tokens,
            "average_response_time": round(stats.average_response_time, 2),
        },
    )


@router.get("/models", response_model=ModelUsageResponse)
async def get_model_usage(
    period: str = Query(default="7d", description="时间周期 (24h/7d/30d)"),
    limit: int = Query(default=10, ge=1, le=50, description="返回数量"),
    _: str = Depends(verify_auth),
):
    """
    获取模型使用分布。

    - **period**: 时间周期 (24h/7d/30d)
    - **limit**: 返回模型数量 (1-50)
    """
    end_time = int(time.time())
    period_map = {
        "24h": 24 * 3600,
        "7d": 7 * 24 * 3600,
        "30d": 30 * 24 * 3600,
    }

    if period not in period_map:
        raise InvalidParamsError(message=f"Invalid period: {period}")

    start_time = end_time - period_map[period]

    service = get_dashboard_service()
    models = service.get_model_usage(start_time=start_time, end_time=end_time, limit=limit)

    return ModelUsageResponse(
        success=True,
        data=[
            {
                "model_name": m.model_name,
                "request_count": m.request_count,
                "quota_used": m.quota_used,
                "prompt_tokens": m.prompt_tokens,
                "completion_tokens": m.completion_tokens,
            }
            for m in models
        ],
    )


@router.get("/trends/daily", response_model=TrendsResponse)
async def get_daily_trends(
    days: int = Query(default=7, ge=1, le=30, description="天数 (1-30)"),
    _: str = Depends(verify_auth),
):
    """
    获取每日使用趋势。

    - **days**: 返回天数 (1-30)
    """
    service = get_dashboard_service()
    trends = service.get_daily_trends(days=days)

    return TrendsResponse(
        success=True,
        data=[
            {
                "date": t.date,
                "request_count": t.request_count,
                "quota_used": t.quota_used,
                "unique_users": t.unique_users,
            }
            for t in trends
        ],
    )


@router.get("/trends/hourly", response_model=TrendsResponse)
async def get_hourly_trends(
    hours: int = Query(default=24, ge=1, le=72, description="小时数 (1-72)"),
    _: str = Depends(verify_auth),
):
    """
    获取每小时使用趋势。

    - **hours**: 返回小时数 (1-72)
    """
    service = get_dashboard_service()
    trends = service.get_hourly_trends(hours=hours)

    return TrendsResponse(
        success=True,
        data=trends,
    )


@router.get("/top-users", response_model=TopUsersResponse)
async def get_top_users(
    period: str = Query(default="7d", description="时间周期 (24h/7d/30d)"),
    limit: int = Query(default=10, ge=1, le=50, description="返回数量"),
    _: str = Depends(verify_auth),
):
    """
    获取消耗排行榜。

    - **period**: 时间周期 (24h/7d/30d)
    - **limit**: 返回用户数量 (1-50)
    """
    end_time = int(time.time())
    period_map = {
        "24h": 24 * 3600,
        "7d": 7 * 24 * 3600,
        "30d": 30 * 24 * 3600,
    }

    if period not in period_map:
        raise InvalidParamsError(message=f"Invalid period: {period}")

    start_time = end_time - period_map[period]

    service = get_dashboard_service()
    users = service.get_top_users(start_time=start_time, end_time=end_time, limit=limit)

    return TopUsersResponse(
        success=True,
        data=[
            {
                "user_id": u.user_id,
                "username": u.username,
                "request_count": u.request_count,
                "quota_used": u.quota_used,
            }
            for u in users
        ],
    )


@router.get("/channels", response_model=ChannelStatusResponse)
async def get_channel_status(
    _: str = Depends(verify_auth),
):
    """
    获取渠道状态列表。
    """
    service = get_dashboard_service()
    channels = service.get_channel_status()

    return ChannelStatusResponse(
        success=True,
        data=channels,
    )

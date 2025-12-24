"""
Dashboard API Routes for NewAPI Middleware Tool.
Implements dashboard statistics and analytics endpoints with caching.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from .auth import verify_auth
from .main import InvalidParamsError
from .cached_dashboard import get_cached_dashboard_service

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


class CacheControlResponse(BaseModel):
    """Response model for cache control."""
    success: bool
    message: str
    data: Optional[dict] = None


# API Endpoints

@router.get("/overview", response_model=SystemOverviewResponse)
async def get_system_overview(
    period: str = Query(default="7d", description="活跃口径时间周期 (24h/3d/7d/14d)"),
    no_cache: bool = Query(default=False, description="跳过缓存"),
    _: str = Depends(verify_auth),
):
    """
    获取系统概览统计数据（带缓存）。

    返回用户数、Token数、渠道数、模型数、兑换码数等统计。
    """
    valid_periods = ["24h", "3d", "7d", "14d"]
    if period not in valid_periods:
        raise InvalidParamsError(message=f"Invalid period: {period}")

    service = get_cached_dashboard_service()
    data = service.get_system_overview(period=period, use_cache=not no_cache)

    return SystemOverviewResponse(success=True, data=data)


@router.get("/usage", response_model=UsageStatisticsResponse)
async def get_usage_statistics(
    period: str = Query(default="24h", description="时间周期 (1h/6h/24h/7d/30d)"),
    no_cache: bool = Query(default=False, description="跳过缓存"),
    _: str = Depends(verify_auth),
):
    """
    获取使用统计数据（带缓存）。

    - **period**: 时间周期
        - 1h: 最近1小时
        - 6h: 最近6小时
        - 24h: 最近24小时
        - 7d: 最近7天
        - 30d: 最近30天
    """
    valid_periods = ["1h", "6h", "24h", "3d", "7d", "14d"]
    if period not in valid_periods:
        raise InvalidParamsError(message=f"Invalid period: {period}")

    service = get_cached_dashboard_service()
    data = service.get_usage_statistics(period=period, use_cache=not no_cache)

    return UsageStatisticsResponse(success=True, data=data)


@router.get("/models", response_model=ModelUsageResponse)
async def get_model_usage(
    period: str = Query(default="7d", description="时间周期 (24h/3d/7d/14d)"),
    limit: int = Query(default=10, ge=1, le=50, description="返回数量"),
    no_cache: bool = Query(default=False, description="跳过缓存"),
    _: str = Depends(verify_auth),
):
    """
    获取模型使用分布（带缓存）。

    - **period**: 时间周期 (24h/3d/7d/14d)
    - **limit**: 返回模型数量 (1-50)
    """
    valid_periods = ["24h", "3d", "7d", "14d"]
    if period not in valid_periods:
        raise InvalidParamsError(message=f"Invalid period: {period}")

    service = get_cached_dashboard_service()
    data = service.get_model_usage(period=period, limit=limit, use_cache=not no_cache)

    return ModelUsageResponse(success=True, data=data)


@router.get("/trends/daily", response_model=TrendsResponse)
async def get_daily_trends(
    days: int = Query(default=7, ge=1, le=30, description="天数 (1-30)"),
    no_cache: bool = Query(default=False, description="跳过缓存"),
    _: str = Depends(verify_auth),
):
    """
    获取每日使用趋势（带缓存）。

    - **days**: 返回天数 (1-30)
    """
    service = get_cached_dashboard_service()
    data = service.get_daily_trends(days=days, use_cache=not no_cache)

    return TrendsResponse(success=True, data=data)


@router.get("/trends/hourly", response_model=TrendsResponse)
async def get_hourly_trends(
    hours: int = Query(default=24, ge=1, le=72, description="小时数 (1-72)"),
    no_cache: bool = Query(default=False, description="跳过缓存"),
    _: str = Depends(verify_auth),
):
    """
    获取每小时使用趋势（带缓存）。

    - **hours**: 返回小时数 (1-72)
    """
    service = get_cached_dashboard_service()
    data = service.get_hourly_trends(hours=hours, use_cache=not no_cache)

    return TrendsResponse(success=True, data=data)


@router.get("/top-users", response_model=TopUsersResponse)
async def get_top_users(
    period: str = Query(default="7d", description="时间周期 (24h/3d/7d/14d)"),
    limit: int = Query(default=10, ge=1, le=50, description="返回数量"),
    no_cache: bool = Query(default=False, description="跳过缓存"),
    _: str = Depends(verify_auth),
):
    """
    获取消耗排行榜（带缓存）。

    - **period**: 时间周期 (24h/3d/7d/14d)
    - **limit**: 返回用户数量 (1-50)
    """
    valid_periods = ["24h", "3d", "7d", "14d"]
    if period not in valid_periods:
        raise InvalidParamsError(message=f"Invalid period: {period}")

    service = get_cached_dashboard_service()
    data = service.get_top_users(period=period, limit=limit, use_cache=not no_cache)

    return TopUsersResponse(success=True, data=data)


@router.get("/channels", response_model=ChannelStatusResponse)
async def get_channel_status(
    no_cache: bool = Query(default=False, description="跳过缓存"),
    _: str = Depends(verify_auth),
):
    """
    获取渠道状态列表（带缓存）。
    """
    service = get_cached_dashboard_service()
    data = service.get_channel_status(use_cache=not no_cache)

    return ChannelStatusResponse(success=True, data=data)


@router.post("/cache/invalidate", response_model=CacheControlResponse)
async def invalidate_dashboard_cache(
    _: str = Depends(verify_auth),
):
    """
    手动刷新仪表板缓存。
    """
    service = get_cached_dashboard_service()
    deleted = service.invalidate_cache()

    logger.info(f"Dashboard cache invalidated: {deleted} entries")

    return CacheControlResponse(
        success=True,
        message=f"Invalidated {deleted} cache entries",
        data={"deleted": deleted},
    )

"""
Dashboard API 路由
提供统计数据和可视化数据
"""
from fastapi import APIRouter, Depends, Query
from datetime import datetime, timedelta
from typing import Optional

from app.schemas.dashboard import (
    DashboardOverview,
    QuotaTrendResponse,
    ModelStatsResponse,
    ChannelStatsResponse
)
from app.services.statistics import StatisticsService

router = APIRouter()


@router.get("/overview", response_model=DashboardOverview)
async def get_overview(
    stats_service: StatisticsService = Depends()
):
    """
    获取仪表盘总览数据
    
    返回：
    - total_requests: 总请求数
    - success_rate: 成功率
    - total_quota: 总配额使用
    - active_users: 活跃用户数
    - today_requests: 今日请求数
    - today_quota: 今日配额使用
    """
    return await stats_service.get_overview()


@router.get("/quota-trend", response_model=QuotaTrendResponse)
async def get_quota_trend(
    range: str = Query("7d", regex="^(1d|7d|30d|90d)$"),
    stats_service: StatisticsService = Depends()
):
    """
    获取配额使用趋势
    
    参数：
    - range: 时间范围 (1d, 7d, 30d, 90d)
    
    返回：
    - labels: 时间标签列表
    - data: 配额数据列表
    """
    return await stats_service.get_quota_trend(range)


@router.get("/model-stats", response_model=ModelStatsResponse)
async def get_model_stats(
    limit: int = Query(10, ge=1, le=50),
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    stats_service: StatisticsService = Depends()
):
    """
    获取模型使用统计
    
    参数：
    - limit: 返回数量限制
    - start_time: 开始时间
    - end_time: 结束时间
    
    返回：模型使用统计列表
    """
    return await stats_service.get_model_stats(
        limit=limit,
        start_time=start_time,
        end_time=end_time
    )


@router.get("/channel-stats", response_model=ChannelStatsResponse)
async def get_channel_stats(
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    stats_service: StatisticsService = Depends()
):
    """
    获取渠道使用统计
    
    参数：
    - start_time: 开始时间
    - end_time: 结束时间
    
    返回：渠道使用统计列表
    """
    return await stats_service.get_channel_stats(
        start_time=start_time,
        end_time=end_time
    )


@router.get("/realtime")
async def get_realtime_data(
    stats_service: StatisticsService = Depends()
):
    """
    获取实时数据（最近 5 分钟）
    
    返回：
    - current_rps: 当前每秒请求数
    - current_qps: 当前每秒配额使用
    - recent_logs: 最近日志列表
    """
    return await stats_service.get_realtime_data()


@router.get("/error-analysis")
async def get_error_analysis(
    hours: int = Query(24, ge=1, le=168),
    stats_service: StatisticsService = Depends()
):
    """
    获取错误分析数据
    
    参数：
    - hours: 分析时间范围（小时）
    
    返回：
    - total_errors: 总错误数
    - error_rate: 错误率
    - error_types: 错误类型分布
    - top_error_models: 错误最多的模型
    """
    return await stats_service.get_error_analysis(hours=hours)


@router.get("/user-ranking")
async def get_user_ranking(
    metric: str = Query("quota", regex="^(quota|requests)$"),
    limit: int = Query(10, ge=1, le=50),
    range: str = Query("7d", regex="^(1d|7d|30d)$"),
    stats_service: StatisticsService = Depends()
):
    """
    获取用户排行榜
    
    参数：
    - metric: 排序指标 (quota: 配额, requests: 请求数)
    - limit: 返回数量
    - range: 时间范围
    
    返回：用户排行列表
    """
    return await stats_service.get_user_ranking(
        metric=metric,
        limit=limit,
        range=range
    )



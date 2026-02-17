"""
Log Analytics API Routes for NewAPI Middleware Tool.
Implements endpoints for user rankings and model statistics.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from .auth import verify_auth
from .log_analytics_service import get_log_analytics_service
from .logger import logger

router = APIRouter(prefix="/api/analytics", tags=["Log Analytics"])


# Response Models

class UserRankingItem(BaseModel):
    """User ranking item."""
    user_id: int
    username: str
    request_count: int
    quota_used: int


class ModelStatsItem(BaseModel):
    """Model statistics item."""
    model_name: str
    total_requests: int
    success_count: int
    failure_count: int
    empty_count: int
    success_rate: float
    empty_rate: float


class AnalyticsStateResponse(BaseModel):
    """Analytics state response."""
    last_log_id: int
    last_processed_at: int
    total_processed: int


class UserRankingResponse(BaseModel):
    """Response for user ranking endpoints."""
    success: bool
    data: list[UserRankingItem]


class ModelStatsResponse(BaseModel):
    """Response for model statistics endpoint."""
    success: bool
    data: list[ModelStatsItem]


class ProcessResponse(BaseModel):
    """Response for process endpoint."""
    success: bool
    processed: int
    message: Optional[str] = None
    last_log_id: Optional[int] = None
    users_updated: Optional[int] = None
    models_updated: Optional[int] = None


class SummaryResponse(BaseModel):
    """Response for summary endpoint."""
    success: bool
    data: dict


class ResetResponse(BaseModel):
    """Response for reset endpoint."""
    success: bool
    message: str


class BatchProcessResponse(BaseModel):
    """Response for batch process endpoint."""
    success: bool
    total_processed: int
    iterations: int
    elapsed_seconds: float
    logs_per_second: float
    progress_percent: float
    remaining_logs: int
    last_log_id: int
    completed: bool
    timed_out: bool = False


class SyncStatusResponse(BaseModel):
    """Response for sync status endpoint."""
    success: bool
    data: dict


# API Endpoints

@router.get("/state", response_model=dict)
async def get_analytics_state(
    _: str = Depends(verify_auth),
):
    """
    获取分析处理状态。

    返回上次处理的日志ID、处理时间和总处理数量。
    """
    service = get_log_analytics_service()
    state = service.get_analytics_state()

    return {
        "success": True,
        "data": {
            "last_log_id": state.last_log_id,
            "last_processed_at": state.last_processed_at,
            "total_processed": state.total_processed,
        }
    }


@router.post("/process", response_model=ProcessResponse)
async def process_logs(
    _: str = Depends(verify_auth),
):
    """
    处理新日志（增量）。

    每次处理最多1000条新日志，更新用户排行和模型统计。
    建议定时调用此接口（如每5分钟一次）。
    """
    service = get_log_analytics_service()
    result = service.process_new_logs()

    return ProcessResponse(**result)


@router.get("/users/requests", response_model=UserRankingResponse)
async def get_user_request_ranking(
    limit: int = Query(default=10, ge=1, le=50, description="返回数量"),
    _: str = Depends(verify_auth),
):
    """
    获取用户请求数排行榜。

    返回按请求次数降序排列的用户列表。
    """
    service = get_log_analytics_service()
    rankings = service.get_user_request_ranking(limit=limit)

    return UserRankingResponse(
        success=True,
        data=[
            UserRankingItem(
                user_id=r.user_id,
                username=r.username,
                request_count=r.request_count,
                quota_used=r.quota_used,
            )
            for r in rankings
        ]
    )


@router.get("/users/quota", response_model=UserRankingResponse)
async def get_user_quota_ranking(
    limit: int = Query(default=10, ge=1, le=50, description="返回数量"),
    _: str = Depends(verify_auth),
):
    """
    获取用户额度消耗排行榜。

    返回按消耗额度降序排列的用户列表。
    """
    service = get_log_analytics_service()
    rankings = service.get_user_quota_ranking(limit=limit)

    return UserRankingResponse(
        success=True,
        data=[
            UserRankingItem(
                user_id=r.user_id,
                username=r.username,
                request_count=r.request_count,
                quota_used=r.quota_used,
            )
            for r in rankings
        ]
    )


@router.get("/models", response_model=ModelStatsResponse)
async def get_model_statistics(
    limit: int = Query(default=20, ge=1, le=100, description="返回数量"),
    _: str = Depends(verify_auth),
):
    """
    获取模型统计数据。

    返回模型的请求数、成功率和空回复率。
    - 成功率 = type=2请求数 / (type=2 + type=5)总请求数
    - 空回复率 = 空回复数 / 成功请求数
    """
    service = get_log_analytics_service()
    stats = service.get_model_statistics(limit=limit)

    return ModelStatsResponse(
        success=True,
        data=[
            ModelStatsItem(
                model_name=s.model_name,
                total_requests=s.total_requests,
                success_count=s.success_count,
                failure_count=s.failure_count,
                empty_count=s.empty_count,
                success_rate=s.success_rate,
                empty_rate=s.empty_rate,
            )
            for s in stats
        ]
    )


@router.get("/summary", response_model=SummaryResponse)
async def get_analytics_summary(
    _: str = Depends(verify_auth),
):
    """
    获取分析汇总数据。

    返回完整的分析数据，包括处理状态、用户排行和模型统计。
    """
    service = get_log_analytics_service()
    summary = service.get_summary()

    return SummaryResponse(success=True, data=summary)


@router.post("/reset", response_model=ResetResponse)
async def reset_analytics(
    _: str = Depends(verify_auth),
):
    """
    重置所有分析数据。

    **警告**: 此操作将清空所有累积的统计数据，需要重新处理日志。
    """
    service = get_log_analytics_service()
    result = service.reset_analytics()

    logger.analytics("用户手动重置分析数据")

    return ResetResponse(**result)


@router.post("/batch", response_model=BatchProcessResponse)
async def batch_process_logs(
    max_iterations: int = Query(default=100, ge=1, le=1000, description="最大迭代次数"),
    _: str = Depends(verify_auth),
):
    """
    批量处理日志（用于初始化同步）。

    连续处理多个批次的日志，每批次1000条。
    前端会自动循环调用直到完成。

    - **max_iterations**: 单次请求最大迭代次数（每次处理1000条）
        - 默认 100，单次请求最多处理 100,000 条日志
        - 前端会自动循环调用直到全部完成

    返回处理进度和统计信息。
    """
    service = get_log_analytics_service()
    result = service.batch_process(max_iterations=max_iterations)

    logger.analytics(
        "批量处理完成",
        processed=result['total_processed'],
        elapsed=f"{result['elapsed_seconds']}s"
    )

    return BatchProcessResponse(**result)


@router.get("/sync-status", response_model=SyncStatusResponse)
async def get_sync_status(
    _: str = Depends(verify_auth),
):
    """
    获取同步状态。

    返回本地分析与主数据库之间的同步进度：
    - 当前已处理的最后日志ID
    - 数据库中的最大日志ID
    - 同步进度百分比
    - 剩余待处理日志数量
    - 数据一致性检测
    """
    service = get_log_analytics_service()
    status = service.get_sync_status()

    return SyncStatusResponse(success=True, data=status)


@router.post("/check-consistency", response_model=dict)
async def check_data_consistency(
    auto_reset: bool = Query(default=False, description="检测到不一致时是否自动重置"),
    _: str = Depends(verify_auth),
):
    """
    检查数据一致性。

    检测日志是否被删除或数据库是否被重置。
    如果 auto_reset=true，检测到不一致时会自动重置分析数据。
    """
    service = get_log_analytics_service()

    if auto_reset:
        result = service.check_and_auto_reset()
        if result["reset"]:
            logger.analytics("自动重置触发", reason=result['reason'])
        return {"success": True, **result}

    # Just check, don't reset
    status = service.get_sync_status()
    return {
        "success": True,
        "data_inconsistent": status.get("data_inconsistent", False),
        "needs_reset": status.get("needs_reset", False),
        "last_log_id": status.get("last_log_id"),
        "max_log_id": status.get("max_log_id"),
    }

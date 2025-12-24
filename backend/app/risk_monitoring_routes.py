"""
Risk Monitoring API Routes for NewAPI Middleware Tool.
Provides real-time leaderboards and per-user analysis for moderation decisions.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from .auth import verify_auth
from .main import InvalidParamsError
from .risk_monitoring_service import WINDOW_SECONDS, get_risk_monitoring_service
from .local_storage import get_local_storage

router = APIRouter(prefix="/api/risk", tags=["Risk Monitoring"])


class LeaderboardsResponse(BaseModel):
    success: bool
    data: dict


class UserAnalysisResponse(BaseModel):
    success: bool
    data: dict


class BanRecordsResponse(BaseModel):
    success: bool
    data: dict


@router.get("/leaderboards", response_model=LeaderboardsResponse)
async def get_leaderboards(
    windows: str = Query(default="1h,3h,6h,12h,24h", description="逗号分隔窗口 (1h/3h/6h/12h/24h)"),
    limit: int = Query(default=10, ge=1, le=50, description="每个榜单返回数量"),
    sort_by: str = Query(default="requests", description="排序维度 (requests/quota/failure_rate)"),
    _: str = Depends(verify_auth),
):
    service = get_risk_monitoring_service()
    if sort_by not in ["requests", "quota", "failure_rate"]:
        raise InvalidParamsError(message=f"Invalid sort_by: {sort_by}")
    window_list = [w.strip() for w in windows.split(",") if w.strip()]
    data = service.get_leaderboards(windows=window_list, limit=limit, sort_by=sort_by)
    return LeaderboardsResponse(success=True, data=data)


@router.get("/users/{user_id}/analysis", response_model=UserAnalysisResponse)
async def get_user_analysis(
    user_id: int,
    window: str = Query(default="24h", description="分析窗口 (1h/3h/6h/12h/24h)"),
    _: str = Depends(verify_auth),
):
    seconds = WINDOW_SECONDS.get(window)
    if not seconds:
        raise InvalidParamsError(message=f"Invalid window: {window}")

    service = get_risk_monitoring_service()
    data = service.get_user_analysis(user_id=user_id, window_seconds=seconds)
    return UserAnalysisResponse(success=True, data=data)


@router.get("/ban-records", response_model=BanRecordsResponse)
async def list_ban_records(
    page: int = Query(default=1, ge=1, description="页码"),
    page_size: int = Query(default=50, ge=1, le=200, description="每页数量"),
    action: Optional[str] = Query(default=None, description="过滤动作 (ban/unban)"),
    user_id: Optional[int] = Query(default=None, description="过滤用户ID"),
    _: str = Depends(verify_auth),
):
    storage = get_local_storage()
    if action is not None and action not in ["ban", "unban"]:
        raise InvalidParamsError(message=f"Invalid action: {action}")
    data = storage.list_security_audits(page=page, page_size=page_size, action=action, user_id=user_id)
    return BanRecordsResponse(success=True, data=data)

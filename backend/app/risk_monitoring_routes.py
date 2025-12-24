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

router = APIRouter(prefix="/api/risk", tags=["Risk Monitoring"])


class LeaderboardsResponse(BaseModel):
    success: bool
    data: dict


class UserAnalysisResponse(BaseModel):
    success: bool
    data: dict


@router.get("/leaderboards", response_model=LeaderboardsResponse)
async def get_leaderboards(
    windows: str = Query(default="1h,3h,6h,12h,24h", description="逗号分隔窗口 (1h/3h/6h/12h/24h)"),
    limit: int = Query(default=10, ge=1, le=50, description="每个榜单返回数量"),
    _: str = Depends(verify_auth),
):
    service = get_risk_monitoring_service()
    window_list = [w.strip() for w in windows.split(",") if w.strip()]
    data = service.get_leaderboards(windows=window_list, limit=limit)
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


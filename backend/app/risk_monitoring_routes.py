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
def get_leaderboards(
    windows: str = Query(default="1h,3h,6h,12h,24h", description="逗号分隔窗口 (1h/3h/6h/12h/24h)"),
    limit: int = Query(default=10, ge=1, le=50, description="每个榜单返回数量"),
    sort_by: str = Query(default="requests", description="排序维度 (requests/quota/failure_rate)"),
    no_cache: bool = Query(default=False, description="强制刷新，跳过缓存"),
    _: str = Depends(verify_auth),
):
    service = get_risk_monitoring_service()
    if sort_by not in ["requests", "quota", "failure_rate"]:
        raise InvalidParamsError(message=f"Invalid sort_by: {sort_by}")
    window_list = [w.strip() for w in windows.split(",") if w.strip()]
    data = service.get_leaderboards(windows=window_list, limit=limit, sort_by=sort_by, use_cache=not no_cache)
    return LeaderboardsResponse(success=True, data=data)


@router.get("/users/{user_id}/analysis", response_model=UserAnalysisResponse)
def get_user_analysis(
    user_id: int,
    window: str = Query(default="24h", description="分析窗口 (1h/3h/6h/12h/24h)"),
    end_time: Optional[int] = Query(default=None, description="结束时间点(Unix时间戳)，用于查看历史数据如封禁时刻"),
    _: str = Depends(verify_auth),
):
    seconds = WINDOW_SECONDS.get(window)
    if not seconds:
        raise InvalidParamsError(message=f"Invalid window: {window}")

    service = get_risk_monitoring_service()
    # 如果指定了 end_time，则以该时间为基准查询历史数据
    data = service.get_user_analysis(user_id=user_id, window_seconds=seconds, now=end_time)
    return UserAnalysisResponse(success=True, data=data)


@router.get("/ban-records", response_model=BanRecordsResponse)
def list_ban_records(
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


class TokenRotationResponse(BaseModel):
    success: bool
    data: dict


class AffiliatedAccountsResponse(BaseModel):
    success: bool
    data: dict


class SameIPRegistrationsResponse(BaseModel):
    success: bool
    data: dict


@router.get("/token-rotation", response_model=TokenRotationResponse)
def get_token_rotation_users(
    window: str = Query(default="24h", description="时间窗口 (1h/3h/6h/12h/24h/3d/7d)"),
    min_tokens: int = Query(default=5, ge=2, le=50, description="最小 Token 数量阈值"),
    max_requests_per_token: int = Query(default=10, ge=1, le=100, description="每个 Token 最大平均请求数"),
    limit: int = Query(default=50, ge=1, le=200, description="返回数量"),
    no_cache: bool = Query(default=False, description="强制刷新，跳过缓存"),
    _: str = Depends(verify_auth),
):
    """
    检测 Token 轮换行为。
    
    返回同一用户短时间内使用多个 Token，且每个 Token 请求较少的用户列表。
    这种行为可能表示用户在规避限制或多人共享账号。
    """
    seconds = WINDOW_SECONDS.get(window)
    if not seconds:
        raise InvalidParamsError(message=f"Invalid window: {window}")

    service = get_risk_monitoring_service()
    data = service.get_token_rotation_users(
        window_seconds=seconds,
        min_tokens=min_tokens,
        max_requests_per_token=max_requests_per_token,
        limit=limit,
        use_cache=not no_cache,
    )
    return TokenRotationResponse(success=True, data=data)


@router.get("/affiliated-accounts", response_model=AffiliatedAccountsResponse)
def get_affiliated_accounts(
    min_invited: int = Query(default=3, ge=2, le=50, description="最小被邀请账号数量"),
    include_activity: bool = Query(default=True, description="是否包含账号活跃度信息"),
    limit: int = Query(default=50, ge=1, le=200, description="返回数量"),
    no_cache: bool = Query(default=False, description="强制刷新，跳过缓存"),
    _: str = Depends(verify_auth),
):
    """
    检测关联账号 - 同一邀请人下的多个账号。
    
    返回有多个被邀请账号的邀请人列表，包含被邀请账号的详细信息和活跃度。
    这种情况可能表示同一人注册多个账号或有组织的批量注册。
    """
    service = get_risk_monitoring_service()
    data = service.get_affiliated_accounts(
        min_invited=min_invited,
        include_activity=include_activity,
        limit=limit,
        use_cache=not no_cache,
    )
    return AffiliatedAccountsResponse(success=True, data=data)


@router.get("/same-ip-registrations", response_model=SameIPRegistrationsResponse)
def get_same_ip_registrations(
    window: str = Query(default="7d", description="时间窗口 (1h/3h/6h/12h/24h/3d/7d)"),
    min_users: int = Query(default=3, ge=2, le=50, description="最小用户数量"),
    limit: int = Query(default=50, ge=1, le=200, description="返回数量"),
    no_cache: bool = Query(default=False, description="强制刷新，跳过缓存"),
    _: str = Depends(verify_auth),
):
    """
    检测同 IP 注册的多个账号。
    
    通过分析用户首次请求的 IP 地址，找出从同一 IP 注册的多个账号。
    这种情况可能表示批量注册或同一人使用多个账号。
    """
    seconds = WINDOW_SECONDS.get(window)
    if not seconds:
        raise InvalidParamsError(message=f"Invalid window: {window}")

    service = get_risk_monitoring_service()
    data = service.get_same_ip_registrations(
        window_seconds=seconds,
        min_users=min_users,
        limit=limit,
        use_cache=not no_cache,
    )
    return SameIPRegistrationsResponse(success=True, data=data)

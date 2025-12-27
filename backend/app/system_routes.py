"""
System API Routes for NewAPI Middleware Tool.
Provides system scale detection and settings endpoints.
"""
from typing import Any, Dict

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .auth import verify_auth
from .system_scale_service import get_scale_service, refresh_scale_detection


router = APIRouter(prefix="/api/system", tags=["System"])


class ScaleResponse(BaseModel):
    """Response model for system scale."""
    success: bool
    data: Dict[str, Any]


@router.get("/scale", response_model=ScaleResponse)
async def get_system_scale(
    _: str = Depends(verify_auth),
):
    """
    获取系统规模检测结果和推荐设置。
    
    返回:
    - scale: 系统规模级别 (small/medium/large/xlarge)
    - metrics: 检测指标 (用户数、日志量等)
    - settings: 推荐设置 (缓存TTL、刷新间隔等)
    """
    service = get_scale_service()
    result = service.detect_scale()
    return ScaleResponse(success=True, data=result)


@router.post("/scale/refresh", response_model=ScaleResponse)
async def refresh_system_scale(
    _: str = Depends(verify_auth),
):
    """
    强制刷新系统规模检测。
    
    用于在系统规模发生变化后手动触发重新检测。
    """
    result = refresh_scale_detection()
    return ScaleResponse(success=True, data=result)

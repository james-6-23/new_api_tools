"""
用户管理 API 路由 - NewAPI Middleware Tool
提供用户列表、活跃度统计、删除用户等接口
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi import Request
from pydantic import BaseModel

from .auth import decode_access_token, verify_auth
from .logger import logger
from .user_management_service import (
    ActivityLevel,
    get_user_management_service,
)


router = APIRouter(prefix="/api/users", tags=["User Management"])


# Response Models

class ActivityStatsResponse(BaseModel):
    """活跃度统计响应"""
    success: bool
    data: dict


class UserListResponse(BaseModel):
    """用户列表响应"""
    success: bool
    data: dict


class DeleteResponse(BaseModel):
    """删除响应"""
    success: bool
    message: str
    data: Optional[dict] = None


class BatchDeleteRequest(BaseModel):
    """批量删除请求"""
    activity_level: str = "very_inactive"  # very_inactive 或 never
    dry_run: bool = True  # 预演模式


class BanRequest(BaseModel):
    """封禁请求"""
    reason: Optional[str] = None
    disable_tokens: bool = True
    context: Optional[dict] = None


class UnbanRequest(BaseModel):
    """解除封禁请求"""
    reason: Optional[str] = None
    enable_tokens: bool = False
    context: Optional[dict] = None


def _get_operator_label(req: Request) -> str:
    auth = req.headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        token = auth.split(" ", 1)[1].strip()
        token_data = decode_access_token(token)
        if token_data:
            return token_data.sub
        return "jwt"
    if req.headers.get("X-API-Key"):
        return "api_key"
    return "unknown"


# API Endpoints

@router.get("/stats", response_model=ActivityStatsResponse)
async def get_activity_stats(
    _: str = Depends(verify_auth),
):
    """
    获取用户活跃度统计

    返回各活跃度级别的用户数量:
    - active: 最近 7 天内有请求
    - inactive: 7-30 天内有请求
    - very_inactive: 超过 30 天没有请求
    - never_requested: 从未请求
    """
    service = get_user_management_service()
    stats = service.get_activity_stats()

    return ActivityStatsResponse(
        success=True,
        data={
            "total_users": stats.total_users,
            "active_users": stats.active_users,
            "inactive_users": stats.inactive_users,
            "very_inactive_users": stats.very_inactive_users,
            "never_requested": stats.never_requested,
        }
    )


@router.get("", response_model=UserListResponse)
async def get_users(
    page: int = Query(default=1, ge=1, description="页码"),
    page_size: int = Query(default=20, ge=1, le=100, description="每页数量"),
    activity: Optional[str] = Query(default=None, description="活跃度筛选: active/inactive/very_inactive/never"),
    search: Optional[str] = Query(default=None, description="搜索关键词 (用户名/邮箱)"),
    order_by: str = Query(default="last_request_time", description="排序字段"),
    order_dir: str = Query(default="DESC", description="排序方向: ASC/DESC"),
    _: str = Depends(verify_auth),
):
    """
    获取用户列表

    支持按活跃度筛选、搜索、分页
    """
    # 转换活跃度筛选参数
    activity_filter = None
    if activity:
        try:
            activity_filter = ActivityLevel(activity)
        except ValueError:
            pass

    service = get_user_management_service()
    result = service.get_users(
        page=page,
        page_size=page_size,
        activity_filter=activity_filter,
        search=search,
        order_by=order_by,
        order_dir=order_dir,
    )

    # 序列化用户数据
    items = []
    for user in result["items"]:
        items.append({
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "email": user.email,
            "role": user.role,
            "status": user.status,
            "quota": user.quota,
            "used_quota": user.used_quota,
            "request_count": user.request_count,
            "group": user.group,
            "last_request_time": user.last_request_time,
            "activity_level": user.activity_level.value,
        })

    return UserListResponse(
        success=True,
        data={
            "items": items,
            "total": result["total"],
            "page": result["page"],
            "page_size": result["page_size"],
            "total_pages": result["total_pages"],
        }
    )


@router.delete("/{user_id}", response_model=DeleteResponse)
async def delete_user(
    user_id: int,
    _: str = Depends(verify_auth),
):
    """
    删除单个用户（软删除）

    同时会软删除用户的所有 Token
    """
    service = get_user_management_service()
    result = service.delete_user(user_id)

    return DeleteResponse(
        success=result["success"],
        message=result["message"],
    )


@router.post("/batch-delete", response_model=DeleteResponse)
async def batch_delete_inactive_users(
    request: BatchDeleteRequest,
    _: str = Depends(verify_auth),
):
    """
    批量删除不活跃用户

    - **activity_level**: 要删除的活跃度级别 (very_inactive 或 never)
    - **dry_run**: 预演模式，为 true 时只返回将被删除的用户数量，不实际删除

    **警告**: 此操作不可恢复（软删除）。建议先使用 dry_run=true 预览。
    """
    # 转换活跃度级别
    try:
        level = ActivityLevel(request.activity_level)
    except ValueError:
        return DeleteResponse(
            success=False,
            message=f"无效的活跃度级别: {request.activity_level}",
        )

    if level not in [ActivityLevel.VERY_INACTIVE, ActivityLevel.NEVER]:
        return DeleteResponse(
            success=False,
            message="只能批量删除 very_inactive 或 never 级别的用户",
        )

    service = get_user_management_service()
    result = service.batch_delete_inactive_users(
        activity_level=level,
        dry_run=request.dry_run,
    )

    if request.dry_run:
        logger.business(
            "批量删除预览",
            activity_level=request.activity_level,
            count=result.get("count", 0)
        )

    return DeleteResponse(
        success=result["success"],
        message=result["message"],
        data={
            "count": result.get("count", 0),
            "dry_run": result.get("dry_run", False),
            "users": result.get("users", []),
        } if result["success"] else None,
    )


@router.post("/{user_id}/ban", response_model=DeleteResponse)
async def ban_user(
    user_id: int,
    request: BanRequest,
    req: Request,
    _: str = Depends(verify_auth),
):
    """封禁用户（status=2），可选同时禁用其 tokens。"""
    service = get_user_management_service()
    operator = _get_operator_label(req)
    result = service.ban_user(
        user_id=user_id,
        reason=request.reason,
        disable_tokens=request.disable_tokens,
        operator=operator,
        context=request.context,
    )
    return DeleteResponse(
        success=result["success"],
        message=result["message"],
        data=result.get("data"),
    )


@router.post("/{user_id}/unban", response_model=DeleteResponse)
async def unban_user(
    user_id: int,
    request: UnbanRequest,
    req: Request,
    _: str = Depends(verify_auth),
):
    """解除封禁（status=1），可选同时启用其 tokens。"""
    service = get_user_management_service()
    operator = _get_operator_label(req)
    result = service.unban_user(
        user_id=user_id,
        reason=request.reason,
        enable_tokens=request.enable_tokens,
        operator=operator,
        context=request.context,
    )
    return DeleteResponse(
        success=result["success"],
        message=result["message"],
        data=result.get("data"),
    )

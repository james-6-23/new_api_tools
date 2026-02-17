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
    activity_level: str = "very_inactive"  # very_inactive, inactive 或 never
    dry_run: bool = True  # 预演模式
    hard_delete: bool = False  # 彻底删除模式（物理删除）


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


class DisableTokenRequest(BaseModel):
    """禁用令牌请求"""
    reason: Optional[str] = None
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
    quick: bool = Query(default=False, description="快速模式，只返回总用户数和从未请求数"),
    _: str = Depends(verify_auth),
):
    """
    获取用户活跃度统计

    返回各活跃度级别的用户数量:
    - active: 最近 7 天内有请求
    - inactive: 7-30 天内有请求
    - very_inactive: 超过 30 天没有请求
    - never_requested: 从未请求
    
    参数:
    - quick: 快速模式，只返回总用户数和从未请求数（毫秒级响应）
             适用于大型系统首次加载时快速显示基础数据
    """
    service = get_user_management_service()
    stats = service.get_activity_stats(quick=quick)

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


@router.get("/banned", response_model=UserListResponse)
async def get_banned_users(
    page: int = Query(default=1, ge=1, description="页码"),
    page_size: int = Query(default=50, ge=1, le=100, description="每页数量"),
    search: Optional[str] = Query(default=None, description="搜索关键词 (用户名)"),
    _: str = Depends(verify_auth),
):
    """
    获取当前被封禁的用户列表
    
    返回 status=2 的用户，包含封禁时间、原因等信息
    """
    service = get_user_management_service()
    result = service.get_banned_users(page=page, page_size=page_size, search=search)
    
    return UserListResponse(success=True, data=result)


@router.get("", response_model=UserListResponse)
async def get_users(
    page: int = Query(default=1, ge=1, description="页码"),
    page_size: int = Query(default=20, ge=1, le=100, description="每页数量"),
    activity: Optional[str] = Query(default=None, description="活跃度筛选: active/inactive/very_inactive/never"),
    group: Optional[str] = Query(default=None, description="分组筛选"),
    source: Optional[str] = Query(default=None, description="注册来源筛选: github/wechat/telegram/discord/oidc/linux_do/password"),
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
        group_filter=group,
        source_filter=source,
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
            "linux_do_id": user.linux_do_id,
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


class DeleteUserRequest(BaseModel):
    """删除用户请求"""
    hard_delete: bool = False  # 是否彻底删除


@router.delete("/{user_id}", response_model=DeleteResponse)
async def delete_user(
    user_id: int,
    hard_delete: bool = False,
    _: str = Depends(verify_auth),
):
    """
    删除单个用户
    
    - **hard_delete**: 是否彻底删除（物理删除）
      - false（默认）：注销用户，数据保留可恢复
      - true：彻底删除，永久移除用户及所有关联数据
    """
    service = get_user_management_service()
    result = service.delete_user(user_id, hard_delete=hard_delete)

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

    - **activity_level**: 要删除的活跃度级别 (very_inactive, inactive 或 never)
    - **dry_run**: 预演模式，为 true 时只返回将被删除的用户数量，不实际删除
    - **hard_delete**: 彻底删除模式，为 true 时物理删除用户及所有关联数据

    **警告**: 
    - 软删除（hard_delete=false）：用户数据保留，可通过数据库恢复
    - 彻底删除（hard_delete=true）：永久删除用户及关联数据，不可恢复！
    
    建议先使用 dry_run=true 预览。
    """
    # 转换活跃度级别
    try:
        level = ActivityLevel(request.activity_level)
    except ValueError:
        return DeleteResponse(
            success=False,
            message=f"无效的活跃度级别: {request.activity_level}",
        )

    if level not in [ActivityLevel.VERY_INACTIVE, ActivityLevel.INACTIVE, ActivityLevel.NEVER]:
        return DeleteResponse(
            success=False,
            message="只能批量删除 very_inactive、inactive 或 never 级别的用户",
        )

    service = get_user_management_service()
    result = service.batch_delete_inactive_users(
        activity_level=level,
        dry_run=request.dry_run,
        hard_delete=request.hard_delete,
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


class PurgeSoftDeletedRequest(BaseModel):
    """清理软删除用户请求"""
    dry_run: bool = True  # 预览模式


@router.get("/soft-deleted/count", response_model=DeleteResponse)
async def get_soft_deleted_count(
    _: str = Depends(verify_auth),
):
    """获取已软删除用户的数量"""
    service = get_user_management_service()
    result = service.get_soft_deleted_users_count()
    return DeleteResponse(
        success=result["success"],
        message=result.get("message", ""),
        data={"count": result.get("count", 0)},
    )


@router.post("/soft-deleted/purge", response_model=DeleteResponse)
async def purge_soft_deleted_users(
    request: PurgeSoftDeletedRequest,
    _: str = Depends(verify_auth),
):
    """
    彻底清理已软删除的用户（物理删除）
    
    - **dry_run**: 预览模式，为 true 时只返回将被清理的用户数量
    
    **警告**: 此操作会永久删除用户及所有关联数据，不可恢复！
    """
    service = get_user_management_service()
    result = service.purge_soft_deleted_users(dry_run=request.dry_run)
    
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


@router.post("/tokens/{token_id}/disable", response_model=DeleteResponse)
async def disable_token(
    token_id: int,
    request: DisableTokenRequest,
    req: Request,
    _: str = Depends(verify_auth),
):
    """禁用单个令牌（status=2）。"""
    service = get_user_management_service()
    operator = _get_operator_label(req)
    result = service.disable_token(
        token_id=token_id,
        reason=request.reason,
        operator=operator,
        context=request.context,
    )
    return DeleteResponse(
        success=result["success"],
        message=result["message"],
        data=result.get("data"),
    )


class InvitedUsersResponse(BaseModel):
    """邀请用户列表响应"""
    success: bool
    data: dict


@router.get("/{user_id}/invited", response_model=InvitedUsersResponse)
async def get_user_invited_list(
    user_id: int,
    page: int = Query(default=1, ge=1, description="页码"),
    page_size: int = Query(default=20, ge=1, le=100, description="每页数量"),
    _: str = Depends(verify_auth),
):
    """
    获取用户邀请的账号列表
    
    返回该用户通过邀请码邀请的所有用户，包含：
    - 邀请人信息（aff_code, aff_count 等）
    - 被邀请用户列表
    - 统计信息（活跃数、封禁数、总消耗等）
    """
    service = get_user_management_service()
    result = service.get_user_invited_list(
        user_id=user_id,
        page=page,
        page_size=page_size,
    )
    
    return InvitedUsersResponse(success=result.get("success", True), data=result)

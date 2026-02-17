"""
自动分组 API 路由 - NewAPI Middleware Tool
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List

from .auth import verify_auth
from .auto_group_service import get_auto_group_service


router = APIRouter(prefix="/api/auto-group", tags=["Auto Group"])


class SaveConfigRequest(BaseModel):
    """保存配置请求"""
    enabled: Optional[bool] = None
    mode: Optional[str] = None  # "simple" 或 "by_source"
    target_group: Optional[str] = None
    source_rules: Optional[dict] = None
    scan_interval_minutes: Optional[int] = None
    auto_scan_enabled: Optional[bool] = None
    whitelist_ids: Optional[List[int]] = None


class BatchMoveRequest(BaseModel):
    """批量移动请求"""
    user_ids: List[int]
    target_group: str


class RevertRequest(BaseModel):
    """恢复请求"""
    log_id: int


@router.get("/config")
async def get_config(_: str = Depends(verify_auth)):
    """获取自动分组配置"""
    service = get_auto_group_service()
    return {
        "success": True,
        "data": service.get_config(),
    }


@router.post("/config")
async def save_config(
    request: SaveConfigRequest,
    _: str = Depends(verify_auth),
):
    """保存自动分组配置"""
    service = get_auto_group_service()

    config = {}
    if request.enabled is not None:
        config["enabled"] = request.enabled
    if request.mode is not None:
        if request.mode not in ["simple", "by_source"]:
            raise HTTPException(status_code=400, detail="无效的分组模式")
        config["mode"] = request.mode
    if request.target_group is not None:
        config["target_group"] = request.target_group
    if request.source_rules is not None:
        config["source_rules"] = request.source_rules
    if request.scan_interval_minutes is not None:
        if request.scan_interval_minutes < 1 or request.scan_interval_minutes > 1440:
            raise HTTPException(status_code=400, detail="扫描间隔必须在 1-1440 分钟之间")
        config["scan_interval_minutes"] = request.scan_interval_minutes
    if request.auto_scan_enabled is not None:
        config["auto_scan_enabled"] = request.auto_scan_enabled
    if request.whitelist_ids is not None:
        config["whitelist_ids"] = request.whitelist_ids

    if not config:
        raise HTTPException(status_code=400, detail="没有要保存的配置")

    success = service.save_config(config)

    if success:
        return {
            "success": True,
            "message": "配置已保存",
            "data": service.get_config(),
        }
    else:
        raise HTTPException(status_code=500, detail="保存配置失败")


@router.get("/stats")
async def get_stats(_: str = Depends(verify_auth)):
    """获取统计信息"""
    service = get_auto_group_service()
    return {
        "success": True,
        "data": service.get_stats(),
    }


@router.get("/groups")
async def get_available_groups(_: str = Depends(verify_auth)):
    """获取所有可用分组列表"""
    service = get_auto_group_service()
    groups = service.get_available_groups()
    return {
        "success": True,
        "data": {
            "items": groups,
            "total": len(groups),
        },
    }


@router.get("/preview")
async def get_pending_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    _: str = Depends(verify_auth),
):
    """预览待分配用户"""
    service = get_auto_group_service()
    result = service.get_pending_users(page=page, page_size=page_size)
    return {
        "success": True,
        "data": result,
    }


@router.get("/users")
async def get_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    group: Optional[str] = Query(default=None, description="按当前分组筛选"),
    source: Optional[str] = Query(default=None, description="按注册来源筛选"),
    keyword: Optional[str] = Query(default=None, description="按用户名/ID搜索"),
    _: str = Depends(verify_auth),
):
    """获取用户列表（支持筛选）"""
    service = get_auto_group_service()

    # 验证来源参数
    valid_sources = ["github", "wechat", "telegram", "discord", "oidc", "linux_do", "password"]
    if source and source not in valid_sources:
        raise HTTPException(status_code=400, detail=f"无效的注册来源: {source}")

    result = service.get_users(
        page=page,
        page_size=page_size,
        group=group,
        source=source,
        keyword=keyword,
    )
    return {
        "success": True,
        "data": result,
    }


@router.post("/scan")
async def run_scan(
    dry_run: bool = Query(default=True, description="是否为试运行模式"),
    _: str = Depends(verify_auth),
):
    """执行扫描分配"""
    service = get_auto_group_service()

    if not service.is_enabled():
        raise HTTPException(status_code=400, detail="自动分组功能未启用")

    result = service.run_scan(dry_run=dry_run, operator="admin")
    return {
        "success": result.get("success", False),
        "data": result,
    }


@router.post("/batch-move")
async def batch_move_users(
    request: BatchMoveRequest,
    _: str = Depends(verify_auth),
):
    """批量移动用户到指定分组"""
    service = get_auto_group_service()

    if not request.user_ids:
        raise HTTPException(status_code=400, detail="未选择用户")

    if not request.target_group:
        raise HTTPException(status_code=400, detail="未指定目标分组")

    result = service.batch_move_users(
        user_ids=request.user_ids,
        target_group=request.target_group,
        operator="admin",
    )
    return {
        "success": result.get("success", False),
        "data": result,
    }


@router.get("/logs")
async def get_logs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    action: Optional[str] = Query(default=None, description="按操作类型筛选"),
    user_id: Optional[int] = Query(default=None, description="按用户ID筛选"),
    _: str = Depends(verify_auth),
):
    """获取分配日志"""
    service = get_auto_group_service()
    result = service.get_logs(
        page=page,
        page_size=page_size,
        action=action,
        user_id=user_id,
    )
    return {
        "success": True,
        "data": result,
    }


@router.post("/revert")
async def revert_user(
    request: RevertRequest,
    _: str = Depends(verify_auth),
):
    """恢复用户到原分组"""
    service = get_auto_group_service()
    result = service.revert_user(log_id=request.log_id, operator="admin")
    return {
        "success": result.get("success", False),
        "message": result.get("message", ""),
        "data": result,
    }

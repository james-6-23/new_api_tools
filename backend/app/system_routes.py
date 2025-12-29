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


class WarmupStatusResponse(BaseModel):
    """Response model for warmup status."""
    success: bool
    data: Dict[str, Any]


class IndexStatusResponse(BaseModel):
    """Response model for index status."""
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


@router.get("/warmup-status", response_model=WarmupStatusResponse)
async def get_warmup_status(
    _: str = Depends(verify_auth),
):
    """
    获取系统预热状态。
    
    返回:
    - status: 状态 (pending/initializing/ready)
    - progress: 进度百分比 (0-100)
    - message: 当前状态描述
    - steps: 预热步骤详情
    """
    from .main import get_warmup_status as _get_warmup_status
    status = _get_warmup_status()
    return WarmupStatusResponse(success=True, data=status)


@router.get("/indexes", response_model=IndexStatusResponse)
async def get_index_status(
    _: str = Depends(verify_auth),
):
    """
    获取数据库索引状态。
    
    返回:
    - indexes: 各索引的存在状态
    - total: 总索引数
    - existing: 已存在数
    - missing: 缺失数
    - all_ready: 是否全部就绪
    """
    from .database import get_db_manager
    db = get_db_manager()
    db.connect()
    status = db.get_index_status()
    return IndexStatusResponse(success=True, data=status)


@router.post("/indexes/ensure", response_model=IndexStatusResponse)
async def ensure_indexes(
    _: str = Depends(verify_auth),
):
    """
    手动触发索引创建。

    安全操作，不会影响 NewAPI 正常运行。
    索引创建可能需要几分钟，取决于数据量。

    关键索引 idx_logs_created_type_user 可将 3d 查询从 858s 降到 <10s。
    """
    import asyncio
    from .database import get_db_manager
    from .logger import logger

    db = get_db_manager()
    db.connect()

    # 先检查状态
    before_status = db.get_index_status()
    missing_before = before_status.get("missing", 0)

    if missing_before == 0:
        return IndexStatusResponse(
            success=True,
            data={
                "message": "所有索引已存在，无需创建",
                "status": before_status
            }
        )

    logger.system(f"手动触发索引创建，缺失 {missing_before} 个索引...")

    # 在线程池中执行索引创建（避免阻塞）
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, db.ensure_indexes_async_safe)

    # 检查创建后状态
    after_status = db.get_index_status()
    created_count = missing_before - after_status.get("missing", 0)

    logger.success(f"索引创建完成，新建 {created_count} 个")

    return IndexStatusResponse(
        success=True,
        data={
            "message": f"索引创建完成，新建 {created_count} 个",
            "created": created_count,
            "status": after_status
        }
    )



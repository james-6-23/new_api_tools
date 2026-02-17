"""
Local Storage API Routes for NewAPI Middleware Tool.
Implements configuration and cache management endpoints.
"""
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .auth import verify_auth
from .local_storage import get_local_storage
from .cache import get_cache_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/storage", tags=["Local Storage"])


# Request/Response Models

class ConfigSetRequest(BaseModel):
    """Request model for setting configuration."""
    key: str = Field(..., min_length=1, max_length=100)
    value: Any
    description: Optional[str] = ""


class ConfigResponse(BaseModel):
    """Response model for configuration."""
    success: bool
    data: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


class CacheResponse(BaseModel):
    """Response model for cache operations."""
    success: bool
    data: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


class StorageInfoResponse(BaseModel):
    """Response model for storage info."""
    success: bool
    data: Dict[str, Any]


# Configuration Endpoints

@router.get("/config", response_model=ConfigResponse)
async def get_all_configs(
    _: str = Depends(verify_auth),
):
    """
    获取所有配置项。
    """
    storage = get_local_storage()
    configs = storage.get_all_configs()

    return ConfigResponse(
        success=True,
        data={
            key: {
                "value": entry.value,
                "description": entry.description,
                "updated_at": entry.updated_at,
            }
            for key, entry in configs.items()
        },
    )


@router.get("/config/{key}", response_model=ConfigResponse)
async def get_config(
    key: str,
    _: str = Depends(verify_auth),
):
    """
    获取单个配置项。
    """
    storage = get_local_storage()
    value = storage.get_config(key)

    if value is None:
        return ConfigResponse(
            success=False,
            message=f"Configuration key '{key}' not found",
        )

    return ConfigResponse(
        success=True,
        data={"key": key, "value": value},
    )


@router.post("/config", response_model=ConfigResponse)
async def set_config(
    request: ConfigSetRequest,
    _: str = Depends(verify_auth),
):
    """
    设置配置项。
    """
    storage = get_local_storage()
    storage.set_config(request.key, request.value, request.description or "")

    logger.info(f"Configuration set: {request.key}")

    return ConfigResponse(
        success=True,
        message=f"Configuration '{request.key}' saved successfully",
        data={"key": request.key, "value": request.value},
    )


@router.delete("/config/{key}", response_model=ConfigResponse)
async def delete_config(
    key: str,
    _: str = Depends(verify_auth),
):
    """
    删除配置项。
    """
    storage = get_local_storage()
    deleted = storage.delete_config(key)

    if deleted:
        logger.info(f"Configuration deleted: {key}")
        return ConfigResponse(
            success=True,
            message=f"Configuration '{key}' deleted successfully",
        )
    else:
        return ConfigResponse(
            success=False,
            message=f"Configuration '{key}' not found",
        )


# Cache Management Endpoints

@router.get("/cache/info", response_model=StorageInfoResponse)
async def get_cache_info(
    _: str = Depends(verify_auth),
):
    """
    获取缓存存储信息。
    """
    manager = get_cache_manager()
    info = manager.get_info()

    return StorageInfoResponse(
        success=True,
        data=info,
    )


@router.post("/cache/cleanup", response_model=CacheResponse)
async def cleanup_cache(
    _: str = Depends(verify_auth),
):
    """
    清理过期缓存和旧快照。
    """
    manager = get_cache_manager()
    result = manager.cleanup()

    logger.info(f"Cache cleanup: {result}")

    return CacheResponse(
        success=True,
        message="Cache cleanup completed",
        data=result,
    )


@router.delete("/cache", response_model=CacheResponse)
async def clear_all_cache(
    _: str = Depends(verify_auth),
):
    """
    清空所有缓存。
    """
    manager = get_cache_manager()
    deleted = manager.clear_all()

    logger.info(f"Cleared all cache: {deleted} entries")

    return CacheResponse(
        success=True,
        message=f"Cleared {deleted} cache entries",
        data={"deleted": deleted},
    )


@router.delete("/cache/dashboard", response_model=CacheResponse)
async def clear_dashboard_cache(
    _: str = Depends(verify_auth),
):
    """
    清空仪表板缓存。
    """
    manager = get_cache_manager()
    deleted = manager.clear_dashboard()

    # 同步清理统一缓存管理器（SQLite + Redis）中的 Dashboard 缓存
    try:
        from .cache_manager import get_cache_manager as get_new_cache_manager
        new_cache = get_new_cache_manager()
        deleted_unified = new_cache.clear_generic_prefix("dashboard:")
    except Exception:
        deleted_unified = 0

    logger.info(f"Cleared dashboard cache: local={deleted} unified={deleted_unified}")

    return CacheResponse(
        success=True,
        message=f"Cleared dashboard cache entries",
        data={
            "deleted": deleted + deleted_unified,
            "local_deleted": deleted,
            "unified_deleted": deleted_unified,
        },
    )


# 新缓存管理器状态端点

@router.get("/cache/stats", response_model=StorageInfoResponse)
async def get_cache_stats(
    _: str = Depends(verify_auth),
):
    """
    获取新缓存管理器（SQLite + Redis）的统计信息。
    """
    from .cache_manager import get_cache_manager as get_new_cache_manager
    
    cache = get_new_cache_manager()
    stats = cache.get_stats()
    
    return StorageInfoResponse(
        success=True,
        data=stats,
    )


@router.post("/cache/cleanup-expired", response_model=CacheResponse)
async def cleanup_expired_cache(
    _: str = Depends(verify_auth),
):
    """
    清理新缓存管理器中的过期数据。
    """
    from .cache_manager import get_cache_manager as get_new_cache_manager
    
    cache = get_new_cache_manager()
    deleted = cache.cleanup_expired()
    
    return CacheResponse(
        success=True,
        message=f"Cleaned up {deleted} expired cache entries",
        data={"deleted": deleted},
    )


# Storage Info Endpoint

@router.get("/info", response_model=StorageInfoResponse)
async def get_storage_info(
    _: str = Depends(verify_auth),
):
    """
    获取本地存储统计信息。
    """
    storage = get_local_storage()
    info = storage.get_storage_info()

    return StorageInfoResponse(
        success=True,
        data=info,
    )

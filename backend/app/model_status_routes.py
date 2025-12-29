"""
Model Status Monitoring API Routes for NewAPI Middleware Tool.
Provides endpoints for 24-hour model status monitoring.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from .auth import verify_auth
from .model_status_service import get_model_status_service, HourlyStatus, ModelStatus
from .logger import logger

router = APIRouter(prefix="/api/model-status", tags=["Model Status"])

# Redis key for selected models config
SELECTED_MODELS_CACHE_KEY = "model_status:selected_models"


# Response Models

class HourlyStatusItem(BaseModel):
    """Hourly status item."""
    hour: int
    start_time: int
    end_time: int
    total_requests: int
    success_count: int
    success_rate: float
    status: str


class ModelStatusItem(BaseModel):
    """Model status item."""
    model_name: str
    display_name: str
    total_requests_24h: int
    success_count_24h: int
    success_rate_24h: float
    current_status: str
    hourly_data: List[HourlyStatusItem]


class AvailableModelsResponse(BaseModel):
    """Response for available models endpoint."""
    success: bool
    data: List[str]


class ModelStatusResponse(BaseModel):
    """Response for single model status endpoint."""
    success: bool
    data: Optional[ModelStatusItem] = None
    message: Optional[str] = None


class MultipleModelsStatusResponse(BaseModel):
    """Response for multiple models status endpoint."""
    success: bool
    data: List[ModelStatusItem]
    cache_ttl: int = 60  # Cache TTL in seconds for frontend


class SelectedModelsRequest(BaseModel):
    """Request for updating selected models."""
    models: List[str]


class SelectedModelsResponse(BaseModel):
    """Response for selected models endpoint."""
    success: bool
    data: List[str]
    message: Optional[str] = None


class EmbedConfigResponse(BaseModel):
    """Response for embed configuration."""
    success: bool
    data: dict


# Helper function to convert service objects to response models
def model_status_to_item(status: ModelStatus) -> ModelStatusItem:
    """Convert ModelStatus to ModelStatusItem."""
    return ModelStatusItem(
        model_name=status.model_name,
        display_name=status.display_name,
        total_requests_24h=status.total_requests_24h,
        success_count_24h=status.success_count_24h,
        success_rate_24h=status.success_rate_24h,
        current_status=status.current_status,
        hourly_data=[
            HourlyStatusItem(
                hour=h.hour,
                start_time=h.start_time,
                end_time=h.end_time,
                total_requests=h.total_requests,
                success_count=h.success_count,
                success_rate=h.success_rate,
                status=h.status,
            )
            for h in status.hourly_data
        ],
    )


@router.get("/models", response_model=AvailableModelsResponse)
async def get_available_models(_: str = Depends(verify_auth)):
    """
    Get list of all models with logs in the last 24 hours.
    """
    service = get_model_status_service()
    models = service.get_available_models()
    return AvailableModelsResponse(success=True, data=models)


@router.get("/status/{model_name}", response_model=ModelStatusResponse)
async def get_model_status(
    model_name: str,
    no_cache: bool = Query(False, description="Skip cache and fetch fresh data"),
    _: str = Depends(verify_auth),
):
    """
    Get 24-hour status for a specific model.
    
    Returns hourly breakdown with success rate and status color.
    """
    service = get_model_status_service()
    status = service.get_model_status(model_name, use_cache=not no_cache)
    
    if status:
        return ModelStatusResponse(
            success=True,
            data=model_status_to_item(status),
        )
    else:
        return ModelStatusResponse(
            success=False,
            message=f"Model '{model_name}' not found or has no recent logs",
        )


@router.post("/status/batch", response_model=MultipleModelsStatusResponse)
async def get_multiple_models_status(
    model_names: List[str],
    no_cache: bool = Query(False, description="Skip cache and fetch fresh data"),
    _: str = Depends(verify_auth),
):
    """
    Get 24-hour status for multiple models.
    
    Request body should contain a list of model names.
    """
    service = get_model_status_service()
    statuses = service.get_multiple_models_status(model_names, use_cache=not no_cache)
    
    return MultipleModelsStatusResponse(
        success=True,
        data=[model_status_to_item(s) for s in statuses],
        cache_ttl=60,
    )


@router.get("/status", response_model=MultipleModelsStatusResponse)
async def get_all_models_status(
    no_cache: bool = Query(False, description="Skip cache and fetch fresh data"),
    _: str = Depends(verify_auth),
):
    """
    Get 24-hour status for all available models.
    """
    service = get_model_status_service()
    statuses = service.get_all_models_status(use_cache=not no_cache)
    
    return MultipleModelsStatusResponse(
        success=True,
        data=[model_status_to_item(s) for s in statuses],
        cache_ttl=60,
    )


# ==================== Public Embed Endpoints (No Auth) ====================

@router.get("/embed/models", response_model=AvailableModelsResponse)
async def get_embed_available_models():
    """
    [Public] Get list of all models for embed view.
    No authentication required for iframe embedding.
    """
    service = get_model_status_service()
    models = service.get_available_models()
    return AvailableModelsResponse(success=True, data=models)


@router.get("/embed/status/{model_name}", response_model=ModelStatusResponse)
async def get_embed_model_status(
    model_name: str,
    no_cache: bool = Query(False, description="Skip cache and fetch fresh data"),
):
    """
    [Public] Get 24-hour status for a specific model.
    No authentication required for iframe embedding.
    """
    service = get_model_status_service()
    status = service.get_model_status(model_name, use_cache=not no_cache)
    
    if status:
        return ModelStatusResponse(
            success=True,
            data=model_status_to_item(status),
        )
    else:
        return ModelStatusResponse(
            success=False,
            message=f"Model '{model_name}' not found or has no recent logs",
        )


@router.post("/embed/status/batch", response_model=MultipleModelsStatusResponse)
async def get_embed_multiple_models_status(
    model_names: List[str],
    no_cache: bool = Query(False, description="Skip cache and fetch fresh data"),
):
    """
    [Public] Get 24-hour status for multiple models.
    No authentication required for iframe embedding.
    """
    service = get_model_status_service()
    statuses = service.get_multiple_models_status(model_names, use_cache=not no_cache)
    
    return MultipleModelsStatusResponse(
        success=True,
        data=[model_status_to_item(s) for s in statuses],
        cache_ttl=60,
    )


@router.get("/embed/status", response_model=MultipleModelsStatusResponse)
async def get_embed_all_models_status(
    no_cache: bool = Query(False, description="Skip cache and fetch fresh data"),
):
    """
    [Public] Get 24-hour status for all available models.
    No authentication required for iframe embedding.
    """
    service = get_model_status_service()
    statuses = service.get_all_models_status(use_cache=not no_cache)
    
    return MultipleModelsStatusResponse(
        success=True,
        data=[model_status_to_item(s) for s in statuses],
        cache_ttl=60,
    )


# ==================== Selected Models Config Endpoints ====================

def _get_selected_models_from_cache() -> List[str]:
    """Get selected models from Redis/SQLite cache."""
    import json
    from .cache_manager import get_cache_manager
    
    cache = get_cache_manager()
    
    # Try Redis first
    if cache._redis_available and cache._redis:
        try:
            data = cache._redis.get(SELECTED_MODELS_CACHE_KEY)
            if data:
                return json.loads(data)
        except Exception as e:
            logger.warn(f"Failed to get selected models from Redis: {e}")
    
    # Fallback to SQLite
    try:
        with cache._get_sqlite_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT data FROM generic_cache WHERE key = ?",
                (SELECTED_MODELS_CACHE_KEY,)
            )
            row = cursor.fetchone()
            if row:
                return json.loads(row[0])
    except Exception as e:
        logger.warn(f"Failed to get selected models from SQLite: {e}")
    
    return []


def _set_selected_models_to_cache(models: List[str]) -> bool:
    """Save selected models to Redis/SQLite cache."""
    import json
    import time
    from .cache_manager import get_cache_manager
    
    cache = get_cache_manager()
    data = json.dumps(models)
    now = int(time.time())
    # No expiration for config data
    expires_at = now + 86400 * 365  # 1 year
    
    success = False
    
    # Save to Redis
    if cache._redis_available and cache._redis:
        try:
            cache._redis.set(SELECTED_MODELS_CACHE_KEY, data)
            success = True
        except Exception as e:
            logger.warn(f"Failed to save selected models to Redis: {e}")
    
    # Always save to SQLite as backup
    try:
        with cache._get_sqlite_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO generic_cache (key, data, snapshot_time, expires_at)
                VALUES (?, ?, ?, ?)
            """, (SELECTED_MODELS_CACHE_KEY, data, now, expires_at))
            conn.commit()
            success = True
    except Exception as e:
        logger.warn(f"Failed to save selected models to SQLite: {e}")
    
    return success


@router.get("/config/selected", response_model=SelectedModelsResponse)
async def get_selected_models(_: str = Depends(verify_auth)):
    """
    Get the list of selected models for monitoring.
    """
    models = _get_selected_models_from_cache()
    return SelectedModelsResponse(success=True, data=models)


@router.post("/config/selected", response_model=SelectedModelsResponse)
async def set_selected_models(
    request: SelectedModelsRequest,
    _: str = Depends(verify_auth),
):
    """
    Update the list of selected models for monitoring.
    This will be used by the embed page.
    """
    success = _set_selected_models_to_cache(request.models)
    
    if success:
        logger.info(f"[模型状态] 已更新选中模型列表: {len(request.models)} 个模型")
        return SelectedModelsResponse(
            success=True,
            data=request.models,
            message=f"已保存 {len(request.models)} 个模型配置",
        )
    else:
        return SelectedModelsResponse(
            success=False,
            data=request.models,
            message="保存配置失败",
        )


# ==================== Public Embed Config Endpoint ====================

@router.get("/embed/config/selected", response_model=SelectedModelsResponse)
async def get_embed_selected_models():
    """
    [Public] Get the list of selected models for embed view.
    No authentication required for iframe embedding.
    """
    models = _get_selected_models_from_cache()
    return SelectedModelsResponse(success=True, data=models)

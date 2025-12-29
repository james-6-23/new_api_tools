"""
Model Status Monitoring API Routes for NewAPI Middleware Tool.
Provides endpoints for model status monitoring with configurable time windows.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from .auth import verify_auth
from .model_status_service import get_model_status_service, SlotStatus, ModelStatus, TIME_WINDOWS, DEFAULT_TIME_WINDOW
from .logger import logger

router = APIRouter(prefix="/api/model-status", tags=["Model Status"])

# Redis keys for config
SELECTED_MODELS_CACHE_KEY = "model_status:selected_models"
TIME_WINDOW_CACHE_KEY = "model_status:time_window"


# Response Models

class SlotStatusItem(BaseModel):
    """Time slot status item."""
    slot: int
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
    time_window: str
    total_requests: int
    success_count: int
    success_rate: float
    current_status: str
    slot_data: List[SlotStatusItem]


class AvailableModelsResponse(BaseModel):
    """Response for available models endpoint."""
    success: bool
    data: List[str]


class TimeWindowsResponse(BaseModel):
    """Response for available time windows."""
    success: bool
    data: List[str]
    default: str


class ModelStatusResponse(BaseModel):
    """Response for single model status endpoint."""
    success: bool
    data: Optional[ModelStatusItem] = None
    message: Optional[str] = None


class MultipleModelsStatusResponse(BaseModel):
    """Response for multiple models status endpoint."""
    success: bool
    data: List[ModelStatusItem]
    time_window: str
    cache_ttl: int = 60  # Cache TTL in seconds for frontend


class SelectedModelsRequest(BaseModel):
    """Request for updating selected models."""
    models: List[str]


class SelectedModelsResponse(BaseModel):
    """Response for selected models endpoint."""
    success: bool
    data: List[str]
    time_window: Optional[str] = None
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
        time_window=status.time_window,
        total_requests=status.total_requests,
        success_count=status.success_count,
        success_rate=status.success_rate,
        current_status=status.current_status,
        slot_data=[
            SlotStatusItem(
                slot=s.slot,
                start_time=s.start_time,
                end_time=s.end_time,
                total_requests=s.total_requests,
                success_count=s.success_count,
                success_rate=s.success_rate,
                status=s.status,
            )
            for s in status.slot_data
        ],
    )


@router.get("/windows", response_model=TimeWindowsResponse)
async def get_time_windows(_: str = Depends(verify_auth)):
    """
    Get available time windows.
    """
    return TimeWindowsResponse(
        success=True,
        data=list(TIME_WINDOWS.keys()),
        default=DEFAULT_TIME_WINDOW,
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
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
    no_cache: bool = Query(False, description="Skip cache and fetch fresh data"),
    _: str = Depends(verify_auth),
):
    """
    Get status for a specific model within a time window.
    
    Returns slot breakdown with success rate and status color.
    """
    service = get_model_status_service()
    status = service.get_model_status(model_name, window, use_cache=not no_cache)
    
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
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
    no_cache: bool = Query(False, description="Skip cache and fetch fresh data"),
    _: str = Depends(verify_auth),
):
    """
    Get status for multiple models within a time window.
    
    Request body should contain a list of model names.
    """
    service = get_model_status_service()
    statuses = service.get_multiple_models_status(model_names, window, use_cache=not no_cache)
    
    return MultipleModelsStatusResponse(
        success=True,
        data=[model_status_to_item(s) for s in statuses],
        time_window=window,
        cache_ttl=60,
    )


@router.get("/status", response_model=MultipleModelsStatusResponse)
async def get_all_models_status(
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
    no_cache: bool = Query(False, description="Skip cache and fetch fresh data"),
    _: str = Depends(verify_auth),
):
    """
    Get status for all available models within a time window.
    """
    service = get_model_status_service()
    statuses = service.get_all_models_status(window, use_cache=not no_cache)
    
    return MultipleModelsStatusResponse(
        success=True,
        data=[model_status_to_item(s) for s in statuses],
        time_window=window,
        cache_ttl=60,
    )


# ==================== Public Embed Endpoints (No Auth) ====================

@router.get("/embed/windows", response_model=TimeWindowsResponse)
async def get_embed_time_windows():
    """
    [Public] Get available time windows.
    No authentication required for iframe embedding.
    """
    return TimeWindowsResponse(
        success=True,
        data=list(TIME_WINDOWS.keys()),
        default=DEFAULT_TIME_WINDOW,
    )


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
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
    no_cache: bool = Query(False, description="Skip cache and fetch fresh data"),
):
    """
    [Public] Get status for a specific model within a time window.
    No authentication required for iframe embedding.
    """
    service = get_model_status_service()
    status = service.get_model_status(model_name, window, use_cache=not no_cache)
    
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
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
    no_cache: bool = Query(False, description="Skip cache and fetch fresh data"),
):
    """
    [Public] Get status for multiple models within a time window.
    No authentication required for iframe embedding.
    """
    service = get_model_status_service()
    statuses = service.get_multiple_models_status(model_names, window, use_cache=not no_cache)
    
    return MultipleModelsStatusResponse(
        success=True,
        data=[model_status_to_item(s) for s in statuses],
        time_window=window,
        cache_ttl=60,
    )


@router.get("/embed/status", response_model=MultipleModelsStatusResponse)
async def get_embed_all_models_status(
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
    no_cache: bool = Query(False, description="Skip cache and fetch fresh data"),
):
    """
    [Public] Get status for all available models within a time window.
    No authentication required for iframe embedding.
    """
    service = get_model_status_service()
    statuses = service.get_all_models_status(window, use_cache=not no_cache)
    
    return MultipleModelsStatusResponse(
        success=True,
        data=[model_status_to_item(s) for s in statuses],
        time_window=window,
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
        with cache._get_sqlite() as conn:
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


def _get_time_window_from_cache() -> str:
    """Get time window from Redis/SQLite cache."""
    from .cache_manager import get_cache_manager
    
    cache = get_cache_manager()
    
    # Try Redis first
    if cache._redis_available and cache._redis:
        try:
            data = cache._redis.get(TIME_WINDOW_CACHE_KEY)
            if data:
                return data.decode() if isinstance(data, bytes) else data
        except Exception as e:
            logger.warn(f"Failed to get time window from Redis: {e}")
    
    # Fallback to SQLite
    try:
        with cache._get_sqlite() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT data FROM generic_cache WHERE key = ?",
                (TIME_WINDOW_CACHE_KEY,)
            )
            row = cursor.fetchone()
            if row:
                return row[0]
    except Exception as e:
        logger.warn(f"Failed to get time window from SQLite: {e}")
    
    return DEFAULT_TIME_WINDOW


def _set_time_window_to_cache(window: str) -> bool:
    """Save time window to Redis/SQLite cache."""
    import time
    from .cache_manager import get_cache_manager
    
    cache = get_cache_manager()
    now = int(time.time())
    expires_at = now + 86400 * 365  # 1 year
    
    success = False
    
    # Save to Redis
    if cache._redis_available and cache._redis:
        try:
            cache._redis.set(TIME_WINDOW_CACHE_KEY, window)
            success = True
        except Exception as e:
            logger.warn(f"Failed to save time window to Redis: {e}")
    
    # Always save to SQLite as backup
    try:
        with cache._get_sqlite() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO generic_cache (key, data, snapshot_time, expires_at)
                VALUES (?, ?, ?, ?)
            """, (TIME_WINDOW_CACHE_KEY, window, now, expires_at))
            conn.commit()
            success = True
    except Exception as e:
        logger.warn(f"Failed to save time window to SQLite: {e}")
    
    return success


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
        with cache._get_sqlite() as conn:
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
    Get the list of selected models and time window for monitoring.
    """
    models = _get_selected_models_from_cache()
    time_window = _get_time_window_from_cache()
    return SelectedModelsResponse(success=True, data=models, time_window=time_window)


class UpdateConfigRequest(BaseModel):
    """Request for updating config (models and/or time window)."""
    models: Optional[List[str]] = None
    time_window: Optional[str] = None


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
    time_window = _get_time_window_from_cache()
    
    if success:
        return SelectedModelsResponse(
            success=True,
            data=request.models,
            time_window=time_window,
            message=f"已保存 {len(request.models)} 个模型配置",
        )
    else:
        return SelectedModelsResponse(
            success=False,
            data=request.models,
            time_window=time_window,
            message="保存配置失败",
        )


class TimeWindowRequest(BaseModel):
    """Request for updating time window."""
    time_window: str


class TimeWindowResponse(BaseModel):
    """Response for time window endpoint."""
    success: bool
    time_window: str
    message: Optional[str] = None


@router.get("/config/window", response_model=TimeWindowResponse)
async def get_time_window_config(_: str = Depends(verify_auth)):
    """
    Get the current time window setting.
    """
    time_window = _get_time_window_from_cache()
    return TimeWindowResponse(success=True, time_window=time_window)


@router.post("/config/window", response_model=TimeWindowResponse)
async def set_time_window_config(
    request: TimeWindowRequest,
    _: str = Depends(verify_auth),
):
    """
    Update the time window setting.
    """
    if request.time_window not in TIME_WINDOWS:
        return TimeWindowResponse(
            success=False,
            time_window=_get_time_window_from_cache(),
            message=f"无效的时间窗口: {request.time_window}",
        )
    
    success = _set_time_window_to_cache(request.time_window)
    
    if success:
        return TimeWindowResponse(
            success=True,
            time_window=request.time_window,
            message=f"已保存时间窗口: {request.time_window}",
        )
    else:
        return TimeWindowResponse(
            success=False,
            time_window=request.time_window,
            message="保存配置失败",
        )


# ==================== Public Embed Config Endpoint ====================

@router.get("/embed/config/selected", response_model=SelectedModelsResponse)
async def get_embed_selected_models():
    """
    [Public] Get the list of selected models and time window for embed view.
    No authentication required for iframe embedding.
    """
    models = _get_selected_models_from_cache()
    time_window = _get_time_window_from_cache()
    return SelectedModelsResponse(success=True, data=models, time_window=time_window)

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
THEME_CACHE_KEY = "model_status:theme"
REFRESH_INTERVAL_CACHE_KEY = "model_status:refresh_interval"
SORT_MODE_CACHE_KEY = "model_status:sort_mode"
CUSTOM_ORDER_CACHE_KEY = "model_status:custom_order"

# Available themes
AVAILABLE_THEMES = ["daylight", "obsidian", "minimal", "neon", "forest", "ocean", "terminal", "cupertino", "material", "openai", "anthropic", "vercel", "linear", "stripe", "github", "discord", "tesla"]
DEFAULT_THEME = "daylight"
# Legacy theme mapping for backwards compatibility
LEGACY_THEME_MAP = {"light": "daylight", "dark": "obsidian", "system": "daylight"}

# Available refresh intervals (in seconds)
AVAILABLE_REFRESH_INTERVALS = [0, 30, 60, 120, 300]  # 0 = disabled
DEFAULT_REFRESH_INTERVAL = 60

# Available sort modes
AVAILABLE_SORT_MODES = ["default", "availability", "custom"]
DEFAULT_SORT_MODE = "default"


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


class ModelWithStats(BaseModel):
    """Model with 24h request stats."""
    model_name: str
    request_count_24h: int


class AvailableModelsWithStatsResponse(BaseModel):
    """Response for available models with stats endpoint."""
    success: bool
    data: List[ModelWithStats]


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
    theme: Optional[str] = None
    refresh_interval: Optional[int] = None
    sort_mode: Optional[str] = None
    custom_order: Optional[List[str]] = None
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


@router.get("/models", response_model=AvailableModelsWithStatsResponse)
async def get_available_models(_: str = Depends(verify_auth)):
    """
    Get list of all models with 24h request counts.
    Models are sorted by request count (descending), models with no requests at the end.
    """
    service = get_model_status_service()
    models_with_stats = service.get_available_models_with_stats()
    return AvailableModelsWithStatsResponse(
        success=True,
        data=[ModelWithStats(**m) for m in models_with_stats]
    )


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


@router.get("/embed/models", response_model=AvailableModelsWithStatsResponse)
async def get_embed_available_models():
    """
    [Public] Get list of all models with 24h request counts for embed view.
    Models are sorted by request count (descending), models with no requests at the end.
    No authentication required for iframe embedding.
    """
    service = get_model_status_service()
    models_with_stats = service.get_available_models_with_stats()
    return AvailableModelsWithStatsResponse(
        success=True,
        data=[ModelWithStats(**m) for m in models_with_stats]
    )


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
):
    """
    [Public] Get status for multiple models within a time window.
    No authentication required for iframe embedding.
    Always uses cache to prevent database overload from high-traffic embed pages.
    """
    service = get_model_status_service()
    statuses = service.get_multiple_models_status(model_names, window, use_cache=True)
    
    return MultipleModelsStatusResponse(
        success=True,
        data=[model_status_to_item(s) for s in statuses],
        time_window=window,
        cache_ttl=60,
    )


@router.get("/embed/status", response_model=MultipleModelsStatusResponse)
async def get_embed_all_models_status(
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
):
    """
    [Public] Get status for all available models within a time window.
    No authentication required for iframe embedding.
    Always uses cache to prevent database overload from high-traffic embed pages.
    """
    service = get_model_status_service()
    statuses = service.get_all_models_status(window, use_cache=True)
    
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


def _get_theme_from_cache() -> str:
    """Get theme from Redis/SQLite cache."""
    from .cache_manager import get_cache_manager

    cache = get_cache_manager()
    theme = None

    # Try Redis first
    if cache._redis_available and cache._redis:
        try:
            data = cache._redis.get(THEME_CACHE_KEY)
            if data:
                theme = data.decode() if isinstance(data, bytes) else data
        except Exception as e:
            logger.warn(f"Failed to get theme from Redis: {e}")

    # Fallback to SQLite
    if theme is None:
        try:
            with cache._get_sqlite() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT data FROM generic_cache WHERE key = ?",
                    (THEME_CACHE_KEY,)
                )
                row = cursor.fetchone()
                if row:
                    theme = row[0]
        except Exception as e:
            logger.warn(f"Failed to get theme from SQLite: {e}")

    if theme is None:
        return DEFAULT_THEME

    # Map legacy theme names to valid ones
    return LEGACY_THEME_MAP.get(theme, theme)


def _set_theme_to_cache(theme: str) -> bool:
    """Save theme to Redis/SQLite cache."""
    import time
    from .cache_manager import get_cache_manager

    cache = get_cache_manager()
    now = int(time.time())
    expires_at = now + 86400 * 365  # 1 year

    success = False

    # Save to Redis
    if cache._redis_available and cache._redis:
        try:
            cache._redis.set(THEME_CACHE_KEY, theme)
            success = True
        except Exception as e:
            logger.warn(f"Failed to save theme to Redis: {e}")

    # Always save to SQLite as backup
    try:
        with cache._get_sqlite() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO generic_cache (key, data, snapshot_time, expires_at)
                VALUES (?, ?, ?, ?)
            """, (THEME_CACHE_KEY, theme, now, expires_at))
            conn.commit()
            success = True
    except Exception as e:
        logger.warn(f"Failed to save theme to SQLite: {e}")

    return success


def _get_refresh_interval_from_cache() -> int:
    """Get refresh interval from Redis/SQLite cache."""
    from .cache_manager import get_cache_manager

    cache = get_cache_manager()

    # Try Redis first
    if cache._redis_available and cache._redis:
        try:
            data = cache._redis.get(REFRESH_INTERVAL_CACHE_KEY)
            if data:
                value = data.decode() if isinstance(data, bytes) else data
                return int(value)
        except Exception as e:
            logger.warn(f"Failed to get refresh interval from Redis: {e}")

    # Fallback to SQLite
    try:
        with cache._get_sqlite() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT data FROM generic_cache WHERE key = ?",
                (REFRESH_INTERVAL_CACHE_KEY,)
            )
            row = cursor.fetchone()
            if row:
                return int(row[0])
    except Exception as e:
        logger.warn(f"Failed to get refresh interval from SQLite: {e}")

    return DEFAULT_REFRESH_INTERVAL


def _set_refresh_interval_to_cache(interval: int) -> bool:
    """Save refresh interval to Redis/SQLite cache."""
    import time
    from .cache_manager import get_cache_manager

    cache = get_cache_manager()
    now = int(time.time())
    expires_at = now + 86400 * 365  # 1 year

    success = False

    # Save to Redis
    if cache._redis_available and cache._redis:
        try:
            cache._redis.set(REFRESH_INTERVAL_CACHE_KEY, str(interval))
            success = True
        except Exception as e:
            logger.warn(f"Failed to save refresh interval to Redis: {e}")

    # Always save to SQLite as backup
    try:
        with cache._get_sqlite() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO generic_cache (key, data, snapshot_time, expires_at)
                VALUES (?, ?, ?, ?)
            """, (REFRESH_INTERVAL_CACHE_KEY, str(interval), now, expires_at))
            conn.commit()
            success = True
    except Exception as e:
        logger.warn(f"Failed to save refresh interval to SQLite: {e}")

    return success


def _get_sort_mode_from_cache() -> str:
    """Get sort mode from Redis/SQLite cache."""
    from .cache_manager import get_cache_manager

    cache = get_cache_manager()

    # Try Redis first
    if cache._redis_available and cache._redis:
        try:
            data = cache._redis.get(SORT_MODE_CACHE_KEY)
            if data:
                return data.decode() if isinstance(data, bytes) else data
        except Exception as e:
            logger.warn(f"Failed to get sort mode from Redis: {e}")

    # Fallback to SQLite
    try:
        with cache._get_sqlite() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT data FROM generic_cache WHERE key = ?",
                (SORT_MODE_CACHE_KEY,)
            )
            row = cursor.fetchone()
            if row:
                return row[0]
    except Exception as e:
        logger.warn(f"Failed to get sort mode from SQLite: {e}")

    return DEFAULT_SORT_MODE


def _set_sort_mode_to_cache(sort_mode: str) -> bool:
    """Save sort mode to Redis/SQLite cache."""
    import time
    from .cache_manager import get_cache_manager

    cache = get_cache_manager()
    now = int(time.time())
    expires_at = now + 86400 * 365  # 1 year

    success = False

    # Save to Redis
    if cache._redis_available and cache._redis:
        try:
            cache._redis.set(SORT_MODE_CACHE_KEY, sort_mode)
            success = True
        except Exception as e:
            logger.warn(f"Failed to save sort mode to Redis: {e}")

    # Always save to SQLite as backup
    try:
        with cache._get_sqlite() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO generic_cache (key, data, snapshot_time, expires_at)
                VALUES (?, ?, ?, ?)
            """, (SORT_MODE_CACHE_KEY, sort_mode, now, expires_at))
            conn.commit()
            success = True
    except Exception as e:
        logger.warn(f"Failed to save sort mode to SQLite: {e}")

    return success


def _get_custom_order_from_cache() -> List[str]:
    """Get custom order from Redis/SQLite cache."""
    import json
    from .cache_manager import get_cache_manager

    cache = get_cache_manager()

    # Try Redis first
    if cache._redis_available and cache._redis:
        try:
            data = cache._redis.get(CUSTOM_ORDER_CACHE_KEY)
            if data:
                return json.loads(data)
        except Exception as e:
            logger.warn(f"Failed to get custom order from Redis: {e}")

    # Fallback to SQLite
    try:
        with cache._get_sqlite() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT data FROM generic_cache WHERE key = ?",
                (CUSTOM_ORDER_CACHE_KEY,)
            )
            row = cursor.fetchone()
            if row:
                return json.loads(row[0])
    except Exception as e:
        logger.warn(f"Failed to get custom order from SQLite: {e}")

    return []


def _set_custom_order_to_cache(order: List[str]) -> bool:
    """Save custom order to Redis/SQLite cache."""
    import json
    import time
    from .cache_manager import get_cache_manager

    cache = get_cache_manager()
    data = json.dumps(order)
    now = int(time.time())
    expires_at = now + 86400 * 365  # 1 year

    success = False

    # Save to Redis
    if cache._redis_available and cache._redis:
        try:
            cache._redis.set(CUSTOM_ORDER_CACHE_KEY, data)
            success = True
        except Exception as e:
            logger.warn(f"Failed to save custom order to Redis: {e}")

    # Always save to SQLite as backup
    try:
        with cache._get_sqlite() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO generic_cache (key, data, snapshot_time, expires_at)
                VALUES (?, ?, ?, ?)
            """, (CUSTOM_ORDER_CACHE_KEY, data, now, expires_at))
            conn.commit()
            success = True
    except Exception as e:
        logger.warn(f"Failed to save custom order to SQLite: {e}")

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
    Get the list of selected models, time window, theme, refresh interval and sort config for monitoring.
    """
    models = _get_selected_models_from_cache()
    time_window = _get_time_window_from_cache()
    theme = _get_theme_from_cache()
    refresh_interval = _get_refresh_interval_from_cache()
    sort_mode = _get_sort_mode_from_cache()
    custom_order = _get_custom_order_from_cache()
    return SelectedModelsResponse(
        success=True, data=models, time_window=time_window, theme=theme,
        refresh_interval=refresh_interval, sort_mode=sort_mode, custom_order=custom_order
    )


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
    theme = _get_theme_from_cache()
    refresh_interval = _get_refresh_interval_from_cache()
    sort_mode = _get_sort_mode_from_cache()
    custom_order = _get_custom_order_from_cache()

    if success:
        return SelectedModelsResponse(
            success=True,
            data=request.models,
            time_window=time_window,
            theme=theme,
            refresh_interval=refresh_interval,
            sort_mode=sort_mode,
            custom_order=custom_order,
            message=f"已保存 {len(request.models)} 个模型配置",
        )
    else:
        return SelectedModelsResponse(
            success=False,
            data=request.models,
            time_window=time_window,
            theme=theme,
            refresh_interval=refresh_interval,
            sort_mode=sort_mode,
            custom_order=custom_order,
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


# ==================== Theme Config Endpoints ====================

class ThemeRequest(BaseModel):
    """Request for updating theme."""
    theme: str


class ThemeResponse(BaseModel):
    """Response for theme endpoint."""
    success: bool
    theme: str
    available_themes: List[str] = AVAILABLE_THEMES
    message: Optional[str] = None


@router.get("/config/theme", response_model=ThemeResponse)
async def get_theme_config(_: str = Depends(verify_auth)):
    """
    Get the current theme setting and available themes.
    """
    theme = _get_theme_from_cache()
    return ThemeResponse(success=True, theme=theme)


@router.post("/config/theme", response_model=ThemeResponse)
async def set_theme_config(
    request: ThemeRequest,
    _: str = Depends(verify_auth),
):
    """
    Update the theme setting for embed page.
    """
    # Map legacy theme names to valid ones
    theme = LEGACY_THEME_MAP.get(request.theme, request.theme)
    if theme not in AVAILABLE_THEMES:
        return ThemeResponse(
            success=False,
            theme=_get_theme_from_cache(),
            message=f"无效的主题: {request.theme}",
        )

    success = _set_theme_to_cache(theme)

    if success:
        return ThemeResponse(
            success=True,
            theme=theme,
            message=f"已保存主题: {theme}",
        )
    else:
        return ThemeResponse(
            success=False,
            theme=theme,
            message="保存配置失败",
        )


# ==================== Refresh Interval Config Endpoints ====================

class RefreshIntervalRequest(BaseModel):
    """Request for updating refresh interval."""
    refresh_interval: int


class RefreshIntervalResponse(BaseModel):
    """Response for refresh interval endpoint."""
    success: bool
    refresh_interval: int
    available_intervals: List[int] = AVAILABLE_REFRESH_INTERVALS
    message: Optional[str] = None


@router.get("/config/refresh", response_model=RefreshIntervalResponse)
async def get_refresh_interval_config(_: str = Depends(verify_auth)):
    """
    Get the current refresh interval setting and available options.
    """
    refresh_interval = _get_refresh_interval_from_cache()
    return RefreshIntervalResponse(success=True, refresh_interval=refresh_interval)


@router.post("/config/refresh", response_model=RefreshIntervalResponse)
async def set_refresh_interval_config(
    request: RefreshIntervalRequest,
    _: str = Depends(verify_auth),
):
    """
    Update the refresh interval setting for embed page.
    """
    if request.refresh_interval not in AVAILABLE_REFRESH_INTERVALS:
        return RefreshIntervalResponse(
            success=False,
            refresh_interval=_get_refresh_interval_from_cache(),
            message=f"无效的刷新间隔: {request.refresh_interval}",
        )

    success = _set_refresh_interval_to_cache(request.refresh_interval)

    if success:
        return RefreshIntervalResponse(
            success=True,
            refresh_interval=request.refresh_interval,
            message=f"已保存刷新间隔: {request.refresh_interval}秒",
        )
    else:
        return RefreshIntervalResponse(
            success=False,
            refresh_interval=request.refresh_interval,
            message="保存配置失败",
        )


# ==================== Sort Config Endpoints ====================

class SortConfigRequest(BaseModel):
    """Request for updating sort configuration."""
    sort_mode: str
    custom_order: Optional[List[str]] = None


class SortConfigResponse(BaseModel):
    """Response for sort configuration endpoint."""
    success: bool
    sort_mode: str
    custom_order: List[str]
    available_modes: List[str] = AVAILABLE_SORT_MODES
    message: Optional[str] = None


@router.get("/config/sort", response_model=SortConfigResponse)
async def get_sort_config(_: str = Depends(verify_auth)):
    """
    Get the current sort configuration.
    """
    sort_mode = _get_sort_mode_from_cache()
    custom_order = _get_custom_order_from_cache()
    return SortConfigResponse(success=True, sort_mode=sort_mode, custom_order=custom_order)


@router.post("/config/sort", response_model=SortConfigResponse)
async def set_sort_config(
    request: SortConfigRequest,
    _: str = Depends(verify_auth),
):
    """
    Update the sort configuration.
    - sort_mode: 'default' | 'availability' | 'custom'
    - custom_order: list of model names (only used when sort_mode is 'custom')
    """
    if request.sort_mode not in AVAILABLE_SORT_MODES:
        return SortConfigResponse(
            success=False,
            sort_mode=_get_sort_mode_from_cache(),
            custom_order=_get_custom_order_from_cache(),
            message=f"无效的排序模式: {request.sort_mode}",
        )

    success = _set_sort_mode_to_cache(request.sort_mode)

    # Save custom order if provided
    if request.custom_order is not None:
        _set_custom_order_to_cache(request.custom_order)

    custom_order = _get_custom_order_from_cache()

    if success:
        mode_labels = {"default": "默认", "availability": "高可用", "custom": "自定义"}
        return SortConfigResponse(
            success=True,
            sort_mode=request.sort_mode,
            custom_order=custom_order,
            message=f"已切换为{mode_labels.get(request.sort_mode, request.sort_mode)}排序",
        )
    else:
        return SortConfigResponse(
            success=False,
            sort_mode=request.sort_mode,
            custom_order=custom_order,
            message="保存配置失败",
        )


# ==================== Public Embed Config Endpoint ====================

@router.get("/embed/config/selected", response_model=SelectedModelsResponse)
async def get_embed_selected_models():
    """
    [Public] Get the list of selected models, time window, theme, refresh interval and sort config for embed view.
    No authentication required for iframe embedding.
    """
    models = _get_selected_models_from_cache()
    time_window = _get_time_window_from_cache()
    theme = _get_theme_from_cache()
    refresh_interval = _get_refresh_interval_from_cache()
    sort_mode = _get_sort_mode_from_cache()
    custom_order = _get_custom_order_from_cache()
    return SelectedModelsResponse(
        success=True, data=models, time_window=time_window, theme=theme,
        refresh_interval=refresh_interval, sort_mode=sort_mode, custom_order=custom_order
    )

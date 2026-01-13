"""
Uptime-Kuma Compatible API Routes for NewAPI Middleware Tool.
Provides endpoints compatible with uptime-kuma format for model status monitoring.

This allows the frontend model monitor component to work with uptime-kuma compatible clients.

Status Mapping (based on success_rate):
- 0 = DOWN: success_rate < 80%
- 1 = UP: success_rate >= 95%
- 2 = PENDING: 80% <= success_rate < 95%
- 3 = MAINTENANCE: not used currently
"""
import hashlib
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

from .model_status_service import (
    get_model_status_service,
    ModelStatus,
    SlotStatus,
    DEFAULT_TIME_WINDOW,
)
from .logger import logger

router = APIRouter(prefix="/api/uptime-kuma", tags=["Uptime-Kuma Compatible"])

# Status constants (matching uptime-kuma)
STATUS_DOWN = 0
STATUS_UP = 1
STATUS_PENDING = 2
STATUS_MAINTENANCE = 3


def _map_status_to_uptime_kuma(success_rate: float, total_requests: int) -> int:
    """
    Map model status to uptime-kuma status code based on success_rate.

    Thresholds:
    - UP (1): success_rate >= 95%
    - PENDING (2): 80% <= success_rate < 95%
    - DOWN (0): success_rate < 80%

    Args:
        success_rate: Success rate percentage (0-100)
        total_requests: Total number of requests

    Returns:
        uptime-kuma status code (0=DOWN, 1=UP, 2=PENDING)
    """
    if total_requests == 0:
        return STATUS_UP  # No requests = no issues

    if success_rate >= 95:
        return STATUS_UP
    elif success_rate >= 80:
        return STATUS_PENDING
    else:
        return STATUS_DOWN


def _get_status_text(status: int) -> str:
    """Get human-readable status text."""
    if status == STATUS_UP:
        return "UP"
    elif status == STATUS_DOWN:
        return "DOWN"
    elif status == STATUS_PENDING:
        return "PENDING"
    elif status == STATUS_MAINTENANCE:
        return "MAINTENANCE"
    return "UNKNOWN"


# ==================== Response Models ====================

class UptimeKumaHeartbeat(BaseModel):
    """Heartbeat data in uptime-kuma format."""
    monitorID: int
    status: int  # 0=DOWN, 1=UP, 2=PENDING, 3=MAINTENANCE
    time: str  # ISO format timestamp
    msg: str
    ping: Optional[int] = None  # Response time in ms (not applicable for model status)
    important: bool = False
    duration: Optional[int] = None


class UptimeKumaMonitor(BaseModel):
    """Monitor data in uptime-kuma format."""
    id: int
    name: str
    description: Optional[str] = None
    url: Optional[str] = None
    type: str = "model"  # Custom type for AI models
    interval: int = 60  # Check interval in seconds
    active: bool = True
    # Extended fields for model status
    model_name: str
    success_rate: float
    total_requests: int
    time_window: str


class UptimeKumaMonitorWithHeartbeats(UptimeKumaMonitor):
    """Monitor with recent heartbeats."""
    heartbeats: List[UptimeKumaHeartbeat] = []
    uptime_24h: Optional[float] = None


class UptimeKumaStatusPageMonitor(BaseModel):
    """Monitor summary for status page."""
    id: int
    name: str
    status: int
    uptime: float  # Uptime percentage
    heartbeats: List[UptimeKumaHeartbeat] = []


class UptimeKumaStatusPage(BaseModel):
    """Status page data in uptime-kuma format."""
    title: str = "Model Status"
    description: str = "AI Model Health Status"
    monitors: List[UptimeKumaStatusPageMonitor] = []
    overall_status: int = STATUS_UP
    overall_uptime: float = 100.0
    last_updated: str


class MonitorsResponse(BaseModel):
    """Response for monitors list."""
    success: bool
    data: List[UptimeKumaMonitor]


class MonitorDetailResponse(BaseModel):
    """Response for single monitor detail."""
    success: bool
    data: Optional[UptimeKumaMonitorWithHeartbeats] = None
    message: Optional[str] = None


class HeartbeatsResponse(BaseModel):
    """Response for heartbeats list."""
    success: bool
    data: List[UptimeKumaHeartbeat]
    monitor_id: int


class StatusPageResponse(BaseModel):
    """Response for status page."""
    success: bool
    data: UptimeKumaStatusPage


# ==================== Helper Functions ====================

def _model_name_to_id(model_name: str) -> int:
    """
    Convert model name to a stable numeric ID.
    Uses MD5 hash to generate consistent IDs across restarts.
    """
    # Use MD5 for stable hash across Python processes/restarts
    hash_bytes = hashlib.md5(model_name.encode('utf-8')).digest()
    # Take first 4 bytes and convert to int, then mod to fit in reasonable range
    return int.from_bytes(hash_bytes[:4], 'big') % (10 ** 9)


def _slot_to_heartbeat(slot: SlotStatus, monitor_id: int) -> UptimeKumaHeartbeat:
    """Convert SlotStatus to UptimeKumaHeartbeat."""
    status = _map_status_to_uptime_kuma(slot.success_rate, slot.total_requests)

    # Build message
    if slot.total_requests == 0:
        msg = "No requests in this period"
    else:
        msg = f"{slot.success_count}/{slot.total_requests} requests successful ({slot.success_rate:.1f}%)"

    # Use UTC time with timezone info
    utc_time = datetime.fromtimestamp(slot.end_time, tz=timezone.utc)

    return UptimeKumaHeartbeat(
        monitorID=monitor_id,
        status=status,
        time=utc_time.isoformat(),
        msg=msg,
        ping=None,  # Not applicable for model status
        important=status != STATUS_UP,
        duration=slot.end_time - slot.start_time,
    )


def _model_status_to_monitor(status: ModelStatus) -> UptimeKumaMonitor:
    """Convert ModelStatus to UptimeKumaMonitor."""
    monitor_id = _model_name_to_id(status.model_name)

    return UptimeKumaMonitor(
        id=monitor_id,
        name=status.display_name,
        description=f"AI Model: {status.model_name}",
        type="model",
        interval=60,
        active=True,
        model_name=status.model_name,
        success_rate=status.success_rate,
        total_requests=status.total_requests,
        time_window=status.time_window,
    )


def _model_status_to_monitor_with_heartbeats(status: ModelStatus) -> UptimeKumaMonitorWithHeartbeats:
    """Convert ModelStatus to UptimeKumaMonitorWithHeartbeats."""
    monitor_id = _model_name_to_id(status.model_name)

    # Convert slot data to heartbeats
    heartbeats = [
        _slot_to_heartbeat(slot, monitor_id)
        for slot in status.slot_data
    ]

    return UptimeKumaMonitorWithHeartbeats(
        id=monitor_id,
        name=status.display_name,
        description=f"AI Model: {status.model_name}",
        type="model",
        interval=60,
        active=True,
        model_name=status.model_name,
        success_rate=status.success_rate,
        total_requests=status.total_requests,
        time_window=status.time_window,
        heartbeats=heartbeats,
        uptime_24h=status.success_rate,
    )


# ==================== API Endpoints ====================

@router.get("/monitors", response_model=MonitorsResponse)
async def get_monitors(
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
):
    """
    [Public] Get all monitors (models) in uptime-kuma format.
    No authentication required.
    """
    service = get_model_status_service()
    statuses = service.get_all_models_status(window, use_cache=True)

    monitors = [_model_status_to_monitor(s) for s in statuses]

    return MonitorsResponse(success=True, data=monitors)


@router.get("/monitors/{model_name}", response_model=MonitorDetailResponse)
async def get_monitor(
    model_name: str,
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
):
    """
    [Public] Get single monitor (model) with heartbeats in uptime-kuma format.
    No authentication required.
    """
    service = get_model_status_service()
    status = service.get_model_status(model_name, window, use_cache=True)

    if status:
        monitor = _model_status_to_monitor_with_heartbeats(status)
        return MonitorDetailResponse(success=True, data=monitor)
    else:
        return MonitorDetailResponse(
            success=False,
            message=f"Model '{model_name}' not found or has no recent logs",
        )


@router.get("/heartbeats/{model_name}", response_model=HeartbeatsResponse)
async def get_heartbeats(
    model_name: str,
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
):
    """
    [Public] Get heartbeats for a model in uptime-kuma format.
    No authentication required.
    """
    service = get_model_status_service()
    status = service.get_model_status(model_name, window, use_cache=True)

    monitor_id = _model_name_to_id(model_name)

    if status:
        heartbeats = [
            _slot_to_heartbeat(slot, monitor_id)
            for slot in status.slot_data
        ]
        return HeartbeatsResponse(
            success=True,
            data=heartbeats,
            monitor_id=monitor_id,
        )
    else:
        return HeartbeatsResponse(
            success=True,
            data=[],
            monitor_id=monitor_id,
        )


@router.get("/status-page", response_model=StatusPageResponse)
async def get_status_page(
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
    models: Optional[str] = Query(None, description="Comma-separated model names to include"),
):
    """
    [Public] Get status page data in uptime-kuma format.
    No authentication required.

    This endpoint provides a summary view suitable for status page displays.
    """
    service = get_model_status_service()

    # Get models to display
    if models:
        model_names = [m.strip() for m in models.split(",") if m.strip()]
        statuses = service.get_multiple_models_status(model_names, window, use_cache=True)
    else:
        statuses = service.get_all_models_status(window, use_cache=True)

    # Build status page monitors
    page_monitors = []
    total_uptime = 0.0
    worst_status = STATUS_UP

    for status in statuses:
        monitor_id = _model_name_to_id(status.model_name)
        current_status = _map_status_to_uptime_kuma(
            status.success_rate,
            status.total_requests,
        )

        # Track worst status
        if current_status < worst_status:
            worst_status = current_status

        # Get recent heartbeats (last 24 slots max)
        recent_heartbeats = [
            _slot_to_heartbeat(slot, monitor_id)
            for slot in status.slot_data[-24:]
        ]

        page_monitors.append(UptimeKumaStatusPageMonitor(
            id=monitor_id,
            name=status.display_name,
            status=current_status,
            uptime=status.success_rate,
            heartbeats=recent_heartbeats,
        ))

        total_uptime += status.success_rate

    # Calculate overall uptime
    overall_uptime = total_uptime / len(statuses) if statuses else 100.0

    status_page = UptimeKumaStatusPage(
        title="Model Status",
        description="AI Model Health Status",
        monitors=page_monitors,
        overall_status=worst_status,
        overall_uptime=round(overall_uptime, 2),
        last_updated=datetime.now(timezone.utc).isoformat(),
    )

    return StatusPageResponse(success=True, data=status_page)


@router.post("/status-page/batch", response_model=StatusPageResponse)
async def get_status_page_batch(
    model_names: List[str],
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
):
    """
    [Public] Get status page data for specific models in uptime-kuma format.
    No authentication required.

    Request body should contain a list of model names.
    """
    service = get_model_status_service()
    statuses = service.get_multiple_models_status(model_names, window, use_cache=True)

    # Build status page monitors
    page_monitors = []
    total_uptime = 0.0
    worst_status = STATUS_UP

    for status in statuses:
        monitor_id = _model_name_to_id(status.model_name)
        current_status = _map_status_to_uptime_kuma(
            status.success_rate,
            status.total_requests,
        )

        # Track worst status
        if current_status < worst_status:
            worst_status = current_status

        # Get recent heartbeats (last 24 slots max)
        recent_heartbeats = [
            _slot_to_heartbeat(slot, monitor_id)
            for slot in status.slot_data[-24:]
        ]

        page_monitors.append(UptimeKumaStatusPageMonitor(
            id=monitor_id,
            name=status.display_name,
            status=current_status,
            uptime=status.success_rate,
            heartbeats=recent_heartbeats,
        ))

        total_uptime += status.success_rate

    # Calculate overall uptime
    overall_uptime = total_uptime / len(statuses) if statuses else 100.0

    status_page = UptimeKumaStatusPage(
        title="Model Status",
        description="AI Model Health Status",
        monitors=page_monitors,
        overall_status=worst_status,
        overall_uptime=round(overall_uptime, 2),
        last_updated=datetime.now(timezone.utc).isoformat(),
    )

    return StatusPageResponse(success=True, data=status_page)


# ==================== Uptime-Kuma Push API Compatible ====================

class PushHeartbeatResponse(BaseModel):
    """Response for push heartbeat (uptime-kuma push monitor compatible)."""
    ok: bool
    msg: str


@router.get("/push/{push_token}", response_model=PushHeartbeatResponse)
async def push_heartbeat(
    push_token: str,
    status: str = Query("up", description="Status: up, down"),
    msg: str = Query("OK", description="Status message"),
    ping: Optional[int] = Query(None, description="Response time in ms"),
):
    """
    [Public] Push heartbeat endpoint (uptime-kuma push monitor compatible).

    This endpoint is for compatibility with uptime-kuma push monitors.
    In this implementation, it's a no-op since we derive status from logs.

    Example: /api/uptime-kuma/push/your-token?status=up&msg=OK&ping=100
    """
    # This is a compatibility endpoint - we don't actually use push data
    # since our status is derived from log analysis
    logger.debug(f"[Uptime-Kuma] Push received: token={push_token}, status={status}, msg={msg}")

    return PushHeartbeatResponse(
        ok=True,
        msg="OK (push data received but not used - status derived from logs)",
    )


# ==================== Summary Endpoint ====================

class OverallStatusResponse(BaseModel):
    """Overall status summary."""
    success: bool
    status: int  # 0=DOWN, 1=UP, 2=PENDING
    status_text: str
    uptime: float
    total_monitors: int
    monitors_up: int
    monitors_down: int
    monitors_pending: int
    last_updated: str


@router.get("/overall", response_model=OverallStatusResponse)
async def get_overall_status(
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
):
    """
    [Public] Get overall status summary in uptime-kuma format.
    No authentication required.

    Returns a simple summary of all monitors' status.
    """
    service = get_model_status_service()
    statuses = service.get_all_models_status(window, use_cache=True)

    monitors_up = 0
    monitors_down = 0
    monitors_pending = 0
    total_uptime = 0.0

    for status in statuses:
        current_status = _map_status_to_uptime_kuma(
            status.success_rate,
            status.total_requests,
        )

        if current_status == STATUS_UP:
            monitors_up += 1
        elif current_status == STATUS_DOWN:
            monitors_down += 1
        else:
            monitors_pending += 1

        total_uptime += status.success_rate

    total_monitors = len(statuses)
    overall_uptime = total_uptime / total_monitors if total_monitors > 0 else 100.0

    # Determine overall status
    if monitors_down > 0:
        overall_status = STATUS_DOWN
    elif monitors_pending > 0:
        overall_status = STATUS_PENDING
    else:
        overall_status = STATUS_UP

    return OverallStatusResponse(
        success=True,
        status=overall_status,
        status_text=_get_status_text(overall_status),
        uptime=round(overall_uptime, 2),
        total_monitors=total_monitors,
        monitors_up=monitors_up,
        monitors_down=monitors_down,
        monitors_pending=monitors_pending,
        last_updated=datetime.now(timezone.utc).isoformat(),
    )

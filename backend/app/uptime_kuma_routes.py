"""
Uptime-Kuma Compatible API Routes for NewAPI Middleware Tool.
Provides endpoints compatible with uptime-kuma format for model status monitoring.

This allows external status page services to integrate with our model monitoring.

Uptime-Kuma API Format:
- GET /api/status-page/:slug - Get status page config and monitor list
- GET /api/status-page/heartbeat/:slug - Get heartbeat data for all monitors

Status Mapping (based on success_rate):
- 0 = DOWN: success_rate < 80%
- 1 = UP: success_rate >= 95%
- 2 = PENDING: 80% <= success_rate < 95%
- 3 = MAINTENANCE: not used currently
"""
import hashlib
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from .model_status_service import (
    get_model_status_service,
    DEFAULT_TIME_WINDOW,
)
from .logger import logger

# Use /api/status-page prefix to match uptime-kuma format
router = APIRouter(prefix="/api/status-page", tags=["Uptime-Kuma Compatible"])

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
    """
    if total_requests == 0:
        return STATUS_UP  # No requests = no issues

    if success_rate >= 95:
        return STATUS_UP
    elif success_rate >= 80:
        return STATUS_PENDING
    else:
        return STATUS_DOWN


def _model_name_to_id(model_name: str) -> int:
    """
    Convert model name to a stable numeric ID.
    Uses MD5 hash to generate consistent IDs across restarts.
    """
    hash_bytes = hashlib.md5(model_name.encode('utf-8')).digest()
    return int.from_bytes(hash_bytes[:4], 'big') % (10 ** 9)


# ==================== Response Models ====================

class StatusPageConfig(BaseModel):
    """Status page configuration (uptime-kuma format)."""
    slug: str
    title: str
    description: Optional[str] = None
    icon: str = "/icon.svg"
    theme: str = "auto"
    published: bool = True
    showTags: bool = False
    autoRefreshInterval: int = 60


class MonitorItem(BaseModel):
    """Monitor item in group (uptime-kuma format)."""
    id: int
    name: str
    type: str = "http"
    sendUrl: int = 0


class MonitorGroup(BaseModel):
    """Monitor group (uptime-kuma format)."""
    id: int
    name: str
    weight: int = 1
    monitorList: List[MonitorItem] = Field(default_factory=list)


class HeartbeatItem(BaseModel):
    """Heartbeat item (uptime-kuma format)."""
    status: int  # 0=DOWN, 1=UP, 2=PENDING, 3=MAINTENANCE
    time: str  # ISO format timestamp
    msg: str = ""
    ping: Optional[int] = None


# ==================== API Endpoints ====================

@router.get("/{slug}")
async def get_status_page_config(
    slug: str,
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
):
    """
    [Public] Get status page configuration and monitor list (uptime-kuma format).
    No authentication required.

    This endpoint returns the status page config and public group list.
    The slug parameter is used to identify the status page (can be any value).
    """
    service = get_model_status_service()
    statuses = service.get_all_models_status(window, use_cache=True)

    # Build config
    config = StatusPageConfig(
        slug=slug,
        title="Model Status",
        description="AI Model Health Status",
        autoRefreshInterval=60,
    )

    # Build monitor list - group all models into one group
    monitor_list = []
    for status in statuses:
        monitor_id = _model_name_to_id(status.model_name)
        monitor_list.append(MonitorItem(
            id=monitor_id,
            name=status.display_name,
            type="http",
        ))

    # Create a single group containing all monitors
    public_group_list = [
        MonitorGroup(
            id=1,
            name="AI Models",
            weight=1,
            monitorList=monitor_list,
        )
    ]

    return {
        "config": config.model_dump(),
        "incident": None,
        "publicGroupList": [g.model_dump() for g in public_group_list],
        "maintenanceList": [],
    }


@router.get("/heartbeat/{slug}")
async def get_status_page_heartbeat(
    slug: str,
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
):
    """
    [Public] Get heartbeat data for all monitors (uptime-kuma format).
    No authentication required.

    This endpoint returns heartbeat history and uptime percentages.
    """
    service = get_model_status_service()
    statuses = service.get_all_models_status(window, use_cache=True)

    heartbeat_list: Dict[str, List[Dict[str, Any]]] = {}
    uptime_list: Dict[str, float] = {}

    for status in statuses:
        monitor_id = _model_name_to_id(status.model_name)
        monitor_id_str = str(monitor_id)

        # Build heartbeat list from slot data (reverse to show newest first, then reverse back)
        heartbeats = []
        for slot in status.slot_data:
            slot_status = _map_status_to_uptime_kuma(slot.success_rate, slot.total_requests)

            if slot.total_requests == 0:
                msg = ""
            else:
                msg = f"{slot.success_count}/{slot.total_requests} ({slot.success_rate:.1f}%)"

            utc_time = datetime.fromtimestamp(slot.end_time, tz=timezone.utc)

            heartbeats.append({
                "status": slot_status,
                "time": utc_time.strftime("%Y-%m-%d %H:%M:%S"),
                "msg": msg,
                "ping": None,
            })

        # Reverse to show oldest first (uptime-kuma expects this order)
        heartbeat_list[monitor_id_str] = heartbeats

        # Calculate 24h uptime
        uptime_list[f"{monitor_id_str}_24"] = status.success_rate / 100.0

    return {
        "heartbeatList": heartbeat_list,
        "uptimeList": uptime_list,
    }


# ==================== Additional Endpoints (for our own use) ====================

@router.get("/{slug}/badge")
async def get_status_page_badge(
    slug: str,
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
    label: Optional[str] = Query(None, description="Badge label"),
):
    """
    [Public] Get overall status badge info (simplified, not SVG).
    No authentication required.
    """
    service = get_model_status_service()
    statuses = service.get_all_models_status(window, use_cache=True)

    has_up = False
    has_down = False

    for status in statuses:
        current_status = _map_status_to_uptime_kuma(status.success_rate, status.total_requests)
        if current_status == STATUS_UP:
            has_up = True
        elif current_status == STATUS_DOWN:
            has_down = True

    if has_up and not has_down:
        badge_status = "Up"
        color = "#4CAF50"
    elif has_up and has_down:
        badge_status = "Degraded"
        color = "#F6BE00"
    elif has_down:
        badge_status = "Down"
        color = "#DC3545"
    else:
        badge_status = "N/A"
        color = "#808080"

    return {
        "label": label or "",
        "status": badge_status,
        "color": color,
    }


@router.get("/{slug}/summary")
async def get_status_page_summary(
    slug: str,
    window: str = Query(DEFAULT_TIME_WINDOW, description="Time window: 1h, 6h, 12h, 24h"),
):
    """
    [Public] Get status page summary (custom endpoint).
    No authentication required.
    """
    service = get_model_status_service()
    statuses = service.get_all_models_status(window, use_cache=True)

    monitors_up = 0
    monitors_down = 0
    monitors_pending = 0
    total_uptime = 0.0

    for status in statuses:
        current_status = _map_status_to_uptime_kuma(status.success_rate, status.total_requests)

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
        status_text = "DOWN"
    elif monitors_pending > 0:
        overall_status = STATUS_PENDING
        status_text = "PENDING"
    else:
        overall_status = STATUS_UP
        status_text = "UP"

    return {
        "success": True,
        "status": overall_status,
        "status_text": status_text,
        "uptime": round(overall_uptime, 2),
        "total_monitors": total_monitors,
        "monitors_up": monitors_up,
        "monitors_down": monitors_down,
        "monitors_pending": monitors_pending,
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }

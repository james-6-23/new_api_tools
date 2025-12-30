"""
Model Status Monitoring Service for NewAPI Middleware Tool.
Provides sliding window status monitoring based on log data.
"""
import time
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timedelta

from .database import get_db_manager
from .local_storage import get_local_storage
from .logger import logger

# Constants
LOG_TYPE_CONSUMPTION = 2  # type=2 is consumption/usage log (success)
LOG_TYPE_FAILURE = 5  # type=5 is failure log (request failed)

# Cache TTL in seconds
# Short TTL for actively monitored models (selected models refresh frequently)
CACHE_TTL_SHORT = 30  # 30 seconds for selected models
# Long TTL for warmup/background cache (unselected models, reduce DB load)
CACHE_TTL_LONG = 300  # 5 minutes for warmup cache

# Time window configurations: (total_seconds, num_slots, slot_seconds)
TIME_WINDOWS = {
    "1h": (3600, 60, 60),        # 1 hour, 60 slots, 1 minute each
    "6h": (21600, 24, 900),      # 6 hours, 24 slots, 15 minutes each
    "12h": (43200, 24, 1800),    # 12 hours, 24 slots, 30 minutes each
    "24h": (86400, 24, 3600),    # 24 hours, 24 slots, 1 hour each
}

DEFAULT_TIME_WINDOW = "24h"


@dataclass
class SlotStatus:
    """Status data for a time slot."""
    slot: int  # slot index (0 = oldest, N-1 = newest)
    start_time: int  # Unix timestamp
    end_time: int  # Unix timestamp
    total_requests: int
    success_count: int
    success_rate: float  # 0-100
    status: str  # 'green', 'yellow', 'red'


@dataclass
class ModelStatus:
    """Model status with time window history."""
    model_name: str
    display_name: str
    time_window: str  # '1h', '6h', '12h', '24h'
    total_requests: int
    success_count: int
    success_rate: float
    current_status: str  # 'green', 'yellow', 'red'
    slot_data: List[SlotStatus]


def get_status_color(success_rate: float, total_requests: int) -> str:
    """
    Determine status color based on success rate.
    
    Args:
        success_rate: Success rate percentage (0-100)
        total_requests: Total number of requests
        
    Returns:
        'green', 'yellow', or 'red'
    """
    if total_requests == 0:
        return 'green'  # No requests = no issues
    if success_rate >= 95:
        return 'green'
    elif success_rate >= 80:
        return 'yellow'
    else:
        return 'red'


def get_time_window_config(window: str) -> Tuple[int, int, int]:
    """Get time window configuration."""
    return TIME_WINDOWS.get(window, TIME_WINDOWS[DEFAULT_TIME_WINDOW])


class ModelStatusService:
    """
    Service for model status monitoring.
    Provides sliding window status based on log data.
    """

    def __init__(self):
        self._db = get_db_manager()
        self._storage = get_local_storage()
        self._init_cache_table()

    def _init_cache_table(self):
        """Initialize cache table in SQLite."""
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS model_status_cache (
                    cache_key TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_model_status_expires 
                ON model_status_cache(expires_at)
            """)
            conn.commit()

    def _get_cache(self, key: str) -> Optional[Dict]:
        """Get cached data if not expired."""
        import json
        now = int(time.time())
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT data FROM model_status_cache WHERE cache_key = ? AND expires_at > ?",
                (key, now)
            )
            row = cursor.fetchone()
            if row:
                return json.loads(row[0])
        return None

    def _set_cache(self, key: str, data: Dict, ttl: int = CACHE_TTL_SHORT):
        """Set cache with TTL."""
        import json
        now = int(time.time())
        expires_at = now + ttl
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO model_status_cache (cache_key, data, created_at, expires_at)
                VALUES (?, ?, ?, ?)
            """, (key, json.dumps(data), now, expires_at))
            conn.commit()

    def _clear_expired_cache(self):
        """Clear expired cache entries."""
        now = int(time.time())
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM model_status_cache WHERE expires_at < ?", (now,))
            conn.commit()

    def get_available_models(self, use_cache: bool = True) -> List[str]:
        """
        Get list of all models from online channels (abilities table).
        Returns models that are enabled in active channels (status=1).

        Args:
            use_cache: Whether to use cached data (default: True).

        Returns:
            List of model names from online channels.
        """
        cache_key = "available_models"
        if use_cache:
            cached = self._get_cache(cache_key)
            if cached:
                return cached.get("models", [])

        # Query models from abilities table (online channels)
        # Join with channels to filter only active channels (status=1)
        from .database import DatabaseEngine
        is_pg = self._db.config.engine == DatabaseEngine.POSTGRESQL

        sql = """
            SELECT DISTINCT a.model as model_name
            FROM abilities a
            INNER JOIN channels c ON c.id = a.channel_id
            WHERE c.status = 1
        """
        # Filter enabled abilities
        if is_pg:
            sql += " AND COALESCE(a.enabled, TRUE) = TRUE"
        else:
            sql += " AND COALESCE(a.enabled, 1) = 1"
        sql += " ORDER BY a.model"

        try:
            self._db.connect()
            result = self._db.execute(sql)
            models = [row["model_name"] for row in result if row.get("model_name")]
            self._set_cache(cache_key, {"models": models}, ttl=300)  # 5 min cache
            return models
        except Exception as e:
            logger.db_error(f"获取可用模型列表失败: {e}")
            return []

    def get_model_status(
        self,
        model_name: str,
        time_window: str = DEFAULT_TIME_WINDOW,
        use_cache: bool = True,
        cache_ttl: int = CACHE_TTL_SHORT
    ) -> Optional[ModelStatus]:
        """
        Get status for a specific model within a time window.

        Args:
            model_name: Name of the model to query.
            time_window: Time window ('1h', '6h', '12h', '24h').
            use_cache: Whether to use cached data.
            cache_ttl: Cache TTL in seconds (default: short TTL for active monitoring).

        Returns:
            ModelStatus with slot breakdown.
        """
        # Validate time window
        if time_window not in TIME_WINDOWS:
            time_window = DEFAULT_TIME_WINDOW

        cache_key = f"model_status:{model_name}:{time_window}"
        if use_cache:
            cached = self._get_cache(cache_key)
            if cached:
                return self._dict_to_model_status(cached)

        now = int(time.time())
        total_seconds, num_slots, slot_seconds = get_time_window_config(time_window)

        # Calculate time range
        window_start = now - total_seconds

        # Single optimized query - aggregate by time slot using floor division
        # This reduces N queries to 1 query per model
        sql = """
            SELECT
                FLOOR((created_at - :window_start) / :slot_seconds) as slot_idx,
                COUNT(*) as total,
                SUM(CASE WHEN type = :type_success THEN 1 ELSE 0 END) as success
            FROM logs
            WHERE model_name = :model_name
              AND created_at >= :window_start
              AND created_at < :now
              AND type IN (:type_success, :type_failure)
            GROUP BY FLOOR((created_at - :window_start) / :slot_seconds)
        """

        # Initialize all slots with zeros
        slot_data_map = {}
        for i in range(num_slots):
            slot_start = window_start + (i * slot_seconds)
            slot_end = slot_start + slot_seconds
            slot_data_map[i] = {
                'slot': i,
                'start_time': slot_start,
                'end_time': slot_end,
                'total_requests': 0,
                'success_count': 0,
            }

        try:
            self._db.connect()
            result = self._db.execute(sql, {
                "model_name": model_name,
                "window_start": window_start,
                "now": now,
                "slot_seconds": slot_seconds,
                "type_success": LOG_TYPE_CONSUMPTION,
                "type_failure": LOG_TYPE_FAILURE,
            })

            # Fill in actual data from query results
            for row in result:
                slot_idx = int(row.get("slot_idx") or 0)
                if 0 <= slot_idx < num_slots:
                    slot_data_map[slot_idx]['total_requests'] = int(row.get("total") or 0)
                    slot_data_map[slot_idx]['success_count'] = int(row.get("success") or 0)

        except Exception as e:
            logger.db_error(f"获取模型 {model_name} 状态失败: {e}")

        # Build slot_data list with status colors
        slot_data = []
        total_requests = 0
        total_success = 0

        for i in range(num_slots):
            slot_info = slot_data_map[i]
            slot_total = slot_info['total_requests']
            slot_success = slot_info['success_count']
            success_rate = (slot_success / slot_total * 100) if slot_total > 0 else 100.0
            status = get_status_color(success_rate, slot_total)

            slot_data.append(SlotStatus(
                slot=i,
                start_time=slot_info['start_time'],
                end_time=slot_info['end_time'],
                total_requests=slot_total,
                success_count=slot_success,
                success_rate=round(success_rate, 2),
                status=status,
            ))

            total_requests += slot_total
            total_success += slot_success

        overall_rate = (total_success / total_requests * 100) if total_requests > 0 else 100.0
        current_status = get_status_color(overall_rate, total_requests)

        model_status = ModelStatus(
            model_name=model_name,
            display_name=self._get_display_name(model_name),
            time_window=time_window,
            total_requests=total_requests,
            success_count=total_success,
            success_rate=round(overall_rate, 2),
            current_status=current_status,
            slot_data=slot_data,
        )

        # Cache the result with specified TTL
        self._set_cache(cache_key, self._model_status_to_dict(model_status), ttl=cache_ttl)

        return model_status

    def get_multiple_models_status(
        self, 
        model_names: List[str],
        time_window: str = DEFAULT_TIME_WINDOW,
        use_cache: bool = True
    ) -> List[ModelStatus]:
        """
        Get status for multiple models.
        
        Args:
            model_names: List of model names to query.
            time_window: Time window ('1h', '6h', '12h', '24h').
            use_cache: Whether to use cached data.
            
        Returns:
            List of ModelStatus objects.
        """
        results = []
        for model_name in model_names:
            status = self.get_model_status(model_name, time_window, use_cache)
            if status:
                results.append(status)
        return results

    def get_all_models_status(self, time_window: str = DEFAULT_TIME_WINDOW, use_cache: bool = True) -> List[ModelStatus]:
        """
        Get status for all available models.
        
        Args:
            time_window: Time window ('1h', '6h', '12h', '24h').
            use_cache: Whether to use cached data.
            
        Returns:
            List of ModelStatus objects for all models.
        """
        models = self.get_available_models()
        return self.get_multiple_models_status(models, time_window, use_cache)

    def _get_display_name(self, model_name: str) -> str:
        """Get a display-friendly name for the model."""
        # Simple transformation - can be extended with a mapping table
        return model_name.replace("-", " ").replace("_", " ").title()

    def _model_status_to_dict(self, status: ModelStatus) -> Dict:
        """Convert ModelStatus to dictionary for caching."""
        return {
            "model_name": status.model_name,
            "display_name": status.display_name,
            "time_window": status.time_window,
            "total_requests": status.total_requests,
            "success_count": status.success_count,
            "success_rate": status.success_rate,
            "current_status": status.current_status,
            "slot_data": [asdict(h) for h in status.slot_data],
        }

    def _dict_to_model_status(self, data: Dict) -> ModelStatus:
        """Convert dictionary to ModelStatus."""
        slot_data = [
            SlotStatus(**h) for h in data.get("slot_data", [])
        ]
        return ModelStatus(
            model_name=data["model_name"],
            display_name=data["display_name"],
            time_window=data.get("time_window", DEFAULT_TIME_WINDOW),
            total_requests=data.get("total_requests", data.get("total_requests_24h", 0)),
            success_count=data.get("success_count", data.get("success_count_24h", 0)),
            success_rate=data.get("success_rate", data.get("success_rate_24h", 0)),
            current_status=data["current_status"],
            slot_data=slot_data,
        )


# Singleton instance
_model_status_service: Optional[ModelStatusService] = None


def get_model_status_service() -> ModelStatusService:
    """Get singleton instance of ModelStatusService."""
    global _model_status_service
    if _model_status_service is None:
        _model_status_service = ModelStatusService()
    return _model_status_service


async def warmup_model_status(max_models: int = 0) -> Dict[str, Any]:
    """
    Warmup model status data for faster frontend loading.
    Warms up ALL time windows (1h, 6h, 12h, 24h) for each model.
    Uses longer cache TTL (5 min) since these are background warmup caches.

    Gentle warmup strategy:
    - Dynamic delay based on total tasks (more tasks = longer delay)
    - Batch processing with progress logging
    - Longer delay between batches

    Args:
        max_models: Maximum number of models to warmup (0 = all models).

    Returns:
        Warmup result with success count and timing.
    """
    import asyncio

    service = get_model_status_service()
    start_time = time.time()

    # Get available models (force refresh to get latest list)
    models = service.get_available_models(use_cache=False)
    models_to_warmup = models[:max_models] if max_models > 0 else models

    if not models_to_warmup:
        logger.info("[模型状态] 无可用模型，跳过预热")
        return {
            "success": True,
            "models_warmed": 0,
            "windows_warmed": 0,
            "elapsed": 0,
        }

    # Get all time windows
    time_windows = list(TIME_WINDOWS.keys())  # ['1h', '6h', '12h', '24h']
    total_tasks = len(models_to_warmup) * len(time_windows)

    # Dynamic delay based on total tasks (more tasks = gentler warmup)
    # < 50 tasks: 0.1s delay
    # 50-100 tasks: 0.15s delay
    # 100-200 tasks: 0.2s delay
    # > 200 tasks: 0.25s delay
    if total_tasks < 50:
        query_delay = 0.1
    elif total_tasks < 100:
        query_delay = 0.15
    elif total_tasks < 200:
        query_delay = 0.2
    else:
        query_delay = 0.25

    # Batch size for progress logging (every 10 models)
    batch_size = 10
    batch_delay = 1.0  # Extra delay between batches

    estimated_time = total_tasks * query_delay + (len(models_to_warmup) // batch_size) * batch_delay

    logger.info(f"[模型状态] 开始预热 {len(models_to_warmup)} 个模型 × {len(time_windows)} 个时间窗口 = {total_tasks} 个缓存")
    logger.info(f"[模型状态] 预热策略: 查询延迟 {query_delay}s, 批次延迟 {batch_delay}s, 预计耗时 {estimated_time:.0f}s")

    success_count = 0
    failed_tasks = []

    for idx, model_name in enumerate(models_to_warmup):
        for window in time_windows:
            try:
                # Force refresh cache with LONG TTL for warmup
                service.get_model_status(
                    model_name,
                    time_window=window,
                    use_cache=False,
                    cache_ttl=CACHE_TTL_LONG  # 5 minutes for warmup cache
                )
                success_count += 1
                # Gentle delay to avoid overwhelming the database
                await asyncio.sleep(query_delay)
            except Exception as e:
                logger.warn(f"[模型状态] 预热 {model_name}@{window} 失败: {e}")
                failed_tasks.append(f"{model_name}@{window}")

        # Progress logging and batch delay
        if (idx + 1) % batch_size == 0:
            progress = (idx + 1) / len(models_to_warmup) * 100
            elapsed = time.time() - start_time
            logger.info(f"[模型状态] 预热进度: {idx + 1}/{len(models_to_warmup)} 模型 ({progress:.0f}%), 已耗时 {elapsed:.1f}s")
            # Extra delay between batches to let database breathe
            await asyncio.sleep(batch_delay)

    elapsed = time.time() - start_time

    if failed_tasks:
        logger.warn(f"[模型状态] 预热完成，成功 {success_count}/{total_tasks}，失败 {len(failed_tasks)} 个，耗时 {elapsed:.1f}s")
    else:
        logger.info(f"[模型状态] 预热完成: {len(models_to_warmup)} 模型 × {len(time_windows)} 窗口 = {success_count} 缓存，耗时 {elapsed:.1f}s")

    return {
        "success": True,
        "models_warmed": len(models_to_warmup),
        "windows_warmed": len(time_windows),
        "total_cached": success_count,
        "failed": len(failed_tasks),
        "elapsed": round(elapsed, 2),
    }

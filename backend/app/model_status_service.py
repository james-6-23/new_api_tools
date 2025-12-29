"""
Model Status Monitoring Service for NewAPI Middleware Tool.
Provides 24-hour sliding window status monitoring based on log data.
"""
import time
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta

from .database import get_db_manager
from .local_storage import get_local_storage
from .logger import logger

# Constants
LOG_TYPE_CONSUMPTION = 2  # type=2 is consumption/usage log (success)
LOG_TYPE_FAILURE = 5  # type=5 is failure log (request failed)

# Cache TTL in seconds
CACHE_TTL = 60  # 1 minute cache


@dataclass
class HourlyStatus:
    """Hourly status data for a model."""
    hour: int  # 0-23, hours ago from now
    start_time: int  # Unix timestamp
    end_time: int  # Unix timestamp
    total_requests: int
    success_count: int
    success_rate: float  # 0-100
    status: str  # 'green', 'yellow', 'red'


@dataclass
class ModelStatus:
    """Model status with 24-hour history."""
    model_name: str
    display_name: str
    total_requests_24h: int
    success_count_24h: int
    success_rate_24h: float
    current_status: str  # 'green', 'yellow', 'red'
    hourly_data: List[HourlyStatus]


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


class ModelStatusService:
    """
    Service for model status monitoring.
    Provides 24-hour sliding window status based on log data.
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

    def _set_cache(self, key: str, data: Dict, ttl: int = CACHE_TTL):
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

    def get_available_models(self) -> List[str]:
        """
        Get list of all models that have logs in the last 24 hours.
        
        Returns:
            List of model names.
        """
        cache_key = "available_models"
        cached = self._get_cache(cache_key)
        if cached:
            return cached.get("models", [])

        now = int(time.time())
        start_time = now - 86400  # 24 hours ago

        sql = """
            SELECT DISTINCT model_name
            FROM logs
            WHERE created_at >= :start_time
              AND type IN (:type_success, :type_failure)
              AND model_name IS NOT NULL
              AND model_name != ''
            ORDER BY model_name
        """

        try:
            self._db.connect()
            result = self._db.execute(sql, {
                "start_time": start_time,
                "type_success": LOG_TYPE_CONSUMPTION,
                "type_failure": LOG_TYPE_FAILURE,
            })
            models = [row["model_name"] for row in result if row.get("model_name")]
            self._set_cache(cache_key, {"models": models}, ttl=300)  # 5 min cache
            return models
        except Exception as e:
            logger.db_error(f"获取可用模型列表失败: {e}")
            return []

    def get_model_status(self, model_name: str, use_cache: bool = True) -> Optional[ModelStatus]:
        """
        Get 24-hour status for a specific model.
        
        Args:
            model_name: Name of the model to query.
            use_cache: Whether to use cached data.
            
        Returns:
            ModelStatus with hourly breakdown.
        """
        cache_key = f"model_status:{model_name}"
        if use_cache:
            cached = self._get_cache(cache_key)
            if cached:
                return self._dict_to_model_status(cached)

        now = int(time.time())
        hourly_data = []
        total_requests = 0
        total_success = 0

        # Query each hour separately for the 24-hour window
        for hour_offset in range(24):
            end_time = now - (hour_offset * 3600)
            start_time = end_time - 3600

            sql = """
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN type = :type_success THEN 1 ELSE 0 END) as success
                FROM logs
                WHERE model_name = :model_name
                  AND created_at >= :start_time
                  AND created_at < :end_time
                  AND type IN (:type_success, :type_failure)
            """

            try:
                self._db.connect()
                result = self._db.execute(sql, {
                    "model_name": model_name,
                    "start_time": start_time,
                    "end_time": end_time,
                    "type_success": LOG_TYPE_CONSUMPTION,
                    "type_failure": LOG_TYPE_FAILURE,
                })

                if result:
                    hour_total = int(result[0].get("total") or 0)
                    hour_success = int(result[0].get("success") or 0)
                else:
                    hour_total = 0
                    hour_success = 0

                success_rate = (hour_success / hour_total * 100) if hour_total > 0 else 100.0
                status = get_status_color(success_rate, hour_total)

                hourly_data.append(HourlyStatus(
                    hour=hour_offset,
                    start_time=start_time,
                    end_time=end_time,
                    total_requests=hour_total,
                    success_count=hour_success,
                    success_rate=round(success_rate, 2),
                    status=status,
                ))

                total_requests += hour_total
                total_success += hour_success

            except Exception as e:
                logger.db_error(f"获取模型 {model_name} 第 {hour_offset} 小时状态失败: {e}")
                hourly_data.append(HourlyStatus(
                    hour=hour_offset,
                    start_time=start_time,
                    end_time=end_time,
                    total_requests=0,
                    success_count=0,
                    success_rate=100.0,
                    status='green',
                ))

        # Reverse to show oldest first (left to right)
        hourly_data.reverse()

        overall_rate = (total_success / total_requests * 100) if total_requests > 0 else 100.0
        current_status = get_status_color(overall_rate, total_requests)

        model_status = ModelStatus(
            model_name=model_name,
            display_name=self._get_display_name(model_name),
            total_requests_24h=total_requests,
            success_count_24h=total_success,
            success_rate_24h=round(overall_rate, 2),
            current_status=current_status,
            hourly_data=hourly_data,
        )

        # Cache the result
        self._set_cache(cache_key, self._model_status_to_dict(model_status))

        return model_status

    def get_multiple_models_status(
        self, 
        model_names: List[str], 
        use_cache: bool = True
    ) -> List[ModelStatus]:
        """
        Get status for multiple models.
        
        Args:
            model_names: List of model names to query.
            use_cache: Whether to use cached data.
            
        Returns:
            List of ModelStatus objects.
        """
        results = []
        for model_name in model_names:
            status = self.get_model_status(model_name, use_cache)
            if status:
                results.append(status)
        return results

    def get_all_models_status(self, use_cache: bool = True) -> List[ModelStatus]:
        """
        Get status for all available models.
        
        Args:
            use_cache: Whether to use cached data.
            
        Returns:
            List of ModelStatus objects for all models.
        """
        models = self.get_available_models()
        return self.get_multiple_models_status(models, use_cache)

    def _get_display_name(self, model_name: str) -> str:
        """Get a display-friendly name for the model."""
        # Simple transformation - can be extended with a mapping table
        return model_name.replace("-", " ").replace("_", " ").title()

    def _model_status_to_dict(self, status: ModelStatus) -> Dict:
        """Convert ModelStatus to dictionary for caching."""
        return {
            "model_name": status.model_name,
            "display_name": status.display_name,
            "total_requests_24h": status.total_requests_24h,
            "success_count_24h": status.success_count_24h,
            "success_rate_24h": status.success_rate_24h,
            "current_status": status.current_status,
            "hourly_data": [asdict(h) for h in status.hourly_data],
        }

    def _dict_to_model_status(self, data: Dict) -> ModelStatus:
        """Convert dictionary to ModelStatus."""
        hourly_data = [
            HourlyStatus(**h) for h in data.get("hourly_data", [])
        ]
        return ModelStatus(
            model_name=data["model_name"],
            display_name=data["display_name"],
            total_requests_24h=data["total_requests_24h"],
            success_count_24h=data["success_count_24h"],
            success_rate_24h=data["success_rate_24h"],
            current_status=data["current_status"],
            hourly_data=hourly_data,
        )


# Singleton instance
_model_status_service: Optional[ModelStatusService] = None


def get_model_status_service() -> ModelStatusService:
    """Get singleton instance of ModelStatusService."""
    global _model_status_service
    if _model_status_service is None:
        _model_status_service = ModelStatusService()
    return _model_status_service


async def warmup_model_status(max_models: int = 20) -> Dict[str, Any]:
    """
    Warmup model status data for faster frontend loading.
    
    Args:
        max_models: Maximum number of models to warmup (default 20).
        
    Returns:
        Warmup result with success count and timing.
    """
    import asyncio
    
    service = get_model_status_service()
    start_time = time.time()
    
    # Get available models
    models = service.get_available_models()
    models_to_warmup = models[:max_models]
    
    if not models_to_warmup:
        logger.info("[模型状态] 无可用模型，跳过预热")
        return {
            "success": True,
            "models_warmed": 0,
            "elapsed": 0,
        }
    
    logger.info(f"[模型状态] 开始预热 {len(models_to_warmup)} 个模型状态...")
    
    success_count = 0
    failed_models = []
    
    for model_name in models_to_warmup:
        try:
            # Force refresh cache
            service.get_model_status(model_name, use_cache=False)
            success_count += 1
            # Small delay to avoid overwhelming the database
            await asyncio.sleep(0.1)
        except Exception as e:
            logger.warn(f"[模型状态] 预热 {model_name} 失败: {e}")
            failed_models.append(model_name)
    
    elapsed = time.time() - start_time
    
    if failed_models:
        logger.warn(f"[模型状态] 预热完成，成功 {success_count}/{len(models_to_warmup)}，失败: {', '.join(failed_models[:5])}")
    else:
        logger.info(f"[模型状态] 预热完成，{success_count} 个模型，耗时 {elapsed:.1f}s")
    
    return {
        "success": True,
        "models_warmed": success_count,
        "total_models": len(models_to_warmup),
        "failed": failed_models,
        "elapsed": round(elapsed, 2),
    }

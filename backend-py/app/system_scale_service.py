"""
System Scale Detection Service for NewAPI Middleware Tool.
Automatically detects system scale and provides recommended settings.
"""
import time
import threading
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, Optional

from .database import get_db_manager, DatabaseManager
from .logger import logger


class SystemScale(str, Enum):
    """System scale levels."""
    SMALL = "small"      # < 1000 users, < 100k logs/day
    MEDIUM = "medium"    # 1000-10000 users, 100k-1M logs/day
    LARGE = "large"      # 10000-50000 users, 1M-10M logs/day
    XLARGE = "xlarge"    # > 50000 users, > 10M logs/day


@dataclass
class ScaleSettings:
    """Recommended settings based on system scale."""
    scale: SystemScale
    # Cache TTL in seconds
    leaderboard_cache_ttl: int
    ip_cache_ttl: int
    stats_cache_ttl: int
    # Frontend refresh interval in seconds
    frontend_refresh_interval: int
    # Description
    description: str


# Scale-based settings configuration
SCALE_SETTINGS: Dict[SystemScale, ScaleSettings] = {
    SystemScale.SMALL: ScaleSettings(
        scale=SystemScale.SMALL,
        leaderboard_cache_ttl=30,
        ip_cache_ttl=30,
        stats_cache_ttl=60,
        frontend_refresh_interval=30,
        description="小型系统 (< 1000 用户)",
    ),
    SystemScale.MEDIUM: ScaleSettings(
        scale=SystemScale.MEDIUM,
        leaderboard_cache_ttl=60,
        ip_cache_ttl=60,
        stats_cache_ttl=120,
        frontend_refresh_interval=60,
        description="中型系统 (1000-10000 用户)",
    ),
    SystemScale.LARGE: ScaleSettings(
        scale=SystemScale.LARGE,
        leaderboard_cache_ttl=300,
        ip_cache_ttl=300,
        stats_cache_ttl=300,
        frontend_refresh_interval=300,
        description="大型系统 (10000-50000 用户)",
    ),
    SystemScale.XLARGE: ScaleSettings(
        scale=SystemScale.XLARGE,
        leaderboard_cache_ttl=600,
        ip_cache_ttl=600,
        stats_cache_ttl=600,
        frontend_refresh_interval=600,
        description="超大型系统 (> 50000 用户)",
    ),
}


class SystemScaleService:
    """Service for detecting system scale and managing settings."""

    def __init__(self, db: Optional[DatabaseManager] = None):
        self._db = db
        self._cached_scale: Optional[SystemScale] = None
        self._cached_metrics: Optional[Dict[str, Any]] = None
        self._cache_time: float = 0
        self._cache_ttl: float = 3600  # Cache for 1 hour
        self._lock = threading.Lock()

    @property
    def db(self) -> DatabaseManager:
        if self._db is None:
            self._db = get_db_manager()
        return self._db

    def detect_scale(self, force_refresh: bool = False) -> Dict[str, Any]:
        """
        Detect system scale based on various metrics.
        Returns scale level and metrics used for detection.
        """
        with self._lock:
            now = time.time()
            if not force_refresh and self._cached_scale and (now - self._cache_time) < self._cache_ttl:
                return {
                    "scale": self._cached_scale.value,
                    "metrics": self._cached_metrics,
                    "settings": self._get_settings_dict(self._cached_scale),
                    "cached": True,
                }

        metrics = self._collect_metrics()
        scale = self._determine_scale(metrics)

        with self._lock:
            self._cached_scale = scale
            self._cached_metrics = metrics
            self._cache_time = time.time()

        return {
            "scale": scale.value,
            "metrics": metrics,
            "settings": self._get_settings_dict(scale),
            "cached": False,
        }

    def _collect_metrics(self) -> Dict[str, Any]:
        """Collect system metrics for scale detection."""
        try:
            self.db.connect()
        except Exception as e:
            logger.db_error(f"Failed to connect to database: {e}")
            return self._default_metrics()

        metrics = {}

        # 1. Total users count
        try:
            result = self.db.execute("SELECT COUNT(*) as cnt FROM users WHERE deleted_at IS NULL", {})
            metrics["total_users"] = int((result[0] if result else {}).get("cnt") or 0)
        except Exception as e:
            logger.warning(f"Failed to count users: {e}")
            metrics["total_users"] = 0

        # 2. Active users (last 24h)
        try:
            now = int(time.time())
            start_24h = now - 86400
            result = self.db.execute(
                "SELECT COUNT(DISTINCT user_id) as cnt FROM logs WHERE created_at >= :start_time",
                {"start_time": start_24h}
            )
            metrics["active_users_24h"] = int((result[0] if result else {}).get("cnt") or 0)
        except Exception as e:
            logger.warning(f"Failed to count active users: {e}")
            metrics["active_users_24h"] = 0

        # 3. Logs count (last 24h) - use sampling for large tables
        try:
            # First try to get approximate count using table stats (fast)
            result = self.db.execute(
                "SELECT COUNT(*) as cnt FROM logs WHERE created_at >= :start_time",
                {"start_time": start_24h}
            )
            metrics["logs_24h"] = int((result[0] if result else {}).get("cnt") or 0)
        except Exception as e:
            logger.warning(f"Failed to count logs: {e}")
            metrics["logs_24h"] = 0

        # 4. Total logs count (approximate)
        try:
            # Try to get approximate count from database statistics (fast)
            # Different approach for MySQL vs PostgreSQL
            engine = self.db.config.engine.value if hasattr(self.db, 'config') else 'mysql'
            
            if engine == 'postgresql':
                # PostgreSQL: use pg_class for approximate count
                result = self.db.execute(
                    """SELECT reltuples::bigint as cnt 
                       FROM pg_class 
                       WHERE relname = 'logs'""",
                    {}
                )
            else:
                # MySQL: use information_schema
                result = self.db.execute(
                    """SELECT TABLE_ROWS as cnt 
                       FROM information_schema.tables 
                       WHERE table_schema = DATABASE() AND table_name = 'logs'""",
                    {}
                )
            
            if result and result[0].get("cnt"):
                metrics["total_logs"] = int(result[0].get("cnt") or 0)
            else:
                # Fallback to COUNT (slower)
                result = self.db.execute("SELECT COUNT(*) as cnt FROM logs", {})
                metrics["total_logs"] = int((result[0] if result else {}).get("cnt") or 0)
        except Exception as e:
            logger.warning(f"Failed to count total logs: {e}")
            metrics["total_logs"] = 0

        # 5. Requests per minute (last hour average)
        try:
            start_1h = now - 3600
            result = self.db.execute(
                "SELECT COUNT(*) as cnt FROM logs WHERE created_at >= :start_time",
                {"start_time": start_1h}
            )
            logs_1h = int((result[0] if result else {}).get("cnt") or 0)
            metrics["rpm_avg"] = round(logs_1h / 60, 2)
        except Exception as e:
            logger.warning(f"Failed to calculate RPM: {e}")
            metrics["rpm_avg"] = 0

        return metrics

    def _default_metrics(self) -> Dict[str, Any]:
        """Return default metrics when database is unavailable."""
        return {
            "total_users": 0,
            "active_users_24h": 0,
            "logs_24h": 0,
            "total_logs": 0,
            "rpm_avg": 0,
        }

    def _determine_scale(self, metrics: Dict[str, Any]) -> SystemScale:
        """Determine system scale based on collected metrics."""
        total_users = metrics.get("total_users", 0)
        logs_24h = metrics.get("logs_24h", 0)
        rpm_avg = metrics.get("rpm_avg", 0)

        # Primary factor: user count
        # Secondary factors: logs volume and request rate
        
        # XLarge: > 50000 users OR > 10M logs/day OR > 7000 RPM
        if total_users > 50000 or logs_24h > 10_000_000 or rpm_avg > 7000:
            return SystemScale.XLARGE
        
        # Large: > 10000 users OR > 1M logs/day OR > 700 RPM
        if total_users > 10000 or logs_24h > 1_000_000 or rpm_avg > 700:
            return SystemScale.LARGE
        
        # Medium: > 1000 users OR > 100k logs/day OR > 70 RPM
        if total_users > 1000 or logs_24h > 100_000 or rpm_avg > 70:
            return SystemScale.MEDIUM
        
        # Small: everything else
        return SystemScale.SMALL

    def _get_settings_dict(self, scale: SystemScale) -> Dict[str, Any]:
        """Get settings dictionary for a scale level."""
        settings = SCALE_SETTINGS[scale]
        return {
            "scale": settings.scale.value,
            "leaderboard_cache_ttl": settings.leaderboard_cache_ttl,
            "ip_cache_ttl": settings.ip_cache_ttl,
            "stats_cache_ttl": settings.stats_cache_ttl,
            "frontend_refresh_interval": settings.frontend_refresh_interval,
            "description": settings.description,
        }

    def get_current_settings(self) -> ScaleSettings:
        """Get current recommended settings based on detected scale."""
        result = self.detect_scale()
        scale = SystemScale(result["scale"])
        return SCALE_SETTINGS[scale]


# Global service instance
_scale_service: Optional[SystemScaleService] = None
_detected_settings: Optional[ScaleSettings] = None


def get_scale_service() -> SystemScaleService:
    """Get or create the global SystemScaleService instance."""
    global _scale_service
    if _scale_service is None:
        _scale_service = SystemScaleService()
    return _scale_service


def get_detected_settings() -> ScaleSettings:
    """Get detected settings, with lazy initialization."""
    global _detected_settings
    if _detected_settings is None:
        service = get_scale_service()
        _detected_settings = service.get_current_settings()
        logger.success(f"系统规模检测完成: {_detected_settings.description}")
    return _detected_settings


def get_leaderboard_cache_ttl() -> int:
    """Get recommended leaderboard cache TTL."""
    return get_detected_settings().leaderboard_cache_ttl


def get_ip_cache_ttl() -> int:
    """Get recommended IP cache TTL."""
    return get_detected_settings().ip_cache_ttl


def get_frontend_refresh_interval() -> int:
    """Get recommended frontend refresh interval."""
    return get_detected_settings().frontend_refresh_interval


def refresh_scale_detection() -> Dict[str, Any]:
    """Force refresh scale detection."""
    global _detected_settings
    service = get_scale_service()
    result = service.detect_scale(force_refresh=True)
    _detected_settings = SCALE_SETTINGS[SystemScale(result["scale"])]
    logger.system(f"系统规模重新检测: {_detected_settings.description}")
    return result

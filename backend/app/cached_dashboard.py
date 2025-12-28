"""
Cached Dashboard Service for NewAPI Middleware Tool.
Wraps DashboardService with caching layer to reduce database load.

针对大型系统（千万级日志），使用更长的缓存TTL以减少数据库压力。

缓存架构：
- 使用 CacheManager 统一缓存管理器（SQLite + Redis 混合）
- Redis 可用时优先使用 Redis（毫秒级响应）
- Redis 不可用时降级到 SQLite（仍然很快）
"""
import time
from dataclasses import asdict
from typing import Any, Dict, List, Optional

from .cache_manager import get_cache_manager as get_unified_cache_manager
from .dashboard_service import (
    DashboardService,
    DailyTrend,
    ModelUsage,
    SystemOverview,
    UserRanking,
    UsageStatistics,
    get_dashboard_service,
)
from .local_storage import get_local_storage
from .logger import logger


def _get_ttl_multiplier() -> float:
    """
    根据系统规模获取缓存TTL倍数。
    大型系统使用更长的缓存时间以减少数据库压力。
    """
    try:
        from .system_scale_service import get_detected_settings
        settings = get_detected_settings()
        scale = settings.scale if hasattr(settings, 'scale') else 'medium'

        # 大型/超大型系统使用更长的缓存
        multipliers = {
            'tiny': 0.5,      # 小型系统可以更频繁刷新
            'small': 1.0,
            'medium': 1.5,
            'large': 3.0,     # 大型系统缓存时间x3
            'xlarge': 5.0,    # 超大型系统缓存时间x5
        }
        return multipliers.get(scale, 1.5)
    except Exception:
        return 1.5  # 默认使用1.5倍


class CachedDashboardService:
    """
    Dashboard service with caching layer.
    Caches expensive database queries to reduce load.
    
    使用 CacheManager 统一缓存管理器：
    - L1: Redis（如果可用）
    - L2: SQLite（持久化备份）
    """

    def __init__(self):
        self._service = get_dashboard_service()
        self._storage = get_local_storage()
        self._cache = get_unified_cache_manager()  # 使用统一缓存管理器

    @property
    def service(self) -> DashboardService:
        return self._service

    def get_system_overview(self, period: str = "7d", use_cache: bool = True) -> Dict[str, Any]:
        """
        Get system overview with caching.

        Args:
            use_cache: Whether to use cached data (default True)

        Returns:
            System overview data
        """
        cache_key = f"dashboard:overview:{period}"

        if use_cache:
            # 使用统一缓存管理器
            cached_data = self._cache.get(cache_key)
            if cached_data:
                return cached_data

        # Calculate time range for active counts
        end_time = int(time.time())
        period_map = {
            "24h": 24 * 3600,
            "3d": 3 * 24 * 3600,
            "7d": 7 * 24 * 3600,
            "14d": 14 * 24 * 3600,
        }
        start_time = end_time - period_map.get(period, 7 * 24 * 3600)

        # Fetch fresh data
        overview = self.service.get_system_overview(active_start_time=start_time, active_end_time=end_time)
        data = asdict(overview)
        data["period"] = period

        ttl_map = {
            "24h": 60,
            "3d": 300,
            "7d": 300,
            "14d": 600,
        }
        ttl = int(ttl_map.get(period, 300) * _get_ttl_multiplier())
        
        # 使用统一缓存管理器保存
        self._cache.set(cache_key, data, ttl=ttl)

        # Also save as snapshot (保留本地快照功能)
        self._storage.save_stats_snapshot("overview", data)

        return data

    def get_usage_statistics(
        self,
        period: str = "24h",
        use_cache: bool = True,
    ) -> Dict[str, Any]:
        """
        Get usage statistics with caching.

        Args:
            period: Time period (1h, 6h, 24h, 7d, 30d)
            use_cache: Whether to use cached data

        Returns:
            Usage statistics data
        """
        cache_key = f"dashboard:usage:{period}"

        if use_cache:
            cached_data = self._cache.get(cache_key)
            if cached_data:
                return cached_data

        # Calculate time range
        end_time = int(time.time())
        period_map = {
            "1h": 3600,
            "6h": 6 * 3600,
            "24h": 24 * 3600,
            "3d": 3 * 24 * 3600,
            "7d": 7 * 24 * 3600,
            "14d": 14 * 24 * 3600,
        }
        start_time = end_time - period_map.get(period, 24 * 3600)

        # Fetch fresh data
        stats = self.service.get_usage_statistics(start_time=start_time, end_time=end_time)
        data = {
            "period": period,
            **asdict(stats),
        }

        # Cache based on period (大型系统自动延长TTL)
        ttl_map = {
            "1h": 60,      # 1 minute for hourly
            "6h": 120,     # 2 minutes
            "24h": 300,    # 5 minutes
            "3d": 600,     # 10 minutes
            "7d": 600,     # 10 minutes
            "14d": 900,    # 15 minutes
        }
        ttl = int(ttl_map.get(period, 300) * _get_ttl_multiplier())
        self._cache.set(cache_key, data, ttl=ttl)

        return data

    def get_model_usage(
        self,
        period: str = "7d",
        limit: int = 10,
        use_cache: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        Get model usage distribution with caching.

        Args:
            period: Time period
            limit: Max number of models
            use_cache: Whether to use cached data

        Returns:
            List of model usage data
        """
        cache_key = f"dashboard:models:{period}:{limit}"

        if use_cache:
            cached_data = self._cache.get(cache_key)
            if cached_data:
                return cached_data

        # Calculate time range
        end_time = int(time.time())
        period_map = {
            "24h": 24 * 3600,
            "3d": 3 * 24 * 3600,
            "7d": 7 * 24 * 3600,
            "14d": 14 * 24 * 3600,
        }
        start_time = end_time - period_map.get(period, 7 * 24 * 3600)

        # Fetch fresh data
        models = self.service.get_model_usage(
            start_time=start_time,
            end_time=end_time,
            limit=limit,
        )
        data = [asdict(m) for m in models]

        # Cache for 10 minutes (大型系统自动延长)
        ttl = int(600 * _get_ttl_multiplier())
        self._cache.set(cache_key, data, ttl=ttl)

        # Save snapshot (保留本地快照功能)
        self._storage.save_stats_snapshot("models", {"period": period, "models": data})

        return data

    def get_daily_trends(
        self,
        days: int = 7,
        use_cache: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        Get daily trends with caching.

        Args:
            days: Number of days
            use_cache: Whether to use cached data

        Returns:
            List of daily trend data
        """
        cache_key = f"dashboard:trends:daily:{days}"

        if use_cache:
            cached_data = self._cache.get(cache_key)
            if cached_data:
                return cached_data

        # Fetch fresh data
        trends = self.service.get_daily_trends(days=days)
        data = [asdict(t) for t in trends]

        # Cache for 15 minutes (大型系统自动延长)
        ttl = int(900 * _get_ttl_multiplier())
        self._cache.set(cache_key, data, ttl=ttl)

        return data

    def get_hourly_trends(
        self,
        hours: int = 24,
        use_cache: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        Get hourly trends with caching.

        Args:
            hours: Number of hours
            use_cache: Whether to use cached data

        Returns:
            List of hourly trend data
        """
        cache_key = f"dashboard:trends:hourly:{hours}"

        if use_cache:
            cached_data = self._cache.get(cache_key)
            if cached_data:
                return cached_data

        # Fetch fresh data
        data = self.service.get_hourly_trends(hours=hours)

        # Cache for 5 minutes (大型系统自动延长)
        ttl = int(300 * _get_ttl_multiplier())
        self._cache.set(cache_key, data, ttl=ttl)

        return data

    def get_top_users(
        self,
        period: str = "7d",
        limit: int = 10,
        use_cache: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        Get top users with caching.

        Args:
            period: Time period
            limit: Max number of users
            use_cache: Whether to use cached data

        Returns:
            List of top user data
        """
        cache_key = f"dashboard:topusers:{period}:{limit}"

        if use_cache:
            cached_data = self._cache.get(cache_key)
            if cached_data:
                return cached_data

        # Calculate time range
        end_time = int(time.time())
        period_map = {
            "24h": 24 * 3600,
            "3d": 3 * 24 * 3600,
            "7d": 7 * 24 * 3600,
            "14d": 14 * 24 * 3600,
        }
        start_time = end_time - period_map.get(period, 7 * 24 * 3600)

        # Fetch fresh data
        users = self.service.get_top_users(
            start_time=start_time,
            end_time=end_time,
            limit=limit,
        )
        data = [asdict(u) for u in users]

        # Cache for 10 minutes (大型系统自动延长)
        ttl = int(600 * _get_ttl_multiplier())
        self._cache.set(cache_key, data, ttl=ttl)

        return data

    def get_channel_status(self, use_cache: bool = True) -> List[Dict[str, Any]]:
        """
        Get channel status with caching.

        Args:
            use_cache: Whether to use cached data

        Returns:
            List of channel status data
        """
        cache_key = "dashboard:channels"

        if use_cache:
            cached_data = self._cache.get(cache_key)
            if cached_data:
                return cached_data

        # Fetch fresh data
        data = self.service.get_channel_status()

        # Cache for 2 minutes (大型系统自动延长)
        ttl = int(120 * _get_ttl_multiplier())
        self._cache.set(cache_key, data, ttl=ttl)

        return data

    def invalidate_cache(self, pattern: Optional[str] = None) -> int:
        """
        Invalidate dashboard cache.
        注意：此方法仅清除本地 SQLite 缓存，Redis 缓存会自动过期。

        Args:
            pattern: Optional pattern to match (e.g., 'dashboard:overview')

        Returns:
            Number of entries invalidated
        """
        if pattern:
            return self._storage.cache_clear(f"{pattern}%")
        return self._storage.cache_clear("dashboard:%")

    def get_latest_snapshot(self, snapshot_type: str) -> Optional[Dict[str, Any]]:
        """Get the latest statistics snapshot."""
        return self._storage.get_latest_snapshot(snapshot_type)


# Global instance
_cached_dashboard_service: Optional[CachedDashboardService] = None


def get_cached_dashboard_service() -> CachedDashboardService:
    """Get or create the global CachedDashboardService instance."""
    global _cached_dashboard_service
    if _cached_dashboard_service is None:
        _cached_dashboard_service = CachedDashboardService()
    return _cached_dashboard_service

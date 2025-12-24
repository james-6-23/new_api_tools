"""
Cached Dashboard Service for NewAPI Middleware Tool.
Wraps DashboardService with caching layer to reduce database load.
"""
import logging
import time
from dataclasses import asdict
from typing import Any, Dict, List, Optional

from .cache import cached, get_cache_manager
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

logger = logging.getLogger(__name__)


class CachedDashboardService:
    """
    Dashboard service with caching layer.
    Caches expensive database queries to reduce load.
    """

    def __init__(self):
        self._service = get_dashboard_service()
        self._storage = get_local_storage()

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
            cached_data = self._storage.cache_get(cache_key)
            if cached_data:
                logger.debug("Using cached system overview")
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
        self._storage.cache_set(cache_key, data, ttl=ttl_map.get(period, 300))

        # Also save as snapshot
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
            cached_data = self._storage.cache_get(cache_key)
            if cached_data:
                logger.debug(f"Using cached usage stats for {period}")
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

        # Cache based on period
        ttl_map = {
            "1h": 60,      # 1 minute for hourly
            "6h": 120,     # 2 minutes
            "24h": 300,    # 5 minutes
            "3d": 600,     # 10 minutes
            "7d": 600,     # 10 minutes
            "14d": 900,    # 15 minutes
        }
        self._storage.cache_set(cache_key, data, ttl=ttl_map.get(period, 300))

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
            cached_data = self._storage.cache_get(cache_key)
            if cached_data:
                logger.debug(f"Using cached model usage for {period}")
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

        # Cache for 10 minutes
        self._storage.cache_set(cache_key, data, ttl=600)

        # Save snapshot
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
            cached_data = self._storage.cache_get(cache_key)
            if cached_data:
                logger.debug(f"Using cached daily trends for {days} days")
                return cached_data

        # Fetch fresh data
        trends = self.service.get_daily_trends(days=days)
        data = [asdict(t) for t in trends]

        # Cache for 15 minutes
        self._storage.cache_set(cache_key, data, ttl=900)

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
            cached_data = self._storage.cache_get(cache_key)
            if cached_data:
                logger.debug(f"Using cached hourly trends for {hours} hours")
                return cached_data

        # Fetch fresh data
        data = self.service.get_hourly_trends(hours=hours)

        # Cache for 5 minutes
        self._storage.cache_set(cache_key, data, ttl=300)

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
            cached_data = self._storage.cache_get(cache_key)
            if cached_data:
                logger.debug(f"Using cached top users for {period}")
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

        # Cache for 10 minutes
        self._storage.cache_set(cache_key, data, ttl=600)

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
            cached_data = self._storage.cache_get(cache_key)
            if cached_data:
                logger.debug("Using cached channel status")
                return cached_data

        # Fetch fresh data
        data = self.service.get_channel_status()

        # Cache for 2 minutes
        self._storage.cache_set(cache_key, data, ttl=120)

        return data

    def invalidate_cache(self, pattern: Optional[str] = None) -> int:
        """
        Invalidate dashboard cache.

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

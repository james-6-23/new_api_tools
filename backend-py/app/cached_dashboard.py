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

from .cache_manager import get_cache_manager as get_unified_cache_manager, SLOT_CONFIG
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


# 支持增量缓存的周期
INCREMENTAL_PERIODS = {"3d", "7d", "14d"}


def _get_system_scale() -> str:
    """获取当前系统规模"""
    try:
        from .system_scale_service import get_detected_settings
        settings = get_detected_settings()
        return settings.scale.value if hasattr(settings, 'scale') else 'medium'
    except Exception:
        return 'medium'


def _get_ttl_config(period: str) -> int:
    """
    获取差异化缓存 TTL 配置。

    策略：
    - 短周期（24h）：数据变化快，使用较短 TTL
    - 长周期（3d/7d/14d）：数据相对稳定，使用更长 TTL
    - 大型系统：进一步延长 TTL 减少数据库压力

    针对 2w+ 用户、100w+ 日志的公益站场景优化。
    """
    scale = _get_system_scale()

    # 差异化 TTL 配置（秒）
    # 格式: {period: {scale: ttl}}
    TTL_CONFIG = {
        # 24h 数据变化快，保持较短 TTL
        "1h": {"small": 30, "medium": 60, "large": 120, "xlarge": 180},
        "6h": {"small": 60, "medium": 120, "large": 180, "xlarge": 300},
        "24h": {"small": 60, "medium": 120, "large": 180, "xlarge": 300},
        # 3d+ 数据相对稳定，使用更长 TTL
        "3d": {"small": 300, "medium": 600, "large": 1800, "xlarge": 3600},      # large: 30分钟
        "7d": {"small": 300, "medium": 900, "large": 2700, "xlarge": 5400},      # large: 45分钟
        "14d": {"small": 600, "medium": 1200, "large": 3600, "xlarge": 7200},    # large: 60分钟
    }

    period_config = TTL_CONFIG.get(period, TTL_CONFIG["7d"])
    return period_config.get(scale, period_config.get("medium", 300))


def _get_ttl_multiplier() -> float:
    """
    获取 TTL 倍数（用于没有明确 period 的场景）。
    保留向后兼容。
    """
    scale = _get_system_scale()
    multipliers = {
        'tiny': 0.5,
        'small': 1.0,
        'medium': 2.0,
        'large': 5.0,
        'xlarge': 10.0,
    }
    return multipliers.get(scale, 2.0)


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

        # 使用差异化 TTL 配置
        ttl = _get_ttl_config(period)

        # 使用统一缓存管理器保存
        self._cache.set(cache_key, data, ttl=ttl)
        logger.success(
            f"Dashboard 缓存更新: overview",
            period=period,
            users=data.get("total_users", 0),
            tokens=data.get("total_tokens", 0),
            TTL=f"{ttl}s"
        )

        # Also save as snapshot (保留本地快照功能)
        self._storage.save_stats_snapshot("overview", data)

        return data

    def get_usage_statistics(
        self,
        period: str = "24h",
        use_cache: bool = True,
        log_progress: bool = False,
    ) -> Dict[str, Any]:
        """
        Get usage statistics with caching.

        Args:
            period: Time period (1h, 6h, 24h, 7d, 30d)
            use_cache: Whether to use cached data
            log_progress: Whether to log incremental progress (for warmup)

        Returns:
            Usage statistics data
        """
        cache_key = f"dashboard:usage:{period}"

        if use_cache:
            cached_data = self._cache.get(cache_key)
            if cached_data:
                return cached_data

        # 对于 3d/7d/14d 使用增量缓存
        if period in INCREMENTAL_PERIODS:
            stats_data = self._get_usage_statistics_incremental(period, log_progress)
            data = {
                "period": period,
                **stats_data,
            }
        else:
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

        # 使用差异化 TTL 配置
        ttl = _get_ttl_config(period)
        self._cache.set(cache_key, data, ttl=ttl)

        mode_tag = " [增量]" if period in INCREMENTAL_PERIODS else ""
        logger.success(
            f"Dashboard 缓存更新: usage{mode_tag}",
            period=period,
            requests=data.get("total_requests", 0),
            tokens=data.get("total_prompt_tokens", 0) + data.get("total_completion_tokens", 0),
            TTL=f"{ttl}s"
        )

        return data

    def _get_usage_statistics_incremental(
        self,
        period: str,
        log_progress: bool = False,
    ) -> Dict[str, Any]:
        """
        使用增量缓存获取使用统计数据

        流程：
        1. 获取缺失的槽和已缓存的槽
        2. 只查询缺失的槽
        3. 聚合所有槽数据
        """
        now = int(time.time())

        # 获取缺失的槽和已缓存的槽
        missing_slots, cached_slots = self._cache.get_dashboard_missing_slots(
            "usage_stats", period, now
        )

        if log_progress:
            total_slots = len(missing_slots) + len(cached_slots)
            logger.info(
                f"[Dashboard增量] usage_stats@{period} 槽状态",
                总槽数=total_slots,
                已缓存=len(cached_slots),
                待查询=len(missing_slots),
            )

        # 查询缺失的槽
        for slot in missing_slots:
            slot_start = slot["slot_start"]
            slot_end = slot["slot_end"]

            if log_progress:
                from datetime import datetime
                start_str = datetime.fromtimestamp(slot_start).strftime("%m-%d %H:%M")
                end_str = datetime.fromtimestamp(slot_end).strftime("%m-%d %H:%M")
                logger.debug(f"[Dashboard增量] 查询槽 {start_str} ~ {end_str}")

            # 查询槽数据
            slot_data = self.service.get_usage_statistics_slot(slot_start, slot_end)

            # 保存到槽缓存
            self._cache.set_dashboard_slot("usage_stats", period, slot_start, slot_end, slot_data)

            # 添加到已缓存的槽
            cached_slots[slot_start] = {
                "slot_end": slot_end,
                "data": slot_data,
            }

        # 聚合所有槽数据
        result = self._cache.aggregate_dashboard_slots("usage_stats", cached_slots)

        if log_progress:
            logger.success(
                f"[Dashboard增量] usage_stats@{period} 聚合完成",
                槽数=len(cached_slots),
                请求数=result.get("total_requests", 0),
            )

        return result

    def get_model_usage(
        self,
        period: str = "7d",
        limit: int = 10,
        use_cache: bool = True,
        log_progress: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        Get model usage distribution with caching.

        Args:
            period: Time period
            limit: Max number of models
            use_cache: Whether to use cached data
            log_progress: Whether to log incremental progress (for warmup)

        Returns:
            List of model usage data
        """
        cache_key = f"dashboard:models:{period}:{limit}"

        if use_cache:
            cached_data = self._cache.get(cache_key)
            if cached_data:
                return cached_data

        # 对于 3d/7d/14d 使用增量缓存
        if period in INCREMENTAL_PERIODS:
            data = self._get_model_usage_incremental(period, limit, log_progress)
        else:
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

        mode_tag = " [增量]" if period in INCREMENTAL_PERIODS else ""
        logger.success(
            f"Dashboard 缓存更新: models{mode_tag}",
            period=period,
            limit=limit,
            models=len(data),
            TTL=f"{ttl}s"
        )

        # Save snapshot (保留本地快照功能)
        self._storage.save_stats_snapshot("models", {"period": period, "models": data})

        return data

    def _get_model_usage_incremental(
        self,
        period: str,
        limit: int,
        log_progress: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        使用增量缓存获取模型使用数据

        流程：
        1. 获取缺失的槽和已缓存的槽
        2. 只查询缺失的槽
        3. 聚合所有槽数据生成 Top N
        """
        now = int(time.time())

        # 获取缺失的槽和已缓存的槽
        missing_slots, cached_slots = self._cache.get_dashboard_missing_slots(
            "model_usage", period, now
        )

        if log_progress:
            total_slots = len(missing_slots) + len(cached_slots)
            logger.info(
                f"[Dashboard增量] model_usage@{period} 槽状态",
                总槽数=total_slots,
                已缓存=len(cached_slots),
                待查询=len(missing_slots),
            )

        # 查询缺失的槽
        for slot in missing_slots:
            slot_start = slot["slot_start"]
            slot_end = slot["slot_end"]

            if log_progress:
                from datetime import datetime
                start_str = datetime.fromtimestamp(slot_start).strftime("%m-%d %H:%M")
                end_str = datetime.fromtimestamp(slot_end).strftime("%m-%d %H:%M")
                logger.debug(f"[Dashboard增量] 查询槽 {start_str} ~ {end_str}")

            # 查询槽数据
            slot_data = self.service.get_model_usage_slot(slot_start, slot_end, limit=100)

            # 保存到槽缓存
            self._cache.set_dashboard_slot("model_usage", period, slot_start, slot_end, slot_data)

            # 添加到已缓存的槽
            cached_slots[slot_start] = {
                "slot_end": slot_end,
                "data": slot_data,
            }

        # 聚合所有槽数据
        result = self._cache.aggregate_dashboard_slots("model_usage", cached_slots, limit)

        if log_progress:
            logger.success(
                f"[Dashboard增量] model_usage@{period} 聚合完成",
                槽数=len(cached_slots),
                结果数=len(result),
            )

        return result

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
        logger.success(
            f"Dashboard 缓存更新: daily_trends",
            days=days,
            records=len(data),
            TTL=f"{ttl}s"
        )

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
        logger.success(
            f"Dashboard 缓存更新: hourly_trends",
            hours=hours,
            records=len(data),
            TTL=f"{ttl}s"
        )

        return data

    def get_top_users(
        self,
        period: str = "7d",
        limit: int = 10,
        use_cache: bool = True,
        log_progress: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        Get top users with caching.

        Args:
            period: Time period
            limit: Max number of users
            use_cache: Whether to use cached data
            log_progress: Whether to log incremental progress (for warmup)

        Returns:
            List of top user data
        """
        cache_key = f"dashboard:topusers:{period}:{limit}"

        if use_cache:
            cached_data = self._cache.get(cache_key)
            if cached_data:
                return cached_data

        # 对于 3d/7d/14d 使用增量缓存
        if period in INCREMENTAL_PERIODS:
            data = self._get_top_users_incremental(period, limit, log_progress)
        else:
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

        mode_tag = " [增量]" if period in INCREMENTAL_PERIODS else ""
        logger.success(
            f"Dashboard 缓存更新: top_users{mode_tag}",
            period=period,
            limit=limit,
            users=len(data),
            TTL=f"{ttl}s"
        )

        return data

    def _get_top_users_incremental(
        self,
        period: str,
        limit: int,
        log_progress: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        使用增量缓存获取用户排行数据

        流程：
        1. 获取缺失的槽和已缓存的槽
        2. 只查询缺失的槽
        3. 聚合所有槽数据生成 Top N
        """
        now = int(time.time())

        # 获取缺失的槽和已缓存的槽
        missing_slots, cached_slots = self._cache.get_dashboard_missing_slots(
            "top_users", period, now
        )

        if log_progress:
            total_slots = len(missing_slots) + len(cached_slots)
            logger.info(
                f"[Dashboard增量] top_users@{period} 槽状态",
                总槽数=total_slots,
                已缓存=len(cached_slots),
                待查询=len(missing_slots),
            )

        # 查询缺失的槽
        for slot in missing_slots:
            slot_start = slot["slot_start"]
            slot_end = slot["slot_end"]

            if log_progress:
                from datetime import datetime
                start_str = datetime.fromtimestamp(slot_start).strftime("%m-%d %H:%M")
                end_str = datetime.fromtimestamp(slot_end).strftime("%m-%d %H:%M")
                logger.debug(f"[Dashboard增量] 查询槽 {start_str} ~ {end_str}")

            # 查询槽数据
            slot_data = self.service.get_top_users_slot(slot_start, slot_end, limit=100)

            # 保存到槽缓存
            self._cache.set_dashboard_slot("top_users", period, slot_start, slot_end, slot_data)

            # 添加到已缓存的槽
            cached_slots[slot_start] = {
                "slot_end": slot_end,
                "data": slot_data,
            }

        # 聚合所有槽数据
        result = self._cache.aggregate_dashboard_slots("top_users", cached_slots, limit)

        if log_progress:
            logger.success(
                f"[Dashboard增量] top_users@{period} 聚合完成",
                槽数=len(cached_slots),
                结果数=len(result),
            )

        return result

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
        logger.success(
            f"Dashboard 缓存更新: channels",
            channels=len(data),
            TTL=f"{ttl}s"
        )

        return data

    def get_refresh_estimate(self, period: str = "7d") -> Dict[str, Any]:
        """
        获取强制刷新的预估信息（仅大型系统显示）。

        返回预估的日志数量、查询时间等信息，
        帮助用户了解刷新操作的影响。

        Args:
            period: 时间周期

        Returns:
            预估信息，包含日志数量、预计时间等
        """
        scale = _get_system_scale()

        # 只有大型/超大型系统才返回详细预估
        if scale not in ("large", "xlarge"):
            return {
                "show_estimate": False,
                "scale": scale,
            }

        # 获取系统指标
        try:
            from .system_scale_service import get_scale_service
            service = get_scale_service()
            result = service.detect_scale()
            metrics = result.get("metrics", {})

            logs_24h = metrics.get("logs_24h", 0)
            total_logs = metrics.get("total_logs", 0)

            # 根据周期估算日志数量
            period_hours = {
                "1h": 1, "6h": 6, "24h": 24,
                "3d": 72, "7d": 168, "14d": 336,
            }
            hours = period_hours.get(period, 168)
            hourly_rate = logs_24h / 24 if logs_24h > 0 else 0

            if hours <= 24:
                estimated_logs = int(hourly_rate * hours)
            elif period == "3d":
                estimated_logs = int(logs_24h * 2.5)
            elif period == "7d":
                estimated_logs = int(logs_24h * 5)
            else:  # 14d
                estimated_logs = int(logs_24h * 10)

            # 根据日志数量估算查询时间（秒）
            # 有索引的情况下，大约每 100 万条日志需要 3-5 秒
            if estimated_logs > 5_000_000:
                estimated_seconds = int(estimated_logs / 1_000_000 * 5)
            elif estimated_logs > 1_000_000:
                estimated_seconds = int(estimated_logs / 1_000_000 * 4)
            elif estimated_logs > 100_000:
                estimated_seconds = max(3, int(estimated_logs / 100_000 * 1.5))
            else:
                estimated_seconds = 2

            # 格式化日志数量
            if estimated_logs >= 1_000_000:
                logs_formatted = f"{estimated_logs / 1_000_000:.1f}M"
            elif estimated_logs >= 1_000:
                logs_formatted = f"{estimated_logs / 1_000:.1f}K"
            else:
                logs_formatted = str(estimated_logs)

            return {
                "show_estimate": True,
                "scale": scale,
                "scale_description": "大型系统" if scale == "large" else "超大型系统",
                "period": period,
                "estimated_logs": estimated_logs,
                "estimated_logs_formatted": logs_formatted,
                "estimated_seconds": estimated_seconds,
                "estimated_time_formatted": f"{estimated_seconds}~{int(estimated_seconds * 1.5)} 秒",
                "warning": "刷新过程中数据库负载会升高，请在低峰期执行" if estimated_logs > 1_000_000 else None,
                "total_logs": total_logs,
                "logs_24h": logs_24h,
            }
        except Exception as e:
            logger.warning(f"获取刷新预估失败: {e}")
            return {
                "show_estimate": True,
                "scale": scale,
                "error": str(e),
            }

    def invalidate_cache(self, pattern: Optional[str] = None) -> int:
        """
        Invalidate dashboard cache.
        清除 unified CacheManager（Redis + SQLite）的通用缓存（generic_cache）。

        Args:
            pattern: Optional pattern to match (e.g., 'dashboard:overview')

        Returns:
            Number of entries invalidated
        """
        prefix = (pattern or "dashboard:").rstrip("%")
        return self._cache.clear_generic_prefix(prefix)

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

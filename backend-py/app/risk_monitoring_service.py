"""
Risk Monitoring Service for NewAPI Middleware Tool.
Provides real-time usage leaderboards and per-user usage analysis for moderation.

Performance Optimizations:
- In-memory cache for leaderboards (TTL based on system scale)
- Single query for all time windows (query once, filter in memory)
- Removed JOIN with users table (fetch user info separately only for top N)
- Recommended index: CREATE INDEX idx_logs_created_type_user ON logs(created_at, type, user_id);
"""
import time
import threading
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from .database import DatabaseManager, DatabaseEngine, get_db_manager
from .logger import logger


WINDOW_SECONDS: dict[str, int] = {
    "1h": 1 * 3600,
    "3h": 3 * 3600,
    "6h": 6 * 3600,
    "12h": 12 * 3600,
    "24h": 24 * 3600,
    "3d": 3 * 24 * 3600,
    "7d": 7 * 24 * 3600,
}


def _get_cache_ttl() -> int:
    """Get cache TTL based on system scale (lazy import to avoid circular dependency)."""
    try:
        from .system_scale_service import get_leaderboard_cache_ttl
        return get_leaderboard_cache_ttl()
    except Exception:
        return 300  # Default fallback: 5 minutes


@dataclass
class CacheEntry:
    """Cache entry with data and expiration time."""
    data: Any
    expires_at: float


class SimpleCache:
    """Thread-safe in-memory cache with TTL."""
    
    def __init__(self):
        self._cache: Dict[str, CacheEntry] = {}
        self._lock = threading.Lock()
    
    def get(self, key: str) -> Optional[Any]:
        """Get value from cache if not expired."""
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            if time.time() > entry.expires_at:
                del self._cache[key]
                return None
            return entry.data
    
    def set(self, key: str, value: Any, ttl: float):
        """Set value in cache with TTL."""
        with self._lock:
            self._cache[key] = CacheEntry(data=value, expires_at=time.time() + ttl)
    
    def clear(self):
        """Clear all cache entries."""
        with self._lock:
            self._cache.clear()


# Global cache instance
_cache = SimpleCache()


class RiskMonitoringService:
    """Service for real-time usage monitoring and moderation insights."""

    def __init__(self, db: Optional[DatabaseManager] = None):
        self._db = db
        self._cache_manager = None

    @property
    def db(self) -> DatabaseManager:
        if self._db is None:
            self._db = get_db_manager()
        return self._db
    
    @property
    def cache(self):
        """获取缓存管理器（延迟加载）"""
        if self._cache_manager is None:
            from .cache_manager import get_cache_manager
            self._cache_manager = get_cache_manager()
        return self._cache_manager

    def get_leaderboards(
        self,
        windows: List[str],
        limit: int = 10,
        sort_by: str = "requests",
        use_cache: bool = True,
        log_progress: bool = False,
    ) -> Dict[str, Any]:
        """
        Get leaderboards for multiple time windows.

        Performance optimization:
        - 三层缓存：Redis → SQLite → PostgreSQL
        - Per-window cache to support independent refresh
        - No JOIN with users table (fetch user info separately for top N only)
        
        千万级数据处理策略：
        - SQL 使用 GROUP BY user_id 聚合，只返回 Top N 用户
        - 利用索引 idx_logs_created_type_user 加速查询
        - 不扫描全表，只聚合符合时间条件的数据
        - 返回结果只有 limit 条（默认 50），内存占用极小
        """
        now = int(time.time())
        cache_ttl = _get_cache_ttl()

        # Query each window separately, using per-window cache
        data: Dict[str, Any] = {}
        all_user_ids = set()
        window_results: Dict[str, List[Dict]] = {}

        for w in windows:
            seconds = WINDOW_SECONDS.get(w)
            if not seconds:
                continue

            # 优先使用新的缓存管理器（SQLite + Redis）
            if use_cache:
                cached = self.cache.get_leaderboard(w, sort_by, limit)
                if cached is not None:
                    if log_progress:
                        logger.debug(f"[预热] {w} 命中缓存，{len(cached)} 条数据")
                    window_results[w] = cached
                    for item in cached:
                        all_user_ids.add(item.get("user_id"))
                    continue
                
                # 降级到内存缓存（兼容旧逻辑）
                window_cache_key = f"leaderboard:{w}:{limit}:{sort_by}"
                cached = _cache.get(window_cache_key)
                if cached is not None:
                    if log_progress:
                        logger.debug(f"[预热] {w} 命中内存缓存，{len(cached)} 条数据")
                    window_results[w] = cached
                    for item in cached:
                        all_user_ids.add(item["user_id"])
                    continue

            # Cache miss - query database (只读)
            if log_progress:
                logger.debug(f"[预热] {w} 缓存未命中，查询数据库...")

            # 对 3d/7d 使用增量缓存查询
            if self.cache.is_incremental_window(w):
                if log_progress:
                    logger.info(f"[预热] {w} 使用增量缓存模式")
                raw_data = self._get_leaderboard_incremental(
                    window=w, limit=limit, now=now, sort_by=sort_by, log_progress=log_progress
                )
            else:
                raw_data = self._get_leaderboard_raw(
                    window_seconds=seconds, limit=limit, now=now, sort_by=sort_by
                )

            window_results[w] = raw_data

            if log_progress:
                logger.debug(f"[预热] {w} 数据库返回 {len(raw_data)} 条数据")

            # 保存到新缓存管理器（SQLite + Redis）
            self.cache.set_leaderboard(w, sort_by, raw_data, cache_ttl)
            logger.success(
                f"风控排行 缓存更新: {w}",
                sort_by=sort_by,
                users=len(raw_data),
                TTL=f"{cache_ttl}s"
            )

            # 同时更新内存缓存（兼容）
            window_cache_key = f"leaderboard:{w}:{limit}:{sort_by}"
            _cache.set(window_cache_key, raw_data, cache_ttl)

            # Collect user IDs for batch fetch
            for item in raw_data:
                all_user_ids.add(item["user_id"])
        
        # Batch fetch user info for all users across all windows
        user_info_map = self._get_users_info_batch(list(all_user_ids))
        
        # Merge user info into results
        for w, raw_data in window_results.items():
            data[w] = []
            for item in raw_data:
                user_info = user_info_map.get(item["user_id"], {})
                data[w].append({
                    "user_id": item["user_id"],
                    "username": user_info.get("display_name") or user_info.get("username") or item.get("username") or "",
                    "user_status": user_info.get("status", 0),
                    "request_count": item["request_count"],
                    "failure_requests": item["failure_requests"],
                    "failure_rate": item["failure_rate"],
                    "quota_used": item["quota_used"],
                    "prompt_tokens": item["prompt_tokens"],
                    "completion_tokens": item["completion_tokens"],
                    "unique_ips": item["unique_ips"],
                })
        
        result = {"generated_at": now, "windows": data}

        # Per-window cache already updated above, no need for combined cache
        return result

    def _get_leaderboard_incremental(
        self,
        window: str,
        limit: int,
        now: int,
        sort_by: str,
        log_progress: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        增量获取排行榜数据（仅用于 3d/7d）

        流程：
        1. 计算需要的所有槽
        2. 检查已缓存的槽
        3. 只查询缺失的槽
        4. 聚合所有槽数据生成 Top N
        """
        # 获取缺失的槽和已缓存的槽
        missing_slots, cached_slots = self.cache.get_missing_slots(window, sort_by, now)

        if log_progress:
            total_slots = len(missing_slots) + len(cached_slots)
            logger.info(
                f"[增量预热] {window} 槽状态",
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
                logger.debug(f"[增量预热] 查询槽 {start_str} ~ {end_str}")

            # 查询该槽的数据（不限制 limit，获取所有用户）
            slot_data = self._get_slot_data(slot_start, slot_end, sort_by)

            # 保存到槽缓存
            self.cache.set_slot(window, sort_by, slot_start, slot_end, slot_data)

            # 添加到已缓存的槽
            cached_slots[slot_start] = {
                "slot_end": slot_end,
                "data": slot_data,
            }

            if log_progress:
                logger.debug(f"[增量预热] 槽缓存完成，用户数={len(slot_data)}")

        # 聚合所有槽数据
        result = self.cache.aggregate_slots(cached_slots, sort_by, limit)

        if log_progress:
            logger.success(
                f"[增量预热] {window} 聚合完成",
                槽数=len(cached_slots),
                Top用户数=len(result),
            )

        return result

    def _get_slot_data(
        self,
        start_time: int,
        end_time: int,
        sort_by: str,
    ) -> List[Dict[str, Any]]:
        """
        查询单个时间槽的用户聚合数据（不限制数量）

        注意：返回该槽内所有活跃用户的数据，用于后续跨槽聚合
        """
        order_by_map = {
            "requests": "total_requests DESC",
            "quota": "quota_used DESC",
            "failure_rate": "failure_rate DESC, total_requests DESC",
        }
        order_by = order_by_map.get(sort_by, order_by_map["requests"])

        # 查询该槽内所有用户的聚合数据
        # 为了控制数据量，限制最多 500 个用户（Top 500 足够覆盖 Top 50 聚合）
        sql = """
            SELECT
                user_id,
                MAX(username) as username,
                COUNT(*) as total_requests,
                SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_requests,
                (SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) * 1.0) / NULLIF(COUNT(*), 0) as failure_rate,
                COALESCE(SUM(quota), 0) as quota_used,
                COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) as completion_tokens,
                COUNT(DISTINCT NULLIF(ip, '')) as unique_ips
            FROM logs
            WHERE created_at >= :start_time AND created_at < :end_time
                AND type IN (2, 5)
                AND user_id IS NOT NULL
            GROUP BY user_id
            ORDER BY """ + order_by + """
            LIMIT 500
        """

        try:
            self.db.connect()
            rows = self.db.execute(sql, {"start_time": start_time, "end_time": end_time})
        except Exception as e:
            logger.db_error(f"获取槽数据失败: {e}")
            return []

        return [
            {
                "user_id": int(r.get("user_id") or 0),
                "username": r.get("username") or "",
                "request_count": int(r.get("total_requests") or 0),
                "failure_requests": int(r.get("failure_requests") or 0),
                "failure_rate": float(r.get("failure_rate") or 0),
                "quota_used": int(r.get("quota_used") or 0),
                "prompt_tokens": int(r.get("prompt_tokens") or 0),
                "completion_tokens": int(r.get("completion_tokens") or 0),
                "unique_ips": int(r.get("unique_ips") or 0),
            }
            for r in rows
        ]

    def _get_leaderboard_raw(
        self,
        window_seconds: int,
        limit: int,
        now: int,
        sort_by: str,
    ) -> List[Dict[str, Any]]:
        """
        Get raw leaderboard data without user info JOIN.
        Optimized: single table scan with covering index.
        """
        start_time = now - window_seconds

        order_by_map = {
            "requests": "total_requests DESC",
            "quota": "quota_used DESC",
            "failure_rate": "failure_rate DESC, total_requests DESC",
        }
        order_by = order_by_map.get(sort_by, order_by_map["requests"])

        sql = """
            SELECT
                user_id,
                MAX(username) as username,
                COUNT(*) as total_requests,
                SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_requests,
                (SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) * 1.0) / NULLIF(COUNT(*), 0) as failure_rate,
                COALESCE(SUM(quota), 0) as quota_used,
                COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) as completion_tokens,
                COUNT(DISTINCT NULLIF(ip, '')) as unique_ips
            FROM logs
            WHERE created_at >= :start_time AND created_at <= :end_time
                AND type IN (2, 5)
                AND user_id IS NOT NULL
            GROUP BY user_id
            ORDER BY """ + order_by + """
            LIMIT :limit
        """

        try:
            self.db.connect()
            rows = self.db.execute(sql, {"start_time": start_time, "end_time": now, "limit": limit})
        except Exception as e:
            logger.db_error(f"获取实时排行失败: {e}")
            return []

        return [
            {
                "user_id": int(r.get("user_id") or 0),
                "username": r.get("username") or "",
                "request_count": int(r.get("total_requests") or 0),
                "failure_requests": int(r.get("failure_requests") or 0),
                "failure_rate": float(r.get("failure_rate") or 0),
                "quota_used": int(r.get("quota_used") or 0),
                "prompt_tokens": int(r.get("prompt_tokens") or 0),
                "completion_tokens": int(r.get("completion_tokens") or 0),
                "unique_ips": int(r.get("unique_ips") or 0),
            }
            for r in rows
        ]

    def _get_users_info_batch(self, user_ids: List[int]) -> Dict[int, Dict[str, Any]]:
        """
        Batch fetch user info for multiple users.
        """
        if not user_ids:
            return {}
        
        # Limit to prevent huge IN clauses
        user_ids = user_ids[:200]
        
        placeholders = ", ".join([f":id{i}" for i in range(len(user_ids))])
        params = {f"id{i}": uid for i, uid in enumerate(user_ids)}
        
        sql = f"""
            SELECT id, username, display_name, status
            FROM users
            WHERE id IN ({placeholders}) AND deleted_at IS NULL
        """
        
        try:
            rows = self.db.execute(sql, params)
        except Exception as e:
            logger.db_error(f"批量获取用户信息失败: {e}")
            return {}
        
        return {
            int(r.get("id")): {
                "username": r.get("username") or "",
                "display_name": r.get("display_name") or "",
                "status": int(r.get("status") or 0),
            }
            for r in rows
        }

    def get_leaderboard(
        self,
        window_seconds: int,
        limit: int = 10,
        now: Optional[int] = None,
        sort_by: str = "requests",
    ) -> List[Dict[str, Any]]:
        """Get leaderboard for a single time window (no cache, for direct calls)."""
        return self._get_leaderboard_internal(window_seconds, limit, now, sort_by)

    def _get_leaderboard_internal(
        self,
        window_seconds: int,
        limit: int = 10,
        now: Optional[int] = None,
        sort_by: str = "requests",
    ) -> List[Dict[str, Any]]:
        """Internal method to fetch leaderboard from database."""
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        order_by_map = {
            "requests": "total_requests DESC",
            "quota": "quota_used DESC",
            "failure_rate": "failure_rate DESC, total_requests DESC",
        }
        order_by = order_by_map.get(sort_by, order_by_map["requests"])

        sql = """
            SELECT
                l.user_id as user_id,
                COALESCE(
                    NULLIF(MAX(u.display_name), ''),
                    NULLIF(MAX(u.username), ''),
                    NULLIF(MAX(l.username), '')
                ) as username,
                COALESCE(MAX(u.status), 0) as user_status,
                COUNT(*) as total_requests,
                SUM(CASE WHEN l.type = 5 THEN 1 ELSE 0 END) as failure_requests,
                (SUM(CASE WHEN l.type = 5 THEN 1 ELSE 0 END) * 1.0) / NULLIF(COUNT(*), 0) as failure_rate,
                COALESCE(SUM(l.quota), 0) as quota_used,
                COALESCE(SUM(l.prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(l.completion_tokens), 0) as completion_tokens,
                COALESCE(COUNT(DISTINCT NULLIF(l.ip, '')), 0) as unique_ips
            FROM logs l
            LEFT JOIN users u ON u.id = l.user_id AND u.deleted_at IS NULL
            WHERE l.created_at >= :start_time AND l.created_at <= :end_time
                AND l.type IN (2, 5)
                AND l.user_id IS NOT NULL
            GROUP BY l.user_id
            ORDER BY """ + order_by + """
            LIMIT :limit
        """

        try:
            self.db.connect()
            rows = self.db.execute(sql, {"start_time": start_time, "end_time": now, "limit": limit})
        except Exception as e:
            logger.db_error(f"获取实时排行失败: {e}")
            return []

        return [
            {
                "user_id": int(r.get("user_id") or 0),
                "username": r.get("username") or "",
                "user_status": int(r.get("user_status") or 0),
                "request_count": int(r.get("total_requests") or 0),
                "failure_requests": int(r.get("failure_requests") or 0),
                "failure_rate": float(r.get("failure_rate") or 0),
                "quota_used": int(r.get("quota_used") or 0),
                "prompt_tokens": int(r.get("prompt_tokens") or 0),
                "completion_tokens": int(r.get("completion_tokens") or 0),
                "unique_ips": int(r.get("unique_ips") or 0),
            }
            for r in rows
        ]

    def get_user_analysis(self, user_id: int, window_seconds: int, now: Optional[int] = None) -> Dict[str, Any]:
        """
        Get detailed analysis for a specific user.
        Optimized: merged summary + top_models + top_channels + top_ips into fewer queries.
        """
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        self.db.connect()

        # 根据数据库类型选择正确的引号（group 是保留字）
        is_pg = self.db.config.engine == DatabaseEngine.POSTGRESQL
        group_col = '"group"' if is_pg else '`group`'

        # Query 1: User info
        user_sql = f"""
            SELECT id, username, display_name, email, status, {group_col}, remark, linux_do_id
            FROM users
            WHERE id = :user_id AND deleted_at IS NULL
            LIMIT 1
        """
        user_rows = self.db.execute(user_sql, {"user_id": user_id})
        user = user_rows[0] if user_rows else None

        # Query 2: Combined summary + aggregations (merged from 4 separate queries)
        # This single query gets summary stats and we'll do separate small queries for top lists
        summary_sql = """
            SELECT
                COUNT(*) as total_requests,
                SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as success_requests,
                SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_requests,
                COALESCE(SUM(quota), 0) as quota_used,
                COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) as completion_tokens,
                COALESCE(AVG(use_time), 0) as avg_use_time,
                COUNT(DISTINCT NULLIF(ip, '')) as unique_ips,
                COUNT(DISTINCT token_id) as unique_tokens,
                COUNT(DISTINCT model_name) as unique_models,
                COUNT(DISTINCT channel_id) as unique_channels,
                SUM(CASE WHEN type = 2 AND completion_tokens = 0 THEN 1 ELSE 0 END) as empty_count
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time
                AND type IN (2, 5)
        """
        params = {"user_id": user_id, "start_time": start_time, "end_time": now}
        summary = (self.db.execute(summary_sql, params) or [{}])[0]

        # Query 3: Top models, channels, IPs combined using UNION ALL
        # This reduces 3 queries to 1 by using tagged results
        # 根据数据库类型选择 group 列名
        group_col_logs = '"group"' if is_pg else '`group`'

        combined_tops_sql = f"""
            SELECT 'model' as category, COALESCE(model_name, 'unknown') as name,
                   COUNT(*) as requests, COALESCE(SUM(quota), 0) as quota_used,
                   SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as success_requests,
                   SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_requests,
                   SUM(CASE WHEN type = 2 AND completion_tokens = 0 THEN 1 ELSE 0 END) as empty_count,
                   0 as channel_id, '' as channel_name
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time AND type IN (2, 5)
            GROUP BY COALESCE(model_name, 'unknown')

            UNION ALL

            SELECT 'channel' as category, '' as name,
                   COUNT(*) as requests, COALESCE(SUM(quota), 0) as quota_used,
                   0 as success_requests, 0 as failure_requests, 0 as empty_count,
                   channel_id, COALESCE(MAX(channel_name), '') as channel_name
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time AND type IN (2, 5)
            GROUP BY channel_id

            UNION ALL

            SELECT 'ip' as category, ip as name,
                   COUNT(*) as requests, 0 as quota_used,
                   0 as success_requests, 0 as failure_requests, 0 as empty_count,
                   0 as channel_id, '' as channel_name
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time
                AND type IN (2, 5) AND ip IS NOT NULL AND ip <> ''
            GROUP BY ip

            UNION ALL

            SELECT 'group' as category, COALESCE({group_col_logs}, 'default') as name,
                   COUNT(*) as requests, COALESCE(SUM(quota), 0) as quota_used,
                   0 as success_requests, 0 as failure_requests, 0 as empty_count,
                   0 as channel_id, '' as channel_name
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time AND type IN (2, 5)
            GROUP BY COALESCE({group_col_logs}, 'default')
        """
        combined_rows = self.db.execute(combined_tops_sql, params) or []
        
        # Parse combined results
        top_models_raw = []
        top_channels_raw = []
        top_ips_raw = []
        top_groups_raw = []

        for r in combined_rows:
            category = r.get("category")
            if category == "model":
                top_models_raw.append(r)
            elif category == "channel":
                top_channels_raw.append(r)
            elif category == "ip":
                top_ips_raw.append(r)
            elif category == "group":
                top_groups_raw.append(r)

        # Sort and limit
        top_models_raw.sort(key=lambda x: x.get("requests", 0), reverse=True)
        top_channels_raw.sort(key=lambda x: x.get("requests", 0), reverse=True)
        top_ips_raw.sort(key=lambda x: x.get("requests", 0), reverse=True)
        top_groups_raw.sort(key=lambda x: x.get("requests", 0), reverse=True)

        top_models = top_models_raw[:10]
        top_channels = top_channels_raw[:10]
        top_ips = top_ips_raw[:10]
        top_groups = top_groups_raw[:10]

        # Query 4: Recent logs (kept separate as it needs different columns)
        recent_sql = """
            SELECT
                id, created_at, type, model_name, quota, prompt_tokens, completion_tokens,
                use_time, ip, channel_id, channel_name, token_id, token_name
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time
                AND type IN (2, 5)
            ORDER BY id DESC
            LIMIT 50
        """
        recent_logs = self.db.execute(recent_sql, params)

        # Query 5: IP切换频率分析 - 获取按时间排序的IP序列
        ip_sequence_sql = """
            SELECT created_at, ip
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time
                AND type IN (2, 5) AND ip IS NOT NULL AND ip <> ''
            ORDER BY created_at ASC
        """
        ip_sequence = self.db.execute(ip_sequence_sql, params) or []
        
        # 收集所有唯一 IP 用于地理位置查询
        unique_ips = list(set(row.get("ip") for row in ip_sequence if row.get("ip")))
        
        # 尝试获取 IP 地理信息（用于双栈检测）
        ip_geo_map = None
        if unique_ips:
            try:
                from .ip_geo_service import get_ip_geo_service
                import asyncio
                
                geo_service = get_ip_geo_service()
                
                # 检查 GeoIP 服务是否可用
                if not geo_service.is_available():
                    logger.warning("[双栈检测] GeoIP 数据库未加载，双栈检测功能不可用")
                else:
                    logger.debug(f"[双栈检测] 查询 {len(unique_ips)} 个唯一 IP 的地理信息")
                    
                    # 同步调用异步方法
                    try:
                        loop = asyncio.get_event_loop()
                        if loop.is_running():
                            # 如果已在异步上下文中，创建任务
                            import concurrent.futures
                            with concurrent.futures.ThreadPoolExecutor() as executor:
                                future = executor.submit(
                                    asyncio.run,
                                    geo_service.query_batch(unique_ips)
                                )
                                ip_geo_map = future.result(timeout=10)
                        else:
                            ip_geo_map = loop.run_until_complete(geo_service.query_batch(unique_ips))
                    except RuntimeError:
                        # 没有事件循环，创建新的
                        ip_geo_map = asyncio.run(geo_service.query_batch(unique_ips))
                    
                    if ip_geo_map:
                        logger.debug(f"[双栈检测] 成功获取 {len(ip_geo_map)} 个 IP 的地理信息")
            except Exception as e:
                logger.warning(f"[双栈检测] 获取 IP 地理信息失败: {e}")
                ip_geo_map = None
        
        # 分析IP切换模式（传入地理信息用于双栈检测）
        ip_switch_analysis = self._analyze_ip_switches(ip_sequence, ip_geo_map)

        # Calculate derived metrics
        total_requests = int(summary.get("total_requests") or 0)
        success_requests = int(summary.get("success_requests") or 0)
        failure_requests = int(summary.get("failure_requests") or 0)
        empty_count = int(summary.get("empty_count") or 0)

        failure_rate = (failure_requests / total_requests) if total_requests else 0.0
        empty_rate = (empty_count / success_requests) if success_requests else 0.0
        requests_per_minute = (total_requests / window_seconds) * 60 if window_seconds else 0.0
        quota_used = int(summary.get("quota_used") or 0)
        avg_quota_per_request = (quota_used / total_requests) if total_requests else 0.0

        # Risk flags - 只关注 IP 相关风险
        # 注意：空回复率和失败率不作为风险标签，因为嵌入模型本身不返回文本内容
        # 双栈优化：使用 real_switch_count（排除双栈切换）进行判断
        risk_flags: List[str] = []
        if int(summary.get("unique_ips") or 0) >= 10:
            risk_flags.append("MANY_IPS")

        # IP切换频率风险检测（使用排除双栈后的真实切换次数）
        # 快速切换风险：快速切换次数 >= 3 且平均停留时间 < 300秒（5分钟）
        # 如果平均停留时间较长，说明用户大部分时间是稳定的，偶尔的快速切换可能是网络波动
        avg_ip_duration = ip_switch_analysis.get("avg_ip_duration", float('inf'))
        if ip_switch_analysis.get("rapid_switch_count", 0) >= 3 and avg_ip_duration < 300:
            risk_flags.append("IP_RAPID_SWITCH")

        real_switch_count = ip_switch_analysis.get("real_switch_count", ip_switch_analysis.get("switch_count", 0))
        if avg_ip_duration < 30 and real_switch_count >= 3:
            risk_flags.append("IP_HOPPING")

        # 检查用户是否在白名单中（延迟导入避免循环依赖）
        try:
            from .ai_auto_ban_service import get_ai_auto_ban_service
            ai_ban_service = get_ai_auto_ban_service()
            in_whitelist = user_id in ai_ban_service._whitelist_ids
        except Exception:
            in_whitelist = False

        return {
            "range": {"start_time": start_time, "end_time": now, "window_seconds": window_seconds},
            "user": {
                "id": int(user.get("id")) if user else user_id,
                "username": (user.get("username") if user else "") or "",
                "display_name": (user.get("display_name") if user else None),
                "email": (user.get("email") if user else None),
                "status": int(user.get("status")) if user and user.get("status") is not None else 0,
                "group": (user.get("group") if user else None),
                "remark": (user.get("remark") if user else None),
                "linux_do_id": (user.get("linux_do_id") if user else None),
                "in_whitelist": in_whitelist,
            },
            "summary": {
                "total_requests": total_requests,
                "success_requests": success_requests,
                "failure_requests": failure_requests,
                "quota_used": quota_used,
                "prompt_tokens": int(summary.get("prompt_tokens") or 0),
                "completion_tokens": int(summary.get("completion_tokens") or 0),
                "avg_use_time": float(summary.get("avg_use_time") or 0),
                "unique_ips": int(summary.get("unique_ips") or 0),
                "unique_tokens": int(summary.get("unique_tokens") or 0),
                "unique_models": int(summary.get("unique_models") or 0),
                "unique_channels": int(summary.get("unique_channels") or 0),
                "empty_count": empty_count,
                "failure_rate": failure_rate,
                "empty_rate": empty_rate,
            },
            "risk": {
                "requests_per_minute": requests_per_minute,
                "avg_quota_per_request": avg_quota_per_request,
                "risk_flags": risk_flags,
                "ip_switch_analysis": ip_switch_analysis,
            },
            "top_models": [
                {
                    "model_name": r.get("name") or "unknown",
                    "requests": int(r.get("requests") or 0),
                    "quota_used": int(r.get("quota_used") or 0),
                    "success_requests": int(r.get("success_requests") or 0),
                    "failure_requests": int(r.get("failure_requests") or 0),
                    "empty_count": int(r.get("empty_count") or 0),
                }
                for r in top_models
            ],
            "top_channels": [
                {
                    "channel_id": int(r.get("channel_id") or 0),
                    "channel_name": r.get("channel_name") or "",
                    "requests": int(r.get("requests") or 0),
                    "quota_used": int(r.get("quota_used") or 0),
                }
                for r in top_channels
            ],
            "top_ips": [
                {"ip": r.get("name") or "", "requests": int(r.get("requests") or 0)}
                for r in top_ips
            ],
            "top_groups": [
                {"group_name": r.get("name") or "default", "requests": int(r.get("requests") or 0)}
                for r in top_groups
            ],
            "recent_logs": [
                {
                    "id": int(r.get("id") or 0),
                    "created_at": int(r.get("created_at") or 0),
                    "type": int(r.get("type") or 0),
                    "model_name": r.get("model_name") or "",
                    "quota": int(r.get("quota") or 0),
                    "prompt_tokens": int(r.get("prompt_tokens") or 0),
                    "completion_tokens": int(r.get("completion_tokens") or 0),
                    "use_time": int(r.get("use_time") or 0),
                    "ip": r.get("ip") or "",
                    "channel_id": int(r.get("channel_id") or 0),
                    "channel_name": r.get("channel_name") or "",
                    "token_id": int(r.get("token_id") or 0),
                    "token_name": r.get("token_name") or "",
                }
                for r in (recent_logs or [])
            ],
        }

    def _analyze_ip_switches(self, ip_sequence: List[Dict[str, Any]], ip_geo_map: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        分析IP切换模式，检测异常的IP跳动行为。
        
        正常行为：几分钟或十几分钟换一次IP（机场自动选择）
        异常行为：十几秒甚至几秒内频繁切换IP
        
        双栈优化：
        - 检测 IPv4/IPv6 双栈切换
        - 同一位置（ASN+城市）的 v4/v6 切换不计入异常
        
        Args:
            ip_sequence: IP 序列列表，每项包含 created_at 和 ip
            ip_geo_map: IP 地理信息映射（可选，用于双栈检测）
        
        返回:
        - switch_count: 总切换次数
        - real_switch_count: 真实切换次数（排除双栈切换）
        - rapid_switch_count: 快速切换次数（60秒内切换）
        - dual_stack_switches: 双栈切换次数（同位置 v4/v6 切换）
        - avg_ip_duration: 平均每个IP的使用时长（秒）
        - min_switch_interval: 最短切换间隔（秒）
        - switch_details: 切换详情列表
        """
        from .ip_geo_service import get_ip_version, IPVersion
        
        if len(ip_sequence) < 2:
            return {
                "switch_count": 0,
                "real_switch_count": 0,
                "rapid_switch_count": 0,
                "dual_stack_switches": 0,
                "avg_ip_duration": 0,
                "min_switch_interval": 0,
                "switch_details": [],
            }
        
        switches = []  # 记录每次切换的时间间隔
        ip_durations = {}  # 记录每个IP的使用时长
        rapid_switches = 0  # 60秒内的快速切换次数
        dual_stack_switches = 0  # 双栈切换次数
        
        prev_ip = None
        prev_time = None
        ip_start_time = None
        
        for row in ip_sequence:
            current_ip = row.get("ip")
            current_time = int(row.get("created_at") or 0)
            
            if not current_ip or not current_time:
                continue
            
            if prev_ip is None:
                # 第一条记录
                prev_ip = current_ip
                prev_time = current_time
                ip_start_time = current_time
                continue
            
            if current_ip != prev_ip:
                # IP发生切换
                switch_interval = current_time - prev_time
                
                # 检测是否为双栈切换
                is_dual_stack = False
                prev_version = get_ip_version(prev_ip)
                curr_version = get_ip_version(current_ip)
                
                # 判断是否为 v4/v6 切换
                is_v4_v6_switch = (
                    (prev_version == IPVersion.V4 and curr_version == IPVersion.V6) or
                    (prev_version == IPVersion.V6 and curr_version == IPVersion.V4)
                )
                
                # 日志：记录 IP 切换检测
                logger.debug(
                    f"[双栈检测] IP切换: {prev_ip}({prev_version.value}) -> {current_ip}({curr_version.value}), "
                    f"间隔: {switch_interval}s, v4/v6切换: {is_v4_v6_switch}, 有地理信息: {ip_geo_map is not None}"
                )
                
                if is_v4_v6_switch and ip_geo_map:
                    # 有地理信息时，检查是否同一位置
                    prev_geo = ip_geo_map.get(prev_ip)
                    curr_geo = ip_geo_map.get(current_ip)
                    
                    if prev_geo and curr_geo:
                        # 比较位置标识（ASN + 城市）
                        if hasattr(prev_geo, 'get_location_key'):
                            prev_key = prev_geo.get_location_key()
                            curr_key = curr_geo.get_location_key()
                            is_dual_stack = prev_key == curr_key
                        elif isinstance(prev_geo, dict) and isinstance(curr_geo, dict):
                            prev_key = f"{prev_geo.get('asn', '')}:{prev_geo.get('city', '')}:{prev_geo.get('country_code', '')}"
                            curr_key = f"{curr_geo.get('asn', '')}:{curr_geo.get('city', '')}:{curr_geo.get('country_code', '')}"
                            is_dual_stack = prev_key == curr_key and prev_key != "::"
                        
                        # 日志：记录双栈判断详情
                        logger.info(
                            f"[双栈检测] v4/v6切换判断: {prev_ip} -> {current_ip}, "
                            f"位置: [{prev_key}] vs [{curr_key}], 是双栈: {is_dual_stack}"
                        )
                    else:
                        logger.debug(
                            f"[双栈检测] 缺少地理信息: prev_geo={prev_geo is not None}, curr_geo={curr_geo is not None}"
                        )
                
                switches.append({
                    "from_ip": prev_ip,
                    "to_ip": current_ip,
                    "interval": switch_interval,
                    "time": current_time,
                    "is_dual_stack": is_dual_stack,
                    "from_version": prev_version.value,
                    "to_version": curr_version.value,
                })
                
                if is_dual_stack:
                    dual_stack_switches += 1
                    logger.info(f"[双栈检测] 识别为双栈切换: {prev_ip} <-> {current_ip}")
                elif switch_interval <= 60:
                    # 只有非双栈切换才计入快速切换
                    rapid_switches += 1
                
                # 记录上一个IP的使用时长
                ip_duration = current_time - ip_start_time
                if prev_ip not in ip_durations:
                    ip_durations[prev_ip] = []
                ip_durations[prev_ip].append(ip_duration)
                
                # 重置为新IP
                prev_ip = current_ip
                ip_start_time = current_time
            
            prev_time = current_time
        
        # 计算统计数据
        switch_count = len(switches)
        real_switch_count = switch_count - dual_stack_switches  # 真实切换次数
        min_switch_interval = min((s["interval"] for s in switches if not s.get("is_dual_stack")), default=0)
        
        # 计算平均IP使用时长
        all_durations = []
        for durations in ip_durations.values():
            all_durations.extend(durations)
        avg_ip_duration = sum(all_durations) / len(all_durations) if all_durations else 0
        
        # 只返回最近的10次切换详情
        recent_switches = switches[-10:] if switches else []
        
        return {
            "switch_count": switch_count,
            "real_switch_count": real_switch_count,
            "rapid_switch_count": rapid_switches,
            "dual_stack_switches": dual_stack_switches,
            "avg_ip_duration": round(avg_ip_duration, 1),
            "min_switch_interval": min_switch_interval,
            "switch_details": recent_switches,
        }

    def get_token_rotation_users(
        self,
        window_seconds: int,
        min_tokens: int = 5,
        max_requests_per_token: int = 10,
        limit: int = 50,
        now: Optional[int] = None,
        use_cache: bool = True,
    ) -> Dict[str, Any]:
        """
        检测 Token 轮换行为 - 同一用户短时间内使用多个 Token，每个 Token 请求很少。
        
        这种行为可能表示：
        - 用户在规避单 Token 限制
        - 多人共享账号，各自使用不同 Token
        - 自动化脚本轮换 Token
        
        Args:
            window_seconds: 时间窗口（秒）
            min_tokens: 最小 Token 数量阈值
            max_requests_per_token: 每个 Token 最大平均请求数（低于此值视为轮换）
            limit: 返回数量限制
            now: 当前时间戳（用于测试）
            use_cache: 是否使用缓存
            
        Returns:
            包含可疑用户列表的字典
        """
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        # 检查缓存
        cache_key = f"token_rotation:{window_seconds}:{min_tokens}:{max_requests_per_token}:{limit}"
        if use_cache:
            cached = _cache.get(cache_key)
            if cached is not None:
                return cached

        self.db.connect()

        # 查询使用多个 Token 且每个 Token 请求较少的用户
        sql = """
            SELECT 
                user_id,
                MAX(username) as username,
                COUNT(DISTINCT token_id) as token_count,
                COUNT(*) as total_requests,
                ROUND(COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT token_id), 0), 2) as avg_requests_per_token
            FROM logs
            WHERE created_at >= :start_time AND created_at <= :end_time
                AND type IN (2, 5)
                AND user_id IS NOT NULL
                AND token_id IS NOT NULL AND token_id > 0
            GROUP BY user_id
            HAVING COUNT(DISTINCT token_id) >= :min_tokens
                AND COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT token_id), 0) <= :max_requests_per_token
            ORDER BY token_count DESC, total_requests DESC
            LIMIT :limit
        """

        try:
            rows = self.db.execute(sql, {
                "start_time": start_time,
                "end_time": now,
                "min_tokens": min_tokens,
                "max_requests_per_token": max_requests_per_token,
                "limit": limit,
            })

            items = []
            for row in rows:
                user_id = int(row.get("user_id") or 0)
                
                # 获取该用户使用的 Token 详情
                token_detail_sql = """
                    SELECT 
                        token_id,
                        MAX(token_name) as token_name,
                        COUNT(*) as requests,
                        MIN(created_at) as first_used,
                        MAX(created_at) as last_used
                    FROM logs
                    WHERE created_at >= :start_time AND created_at <= :end_time
                        AND user_id = :user_id
                        AND token_id IS NOT NULL AND token_id > 0
                        AND type IN (2, 5)
                    GROUP BY token_id
                    ORDER BY requests DESC
                    LIMIT 10
                """
                token_rows = self.db.execute(token_detail_sql, {
                    "start_time": start_time,
                    "end_time": now,
                    "user_id": user_id,
                })

                tokens = [
                    {
                        "token_id": int(t.get("token_id") or 0),
                        "token_name": t.get("token_name") or "",
                        "requests": int(t.get("requests") or 0),
                        "first_used": int(t.get("first_used") or 0),
                        "last_used": int(t.get("last_used") or 0),
                    }
                    for t in (token_rows or [])
                ]

                items.append({
                    "user_id": user_id,
                    "username": row.get("username") or "",
                    "token_count": int(row.get("token_count") or 0),
                    "total_requests": int(row.get("total_requests") or 0),
                    "avg_requests_per_token": float(row.get("avg_requests_per_token") or 0),
                    "tokens": tokens,
                    "risk_level": "high" if int(row.get("token_count") or 0) >= 10 else "medium",
                })

            result = {
                "items": items,
                "total": len(items),
                "window_seconds": window_seconds,
                "thresholds": {
                    "min_tokens": min_tokens,
                    "max_requests_per_token": max_requests_per_token,
                },
            }
            ttl = _get_cache_ttl()
            _cache.set(cache_key, result, ttl)
            logger.success(
                f"风控 缓存更新: token_rotation",
                users=len(items),
                min_tokens=min_tokens,
                TTL=f"{ttl}s"
            )
            return result

        except Exception as e:
            logger.db_error(f"获取 Token 轮换用户失败: {e}")
            return {"items": [], "total": 0}

    def get_affiliated_accounts(
        self,
        min_invited: int = 3,
        include_activity: bool = True,
        limit: int = 50,
        use_cache: bool = True,
    ) -> Dict[str, Any]:
        """
        检测关联账号 - 同一邀请人下的多个账号。
        
        这种情况可能表示：
        - 同一人注册多个账号薅羊毛
        - 有组织的账号批量注册
        - 正常的推广行为（需要结合活跃度判断）
        
        Args:
            min_invited: 最小被邀请账号数量
            include_activity: 是否包含账号活跃度信息
            limit: 返回数量限制
            use_cache: 是否使用缓存
            
        Returns:
            包含关联账号组的字典
        """
        # 检查缓存
        cache_key = f"affiliated_accounts:{min_invited}:{include_activity}:{limit}"
        if use_cache:
            cached = _cache.get(cache_key)
            if cached is not None:
                return cached

        self.db.connect()
        is_pg = self.db.config.engine == DatabaseEngine.POSTGRESQL

        # 查询有多个被邀请账号的邀请人
        if is_pg:
            sql = """
                SELECT 
                    inviter_id,
                    COUNT(*) as invited_count,
                    ARRAY_AGG(id ORDER BY id) as user_ids
                FROM users
                WHERE inviter_id IS NOT NULL 
                    AND deleted_at IS NULL
                    AND status != 2
                GROUP BY inviter_id
                HAVING COUNT(*) >= :min_invited
                ORDER BY COUNT(*) DESC
                LIMIT :limit
            """
        else:
            sql = """
                SELECT 
                    inviter_id,
                    COUNT(*) as invited_count,
                    GROUP_CONCAT(id ORDER BY id) as user_ids
                FROM users
                WHERE inviter_id IS NOT NULL 
                    AND deleted_at IS NULL
                    AND status != 2
                GROUP BY inviter_id
                HAVING COUNT(*) >= :min_invited
                ORDER BY COUNT(*) DESC
                LIMIT :limit
            """

        try:
            rows = self.db.execute(sql, {
                "min_invited": min_invited,
                "limit": limit,
            })

            items = []
            for row in rows:
                inviter_id = int(row.get("inviter_id") or 0)
                invited_count = int(row.get("invited_count") or 0)
                
                # 解析 user_ids
                user_ids_raw = row.get("user_ids")
                if isinstance(user_ids_raw, str):
                    user_ids = [int(x) for x in user_ids_raw.split(",") if x.strip().isdigit()]
                elif isinstance(user_ids_raw, list):
                    user_ids = [int(x) for x in user_ids_raw]
                else:
                    user_ids = []

                # 获取邀请人信息
                inviter_sql = """
                    SELECT id, username, display_name, email, status, used_quota, request_count
                    FROM users WHERE id = :user_id AND deleted_at IS NULL
                """
                inviter_rows = self.db.execute(inviter_sql, {"user_id": inviter_id})
                inviter_info = inviter_rows[0] if inviter_rows else {}

                # 获取被邀请账号的详细信息
                invited_users = []
                if user_ids:
                    placeholders = ",".join([":uid" + str(i) for i in range(len(user_ids))])
                    invited_sql = f"""
                        SELECT id, username, display_name, email, status, used_quota, request_count,
                               quota, `group`
                        FROM users 
                        WHERE id IN ({placeholders}) AND deleted_at IS NULL
                        ORDER BY id
                    """
                    params = {f"uid{i}": uid for i, uid in enumerate(user_ids)}
                    invited_rows = self.db.execute(invited_sql, params)

                    for u in (invited_rows or []):
                        user_data = {
                            "user_id": int(u.get("id") or 0),
                            "username": u.get("username") or "",
                            "display_name": u.get("display_name") or "",
                            "status": int(u.get("status") or 0),
                            "used_quota": int(u.get("used_quota") or 0),
                            "request_count": int(u.get("request_count") or 0),
                            "group": u.get("group") or "default",
                        }
                        invited_users.append(user_data)

                # 计算风险指标
                total_used_quota = sum(u.get("used_quota", 0) for u in invited_users)
                total_requests = sum(u.get("request_count", 0) for u in invited_users)
                active_count = sum(1 for u in invited_users if u.get("request_count", 0) > 0)
                banned_count = sum(1 for u in invited_users if u.get("status") == 2)

                # 风险等级判断
                risk_level = "low"
                risk_reasons = []
                
                if invited_count >= 10:
                    risk_level = "high"
                    risk_reasons.append(f"邀请账号数量过多({invited_count})")
                elif invited_count >= 5:
                    risk_level = "medium"
                    risk_reasons.append(f"邀请账号数量较多({invited_count})")
                
                if active_count > 0 and total_requests / active_count < 10:
                    risk_level = "high" if risk_level != "low" else "medium"
                    risk_reasons.append("被邀请账号活跃度低")
                
                if banned_count > 0:
                    risk_level = "high"
                    risk_reasons.append(f"有{banned_count}个账号已被封禁")

                items.append({
                    "inviter_id": inviter_id,
                    "inviter_username": inviter_info.get("username") or "",
                    "inviter_status": int(inviter_info.get("status") or 0),
                    "invited_count": invited_count,
                    "invited_users": invited_users,
                    "stats": {
                        "total_used_quota": total_used_quota,
                        "total_requests": total_requests,
                        "active_count": active_count,
                        "banned_count": banned_count,
                    },
                    "risk_level": risk_level,
                    "risk_reasons": risk_reasons,
                })

            result = {
                "items": items,
                "total": len(items),
                "thresholds": {
                    "min_invited": min_invited,
                },
            }
            ttl = _get_cache_ttl()
            _cache.set(cache_key, result, ttl)
            logger.success(
                f"风控 缓存更新: affiliated_accounts",
                groups=len(items),
                min_invited=min_invited,
                TTL=f"{ttl}s"
            )
            return result

        except Exception as e:
            logger.db_error(f"获取关联账号失败: {e}")
            return {"items": [], "total": 0}

    def get_same_ip_registrations(
        self,
        window_seconds: int = 7 * 24 * 3600,
        min_users: int = 3,
        limit: int = 50,
        now: Optional[int] = None,
        use_cache: bool = True,
    ) -> Dict[str, Any]:
        """
        检测同 IP 注册的多个账号（通过首次请求 IP 判断）。
        
        Args:
            window_seconds: 时间窗口（秒）
            min_users: 最小用户数量
            limit: 返回数量限制
            now: 当前时间戳
            use_cache: 是否使用缓存
            
        Returns:
            包含同 IP 用户组的字典
        """
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        # 检查缓存
        cache_key = f"same_ip_reg:{window_seconds}:{min_users}:{limit}"
        if use_cache:
            cached = _cache.get(cache_key)
            if cached is not None:
                return cached

        self.db.connect()
        is_pg = self.db.config.engine == DatabaseEngine.POSTGRESQL

        # 查询每个用户的首次请求 IP，然后找出共享 IP 的用户
        if is_pg:
            sql = """
                WITH first_ips AS (
                    SELECT DISTINCT ON (user_id)
                        user_id,
                        ip as first_ip,
                        created_at as first_request_time
                    FROM logs
                    WHERE created_at >= :start_time AND created_at <= :end_time
                        AND user_id IS NOT NULL
                        AND ip IS NOT NULL AND ip <> ''
                    ORDER BY user_id, created_at ASC
                )
                SELECT 
                    first_ip,
                    COUNT(*) as user_count,
                    ARRAY_AGG(user_id ORDER BY first_request_time) as user_ids
                FROM first_ips
                GROUP BY first_ip
                HAVING COUNT(*) >= :min_users
                ORDER BY COUNT(*) DESC
                LIMIT :limit
            """
        else:
            # MySQL: 使用子查询获取每个用户的首次 IP
            sql = """
                WITH first_ips AS (
                    SELECT 
                        user_id,
                        ip as first_ip,
                        created_at as first_request_time
                    FROM logs l1
                    WHERE created_at >= :start_time AND created_at <= :end_time
                        AND user_id IS NOT NULL
                        AND ip IS NOT NULL AND ip <> ''
                        AND created_at = (
                            SELECT MIN(created_at) 
                            FROM logs l2 
                            WHERE l2.user_id = l1.user_id 
                                AND l2.created_at >= :start_time 
                                AND l2.created_at <= :end_time
                                AND l2.ip IS NOT NULL AND l2.ip <> ''
                        )
                )
                SELECT 
                    first_ip,
                    COUNT(*) as user_count,
                    GROUP_CONCAT(user_id ORDER BY first_request_time) as user_ids
                FROM first_ips
                GROUP BY first_ip
                HAVING COUNT(*) >= :min_users
                ORDER BY COUNT(*) DESC
                LIMIT :limit
            """

        try:
            rows = self.db.execute(sql, {
                "start_time": start_time,
                "end_time": now,
                "min_users": min_users,
                "limit": limit,
            })

            items = []
            for row in rows:
                ip = row.get("first_ip") or ""
                user_count = int(row.get("user_count") or 0)
                
                # 解析 user_ids
                user_ids_raw = row.get("user_ids")
                if isinstance(user_ids_raw, str):
                    user_ids = [int(x) for x in user_ids_raw.split(",") if x.strip().isdigit()]
                elif isinstance(user_ids_raw, list):
                    user_ids = [int(x) for x in user_ids_raw]
                else:
                    user_ids = []

                # 获取用户详情
                users = []
                if user_ids:
                    placeholders = ",".join([":uid" + str(i) for i in range(len(user_ids))])
                    user_sql = f"""
                        SELECT id, username, status, used_quota, request_count
                        FROM users 
                        WHERE id IN ({placeholders}) AND deleted_at IS NULL
                    """
                    params = {f"uid{i}": uid for i, uid in enumerate(user_ids)}
                    user_rows = self.db.execute(user_sql, params)

                    for u in (user_rows or []):
                        users.append({
                            "user_id": int(u.get("id") or 0),
                            "username": u.get("username") or "",
                            "status": int(u.get("status") or 0),
                            "used_quota": int(u.get("used_quota") or 0),
                            "request_count": int(u.get("request_count") or 0),
                        })

                # 风险等级
                banned_count = sum(1 for u in users if u.get("status") == 2)
                risk_level = "high" if user_count >= 5 or banned_count > 0 else "medium"

                items.append({
                    "ip": ip,
                    "user_count": user_count,
                    "users": users,
                    "banned_count": banned_count,
                    "risk_level": risk_level,
                })

            result = {
                "items": items,
                "total": len(items),
                "window_seconds": window_seconds,
                "thresholds": {
                    "min_users": min_users,
                },
            }
            ttl = _get_cache_ttl()
            _cache.set(cache_key, result, ttl)
            logger.success(
                f"风控 缓存更新: same_ip_registrations",
                ips=len(items),
                min_users=min_users,
                TTL=f"{ttl}s"
            )
            return result

        except Exception as e:
            logger.db_error(f"获取同 IP 注册账号失败: {e}")
            return {"items": [], "total": 0}


_risk_monitoring_service: Optional[RiskMonitoringService] = None


def get_risk_monitoring_service() -> RiskMonitoringService:
    global _risk_monitoring_service
    if _risk_monitoring_service is None:
        _risk_monitoring_service = RiskMonitoringService()
    return _risk_monitoring_service


def clear_risk_cache():
    """Clear the risk monitoring cache (useful after data changes)."""
    _cache.clear()

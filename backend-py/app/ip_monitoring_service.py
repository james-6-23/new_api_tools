"""
IP Monitoring Service for NewAPI Middleware Tool.
Provides IP usage analysis and management for risk monitoring.

Optimizations:
- Batch queries to avoid N+1 problem
- Unified cache with CacheManager (SQLite + Redis)
"""
import time
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
        from .system_scale_service import get_ip_cache_ttl
        return get_ip_cache_ttl()
    except Exception:
        return 300  # Default fallback: 5 minutes


class IPMonitoringService:
    """Service for IP usage monitoring and analysis."""

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

    def _get_window_name(self, window_seconds: int) -> str:
        """将秒数转换为窗口名称"""
        for name, seconds in WINDOW_SECONDS.items():
            if seconds == window_seconds:
                return name
        return f"{window_seconds}s"

    def _is_incremental_window(self, window_name: str) -> bool:
        """判断是否使用增量缓存的窗口"""
        return self.cache.is_incremental_window(window_name)

    def get_ip_recording_stats(self, use_cache: bool = True) -> Dict[str, Any]:
        """
        Get statistics about IP recording settings across all users.
        Returns count of users with IP recording enabled/disabled.

        Args:
            use_cache: Whether to use cached data (default True)
        """
        cache_key = "ip_stats"

        # 检查缓存
        if use_cache:
            cached = self.cache.get(cache_key)
            if cached is not None:
                logger.debug("[IP Stats] 命中缓存", category="缓存")
                return cached

        self.db.connect()

        # Check database type for JSON syntax
        is_pg = self.db.config.engine == DatabaseEngine.POSTGRESQL

        if is_pg:
            # PostgreSQL: use jsonb operators
            sql = """
                SELECT
                    COUNT(*) as total_users,
                    SUM(CASE
                        WHEN setting IS NOT NULL AND setting <> ''
                             AND setting::jsonb->>'record_ip_log' = 'true' THEN 1
                        ELSE 0
                    END) as enabled_count
                FROM users
                WHERE deleted_at IS NULL
            """
        else:
            # MySQL: use JSON_EXTRACT
            sql = """
                SELECT
                    COUNT(*) as total_users,
                    SUM(CASE
                        WHEN setting IS NOT NULL AND setting <> ''
                             AND JSON_EXTRACT(setting, '$.record_ip_log') = true THEN 1
                        ELSE 0
                    END) as enabled_count
                FROM users
                WHERE deleted_at IS NULL
            """

        try:
            rows = self.db.execute(sql, {})
            row = rows[0] if rows else {}

            total_users = int(row.get("total_users") or 0)
            enabled_count = int(row.get("enabled_count") or 0)
            disabled_count = total_users - enabled_count
            enabled_percentage = (enabled_count / total_users * 100) if total_users > 0 else 0.0

            # Get unique IPs in last 24h
            now = int(time.time())
            start_time = now - 24 * 3600
            ip_sql = """
                SELECT COUNT(DISTINCT ip) as unique_ips
                FROM logs
                WHERE created_at >= :start_time AND created_at <= :end_time
                    AND ip IS NOT NULL AND ip <> ''
            """
            ip_rows = self.db.execute(ip_sql, {"start_time": start_time, "end_time": now})
            unique_ips_24h = int((ip_rows[0] if ip_rows else {}).get("unique_ips") or 0)

            result = {
                "total_users": total_users,
                "enabled_count": enabled_count,
                "disabled_count": disabled_count,
                "enabled_percentage": round(enabled_percentage, 2),
                "unique_ips_24h": unique_ips_24h,
            }

            # 保存到缓存（TTL 60秒，IP Stats 数据变化不频繁）
            ttl = 60
            self.cache.set(cache_key, result, ttl=ttl)
            logger.success(
                f"IP Stats 缓存更新",
                users=total_users,
                enabled=enabled_count,
                ips_24h=unique_ips_24h,
                TTL=f"{ttl}s"
            )

            return result
        except Exception as e:
            logger.db_error(f"获取 IP 记录统计失败: {e}")
            return {
                "total_users": 0,
                "enabled_count": 0,
                "disabled_count": 0,
                "enabled_percentage": 0.0,
                "unique_ips_24h": 0,
            }


    def get_shared_ips(
        self,
        window_seconds: int,
        min_tokens: int = 2,
        limit: int = 50,
        now: Optional[int] = None,
        use_cache: bool = True,
        log_progress: bool = False,
    ) -> Dict[str, Any]:
        """
        Get IPs that are used by multiple tokens.
        Helps identify potential account sharing.
        Optimized: single query with aggregated token info.

        对于 3d/7d 窗口，使用增量缓存模式。
        """
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        # 检查缓存 - 使用统一的缓存管理器（key不包含limit，支持截断）
        window_name = self._get_window_name(window_seconds)
        if use_cache:
            cached = self.cache.get_ip_monitoring("shared_ips", window_name, limit)
            if cached is not None:
                return {"items": cached, "total": len(cached)}

        # 对 3d/7d 使用增量缓存模式
        if self._is_incremental_window(window_name):
            if log_progress:
                logger.info(f"[IP监控] shared_ips@{window_name} 使用增量缓存模式")

            # 增量获取基础数据
            base_items = self._get_incremental_data(
                "shared_ips", window_name, now, min_tokens, limit, log_progress
            )

            # 对 Top N 结果获取详情（tokens 列表）
            items = self._enrich_shared_ips_details(base_items, start_time, now)

            # 保存到缓存
            ttl = _get_cache_ttl()
            self.cache.set_ip_monitoring("shared_ips", window_name, items, ttl)
            logger.success(
                f"IP监控 缓存更新: shared_ips [增量]",
                window=window_name,
                items=len(items),
                TTL=f"{ttl}s"
            )

            return {"items": items, "total": len(items)}
        
        self.db.connect()
        is_pg = self.db.config.engine == DatabaseEngine.POSTGRESQL

        # 优化：使用单个查询获取所有数据，避免 N+1 问题
        if is_pg:
            sql = """
                WITH ip_stats AS (
                    SELECT 
                        ip,
                        COUNT(DISTINCT token_id) as token_count,
                        COUNT(DISTINCT user_id) as user_count,
                        COUNT(*) as request_count
                    FROM logs
                    WHERE created_at >= :start_time AND created_at <= :end_time
                        AND ip IS NOT NULL AND ip <> ''
                        AND token_id IS NOT NULL AND token_id > 0
                    GROUP BY ip
                    HAVING COUNT(DISTINCT token_id) >= :min_tokens
                    ORDER BY COUNT(DISTINCT token_id) DESC, COUNT(*) DESC
                    LIMIT :limit
                )
                SELECT 
                    s.ip,
                    s.token_count,
                    s.user_count,
                    s.request_count,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'token_id', l.token_id,
                                'token_name', COALESCE(l.token_name, ''),
                                'user_id', l.user_id,
                                'username', COALESCE(l.username, ''),
                                'req_count', l.req_count
                            )
                        ) FILTER (WHERE l.token_id IS NOT NULL),
                        '[]'
                    ) as tokens_json
                FROM ip_stats s
                LEFT JOIN LATERAL (
                    SELECT 
                        token_id,
                        MAX(token_name) as token_name,
                        user_id,
                        MAX(username) as username,
                        COUNT(*) as req_count
                    FROM logs
                    WHERE created_at >= :start_time AND created_at <= :end_time
                        AND ip = s.ip
                        AND token_id IS NOT NULL AND token_id > 0
                    GROUP BY token_id, user_id
                    ORDER BY COUNT(*) DESC
                    LIMIT 10
                ) l ON true
                GROUP BY s.ip, s.token_count, s.user_count, s.request_count
                ORDER BY s.token_count DESC, s.request_count DESC
            """
        else:
            # MySQL: 使用子查询 + GROUP_CONCAT
            sql = """
                SELECT 
                    ip,
                    COUNT(DISTINCT token_id) as token_count,
                    COUNT(DISTINCT user_id) as user_count,
                    COUNT(*) as request_count
                FROM logs
                WHERE created_at >= :start_time AND created_at <= :end_time
                    AND ip IS NOT NULL AND ip <> ''
                    AND token_id IS NOT NULL AND token_id > 0
                GROUP BY ip
                HAVING COUNT(DISTINCT token_id) >= :min_tokens
                ORDER BY token_count DESC, request_count DESC
                LIMIT :limit
            """

        try:
            rows = self.db.execute(sql, {
                "start_time": start_time,
                "end_time": now,
                "min_tokens": min_tokens,
                "limit": limit,
            })

            items = []
            
            if is_pg:
                # PostgreSQL: 直接解析 JSON
                import json as json_module
                for row in rows:
                    tokens_json = row.get("tokens_json") or "[]"
                    if isinstance(tokens_json, str):
                        tokens = json_module.loads(tokens_json)
                    else:
                        tokens = tokens_json
                    
                    items.append({
                        "ip": row.get("ip") or "",
                        "token_count": int(row.get("token_count") or 0),
                        "user_count": int(row.get("user_count") or 0),
                        "request_count": int(row.get("request_count") or 0),
                        "tokens": [
                            {
                                "token_id": int(t.get("token_id") or 0),
                                "token_name": t.get("token_name") or "",
                                "user_id": int(t.get("user_id") or 0),
                                "username": t.get("username") or "",
                                "request_count": int(t.get("req_count") or 0),
                            }
                            for t in tokens
                        ],
                    })
            else:
                # MySQL: 需要额外查询获取 token 详情（但批量查询）
                ips = [row.get("ip") for row in rows if row.get("ip")]
                
                # 批量获取所有 IP 的 token 详情
                token_map = {}
                if ips:
                    placeholders = ",".join([":ip" + str(i) for i in range(len(ips))])
                    token_sql = f"""
                        SELECT 
                            ip,
                            token_id,
                            MAX(token_name) as token_name,
                            user_id,
                            MAX(username) as username,
                            COUNT(*) as request_count
                        FROM logs
                        WHERE created_at >= :start_time AND created_at <= :end_time
                            AND ip IN ({placeholders})
                            AND token_id IS NOT NULL AND token_id > 0
                        GROUP BY ip, token_id, user_id
                        ORDER BY ip, COUNT(*) DESC
                    """
                    params = {"start_time": start_time, "end_time": now}
                    for i, ip in enumerate(ips):
                        params[f"ip{i}"] = ip
                    
                    token_rows = self.db.execute(token_sql, params)
                    for t in (token_rows or []):
                        ip = t.get("ip")
                        if ip not in token_map:
                            token_map[ip] = []
                        if len(token_map[ip]) < 10:  # 限制每个 IP 最多 10 个 token
                            token_map[ip].append({
                                "token_id": int(t.get("token_id") or 0),
                                "token_name": t.get("token_name") or "",
                                "user_id": int(t.get("user_id") or 0),
                                "username": t.get("username") or "",
                                "request_count": int(t.get("request_count") or 0),
                            })
                
                for row in rows:
                    ip = row.get("ip") or ""
                    items.append({
                        "ip": ip,
                        "token_count": int(row.get("token_count") or 0),
                        "user_count": int(row.get("user_count") or 0),
                        "request_count": int(row.get("request_count") or 0),
                        "tokens": token_map.get(ip, []),
                    })

            result = {"items": items, "total": len(items)}

            # 保存到缓存管理器（SQLite + Redis）
            ttl = _get_cache_ttl()
            self.cache.set_ip_monitoring("shared_ips", window_name, items, ttl)
            logger.success(
                f"IP监控 缓存更新: shared_ips",
                window=window_name,
                items=len(items),
                TTL=f"{ttl}s"
            )

            return result
        except Exception as e:
            logger.db_error(f"获取共享 IP 失败: {e}")
            return {"items": [], "total": 0}

    def get_multi_ip_tokens(
        self,
        window_seconds: int,
        min_ips: int = 2,
        limit: int = 50,
        now: Optional[int] = None,
        use_cache: bool = True,
        log_progress: bool = False,
    ) -> Dict[str, Any]:
        """
        Get tokens that are used from multiple IPs.
        Helps identify potential token sharing or leakage.
        Optimized: batch query for IP details to avoid N+1 problem.

        对于 3d/7d 窗口，使用增量缓存模式。
        """
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        # 检查缓存 - 使用统一的缓存管理器（key不包含limit，支持截断）
        window_name = self._get_window_name(window_seconds)
        if use_cache:
            cached = self.cache.get_ip_monitoring("multi_ip_tokens", window_name, limit)
            if cached is not None:
                return {"items": cached, "total": len(cached)}

        # 对 3d/7d 使用增量缓存模式
        if self._is_incremental_window(window_name):
            if log_progress:
                logger.info(f"[IP监控] multi_ip_tokens@{window_name} 使用增量缓存模式")

            # 增量获取基础数据
            base_items = self._get_incremental_data(
                "multi_ip_tokens", window_name, now, min_ips, limit, log_progress
            )

            # 对 Top N 结果获取详情（ips 列表）
            items = self._enrich_multi_ip_tokens_details(base_items, start_time, now)

            # 保存到缓存
            ttl = _get_cache_ttl()
            self.cache.set_ip_monitoring("multi_ip_tokens", window_name, items, ttl)
            logger.success(
                f"IP监控 缓存更新: multi_ip_tokens [增量]",
                window=window_name,
                items=len(items),
                TTL=f"{ttl}s"
            )

            return {"items": items, "total": len(items)}

        self.db.connect()
        is_pg = self.db.config.engine == DatabaseEngine.POSTGRESQL

        # 主查询获取 token 列表
        sql = """
            SELECT 
                token_id,
                COALESCE(MAX(token_name), '') as token_name,
                MAX(user_id) as user_id,
                COALESCE(MAX(username), '') as username,
                COUNT(DISTINCT NULLIF(ip, '')) as ip_count,
                COUNT(*) as request_count
            FROM logs
            WHERE created_at >= :start_time AND created_at <= :end_time
                AND token_id IS NOT NULL AND token_id > 0
            GROUP BY token_id
            HAVING COUNT(DISTINCT NULLIF(ip, '')) >= :min_ips
            ORDER BY ip_count DESC, request_count DESC
            LIMIT :limit
        """

        try:
            rows = self.db.execute(sql, {
                "start_time": start_time,
                "end_time": now,
                "min_ips": min_ips,
                "limit": limit,
            })

            if not rows:
                return {"items": [], "total": 0}

            # 批量获取所有 token 的 IP 详情（避免 N+1）
            token_ids = [int(row.get("token_id") or 0) for row in rows if row.get("token_id")]
            ip_map = {}
            
            if token_ids:
                placeholders = ",".join([":tid" + str(i) for i in range(len(token_ids))])
                ip_sql = f"""
                    SELECT 
                        token_id,
                        ip,
                        COUNT(*) as request_count
                    FROM logs
                    WHERE created_at >= :start_time AND created_at <= :end_time
                        AND token_id IN ({placeholders})
                        AND ip IS NOT NULL AND ip <> ''
                    GROUP BY token_id, ip
                    ORDER BY token_id, COUNT(*) DESC
                """
                params = {"start_time": start_time, "end_time": now}
                for i, tid in enumerate(token_ids):
                    params[f"tid{i}"] = tid
                
                ip_rows = self.db.execute(ip_sql, params)
                for r in (ip_rows or []):
                    tid = int(r.get("token_id") or 0)
                    if tid not in ip_map:
                        ip_map[tid] = []
                    if len(ip_map[tid]) < 10:  # 限制每个 token 最多 10 个 IP
                        ip_map[tid].append({
                            "ip": r.get("ip") or "",
                            "request_count": int(r.get("request_count") or 0),
                        })

            items = []
            for row in rows:
                token_id = int(row.get("token_id") or 0)
                items.append({
                    "token_id": token_id,
                    "token_name": row.get("token_name") or "",
                    "user_id": int(row.get("user_id") or 0),
                    "username": row.get("username") or "",
                    "ip_count": int(row.get("ip_count") or 0),
                    "request_count": int(row.get("request_count") or 0),
                    "ips": ip_map.get(token_id, []),
                })

            result = {"items": items, "total": len(items)}

            # 保存到缓存管理器（SQLite + Redis）
            ttl = _get_cache_ttl()
            self.cache.set_ip_monitoring("multi_ip_tokens", window_name, items, ttl)
            logger.success(
                f"IP监控 缓存更新: multi_ip_tokens",
                window=window_name,
                items=len(items),
                TTL=f"{ttl}s"
            )

            return result
        except Exception as e:
            logger.db_error(f"获取多 IP 令牌失败: {e}")
            return {"items": [], "total": 0}


    def get_multi_ip_users(
        self,
        window_seconds: int,
        min_ips: int = 3,
        limit: int = 50,
        now: Optional[int] = None,
        use_cache: bool = True,
        log_progress: bool = False,
    ) -> Dict[str, Any]:
        """
        Get users that access from multiple IPs.
        Helps identify potential account sharing.
        Optimized: batch query for IP details to avoid N+1 problem.

        对于 3d/7d 窗口，使用增量缓存模式。
        """
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        # 检查缓存 - 使用统一的缓存管理器（key不包含limit，支持截断）
        window_name = self._get_window_name(window_seconds)
        if use_cache:
            cached = self.cache.get_ip_monitoring("multi_ip_users", window_name, limit)
            if cached is not None:
                return {"items": cached, "total": len(cached)}

        # 对 3d/7d 使用增量缓存模式
        if self._is_incremental_window(window_name):
            if log_progress:
                logger.info(f"[IP监控] multi_ip_users@{window_name} 使用增量缓存模式")

            # 增量获取基础数据
            base_items = self._get_incremental_data(
                "multi_ip_users", window_name, now, min_ips, limit, log_progress
            )

            # 对 Top N 结果获取详情（top_ips 列表）
            items = self._enrich_multi_ip_users_details(base_items, start_time, now)

            # 保存到缓存
            ttl = _get_cache_ttl()
            self.cache.set_ip_monitoring("multi_ip_users", window_name, items, ttl)
            logger.success(
                f"IP监控 缓存更新: multi_ip_users [增量]",
                window=window_name,
                items=len(items),
                TTL=f"{ttl}s"
            )

            return {"items": items, "total": len(items)}

        self.db.connect()

        # 主查询获取用户列表
        sql = """
            SELECT 
                user_id,
                COALESCE(MAX(username), '') as username,
                COUNT(DISTINCT NULLIF(ip, '')) as ip_count,
                COUNT(*) as request_count
            FROM logs
            WHERE created_at >= :start_time AND created_at <= :end_time
                AND user_id IS NOT NULL
            GROUP BY user_id
            HAVING COUNT(DISTINCT NULLIF(ip, '')) >= :min_ips
            ORDER BY ip_count DESC, request_count DESC
            LIMIT :limit
        """

        try:
            rows = self.db.execute(sql, {
                "start_time": start_time,
                "end_time": now,
                "min_ips": min_ips,
                "limit": limit,
            })

            if not rows:
                return {"items": [], "total": 0}

            # 批量获取所有用户的 IP 详情（避免 N+1）
            user_ids = [int(row.get("user_id") or 0) for row in rows if row.get("user_id")]
            ip_map = {}
            
            if user_ids:
                placeholders = ",".join([":uid" + str(i) for i in range(len(user_ids))])
                ip_sql = f"""
                    SELECT 
                        user_id,
                        ip,
                        COUNT(*) as request_count
                    FROM logs
                    WHERE created_at >= :start_time AND created_at <= :end_time
                        AND user_id IN ({placeholders})
                        AND ip IS NOT NULL AND ip <> ''
                    GROUP BY user_id, ip
                    ORDER BY user_id, COUNT(*) DESC
                """
                params = {"start_time": start_time, "end_time": now}
                for i, uid in enumerate(user_ids):
                    params[f"uid{i}"] = uid
                
                ip_rows = self.db.execute(ip_sql, params)
                for r in (ip_rows or []):
                    uid = int(r.get("user_id") or 0)
                    if uid not in ip_map:
                        ip_map[uid] = []
                    if len(ip_map[uid]) < 10:  # 限制每个用户最多 10 个 IP
                        ip_map[uid].append({
                            "ip": r.get("ip") or "",
                            "request_count": int(r.get("request_count") or 0),
                        })

            items = []
            for row in rows:
                user_id = int(row.get("user_id") or 0)
                items.append({
                    "user_id": user_id,
                    "username": row.get("username") or "",
                    "ip_count": int(row.get("ip_count") or 0),
                    "request_count": int(row.get("request_count") or 0),
                    "top_ips": ip_map.get(user_id, []),
                })

            result = {"items": items, "total": len(items)}

            # 保存到缓存管理器（SQLite + Redis）
            ttl = _get_cache_ttl()
            self.cache.set_ip_monitoring("multi_ip_users", window_name, items, ttl)
            logger.success(
                f"IP监控 缓存更新: multi_ip_users",
                window=window_name,
                items=len(items),
                TTL=f"{ttl}s"
            )

            return result
        except Exception as e:
            logger.db_error(f"获取多 IP 用户失败: {e}")
            return {"items": [], "total": 0}

    def enable_all_ip_recording(self) -> Dict[str, Any]:
        """
        Enable IP recording for all users.
        Updates the setting field to include record_ip_log: true.
        """
        self.db.connect()
        
        is_pg = self.db.config.engine == DatabaseEngine.POSTGRESQL

        try:
            # Count total users
            count_sql = "SELECT COUNT(*) as total FROM users WHERE deleted_at IS NULL"
            count_rows = self.db.execute(count_sql, {})
            total_users = int((count_rows[0] if count_rows else {}).get("total") or 0)

            # Count already enabled users
            if is_pg:
                enabled_sql = """
                    SELECT COUNT(*) as enabled 
                    FROM users 
                    WHERE deleted_at IS NULL 
                        AND setting IS NOT NULL AND setting <> ''
                        AND setting::jsonb->>'record_ip_log' = 'true'
                """
            else:
                enabled_sql = """
                    SELECT COUNT(*) as enabled 
                    FROM users 
                    WHERE deleted_at IS NULL 
                        AND setting IS NOT NULL AND setting <> ''
                        AND JSON_EXTRACT(setting, '$.record_ip_log') = true
                """
            enabled_rows = self.db.execute(enabled_sql, {})
            already_enabled = int((enabled_rows[0] if enabled_rows else {}).get("enabled") or 0)

            # Update users without record_ip_log set
            if is_pg:
                # PostgreSQL: use jsonb concatenation
                update_sql = """
                    UPDATE users 
                    SET setting = COALESCE(NULLIF(setting, '')::jsonb, '{}'::jsonb) || '{"record_ip_log": true}'::jsonb
                    WHERE deleted_at IS NULL 
                        AND (setting IS NULL 
                             OR setting = ''
                             OR setting::jsonb->>'record_ip_log' IS NULL 
                             OR setting::jsonb->>'record_ip_log' <> 'true')
                """
            else:
                # MySQL: use JSON_SET
                update_sql = """
                    UPDATE users 
                    SET setting = JSON_SET(COALESCE(NULLIF(setting, ''), '{}'), '$.record_ip_log', true)
                    WHERE deleted_at IS NULL 
                        AND (setting IS NULL 
                             OR setting = ''
                             OR JSON_EXTRACT(setting, '$.record_ip_log') IS NULL 
                             OR JSON_EXTRACT(setting, '$.record_ip_log') <> true)
                """
            
            self.db.execute(update_sql, {})
            
            updated_count = total_users - already_enabled
            
            return {
                "updated_count": updated_count,
                "skipped_count": already_enabled,
                "total_users": total_users,
            }
        except Exception as e:
            logger.db_error(f"批量开启 IP 记录失败: {e}")
            raise

    def get_ip_users(
        self,
        ip: str,
        window_seconds: int,
        limit: int = 100,
        now: Optional[int] = None,
        use_cache: bool = True,
    ) -> Dict[str, Any]:
        """
        通过 IP 反查所有使用该 IP 的用户和令牌。
        返回每个 user_id + token_id 组合的请求次数、首次/末次使用时间、使用的模型。
        """
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        window_name = self._get_window_name(window_seconds)
        cache_key = f"ip_lookup:{ip}:{window_name}"

        if use_cache:
            cached = self.cache.get(cache_key)
            if cached is not None:
                return cached

        self.db.connect()
        ip = ip.strip()

        # 先做一个简单查询验证该 IP 是否存在记录
        check_sql = """
            SELECT COUNT(*) as cnt
            FROM logs
            WHERE created_at >= :start_time AND created_at <= :end_time
                AND ip = :ip
        """
        try:
            check_rows = self.db.execute(check_sql, {
                "start_time": start_time,
                "end_time": now,
                "ip": ip,
            })
            total_in_db = int((check_rows[0] if check_rows else {}).get("cnt") or 0)
            logger.info(
                f"[IP反查] 预检: ip={ip}, window={window_name}, "
                f"time_range=[{start_time}, {now}], 匹配记录={total_in_db}"
            )
        except Exception as e:
            logger.db_error(f"[IP反查] 预检查询失败: {e}")
            total_in_db = -1

        # 查询使用该 IP 的所有用户和令牌
        sql = """
            SELECT
                user_id,
                COALESCE(MAX(username), '') as username,
                token_id,
                COALESCE(MAX(token_name), '') as token_name,
                COUNT(*) as request_count,
                MIN(created_at) as first_seen,
                MAX(created_at) as last_seen
            FROM logs
            WHERE created_at >= :start_time AND created_at <= :end_time
                AND ip = :ip
                AND user_id IS NOT NULL
            GROUP BY user_id, token_id
            ORDER BY request_count DESC
            LIMIT :limit
        """

        items = []
        total_requests = 0
        user_ids_seen = set()

        try:
            rows = self.db.execute(sql, {
                "start_time": start_time,
                "end_time": now,
                "ip": ip,
                "limit": limit,
            })

            for row in rows:
                req_count = int(row.get("request_count") or 0)
                total_requests += req_count
                uid = int(row.get("user_id") or 0)
                user_ids_seen.add(uid)
                items.append({
                    "user_id": uid,
                    "username": row.get("username") or "",
                    "token_id": int(row.get("token_id") or 0),
                    "token_name": row.get("token_name") or "",
                    "request_count": req_count,
                    "first_seen": int(row.get("first_seen") or 0),
                    "last_seen": int(row.get("last_seen") or 0),
                })

            logger.info(f"[IP反查] 主查询完成: ip={ip}, 结果数={len(items)}, 总请求={total_requests}")
        except Exception as e:
            logger.db_error(f"[IP反查] 主查询失败: {e}")

        # 查询使用的模型分布（Top 10）—— 独立 try 块，不影响主结果
        models = []
        try:
            model_sql = """
                SELECT
                    model,
                    COUNT(*) as usage_count
                FROM logs
                WHERE created_at >= :start_time AND created_at <= :end_time
                    AND ip = :ip
                    AND model IS NOT NULL AND model <> ''
                GROUP BY model
                ORDER BY usage_count DESC
                LIMIT 10
            """
            model_rows = self.db.execute(model_sql, {
                "start_time": start_time,
                "end_time": now,
                "ip": ip,
            })
            models = [
                {"model": r.get("model") or "", "count": int(r.get("usage_count") or 0)}
                for r in (model_rows or [])
            ]
        except Exception as e:
            logger.db_error(f"[IP反查] 模型查询失败: {e}")

        result = {
            "ip": ip,
            "window": window_name,
            "total_requests": total_requests,
            "unique_users": len(user_ids_seen),
            "unique_tokens": len(items),
            "items": items,
            "models": models,
        }

        # 有数据时才缓存
        if items:
            self.cache.set(cache_key, result, ttl=300)

        return result

    def get_user_ips(
        self,
        user_id: int,
        window_seconds: int,
        limit: int = 1000,
        now: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get all unique IPs for a specific user within a time window.
        """
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        self.db.connect()

        sql = """
            SELECT
                ip,
                COUNT(*) as request_count,
                MIN(created_at) as first_seen,
                MAX(created_at) as last_seen
            FROM logs
            WHERE created_at >= :start_time AND created_at <= :end_time
                AND user_id = :user_id
                AND ip IS NOT NULL AND ip <> ''
            GROUP BY ip
            ORDER BY request_count DESC
            LIMIT :limit
        """

        try:
            rows = self.db.execute(sql, {
                "start_time": start_time,
                "end_time": now,
                "user_id": user_id,
                "limit": limit,
            })

            return [
                {
                    "ip": r.get("ip") or "",
                    "request_count": int(r.get("request_count") or 0),
                    "first_seen": int(r.get("first_seen") or 0),
                    "last_seen": int(r.get("last_seen") or 0),
                }
                for r in rows
            ]
        except Exception as e:
            logger.db_error(f"获取用户 IP 列表失败: {e}")
            return []

    # ==================== 增量缓存查询方法（3d/7d） ====================

    def _get_shared_ips_slot_data(
        self,
        start_time: int,
        end_time: int,
        min_tokens: int = 2,
    ) -> List[Dict[str, Any]]:
        """
        查询单个时间槽的共享 IP 基础数据（用于增量缓存）

        返回格式：每个 IP 包含 token_ids 和 user_ids 列表，用于跨槽去重聚合
        """
        self.db.connect()

        sql = """
            SELECT
                ip,
                COUNT(*) as request_count
            FROM logs
            WHERE created_at >= :start_time AND created_at < :end_time
                AND ip IS NOT NULL AND ip <> ''
                AND token_id IS NOT NULL AND token_id > 0
            GROUP BY ip
            HAVING COUNT(DISTINCT token_id) >= :min_tokens
            ORDER BY COUNT(DISTINCT token_id) DESC
            LIMIT 500
        """

        try:
            rows = self.db.execute(sql, {
                "start_time": start_time,
                "end_time": end_time,
                "min_tokens": min_tokens,
            })

            if not rows:
                return []

            # 批量获取每个 IP 的 token_ids 和 user_ids
            ips = [r.get("ip") for r in rows if r.get("ip")]
            token_user_map = {}

            if ips:
                placeholders = ",".join([f":ip{i}" for i in range(len(ips))])
                detail_sql = f"""
                    SELECT
                        ip,
                        token_id,
                        user_id
                    FROM logs
                    WHERE created_at >= :start_time AND created_at < :end_time
                        AND ip IN ({placeholders})
                        AND token_id IS NOT NULL AND token_id > 0
                    GROUP BY ip, token_id, user_id
                """
                params = {"start_time": start_time, "end_time": end_time}
                for i, ip in enumerate(ips):
                    params[f"ip{i}"] = ip

                detail_rows = self.db.execute(detail_sql, params)
                for r in (detail_rows or []):
                    ip = r.get("ip")
                    if ip not in token_user_map:
                        token_user_map[ip] = {"token_ids": set(), "user_ids": set()}
                    if r.get("token_id"):
                        token_user_map[ip]["token_ids"].add(r["token_id"])
                    if r.get("user_id"):
                        token_user_map[ip]["user_ids"].add(r["user_id"])

            return [
                {
                    "ip": r.get("ip") or "",
                    "request_count": int(r.get("request_count") or 0),
                    "token_ids": list(token_user_map.get(r.get("ip"), {}).get("token_ids", [])),
                    "user_ids": list(token_user_map.get(r.get("ip"), {}).get("user_ids", [])),
                }
                for r in rows
            ]
        except Exception as e:
            logger.db_error(f"获取共享IP槽数据失败: {e}")
            return []

    def _get_multi_ip_tokens_slot_data(
        self,
        start_time: int,
        end_time: int,
        min_ips: int = 2,
    ) -> List[Dict[str, Any]]:
        """
        查询单个时间槽的多IP令牌基础数据（用于增量缓存）

        返回格式：每个 token 包含 ips 列表，用于跨槽去重聚合
        """
        self.db.connect()

        sql = """
            SELECT
                token_id,
                COALESCE(MAX(token_name), '') as token_name,
                MAX(user_id) as user_id,
                COALESCE(MAX(username), '') as username,
                COUNT(*) as request_count
            FROM logs
            WHERE created_at >= :start_time AND created_at < :end_time
                AND token_id IS NOT NULL AND token_id > 0
            GROUP BY token_id
            HAVING COUNT(DISTINCT NULLIF(ip, '')) >= :min_ips
            ORDER BY COUNT(DISTINCT NULLIF(ip, '')) DESC
            LIMIT 500
        """

        try:
            rows = self.db.execute(sql, {
                "start_time": start_time,
                "end_time": end_time,
                "min_ips": min_ips,
            })

            if not rows:
                return []

            # 批量获取每个 token 的 IP 列表
            token_ids = [int(r.get("token_id") or 0) for r in rows if r.get("token_id")]
            ip_map = {}

            if token_ids:
                placeholders = ",".join([f":tid{i}" for i in range(len(token_ids))])
                ip_sql = f"""
                    SELECT DISTINCT token_id, ip
                    FROM logs
                    WHERE created_at >= :start_time AND created_at < :end_time
                        AND token_id IN ({placeholders})
                        AND ip IS NOT NULL AND ip <> ''
                """
                params = {"start_time": start_time, "end_time": end_time}
                for i, tid in enumerate(token_ids):
                    params[f"tid{i}"] = tid

                ip_rows = self.db.execute(ip_sql, params)
                for r in (ip_rows or []):
                    tid = int(r.get("token_id") or 0)
                    if tid not in ip_map:
                        ip_map[tid] = set()
                    if r.get("ip"):
                        ip_map[tid].add(r["ip"])

            return [
                {
                    "token_id": int(r.get("token_id") or 0),
                    "token_name": r.get("token_name") or "",
                    "user_id": int(r.get("user_id") or 0),
                    "username": r.get("username") or "",
                    "request_count": int(r.get("request_count") or 0),
                    "ips": list(ip_map.get(int(r.get("token_id") or 0), [])),
                }
                for r in rows
            ]
        except Exception as e:
            logger.db_error(f"获取多IP令牌槽数据失败: {e}")
            return []

    def _get_multi_ip_users_slot_data(
        self,
        start_time: int,
        end_time: int,
        min_ips: int = 3,
    ) -> List[Dict[str, Any]]:
        """
        查询单个时间槽的多IP用户基础数据（用于增量缓存）

        返回格式：每个 user 包含 ips 列表，用于跨槽去重聚合
        """
        self.db.connect()

        sql = """
            SELECT
                user_id,
                COALESCE(MAX(username), '') as username,
                COUNT(*) as request_count
            FROM logs
            WHERE created_at >= :start_time AND created_at < :end_time
                AND user_id IS NOT NULL
            GROUP BY user_id
            HAVING COUNT(DISTINCT NULLIF(ip, '')) >= :min_ips
            ORDER BY COUNT(DISTINCT NULLIF(ip, '')) DESC
            LIMIT 500
        """

        try:
            rows = self.db.execute(sql, {
                "start_time": start_time,
                "end_time": end_time,
                "min_ips": min_ips,
            })

            if not rows:
                return []

            # 批量获取每个用户的 IP 列表
            user_ids = [int(r.get("user_id") or 0) for r in rows if r.get("user_id")]
            ip_map = {}

            if user_ids:
                placeholders = ",".join([f":uid{i}" for i in range(len(user_ids))])
                ip_sql = f"""
                    SELECT DISTINCT user_id, ip
                    FROM logs
                    WHERE created_at >= :start_time AND created_at < :end_time
                        AND user_id IN ({placeholders})
                        AND ip IS NOT NULL AND ip <> ''
                """
                params = {"start_time": start_time, "end_time": end_time}
                for i, uid in enumerate(user_ids):
                    params[f"uid{i}"] = uid

                ip_rows = self.db.execute(ip_sql, params)
                for r in (ip_rows or []):
                    uid = int(r.get("user_id") or 0)
                    if uid not in ip_map:
                        ip_map[uid] = set()
                    if r.get("ip"):
                        ip_map[uid].add(r["ip"])

            return [
                {
                    "user_id": int(r.get("user_id") or 0),
                    "username": r.get("username") or "",
                    "request_count": int(r.get("request_count") or 0),
                    "ips": list(ip_map.get(int(r.get("user_id") or 0), [])),
                }
                for r in rows
            ]
        except Exception as e:
            logger.db_error(f"获取多IP用户槽数据失败: {e}")
            return []

    def _enrich_shared_ips_details(
        self,
        base_items: List[Dict],
        start_time: int,
        end_time: int,
    ) -> List[Dict]:
        """
        为共享 IP 基础数据添加 tokens 详情（阶段2：对 Top N 获取详情）
        """
        if not base_items:
            return []

        self.db.connect()
        is_pg = self.db.config.engine == DatabaseEngine.POSTGRESQL

        ips = [item["ip"] for item in base_items if item.get("ip")]
        if not ips:
            return base_items

        # 批量获取所有 IP 的 token 详情
        placeholders = ",".join([f":ip{i}" for i in range(len(ips))])

        if is_pg:
            token_sql = f"""
                SELECT
                    ip,
                    token_id,
                    MAX(token_name) as token_name,
                    user_id,
                    MAX(username) as username,
                    COUNT(*) as request_count
                FROM logs
                WHERE created_at >= :start_time AND created_at <= :end_time
                    AND ip IN ({placeholders})
                    AND token_id IS NOT NULL AND token_id > 0
                GROUP BY ip, token_id, user_id
                ORDER BY ip, COUNT(*) DESC
            """
        else:
            token_sql = f"""
                SELECT
                    ip,
                    token_id,
                    MAX(token_name) as token_name,
                    user_id,
                    MAX(username) as username,
                    COUNT(*) as request_count
                FROM logs
                WHERE created_at >= :start_time AND created_at <= :end_time
                    AND ip IN ({placeholders})
                    AND token_id IS NOT NULL AND token_id > 0
                GROUP BY ip, token_id, user_id
                ORDER BY ip, request_count DESC
            """

        params = {"start_time": start_time, "end_time": end_time}
        for i, ip in enumerate(ips):
            params[f"ip{i}"] = ip

        try:
            token_rows = self.db.execute(token_sql, params)
            token_map = {}
            for t in (token_rows or []):
                ip = t.get("ip")
                if ip not in token_map:
                    token_map[ip] = []
                if len(token_map[ip]) < 10:
                    token_map[ip].append({
                        "token_id": int(t.get("token_id") or 0),
                        "token_name": t.get("token_name") or "",
                        "user_id": int(t.get("user_id") or 0),
                        "username": t.get("username") or "",
                        "request_count": int(t.get("request_count") or 0),
                    })

            return [
                {
                    **item,
                    "tokens": token_map.get(item["ip"], []),
                }
                for item in base_items
            ]
        except Exception as e:
            logger.db_error(f"获取共享IP详情失败: {e}")
            return base_items

    def _enrich_multi_ip_tokens_details(
        self,
        base_items: List[Dict],
        start_time: int,
        end_time: int,
    ) -> List[Dict]:
        """
        为多IP令牌基础数据添加 ips 详情（阶段2：对 Top N 获取详情）
        """
        if not base_items:
            return []

        self.db.connect()

        token_ids = [item["token_id"] for item in base_items if item.get("token_id")]
        if not token_ids:
            return base_items

        placeholders = ",".join([f":tid{i}" for i in range(len(token_ids))])
        ip_sql = f"""
            SELECT
                token_id,
                ip,
                COUNT(*) as request_count
            FROM logs
            WHERE created_at >= :start_time AND created_at <= :end_time
                AND token_id IN ({placeholders})
                AND ip IS NOT NULL AND ip <> ''
            GROUP BY token_id, ip
            ORDER BY token_id, COUNT(*) DESC
        """

        params = {"start_time": start_time, "end_time": end_time}
        for i, tid in enumerate(token_ids):
            params[f"tid{i}"] = tid

        try:
            ip_rows = self.db.execute(ip_sql, params)
            ip_map = {}
            for r in (ip_rows or []):
                tid = int(r.get("token_id") or 0)
                if tid not in ip_map:
                    ip_map[tid] = []
                if len(ip_map[tid]) < 10:
                    ip_map[tid].append({
                        "ip": r.get("ip") or "",
                        "request_count": int(r.get("request_count") or 0),
                    })

            return [
                {
                    **item,
                    "ips": ip_map.get(item["token_id"], []),
                }
                for item in base_items
            ]
        except Exception as e:
            logger.db_error(f"获取多IP令牌详情失败: {e}")
            return base_items

    def _enrich_multi_ip_users_details(
        self,
        base_items: List[Dict],
        start_time: int,
        end_time: int,
    ) -> List[Dict]:
        """
        为多IP用户基础数据添加 top_ips 详情（阶段2：对 Top N 获取详情）
        """
        if not base_items:
            return []

        self.db.connect()

        user_ids = [item["user_id"] for item in base_items if item.get("user_id")]
        if not user_ids:
            return base_items

        placeholders = ",".join([f":uid{i}" for i in range(len(user_ids))])
        ip_sql = f"""
            SELECT
                user_id,
                ip,
                COUNT(*) as request_count
            FROM logs
            WHERE created_at >= :start_time AND created_at <= :end_time
                AND user_id IN ({placeholders})
                AND ip IS NOT NULL AND ip <> ''
            GROUP BY user_id, ip
            ORDER BY user_id, COUNT(*) DESC
        """

        params = {"start_time": start_time, "end_time": end_time}
        for i, uid in enumerate(user_ids):
            params[f"uid{i}"] = uid

        try:
            ip_rows = self.db.execute(ip_sql, params)
            ip_map = {}
            for r in (ip_rows or []):
                uid = int(r.get("user_id") or 0)
                if uid not in ip_map:
                    ip_map[uid] = []
                if len(ip_map[uid]) < 10:
                    ip_map[uid].append({
                        "ip": r.get("ip") or "",
                        "request_count": int(r.get("request_count") or 0),
                    })

            return [
                {
                    **item,
                    "top_ips": ip_map.get(item["user_id"], []),
                }
                for item in base_items
            ]
        except Exception as e:
            logger.db_error(f"获取多IP用户详情失败: {e}")
            return base_items

    def _get_incremental_data(
        self,
        monitor_type: str,
        window_name: str,
        now: int,
        min_threshold: int,
        limit: int,
        log_progress: bool = False,
    ) -> List[Dict]:
        """
        增量获取 IP 监控数据（通用方法）

        流程：
        1. 获取缺失的槽和已缓存的槽
        2. 只查询缺失的槽
        3. 聚合所有槽数据生成 Top N
        """
        # 获取缺失的槽和已缓存的槽
        missing_slots, cached_slots = self.cache.get_ip_monitor_missing_slots(
            monitor_type, window_name, now
        )

        if log_progress:
            total_slots = len(missing_slots) + len(cached_slots)
            logger.info(
                f"[IP增量预热] {monitor_type}@{window_name} 槽状态",
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
                logger.debug(f"[IP增量预热] 查询槽 {start_str} ~ {end_str}")

            # 根据类型查询槽数据
            if monitor_type == "shared_ips":
                slot_data = self._get_shared_ips_slot_data(slot_start, slot_end, min_threshold)
            elif monitor_type == "multi_ip_tokens":
                slot_data = self._get_multi_ip_tokens_slot_data(slot_start, slot_end, min_threshold)
            elif monitor_type == "multi_ip_users":
                slot_data = self._get_multi_ip_users_slot_data(slot_start, slot_end, min_threshold)
            else:
                slot_data = []

            # 保存到槽缓存
            self.cache.set_ip_monitor_slot(monitor_type, window_name, slot_start, slot_end, slot_data)

            # 添加到已缓存的槽
            cached_slots[slot_start] = {
                "slot_end": slot_end,
                "data": slot_data,
            }

            if log_progress:
                logger.debug(f"[IP增量预热] 槽缓存完成，条目数={len(slot_data)}")

        # 聚合所有槽数据
        result = self.cache.aggregate_ip_monitor_slots(monitor_type, cached_slots, limit)

        if log_progress:
            logger.success(
                f"[IP增量预热] {monitor_type}@{window_name} 聚合完成",
                槽数=len(cached_slots),
                结果数=len(result),
            )

        return result


_ip_monitoring_service: Optional[IPMonitoringService] = None


def get_ip_monitoring_service() -> IPMonitoringService:
    global _ip_monitoring_service
    if _ip_monitoring_service is None:
        _ip_monitoring_service = IPMonitoringService()
    return _ip_monitoring_service

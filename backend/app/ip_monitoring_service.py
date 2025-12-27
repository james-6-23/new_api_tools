"""
IP Monitoring Service for NewAPI Middleware Tool.
Provides IP usage analysis and management for risk monitoring.

Optimizations:
- Batch queries to avoid N+1 problem
- In-memory cache with TTL based on system scale
"""
import time
import threading
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


class SimpleCache:
    """Thread-safe in-memory cache with TTL."""
    
    def __init__(self):
        self._cache: Dict[str, tuple] = {}  # key -> (data, expires_at)
        self._lock = threading.Lock()
    
    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            data, expires_at = entry
            if time.time() > expires_at:
                del self._cache[key]
                return None
            return data
    
    def set(self, key: str, value: Any, ttl: float):
        with self._lock:
            self._cache[key] = (value, time.time() + ttl)
    
    def clear(self):
        with self._lock:
            self._cache.clear()


# Global cache instance
_ip_cache = SimpleCache()


class IPMonitoringService:
    """Service for IP usage monitoring and analysis."""

    def __init__(self, db: Optional[DatabaseManager] = None):
        self._db = db

    @property
    def db(self) -> DatabaseManager:
        if self._db is None:
            self._db = get_db_manager()
        return self._db

    def get_ip_recording_stats(self) -> Dict[str, Any]:
        """
        Get statistics about IP recording settings across all users.
        Returns count of users with IP recording enabled/disabled.
        """
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
            
            return {
                "total_users": total_users,
                "enabled_count": enabled_count,
                "disabled_count": disabled_count,
                "enabled_percentage": round(enabled_percentage, 2),
                "unique_ips_24h": unique_ips_24h,
            }
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
    ) -> Dict[str, Any]:
        """
        Get IPs that are used by multiple tokens.
        Helps identify potential account sharing.
        Optimized: single query with aggregated token info.
        """
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        # 检查缓存
        cache_key = f"shared_ips:{window_seconds}:{min_tokens}:{limit}"
        if use_cache:
            cached = _ip_cache.get(cache_key)
            if cached is not None:
                return cached
        
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
            _ip_cache.set(cache_key, result, _get_cache_ttl())
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
    ) -> Dict[str, Any]:
        """
        Get tokens that are used from multiple IPs.
        Helps identify potential token sharing or leakage.
        Optimized: batch query for IP details to avoid N+1 problem.
        """
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        # 检查缓存
        cache_key = f"multi_ip_tokens:{window_seconds}:{min_ips}:{limit}"
        if use_cache:
            cached = _ip_cache.get(cache_key)
            if cached is not None:
                return cached

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
            _ip_cache.set(cache_key, result, _get_cache_ttl())
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
    ) -> Dict[str, Any]:
        """
        Get users that access from multiple IPs.
        Helps identify potential account sharing.
        Optimized: batch query for IP details to avoid N+1 problem.
        """
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        # 检查缓存
        cache_key = f"multi_ip_users:{window_seconds}:{min_ips}:{limit}"
        if use_cache:
            cached = _ip_cache.get(cache_key)
            if cached is not None:
                return cached

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
            _ip_cache.set(cache_key, result, _get_cache_ttl())
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


_ip_monitoring_service: Optional[IPMonitoringService] = None


def get_ip_monitoring_service() -> IPMonitoringService:
    global _ip_monitoring_service
    if _ip_monitoring_service is None:
        _ip_monitoring_service = IPMonitoringService()
    return _ip_monitoring_service

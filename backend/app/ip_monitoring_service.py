"""
IP Monitoring Service for NewAPI Middleware Tool.
Provides IP usage analysis and management for risk monitoring.
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
                        WHEN setting::jsonb->>'record_ip_log' = 'true' THEN 1 
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
                        WHEN JSON_EXTRACT(setting, '$.record_ip_log') = true THEN 1 
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
    ) -> Dict[str, Any]:
        """
        Get IPs that are used by multiple tokens.
        Helps identify potential account sharing.
        """
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        self.db.connect()

        # First, find IPs with multiple tokens
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
            for row in rows:
                ip = row.get("ip") or ""
                
                # Get token details for this IP
                token_sql = """
                    SELECT 
                        l.token_id,
                        COALESCE(MAX(l.token_name), '') as token_name,
                        l.user_id,
                        COALESCE(MAX(l.username), '') as username,
                        COUNT(*) as request_count
                    FROM logs l
                    WHERE l.created_at >= :start_time AND l.created_at <= :end_time
                        AND l.ip = :ip
                        AND l.token_id IS NOT NULL AND l.token_id > 0
                    GROUP BY l.token_id, l.user_id
                    ORDER BY request_count DESC
                    LIMIT 20
                """
                token_rows = self.db.execute(token_sql, {
                    "start_time": start_time,
                    "end_time": now,
                    "ip": ip,
                })

                tokens = [
                    {
                        "token_id": int(t.get("token_id") or 0),
                        "token_name": t.get("token_name") or "",
                        "user_id": int(t.get("user_id") or 0),
                        "username": t.get("username") or "",
                        "request_count": int(t.get("request_count") or 0),
                    }
                    for t in (token_rows or [])
                ]

                items.append({
                    "ip": ip,
                    "token_count": int(row.get("token_count") or 0),
                    "user_count": int(row.get("user_count") or 0),
                    "request_count": int(row.get("request_count") or 0),
                    "tokens": tokens,
                })

            return {"items": items, "total": len(items)}
        except Exception as e:
            logger.db_error(f"获取共享 IP 失败: {e}")
            return {"items": [], "total": 0}

    def get_multi_ip_tokens(
        self,
        window_seconds: int,
        min_ips: int = 2,
        limit: int = 50,
        now: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Get tokens that are used from multiple IPs.
        Helps identify potential token sharing or leakage.
        """
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        self.db.connect()

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

            items = []
            for row in rows:
                token_id = int(row.get("token_id") or 0)
                
                # Get IP details for this token
                ip_sql = """
                    SELECT 
                        ip,
                        COUNT(*) as request_count
                    FROM logs
                    WHERE created_at >= :start_time AND created_at <= :end_time
                        AND token_id = :token_id
                        AND ip IS NOT NULL AND ip <> ''
                    GROUP BY ip
                    ORDER BY request_count DESC
                    LIMIT 20
                """
                ip_rows = self.db.execute(ip_sql, {
                    "start_time": start_time,
                    "end_time": now,
                    "token_id": token_id,
                })

                ips = [
                    {
                        "ip": i.get("ip") or "",
                        "request_count": int(i.get("request_count") or 0),
                    }
                    for i in (ip_rows or [])
                ]

                items.append({
                    "token_id": token_id,
                    "token_name": row.get("token_name") or "",
                    "user_id": int(row.get("user_id") or 0),
                    "username": row.get("username") or "",
                    "ip_count": int(row.get("ip_count") or 0),
                    "request_count": int(row.get("request_count") or 0),
                    "ips": ips,
                })

            return {"items": items, "total": len(items)}
        except Exception as e:
            logger.db_error(f"获取多 IP 令牌失败: {e}")
            return {"items": [], "total": 0}


    def get_multi_ip_users(
        self,
        window_seconds: int,
        min_ips: int = 3,
        limit: int = 50,
        now: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Get users that access from multiple IPs.
        Helps identify potential account sharing.
        """
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        self.db.connect()

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

            items = []
            for row in rows:
                user_id = int(row.get("user_id") or 0)
                
                # Get top IPs for this user
                ip_sql = """
                    SELECT 
                        ip,
                        COUNT(*) as request_count
                    FROM logs
                    WHERE created_at >= :start_time AND created_at <= :end_time
                        AND user_id = :user_id
                        AND ip IS NOT NULL AND ip <> ''
                    GROUP BY ip
                    ORDER BY request_count DESC
                    LIMIT 10
                """
                ip_rows = self.db.execute(ip_sql, {
                    "start_time": start_time,
                    "end_time": now,
                    "user_id": user_id,
                })

                top_ips = [
                    {
                        "ip": i.get("ip") or "",
                        "request_count": int(i.get("request_count") or 0),
                    }
                    for i in (ip_rows or [])
                ]

                items.append({
                    "user_id": user_id,
                    "username": row.get("username") or "",
                    "ip_count": int(row.get("ip_count") or 0),
                    "request_count": int(row.get("request_count") or 0),
                    "top_ips": top_ips,
                })

            return {"items": items, "total": len(items)}
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
                        AND setting::jsonb->>'record_ip_log' = 'true'
                """
            else:
                enabled_sql = """
                    SELECT COUNT(*) as enabled 
                    FROM users 
                    WHERE deleted_at IS NULL 
                        AND JSON_EXTRACT(setting, '$.record_ip_log') = true
                """
            enabled_rows = self.db.execute(enabled_sql, {})
            already_enabled = int((enabled_rows[0] if enabled_rows else {}).get("enabled") or 0)

            # Update users without record_ip_log set
            if is_pg:
                # PostgreSQL: use jsonb concatenation
                update_sql = """
                    UPDATE users 
                    SET setting = COALESCE(setting::jsonb, '{}'::jsonb) || '{"record_ip_log": true}'::jsonb
                    WHERE deleted_at IS NULL 
                        AND (setting IS NULL 
                             OR setting::jsonb->>'record_ip_log' IS NULL 
                             OR setting::jsonb->>'record_ip_log' <> 'true')
                """
            else:
                # MySQL: use JSON_SET
                update_sql = """
                    UPDATE users 
                    SET setting = JSON_SET(COALESCE(setting, '{}'), '$.record_ip_log', true)
                    WHERE deleted_at IS NULL 
                        AND (setting IS NULL 
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


_ip_monitoring_service: Optional[IPMonitoringService] = None


def get_ip_monitoring_service() -> IPMonitoringService:
    global _ip_monitoring_service
    if _ip_monitoring_service is None:
        _ip_monitoring_service = IPMonitoringService()
    return _ip_monitoring_service

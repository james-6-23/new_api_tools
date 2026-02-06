"""
Local SQLite Storage Service for NewAPI Middleware Tool.
Handles local configuration, caching, and statistics snapshots.
"""
import json
import logging
import os
import sqlite3
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Default SQLite database path - use absolute path in container
DEFAULT_DB_PATH = os.getenv("LOCAL_DB_PATH", "/app/data/local.db")


@dataclass
class CacheEntry:
    """Cache entry data model."""
    key: str
    value: Any
    expires_at: int
    created_at: int


@dataclass
class ConfigEntry:
    """Configuration entry data model."""
    key: str
    value: Any
    description: str
    updated_at: int


class LocalStorage:
    """
    Local SQLite storage for configuration, caching, and statistics.
    Thread-safe implementation with connection pooling.
    """

    def __init__(self, db_path: str = DEFAULT_DB_PATH):
        """Initialize LocalStorage."""
        self.db_path = db_path
        self._ensure_db_directory()
        self._init_database()

    def _ensure_db_directory(self):
        """Ensure the database directory exists."""
        db_dir = Path(self.db_path).parent
        if not db_dir.exists():
            db_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"Created database directory: {db_dir}")

    @contextmanager
    def _get_connection(self):
        """Get a database connection with context manager."""
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def _init_database(self):
        """Initialize database schema."""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            # Configuration table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS config (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    updated_at INTEGER NOT NULL
                )
            """)

            # Cache table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS cache (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    expires_at INTEGER NOT NULL,
                    created_at INTEGER NOT NULL
                )
            """)

            # Statistics snapshots table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS stats_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    snapshot_type TEXT NOT NULL,
                    data TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                )
            """)

            # Security audit table (ban/unban, moderation decisions)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS security_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    username TEXT DEFAULT '',
                    operator TEXT DEFAULT '',
                    reason TEXT DEFAULT '',
                    context TEXT DEFAULT '',
                    created_at INTEGER NOT NULL
                )
            """)

            # Create indexes
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_cache_expires
                ON cache(expires_at)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_stats_type_time
                ON stats_snapshots(snapshot_type, created_at)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_security_audit_time
                ON security_audit(created_at)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_security_audit_user
                ON security_audit(user_id)
            """)

            # AI 审查记录表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ai_audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    scan_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    window TEXT DEFAULT '1h',
                    total_scanned INTEGER DEFAULT 0,
                    total_processed INTEGER DEFAULT 0,
                    banned_count INTEGER DEFAULT 0,
                    warned_count INTEGER DEFAULT 0,
                    skipped_count INTEGER DEFAULT 0,
                    error_count INTEGER DEFAULT 0,
                    dry_run INTEGER DEFAULT 1,
                    elapsed_seconds REAL DEFAULT 0,
                    error_message TEXT DEFAULT '',
                    details TEXT DEFAULT '',
                    created_at INTEGER NOT NULL
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_time
                ON ai_audit_logs(created_at)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_status
                ON ai_audit_logs(status)
            """)

            # Auto group logs table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS auto_group_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    username TEXT DEFAULT '',
                    old_group TEXT DEFAULT 'default',
                    new_group TEXT NOT NULL,
                    action TEXT NOT NULL,
                    source TEXT DEFAULT '',
                    operator TEXT DEFAULT 'system',
                    created_at INTEGER NOT NULL
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_auto_group_logs_time
                ON auto_group_logs(created_at)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_auto_group_logs_user
                ON auto_group_logs(user_id)
            """)

            conn.commit()
            logger.info(f"LocalStorage initialized at {self.db_path}")

    # ==================== Configuration Methods ====================

    def get_config(self, key: str, default: Any = None) -> Any:
        """Get a configuration value."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT value FROM config WHERE key = ?",
                (key,)
            )
            row = cursor.fetchone()
            if row:
                try:
                    return json.loads(row["value"])
                except json.JSONDecodeError:
                    return row["value"]
            return default

    def set_config(self, key: str, value: Any, description: str = "") -> None:
        """Set a configuration value."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            json_value = json.dumps(value) if not isinstance(value, str) else value
            cursor.execute("""
                INSERT OR REPLACE INTO config (key, value, description, updated_at)
                VALUES (?, ?, ?, ?)
            """, (key, json_value, description, int(time.time())))
            conn.commit()

    def delete_config(self, key: str) -> bool:
        """Delete a configuration value."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM config WHERE key = ?", (key,))
            conn.commit()
            return cursor.rowcount > 0

    def get_all_configs(self) -> Dict[str, ConfigEntry]:
        """Get all configuration entries."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT key, value, description, updated_at FROM config")
            result = {}
            for row in cursor.fetchall():
                try:
                    value = json.loads(row["value"])
                except json.JSONDecodeError:
                    value = row["value"]
                result[row["key"]] = ConfigEntry(
                    key=row["key"],
                    value=value,
                    description=row["description"],
                    updated_at=row["updated_at"],
                )
            return result

    # ==================== Cache Methods ====================

    def cache_get(self, key: str) -> Optional[Any]:
        """Get a cached value if not expired."""
        current_time = int(time.time())
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT value, expires_at FROM cache WHERE key = ?",
                (key,)
            )
            row = cursor.fetchone()
            if row and row["expires_at"] > current_time:
                try:
                    return json.loads(row["value"])
                except json.JSONDecodeError:
                    return row["value"]
            elif row:
                # Expired, delete it
                cursor.execute("DELETE FROM cache WHERE key = ?", (key,))
                conn.commit()
            return None

    def cache_set(self, key: str, value: Any, ttl: int = 300) -> None:
        """
        Set a cached value with TTL.

        Args:
            key: Cache key
            value: Value to cache
            ttl: Time to live in seconds (default 5 minutes)
        """
        current_time = int(time.time())
        expires_at = current_time + ttl
        with self._get_connection() as conn:
            cursor = conn.cursor()
            json_value = json.dumps(value)
            cursor.execute("""
                INSERT OR REPLACE INTO cache (key, value, expires_at, created_at)
                VALUES (?, ?, ?, ?)
            """, (key, json_value, expires_at, current_time))
            conn.commit()

    def cache_delete(self, key: str) -> bool:
        """Delete a cached value."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM cache WHERE key = ?", (key,))
            conn.commit()
            return cursor.rowcount > 0

    def cache_clear(self, pattern: Optional[str] = None) -> int:
        """
        Clear cache entries.

        Args:
            pattern: Optional LIKE pattern to match keys (e.g., 'dashboard:%')

        Returns:
            Number of entries deleted
        """
        with self._get_connection() as conn:
            cursor = conn.cursor()
            if pattern:
                cursor.execute("DELETE FROM cache WHERE key LIKE ?", (pattern,))
            else:
                cursor.execute("DELETE FROM cache")
            conn.commit()
            return cursor.rowcount

    # ==================== Security Audit Methods ====================

    def add_security_audit(
        self,
        action: str,
        user_id: int,
        username: str = "",
        operator: str = "",
        reason: str = "",
        context: Optional[dict[str, Any]] = None,
        created_at: Optional[int] = None,
    ) -> int:
        """Insert a security audit record and return its row id."""
        if created_at is None:
            created_at = int(time.time())
        context_json = json.dumps(context or {}, ensure_ascii=False)
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO security_audit (action, user_id, username, operator, reason, context, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (action, int(user_id), username or "", operator or "", reason or "", context_json, int(created_at)),
            )
            conn.commit()
            return int(cursor.lastrowid or 0)

    def list_security_audits(
        self,
        page: int = 1,
        page_size: int = 50,
        action: Optional[str] = None,
        user_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """List security audit records with simple pagination."""
        page = max(1, int(page))
        page_size = max(1, min(200, int(page_size)))
        offset = (page - 1) * page_size

        where = []
        params: list[Any] = []
        if action:
            where.append("action = ?")
            params.append(action)
        if user_id is not None:
            where.append("user_id = ?")
            params.append(int(user_id))
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(f"SELECT COUNT(*) as cnt FROM security_audit {where_sql}", params)
            total = int(cursor.fetchone()["cnt"])

            cursor.execute(
                f"""
                SELECT id, action, user_id, username, operator, reason, context, created_at
                FROM security_audit
                {where_sql}
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """,
                [*params, page_size, offset],
            )
            rows = cursor.fetchall()

        items: List[Dict[str, Any]] = []
        for r in rows:
            try:
                ctx = json.loads(r["context"]) if r["context"] else {}
            except json.JSONDecodeError:
                ctx = {}
            items.append(
                {
                    "id": int(r["id"]),
                    "action": r["action"],
                    "user_id": int(r["user_id"]),
                    "username": r["username"] or "",
                    "operator": r["operator"] or "",
                    "reason": r["reason"] or "",
                    "context": ctx,
                    "created_at": int(r["created_at"]),
                }
            )

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size,
        }

    def get_latest_ban_record(self, user_id: int) -> Optional[Dict[str, Any]]:
        """获取用户最近的封禁记录"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, action, user_id, username, operator, reason, context, created_at
                FROM security_audit
                WHERE user_id = ? AND action = 'ban'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                [user_id],
            )
            row = cursor.fetchone()
            
            if not row:
                return None
            
            try:
                ctx = json.loads(row["context"]) if row["context"] else {}
            except json.JSONDecodeError:
                ctx = {}
            
            return {
                "id": int(row["id"]),
                "action": row["action"],
                "user_id": int(row["user_id"]),
                "username": row["username"] or "",
                "operator": row["operator"] or "",
                "reason": row["reason"] or "",
                "context": ctx,
                "created_at": int(row["created_at"]),
            }

    def cache_cleanup_expired(self) -> int:
        """Remove all expired cache entries."""
        current_time = int(time.time())
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM cache WHERE expires_at < ?",
                (current_time,)
            )
            conn.commit()
            deleted = cursor.rowcount
            if deleted > 0:
                logger.info(f"Cleaned up {deleted} expired cache entries")
            return deleted

    # ==================== Statistics Snapshot Methods ====================

    def save_stats_snapshot(self, snapshot_type: str, data: Dict[str, Any]) -> int:
        """
        Save a statistics snapshot.

        Args:
            snapshot_type: Type of snapshot (e.g., 'dashboard', 'usage', 'models')
            data: Snapshot data

        Returns:
            Snapshot ID
        """
        current_time = int(time.time())
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO stats_snapshots (snapshot_type, data, created_at)
                VALUES (?, ?, ?)
            """, (snapshot_type, json.dumps(data), current_time))
            conn.commit()
            return cursor.lastrowid

    def get_latest_snapshot(self, snapshot_type: str) -> Optional[Dict[str, Any]]:
        """Get the most recent snapshot of a given type."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT data, created_at FROM stats_snapshots
                WHERE snapshot_type = ?
                ORDER BY created_at DESC
                LIMIT 1
            """, (snapshot_type,))
            row = cursor.fetchone()
            if row:
                try:
                    data = json.loads(row["data"])
                    data["_snapshot_time"] = row["created_at"]
                    return data
                except json.JSONDecodeError:
                    return None
            return None

    def get_snapshots_in_range(
        self,
        snapshot_type: str,
        start_time: int,
        end_time: int,
    ) -> List[Dict[str, Any]]:
        """Get snapshots within a time range."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT data, created_at FROM stats_snapshots
                WHERE snapshot_type = ? AND created_at >= ? AND created_at <= ?
                ORDER BY created_at ASC
            """, (snapshot_type, start_time, end_time))
            result = []
            for row in cursor.fetchall():
                try:
                    data = json.loads(row["data"])
                    data["_snapshot_time"] = row["created_at"]
                    result.append(data)
                except json.JSONDecodeError:
                    continue
            return result

    def cleanup_old_snapshots(self, max_age_days: int = 30) -> int:
        """Remove snapshots older than max_age_days."""
        cutoff_time = int(time.time()) - (max_age_days * 86400)
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM stats_snapshots WHERE created_at < ?",
                (cutoff_time,)
            )
            conn.commit()
            deleted = cursor.rowcount
            if deleted > 0:
                logger.info(f"Cleaned up {deleted} old snapshots")
            return deleted

    # ==================== AI Audit Log Methods ====================

    def add_ai_audit_log(
        self,
        scan_id: str,
        status: str,
        window: str = "1h",
        total_scanned: int = 0,
        total_processed: int = 0,
        banned_count: int = 0,
        warned_count: int = 0,
        skipped_count: int = 0,
        error_count: int = 0,
        dry_run: bool = True,
        elapsed_seconds: float = 0,
        error_message: str = "",
        details: Any = None,
    ) -> int:
        """添加 AI 审查记录"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO ai_audit_logs 
                (scan_id, status, window, total_scanned, total_processed, 
                 banned_count, warned_count, skipped_count, error_count,
                 dry_run, elapsed_seconds, error_message, details, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    scan_id,
                    status,
                    window,
                    total_scanned,
                    total_processed,
                    banned_count,
                    warned_count,
                    skipped_count,
                    error_count,
                    1 if dry_run else 0,
                    elapsed_seconds,
                    error_message,
                    json.dumps(details) if details else "",
                    int(time.time()),
                )
            )
            conn.commit()
            return cursor.lastrowid

    def get_ai_audit_logs(
        self,
        limit: int = 50,
        offset: int = 0,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        """获取 AI 审查记录列表"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            
            # 构建查询
            where_clause = ""
            params = []
            if status:
                where_clause = "WHERE status = ?"
                params.append(status)
            
            # 获取总数
            cursor.execute(
                f"SELECT COUNT(*) FROM ai_audit_logs {where_clause}",
                params
            )
            total = cursor.fetchone()[0]
            
            # 获取记录
            cursor.execute(
                f"""
                SELECT * FROM ai_audit_logs 
                {where_clause}
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """,
                params + [limit, offset]
            )
            
            rows = cursor.fetchall()
            items = []
            for row in rows:
                item = dict(row)
                # 解析 details JSON
                if item.get("details"):
                    try:
                        item["details"] = json.loads(item["details"])
                    except json.JSONDecodeError:
                        pass
                item["dry_run"] = bool(item.get("dry_run"))
                items.append(item)
            
            return {
                "items": items,
                "total": total,
                "limit": limit,
                "offset": offset,
            }

    def cleanup_old_ai_audit_logs(self, max_age_days: int = 30) -> int:
        """清理旧的 AI 审查记录"""
        cutoff_time = int(time.time()) - (max_age_days * 86400)
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM ai_audit_logs WHERE created_at < ?",
                (cutoff_time,)
            )
            conn.commit()
            deleted = cursor.rowcount
            if deleted > 0:
                logger.info(f"Cleaned up {deleted} old AI audit logs")
            return deleted

    def delete_ai_audit_logs(self) -> int:
        """删除所有 AI 审查记录"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM ai_audit_logs")
            conn.commit()
            return cursor.rowcount

    # ==================== Auto Group Log Methods ====================

    def add_auto_group_log(
        self,
        user_id: int,
        username: str,
        old_group: str,
        new_group: str,
        action: str,
        source: str = "",
        operator: str = "system",
    ) -> int:
        """添加自动分组日志记录"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO auto_group_logs
                (user_id, username, old_group, new_group, action, source, operator, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    int(user_id),
                    username or "",
                    old_group or "default",
                    new_group,
                    action,
                    source or "",
                    operator or "system",
                    int(time.time()),
                )
            )
            conn.commit()
            return cursor.lastrowid

    def get_auto_group_logs(
        self,
        page: int = 1,
        page_size: int = 50,
        action: Optional[str] = None,
        user_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """获取自动分组日志列表"""
        page = max(1, int(page))
        page_size = max(1, min(200, int(page_size)))
        offset = (page - 1) * page_size

        where = []
        params: List[Any] = []
        if action:
            where.append("action = ?")
            params.append(action)
        if user_id is not None:
            where.append("user_id = ?")
            params.append(int(user_id))
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(f"SELECT COUNT(*) as cnt FROM auto_group_logs {where_sql}", params)
            total = int(cursor.fetchone()["cnt"])

            cursor.execute(
                f"""
                SELECT id, user_id, username, old_group, new_group, action, source, operator, created_at
                FROM auto_group_logs
                {where_sql}
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """,
                [*params, page_size, offset],
            )
            rows = cursor.fetchall()

        items: List[Dict[str, Any]] = []
        for r in rows:
            items.append({
                "id": int(r["id"]),
                "user_id": int(r["user_id"]),
                "username": r["username"] or "",
                "old_group": r["old_group"] or "default",
                "new_group": r["new_group"] or "",
                "action": r["action"],
                "source": r["source"] or "",
                "operator": r["operator"] or "system",
                "created_at": int(r["created_at"]),
            })

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size,
        }

    def get_auto_group_log_by_id(self, log_id: int) -> Optional[Dict[str, Any]]:
        """获取单条自动分组日志"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, user_id, username, old_group, new_group, action, source, operator, created_at
                FROM auto_group_logs
                WHERE id = ?
                """,
                [log_id],
            )
            row = cursor.fetchone()

            if not row:
                return None

            return {
                "id": int(row["id"]),
                "user_id": int(row["user_id"]),
                "username": row["username"] or "",
                "old_group": row["old_group"] or "default",
                "new_group": row["new_group"] or "",
                "action": row["action"],
                "source": row["source"] or "",
                "operator": row["operator"] or "system",
                "created_at": int(row["created_at"]),
            }

    def cleanup_old_auto_group_logs(self, max_age_days: int = 90) -> int:
        """清理旧的自动分组日志"""
        cutoff_time = int(time.time()) - (max_age_days * 86400)
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM auto_group_logs WHERE created_at < ?",
                (cutoff_time,)
            )
            conn.commit()
            deleted = cursor.rowcount
            if deleted > 0:
                logger.info(f"Cleaned up {deleted} old auto group logs")
            return deleted

    # ==================== Utility Methods ====================

    def get_storage_info(self) -> Dict[str, Any]:
        """Get storage statistics."""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            # Count entries in each table
            cursor.execute("SELECT COUNT(*) FROM config")
            config_count = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM cache")
            cache_count = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM stats_snapshots")
            snapshot_count = cursor.fetchone()[0]

            # Get database file size
            try:
                db_size = os.path.getsize(self.db_path)
            except OSError:
                db_size = 0

            return {
                "db_path": self.db_path,
                "db_size_bytes": db_size,
                "db_size_mb": round(db_size / (1024 * 1024), 2),
                "config_entries": config_count,
                "cache_entries": cache_count,
                "snapshot_entries": snapshot_count,
            }


# Global instance
_local_storage: Optional[LocalStorage] = None


def get_local_storage() -> LocalStorage:
    """Get or create the global LocalStorage instance."""
    global _local_storage
    if _local_storage is None:
        _local_storage = LocalStorage()
    return _local_storage


def reset_local_storage() -> None:
    """Reset the global LocalStorage instance (for testing)."""
    global _local_storage
    _local_storage = None

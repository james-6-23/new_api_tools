"""
Log Analytics Service for NewAPI Middleware Tool.
Implements incremental log processing for user rankings and model statistics.
"""
import time
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional

from .database import get_db_manager
from .local_storage import get_local_storage
from .logger import logger

# Constants
LOG_TYPE_CONSUMPTION = 2  # type=2 is consumption/usage log (success)
LOG_TYPE_FAILURE = 5  # type=5 is failure log (request failed)

# Dynamic batch size thresholds
# Based on total logs count, adjust batch size for optimal performance
BATCH_CONFIG = {
    # (min_logs, max_logs): (batch_size, max_iterations)
    (0, 10000): (1000, 20),           # Small: 1K/batch, max 20K/call
    (10000, 100000): (2000, 50),      # Medium: 2K/batch, max 100K/call
    (100000, 1000000): (5000, 100),   # Large: 5K/batch, max 500K/call
    (1000000, 10000000): (10000, 150), # Very large: 10K/batch, max 1.5M/call
    (10000000, float('inf')): (20000, 200),  # Huge: 20K/batch, max 4M/call
}

DEFAULT_BATCH_SIZE = 5000
DEFAULT_MAX_ITERATIONS = 100


@dataclass
class UserRanking:
    """User ranking data."""
    user_id: int
    username: str
    request_count: int
    quota_used: int


@dataclass
class ModelStats:
    """Model statistics data."""
    model_name: str
    total_requests: int  # success + failure requests
    success_count: int  # type=2 requests
    failure_count: int  # type=5 requests
    empty_count: int  # completion_tokens = 0 (within success)
    success_rate: float  # percentage: success / total
    empty_rate: float  # percentage: empty / success


@dataclass
class AnalyticsState:
    """Analytics processing state."""
    last_log_id: int
    last_processed_at: int
    total_processed: int


class LogAnalyticsService:
    """
    Service for incremental log analytics.
    Processes logs in batches and stores aggregated statistics in SQLite.
    """

    def __init__(self):
        self._db = get_db_manager()
        self._storage = get_local_storage()
        self._init_analytics_tables()

    def _init_analytics_tables(self):
        """Initialize analytics tables in SQLite."""
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()

            # Analytics state table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS analytics_state (
                    key TEXT PRIMARY KEY,
                    value INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
            """)

            # User rankings table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS user_rankings (
                    user_id INTEGER PRIMARY KEY,
                    username TEXT NOT NULL,
                    request_count INTEGER DEFAULT 0,
                    quota_used INTEGER DEFAULT 0,
                    updated_at INTEGER NOT NULL
                )
            """)

            # Model statistics table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS model_stats (
                    model_name TEXT PRIMARY KEY,
                    total_requests INTEGER DEFAULT 0,
                    success_count INTEGER DEFAULT 0,
                    failure_count INTEGER DEFAULT 0,
                    empty_count INTEGER DEFAULT 0,
                    updated_at INTEGER NOT NULL
                )
            """)

            # Migration: add failure_count column if not exists
            cursor.execute("PRAGMA table_info(model_stats)")
            columns = [col[1] for col in cursor.fetchall()]
            if "failure_count" not in columns:
                cursor.execute("ALTER TABLE model_stats ADD COLUMN failure_count INTEGER DEFAULT 0")

            conn.commit()

    def _get_state(self, key: str, default: int = 0) -> int:
        """Get analytics state value."""
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT value FROM analytics_state WHERE key = ?",
                (key,)
            )
            row = cursor.fetchone()
            return row[0] if row else default

    def _set_state(self, key: str, value: int):
        """Set analytics state value."""
        now = int(time.time())
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO analytics_state (key, value, updated_at)
                VALUES (?, ?, ?)
            """, (key, value, now))
            conn.commit()

    def get_analytics_state(self) -> AnalyticsState:
        """Get current analytics processing state."""
        return AnalyticsState(
            last_log_id=self._get_state("last_log_id", 0),
            last_processed_at=self._get_state("last_processed_at", 0),
            total_processed=self._get_state("total_processed", 0),
        )

    def process_new_logs(self) -> Dict[str, Any]:
        """
        Process new logs incrementally.
        Uses dynamic batch size based on total logs count.

        Returns:
            Processing result with count of processed logs.
        """
        last_log_id = self._get_state("last_log_id", 0)
        total_processed = self._get_state("total_processed", 0)
        
        # Get dynamic batch size
        batch_size, _ = self._get_dynamic_batch_config()

        # Fetch new logs from main database (both success type=2 and failure type=5)
        sql = """
            SELECT
                id, user_id, username, model_name, quota,
                prompt_tokens, completion_tokens, type
            FROM logs
            WHERE id > :last_id AND type IN (:type_success, :type_failure)
            ORDER BY id ASC
            LIMIT :limit
        """

        try:
            self._db.connect()
            logs = self._db.execute(sql, {
                "last_id": last_log_id,
                "type_success": LOG_TYPE_CONSUMPTION,
                "type_failure": LOG_TYPE_FAILURE,
                "limit": batch_size,
            })
        except Exception as e:
            logger.db_error(f"获取日志失败: {e}")
            return {"success": False, "error": str(e), "processed": 0}

        if not logs:
            # Even when there are no new logs, record the time we last checked/processed.
            now = int(time.time())
            self._set_state("last_processed_at", now)
            logger.analytics("无新日志需要处理", processed=0, last_id=last_log_id)
            return {
                "success": True,
                "processed": 0,
                "message": "No new logs to process",
                "last_log_id": last_log_id,
            }

        # Process logs and aggregate statistics
        user_stats: Dict[int, Dict[str, Any]] = {}
        model_stats: Dict[str, Dict[str, int]] = {}
        max_log_id = last_log_id

        for log in logs:
            log_id = log["id"]
            user_id = log.get("user_id")
            username = log.get("username") or f"User#{user_id}"
            model_name = log.get("model_name") or "unknown"
            quota = int(log.get("quota") or 0)
            prompt_tokens = int(log.get("prompt_tokens") or 0)
            completion_tokens = int(log.get("completion_tokens") or 0)

            max_log_id = max(max_log_id, log_id)

            # Aggregate user statistics
            if user_id:
                if user_id not in user_stats:
                    user_stats[user_id] = {
                        "username": username,
                        "request_count": 0,
                        "quota_used": 0,
                    }
                user_stats[user_id]["request_count"] += 1
                user_stats[user_id]["quota_used"] += quota

            # Aggregate model statistics
            log_type = int(log.get("type") or 0)
            if model_name not in model_stats:
                model_stats[model_name] = {
                    "total_requests": 0,
                    "success_count": 0,
                    "failure_count": 0,
                    "empty_count": 0,
                }
            model_stats[model_name]["total_requests"] += 1

            # Success/Failure based on log type
            if log_type == LOG_TYPE_CONSUMPTION:
                # type=2: successful request
                model_stats[model_name]["success_count"] += 1
                # Empty = no output tokens (空回复)
                if completion_tokens == 0:
                    model_stats[model_name]["empty_count"] += 1
            elif log_type == LOG_TYPE_FAILURE:
                # type=5: failed request
                model_stats[model_name]["failure_count"] += 1

        # Update SQLite with aggregated data
        now = int(time.time())
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()

            # Update user rankings
            for user_id, stats in user_stats.items():
                cursor.execute("""
                    INSERT INTO user_rankings (user_id, username, request_count, quota_used, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        username = excluded.username,
                        request_count = user_rankings.request_count + excluded.request_count,
                        quota_used = user_rankings.quota_used + excluded.quota_used,
                        updated_at = excluded.updated_at
                """, (
                    user_id,
                    stats["username"],
                    stats["request_count"],
                    stats["quota_used"],
                    now,
                ))

            # Update model statistics
            for model_name, stats in model_stats.items():
                cursor.execute("""
                    INSERT INTO model_stats (model_name, total_requests, success_count, failure_count, empty_count, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(model_name) DO UPDATE SET
                        total_requests = model_stats.total_requests + excluded.total_requests,
                        success_count = model_stats.success_count + excluded.success_count,
                        failure_count = model_stats.failure_count + excluded.failure_count,
                        empty_count = model_stats.empty_count + excluded.empty_count,
                        updated_at = excluded.updated_at
                """, (
                    model_name,
                    stats["total_requests"],
                    stats["success_count"],
                    stats["failure_count"],
                    stats["empty_count"],
                    now,
                ))

            conn.commit()

        # Update processing state
        processed_count = len(logs)
        self._set_state("last_log_id", max_log_id)
        self._set_state("last_processed_at", now)
        self._set_state("total_processed", total_processed + processed_count)
        
        # Also update max_log_id cache to prevent false "data inconsistent" warnings
        self._set_state("cached_max_log_id", max_log_id)
        self._set_state("cached_max_log_id_time", now)

        logger.analytics(f"日志处理完成", processed=processed_count, last_id=max_log_id)

        return {
            "success": True,
            "processed": processed_count,
            "last_log_id": max_log_id,
            "users_updated": len(user_stats),
            "models_updated": len(model_stats),
        }

    def get_user_request_ranking(self, limit: int = 10) -> List[UserRanking]:
        """
        Get top users by request count.

        Args:
            limit: Number of users to return.

        Returns:
            List of UserRanking sorted by request_count descending.
        """
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT user_id, username, request_count, quota_used
                FROM user_rankings
                ORDER BY request_count DESC
                LIMIT ?
            """, (limit,))
            rows = cursor.fetchall()

        return [
            UserRanking(
                user_id=row[0],
                username=row[1],
                request_count=row[2],
                quota_used=row[3],
            )
            for row in rows
        ]

    def get_user_quota_ranking(self, limit: int = 10) -> List[UserRanking]:
        """
        Get top users by quota consumption.

        Args:
            limit: Number of users to return.

        Returns:
            List of UserRanking sorted by quota_used descending.
        """
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT user_id, username, request_count, quota_used
                FROM user_rankings
                ORDER BY quota_used DESC
                LIMIT ?
            """, (limit,))
            rows = cursor.fetchall()

        return [
            UserRanking(
                user_id=row[0],
                username=row[1],
                request_count=row[2],
                quota_used=row[3],
            )
            for row in rows
        ]

    def get_model_statistics(self, limit: int = 20) -> List[ModelStats]:
        """
        Get model statistics including success rate and empty response rate.

        Success rate = success_count / total_requests (type=2 / (type=2 + type=5))
        Empty rate = empty_count / success_count (empty responses within successful requests)

        Args:
            limit: Number of models to return.

        Returns:
            List of ModelStats sorted by total_requests descending.
        """
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT model_name, total_requests, success_count, failure_count, empty_count
                FROM model_stats
                ORDER BY total_requests DESC
                LIMIT ?
            """, (limit,))
            rows = cursor.fetchall()

        result = []
        for row in rows:
            model_name = row[0]
            total = row[1]
            success = row[2]
            failure = row[3] or 0
            empty = row[4]

            # Success rate = success / total (type=2 / (type=2 + type=5))
            success_rate = (success / total * 100) if total > 0 else 0.0
            # Empty rate = empty / success (空回复占成功请求的比例)
            empty_rate = (empty / success * 100) if success > 0 else 0.0

            result.append(ModelStats(
                model_name=model_name,
                total_requests=total,
                success_count=success,
                failure_count=failure,
                empty_count=empty,
                success_rate=round(success_rate, 2),
                empty_rate=round(empty_rate, 2),
            ))

        return result

    def get_summary(self) -> Dict[str, Any]:
        """
        Get analytics summary.

        Returns:
            Summary including state, top users, and model stats.
        """
        state = self.get_analytics_state()
        request_ranking = self.get_user_request_ranking(10)
        quota_ranking = self.get_user_quota_ranking(10)
        model_stats = self.get_model_statistics(20)

        return {
            "state": asdict(state),
            "user_request_ranking": [asdict(u) for u in request_ranking],
            "user_quota_ranking": [asdict(u) for u in quota_ranking],
            "model_statistics": [asdict(m) for m in model_stats],
        }

    def reset_analytics(self) -> Dict[str, Any]:
        """
        Reset all analytics data.
        Use with caution - this will clear all accumulated statistics.

        Returns:
            Result of the reset operation.
        """
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM analytics_state")
            cursor.execute("DELETE FROM user_rankings")
            cursor.execute("DELETE FROM model_stats")
            conn.commit()

        logger.analytics("分析数据已重置")
        return {"success": True, "message": "Analytics data reset successfully"}

    def _get_dynamic_batch_config(self, total_logs: int = 0) -> tuple[int, int]:
        """
        Get dynamic batch size and max iterations based on total logs count.
        
        Args:
            total_logs: Total number of logs to process. If 0, will fetch from cache.
            
        Returns:
            Tuple of (batch_size, max_iterations)
        """
        if total_logs <= 0:
            total_logs = self.get_total_logs_count()
        
        for (min_logs, max_logs), (batch_size, max_iter) in BATCH_CONFIG.items():
            if min_logs <= total_logs < max_logs:
                return batch_size, max_iter
        
        return DEFAULT_BATCH_SIZE, DEFAULT_MAX_ITERATIONS

    def get_total_logs_count(self, use_cache: bool = True) -> int:
        """
        Get total count of logs (success + failure) in the main database.
        Only counts type=2 (success) and type=5 (failure) logs.
        Uses cached value to avoid expensive COUNT(*) on large tables.

        Args:
            use_cache: If True, return cached value if available and fresh (within 10 minutes).

        Returns:
            Total number of logs with type=2 or type=5.
        """
        cache_key = "cached_total_logs_count"
        cache_time_key = "cached_total_logs_count_time"
        cache_ttl = 600  # 10 minutes (increased for stability)

        if use_cache:
            cached_count = self._get_state(cache_key, 0)
            cached_time = self._get_state(cache_time_key, 0)
            now = int(time.time())
            if cached_count > 0 and (now - cached_time) < cache_ttl:
                return cached_count

        # IMPORTANT: Always use exact count with type filter.
        # Previously used information_schema/pg_stat approximate counts which
        # include ALL log types, causing progress to never reach 100% because
        # we only process type=2 and type=5 logs.
        try:
            self._db.connect()

            # Use exact count with type filter - this is the only accurate way
            # The result is cached for 10 minutes to avoid repeated expensive queries
            sql = "SELECT COUNT(*) as cnt FROM logs WHERE type IN (:type_success, :type_failure)"
            result = self._db.execute(sql, {
                "type_success": LOG_TYPE_CONSUMPTION,
                "type_failure": LOG_TYPE_FAILURE,
            })
            count = int(result[0]["cnt"]) if result else 0
            self._set_state(cache_key, count)
            self._set_state(cache_time_key, int(time.time()))
            logger.analytics(f"日志精确统计: type=2/5 共 {count} 条")
            return count
        except Exception as e:
            logger.db_error(f"获取日志总数失败: {e}")
            # Return cached value on error
            return self._get_state(cache_key, 0)

    def get_max_log_id(self, use_cache: bool = True) -> int:
        """
        Get the maximum log ID in the main database.
        Uses cached value to avoid expensive query on large tables.

        Args:
            use_cache: If True, return cached value if available and fresh (within 60 seconds).

        Returns:
            Maximum log ID for type=2 or type=5.
        """
        cache_key = "cached_max_log_id"
        cache_time_key = "cached_max_log_id_time"
        cache_ttl = 60  # 1 minute (shorter TTL for max_id as it changes more frequently)

        if use_cache:
            cached_id = self._get_state(cache_key, 0)
            cached_time = self._get_state(cache_time_key, 0)
            now = int(time.time())
            if cached_id > 0 and (now - cached_time) < cache_ttl:
                return cached_id

        # MAX(id) on primary key is fast, but we still cache it
        # to reduce database load under high concurrency
        sql = "SELECT MAX(id) as max_id FROM logs"
        try:
            self._db.connect()
            result = self._db.execute(sql, {})
            max_id = int(result[0]["max_id"]) if result and result[0]["max_id"] else 0
            self._set_state(cache_key, max_id)
            self._set_state(cache_time_key, int(time.time()))
            return max_id
        except Exception as e:
            logger.db_error(f"获取最大日志ID失败: {e}")
            return self._get_state(cache_key, 0)

    def batch_process(
        self,
        max_iterations: Optional[int] = None,
        batch_size: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Process multiple batches of logs continuously.
        Useful for initial sync of large log datasets.
        
        Batch size and iterations are dynamically adjusted based on total logs:
        - < 10K logs: 1K/batch, max 20 iterations
        - 10K-100K: 2K/batch, max 50 iterations  
        - 100K-1M: 5K/batch, max 100 iterations
        - 1M-10M: 10K/batch, max 150 iterations
        - > 10M: 20K/batch, max 200 iterations

        Args:
            max_iterations: Override max iterations (optional, uses dynamic config if None).
            batch_size: Override batch size (optional, uses dynamic config if None).

        Returns:
            Processing result with total processed count and progress info.
        """
        start_time = time.time()
        total_processed = 0
        iterations = 0
        timeout_seconds = 30  # Single call timeout protection

        # Get or set the initialization cutoff point
        init_max_log_id = self._get_state("init_max_log_id", 0)
        if init_max_log_id == 0:
            # First time batch processing - set the cutoff point
            init_max_log_id = self.get_max_log_id(use_cache=False)
            self._set_state("init_max_log_id", init_max_log_id)
            logger.analytics("设置初始化截止点", cutoff_id=init_max_log_id)

        # Get dynamic batch config based on total logs
        total_logs = self.get_total_logs_count()
        dynamic_batch_size, dynamic_max_iter = self._get_dynamic_batch_config(total_logs)
        
        # Use provided values or dynamic defaults
        actual_batch_size = batch_size if batch_size is not None else dynamic_batch_size
        actual_max_iter = max_iterations if max_iterations is not None else dynamic_max_iter
        
        logger.analytics(
            "开始批量处理",
            total_logs=total_logs,
            batch_size=actual_batch_size,
            max_iterations=actual_max_iter
        )

        timed_out = False
        while iterations < actual_max_iter:
            # Timeout protection: prevent single API call from running too long
            elapsed = time.time() - start_time
            if elapsed >= timeout_seconds:
                timed_out = True
                logger.analytics(
                    f"批量处理超时保护触发",
                    elapsed=f"{elapsed:.1f}s",
                    timeout=f"{timeout_seconds}s",
                    iterations=iterations,
                    processed=total_processed
                )
                break

            result = self._process_logs_with_cutoff(init_max_log_id, actual_batch_size)

            if not result.get("success"):
                logger.db_error(f"批量处理迭代失败: {result.get('error', 'unknown')}")
                break

            processed = result.get("processed", 0)
            if processed == 0:
                # No more logs to process (within cutoff)
                # Clear the init cutoff since we're done
                self._clear_init_cutoff()
                break

            total_processed += processed
            iterations += 1

        elapsed_time = time.time() - start_time
        current_log_id = self._get_state("last_log_id", 0)

        # Check if init cutoff was cleared (sync completed)
        current_init_cutoff = self._get_state("init_max_log_id", 0)
        
        # Calculate progress based on init cutoff
        progress = 0.0
        remaining = 0
        completed = False
        
        if current_init_cutoff == 0 and init_max_log_id > 0:
            # Init cutoff was cleared, sync is complete
            progress = 100.0
            completed = True
            remaining = 0
        elif init_max_log_id > 0:
            if current_log_id >= init_max_log_id:
                progress = 100.0
                completed = True
            else:
                progress = (current_log_id / init_max_log_id) * 100
            remaining = max(0, init_max_log_id - current_log_id)

        return {
            "success": True,
            "total_processed": total_processed,
            "iterations": iterations,
            "batch_size": actual_batch_size,
            "elapsed_seconds": round(elapsed_time, 2),
            "logs_per_second": round(total_processed / elapsed_time, 1) if elapsed_time > 0 else 0,
            "progress_percent": round(progress, 2),
            "remaining_logs": remaining,
            "last_log_id": current_log_id,
            "init_cutoff_id": current_init_cutoff if current_init_cutoff > 0 else None,
            "completed": completed,
            "timed_out": timed_out,
        }

    def _process_logs_with_cutoff(self, max_log_id: int, batch_size: int = DEFAULT_BATCH_SIZE) -> Dict[str, Any]:
        """
        Process logs with a cutoff ID limit.
        Only processes logs with id <= max_log_id.

        Args:
            max_log_id: Maximum log ID to process.
            batch_size: Number of logs to fetch per batch.

        Returns:
            Processing result.
        """
        last_log_id = self._get_state("last_log_id", 0)
        total_processed = self._get_state("total_processed", 0)

        # Optimized query: use FORCE INDEX hint for MySQL, or rely on idx_logs_id_type
        # The key optimization is using id range scan which is very fast on primary key
        sql = """
            SELECT
                id, user_id, username, model_name, quota,
                prompt_tokens, completion_tokens, type
            FROM logs
            WHERE id > :last_id AND id <= :max_id AND type IN (:type_success, :type_failure)
            ORDER BY id ASC
            LIMIT :limit
        """

        try:
            self._db.connect()
            logs = self._db.execute(sql, {
                "last_id": last_log_id,
                "max_id": max_log_id,
                "type_success": LOG_TYPE_CONSUMPTION,
                "type_failure": LOG_TYPE_FAILURE,
                "limit": batch_size,
            })
        except Exception as e:
            logger.db_error(f"获取日志失败: {e}")
            return {"success": False, "error": str(e), "processed": 0}

        if not logs:
            return {"success": True, "processed": 0}

        # Process logs (same as process_new_logs)
        user_stats: Dict[int, Dict[str, Any]] = {}
        model_stats: Dict[str, Dict[str, int]] = {}
        new_last_log_id = last_log_id

        for log in logs:
            log_id = log["id"]
            user_id = log.get("user_id")
            username = log.get("username") or f"User#{user_id}"
            model_name = log.get("model_name") or "unknown"
            quota = int(log.get("quota") or 0)
            completion_tokens = int(log.get("completion_tokens") or 0)

            new_last_log_id = max(new_last_log_id, log_id)

            if user_id:
                if user_id not in user_stats:
                    user_stats[user_id] = {
                        "username": username,
                        "request_count": 0,
                        "quota_used": 0,
                    }
                user_stats[user_id]["request_count"] += 1
                user_stats[user_id]["quota_used"] += quota

            # Aggregate model statistics
            log_type = int(log.get("type") or 0)
            if model_name not in model_stats:
                model_stats[model_name] = {
                    "total_requests": 0,
                    "success_count": 0,
                    "failure_count": 0,
                    "empty_count": 0,
                }
            model_stats[model_name]["total_requests"] += 1

            # Success/Failure based on log type
            if log_type == LOG_TYPE_CONSUMPTION:
                # type=2: successful request
                model_stats[model_name]["success_count"] += 1
                # Empty = no output tokens (空回复)
                if completion_tokens == 0:
                    model_stats[model_name]["empty_count"] += 1
            elif log_type == LOG_TYPE_FAILURE:
                # type=5: failed request
                model_stats[model_name]["failure_count"] += 1

        # Batch update SQLite for better performance
        now = int(time.time())
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()

            # Use executemany for batch inserts (much faster than individual inserts)
            user_data = [
                (user_id, stats["username"], stats["request_count"], stats["quota_used"], now)
                for user_id, stats in user_stats.items()
            ]
            if user_data:
                cursor.executemany("""
                    INSERT INTO user_rankings (user_id, username, request_count, quota_used, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        username = excluded.username,
                        request_count = user_rankings.request_count + excluded.request_count,
                        quota_used = user_rankings.quota_used + excluded.quota_used,
                        updated_at = excluded.updated_at
                """, user_data)

            model_data = [
                (model_name, stats["total_requests"], stats["success_count"], 
                 stats["failure_count"], stats["empty_count"], now)
                for model_name, stats in model_stats.items()
            ]
            if model_data:
                cursor.executemany("""
                    INSERT INTO model_stats (model_name, total_requests, success_count, failure_count, empty_count, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(model_name) DO UPDATE SET
                        total_requests = model_stats.total_requests + excluded.total_requests,
                        success_count = model_stats.success_count + excluded.success_count,
                        failure_count = model_stats.failure_count + excluded.failure_count,
                        empty_count = model_stats.empty_count + excluded.empty_count,
                        updated_at = excluded.updated_at
                """, model_data)

            conn.commit()

        processed_count = len(logs)
        self._set_state("last_log_id", new_last_log_id)
        self._set_state("last_processed_at", now)
        self._set_state("total_processed", total_processed + processed_count)
        
        # Also update max_log_id cache to prevent false "data inconsistent" warnings
        self._set_state("cached_max_log_id", new_last_log_id)
        self._set_state("cached_max_log_id_time", now)

        return {"success": True, "processed": processed_count}

    def _clear_init_cutoff(self):
        """Clear the initialization cutoff after sync is complete."""
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM analytics_state WHERE key = 'init_max_log_id'")
            conn.commit()
        logger.analytics("初始化同步完成，已清除截止点")

    def get_sync_status(self) -> Dict[str, Any]:
        """
        Get synchronization status between main database and local analytics.

        Returns:
            Sync status with progress information.
        """
        last_log_id = self._get_state("last_log_id", 0)
        total_processed = self._get_state("total_processed", 0)
        init_max_log_id = self._get_state("init_max_log_id", 0)
        
        # Use cached values for display (fast)
        max_log_id = self.get_max_log_id()
        total_logs = self.get_total_logs_count()

        # For consistency check, only flag as inconsistent if the difference is significant
        # Small differences can occur due to cache lag, so allow a small tolerance
        # Only consider inconsistent if last_log_id is MORE than 100 ahead of cached max_log_id
        # This prevents false positives from cache staleness
        data_inconsistent = max_log_id > 0 and last_log_id > max_log_id + 100

        # If in initialization mode, use init_max_log_id for progress
        is_initializing = init_max_log_id > 0

        # Calculate progress
        progress = 0.0
        remaining = 0
        if not data_inconsistent:
            if is_initializing:
                # During initialization: use log ID-based progress (more accurate)
                # because total_logs count may still be approximate
                if init_max_log_id > 0:
                    if last_log_id >= init_max_log_id:
                        progress = 100.0
                    else:
                        progress = (last_log_id / init_max_log_id) * 100
                    remaining = max(0, init_max_log_id - last_log_id)
            elif total_logs > 0:
                # Normal mode: use precise processed count vs actual type=2/5 count
                if total_processed >= total_logs:
                    progress = 100.0
                else:
                    progress = (total_processed / total_logs) * 100
                remaining = max(0, total_logs - total_processed)

        # is_synced: data has been fully synchronized
        # - progress >= 95% (allow some new logs to come in)
        # - OR last_log_id is close to max_log_id (within 100)
        # - not in init mode
        # - no data inconsistency
        id_based_synced = (max_log_id > 0 and last_log_id > 0 and 
                          last_log_id >= max_log_id - 100)
        is_synced = ((progress >= 95.0 or id_based_synced) and 
                    not is_initializing and not data_inconsistent)

        # Determine if initial sync is needed:
        # - 从未处理过任何日志，或者
        # - 进度低于 95% 且不在初始化模式中（需要用户手动触发初始化）
        needs_initial_sync = (total_logs > 0) and (not is_synced) and (not is_initializing)

        return {
            "last_log_id": last_log_id,
            "max_log_id": max_log_id,
            "init_cutoff_id": init_max_log_id if is_initializing else None,
            "total_logs_in_db": total_logs,
            "total_processed": total_processed,
            "progress_percent": round(progress, 2),
            "remaining_logs": remaining,
            "is_synced": is_synced,
            "is_initializing": is_initializing,
            "needs_initial_sync": needs_initial_sync,
            "data_inconsistent": data_inconsistent,
            "needs_reset": data_inconsistent,
        }

    def check_and_auto_reset(self) -> Dict[str, Any]:
        """
        Check data consistency and auto-reset if logs have been deleted.

        Returns:
            Result of the check/reset operation.
        """
        last_log_id = self._get_state("last_log_id", 0)
        # IMPORTANT: Use fresh max_log_id (no cache) for consistency check
        # to avoid false positives when cache is stale
        max_log_id = self.get_max_log_id(use_cache=False)

        if last_log_id > 0 and max_log_id > 0 and last_log_id > max_log_id:
            # Data is inconsistent - logs have been deleted
            logger.security(
                "检测到数据不一致，日志可能已被删除",
                last_log_id=last_log_id,
                max_log_id=max_log_id
            )
            self.reset_analytics()
            return {
                "reset": True,
                "reason": "Logs deleted or database reset detected",
                "old_last_log_id": last_log_id,
                "current_max_log_id": max_log_id,
            }

        return {
            "reset": False,
            "reason": "Data is consistent",
        }


# Global instance
_log_analytics_service: Optional[LogAnalyticsService] = None


def get_log_analytics_service() -> LogAnalyticsService:
    """Get or create the global LogAnalyticsService instance."""
    global _log_analytics_service
    if _log_analytics_service is None:
        _log_analytics_service = LogAnalyticsService()
    return _log_analytics_service

"""
Log Analytics Service for NewAPI Middleware Tool.
Implements incremental log processing for user rankings and model statistics.
"""
import logging
import time
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional

from .database import get_db_manager
from .local_storage import get_local_storage

logger = logging.getLogger(__name__)

# Constants
BATCH_SIZE = 1000  # Number of logs to process per batch
LOG_TYPE_CONSUMPTION = 2  # type=2 is consumption/usage log


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
    total_requests: int
    success_count: int
    empty_count: int  # completion_tokens = 0
    success_rate: float  # percentage
    empty_rate: float  # percentage


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
                    empty_count INTEGER DEFAULT 0,
                    updated_at INTEGER NOT NULL
                )
            """)

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
        Fetches BATCH_SIZE logs from the main database and updates local statistics.

        Returns:
            Processing result with count of processed logs.
        """
        last_log_id = self._get_state("last_log_id", 0)
        total_processed = self._get_state("total_processed", 0)

        # Fetch new logs from main database
        sql = """
            SELECT
                id, user_id, username, model_name, quota,
                prompt_tokens, completion_tokens, type
            FROM logs
            WHERE id > :last_id AND type = :log_type
            ORDER BY id ASC
            LIMIT :limit
        """

        try:
            self._db.connect()
            logs = self._db.execute(sql, {
                "last_id": last_log_id,
                "log_type": LOG_TYPE_CONSUMPTION,
                "limit": BATCH_SIZE,
            })
        except Exception as e:
            logger.error(f"Failed to fetch logs: {e}")
            return {"success": False, "error": str(e), "processed": 0}

        if not logs:
            return {"success": True, "processed": 0, "message": "No new logs to process"}

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
            if model_name not in model_stats:
                model_stats[model_name] = {
                    "total_requests": 0,
                    "success_count": 0,
                    "empty_count": 0,
                }
            model_stats[model_name]["total_requests"] += 1
            # Success = has completion tokens
            if completion_tokens > 0:
                model_stats[model_name]["success_count"] += 1
            else:
                model_stats[model_name]["empty_count"] += 1

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
                    INSERT INTO model_stats (model_name, total_requests, success_count, empty_count, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(model_name) DO UPDATE SET
                        total_requests = model_stats.total_requests + excluded.total_requests,
                        success_count = model_stats.success_count + excluded.success_count,
                        empty_count = model_stats.empty_count + excluded.empty_count,
                        updated_at = excluded.updated_at
                """, (
                    model_name,
                    stats["total_requests"],
                    stats["success_count"],
                    stats["empty_count"],
                    now,
                ))

            conn.commit()

        # Update processing state
        processed_count = len(logs)
        self._set_state("last_log_id", max_log_id)
        self._set_state("last_processed_at", now)
        self._set_state("total_processed", total_processed + processed_count)

        logger.info(f"Processed {processed_count} logs, last_id: {max_log_id}")

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

        Args:
            limit: Number of models to return.

        Returns:
            List of ModelStats sorted by total_requests descending.
        """
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT model_name, total_requests, success_count, empty_count
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
            empty = row[3]

            success_rate = (success / total * 100) if total > 0 else 0.0
            empty_rate = (empty / total * 100) if total > 0 else 0.0

            result.append(ModelStats(
                model_name=model_name,
                total_requests=total,
                success_count=success,
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

        logger.warning("Analytics data has been reset")
        return {"success": True, "message": "Analytics data reset successfully"}

    def get_total_logs_count(self) -> int:
        """
        Get total count of consumption logs in the main database.

        Returns:
            Total number of logs with type=2.
        """
        sql = "SELECT COUNT(*) as cnt FROM logs WHERE type = :log_type"
        try:
            self._db.connect()
            result = self._db.execute(sql, {"log_type": LOG_TYPE_CONSUMPTION})
            return int(result[0]["cnt"]) if result else 0
        except Exception as e:
            logger.error(f"Failed to get logs count: {e}")
            return 0

    def get_max_log_id(self) -> int:
        """
        Get the maximum log ID in the main database.

        Returns:
            Maximum log ID.
        """
        sql = "SELECT MAX(id) as max_id FROM logs WHERE type = :log_type"
        try:
            self._db.connect()
            result = self._db.execute(sql, {"log_type": LOG_TYPE_CONSUMPTION})
            return int(result[0]["max_id"]) if result and result[0]["max_id"] else 0
        except Exception as e:
            logger.error(f"Failed to get max log id: {e}")
            return 0

    def batch_process(
        self,
        max_iterations: int = 100,
        batch_size: int = BATCH_SIZE,
    ) -> Dict[str, Any]:
        """
        Process multiple batches of logs continuously.
        Useful for initial sync of large log datasets.

        Args:
            max_iterations: Maximum number of batches to process (default 100).
            batch_size: Number of logs per batch (default 1000).

        Returns:
            Processing result with total processed count and progress info.
        """
        start_time = time.time()
        total_processed = 0
        iterations = 0

        # Get or set the initialization cutoff point
        # This ensures we only process logs up to this point during initial sync
        init_max_log_id = self._get_state("init_max_log_id", 0)
        if init_max_log_id == 0:
            # First time batch processing - set the cutoff point
            init_max_log_id = self.get_max_log_id()
            self._set_state("init_max_log_id", init_max_log_id)
            logger.info(f"Set initialization cutoff at log_id: {init_max_log_id}")

        while iterations < max_iterations:
            result = self._process_logs_with_cutoff(init_max_log_id)

            if not result.get("success"):
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
            "elapsed_seconds": round(elapsed_time, 2),
            "logs_per_second": round(total_processed / elapsed_time, 1) if elapsed_time > 0 else 0,
            "progress_percent": round(progress, 2),
            "remaining_logs": remaining,
            "last_log_id": current_log_id,
            "init_cutoff_id": current_init_cutoff if current_init_cutoff > 0 else None,
            "completed": completed,
        }

    def _process_logs_with_cutoff(self, max_log_id: int) -> Dict[str, Any]:
        """
        Process logs with a cutoff ID limit.
        Only processes logs with id <= max_log_id.

        Args:
            max_log_id: Maximum log ID to process.

        Returns:
            Processing result.
        """
        last_log_id = self._get_state("last_log_id", 0)
        total_processed = self._get_state("total_processed", 0)

        # Fetch new logs with cutoff
        sql = """
            SELECT
                id, user_id, username, model_name, quota,
                prompt_tokens, completion_tokens, type
            FROM logs
            WHERE id > :last_id AND id <= :max_id AND type = :log_type
            ORDER BY id ASC
            LIMIT :limit
        """

        try:
            self._db.connect()
            logs = self._db.execute(sql, {
                "last_id": last_log_id,
                "max_id": max_log_id,
                "log_type": LOG_TYPE_CONSUMPTION,
                "limit": BATCH_SIZE,
            })
        except Exception as e:
            logger.error(f"Failed to fetch logs: {e}")
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

            if model_name not in model_stats:
                model_stats[model_name] = {
                    "total_requests": 0,
                    "success_count": 0,
                    "empty_count": 0,
                }
            model_stats[model_name]["total_requests"] += 1
            if completion_tokens > 0:
                model_stats[model_name]["success_count"] += 1
            else:
                model_stats[model_name]["empty_count"] += 1

        # Update SQLite
        now = int(time.time())
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()

            for user_id, stats in user_stats.items():
                cursor.execute("""
                    INSERT INTO user_rankings (user_id, username, request_count, quota_used, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        username = excluded.username,
                        request_count = user_rankings.request_count + excluded.request_count,
                        quota_used = user_rankings.quota_used + excluded.quota_used,
                        updated_at = excluded.updated_at
                """, (user_id, stats["username"], stats["request_count"], stats["quota_used"], now))

            for model_name, stats in model_stats.items():
                cursor.execute("""
                    INSERT INTO model_stats (model_name, total_requests, success_count, empty_count, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(model_name) DO UPDATE SET
                        total_requests = model_stats.total_requests + excluded.total_requests,
                        success_count = model_stats.success_count + excluded.success_count,
                        empty_count = model_stats.empty_count + excluded.empty_count,
                        updated_at = excluded.updated_at
                """, (model_name, stats["total_requests"], stats["success_count"], stats["empty_count"], now))

            conn.commit()

        processed_count = len(logs)
        self._set_state("last_log_id", new_last_log_id)
        self._set_state("last_processed_at", now)
        self._set_state("total_processed", total_processed + processed_count)

        return {"success": True, "processed": processed_count}

    def _clear_init_cutoff(self):
        """Clear the initialization cutoff after sync is complete."""
        with self._storage._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM analytics_state WHERE key = 'init_max_log_id'")
            conn.commit()
        logger.info("Cleared initialization cutoff - sync complete")

    def get_sync_status(self) -> Dict[str, Any]:
        """
        Get synchronization status between main database and local analytics.

        Returns:
            Sync status with progress information.
        """
        last_log_id = self._get_state("last_log_id", 0)
        total_processed = self._get_state("total_processed", 0)
        init_max_log_id = self._get_state("init_max_log_id", 0)
        max_log_id = self.get_max_log_id()
        total_logs = self.get_total_logs_count()

        # Detect if logs have been deleted/reset
        # If max_log_id in DB is less than our last_log_id, data is inconsistent
        data_inconsistent = max_log_id > 0 and last_log_id > max_log_id

        # If in initialization mode, use init_max_log_id for progress
        target_log_id = init_max_log_id if init_max_log_id > 0 else max_log_id
        is_initializing = init_max_log_id > 0

        # Calculate progress
        progress = 0.0
        remaining = 0
        if target_log_id > 0 and not data_inconsistent:
            if last_log_id >= target_log_id:
                progress = 100.0
            else:
                progress = (last_log_id / target_log_id) * 100
            remaining = max(0, target_log_id - last_log_id)

        return {
            "last_log_id": last_log_id,
            "max_log_id": max_log_id,
            "init_cutoff_id": init_max_log_id if is_initializing else None,
            "total_logs_in_db": total_logs,
            "total_processed": total_processed,
            "progress_percent": round(progress, 2),
            "remaining_logs": remaining,
            "is_synced": last_log_id >= max_log_id and not is_initializing and not data_inconsistent,
            "is_initializing": is_initializing,
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
        max_log_id = self.get_max_log_id()

        if last_log_id > 0 and max_log_id > 0 and last_log_id > max_log_id:
            # Data is inconsistent - logs have been deleted
            logger.warning(
                f"Data inconsistency detected: last_log_id={last_log_id}, max_log_id={max_log_id}. "
                "Logs appear to have been deleted. Resetting analytics."
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

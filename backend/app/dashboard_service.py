"""
Dashboard Service module for NewAPI Middleware Tool.
Handles system overview statistics, usage monitoring, and trend analysis.
"""
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from .database import DatabaseManager, get_db_manager

logger = logging.getLogger(__name__)


@dataclass
class SystemOverview:
    """System overview statistics."""
    total_users: int
    active_users: int  # Users with quota > 0
    total_tokens: int
    active_tokens: int  # Tokens with status = 1
    total_channels: int
    active_channels: int  # Channels with status = 1
    total_models: int
    total_redemptions: int
    unused_redemptions: int


@dataclass
class UsageStatistics:
    """Usage statistics for a time period."""
    total_requests: int
    total_quota_used: int
    total_prompt_tokens: int
    total_completion_tokens: int
    average_response_time: float  # in ms


@dataclass
class ModelUsage:
    """Model usage data."""
    model_name: str
    request_count: int
    quota_used: int
    prompt_tokens: int
    completion_tokens: int


@dataclass
class DailyTrend:
    """Daily usage trend data."""
    date: str
    request_count: int
    quota_used: int
    unique_users: int


@dataclass
class UserRanking:
    """User ranking by usage."""
    user_id: int
    username: str
    request_count: int
    quota_used: int


class DashboardService:
    """
    Service for dashboard analytics.
    Handles system overview, usage statistics, and trend analysis.
    """

    def __init__(self, db: Optional[DatabaseManager] = None):
        """Initialize DashboardService."""
        self._db = db

    @property
    def db(self) -> DatabaseManager:
        """Get database manager."""
        if self._db is None:
            self._db = get_db_manager()
        return self._db

    def get_system_overview(self) -> SystemOverview:
        """
        Get system overview statistics.

        Returns:
            SystemOverview with counts of users, tokens, channels, etc.
        """
        # Get user counts - active users = users with requests in last 7 days
        now = int(time.time())
        seven_days_ago = now - 7 * 24 * 3600

        user_sql = """
            SELECT
                COUNT(*) as total,
                COUNT(DISTINCT CASE
                    WHEN id IN (
                        SELECT DISTINCT user_id FROM logs
                        WHERE created_at >= :seven_days_ago AND type = 2 AND user_id IS NOT NULL
                    ) THEN id
                END) as active
            FROM users
            WHERE deleted_at IS NULL
        """
        user_result = self.db.execute(user_sql, {"seven_days_ago": seven_days_ago})
        user_row = user_result[0] if user_result else {}

        # Get token counts
        token_sql = """
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active
            FROM tokens
            WHERE deleted_at IS NULL
        """
        token_result = self.db.execute(token_sql)
        token_row = token_result[0] if token_result else {}

        # Get channel counts
        channel_sql = """
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active
            FROM channels
        """
        channel_result = self.db.execute(channel_sql)
        channel_row = channel_result[0] if channel_result else {}

        # Get model count from abilities table (unique models across all channels)
        model_sql = "SELECT COUNT(DISTINCT model) as total FROM abilities"
        try:
            model_result = self.db.execute(model_sql)
            model_count = model_result[0]["total"] if model_result else 0
        except Exception:
            # Fallback: try models table if abilities doesn't exist
            try:
                model_sql = "SELECT COUNT(*) as total FROM models WHERE deleted_at IS NULL"
                model_result = self.db.execute(model_sql)
                model_count = model_result[0]["total"] if model_result else 0
            except Exception:
                model_count = 0

        # Get redemption counts
        redemption_sql = """
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN redeemed_time = 0 OR redeemed_time IS NULL THEN 1 ELSE 0 END) as unused
            FROM redemptions
            WHERE deleted_at IS NULL
        """
        redemption_result = self.db.execute(redemption_sql)
        redemption_row = redemption_result[0] if redemption_result else {}

        return SystemOverview(
            total_users=int(user_row.get("total", 0) or 0),
            active_users=int(user_row.get("active", 0) or 0),
            total_tokens=int(token_row.get("total", 0) or 0),
            active_tokens=int(token_row.get("active", 0) or 0),
            total_channels=int(channel_row.get("total", 0) or 0),
            active_channels=int(channel_row.get("active", 0) or 0),
            total_models=int(model_count or 0),
            total_redemptions=int(redemption_row.get("total", 0) or 0),
            unused_redemptions=int(redemption_row.get("unused", 0) or 0),
        )

    def get_usage_statistics(
        self,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
    ) -> UsageStatistics:
        """
        Get usage statistics for a time period.

        Args:
            start_time: Start timestamp (defaults to 24 hours ago).
            end_time: End timestamp (defaults to now).

        Returns:
            UsageStatistics with aggregated usage data.
        """
        if end_time is None:
            end_time = int(time.time())
        if start_time is None:
            start_time = end_time - 86400  # 24 hours ago

        sql = """
            SELECT
                COUNT(*) as total_requests,
                COALESCE(SUM(quota), 0) as total_quota,
                COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) as completion_tokens,
                COALESCE(AVG(use_time), 0) as avg_time
            FROM logs
            WHERE created_at >= :start_time AND created_at <= :end_time
                AND type = 2
        """
        result = self.db.execute(sql, {"start_time": start_time, "end_time": end_time})
        row = result[0] if result else {}

        return UsageStatistics(
            total_requests=int(row.get("total_requests", 0) or 0),
            total_quota_used=int(row.get("total_quota", 0) or 0),
            total_prompt_tokens=int(row.get("prompt_tokens", 0) or 0),
            total_completion_tokens=int(row.get("completion_tokens", 0) or 0),
            average_response_time=float(row.get("avg_time", 0) or 0),
        )

    def get_model_usage(
        self,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
        limit: int = 10,
    ) -> List[ModelUsage]:
        """
        Get model usage distribution.

        Args:
            start_time: Start timestamp.
            end_time: End timestamp.
            limit: Maximum number of models to return.

        Returns:
            List of ModelUsage sorted by request count.
        """
        if end_time is None:
            end_time = int(time.time())
        if start_time is None:
            start_time = end_time - 86400 * 7  # 7 days ago

        sql = """
            SELECT
                model_name,
                COUNT(*) as request_count,
                COALESCE(SUM(quota), 0) as quota_used,
                COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) as completion_tokens
            FROM logs
            WHERE created_at >= :start_time AND created_at <= :end_time
                AND type = 2
                AND model_name IS NOT NULL AND model_name != ''
            GROUP BY model_name
            ORDER BY request_count DESC
            LIMIT :limit
        """
        result = self.db.execute(sql, {
            "start_time": start_time,
            "end_time": end_time,
            "limit": limit,
        })

        return [
            ModelUsage(
                model_name=row["model_name"],
                request_count=int(row["request_count"] or 0),
                quota_used=int(row["quota_used"] or 0),
                prompt_tokens=int(row["prompt_tokens"] or 0),
                completion_tokens=int(row["completion_tokens"] or 0),
            )
            for row in result
        ]

    def get_daily_trends(
        self,
        days: int = 7,
    ) -> List[DailyTrend]:
        """
        Get daily usage trends.

        Args:
            days: Number of days to include.

        Returns:
            List of DailyTrend for each day.
        """
        end_time = int(time.time())
        start_time = end_time - (days * 86400)

        # 根据数据库类型选择正确的日期函数
        from .database import DatabaseEngine
        is_pg = self.db.config.engine == DatabaseEngine.POSTGRESQL
        
        if is_pg:
            sql = """
                SELECT
                    DATE(TO_TIMESTAMP(created_at)) as date,
                    COUNT(*) as request_count,
                    COALESCE(SUM(quota), 0) as quota_used,
                    COUNT(DISTINCT user_id) as unique_users
                FROM logs
                WHERE created_at >= :start_time AND created_at <= :end_time
                    AND type = 2
                GROUP BY DATE(TO_TIMESTAMP(created_at))
                ORDER BY date ASC
            """
        else:
            sql = """
                SELECT
                    DATE(FROM_UNIXTIME(created_at)) as date,
                    COUNT(*) as request_count,
                    COALESCE(SUM(quota), 0) as quota_used,
                    COUNT(DISTINCT user_id) as unique_users
                FROM logs
                WHERE created_at >= :start_time AND created_at <= :end_time
                    AND type = 2
                GROUP BY DATE(FROM_UNIXTIME(created_at))
                ORDER BY date ASC
            """

        result = self.db.execute(sql, {"start_time": start_time, "end_time": end_time})

        # Build a dict of existing data
        data_by_date: Dict[str, DailyTrend] = {}
        for row in result:
            date_val = row["date"]
            if isinstance(date_val, datetime):
                date_str = date_val.strftime("%Y-%m-%d")
            else:
                date_str = str(date_val)

            data_by_date[date_str] = DailyTrend(
                date=date_str,
                request_count=int(row["request_count"] or 0),
                quota_used=int(row["quota_used"] or 0),
                unique_users=int(row["unique_users"] or 0),
            )

        # Fill in all dates in the range (including days with no data)
        trends = []
        for i in range(days):
            day_ts = start_time + (i * 86400)
            date_str = datetime.fromtimestamp(day_ts).strftime("%Y-%m-%d")
            if date_str in data_by_date:
                trends.append(data_by_date[date_str])
            else:
                trends.append(DailyTrend(
                    date=date_str,
                    request_count=0,
                    quota_used=0,
                    unique_users=0,
                ))

        return trends

    def get_hourly_trends(self, hours: int = 24) -> List[Dict[str, Any]]:
        """
        Get hourly usage trends.

        Args:
            hours: Number of hours to include.

        Returns:
            List of hourly trend data.
        """
        end_time = int(time.time())
        start_time = end_time - (hours * 3600)

        # Group by hour
        sql = """
            SELECT
                FLOOR(created_at / 3600) * 3600 as hour_ts,
                COUNT(*) as request_count,
                COALESCE(SUM(quota), 0) as quota_used
            FROM logs
            WHERE created_at >= :start_time AND created_at <= :end_time
                AND type = 2
            GROUP BY FLOOR(created_at / 3600)
            ORDER BY hour_ts ASC
        """
        result = self.db.execute(sql, {"start_time": start_time, "end_time": end_time})

        return [
            {
                "hour": datetime.fromtimestamp(int(row["hour_ts"])).strftime("%H:%M"),
                "timestamp": int(row["hour_ts"]),
                "request_count": int(row["request_count"] or 0),
                "quota_used": int(row["quota_used"] or 0),
            }
            for row in result
        ]

    def get_top_users(
        self,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
        limit: int = 10,
    ) -> List[UserRanking]:
        """
        Get top users by usage.

        Args:
            start_time: Start timestamp.
            end_time: End timestamp.
            limit: Maximum number of users to return.

        Returns:
            List of UserRanking sorted by quota usage.
        """
        if end_time is None:
            end_time = int(time.time())
        if start_time is None:
            start_time = end_time - 86400 * 7  # 7 days ago

        # 根据数据库类型选择正确的字符串拼接语法
        from .database import DatabaseEngine
        is_pg = self.db.config.engine == DatabaseEngine.POSTGRESQL
        
        if is_pg:
            username_fallback = "'User#' || l.user_id::text"
        else:
            username_fallback = "CONCAT('User#', l.user_id)"

        sql = f"""
            SELECT
                l.user_id,
                COALESCE(u.username, {username_fallback}) as username,
                COUNT(*) as request_count,
                COALESCE(SUM(l.quota), 0) as quota_used
            FROM logs l
            LEFT JOIN users u ON l.user_id = u.id
            WHERE l.created_at >= :start_time AND l.created_at <= :end_time
                AND l.type = 2
                AND l.user_id IS NOT NULL
            GROUP BY l.user_id, u.username
            ORDER BY quota_used DESC
            LIMIT :limit
        """

        result = self.db.execute(sql, {
            "start_time": start_time,
            "end_time": end_time,
            "limit": limit,
        })

        return [
            UserRanking(
                user_id=int(row["user_id"]),
                username=str(row["username"] or f"User#{row['user_id']}"),
                request_count=int(row["request_count"] or 0),
                quota_used=int(row["quota_used"] or 0),
            )
            for row in result
        ]

    def get_channel_status(self) -> List[Dict[str, Any]]:
        """
        Get channel status overview.

        Returns:
            List of channel status data.
        """
        sql = """
            SELECT
                id,
                name,
                status,
                type,
                balance,
                used_quota,
                response_time,
                test_time
            FROM channels
            ORDER BY status DESC, used_quota DESC
            LIMIT 20
        """
        result = self.db.execute(sql)

        return [
            {
                "id": row["id"],
                "name": row["name"] or f"Channel#{row['id']}",
                "status": int(row["status"] or 0),
                "type": int(row["type"] or 0),
                "balance": float(row["balance"] or 0),
                "used_quota": int(row["used_quota"] or 0),
                "response_time": int(row["response_time"] or 0),
                "last_test": int(row["test_time"] or 0),
            }
            for row in result
        ]


# Global service instance
_dashboard_service: Optional[DashboardService] = None


def get_dashboard_service() -> DashboardService:
    """Get or create the global DashboardService instance."""
    global _dashboard_service
    if _dashboard_service is None:
        _dashboard_service = DashboardService()
    return _dashboard_service


def reset_dashboard_service() -> None:
    """Reset the global DashboardService instance (for testing)."""
    global _dashboard_service
    _dashboard_service = None

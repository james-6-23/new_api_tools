"""
Top Up Service module for NewAPI Middleware Tool.
Handles top up record listing, statistics, and management.
"""
import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, List, Optional

from .database import DatabaseManager, get_db_manager

logger = logging.getLogger(__name__)


class TopUpStatus(str, Enum):
    """Top up status."""
    PENDING = "pending"
    SUCCESS = "success"
    FAILED = "failed"


@dataclass
class TopUpRecord:
    """Top up record data model."""
    id: int
    user_id: int
    username: Optional[str]
    amount: int
    money: float
    trade_no: str
    payment_method: str
    create_time: int
    complete_time: int
    status: TopUpStatus

    @classmethod
    def from_db_row(cls, row: dict[str, Any]) -> "TopUpRecord":
        """Create TopUpRecord from database row."""
        # Parse status
        status_str = str(row.get("status", "")).lower().strip()
        if status_str in ("success", "1", "completed"):
            status = TopUpStatus.SUCCESS
        elif status_str in ("failed", "-1", "error"):
            status = TopUpStatus.FAILED
        else:
            status = TopUpStatus.PENDING

        return cls(
            id=row["id"],
            user_id=row.get("user_id", 0),
            username=row.get("username"),
            amount=row.get("amount", 0),
            money=float(row.get("money", 0) or 0),
            trade_no=row.get("trade_no", "") or "",
            payment_method=row.get("payment_method", "") or "",
            create_time=row.get("create_time", 0) or 0,
            complete_time=row.get("complete_time", 0) or 0,
            status=status,
        )


@dataclass
class TopUpPaginatedResult:
    """Paginated query result for top ups."""
    items: List[TopUpRecord]
    total: int
    page: int
    page_size: int
    total_pages: int


@dataclass
class TopUpStatistics:
    """Top up statistics."""
    total_count: int
    total_amount: int
    total_money: float
    success_count: int
    success_amount: int
    success_money: float
    pending_count: int
    pending_amount: int
    pending_money: float
    failed_count: int
    failed_amount: int
    failed_money: float


@dataclass
class ListTopUpParams:
    """Parameters for listing top ups."""
    page: int = 1
    page_size: int = 20
    user_id: Optional[int] = None
    status: Optional[TopUpStatus] = None
    payment_method: Optional[str] = None
    trade_no: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None

    def validate(self) -> None:
        """Validate parameters."""
        if self.page < 1:
            raise ValueError("Page must be at least 1")
        if self.page_size < 1 or self.page_size > 100:
            raise ValueError("Page size must be between 1 and 100")


class TopUpService:
    """
    Service for managing top up records.
    Handles listing, statistics, and querying of top up records.
    """

    def __init__(self, db: Optional[DatabaseManager] = None):
        """
        Initialize TopUpService.

        Args:
            db: Database manager instance. If None, uses global instance.
        """
        self._db = db

    @property
    def db(self) -> DatabaseManager:
        """Get database manager."""
        if self._db is None:
            self._db = get_db_manager()
        return self._db

    def list_records(self, params: ListTopUpParams) -> TopUpPaginatedResult:
        """
        List top up records with pagination and filtering.

        Args:
            params: List parameters including pagination and filters.

        Returns:
            TopUpPaginatedResult with items and pagination info.
        """
        params.validate()

        # Build WHERE clause
        where_clauses: List[str] = []
        query_params: dict[str, Any] = {}

        if params.user_id is not None:
            where_clauses.append("t.user_id = :user_id")
            query_params["user_id"] = params.user_id

        if params.status:
            if params.status == TopUpStatus.SUCCESS:
                where_clauses.append("(LOWER(t.status) = 'success' OR t.status = '1' OR LOWER(t.status) = 'completed')")
            elif params.status == TopUpStatus.FAILED:
                where_clauses.append("(LOWER(t.status) = 'failed' OR t.status = '-1' OR LOWER(t.status) = 'error')")
            else:
                where_clauses.append("(LOWER(t.status) NOT IN ('success', 'failed', 'completed', 'error') AND t.status NOT IN ('1', '-1'))")

        if params.payment_method:
            where_clauses.append("t.payment_method = :payment_method")
            query_params["payment_method"] = params.payment_method

        if params.trade_no:
            where_clauses.append("t.trade_no LIKE :trade_no")
            query_params["trade_no"] = f"%{params.trade_no}%"

        if params.start_date:
            start_ts = self._parse_date_to_timestamp(params.start_date)
            where_clauses.append("t.create_time >= :start_time")
            query_params["start_time"] = start_ts

        if params.end_date:
            end_ts = self._parse_date_to_timestamp(params.end_date, end_of_day=True)
            where_clauses.append("t.create_time <= :end_time")
            query_params["end_time"] = end_ts

        where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

        # Get total count
        count_sql = f"SELECT COUNT(*) as total FROM top_ups t WHERE {where_sql}"
        count_result = self.db.execute(count_sql, query_params)
        total = count_result[0]["total"] if count_result else 0

        # Calculate pagination
        total_pages = max(1, (total + params.page_size - 1) // params.page_size)
        offset = (params.page - 1) * params.page_size

        # Get items with user info join
        select_sql = f"""
            SELECT t.id, t.user_id, u.username, t.amount, t.money,
                   t.trade_no, t.payment_method, t.create_time, t.complete_time, t.status
            FROM top_ups t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE {where_sql}
            ORDER BY t.create_time DESC
            LIMIT :limit OFFSET :offset
        """
        query_params["limit"] = params.page_size
        query_params["offset"] = offset

        rows = self.db.execute(select_sql, query_params)
        items = [TopUpRecord.from_db_row(row) for row in rows]

        return TopUpPaginatedResult(
            items=items,
            total=total,
            page=params.page,
            page_size=params.page_size,
            total_pages=total_pages,
        )

    def get_statistics(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> TopUpStatistics:
        """
        Get top up statistics.

        Args:
            start_date: Optional start date filter (ISO 8601).
            end_date: Optional end date filter (ISO 8601).

        Returns:
            TopUpStatistics with aggregated data.
        """
        where_clauses: List[str] = []
        query_params: dict[str, Any] = {}

        if start_date:
            start_ts = self._parse_date_to_timestamp(start_date)
            where_clauses.append("create_time >= :start_time")
            query_params["start_time"] = start_ts

        if end_date:
            end_ts = self._parse_date_to_timestamp(end_date, end_of_day=True)
            where_clauses.append("create_time <= :end_time")
            query_params["end_time"] = end_ts

        where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

        # Get overall statistics
        stats_sql = f"""
            SELECT
                COUNT(*) as total_count,
                COALESCE(SUM(amount), 0) as total_amount,
                COALESCE(SUM(money), 0) as total_money,
                SUM(CASE WHEN LOWER(status) IN ('success', 'completed') OR status = '1' THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN LOWER(status) IN ('success', 'completed') OR status = '1' THEN amount ELSE 0 END) as success_amount,
                SUM(CASE WHEN LOWER(status) IN ('success', 'completed') OR status = '1' THEN money ELSE 0 END) as success_money,
                SUM(CASE WHEN LOWER(status) IN ('failed', 'error') OR status = '-1' THEN 1 ELSE 0 END) as failed_count,
                SUM(CASE WHEN LOWER(status) IN ('failed', 'error') OR status = '-1' THEN amount ELSE 0 END) as failed_amount,
                SUM(CASE WHEN LOWER(status) IN ('failed', 'error') OR status = '-1' THEN money ELSE 0 END) as failed_money
            FROM top_ups
            WHERE {where_sql}
        """

        result = self.db.execute(stats_sql, query_params)
        row = result[0] if result else {}

        total_count = int(row.get("total_count", 0) or 0)
        success_count = int(row.get("success_count", 0) or 0)
        failed_count = int(row.get("failed_count", 0) or 0)
        pending_count = total_count - success_count - failed_count
        
        total_amount = int(row.get("total_amount", 0) or 0)
        success_amount = int(row.get("success_amount", 0) or 0)
        failed_amount = int(row.get("failed_amount", 0) or 0)
        pending_amount = total_amount - success_amount - failed_amount
        
        total_money = float(row.get("total_money", 0) or 0)
        success_money = float(row.get("success_money", 0) or 0)
        failed_money = float(row.get("failed_money", 0) or 0)
        pending_money = total_money - success_money - failed_money

        return TopUpStatistics(
            total_count=total_count,
            total_amount=total_amount,
            total_money=total_money,
            success_count=success_count,
            success_amount=success_amount,
            success_money=success_money,
            pending_count=pending_count,
            pending_amount=pending_amount,
            pending_money=pending_money,
            failed_count=failed_count,
            failed_amount=failed_amount,
            failed_money=failed_money,
        )

    def get_payment_methods(self) -> List[str]:
        """
        Get list of distinct payment methods.

        Returns:
            List of payment method names.
        """
        sql = """
            SELECT DISTINCT payment_method
            FROM top_ups
            WHERE payment_method IS NOT NULL AND payment_method != ''
            ORDER BY payment_method
        """
        rows = self.db.execute(sql)
        return [row["payment_method"] for row in rows]

    def get_record_by_id(self, id: int) -> Optional[TopUpRecord]:
        """
        Get a single top up record by ID.

        Args:
            id: Top up record ID.

        Returns:
            TopUpRecord if found, None otherwise.
        """
        sql = """
            SELECT t.id, t.user_id, u.username, t.amount, t.money,
                   t.trade_no, t.payment_method, t.create_time, t.complete_time, t.status
            FROM top_ups t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE t.id = :id
        """
        rows = self.db.execute(sql, {"id": id})

        if not rows:
            return None

        return TopUpRecord.from_db_row(rows[0])

    def _parse_date_to_timestamp(self, date_str: str, end_of_day: bool = False) -> int:
        """Parse date string to Unix timestamp."""
        try:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        except ValueError:
            try:
                dt = datetime.strptime(date_str, "%Y-%m-%d")
                if end_of_day:
                    dt = dt.replace(hour=23, minute=59, second=59)
            except ValueError:
                raise ValueError(f"Invalid date format: {date_str}")
        return int(dt.timestamp())


# Global service instance
_top_up_service: Optional[TopUpService] = None


def get_top_up_service() -> TopUpService:
    """Get or create the global TopUpService instance."""
    global _top_up_service
    if _top_up_service is None:
        _top_up_service = TopUpService()
    return _top_up_service


def reset_top_up_service() -> None:
    """Reset the global TopUpService instance (for testing)."""
    global _top_up_service
    _top_up_service = None

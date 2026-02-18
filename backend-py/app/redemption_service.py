"""
Redemption Service module for NewAPI Middleware Tool.
Handles redemption code generation, listing, and deletion.
"""
import logging
import time
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, List, Optional

from .database import DatabaseManager, DatabaseEngine, get_db_manager
from .expiration_calculator import ExpireMode, calculate_expiration
from .key_generator import KeyGenerator, get_key_generator
from .quota_calculator import QuotaMode, calculate_fixed_quota, calculate_random_quota

logger = logging.getLogger(__name__)


class RedemptionStatus(str, Enum):
    """Redemption code status."""
    UNUSED = "unused"
    USED = "used"
    EXPIRED = "expired"


@dataclass
class RedemptionCode:
    """Redemption code data model."""
    id: int
    key: str
    name: str
    quota: int
    created_time: int
    redeemed_time: int
    used_user_id: int
    used_username: str
    expired_time: int
    status: RedemptionStatus

    @classmethod
    def from_db_row(cls, row: dict[str, Any]) -> "RedemptionCode":
        """Create RedemptionCode from database row."""
        current_time = int(time.time())

        # Handle NULL values from database
        redeemed_time = row.get("redeemed_time") or 0
        expired_time = row.get("expired_time") or 0

        # Determine status
        if redeemed_time > 0:
            status = RedemptionStatus.USED
        elif expired_time > 0 and expired_time < current_time:
            status = RedemptionStatus.EXPIRED
        else:
            status = RedemptionStatus.UNUSED

        return cls(
            id=row["id"],
            key=row["key"],
            name=row.get("name") or "",
            quota=row.get("quota") or 0,
            created_time=row.get("created_time") or 0,
            redeemed_time=redeemed_time,
            used_user_id=row.get("used_user_id") or 0,
            used_username=row.get("used_username") or "",
            expired_time=expired_time,
            status=status,
        )


@dataclass
class PaginatedResult:
    """Paginated query result."""
    items: List[RedemptionCode]
    total: int
    page: int
    page_size: int
    total_pages: int


@dataclass
class RedemptionStatistics:
    """Statistics for redemption codes."""
    total_count: int
    unused_count: int
    used_count: int
    expired_count: int
    total_quota: int
    unused_quota: int
    used_quota: int
    expired_quota: int


@dataclass
class GenerateResult:
    """Result of code generation."""
    keys: List[str]
    count: int
    sql: str
    success: bool
    message: str


@dataclass
class GenerateParams:
    """Parameters for code generation."""
    name: str
    count: int
    key_prefix: str = ""
    quota_mode: QuotaMode = QuotaMode.FIXED
    fixed_amount: Optional[float] = None
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    expire_mode: ExpireMode = ExpireMode.NEVER
    expire_days: Optional[int] = None
    expire_date: Optional[str] = None
    
    def validate(self) -> None:
        """Validate parameters."""
        if not self.name or not self.name.strip():
            raise ValueError("Name is required")
        if not 1 <= self.count <= 1000:
            raise ValueError("Count must be between 1 and 1000")
        if len(self.key_prefix) > 20:
            raise ValueError("Key prefix must not exceed 20 characters")
        
        if self.quota_mode == QuotaMode.FIXED:
            if self.fixed_amount is None:
                raise ValueError("fixed_amount is required for fixed quota mode")
            if self.fixed_amount < 0:
                raise ValueError("fixed_amount must be non-negative")
        elif self.quota_mode == QuotaMode.RANDOM:
            if self.min_amount is None or self.max_amount is None:
                raise ValueError("min_amount and max_amount are required for random quota mode")
            if self.min_amount < 0 or self.max_amount < 0:
                raise ValueError("Amounts must be non-negative")
            if self.min_amount > self.max_amount:
                raise ValueError("min_amount must not exceed max_amount")
        
        if self.expire_mode == ExpireMode.DAYS:
            if self.expire_days is None:
                raise ValueError("expire_days is required for days expire mode")
            if self.expire_days < 0:
                raise ValueError("expire_days must be non-negative")
        elif self.expire_mode == ExpireMode.DATE:
            if self.expire_date is None:
                raise ValueError("expire_date is required for date expire mode")


@dataclass
class ListParams:
    """Parameters for listing codes."""
    page: int = 1
    page_size: int = 20
    name: Optional[str] = None
    status: Optional[RedemptionStatus] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    
    def validate(self) -> None:
        """Validate parameters."""
        if self.page < 1:
            raise ValueError("Page must be at least 1")
        if self.page_size < 1 or self.page_size > 100:
            raise ValueError("Page size must be between 1 and 100")


class RedemptionService:
    """
    Service for managing redemption codes.
    Handles generation, listing, and deletion of codes.
    """
    
    def __init__(
        self,
        db: Optional[DatabaseManager] = None,
        key_generator: Optional[KeyGenerator] = None,
    ):
        """
        Initialize RedemptionService.
        
        Args:
            db: Database manager instance. If None, uses global instance.
            key_generator: Key generator instance. If None, uses global instance.
        """
        self._db = db
        self._key_generator = key_generator
    
    @property
    def db(self) -> DatabaseManager:
        """Get database manager."""
        if self._db is None:
            self._db = get_db_manager()
        return self._db
    
    @property
    def key_generator(self) -> KeyGenerator:
        """Get key generator."""
        if self._key_generator is None:
            self._key_generator = get_key_generator()
        return self._key_generator

    @property
    def _key_col(self) -> str:
        """Get properly quoted 'key' column name based on database engine."""
        if self.db.config.engine == DatabaseEngine.POSTGRESQL:
            return '"key"'
        return '`key`'

    @property
    def _key_col_alias(self) -> str:
        """Get properly quoted 'key' column with alias based on database engine."""
        if self.db.config.engine == DatabaseEngine.POSTGRESQL:
            return '"key" as "key"'
        return '`key` as `key`'
    
    def generate_codes(self, params: GenerateParams) -> GenerateResult:
        """
        Generate redemption codes and insert into database.
        
        Args:
            params: Generation parameters.
            
        Returns:
            GenerateResult with keys, count, SQL, and status.
            
        Raises:
            ValueError: If parameters are invalid.
        """
        params.validate()
        
        # Generate keys
        keys = self.key_generator.generate_batch(params.count, params.key_prefix)
        
        # Calculate quotas
        quotas = self._calculate_quotas(params)
        
        # Calculate expiration time
        expired_time = calculate_expiration(
            mode=params.expire_mode,
            days=params.expire_days,
            expire_date=params.expire_date,
        )
        
        # Get current timestamp
        created_time = int(time.time())
        
        # Build SQL and insert
        sql = self._build_insert_sql(
            keys=keys,
            name=params.name,
            quotas=quotas,
            created_time=created_time,
            expired_time=expired_time,
        )
        
        try:
            # Execute batch insert
            insert_sql = f"""
                INSERT INTO redemptions
                (user_id, {self._key_col}, name, quota, created_time, redeemed_time, used_user_id, expired_time)
                VALUES (:user_id, :key, :name, :quota, :created_time, :redeemed_time, :used_user_id, :expired_time)
            """
            
            params_list = [
                {
                    "user_id": 1,
                    "key": key,
                    "name": params.name,
                    "quota": quotas[i],
                    "created_time": created_time,
                    "redeemed_time": 0,
                    "used_user_id": 0,
                    "expired_time": expired_time,
                }
                for i, key in enumerate(keys)
            ]
            
            self.db.execute_many(insert_sql, params_list)
            
            logger.info(f"Generated {len(keys)} redemption codes with name '{params.name}'")
            
            return GenerateResult(
                keys=keys,
                count=len(keys),
                sql=sql,
                success=True,
                message=f"Successfully generated {len(keys)} redemption codes",
            )
            
        except Exception as e:
            logger.error(f"Failed to insert redemption codes: {e}")
            return GenerateResult(
                keys=keys,
                count=len(keys),
                sql=sql,
                success=False,
                message=f"Failed to insert codes: {str(e)}",
            )

    
    def _calculate_quotas(self, params: GenerateParams) -> List[int]:
        """Calculate quotas based on parameters."""
        if params.quota_mode == QuotaMode.FIXED:
            quota = calculate_fixed_quota(params.fixed_amount)
            return [quota] * params.count
        else:
            return [
                calculate_random_quota(params.min_amount, params.max_amount)
                for _ in range(params.count)
            ]
    
    def _build_insert_sql(
        self,
        keys: List[str],
        name: str,
        quotas: List[int],
        created_time: int,
        expired_time: int,
    ) -> str:
        """Build SQL INSERT statement for display purposes."""
        values = []
        for i, key in enumerate(keys):
            values.append(
                f"(1, '{key}', '{name}', {quotas[i]}, {created_time}, 0, 0, {expired_time})"
            )

        sql = (
            "INSERT INTO redemptions "
            f"(user_id, {self._key_col}, name, quota, created_time, redeemed_time, used_user_id, expired_time) "
            "VALUES\n" + ",\n".join(values) + ";"
        )
        return sql
    
    def list_codes(self, params: ListParams) -> PaginatedResult:
        """
        List redemption codes with pagination and filtering.
        
        Args:
            params: List parameters including pagination and filters.
            
        Returns:
            PaginatedResult with items and pagination info.
        """
        params.validate()
        
        # Build WHERE clause (use r. prefix for JOIN query)
        where_clauses = ["r.deleted_at IS NULL"]
        query_params: dict[str, Any] = {}

        if params.name:
            where_clauses.append("r.name LIKE :name")
            query_params["name"] = f"%{params.name}%"

        current_time = int(time.time())

        if params.status:
            if params.status == RedemptionStatus.USED:
                where_clauses.append("(r.redeemed_time IS NOT NULL AND r.redeemed_time > 0)")
            elif params.status == RedemptionStatus.EXPIRED:
                where_clauses.append("(r.redeemed_time IS NULL OR r.redeemed_time = 0)")
                where_clauses.append("r.expired_time IS NOT NULL")
                where_clauses.append("r.expired_time > 0")
                where_clauses.append("r.expired_time < :current_time")
                query_params["current_time"] = current_time
            elif params.status == RedemptionStatus.UNUSED:
                where_clauses.append("(r.redeemed_time IS NULL OR r.redeemed_time = 0)")
                where_clauses.append("(r.expired_time IS NULL OR r.expired_time = 0 OR r.expired_time >= :current_time)")
                query_params["current_time"] = current_time

        if params.start_date:
            start_ts = self._parse_date_to_timestamp(params.start_date)
            where_clauses.append("r.created_time >= :start_time")
            query_params["start_time"] = start_ts

        if params.end_date:
            end_ts = self._parse_date_to_timestamp(params.end_date, end_of_day=True)
            where_clauses.append("r.created_time <= :end_time")
            query_params["end_time"] = end_ts

        where_sql = " AND ".join(where_clauses)

        # Get total count
        count_sql = f"SELECT COUNT(*) as total FROM redemptions r WHERE {where_sql}"
        count_result = self.db.execute(count_sql, query_params)
        total = count_result[0]["total"] if count_result else 0

        # Calculate pagination
        total_pages = max(1, (total + params.page_size - 1) // params.page_size)
        offset = (params.page - 1) * params.page_size

        # Get items with LEFT JOIN to get used username
        select_sql = f"""
            SELECT r.id, r.{self._key_col} as "key", r.name, r.quota, r.created_time,
                   r.redeemed_time, r.used_user_id, COALESCE(u.username, '') as used_username, r.expired_time
            FROM redemptions r
            LEFT JOIN users u ON r.used_user_id = u.id AND r.used_user_id > 0
            WHERE {where_sql}
            ORDER BY r.created_time DESC
            LIMIT :limit OFFSET :offset
        """
        query_params["limit"] = params.page_size
        query_params["offset"] = offset

        rows = self.db.execute(select_sql, query_params)
        items = [RedemptionCode.from_db_row(row) for row in rows]
        
        return PaginatedResult(
            items=items,
            total=total,
            page=params.page,
            page_size=params.page_size,
            total_pages=total_pages,
        )

    
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
    
    def delete_codes(self, ids: List[int]) -> bool:
        """
        Soft delete redemption codes by setting deleted_at timestamp.
        
        Args:
            ids: List of redemption code IDs to delete.
            
        Returns:
            True if deletion was successful.
            
        Raises:
            ValueError: If ids list is empty.
        """
        if not ids:
            raise ValueError("At least one ID is required")
        
        # Build placeholders for IN clause
        placeholders = ", ".join([f":id_{i}" for i in range(len(ids))])
        params = {f"id_{i}": id_val for i, id_val in enumerate(ids)}
        params["deleted_at"] = datetime.now().isoformat()
        
        sql = f"""
            UPDATE redemptions 
            SET deleted_at = :deleted_at
            WHERE id IN ({placeholders}) AND deleted_at IS NULL
        """
        
        result = self.db.execute(sql, params)
        affected = result[0].get("affected_rows", 0) if result else 0
        
        logger.info(f"Soft deleted {affected} redemption codes")
        return affected > 0
    
    def delete_code(self, id: int) -> bool:
        """
        Soft delete a single redemption code.
        
        Args:
            id: Redemption code ID to delete.
            
        Returns:
            True if deletion was successful.
        """
        return self.delete_codes([id])
    
    def get_code_by_id(self, id: int) -> Optional[RedemptionCode]:
        """
        Get a single redemption code by ID.

        Args:
            id: Redemption code ID.

        Returns:
            RedemptionCode if found, None otherwise.
        """
        sql = f"""
            SELECT id, {self._key_col_alias}, name, quota, created_time, redeemed_time, used_user_id, expired_time
            FROM redemptions
            WHERE id = :id AND deleted_at IS NULL
        """
        rows = self.db.execute(sql, {"id": id})
        
        if not rows:
            return None
        
        return RedemptionCode.from_db_row(rows[0])

    def get_statistics(self, start_date: Optional[str] = None, end_date: Optional[str] = None) -> RedemptionStatistics:
        """
        Get redemption code statistics.
        
        Args:
            start_date: Optional start date filter (ISO 8601 or YYYY-MM-DD).
            end_date: Optional end date filter (ISO 8601 or YYYY-MM-DD).
            
        Returns:
            RedemptionStatistics object.
        """
        where_clauses = ["deleted_at IS NULL"]
        query_params: dict[str, Any] = {}
        
        if start_date:
            start_ts = self._parse_date_to_timestamp(start_date)
            where_clauses.append("created_time >= :start_time")
            query_params["start_time"] = start_ts
        
        if end_date:
            end_ts = self._parse_date_to_timestamp(end_date, end_of_day=True)
            where_clauses.append("created_time <= :end_time")
            query_params["end_time"] = end_ts
            
        where_sql = " AND ".join(where_clauses)
        current_time = int(time.time())
        query_params["current_time"] = current_time

        sql = f"""
            SELECT 
                COUNT(*) as total_count,
                SUM(CASE WHEN (redeemed_time IS NULL OR redeemed_time = 0) AND (expired_time IS NULL OR expired_time = 0 OR expired_time >= :current_time) THEN 1 ELSE 0 END) as unused_count,
                SUM(CASE WHEN redeemed_time IS NOT NULL AND redeemed_time > 0 THEN 1 ELSE 0 END) as used_count,
                SUM(CASE WHEN (redeemed_time IS NULL OR redeemed_time = 0) AND expired_time IS NOT NULL AND expired_time > 0 AND expired_time < :current_time THEN 1 ELSE 0 END) as expired_count,
                COALESCE(SUM(quota), 0) as total_quota,
                COALESCE(SUM(CASE WHEN (redeemed_time IS NULL OR redeemed_time = 0) AND (expired_time IS NULL OR expired_time = 0 OR expired_time >= :current_time) THEN quota ELSE 0 END), 0) as unused_quota,
                COALESCE(SUM(CASE WHEN redeemed_time IS NOT NULL AND redeemed_time > 0 THEN quota ELSE 0 END), 0) as used_quota,
                COALESCE(SUM(CASE WHEN (redeemed_time IS NULL OR redeemed_time = 0) AND expired_time IS NOT NULL AND expired_time > 0 AND expired_time < :current_time THEN quota ELSE 0 END), 0) as expired_quota
            FROM redemptions
            WHERE {where_sql}
        """
        
        rows = self.db.execute(sql, query_params)
        row = rows[0] if rows else {}
        
        return RedemptionStatistics(
            total_count=int(row.get("total_count", 0)),
            unused_count=int(row.get("unused_count", 0)),
            used_count=int(row.get("used_count", 0)),
            expired_count=int(row.get("expired_count", 0)),
            total_quota=int(row.get("total_quota", 0)),
            unused_quota=int(row.get("unused_quota", 0)),
            used_quota=int(row.get("used_quota", 0)),
            expired_quota=int(row.get("expired_quota", 0)),
        )


# Global service instance
_redemption_service: Optional[RedemptionService] = None


def get_redemption_service() -> RedemptionService:
    """Get or create the global RedemptionService instance."""
    global _redemption_service
    if _redemption_service is None:
        _redemption_service = RedemptionService()
    return _redemption_service


def reset_redemption_service() -> None:
    """Reset the global RedemptionService instance (for testing)."""
    global _redemption_service
    _redemption_service = None

"""
Database connection module for NewAPI Middleware Tool.
Supports MySQL and PostgreSQL with connection pooling.
"""
import logging
import os
from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.pool import QueuePool

logger = logging.getLogger(__name__)


class DatabaseEngine(str, Enum):
    """Supported database engines."""
    MYSQL = "mysql"
    POSTGRESQL = "postgresql"


@dataclass
class DBConfig:
    """Database configuration."""
    engine: DatabaseEngine
    host: str
    port: int
    user: str
    password: str
    database: str

    @classmethod
    def from_env(cls) -> "DBConfig":
        """Create DBConfig from environment variables."""
        engine_str = os.getenv("DB_ENGINE", "mysql").lower()
        
        if engine_str in ("postgresql", "postgres", "pgsql"):
            engine = DatabaseEngine.POSTGRESQL
            default_port = 5432
        else:
            engine = DatabaseEngine.MYSQL
            default_port = 3306
        
        return cls(
            engine=engine,
            host=os.getenv("DB_DNS", "localhost"),
            port=int(os.getenv("DB_PORT", str(default_port))),
            user=os.getenv("DB_USER", "root"),
            password=os.getenv("DB_PASSWORD", ""),
            database=os.getenv("DB_NAME", "newapi"),
        )

    def get_connection_url(self) -> str:
        """Generate SQLAlchemy connection URL."""
        if self.engine == DatabaseEngine.POSTGRESQL:
            return f"postgresql+psycopg2://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"
        else:
            return f"mysql+pymysql://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}?charset=utf8mb4"


# Recommended indexes for IP monitoring and risk analysis
RECOMMENDED_INDEXES = [
    # IP monitoring indexes
    ("idx_logs_ip_created", "logs", ["ip", "created_at"]),
    ("idx_logs_created_ip_token", "logs", ["created_at", "ip", "token_id"]),
    ("idx_logs_created_user_ip", "logs", ["created_at", "user_id", "ip"]),
    ("idx_logs_token_created_ip", "logs", ["token_id", "created_at", "ip"]),
    # Risk monitoring indexes
    ("idx_logs_created_user_type", "logs", ["created_at", "user_id", "type"]),
    # Analytics optimization - for incremental log processing
    ("idx_logs_id_type", "logs", ["id", "type"]),
]


class DatabaseManager:
    """
    Database connection manager with connection pooling.
    Supports MySQL and PostgreSQL databases.
    """
    
    def __init__(self, config: Optional[DBConfig] = None):
        """
        Initialize DatabaseManager.
        
        Args:
            config: Database configuration. If None, reads from environment variables.
        """
        self.config = config or DBConfig.from_env()
        self._engine: Optional[Engine] = None
        self._connected = False
    
    @property
    def engine(self) -> Engine:
        """Get or create the database engine."""
        if self._engine is None:
            self._engine = self._create_engine()
        return self._engine
    
    def _create_engine(self) -> Engine:
        """Create SQLAlchemy engine with connection pooling."""
        connection_url = self.config.get_connection_url()
        
        logger.info(
            f"Creating database engine: {self.config.engine.value} "
            f"at {self.config.host}:{self.config.port}/{self.config.database}"
        )
        
        return create_engine(
            connection_url,
            poolclass=QueuePool,
            pool_size=3,  # Reduced: keep minimal connections
            max_overflow=5,  # Reduced: limit max connections to 8 total
            pool_timeout=30,
            pool_recycle=1800,  # Recycle connections after 30 minutes
            pool_pre_ping=True,  # Verify connection before use
        )
    
    def connect(self) -> bool:
        """
        Test database connection.
        
        Returns:
            True if connection successful.
            
        Raises:
            DatabaseConnectionError: If connection fails.
        """
        from .main import DatabaseConnectionError
        
        try:
            with self.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            if not self._connected:
                self._connected = True
                logger.info("Database connection successful")
            return True
        except SQLAlchemyError as e:
            self._connected = False
            error_msg = f"Failed to connect to database: {str(e)}"
            logger.error(error_msg)
            raise DatabaseConnectionError(
                message=error_msg,
                details={
                    "engine": self.config.engine.value,
                    "host": self.config.host,
                    "port": self.config.port,
                    "database": self.config.database,
                    "user": self.config.user,
                }
            )
    
    @property
    def is_connected(self) -> bool:
        """Check if database is connected."""
        return self._connected
    
    def execute(self, sql: str, params: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
        """
        Execute SQL query and return results.
        
        Args:
            sql: SQL query string.
            params: Optional query parameters.
            
        Returns:
            List of result rows as dictionaries.
            
        Raises:
            DatabaseConnectionError: If execution fails.
        """
        from .main import DatabaseConnectionError
        
        try:
            with self.engine.connect() as conn:
                result = conn.execute(text(sql), params or {})
                
                # For SELECT queries, return results
                if result.returns_rows:
                    rows = result.fetchall()
                    columns = result.keys()
                    return [dict(zip(columns, row)) for row in rows]
                
                # For INSERT/UPDATE/DELETE, commit and return affected rows
                conn.commit()
                return [{"affected_rows": result.rowcount}]
                
        except SQLAlchemyError as e:
            error_msg = f"SQL execution failed: {str(e)}"
            logger.error(error_msg)
            raise DatabaseConnectionError(
                message=error_msg,
                details={"sql": sql[:200] if len(sql) > 200 else sql}
            )
    
    def execute_many(self, sql: str, params_list: list[dict[str, Any]]) -> int:
        """
        Execute SQL with multiple parameter sets (batch insert).
        
        Args:
            sql: SQL query string with named parameters.
            params_list: List of parameter dictionaries.
            
        Returns:
            Total number of affected rows.
            
        Raises:
            DatabaseConnectionError: If execution fails.
        """
        from .main import DatabaseConnectionError
        
        try:
            with self.engine.connect() as conn:
                result = conn.execute(text(sql), params_list)
                conn.commit()
                return result.rowcount
                
        except SQLAlchemyError as e:
            error_msg = f"Batch SQL execution failed: {str(e)}"
            logger.error(error_msg)
            raise DatabaseConnectionError(
                message=error_msg,
                details={"sql": sql[:200] if len(sql) > 200 else sql}
            )
    
    def close(self) -> None:
        """Close database connection and dispose engine."""
        if self._engine is not None:
            self._engine.dispose()
            self._engine = None
            self._connected = False
            logger.info("Database connection closed")

    def get_existing_indexes(self, table_name: str) -> set[str]:
        """
        Get existing index names for a table.
        
        Args:
            table_name: Name of the table.
            
        Returns:
            Set of existing index names.
        """
        try:
            if self.config.engine == DatabaseEngine.POSTGRESQL:
                sql = """
                    SELECT indexname 
                    FROM pg_indexes 
                    WHERE tablename = :table_name
                """
            else:
                sql = """
                    SELECT DISTINCT INDEX_NAME as indexname
                    FROM INFORMATION_SCHEMA.STATISTICS 
                    WHERE TABLE_SCHEMA = :db_name AND TABLE_NAME = :table_name
                """
            
            params = {"table_name": table_name}
            if self.config.engine == DatabaseEngine.MYSQL:
                params["db_name"] = self.config.database
            
            rows = self.execute(sql, params)
            return {row.get("indexname") or row.get("INDEX_NAME") for row in rows}
        except Exception as e:
            logger.warning(f"Failed to get existing indexes for {table_name}: {e}")
            return set()

    def create_index(self, index_name: str, table_name: str, columns: list[str]) -> bool:
        """
        Create an index if it doesn't exist.
        
        Args:
            index_name: Name of the index.
            table_name: Name of the table.
            columns: List of column names.
            
        Returns:
            True if index was created, False if it already exists.
        """
        existing = self.get_existing_indexes(table_name)
        if index_name in existing:
            logger.debug(f"Index {index_name} already exists on {table_name}")
            return False
        
        columns_str = ", ".join(columns)
        
        try:
            if self.config.engine == DatabaseEngine.POSTGRESQL:
                sql = f"CREATE INDEX IF NOT EXISTS {index_name} ON {table_name} ({columns_str})"
            else:
                # MySQL doesn't support IF NOT EXISTS for CREATE INDEX
                sql = f"CREATE INDEX {index_name} ON {table_name} ({columns_str})"
            
            self.execute(sql, {})
            logger.info(f"Created index {index_name} on {table_name}({columns_str})")
            return True
        except Exception as e:
            # Index might already exist (race condition) or other error
            logger.warning(f"Failed to create index {index_name}: {e}")
            return False

    def ensure_recommended_indexes(self) -> dict[str, bool]:
        """
        Ensure all recommended indexes exist.
        
        Returns:
            Dictionary mapping index names to whether they were created (True) or already existed (False).
        """
        results = {}
        for index_name, table_name, columns in RECOMMENDED_INDEXES:
            try:
                created = self.create_index(index_name, table_name, columns)
                results[index_name] = created
            except Exception as e:
                logger.error(f"Error ensuring index {index_name}: {e}")
                results[index_name] = False
        return results

    def ensure_indexes(self) -> None:
        """
        Create recommended indexes if they don't exist.
        These indexes improve query performance for risk monitoring and analytics.
        Safe to run multiple times - checks before creating.
        
        WARNING: This method can be slow on large tables. Use ensure_indexes_async_safe()
        for background execution.
        """
        self._do_ensure_indexes(log_progress=False)

    def ensure_indexes_async_safe(self) -> None:
        """
        Create indexes with progress logging and delays between each index.
        Designed to be called from a background thread to avoid blocking.
        Creates indexes one by one with small delays to reduce database load.
        """
        self._do_ensure_indexes(log_progress=True, delay_between=1.0)

    def _do_ensure_indexes(self, log_progress: bool = False, delay_between: float = 0) -> None:
        """
        Internal method to create indexes.
        
        Args:
            log_progress: If True, log each index creation attempt.
            delay_between: Seconds to wait between index creations (reduces DB load).
        """
        import time as time_module
        from .logger import logger as app_logger
        
        is_pg = self.config.engine == DatabaseEngine.POSTGRESQL
        
        # Define indexes: (index_name, table_name, columns)
        # Ordered by priority - most important indexes first
        indexes = [
            # High priority: analytics sync (most frequently used)
            ("idx_logs_id_type", "logs", ["id", "type"]),  # Incremental log processing
            
            # Medium priority: risk monitoring
            ("idx_logs_created_user_type", "logs", ["created_at", "user_id", "type"]),
            ("idx_logs_type_created", "logs", ["type", "created_at"]),
            ("idx_logs_user_created", "logs", ["user_id", "created_at"]),

            # Lower priority: IP monitoring (can be created later)
            ("idx_logs_ip_created", "logs", ["ip", "created_at"]),
            ("idx_logs_created_ip_token", "logs", ["created_at", "ip", "token_id"]),
            ("idx_logs_created_user_ip", "logs", ["created_at", "user_id", "ip"]),
            ("idx_logs_token_created_ip", "logs", ["token_id", "created_at", "ip"]),

            # Other tables (usually small, fast to index)
            ("idx_users_deleted_status", "users", ["deleted_at", "status"]),
            ("idx_users_request_count", "users", ["request_count"]),
            ("idx_tokens_user_deleted", "tokens", ["user_id", "deleted_at"]),
            ("idx_topups_create_time", "top_ups", ["create_time"]),
            ("idx_topups_user_id", "top_ups", ["user_id"]),
            ("idx_redemptions_created_deleted", "redemptions", ["created_time", "deleted_at"]),
        ]
        
        created_count = 0
        skipped_count = 0
        total = len(indexes)
        
        for i, (index_name, table_name, columns) in enumerate(indexes):
            try:
                # Check if index already exists
                if is_pg:
                    check_sql = """
                        SELECT 1 FROM pg_indexes 
                        WHERE indexname = :index_name
                    """
                else:
                    check_sql = """
                        SELECT 1 FROM information_schema.statistics 
                        WHERE table_schema = DATABASE() 
                        AND table_name = :table_name 
                        AND index_name = :index_name
                        LIMIT 1
                    """
                
                result = self.execute(check_sql, {"index_name": index_name, "table_name": table_name})
                
                if result:
                    skipped_count += 1
                    continue
                
                # Check if table exists
                if is_pg:
                    table_check_sql = """
                        SELECT 1 FROM information_schema.tables 
                        WHERE table_name = :table_name
                        LIMIT 1
                    """
                else:
                    table_check_sql = """
                        SELECT 1 FROM information_schema.tables 
                        WHERE table_schema = DATABASE() 
                        AND table_name = :table_name
                        LIMIT 1
                    """
                
                table_exists = self.execute(table_check_sql, {"table_name": table_name})
                if not table_exists:
                    continue
                
                # Log progress before creating (can be slow)
                if log_progress:
                    app_logger.system(f"创建索引 ({i+1}/{total}): {index_name} ON {table_name}...")
                
                # Create index - use CONCURRENTLY for PostgreSQL to avoid locking
                columns_str = ", ".join(columns)
                if is_pg:
                    # CONCURRENTLY allows reads/writes during index creation
                    create_sql = f'CREATE INDEX CONCURRENTLY IF NOT EXISTS "{index_name}" ON {table_name} ({columns_str})'
                else:
                    # MySQL: use ALGORITHM=INPLACE for online DDL when possible
                    create_sql = f'CREATE INDEX `{index_name}` ON {table_name} ({columns_str})'
                
                self.execute(create_sql)
                created_count += 1
                
                if log_progress:
                    app_logger.system(f"索引创建完成: {index_name}")
                
                # Delay between index creations to reduce load
                if delay_between > 0 and i < total - 1:
                    time_module.sleep(delay_between)
                
            except Exception as e:
                # Log but don't fail
                if log_progress:
                    app_logger.warning(f"创建索引失败 {index_name}: {e}", category="数据库")
        
        if created_count > 0:
            app_logger.system(f"索引初始化完成，新建 {created_count} 个，跳过 {skipped_count} 个已存在")
        elif skipped_count > 0:
            app_logger.system(f"索引检查完成，{skipped_count} 个索引已存在")

    def get_index_status(self) -> dict[str, Any]:
        """
        Get status of all recommended indexes.
        
        Returns:
            Dictionary with index status information.
        """
        is_pg = self.config.engine == DatabaseEngine.POSTGRESQL
        
        # All indexes we manage
        indexes = [
            ("idx_logs_id_type", "logs"),
            ("idx_logs_created_user_type", "logs"),
            ("idx_logs_type_created", "logs"),
            ("idx_logs_user_created", "logs"),
            ("idx_logs_ip_created", "logs"),
            ("idx_logs_created_ip_token", "logs"),
            ("idx_logs_created_user_ip", "logs"),
            ("idx_logs_token_created_ip", "logs"),
            ("idx_users_deleted_status", "users"),
            ("idx_users_request_count", "users"),
            ("idx_tokens_user_deleted", "tokens"),
            ("idx_topups_create_time", "top_ups"),
            ("idx_topups_user_id", "top_ups"),
            ("idx_redemptions_created_deleted", "redemptions"),
        ]
        
        status = {}
        existing_count = 0
        missing_count = 0
        
        for index_name, table_name in indexes:
            try:
                if is_pg:
                    check_sql = "SELECT 1 FROM pg_indexes WHERE indexname = :index_name"
                else:
                    check_sql = """
                        SELECT 1 FROM information_schema.statistics 
                        WHERE table_schema = DATABASE() 
                        AND table_name = :table_name 
                        AND index_name = :index_name
                        LIMIT 1
                    """
                
                result = self.execute(check_sql, {"index_name": index_name, "table_name": table_name})
                exists = bool(result)
                status[index_name] = {"exists": exists, "table": table_name}
                
                if exists:
                    existing_count += 1
                else:
                    missing_count += 1
            except Exception:
                status[index_name] = {"exists": False, "table": table_name, "error": True}
                missing_count += 1
        
        return {
            "indexes": status,
            "total": len(indexes),
            "existing": existing_count,
            "missing": missing_count,
            "all_ready": missing_count == 0,
        }
        
        if created_count > 0:
            app_logger.system(f"索引初始化完成，新建 {created_count} 个，跳过 {skipped_count} 个已存在")
        elif skipped_count > 0:
            app_logger.system(f"索引检查完成，{skipped_count} 个索引已存在")


# Global database manager instance
_db_manager: Optional[DatabaseManager] = None


def get_db_manager() -> DatabaseManager:
    """Get or create the global DatabaseManager instance."""
    global _db_manager
    if _db_manager is None:
        _db_manager = DatabaseManager()
    return _db_manager


def reset_db_manager() -> None:
    """Reset the global DatabaseManager instance (for testing)."""
    global _db_manager
    if _db_manager is not None:
        _db_manager.close()
        _db_manager = None

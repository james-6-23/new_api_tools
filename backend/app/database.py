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
            pool_size=5,
            max_overflow=10,
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

    def ensure_indexes(self) -> None:
        """
        Create recommended indexes if they don't exist.
        These indexes improve query performance for risk monitoring and analytics.
        Safe to run multiple times - checks before creating.
        """
        from .logger import logger as app_logger
        
        is_pg = self.config.engine == DatabaseEngine.POSTGRESQL
        
        # Define indexes: (index_name, table_name, columns)
        # Based on analysis of common query patterns in the system
        indexes = [
            # logs table - most queried table
            ("idx_logs_created_user_type", "logs", ["created_at", "user_id", "type"]),  # Risk monitoring, analytics
            ("idx_logs_user_created", "logs", ["user_id", "created_at"]),  # User analysis queries
            ("idx_logs_type_created", "logs", ["type", "created_at"]),  # Dashboard stats by type
            
            # users table
            ("idx_users_deleted_status", "users", ["deleted_at", "status"]),  # User listing with soft delete
            ("idx_users_request_count", "users", ["request_count"]),  # Sorting by request count
            
            # tokens table
            ("idx_tokens_user_deleted", "tokens", ["user_id", "deleted_at"]),  # Token queries by user
            
            # top_ups table
            ("idx_topups_create_time", "top_ups", ["create_time"]),  # Top-up listing sorted by time
            ("idx_topups_user_id", "top_ups", ["user_id"]),  # Top-ups by user
            
            # redemptions table
            ("idx_redemptions_created_deleted", "redemptions", ["created_time", "deleted_at"]),  # Redemption listing
        ]
        
        created_count = 0
        skipped_count = 0
        
        for index_name, table_name, columns in indexes:
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
                    # Index already exists
                    skipped_count += 1
                    continue
                
                # Check if table exists before creating index
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
                    # Table doesn't exist, skip this index
                    continue
                
                # Create index
                columns_str = ", ".join(columns)
                if is_pg:
                    create_sql = f'CREATE INDEX "{index_name}" ON {table_name} ({columns_str})'
                else:
                    create_sql = f'CREATE INDEX `{index_name}` ON {table_name} ({columns_str})'
                
                self.execute(create_sql)
                created_count += 1
                app_logger.system(f"创建索引: {index_name} ON {table_name}")
                
            except Exception as e:
                # Log but don't fail - index creation is optional optimization
                app_logger.warning(f"创建索引失败 {index_name}: {e}", category="数据库")
        
        if created_count > 0:
            app_logger.system(f"索引初始化完成，新建 {created_count} 个索引")
        else:
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

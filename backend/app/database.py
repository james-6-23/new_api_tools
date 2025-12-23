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

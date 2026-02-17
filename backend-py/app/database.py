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
        # 处理 IPv6 地址格式 - 需要用方括号包裹
        host = self.host
        if ':' in host and not host.startswith('['):
            # IPv6 地址需要用方括号包裹
            host = f'[{host}]'
        
        if self.engine == DatabaseEngine.POSTGRESQL:
            return f"postgresql+psycopg2://{self.user}:{self.password}@{host}:{self.port}/{self.database}"
        else:
            # MySQL 连接参数
            # charset=utf8mb4 支持完整 Unicode
            return f"mysql+pymysql://{self.user}:{self.password}@{host}:{self.port}/{self.database}?charset=utf8mb4"


# Recommended indexes for performance optimization
# 优化原则：
# 1. 最关键的排行榜索引放最前面（影响预热速度）
# 2. 精简冗余索引，避免重复覆盖
# 3. 索引列顺序：过滤条件 > 分组条件 > 排序条件
# 注意：MySQL OneAPI 可能已有部分索引，PostgreSQL 通常缺少复合索引
RECOMMENDED_INDEXES = [
    # === 最高优先级：排行榜查询（影响3d预热从858s降到<10s）===
    # Query: WHERE created_at >= x AND type IN (2,5) GROUP BY user_id ORDER BY count DESC
    ("idx_logs_created_type_user", "logs", ["created_at", "type", "user_id"]),

    # === 高优先级：大窗口/稳定性补充（避免 3d/7d 走全表扫描）===
    # 对于部分数据库/数据分布，type 放前面会更容易命中索引
    ("idx_logs_type_created_user", "logs", ["type", "created_at", "user_id"]),

    # === 高优先级：Dashboard 活跃 Token 统计 ===
    # Query: logs WHERE created_at >= x AND type = 2 GROUP BY token_id
    ("idx_logs_type_created_token", "logs", ["type", "created_at", "token_id"]),

    # === 中优先级：Dashboard 模型统计 ===
    # Query: WHERE created_at >= x AND type = 2 GROUP BY model_name
    ("idx_logs_type_created_model", "logs", ["type", "created_at", "model_name"]),

    # === 高优先级：用户活跃度查询（解决预热耗时 2000s+ 问题）===
    # Query: EXISTS (SELECT 1 FROM logs WHERE user_id = x AND type = 2 AND created_at >= cutoff)
    # 索引顺序：等值条件(user_id, type) 在前，范围条件(created_at) 在后
    ("idx_logs_user_type_created", "logs", ["user_id", "type", "created_at"]),

    # === IP 监控索引 ===
    # IP 切换分析: WHERE user_id = x AND created_at >= y ORDER BY created_at
    ("idx_logs_user_created_ip", "logs", ["user_id", "created_at", "ip"]),
    # 多 IP Token 检测: WHERE created_at >= x GROUP BY token_id HAVING COUNT(DISTINCT ip) > 1
    ("idx_logs_created_token_ip", "logs", ["created_at", "token_id", "ip"]),
    # IP 分布统计: WHERE created_at >= x AND ip <> '' GROUP BY ip
    ("idx_logs_created_ip_token", "logs", ["created_at", "ip", "token_id"]),

    # === 其他表索引（通常很小，创建很快）===
    ("idx_users_deleted_status", "users", ["deleted_at", "status"]),
    ("idx_tokens_user_deleted", "tokens", ["user_id", "deleted_at"]),
]

# ============================================================================
# OneAPI 系统自带索引白名单 - 绝对不能删除！
# 来源: mysql_schema_export/all_indexes.txt 和 pgsql_schema_export/all_indexes.txt
# ============================================================================

# MySQL 系统自带的 logs 表索引（来自 mysql_schema_export）
# 共 13 个索引
SYSTEM_LOGS_INDEXES_MYSQL = {
    "PRIMARY",                    # 主键 (id)
    "idx_created_at_id",          # (id, created_at)
    "idx_created_at_type",        # (created_at, type)
    "idx_logs_channel_id",        # (channel_id)
    "idx_logs_group",             # (group)
    "idx_logs_ip",                # (ip)
    "idx_logs_model_name",        # (model_name)
    "idx_logs_token_id",          # (token_id)
    "idx_logs_token_name",        # (token_name)
    "idx_logs_type_created_id",   # (type, created_at, id)
    "idx_logs_user_id",           # (user_id)
    "idx_logs_username",          # (username)
    "index_username_model_name",  # (model_name, username)
}

# PostgreSQL 系统自带的 logs 表索引（来自 pgsql_schema_export）
# 共 11 个索引
SYSTEM_LOGS_INDEXES_PGSQL = {
    "logs_pkey",                  # 主键 (id)
    "idx_created_at_id",          # (id, created_at)
    "idx_created_at_type",        # (created_at, type)
    "idx_logs_channel_id",        # (channel_id)
    "idx_logs_group",             # (group)
    "idx_logs_ip",                # (ip)
    "idx_logs_model_name",        # (model_name)
    "idx_logs_token_id",          # (token_id)
    "idx_logs_token_name",        # (token_name)
    "idx_logs_user_id",           # (user_id)
    "idx_logs_username",          # (username)
    "index_username_model_name",  # (model_name, username)
}

# 我们工具创建的索引（需要保留）
OUR_LOGS_INDEXES = {idx[0] for idx in RECOMMENDED_INDEXES if idx[1] == "logs"}

# ============================================================================
# 可以安全删除的冗余索引
# 这些是由旧版本工具或手动创建的重复/冗余索引
# 注意：只有在这个列表中且不在系统白名单中的索引才会被删除
# ============================================================================
REDUNDANT_LOGS_INDEXES = {
    # 列顺序不同的重复索引
    "idx_logs_type_time_user",    # 与 idx_logs_type_created_user 重复
    "idx_logs_type_time_model",   # 与 idx_logs_type_created_model 重复
    "idx_logs_created_user_type", # 列顺序不同的重复
    "idx_logs_created_user_ip",   # 与 idx_logs_user_created_ip 重复
    # idx_logs_user_type_created 已移至 RECOMMENDED_INDEXES（用户活跃度查询优化）
    "idx_logs_ip_created",        # 被 idx_logs_created_ip_token 覆盖
    "idx_logs_token_created_ip",  # 被 idx_logs_created_token_ip 覆盖
    "idx_logs_id_type",           # 几乎无用
    # 旧版本工具可能创建的索引
    "idx_logs_user_created",      # 被 idx_logs_user_created_ip 覆盖
    "idx_logs_type_created",      # 被 idx_logs_type_created_user 覆盖
}


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

    def execute_ddl(self, sql: str) -> None:
        """
        Execute DDL statement (CREATE INDEX, ALTER TABLE, etc.) outside of transaction.
        Required for PostgreSQL CREATE INDEX CONCURRENTLY which cannot run in a transaction.
        
        Args:
            sql: DDL SQL statement.
        """
        from .main import DatabaseConnectionError
        
        try:
            # Use raw connection with autocommit for DDL
            raw_conn = self.engine.raw_connection()
            try:
                # Set autocommit mode (different API for different drivers)
                if hasattr(raw_conn, 'set_session'):
                    # psycopg2 (PostgreSQL)
                    raw_conn.set_session(autocommit=True)
                elif hasattr(raw_conn, 'autocommit'):
                    # pymysql (MySQL) - use property
                    raw_conn.autocommit(True)
                else:
                    # Fallback: try autocommit attribute
                    raw_conn.autocommit = True
                
                cursor = raw_conn.cursor()
                cursor.execute(sql)
                cursor.close()
            finally:
                raw_conn.close()
        except Exception as e:
            error_msg = f"DDL execution failed: {str(e)}"
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

    def cleanup_redundant_indexes(self, log_progress: bool = True) -> dict[str, Any]:
        """
        Clean up redundant indexes on logs table.
        
        安全策略（最高优先级）：
        1. 系统白名单中的索引 **绝对不会被删除**
        2. 我们工具创建的索引不会被删除
        3. 只删除明确在 REDUNDANT_LOGS_INDEXES 列表中的索引
        4. 删除前会再次验证不在白名单中
        
        Args:
            log_progress: If True, log each deletion.
            
        Returns:
            Dictionary with cleanup results.
        """
        from .logger import logger as app_logger
        
        is_pg = self.config.engine == DatabaseEngine.POSTGRESQL
        system_indexes = SYSTEM_LOGS_INDEXES_PGSQL if is_pg else SYSTEM_LOGS_INDEXES_MYSQL
        
        # Get all existing indexes on logs table
        existing_indexes = self.get_existing_indexes("logs")
        
        # 白名单：系统索引 + 我们的索引（绝对不能删除）
        whitelist = system_indexes | OUR_LOGS_INDEXES
        
        # 只删除：存在 + 在冗余列表中 + 不在白名单中
        to_delete = []
        for idx in existing_indexes:
            # 安全检查1：白名单中的索引绝对不删除
            if idx in whitelist:
                continue
            # 安全检查2：只删除明确标记为冗余的索引
            if idx in REDUNDANT_LOGS_INDEXES:
                # 安全检查3：再次确认不在系统白名单中
                if idx not in system_indexes:
                    to_delete.append(idx)
        
        if not to_delete:
            if log_progress:
                app_logger.system(f"索引检查完成，无冗余索引需要清理 (共 {len(existing_indexes)} 个索引)")
            return {
                "checked": len(existing_indexes),
                "deleted": 0,
                "deleted_indexes": [],
                "kept": len(existing_indexes),
                "whitelist_count": len(whitelist & existing_indexes),
            }
        
        if log_progress:
            app_logger.system(f"发现 {len(to_delete)} 个冗余索引，开始清理: {to_delete}")
        
        deleted = []
        failed = []
        skipped = []
        
        for idx_name in to_delete:
            # 最终安全检查：删除前再次验证
            if idx_name in system_indexes:
                skipped.append(idx_name)
                if log_progress:
                    app_logger.warning(f"跳过系统索引: {idx_name}", category="数据库")
                continue
                
            try:
                if is_pg:
                    drop_sql = f'DROP INDEX IF EXISTS "{idx_name}"'
                else:
                    drop_sql = f'ALTER TABLE logs DROP INDEX `{idx_name}`'
                
                self.execute(drop_sql, {})
                deleted.append(idx_name)
                
                if log_progress:
                    app_logger.system(f"已删除冗余索引: {idx_name}")
                    
            except Exception as e:
                failed.append(idx_name)
                if log_progress:
                    app_logger.warning(f"删除索引失败 {idx_name}: {e}", category="数据库")
        
        if log_progress:
            if deleted:
                app_logger.system(f"索引清理完成，删除 {len(deleted)} 个冗余索引")
            if failed:
                app_logger.warning(f"索引清理部分失败: {failed}", category="数据库")
        
        return {
            "checked": len(existing_indexes),
            "deleted": len(deleted),
            "deleted_indexes": deleted,
            "failed": failed,
            "skipped": skipped,
            "kept": len(existing_indexes) - len(deleted),
        }

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

    def _do_ensure_indexes(self, log_progress: bool = False, delay_between: float = 0, cleanup_first: bool = True) -> None:
        """
        Internal method to create indexes.
        
        Args:
            log_progress: If True, log each index creation attempt.
            delay_between: Seconds to wait between index creations (reduces DB load).
            cleanup_first: If True, cleanup redundant indexes before creating new ones.
        """
        import time as time_module
        from .logger import logger as app_logger
        
        is_pg = self.config.engine == DatabaseEngine.POSTGRESQL
        
        # Step 1: Cleanup redundant indexes first (if enabled)
        if cleanup_first:
            try:
                cleanup_result = self.cleanup_redundant_indexes(log_progress=log_progress)
                if cleanup_result.get("deleted", 0) > 0:
                    # Small delay after cleanup
                    time_module.sleep(1.0)
            except Exception as e:
                if log_progress:
                    app_logger.warning(f"索引清理失败: {e}", category="数据库")
        
        # Step 2: Create recommended indexes
        # Use the module-level RECOMMENDED_INDEXES constant
        indexes = RECOMMENDED_INDEXES
        
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
                
                # Create index
                columns_str = ", ".join(columns)
                if is_pg:
                    # PostgreSQL: use CONCURRENTLY to avoid locking (requires autocommit)
                    create_sql = f'CREATE INDEX CONCURRENTLY IF NOT EXISTS "{index_name}" ON {table_name} ({columns_str})'
                    # Use execute_ddl for CONCURRENTLY (needs autocommit mode)
                    self.execute_ddl(create_sql)
                else:
                    # MySQL: regular CREATE INDEX
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
        
        # Use RECOMMENDED_INDEXES constant (extract index_name and table_name)
        indexes = [(idx[0], idx[1]) for idx in RECOMMENDED_INDEXES]
        
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

    def get_logs_index_analysis(self) -> dict[str, Any]:
        """
        Get detailed analysis of logs table indexes.
        Shows which indexes are system, ours, redundant, or unknown.
        
        Returns:
            Dictionary with detailed index analysis.
        """
        is_pg = self.config.engine == DatabaseEngine.POSTGRESQL
        system_indexes = SYSTEM_LOGS_INDEXES_PGSQL if is_pg else SYSTEM_LOGS_INDEXES_MYSQL
        
        existing_indexes = self.get_existing_indexes("logs")
        
        analysis = {
            "system": [],      # OneAPI 系统自带
            "ours": [],        # 我们工具创建的
            "redundant": [],   # 冗余可删除
            "unknown": [],     # 未知索引
        }
        
        for idx in existing_indexes:
            if idx in system_indexes:
                analysis["system"].append(idx)
            elif idx in OUR_LOGS_INDEXES:
                analysis["ours"].append(idx)
            elif idx in REDUNDANT_LOGS_INDEXES:
                analysis["redundant"].append(idx)
            else:
                analysis["unknown"].append(idx)
        
        return {
            "total": len(existing_indexes),
            "system_count": len(analysis["system"]),
            "ours_count": len(analysis["ours"]),
            "redundant_count": len(analysis["redundant"]),
            "unknown_count": len(analysis["unknown"]),
            "details": analysis,
            "can_cleanup": len(analysis["redundant"]) > 0,
        }


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

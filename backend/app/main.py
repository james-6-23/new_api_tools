"""
NewAPI Middleware Tool - FastAPI Backend
Main application entry point with CORS, logging, and exception handling.
"""
import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .logger import logger

# Suppress noisy loggers
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("uvicorn.error").setLevel(logging.WARNING)


class ErrorResponse(BaseModel):
    """Standard error response format."""
    success: bool = False
    error: dict[str, Any]


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    version: str


# Custom exceptions
class AppException(Exception):
    """Base application exception."""
    def __init__(self, code: str, message: str, status_code: int = 500, details: Any = None):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(message)


class ContainerNotFoundError(AppException):
    """Raised when NewAPI container is not found."""
    def __init__(self, message: str = "NewAPI container not found"):
        super().__init__(
            code="CONTAINER_NOT_FOUND",
            message=message,
            status_code=503
        )


class DatabaseConnectionError(AppException):
    """Raised when database connection fails."""
    def __init__(self, message: str = "Database connection failed", details: Any = None):
        # Build descriptive error message with connection details
        if details:
            connection_info = []
            if "engine" in details:
                connection_info.append(f"engine={details['engine']}")
            if "host" in details:
                connection_info.append(f"host={details['host']}")
            if "port" in details:
                connection_info.append(f"port={details['port']}")
            if "database" in details:
                connection_info.append(f"database={details['database']}")
            if connection_info:
                message = f"{message} ({', '.join(connection_info)})"
        
        super().__init__(
            code="DB_CONNECTION_FAILED",
            message=message,
            status_code=503,
            details=details
        )


class InvalidParamsError(AppException):
    """Raised when request parameters are invalid."""
    def __init__(self, message: str = "Invalid parameters", details: Any = None):
        super().__init__(
            code="INVALID_PARAMS",
            message=message,
            status_code=400,
            details=details
        )


class UnauthorizedError(AppException):
    """Raised when API key is invalid."""
    def __init__(self, message: str = "Unauthorized"):
        super().__init__(
            code="UNAUTHORIZED",
            message=message,
            status_code=401
        )


class NotFoundError(AppException):
    """Raised when resource is not found."""
    def __init__(self, message: str = "Resource not found"):
        super().__init__(
            code="NOT_FOUND",
            message=message,
            status_code=404
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.system("NewAPI Middleware Tool 启动中...")

    # 初始化数据库连接
    db = None
    try:
        from .database import get_db_manager
        db = get_db_manager()
        db.connect()
        logger.system(f"数据库连接成功: {db.config.engine.value} @ {db.config.host}:{db.config.port}")
        
        # 检查索引状态并输出
        index_status = db.get_index_status()
        if index_status["all_ready"]:
            logger.system(f"索引检查完成: {index_status['existing']}/{index_status['total']} 个索引已就绪")
        else:
            logger.system(f"索引状态: {index_status['existing']}/{index_status['total']} 已存在，{index_status['missing']} 个待创建")
    except Exception as e:
        logger.warning(f"数据库初始化失败: {e}", category="数据库")

    # 启动后台日志同步任务
    sync_task = asyncio.create_task(background_log_sync())

    # 启动后台索引创建任务（仅当有缺失索引时）
    index_task = None
    if db and not index_status.get("all_ready", True):
        index_task = asyncio.create_task(background_ensure_indexes())

    # 启动 AI 自动封禁后台任务
    ai_ban_task = asyncio.create_task(background_ai_auto_ban_scan())

    yield

    # 停止后台任务
    sync_task.cancel()
    ai_ban_task.cancel()
    if index_task:
        index_task.cancel()
    try:
        await sync_task
    except asyncio.CancelledError:
        pass
    try:
        await ai_ban_task
    except asyncio.CancelledError:
        pass
    if index_task:
        try:
            await index_task
        except asyncio.CancelledError:
            pass
    logger.system("NewAPI Middleware Tool 已关闭")


async def background_ensure_indexes():
    """
    Background task to create missing indexes without blocking app startup.
    Creates indexes one by one with delays to minimize database load.
    """
    # Wait a bit for app to fully start
    await asyncio.sleep(5)
    
    try:
        from .database import get_db_manager
        db = get_db_manager()
        
        logger.system("开始后台创建缺失索引...")
        
        # Run index creation in thread pool to avoid blocking event loop
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, db.ensure_indexes_async_safe)
        
        logger.system("后台索引创建完成")
    except asyncio.CancelledError:
        logger.system("索引创建任务已取消")
    except Exception as e:
        logger.warning(f"后台索引创建失败: {e}", category="数据库")


async def background_log_sync():
    """后台定时同步日志分析数据"""
    from .log_analytics_service import get_log_analytics_service

    # 启动后等待 10 秒再开始同步
    await asyncio.sleep(10)
    logger.system("后台日志同步任务已启动")

    while True:
        try:
            service = get_log_analytics_service()

            # 检查是否需要初始化同步，未初始化时跳过自动同步
            sync_status = service.get_sync_status()
            if sync_status.get("needs_initial_sync") or sync_status.get("is_initializing"):
                # 未初始化，跳过自动同步，等待用户手动触发
                await asyncio.sleep(300)
                continue

            # 检查数据一致性
            service.check_and_auto_reset()

            # 处理新日志（每次最多处理 5000 条）
            total_processed = 0
            for _ in range(5):  # 最多 5 轮，每轮 1000 条
                result = service.process_new_logs()
                if not result.get("success") or result.get("processed", 0) == 0:
                    break
                total_processed += result.get("processed", 0)

            if total_processed > 0:
                logger.analytics("后台同步完成", processed=total_processed)

        except Exception as e:
            logger.error(f"后台日志同步失败: {e}", category="任务")

        # 每 5 分钟同步一次
        await asyncio.sleep(300)


async def background_ai_auto_ban_scan():
    """后台定时执行 AI 自动封禁扫描"""
    from .ai_auto_ban_service import get_ai_auto_ban_service

    # 启动后等待 30 秒再开始
    await asyncio.sleep(30)
    logger.system("AI 自动封禁后台任务已启动")

    while True:
        try:
            service = get_ai_auto_ban_service()

            # 检查是否启用定时扫描
            scan_interval = service.get_scan_interval()
            if scan_interval <= 0:
                # 定时扫描已关闭，等待 1 分钟后再检查配置
                await asyncio.sleep(60)
                continue

            # 检查服务是否启用
            if not service.is_enabled():
                await asyncio.sleep(60)
                continue

            # 先等待配置的扫描间隔，再执行扫描
            logger.system(f"AI 自动封禁: 等待 {scan_interval} 分钟后执行定时扫描")
            await asyncio.sleep(scan_interval * 60)
            
            # 再次检查配置（可能在等待期间被修改）
            service = get_ai_auto_ban_service()
            if not service.is_enabled() or service.get_scan_interval() <= 0:
                continue

            # 执行扫描
            logger.system(f"AI 自动封禁: 开始定时扫描 (间隔: {scan_interval}分钟)")
            result = await service.run_scan(window="1h", limit=10)

            if result.get("success"):
                stats = result.get("stats", {})
                if stats.get("total_scanned", 0) > 0:
                    logger.business(
                        "AI 自动封禁定时扫描完成",
                        scanned=stats.get("total_scanned", 0),
                        banned=stats.get("banned", 0),
                        warned=stats.get("warned", 0),
                        dry_run=result.get("dry_run", True),
                    )

        except asyncio.CancelledError:
            logger.system("AI 自动封禁后台任务已取消")
            break
        except Exception as e:
            logger.error(f"AI 自动封禁后台任务异常: {e}", category="任务")
            # 出错后等待 5 分钟再重试
            await asyncio.sleep(300)


# Import routes after app is created to avoid circular imports
def include_routes(app: FastAPI):
    """Include API routes."""
    from .routes import router
    from .auth_routes import router as auth_router
    from .top_up_routes import router as top_up_router
    from .dashboard_routes import router as dashboard_router
    from .storage_routes import router as storage_router
    from .log_analytics_routes import router as analytics_router
    from .user_management_routes import router as user_management_router
    from .risk_monitoring_routes import router as risk_monitoring_router
    from .ip_monitoring_routes import router as ip_monitoring_router
    from .ai_auto_ban_routes import router as ai_auto_ban_router
    app.include_router(router)
    app.include_router(auth_router)
    app.include_router(top_up_router)
    app.include_router(dashboard_router)
    app.include_router(storage_router)
    app.include_router(analytics_router)
    app.include_router(user_management_router)
    app.include_router(risk_monitoring_router)
    app.include_router(ip_monitoring_router)
    app.include_router(ai_auto_ban_router)


# Create FastAPI application
app = FastAPI(
    title="NewAPI Middleware Tool",
    description="API for managing NewAPI redemption codes and database operations",
    version="0.1.0",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Will be configured via environment variable in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
include_routes(app)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all API requests with timestamp and client information."""
    # Skip logging for health check endpoints
    if request.url.path in ["/api/health", "/api/health/db"]:
        return await call_next(request)

    start_time = time.time()
    client_host = request.client.host if request.client else "unknown"

    response = await call_next(request)

    process_time = time.time() - start_time
    status_code = response.status_code

    # Use the new logger for API requests
    if status_code >= 500:
        logger.api_error(
            request.method,
            request.url.path,
            status_code,
            "服务器内部错误",
            client_host
        )
    elif status_code >= 400:
        logger.api_error(
            request.method,
            request.url.path,
            status_code,
            "客户端错误",
            client_host
        )
    else:
        logger.api(
            request.method,
            request.url.path,
            status_code,
            process_time,
            client_host
        )

    return response


@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    """Handle application-specific exceptions."""
    logger.error(f"应用异常: {exc.code} - {exc.message}", category="系统")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details
            }
        }
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions."""
    logger.error(f"未预期异常: {exc}", category="系统", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred",
                "details": None
            }
        }
    )


@app.get("/api/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """Health check endpoint."""
    return HealthResponse(status="healthy", version="0.1.0")


@app.get("/api/health/db", tags=["Health"])
async def database_health_check():
    """Database health check endpoint."""
    from .database import get_db_manager
    
    db = get_db_manager()
    try:
        db.connect()
        return {
            "success": True,
            "status": "connected",
            "engine": db.config.engine.value,
            "host": db.config.host,
            "database": db.config.database,
        }
    except DatabaseConnectionError as e:
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "status": "disconnected",
                "error": {
                    "code": e.code,
                    "message": e.message,
                    "details": e.details
                }
            }
        )

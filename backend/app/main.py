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

    # 初始化数据库索引（优化查询性能）
    try:
        from .database import get_db_manager
        db = get_db_manager()
        db.connect()
        db.ensure_indexes()
    except Exception as e:
        logger.warning(f"索引初始化跳过: {e}", category="数据库")

    # 启动后台日志同步任务
    sync_task = asyncio.create_task(background_log_sync())

    yield

    # 停止后台任务
    sync_task.cancel()
    try:
        await sync_task
    except asyncio.CancelledError:
        pass
    logger.system("NewAPI Middleware Tool 已关闭")


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
    app.include_router(router)
    app.include_router(auth_router)
    app.include_router(top_up_router)
    app.include_router(dashboard_router)
    app.include_router(storage_router)
    app.include_router(analytics_router)
    app.include_router(user_management_router)
    app.include_router(risk_monitoring_router)


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

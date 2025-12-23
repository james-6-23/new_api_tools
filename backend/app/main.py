"""
NewAPI Middleware Tool - FastAPI Backend
Main application entry point with CORS, logging, and exception handling.
"""
import logging
import sys
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

# Suppress noisy loggers
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)


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
    logger.info("Starting NewAPI Middleware Tool...")
    yield
    logger.info("Shutting down NewAPI Middleware Tool...")


# Import routes after app is created to avoid circular imports
def include_routes(app: FastAPI):
    """Include API routes."""
    from .routes import router
    from .auth_routes import router as auth_router
    from .top_up_routes import router as top_up_router
    from .dashboard_routes import router as dashboard_router
    app.include_router(router)
    app.include_router(auth_router)
    app.include_router(top_up_router)
    app.include_router(dashboard_router)


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

    # Use different log levels based on status code
    log_msg = f"{request.method} {request.url.path} | {status_code} | {process_time:.3f}s | {client_host}"

    if status_code >= 500:
        logger.error(log_msg)
    elif status_code >= 400:
        logger.warning(log_msg)
    else:
        logger.info(log_msg)

    return response


@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    """Handle application-specific exceptions."""
    logger.error(f"AppException: {exc.code} - {exc.message}")
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
    logger.exception(f"Unexpected error: {exc}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred",
                "details": str(exc) if logger.level == logging.DEBUG else None
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

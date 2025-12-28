"""
Authentication module for NewAPI Middleware Tool.
Implements API Key authentication middleware and JWT-based frontend authentication.
"""
import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import APIKeyHeader, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Configuration from environment variables
API_KEY = os.getenv("API_KEY", "")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "newapi-middleware-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Security schemes
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_scheme = HTTPBearer(auto_error=False)


class TokenData(BaseModel):
    """JWT token payload data."""
    sub: str
    exp: datetime


class LoginRequest(BaseModel):
    """Login request model."""
    password: str


class LoginResponse(BaseModel):
    """Login response model."""
    success: bool
    message: str
    token: Optional[str] = None
    expires_at: Optional[str] = None


class LogoutResponse(BaseModel):
    """Logout response model."""
    success: bool
    message: str


def verify_api_key(api_key: str) -> bool:
    """Verify if the provided API key is valid."""
    if not API_KEY:
        # If no API key is configured, allow all requests (development mode)
        logger.warning("No API_KEY configured - running in development mode")
        return True
    return api_key == API_KEY


def verify_password(plain_password: str) -> bool:
    """Verify if the provided password matches the admin password."""
    if not ADMIN_PASSWORD:
        logger.warning("No ADMIN_PASSWORD configured")
        return False
    return plain_password == ADMIN_PASSWORD


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> Optional[TokenData]:
    """Decode and validate a JWT access token."""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        sub: str = payload.get("sub")
        exp: datetime = datetime.fromtimestamp(payload.get("exp"), tz=timezone.utc)
        if sub is None:
            return None
        return TokenData(sub=sub, exp=exp)
    except JWTError as e:
        logger.debug(f"JWT decode error: {e}")
        return None


async def verify_auth(
    request: Request,
    api_key: Optional[str] = Depends(api_key_header),
    credentials = Depends(bearer_scheme),
) -> str:
    """
    Dependency to verify authentication via API Key OR JWT Token.
    Accepts either X-API-Key header or Authorization: Bearer token.
    Returns 'api_key' or 'jwt' to indicate which auth method was used.
    """
    # Skip authentication for health check endpoints
    if request.url.path in ["/api/health", "/api/health/db", "/docs", "/openapi.json", "/redoc"]:
        return "skip"

    # Skip authentication for auth endpoints (login/logout)
    if request.url.path.startswith("/api/auth/"):
        return "skip"

    # Try API Key authentication first
    if api_key is not None:
        if verify_api_key(api_key):
            return "api_key"
        else:
            logger.warning(f"Invalid API key for request: {request.method} {request.url.path}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "success": False,
                    "error": {
                        "code": "UNAUTHORIZED",
                        "message": "Invalid API key",
                    }
                },
            )

    # Try JWT Token authentication
    if credentials is not None:
        token_data = decode_access_token(credentials.credentials)
        if token_data is not None:
            return "jwt"
        else:
            # 不在这里打印日志，由中间件统一记录 401 错误
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "success": False,
                    "error": {
                        "code": "UNAUTHORIZED",
                        "message": "Invalid or expired token",
                    }
                },
                headers={"WWW-Authenticate": "Bearer"},
            )

    # No authentication provided
    logger.warning(f"Missing authentication for request: {request.method} {request.url.path}")
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={
            "success": False,
            "error": {
                "code": "UNAUTHORIZED",
                "message": "Authentication required (API Key or JWT Token)",
            }
        },
    )


async def get_current_user(
    request: Request,
    credentials = Depends(bearer_scheme),
) -> Optional[TokenData]:
    """
    Dependency to extract and validate JWT token from Authorization header.
    Returns TokenData if valid, raises HTTPException if invalid.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "error": {
                    "code": "UNAUTHORIZED",
                    "message": "Authentication required",
                }
            },
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token_data = decode_access_token(credentials.credentials)
    if token_data is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "error": {
                    "code": "UNAUTHORIZED",
                    "message": "Invalid or expired token",
                }
            },
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return token_data

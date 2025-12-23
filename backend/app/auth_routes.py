"""
Authentication routes for NewAPI Middleware Tool.
Implements login and logout endpoints for frontend password authentication.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request

from .auth import (
    JWT_EXPIRE_HOURS,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    create_access_token,
    verify_password,
)
from .logger import logger

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest, req: Request):
    """
    Frontend password authentication endpoint.

    - **password**: Admin password for frontend access

    Returns JWT token on successful authentication.
    """
    client_ip = req.client.host if req.client else "unknown"

    if not verify_password(request.password):
        logger.auth_fail("登录失败: 密码错误", ip=client_ip)
        return LoginResponse(
            success=False,
            message="Incorrect password",
        )

    # Create JWT token
    expires_delta = timedelta(hours=JWT_EXPIRE_HOURS)
    expires_at = datetime.now(timezone.utc) + expires_delta
    access_token = create_access_token(
        data={"sub": "admin"},
        expires_delta=expires_delta,
    )

    logger.auth("管理员登录成功", ip=client_ip)
    return LoginResponse(
        success=True,
        message="Login successful",
        token=access_token,
        expires_at=expires_at.isoformat(),
    )


@router.post("/logout", response_model=LogoutResponse)
async def logout():
    """
    Logout endpoint.

    Since JWT tokens are stateless, this endpoint simply returns success.
    The frontend should clear the stored token.
    """
    logger.auth("用户登出")
    return LogoutResponse(
        success=True,
        message="Logout successful",
    )

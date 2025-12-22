"""
Authentication routes for NewAPI Middleware Tool.
Implements login and logout endpoints for frontend password authentication.
"""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from .auth import (
    JWT_EXPIRE_HOURS,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    create_access_token,
    verify_password,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """
    Frontend password authentication endpoint.
    
    - **password**: Admin password for frontend access
    
    Returns JWT token on successful authentication.
    """
    if not verify_password(request.password):
        logger.warning("Failed login attempt with incorrect password")
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
    
    logger.info("Successful login")
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
    logger.info("User logged out")
    return LogoutResponse(
        success=True,
        message="Logout successful",
    )

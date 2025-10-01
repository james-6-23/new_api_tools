"""
应用配置管理 - 精简版
"""
from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import validator


class Settings(BaseSettings):
    """应用配置"""
    
    # 应用信息
    APP_NAME: str = "NewAPI Statistics Tool"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = False
    
    # API 配置
    API_V1_PREFIX: str = "/api/v1"
    BACKEND_CORS_ORIGINS: List[str] = ["http://localhost:3000"]
    
    # NewAPI 配置（核心）
    NEWAPI_BASE_URL: str = "https://api.kkyyxx.xyz"
    NEWAPI_SESSION: str  # 必须从环境变量提供
    NEWAPI_USER_ID: str = "1"
    
    # Redis 缓存（可选）
    REDIS_URL: Optional[str] = None
    CACHE_TTL: int = 300  # 5分钟缓存
    
    # 日志配置
    LOG_LEVEL: str = "INFO"
    
    @validator("BACKEND_CORS_ORIGINS", pre=True)
    def assemble_cors_origins(cls, v: str | List[str]) -> List[str] | str:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, (list, str)):
            return v
        raise ValueError(v)
    
    class Config:
        env_file = ".env"
        case_sensitive = True


# 全局配置实例
settings = Settings()



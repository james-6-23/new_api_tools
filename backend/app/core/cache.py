"""
Redis 缓存服务
"""
import json
from typing import Any, Optional
import redis.asyncio as aioredis
from app.config import settings

# 全局 Redis 连接池
redis_client: Optional[aioredis.Redis] = None


async def init_redis():
    """初始化 Redis 连接"""
    global redis_client
    redis_client = await aioredis.from_url(
        settings.redis_url,
        encoding="utf-8",
        decode_responses=True,
        max_connections=50
    )
    return redis_client


async def close_redis():
    """关闭 Redis 连接"""
    global redis_client
    if redis_client:
        await redis_client.close()


def get_redis() -> aioredis.Redis:
    """获取 Redis 客户端"""
    if redis_client is None:
        raise RuntimeError("Redis not initialized")
    return redis_client


class CacheService:
    """缓存服务类"""
    
    def __init__(self):
        self.redis = get_redis()
        self.default_ttl = settings.CACHE_TTL
    
    async def get(self, key: str) -> Optional[Any]:
        """获取缓存"""
        value = await self.redis.get(key)
        if value:
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
        return None
    
    async def set(self, key: str, value: Any, ttl: Optional[int] = None) -> bool:
        """设置缓存"""
        ttl = ttl or self.default_ttl
        if not isinstance(value, str):
            value = json.dumps(value, ensure_ascii=False)
        return await self.redis.setex(key, ttl, value)
    
    async def delete(self, key: str) -> bool:
        """删除缓存"""
        return await self.redis.delete(key) > 0
    
    async def exists(self, key: str) -> bool:
        """检查缓存是否存在"""
        return await self.redis.exists(key) > 0
    
    async def incr(self, key: str, amount: int = 1) -> int:
        """递增计数器"""
        return await self.redis.incrby(key, amount)
    
    async def expire(self, key: str, ttl: int) -> bool:
        """设置过期时间"""
        return await self.redis.expire(key, ttl)
    
    async def keys(self, pattern: str) -> list:
        """获取匹配的键"""
        return await self.redis.keys(pattern)
    
    async def clear_pattern(self, pattern: str) -> int:
        """清除匹配模式的所有键"""
        keys = await self.keys(pattern)
        if keys:
            return await self.redis.delete(*keys)
        return 0


# 依赖注入
def get_cache_service() -> CacheService:
    """获取缓存服务实例"""
    return CacheService()



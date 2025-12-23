"""
Cache decorator and utilities for API response caching.
Uses local SQLite storage to reduce database query load.
"""
import functools
import hashlib
import json
import logging
import time
from typing import Any, Callable, Optional

from .local_storage import get_local_storage

logger = logging.getLogger(__name__)


def cache_key(*args, **kwargs) -> str:
    """Generate a cache key from arguments."""
    key_data = json.dumps({"args": args, "kwargs": kwargs}, sort_keys=True, default=str)
    return hashlib.md5(key_data.encode()).hexdigest()


def cached(
    prefix: str,
    ttl: int = 300,
    key_builder: Optional[Callable[..., str]] = None,
):
    """
    Decorator for caching function results.

    Args:
        prefix: Cache key prefix (e.g., 'dashboard:overview')
        ttl: Time to live in seconds (default 5 minutes)
        key_builder: Optional function to build cache key from arguments

    Usage:
        @cached("dashboard:overview", ttl=60)
        def get_overview():
            return expensive_query()

        @cached("user:stats", ttl=300, key_builder=lambda user_id: f"user:{user_id}")
        def get_user_stats(user_id):
            return expensive_query(user_id)
    """
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            storage = get_local_storage()

            # Build cache key
            if key_builder:
                suffix = key_builder(*args, **kwargs)
            else:
                suffix = cache_key(*args, **kwargs)

            full_key = f"{prefix}:{suffix}" if suffix else prefix

            # Try to get from cache
            cached_value = storage.cache_get(full_key)
            if cached_value is not None:
                logger.debug(f"Cache hit: {full_key}")
                return cached_value

            # Execute function and cache result
            logger.debug(f"Cache miss: {full_key}")
            result = func(*args, **kwargs)

            # Cache the result
            try:
                storage.cache_set(full_key, result, ttl=ttl)
            except Exception as e:
                logger.warning(f"Failed to cache result for {full_key}: {e}")

            return result

        # Add cache control methods
        wrapper.invalidate = lambda *a, **kw: _invalidate_cache(prefix, key_builder, *a, **kw)
        wrapper.cache_prefix = prefix

        return wrapper

    return decorator


def _invalidate_cache(prefix: str, key_builder: Optional[Callable], *args, **kwargs):
    """Invalidate cache for a specific key or pattern."""
    storage = get_local_storage()

    if key_builder and (args or kwargs):
        suffix = key_builder(*args, **kwargs)
        full_key = f"{prefix}:{suffix}"
        storage.cache_delete(full_key)
        logger.debug(f"Invalidated cache: {full_key}")
    else:
        # Clear all with this prefix
        deleted = storage.cache_clear(f"{prefix}:%")
        logger.debug(f"Invalidated {deleted} cache entries with prefix: {prefix}")


def invalidate_cache_pattern(pattern: str) -> int:
    """
    Invalidate all cache entries matching a pattern.

    Args:
        pattern: SQL LIKE pattern (e.g., 'dashboard:%')

    Returns:
        Number of entries invalidated
    """
    storage = get_local_storage()
    return storage.cache_clear(pattern)


def get_cache_stats() -> dict:
    """Get cache statistics."""
    storage = get_local_storage()
    info = storage.get_storage_info()
    return {
        "cache_entries": info["cache_entries"],
        "db_size_mb": info["db_size_mb"],
    }


class CacheManager:
    """
    Manager for cache operations and maintenance.
    """

    def __init__(self):
        self.storage = get_local_storage()

    def cleanup(self) -> dict:
        """Run cache cleanup tasks."""
        expired = self.storage.cache_cleanup_expired()
        old_snapshots = self.storage.cleanup_old_snapshots(max_age_days=30)
        return {
            "expired_cache_entries": expired,
            "old_snapshots": old_snapshots,
        }

    def clear_all(self) -> int:
        """Clear all cache entries."""
        return self.storage.cache_clear()

    def clear_dashboard(self) -> int:
        """Clear dashboard-related cache."""
        return self.storage.cache_clear("dashboard:%")

    def clear_stats(self) -> int:
        """Clear statistics cache."""
        return self.storage.cache_clear("stats:%")

    def get_info(self) -> dict:
        """Get cache storage info."""
        return self.storage.get_storage_info()


# Global cache manager instance
_cache_manager: Optional[CacheManager] = None


def get_cache_manager() -> CacheManager:
    """Get the global CacheManager instance."""
    global _cache_manager
    if _cache_manager is None:
        _cache_manager = CacheManager()
    return _cache_manager

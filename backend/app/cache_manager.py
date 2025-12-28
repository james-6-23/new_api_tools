"""
统一缓存管理器 - SQLite + Redis 混合缓存

优先级：Redis (L1) → SQLite (L2) → PostgreSQL (L3, 只读)

特点：
- SQLite 必选：本地持久化，重启秒恢复
- Redis 可选：高性能缓存，不可用时降级到 SQLite
- PostgreSQL 只读：不写入任何数据，确保 NewAPI 正常运行
"""
import json
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from .logger import logger


class CacheManager:
    """
    统一缓存管理器
    
    三层缓存架构：
    - L1 Redis: 高性能热缓存（可选）
    - L2 SQLite: 本地持久化缓存（必选）
    - L3 PostgreSQL: 只读数据源
    """
    
    _instance: Optional['CacheManager'] = None
    _lock = threading.Lock()
    
    def __init__(self):
        self._sqlite_path = Path("data/cache.db")
        self._sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._redis = None
        self._redis_available = False
        
        self._init_sqlite()
        self._init_redis()
    
    @classmethod
    def get_instance(cls) -> 'CacheManager':
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance
    
    # ==================== SQLite 初始化 ====================
    
    def _init_sqlite(self):
        """初始化 SQLite 缓存数据库"""
        schema = '''
        -- 排行榜缓存表
        CREATE TABLE IF NOT EXISTS leaderboard_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            window TEXT NOT NULL,
            sort_by TEXT NOT NULL,
            data TEXT NOT NULL,
            snapshot_time INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            UNIQUE(window, sort_by)
        );
        
        -- IP 监控缓存表
        CREATE TABLE IF NOT EXISTS ip_monitoring_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            window TEXT NOT NULL,
            data TEXT NOT NULL,
            snapshot_time INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            UNIQUE(type, window)
        );
        
        -- 通用缓存表（用于其他数据）
        CREATE TABLE IF NOT EXISTS generic_cache (
            key TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            snapshot_time INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
        
        -- 同步状态表
        CREATE TABLE IF NOT EXISTS sync_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        
        -- 索引
        CREATE INDEX IF NOT EXISTS idx_leaderboard_expires 
            ON leaderboard_cache(expires_at);
        CREATE INDEX IF NOT EXISTS idx_ip_monitoring_expires 
            ON ip_monitoring_cache(expires_at);
        CREATE INDEX IF NOT EXISTS idx_generic_expires 
            ON generic_cache(expires_at);
        '''
        
        try:
            conn = sqlite3.connect(str(self._sqlite_path))
            conn.executescript(schema)
            conn.commit()
            conn.close()
            logger.debug("[缓存] SQLite 初始化完成")
        except Exception as e:
            logger.error(f"[缓存] SQLite 初始化失败: {e}")
    
    @contextmanager
    def _get_sqlite(self):
        """获取 SQLite 连接（线程安全）"""
        if not hasattr(self._local, 'conn') or self._local.conn is None:
            self._local.conn = sqlite3.connect(
                str(self._sqlite_path),
                check_same_thread=False,
                timeout=30.0
            )
            self._local.conn.row_factory = sqlite3.Row
            self._local.conn.execute("PRAGMA journal_mode=WAL")
            self._local.conn.execute("PRAGMA synchronous=NORMAL")
        
        try:
            yield self._local.conn
        except Exception:
            self._local.conn.rollback()
            raise

    # ==================== Redis 初始化（可选）====================
    
    def _init_redis(self):
        """初始化 Redis 连接（可选）"""
        redis_host = os.getenv('REDIS_HOST', '').strip()
        if not redis_host:
            logger.system("[缓存] Redis 未配置，使用纯 SQLite 模式")
            return
        
        try:
            import redis
            self._redis = redis.Redis(
                host=redis_host,
                port=int(os.getenv('REDIS_PORT', 6379)),
                password=os.getenv('REDIS_PASSWORD', '').strip() or None,
                db=int(os.getenv('REDIS_DB', 0)),
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
            )
            self._redis.ping()
            self._redis_available = True
            logger.success("Redis 连接成功", host=redis_host)
        except ImportError:
            logger.bullet("redis 库未安装，使用纯 SQLite 模式")
            self._redis_available = False
        except Exception as e:
            logger.warn(f"Redis 连接失败: {e}，降级到 SQLite")
            self._redis_available = False
    
    @property
    def redis_available(self) -> bool:
        """检查 Redis 是否可用"""
        if not self._redis_available or self._redis is None:
            return False
        try:
            self._redis.ping()
            return True
        except Exception:
            self._redis_available = False
            return False
    
    # ==================== 排行榜缓存 ====================
    
    def get_leaderboard(
        self,
        window: str,
        sort_by: str = "requests",
        limit: int = 10
    ) -> Optional[List[Dict]]:
        """
        获取排行榜缓存
        优先级：Redis → SQLite
        """
        cache_key = f"lb:{window}:{sort_by}"
        
        # L1: 尝试 Redis
        if self.redis_available:
            try:
                data = self._redis.get(cache_key)
                if data:
                    result = json.loads(data)
                    return result[:limit]
            except Exception as e:
                logger.debug(f"[缓存] Redis 读取失败: {e}")
        
        # L2: 尝试 SQLite
        now = int(time.time())
        try:
            with self._get_sqlite() as conn:
                row = conn.execute('''
                    SELECT data FROM leaderboard_cache
                    WHERE window = ? AND sort_by = ? AND expires_at > ?
                ''', (window, sort_by, now)).fetchone()
                
                if row:
                    result = json.loads(row['data'])
                    return result[:limit]
        except Exception as e:
            logger.debug(f"[缓存] SQLite 读取失败: {e}")
        
        return None
    
    def set_leaderboard(
        self,
        window: str,
        sort_by: str,
        data: List[Dict],
        ttl: int = 300
    ):
        """
        保存排行榜缓存
        同时写入 Redis 和 SQLite
        """
        now = int(time.time())
        cache_key = f"lb:{window}:{sort_by}"
        json_data = json.dumps(data, ensure_ascii=False)
        
        # L1: 写入 Redis
        if self.redis_available:
            try:
                self._redis.setex(cache_key, ttl, json_data)
            except Exception as e:
                logger.debug(f"[缓存] Redis 写入失败: {e}")
        
        # L2: 写入 SQLite（TTL 更长，作为持久化备份）
        sqlite_ttl = max(ttl * 2, 3600)  # 至少 1 小时
        try:
            with self._get_sqlite() as conn:
                conn.execute('''
                    INSERT OR REPLACE INTO leaderboard_cache
                    (window, sort_by, data, snapshot_time, expires_at)
                    VALUES (?, ?, ?, ?, ?)
                ''', (window, sort_by, json_data, now, now + sqlite_ttl))
                conn.commit()
        except Exception as e:
            logger.warning(f"[缓存] SQLite 写入失败: {e}")

    # ==================== IP 监控缓存 ====================
    
    def get_ip_monitoring(
        self,
        type_name: str,
        window: str,
        limit: int = 50
    ) -> Optional[List[Dict]]:
        """获取 IP 监控缓存"""
        cache_key = f"ip:{type_name}:{window}"
        
        # L1: Redis
        if self.redis_available:
            try:
                data = self._redis.get(cache_key)
                if data:
                    return json.loads(data)[:limit]
            except Exception:
                pass
        
        # L2: SQLite
        now = int(time.time())
        try:
            with self._get_sqlite() as conn:
                row = conn.execute('''
                    SELECT data FROM ip_monitoring_cache
                    WHERE type = ? AND window = ? AND expires_at > ?
                ''', (type_name, window, now)).fetchone()
                
                if row:
                    return json.loads(row['data'])[:limit]
        except Exception:
            pass
        
        return None
    
    def set_ip_monitoring(
        self,
        type_name: str,
        window: str,
        data: List[Dict],
        ttl: int = 300
    ):
        """保存 IP 监控缓存"""
        now = int(time.time())
        cache_key = f"ip:{type_name}:{window}"
        json_data = json.dumps(data, ensure_ascii=False)
        
        # L1: Redis
        if self.redis_available:
            try:
                self._redis.setex(cache_key, ttl, json_data)
            except Exception:
                pass
        
        # L2: SQLite
        sqlite_ttl = max(ttl * 2, 3600)
        try:
            with self._get_sqlite() as conn:
                conn.execute('''
                    INSERT OR REPLACE INTO ip_monitoring_cache
                    (type, window, data, snapshot_time, expires_at)
                    VALUES (?, ?, ?, ?, ?)
                ''', (type_name, window, json_data, now, now + sqlite_ttl))
                conn.commit()
        except Exception as e:
            logger.warning(f"[缓存] IP监控写入失败: {e}")
    
    # ==================== 通用缓存 ====================
    
    def get(self, key: str) -> Optional[Any]:
        """获取通用缓存"""
        # L1: Redis
        if self.redis_available:
            try:
                data = self._redis.get(f"cache:{key}")
                if data:
                    return json.loads(data)
            except Exception:
                pass
        
        # L2: SQLite
        now = int(time.time())
        try:
            with self._get_sqlite() as conn:
                row = conn.execute('''
                    SELECT data FROM generic_cache
                    WHERE key = ? AND expires_at > ?
                ''', (key, now)).fetchone()
                
                if row:
                    return json.loads(row['data'])
        except Exception:
            pass
        
        return None
    
    def set(self, key: str, data: Any, ttl: int = 300):
        """设置通用缓存"""
        now = int(time.time())
        json_data = json.dumps(data, ensure_ascii=False)
        
        # L1: Redis
        if self.redis_available:
            try:
                self._redis.setex(f"cache:{key}", ttl, json_data)
            except Exception:
                pass
        
        # L2: SQLite
        sqlite_ttl = max(ttl * 2, 3600)
        try:
            with self._get_sqlite() as conn:
                conn.execute('''
                    INSERT OR REPLACE INTO generic_cache
                    (key, data, snapshot_time, expires_at)
                    VALUES (?, ?, ?, ?)
                ''', (key, json_data, now, now + sqlite_ttl))
                conn.commit()
        except Exception:
            pass

    # ==================== 同步状态 ====================
    
    def get_sync_state(self, key: str) -> Optional[str]:
        """获取同步状态"""
        try:
            with self._get_sqlite() as conn:
                row = conn.execute(
                    "SELECT value FROM sync_state WHERE key = ?", (key,)
                ).fetchone()
                return row['value'] if row else None
        except Exception:
            return None
    
    def set_sync_state(self, key: str, value: str):
        """设置同步状态"""
        now = int(time.time())
        try:
            with self._get_sqlite() as conn:
                conn.execute('''
                    INSERT OR REPLACE INTO sync_state (key, value, updated_at)
                    VALUES (?, ?, ?)
                ''', (key, value, now))
                conn.commit()
        except Exception as e:
            logger.warning(f"[缓存] 同步状态写入失败: {e}")
    
    # ==================== 启动恢复 ====================
    
    def restore_to_redis(self) -> int:
        """
        从 SQLite 恢复数据到 Redis（启动时调用）
        返回恢复的条目数
        """
        if not self.redis_available:
            return 0
        
        now = int(time.time())
        restored = 0
        
        try:
            with self._get_sqlite() as conn:
                # 恢复排行榜
                rows = conn.execute('''
                    SELECT window, sort_by, data, expires_at 
                    FROM leaderboard_cache WHERE expires_at > ?
                ''', (now,)).fetchall()
                
                for row in rows:
                    ttl = row['expires_at'] - now
                    if ttl > 0:
                        try:
                            self._redis.setex(
                                f"lb:{row['window']}:{row['sort_by']}",
                                ttl,
                                row['data']
                            )
                            restored += 1
                        except Exception:
                            pass
                
                # 恢复 IP 监控
                rows = conn.execute('''
                    SELECT type, window, data, expires_at
                    FROM ip_monitoring_cache WHERE expires_at > ?
                ''', (now,)).fetchall()
                
                for row in rows:
                    ttl = row['expires_at'] - now
                    if ttl > 0:
                        try:
                            self._redis.setex(
                                f"ip:{row['type']}:{row['window']}",
                                ttl,
                                row['data']
                            )
                            restored += 1
                        except Exception:
                            pass
                
                # 恢复通用缓存
                rows = conn.execute('''
                    SELECT key, data, expires_at
                    FROM generic_cache WHERE expires_at > ?
                ''', (now,)).fetchall()
                
                for row in rows:
                    ttl = row['expires_at'] - now
                    if ttl > 0:
                        try:
                            self._redis.setex(
                                f"cache:{row['key']}",
                                ttl,
                                row['data']
                            )
                            restored += 1
                        except Exception:
                            pass
        
        except Exception as e:
            logger.warn(f"恢复到 Redis 失败: {e}")

        if restored > 0:
            logger.success("从 SQLite 恢复缓存到 Redis", count=restored)

        return restored

    # ==================== 清理和统计 ====================
    
    def cleanup_expired(self) -> int:
        """清理过期数据"""
        now = int(time.time())
        total = 0
        
        try:
            with self._get_sqlite() as conn:
                for table in ['leaderboard_cache', 'ip_monitoring_cache', 'generic_cache']:
                    cursor = conn.execute(
                        f"DELETE FROM {table} WHERE expires_at < ?", (now,)
                    )
                    total += cursor.rowcount
                conn.commit()
        except Exception as e:
            logger.warning(f"[缓存] 清理过期数据失败: {e}")
        
        return total
    
    def clear_all(self):
        """清空所有缓存"""
        # 清空 Redis
        if self.redis_available:
            try:
                # 只清除本应用的 key
                for pattern in ['lb:*', 'ip:*', 'cache:*']:
                    for key in self._redis.scan_iter(pattern):
                        self._redis.delete(key)
            except Exception:
                pass
        
        # 清空 SQLite
        try:
            with self._get_sqlite() as conn:
                for table in ['leaderboard_cache', 'ip_monitoring_cache', 'generic_cache']:
                    conn.execute(f"DELETE FROM {table}")
                conn.commit()
        except Exception:
            pass
        
        logger.system("[缓存] 已清空所有缓存")
    
    def get_stats(self) -> Dict[str, Any]:
        """获取缓存统计信息"""
        stats = {
            "redis_available": self.redis_available,
            "sqlite_path": str(self._sqlite_path),
            "sqlite_size_mb": 0,
            "leaderboard_count": 0,
            "ip_monitoring_count": 0,
            "generic_count": 0,
        }
        
        try:
            if self._sqlite_path.exists():
                stats["sqlite_size_mb"] = round(
                    self._sqlite_path.stat().st_size / (1024 * 1024), 2
                )
        except Exception:
            pass
        
        try:
            with self._get_sqlite() as conn:
                for table, key in [
                    ('leaderboard_cache', 'leaderboard_count'),
                    ('ip_monitoring_cache', 'ip_monitoring_count'),
                    ('generic_cache', 'generic_count'),
                ]:
                    row = conn.execute(f"SELECT COUNT(*) as c FROM {table}").fetchone()
                    stats[key] = row['c'] if row else 0
        except Exception:
            pass
        
        return stats
    
    def get_cached_windows(self) -> List[str]:
        """获取已缓存的时间窗口列表"""
        windows = set()
        now = int(time.time())
        
        try:
            with self._get_sqlite() as conn:
                rows = conn.execute('''
                    SELECT DISTINCT window FROM leaderboard_cache
                    WHERE expires_at > ?
                ''', (now,)).fetchall()
                
                for row in rows:
                    windows.add(row['window'])
        except Exception:
            pass
        
        return list(windows)


# 全局实例获取函数
def get_cache_manager() -> CacheManager:
    """获取缓存管理器单例"""
    return CacheManager.get_instance()

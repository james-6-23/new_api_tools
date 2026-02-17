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


# ==================== 增量缓存配置 ====================

# 时间槽配置：只对 3d、7d、14d 使用增量缓存
# 格式: {window: (slot_size_seconds, slot_count, ttl_seconds)}
SLOT_CONFIG = {
    "3d": {
        "slot_size": 6 * 3600,    # 6 小时一个槽
        "slot_count": 12,          # 12 个槽
        "ttl": 7 * 24 * 3600,      # 槽缓存 7 天过期
    },
    "7d": {
        "slot_size": 12 * 3600,   # 12 小时一个槽
        "slot_count": 14,          # 14 个槽
        "ttl": 14 * 24 * 3600,     # 槽缓存 14 天过期
    },
    "14d": {
        "slot_size": 24 * 3600,   # 24 小时一个槽
        "slot_count": 14,          # 14 个槽
        "ttl": 21 * 24 * 3600,     # 槽缓存 21 天过期
    },
}

# IP 监控类型列表
IP_MONITOR_TYPES = ["shared_ips", "multi_ip_tokens", "multi_ip_users"]

# Dashboard 类型列表（支持增量缓存）
DASHBOARD_TYPES = ["model_usage", "usage_stats", "top_users"]


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

        -- 时间槽缓存表（用于 3d/7d 增量缓存）
        -- 存储每个时间槽内的用户聚合数据，支持跨槽聚合
        CREATE TABLE IF NOT EXISTS slot_cache (
            slot_key TEXT PRIMARY KEY,       -- 格式: "window:sort_by:slot_start" 如 "3d:requests:1735488000"
            window TEXT NOT NULL,            -- 时间窗口类型: "3d" 或 "7d"
            sort_by TEXT NOT NULL,           -- 排序方式: "requests", "quota", "failure_rate"
            slot_start INTEGER NOT NULL,     -- 槽开始时间戳
            slot_end INTEGER NOT NULL,       -- 槽结束时间戳
            data TEXT NOT NULL,              -- JSON: 用户聚合数据列表
            created_at INTEGER NOT NULL,     -- 创建时间
            expires_at INTEGER NOT NULL      -- 过期时间
        );

        -- 索引
        CREATE INDEX IF NOT EXISTS idx_leaderboard_expires
            ON leaderboard_cache(expires_at);
        CREATE INDEX IF NOT EXISTS idx_slot_cache_window
            ON slot_cache(window, sort_by, slot_start);
        CREATE INDEX IF NOT EXISTS idx_slot_cache_expires
            ON slot_cache(expires_at);
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
                    logger.info(f"[缓存命中] Redis ✓ 排行榜 window={window} sort={sort_by}", category="缓存")
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
                    logger.info(f"[缓存命中] SQLite ✓ 排行榜 window={window} sort={sort_by}", category="缓存")
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
                    logger.info(f"[缓存命中] Redis ✓ IP监控 type={type_name} window={window}", category="缓存")
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
                    logger.info(f"[缓存命中] SQLite ✓ IP监控 type={type_name} window={window}", category="缓存")
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
                    logger.info(f"[缓存命中] Redis ✓ key={key}", category="缓存")
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
                    logger.info(f"[缓存命中] SQLite ✓ key={key}", category="缓存")
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

    def clear_generic_prefix(self, prefix: str) -> int:
        """
        清除通用缓存（generic_cache）中以 prefix 开头的 key。

        用途：
        - Dashboard 缓存失效（dashboard:*）
        - IP 分布缓存失效（ip_dist:*）
        """
        if not prefix:
            return 0

        deleted = 0

        # L1: Redis
        if self.redis_available:
            try:
                for redis_key in self._redis.scan_iter(f"cache:{prefix}*"):
                    deleted += int(self._redis.delete(redis_key) or 0)
            except Exception:
                pass

        # L2: SQLite
        try:
            with self._get_sqlite() as conn:
                cursor = conn.execute(
                    "DELETE FROM generic_cache WHERE key LIKE ?",
                    (f"{prefix}%",),
                )
                deleted += int(cursor.rowcount or 0)
                conn.commit()
        except Exception:
            pass

        return deleted

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
        """清理过期数据（包括槽缓存）"""
        now = int(time.time())
        total = 0

        try:
            with self._get_sqlite() as conn:
                # 清理常规缓存表
                for table in ['leaderboard_cache', 'ip_monitoring_cache', 'generic_cache', 'slot_cache']:
                    cursor = conn.execute(
                        f"DELETE FROM {table} WHERE expires_at < ?", (now,)
                    )
                    total += cursor.rowcount
                conn.commit()
        except Exception as e:
            logger.warning(f"[缓存] 清理过期数据失败: {e}")

        return total
    
    def clear_all(self):
        """清空所有缓存（包括槽缓存）"""
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
                for table in ['leaderboard_cache', 'ip_monitoring_cache', 'generic_cache', 'slot_cache']:
                    conn.execute(f"DELETE FROM {table}")
                conn.commit()
        except Exception:
            pass

        logger.system("[缓存] 已清空所有缓存（含槽缓存）")
    
    def get_stats(self) -> Dict[str, Any]:
        """获取缓存统计信息（含槽缓存）"""
        stats = {
            "redis_available": self.redis_available,
            "sqlite_path": str(self._sqlite_path),
            "sqlite_size_mb": 0,
            "leaderboard_count": 0,
            "ip_monitoring_count": 0,
            "generic_count": 0,
            "slot_count": 0,
            "slot_stats": {},
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
                    ('slot_cache', 'slot_count'),
                ]:
                    row = conn.execute(f"SELECT COUNT(*) as c FROM {table}").fetchone()
                    stats[key] = row['c'] if row else 0

                # 槽缓存详细统计
                stats["slot_stats"] = self.get_slot_stats()
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

    # ==================== 时间槽缓存（3d/7d 增量） ====================

    def get_slot_config(self, window: str) -> Optional[Dict]:
        """获取时间窗口的槽配置"""
        return SLOT_CONFIG.get(window)

    def is_incremental_window(self, window: str) -> bool:
        """判断是否使用增量缓存的窗口"""
        return window in SLOT_CONFIG

    def calculate_slots(self, window: str, now: Optional[int] = None) -> List[Dict]:
        """
        计算指定时间窗口需要的所有槽

        返回: [{"slot_start": 1735488000, "slot_end": 1735509600, "slot_key": "3d:requests:1735488000"}, ...]
        """
        if now is None:
            now = int(time.time())

        config = SLOT_CONFIG.get(window)
        if not config:
            return []

        slot_size = config["slot_size"]
        slot_count = config["slot_count"]

        # 计算窗口总时长
        window_seconds = slot_size * slot_count

        # 计算窗口起始时间（对齐到槽边界）
        # 例如: 6 小时槽，当前 10:30，对齐到 06:00
        slot_end = (now // slot_size + 1) * slot_size  # 当前槽的结束时间
        window_start = slot_end - window_seconds

        slots = []
        for i in range(slot_count):
            slot_start = window_start + i * slot_size
            slot_end_i = slot_start + slot_size
            slots.append({
                "slot_start": slot_start,
                "slot_end": slot_end_i,
                "index": i,
            })

        return slots

    def get_cached_slots(
        self,
        window: str,
        sort_by: str = "requests"
    ) -> Dict[int, Dict]:
        """
        获取已缓存的槽数据

        返回: {slot_start: {"data": [...], "slot_end": ...}, ...}
        """
        now = int(time.time())
        cached = {}

        try:
            with self._get_sqlite() as conn:
                rows = conn.execute('''
                    SELECT slot_start, slot_end, data
                    FROM slot_cache
                    WHERE window = ? AND sort_by = ? AND expires_at > ?
                ''', (window, sort_by, now)).fetchall()

                for row in rows:
                    cached[row['slot_start']] = {
                        "slot_end": row['slot_end'],
                        "data": json.loads(row['data']),
                    }
        except Exception as e:
            logger.debug(f"[槽缓存] 读取失败: {e}")

        return cached

    def set_slot(
        self,
        window: str,
        sort_by: str,
        slot_start: int,
        slot_end: int,
        data: List[Dict]
    ):
        """
        保存单个槽的缓存数据
        """
        now = int(time.time())
        config = SLOT_CONFIG.get(window)
        if not config:
            return

        ttl = config["ttl"]
        slot_key = f"{window}:{sort_by}:{slot_start}"
        json_data = json.dumps(data, ensure_ascii=False)

        try:
            with self._get_sqlite() as conn:
                conn.execute('''
                    INSERT OR REPLACE INTO slot_cache
                    (slot_key, window, sort_by, slot_start, slot_end, data, created_at, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (slot_key, window, sort_by, slot_start, slot_end, json_data, now, now + ttl))
                conn.commit()
        except Exception as e:
            logger.warning(f"[槽缓存] 写入失败: {e}")

    def get_missing_slots(
        self,
        window: str,
        sort_by: str = "requests",
        now: Optional[int] = None
    ) -> tuple[List[Dict], Dict[int, Dict]]:
        """
        获取缺失的槽列表和已缓存的槽数据

        返回: (missing_slots, cached_slots)
        - missing_slots: 需要查询的槽列表
        - cached_slots: 已缓存的槽数据 {slot_start: {"data": [...], "slot_end": ...}}
        """
        if now is None:
            now = int(time.time())

        # 计算需要的所有槽
        all_slots = self.calculate_slots(window, now)
        if not all_slots:
            return [], {}

        # 获取已缓存的槽
        cached_slots = self.get_cached_slots(window, sort_by)

        # 找出缺失的槽
        missing_slots = []
        for slot in all_slots:
            if slot["slot_start"] not in cached_slots:
                missing_slots.append(slot)

        return missing_slots, cached_slots

    def aggregate_slots(
        self,
        cached_slots: Dict[int, Dict],
        sort_by: str = "requests",
        limit: int = 50
    ) -> List[Dict]:
        """
        聚合多个槽的数据，生成 Top N 排行榜

        聚合逻辑：
        - 按 user_id 合并各槽数据
        - 累加 request_count, quota_used, prompt_tokens 等数值字段
        - 重新计算 failure_rate
        - 按 sort_by 排序取 Top N
        """
        from collections import defaultdict

        # 聚合所有槽的用户数据
        user_totals: Dict[int, Dict] = defaultdict(lambda: {
            "user_id": 0,
            "username": "",
            "user_status": 0,
            "request_count": 0,
            "failure_requests": 0,
            "quota_used": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "unique_ips": 0,  # 注意：跨槽的 unique_ips 可能有重复，这里简单累加
        })

        for slot_data in cached_slots.values():
            for user in slot_data.get("data", []):
                uid = user.get("user_id", 0)
                if not uid:
                    continue

                totals = user_totals[uid]
                totals["user_id"] = uid
                # 保留最新的用户名和状态
                if user.get("username"):
                    totals["username"] = user["username"]
                if user.get("user_status"):
                    totals["user_status"] = user["user_status"]

                # 累加数值字段
                totals["request_count"] += user.get("request_count", 0)
                totals["failure_requests"] += user.get("failure_requests", 0)
                totals["quota_used"] += user.get("quota_used", 0)
                totals["prompt_tokens"] += user.get("prompt_tokens", 0)
                totals["completion_tokens"] += user.get("completion_tokens", 0)
                totals["unique_ips"] += user.get("unique_ips", 0)

        # 计算 failure_rate
        for totals in user_totals.values():
            total_req = totals["request_count"]
            if total_req > 0:
                totals["failure_rate"] = totals["failure_requests"] / total_req
            else:
                totals["failure_rate"] = 0.0

        # 排序
        sort_key_map = {
            "requests": lambda x: x["request_count"],
            "quota": lambda x: x["quota_used"],
            "failure_rate": lambda x: (x["failure_rate"], x["request_count"]),
        }
        sort_key = sort_key_map.get(sort_by, sort_key_map["requests"])

        sorted_users = sorted(user_totals.values(), key=sort_key, reverse=True)

        return sorted_users[:limit]

    def cleanup_expired_slots(self) -> int:
        """清理过期的槽缓存"""
        now = int(time.time())
        deleted = 0

        try:
            with self._get_sqlite() as conn:
                cursor = conn.execute(
                    "DELETE FROM slot_cache WHERE expires_at < ?", (now,)
                )
                deleted = cursor.rowcount
                conn.commit()
        except Exception as e:
            logger.warning(f"[槽缓存] 清理失败: {e}")

        return deleted

    def get_slot_stats(self) -> Dict[str, Any]:
        """获取槽缓存统计信息"""
        now = int(time.time())
        stats = {
            "total_slots": 0,
            "valid_slots": 0,
            "by_window": {},
        }

        try:
            with self._get_sqlite() as conn:
                # 总数
                row = conn.execute("SELECT COUNT(*) as c FROM slot_cache").fetchone()
                stats["total_slots"] = row['c'] if row else 0

                # 有效槽数
                row = conn.execute(
                    "SELECT COUNT(*) as c FROM slot_cache WHERE expires_at > ?", (now,)
                ).fetchone()
                stats["valid_slots"] = row['c'] if row else 0

                # 按窗口统计
                rows = conn.execute('''
                    SELECT window, sort_by, COUNT(*) as count
                    FROM slot_cache WHERE expires_at > ?
                    GROUP BY window, sort_by
                ''', (now,)).fetchall()

                for row in rows:
                    key = f"{row['window']}:{row['sort_by']}"
                    stats["by_window"][key] = row['count']
        except Exception:
            pass

        return stats

    # ==================== IP 监控槽缓存（3d/7d 增量） ====================

    def get_ip_monitor_cached_slots(
        self,
        monitor_type: str,
        window: str,
    ) -> Dict[int, Dict]:
        """
        获取 IP 监控已缓存的槽数据

        Args:
            monitor_type: 监控类型 (shared_ips, multi_ip_tokens, multi_ip_users)
            window: 时间窗口 (3d, 7d)

        返回: {slot_start: {"data": [...], "slot_end": ...}, ...}
        """
        now = int(time.time())
        cached = {}
        # IP 监控使用特殊的 sort_by 格式: "ip:{type}"
        sort_by = f"ip:{monitor_type}"

        try:
            with self._get_sqlite() as conn:
                rows = conn.execute('''
                    SELECT slot_start, slot_end, data
                    FROM slot_cache
                    WHERE window = ? AND sort_by = ? AND expires_at > ?
                ''', (window, sort_by, now)).fetchall()

                for row in rows:
                    cached[row['slot_start']] = {
                        "slot_end": row['slot_end'],
                        "data": json.loads(row['data']),
                    }
        except Exception as e:
            logger.debug(f"[IP槽缓存] 读取失败: {e}")

        return cached

    def set_ip_monitor_slot(
        self,
        monitor_type: str,
        window: str,
        slot_start: int,
        slot_end: int,
        data: List[Dict]
    ):
        """
        保存 IP 监控单个槽的缓存数据

        Args:
            monitor_type: 监控类型 (shared_ips, multi_ip_tokens, multi_ip_users)
            window: 时间窗口 (3d, 7d)
            slot_start: 槽开始时间
            slot_end: 槽结束时间
            data: 该槽的基础统计数据（不含嵌套详情）
        """
        now = int(time.time())
        config = SLOT_CONFIG.get(window)
        if not config:
            return

        ttl = config["ttl"]
        sort_by = f"ip:{monitor_type}"
        slot_key = f"{window}:{sort_by}:{slot_start}"
        json_data = json.dumps(data, ensure_ascii=False)

        try:
            with self._get_sqlite() as conn:
                conn.execute('''
                    INSERT OR REPLACE INTO slot_cache
                    (slot_key, window, sort_by, slot_start, slot_end, data, created_at, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (slot_key, window, sort_by, slot_start, slot_end, json_data, now, now + ttl))
                conn.commit()
        except Exception as e:
            logger.warning(f"[IP槽缓存] 写入失败: {e}")

    def get_ip_monitor_missing_slots(
        self,
        monitor_type: str,
        window: str,
        now: Optional[int] = None
    ) -> tuple[List[Dict], Dict[int, Dict]]:
        """
        获取 IP 监控缺失的槽列表和已缓存的槽数据

        返回: (missing_slots, cached_slots)
        """
        if now is None:
            now = int(time.time())

        # 计算需要的所有槽（复用排行榜的槽计算逻辑）
        all_slots = self.calculate_slots(window, now)
        if not all_slots:
            return [], {}

        # 获取已缓存的槽
        cached_slots = self.get_ip_monitor_cached_slots(monitor_type, window)

        # 找出缺失的槽
        missing_slots = []
        for slot in all_slots:
            if slot["slot_start"] not in cached_slots:
                missing_slots.append(slot)

        return missing_slots, cached_slots

    def aggregate_ip_monitor_slots(
        self,
        monitor_type: str,
        cached_slots: Dict[int, Dict],
        limit: int = 50
    ) -> List[Dict]:
        """
        聚合 IP 监控多个槽的数据，生成 Top N 列表

        聚合逻辑根据 monitor_type 不同：
        - shared_ips: 按 IP 聚合 token_count, user_count, request_count
        - multi_ip_tokens: 按 token_id 聚合 ip_count, request_count
        - multi_ip_users: 按 user_id 聚合 ip_count, request_count
        """
        from collections import defaultdict

        if monitor_type == "shared_ips":
            # 按 IP 聚合
            ip_totals: Dict[str, Dict] = defaultdict(lambda: {
                "ip": "",
                "token_count": 0,
                "user_count": 0,
                "request_count": 0,
                "token_ids": set(),  # 用于去重计算 token_count
                "user_ids": set(),   # 用于去重计算 user_count
            })

            for slot_data in cached_slots.values():
                for item in slot_data.get("data", []):
                    ip = item.get("ip", "")
                    if not ip:
                        continue

                    totals = ip_totals[ip]
                    totals["ip"] = ip
                    totals["request_count"] += item.get("request_count", 0)
                    # 收集 token_ids 和 user_ids 用于去重
                    for tid in item.get("token_ids", []):
                        totals["token_ids"].add(tid)
                    for uid in item.get("user_ids", []):
                        totals["user_ids"].add(uid)

            # 计算去重后的 count
            result = []
            for totals in ip_totals.values():
                result.append({
                    "ip": totals["ip"],
                    "token_count": len(totals["token_ids"]),
                    "user_count": len(totals["user_ids"]),
                    "request_count": totals["request_count"],
                })

            # 按 token_count 降序排序
            result.sort(key=lambda x: (x["token_count"], x["request_count"]), reverse=True)
            return result[:limit]

        elif monitor_type == "multi_ip_tokens":
            # 按 token_id 聚合
            token_totals: Dict[int, Dict] = defaultdict(lambda: {
                "token_id": 0,
                "token_name": "",
                "user_id": 0,
                "username": "",
                "ip_count": 0,
                "request_count": 0,
                "ips": set(),  # 用于去重计算 ip_count
            })

            for slot_data in cached_slots.values():
                for item in slot_data.get("data", []):
                    tid = item.get("token_id", 0)
                    if not tid:
                        continue

                    totals = token_totals[tid]
                    totals["token_id"] = tid
                    if item.get("token_name"):
                        totals["token_name"] = item["token_name"]
                    if item.get("user_id"):
                        totals["user_id"] = item["user_id"]
                    if item.get("username"):
                        totals["username"] = item["username"]
                    totals["request_count"] += item.get("request_count", 0)
                    # 收集 ips 用于去重
                    for ip in item.get("ips", []):
                        totals["ips"].add(ip)

            # 计算去重后的 count
            result = []
            for totals in token_totals.values():
                result.append({
                    "token_id": totals["token_id"],
                    "token_name": totals["token_name"],
                    "user_id": totals["user_id"],
                    "username": totals["username"],
                    "ip_count": len(totals["ips"]),
                    "request_count": totals["request_count"],
                })

            # 按 ip_count 降序排序
            result.sort(key=lambda x: (x["ip_count"], x["request_count"]), reverse=True)
            return result[:limit]

        elif monitor_type == "multi_ip_users":
            # 按 user_id 聚合
            user_totals: Dict[int, Dict] = defaultdict(lambda: {
                "user_id": 0,
                "username": "",
                "ip_count": 0,
                "request_count": 0,
                "ips": set(),  # 用于去重计算 ip_count
            })

            for slot_data in cached_slots.values():
                for item in slot_data.get("data", []):
                    uid = item.get("user_id", 0)
                    if not uid:
                        continue

                    totals = user_totals[uid]
                    totals["user_id"] = uid
                    if item.get("username"):
                        totals["username"] = item["username"]
                    totals["request_count"] += item.get("request_count", 0)
                    # 收集 ips 用于去重
                    for ip in item.get("ips", []):
                        totals["ips"].add(ip)

            # 计算去重后的 count
            result = []
            for totals in user_totals.values():
                result.append({
                    "user_id": totals["user_id"],
                    "username": totals["username"],
                    "ip_count": len(totals["ips"]),
                    "request_count": totals["request_count"],
                })

            # 按 ip_count 降序排序
            result.sort(key=lambda x: (x["ip_count"], x["request_count"]), reverse=True)
            return result[:limit]

        return []

    # ==================== Dashboard 槽缓存（3d/7d/14d 增量） ====================

    def get_dashboard_cached_slots(
        self,
        dashboard_type: str,
        window: str,
    ) -> Dict[int, Dict]:
        """
        获取 Dashboard 已缓存的槽数据

        Args:
            dashboard_type: Dashboard 类型 (model_usage, usage_stats, top_users)
            window: 时间窗口 (3d, 7d, 14d)

        返回: {slot_start: {"data": [...], "slot_end": ...}, ...}
        """
        now = int(time.time())
        cached = {}
        sort_by = f"dashboard:{dashboard_type}"

        try:
            with self._get_sqlite() as conn:
                rows = conn.execute('''
                    SELECT slot_start, slot_end, data
                    FROM slot_cache
                    WHERE window = ? AND sort_by = ? AND expires_at > ?
                ''', (window, sort_by, now)).fetchall()

                for row in rows:
                    cached[row['slot_start']] = {
                        "slot_end": row['slot_end'],
                        "data": json.loads(row['data']),
                    }
        except Exception as e:
            logger.debug(f"[Dashboard槽缓存] 读取失败: {e}")

        return cached

    def set_dashboard_slot(
        self,
        dashboard_type: str,
        window: str,
        slot_start: int,
        slot_end: int,
        data: Any
    ):
        """
        保存 Dashboard 单个槽的缓存数据

        Args:
            dashboard_type: Dashboard 类型 (model_usage, usage_stats, top_users)
            window: 时间窗口 (3d, 7d, 14d)
            slot_start: 槽开始时间
            slot_end: 槽结束时间
            data: 该槽的聚合数据
        """
        now = int(time.time())
        config = SLOT_CONFIG.get(window)
        if not config:
            return

        ttl = config["ttl"]
        sort_by = f"dashboard:{dashboard_type}"
        slot_key = f"{window}:{sort_by}:{slot_start}"
        json_data = json.dumps(data, ensure_ascii=False)

        try:
            with self._get_sqlite() as conn:
                conn.execute('''
                    INSERT OR REPLACE INTO slot_cache
                    (slot_key, window, sort_by, slot_start, slot_end, data, created_at, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (slot_key, window, sort_by, slot_start, slot_end, json_data, now, now + ttl))
                conn.commit()
        except Exception as e:
            logger.warning(f"[Dashboard槽缓存] 写入失败: {e}")

    def get_dashboard_missing_slots(
        self,
        dashboard_type: str,
        window: str,
        now: Optional[int] = None
    ) -> tuple[List[Dict], Dict[int, Dict]]:
        """
        获取 Dashboard 缺失的槽列表和已缓存的槽数据

        返回: (missing_slots, cached_slots)
        """
        if now is None:
            now = int(time.time())

        # 计算需要的所有槽（复用通用的槽计算逻辑）
        all_slots = self.calculate_slots(window, now)
        if not all_slots:
            return [], {}

        # 获取已缓存的槽
        cached_slots = self.get_dashboard_cached_slots(dashboard_type, window)

        # 找出缺失的槽
        missing_slots = []
        for slot in all_slots:
            if slot["slot_start"] not in cached_slots:
                missing_slots.append(slot)

        return missing_slots, cached_slots

    def aggregate_dashboard_slots(
        self,
        dashboard_type: str,
        cached_slots: Dict[int, Dict],
        limit: int = 50
    ) -> Any:
        """
        聚合 Dashboard 多个槽的数据

        聚合逻辑根据 dashboard_type 不同：
        - model_usage: 按 model_name 聚合 request_count, quota_used, tokens
        - usage_stats: 全局聚合 request_count, quota, tokens, avg_time（加权平均）
        - top_users: 按 user_id 聚合 request_count, quota_used
        """
        from collections import defaultdict

        if dashboard_type == "model_usage":
            # 按 model_name 聚合
            model_totals: Dict[str, Dict] = defaultdict(lambda: {
                "model_name": "",
                "request_count": 0,
                "quota_used": 0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
            })

            for slot_data in cached_slots.values():
                for item in slot_data.get("data", []):
                    model = item.get("model_name", "")
                    if not model:
                        continue

                    totals = model_totals[model]
                    totals["model_name"] = model
                    totals["request_count"] += item.get("request_count", 0)
                    totals["quota_used"] += item.get("quota_used", 0)
                    totals["prompt_tokens"] += item.get("prompt_tokens", 0)
                    totals["completion_tokens"] += item.get("completion_tokens", 0)

            # 按 request_count 降序排序
            result = list(model_totals.values())
            result.sort(key=lambda x: x["request_count"], reverse=True)
            return result[:limit]

        elif dashboard_type == "usage_stats":
            # 全局聚合
            totals = {
                "total_requests": 0,
                "total_quota_used": 0,
                "total_prompt_tokens": 0,
                "total_completion_tokens": 0,
                "total_time_weighted": 0,  # 用于计算加权平均
            }

            for slot_data in cached_slots.values():
                data = slot_data.get("data", {})
                req_count = data.get("total_requests", 0)
                totals["total_requests"] += req_count
                totals["total_quota_used"] += data.get("total_quota_used", 0)
                totals["total_prompt_tokens"] += data.get("total_prompt_tokens", 0)
                totals["total_completion_tokens"] += data.get("total_completion_tokens", 0)
                # 加权累加响应时间
                totals["total_time_weighted"] += data.get("average_response_time", 0) * req_count

            # 计算加权平均响应时间
            avg_time = 0.0
            if totals["total_requests"] > 0:
                avg_time = totals["total_time_weighted"] / totals["total_requests"]

            return {
                "total_requests": totals["total_requests"],
                "total_quota_used": totals["total_quota_used"],
                "total_prompt_tokens": totals["total_prompt_tokens"],
                "total_completion_tokens": totals["total_completion_tokens"],
                "average_response_time": avg_time,
            }

        elif dashboard_type == "top_users":
            # 按 user_id 聚合
            user_totals: Dict[int, Dict] = defaultdict(lambda: {
                "user_id": 0,
                "username": "",
                "request_count": 0,
                "quota_used": 0,
            })

            for slot_data in cached_slots.values():
                for item in slot_data.get("data", []):
                    uid = item.get("user_id", 0)
                    if not uid:
                        continue

                    totals = user_totals[uid]
                    totals["user_id"] = uid
                    if item.get("username"):
                        totals["username"] = item["username"]
                    totals["request_count"] += item.get("request_count", 0)
                    totals["quota_used"] += item.get("quota_used", 0)

            # 按 quota_used 降序排序
            result = list(user_totals.values())
            result.sort(key=lambda x: x["quota_used"], reverse=True)
            return result[:limit]

        return None


# 全局实例获取函数
def get_cache_manager() -> CacheManager:
    """获取缓存管理器单例"""
    return CacheManager.get_instance()

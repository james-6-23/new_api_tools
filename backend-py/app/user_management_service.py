"""
用户管理服务模块 - NewAPI Middleware Tool
提供用户列表查询、活跃度分析、批量清理功能

性能优化：
- 统计数据使用缓存（5分钟）
- 用户列表默认不 JOIN logs 表
- 只有筛选活跃/不活跃用户时才 JOIN logs
- 活跃度筛选查询使用缓存（2分钟），避免频繁 JOIN logs 导致高负载
"""
import time
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional

from .database import get_db_manager
from .logger import logger
from .local_storage import get_local_storage


class ActivityLevel(Enum):
    """用户活跃度级别"""
    ACTIVE = "active"           # 最近 7 天内有请求
    INACTIVE = "inactive"       # 7-30 天内有请求
    VERY_INACTIVE = "very_inactive"  # 超过 30 天没有请求
    NEVER = "never"             # 从未请求


# 活跃度阈值（秒）
ACTIVE_THRESHOLD = 7 * 24 * 3600      # 7 天
INACTIVE_THRESHOLD = 30 * 24 * 3600   # 30 天

# 缓存配置
STATS_CACHE_KEY = "user_activity_stats"
STATS_CACHE_TTL = 300  # 5 分钟

# 活跃度筛选缓存配置
ACTIVITY_LIST_CACHE_PREFIX = "user_activity_list"
ACTIVITY_LIST_CACHE_TTL = 600  # 10 分钟（大型系统查询较慢，延长缓存时间）


@dataclass
class UserInfo:
    """用户信息"""
    id: int
    username: str
    display_name: Optional[str]
    email: Optional[str]
    role: int
    status: int
    quota: int
    used_quota: int
    request_count: int
    group: Optional[str]
    last_request_time: Optional[int]  # Unix timestamp
    activity_level: ActivityLevel
    linux_do_id: Optional[str] = None  # Linux.do 用户 ID


@dataclass
class ActivityStats:
    """活跃度统计"""
    total_users: int
    active_users: int       # 7 天内活跃
    inactive_users: int     # 7-30 天
    very_inactive_users: int  # 30 天以上
    never_requested: int    # 从未请求


class UserManagementService:
    """用户管理服务"""

    def __init__(self):
        self._db = get_db_manager()
        self._storage = get_local_storage()
        self._cache = None  # 延迟初始化，避免循环导入

    def _get_cache(self):
        """获取缓存管理器（延迟初始化）"""
        if self._cache is None:
            from .cache_manager import get_cache_manager
            self._cache = get_cache_manager()
        return self._cache

    def _get_activity_list_cache_key(
        self,
        activity_filter: ActivityLevel,
        page: int,
        page_size: int,
        search: Optional[str],
        order_by: str,
        order_dir: str,
    ) -> str:
        """生成活跃度筛选缓存 key"""
        # 搜索词规范化（空字符串统一处理）
        search_key = search.strip().lower() if search else ""
        return f"{ACTIVITY_LIST_CACHE_PREFIX}:{activity_filter.value}:{page}:{page_size}:{search_key}:{order_by}:{order_dir}"

    def invalidate_activity_list_cache(self):
        """
        失效所有活跃度筛选缓存。

        在以下操作后调用：
        - 封禁/解封用户
        - 删除用户
        - 批量删除用户
        """
        try:
            cache = self._get_cache()
            deleted = cache.clear_generic_prefix(ACTIVITY_LIST_CACHE_PREFIX)
            if deleted > 0:
                logger.debug(f"[缓存] 清除活跃度列表缓存: {deleted} 条")
        except Exception as e:
            logger.warning(f"[缓存] 清除活跃度列表缓存失败: {e}")

    def get_activity_stats(self, quick: bool = False) -> ActivityStats:
        """
        获取用户活跃度统计（带缓存）

        Args:
            quick: 快速模式，只返回总用户数和从未请求数（不 JOIN logs 表）
                   用于大型系统首次加载时快速显示基础数据

        缓存 5 分钟减少数据库压力。
        """
        # 尝试从缓存获取
        cached = self._storage.cache_get(STATS_CACHE_KEY)
        if cached:
            return ActivityStats(
                total_users=cached.get("total_users", 0),
                active_users=cached.get("active_users", 0),
                inactive_users=cached.get("inactive_users", 0),
                very_inactive_users=cached.get("very_inactive_users", 0),
                never_requested=cached.get("never_requested", 0),
            )

        # 快速模式：只返回基础统计（不 JOIN logs）
        if quick:
            return self._fetch_quick_stats()

        # 缓存未命中，执行完整查询
        stats = self._fetch_activity_stats()

        # 存入缓存
        self._storage.cache_set(STATS_CACHE_KEY, {
            "total_users": stats.total_users,
            "active_users": stats.active_users,
            "inactive_users": stats.inactive_users,
            "very_inactive_users": stats.very_inactive_users,
            "never_requested": stats.never_requested,
        }, ttl=STATS_CACHE_TTL)

        return stats

    def _fetch_quick_stats(self) -> ActivityStats:
        """
        快速获取基础统计（只查 users 表，毫秒级）
        
        用于大型系统在缓存未命中时快速返回基础数据，
        活跃度详细分布显示为 0，提示用户数据正在加载。
        """
        try:
            self._db.connect()
            sql = """
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN request_count = 0 THEN 1 ELSE 0 END) as never_count,
                    SUM(CASE WHEN request_count > 0 THEN 1 ELSE 0 END) as has_requests
                FROM users
                WHERE deleted_at IS NULL
            """
            result = self._db.execute(sql, {})
            if result and result[0]:
                row = result[0]
                total = int(row.get("total") or 0)
                never = int(row.get("never_count") or 0)
                has_requests = int(row.get("has_requests") or 0)
                return ActivityStats(
                    total_users=total,
                    active_users=0,  # 快速模式不计算
                    inactive_users=0,
                    very_inactive_users=0,
                    never_requested=never,
                )
        except Exception as e:
            logger.db_error(f"快速统计失败: {e}")
        
        return ActivityStats(
            total_users=0,
            active_users=0,
            inactive_users=0,
            very_inactive_users=0,
            never_requested=0,
        )

        return stats

    def _fetch_activity_stats(self) -> ActivityStats:
        """
        从数据库获取用户活跃度统计

        性能优化策略（针对大型系统 3万+ 用户）：
        1. 先快速获取总用户数和从未请求数（只查 users 表）
        2. 使用 EXISTS 子查询代替 GROUP BY 统计活跃用户（更高效）
        3. 分步查询避免单个大查询超时
        """
        now = int(time.time())
        active_cutoff = now - ACTIVE_THRESHOLD
        inactive_cutoff = now - INACTIVE_THRESHOLD

        try:
            self._db.connect()

            # 1. 快速统计总用户数和从未请求数（只查 users 表，毫秒级）
            basic_sql = """
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN request_count = 0 THEN 1 ELSE 0 END) as never_count
                FROM users
                WHERE deleted_at IS NULL
            """
            basic_result = self._db.execute(basic_sql, {})
            total_users = int(basic_result[0]["total"]) if basic_result else 0
            never_count = int(basic_result[0]["never_count"]) if basic_result else 0

            # 2. 统计活跃用户（7天内有请求）- 使用 EXISTS 更高效
            active_sql = """
                SELECT COUNT(*) as cnt FROM users u
                WHERE u.deleted_at IS NULL 
                  AND u.request_count > 0
                  AND EXISTS (
                    SELECT 1 FROM logs l 
                    WHERE l.user_id = u.id 
                      AND l.type = 2 
                      AND l.created_at >= :active_cutoff
                    LIMIT 1
                  )
            """
            active_result = self._db.execute(active_sql, {"active_cutoff": active_cutoff})
            active_count = int(active_result[0]["cnt"]) if active_result else 0

            # 3. 统计不活跃用户（7-30天内有请求）
            inactive_sql = """
                SELECT COUNT(*) as cnt FROM users u
                WHERE u.deleted_at IS NULL 
                  AND u.request_count > 0
                  AND NOT EXISTS (
                    SELECT 1 FROM logs l 
                    WHERE l.user_id = u.id 
                      AND l.type = 2 
                      AND l.created_at >= :active_cutoff
                    LIMIT 1
                  )
                  AND EXISTS (
                    SELECT 1 FROM logs l 
                    WHERE l.user_id = u.id 
                      AND l.type = 2 
                      AND l.created_at >= :inactive_cutoff
                    LIMIT 1
                  )
            """
            inactive_result = self._db.execute(inactive_sql, {
                "active_cutoff": active_cutoff,
                "inactive_cutoff": inactive_cutoff,
            })
            inactive_count = int(inactive_result[0]["cnt"]) if inactive_result else 0

            # 4. 非常不活跃 = 有请求记录的用户 - 活跃 - 不活跃
            has_requests = total_users - never_count
            very_inactive_count = has_requests - active_count - inactive_count

            return ActivityStats(
                total_users=total_users,
                active_users=active_count,
                inactive_users=inactive_count,
                very_inactive_users=max(0, very_inactive_count),  # 防止负数
                never_requested=never_count,
            )
        except Exception as e:
            logger.db_error(f"获取活跃度统计失败: {e}")

        return ActivityStats(
            total_users=0,
            active_users=0,
            inactive_users=0,
            very_inactive_users=0,
            never_requested=0,
        )

    def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        """根据 ID 获取用户信息"""
        try:
            from .database import DatabaseEngine
            is_pg = self._db.config.engine == DatabaseEngine.POSTGRESQL
            group_col = '"group"' if is_pg else '`group`'
            
            sql = f"""
                SELECT id, username, display_name, email, role, status, 
                       quota, used_quota, request_count, {group_col}
                FROM users
                WHERE id = :user_id AND deleted_at IS NULL
            """
            result = self._db.execute(sql, {"user_id": user_id})
            if result and result[0]:
                row = result[0]
                return {
                    "id": row.get("id"),
                    "username": row.get("username"),
                    "display_name": row.get("display_name"),
                    "email": row.get("email"),
                    "role": row.get("role", 0),
                    "status": row.get("status", 1),
                    "quota": row.get("quota", 0),
                    "used_quota": row.get("used_quota", 0),
                    "request_count": row.get("request_count", 0),
                    "group": row.get("group", ""),
                }
        except Exception as e:
            logger.db_error(f"获取用户信息失败: {e}")
        return None

    def search_users(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """搜索用户（按用户名、显示名或邮箱）"""
        try:
            from .database import DatabaseEngine
            is_pg = self._db.config.engine == DatabaseEngine.POSTGRESQL
            group_col = '"group"' if is_pg else '`group`'
            
            sql = f"""
                SELECT id, username, display_name, email, role, status, 
                       quota, used_quota, request_count, {group_col}
                FROM users
                WHERE deleted_at IS NULL
                  AND (
                    username LIKE :query 
                    OR COALESCE(display_name, '') LIKE :query
                    OR COALESCE(email, '') LIKE :query
                  )
                ORDER BY request_count DESC
                LIMIT :limit
            """
            result = self._db.execute(sql, {"query": f"%{query}%", "limit": limit})
            users = []
            for row in result:
                users.append({
                    "id": row.get("id"),
                    "username": row.get("username"),
                    "display_name": row.get("display_name"),
                    "email": row.get("email"),
                    "role": row.get("role", 0),
                    "status": row.get("status", 1),
                    "quota": row.get("quota", 0),
                    "used_quota": row.get("used_quota", 0),
                    "request_count": row.get("request_count", 0),
                    "group": row.get("group", ""),
                })
            return users
        except Exception as e:
            logger.db_error(f"搜索用户失败: {e}")
        return []

    def get_users(
        self,
        page: int = 1,
        page_size: int = 20,
        activity_filter: Optional[ActivityLevel] = None,
        group_filter: Optional[str] = None,
        source_filter: Optional[str] = None,
        search: Optional[str] = None,
        order_by: str = "request_count",
        order_dir: str = "DESC",
    ) -> Dict[str, Any]:
        """
        获取用户列表

        性能优化：
        - 默认只查询 users 表（快速）
        - 只有筛选活跃/不活跃时才 JOIN logs 表
        - 使用 request_count 判断是否有请求

        Args:
            page: 页码
            page_size: 每页数量
            activity_filter: 活跃度筛选
            group_filter: 分组筛选
            source_filter: 注册来源筛选
            search: 搜索关键词
            order_by: 排序字段
            order_dir: 排序方向

        Returns:
            分页用户列表
        """
        offset = (page - 1) * page_size

        # 需要精确活跃度筛选时才 JOIN logs
        needs_logs_join = activity_filter in [ActivityLevel.ACTIVE, ActivityLevel.INACTIVE, ActivityLevel.VERY_INACTIVE]

        if needs_logs_join:
            return self._get_users_with_activity(page, page_size, activity_filter, group_filter, source_filter, search, order_by, order_dir)
        else:
            return self._get_users_fast(page, page_size, activity_filter, group_filter, source_filter, search, order_by, order_dir)

    def _get_users_fast(
        self,
        page: int,
        page_size: int,
        activity_filter: Optional[ActivityLevel],
        group_filter: Optional[str],
        source_filter: Optional[str],
        search: Optional[str],
        order_by: str,
        order_dir: str,
    ) -> Dict[str, Any]:
        """
        快速获取用户列表（不 JOIN logs 表）

        用于：无筛选、筛选"从未请求"的情况
        """
        offset = (page - 1) * page_size

        # 根据数据库类型选择正确的 SQL（group 是保留字）
        from .database import DatabaseEngine
        is_pg = self._db.config.engine == DatabaseEngine.POSTGRESQL
        group_col = '"group"' if is_pg else '`group`'

        base_sql = f"""
            SELECT
                id, username, display_name, email,
                role, status, quota, used_quota,
                request_count, {group_col}, linux_do_id
            FROM users
            WHERE deleted_at IS NULL
        """

        params: Dict[str, Any] = {
            "limit": page_size,
            "offset": offset,
        }

        where_clauses = []

        # 搜索条件（支持用户名、显示名、邮箱、linux_do_id、aff_code）
        if search:
            where_clauses.append("(username LIKE :search OR COALESCE(display_name, '') LIKE :search OR COALESCE(email, '') LIKE :search OR COALESCE(linux_do_id, '') LIKE :search OR COALESCE(aff_code, '') LIKE :search)")
            params["search"] = f"%{search}%"

        # 从未请求筛选
        if activity_filter == ActivityLevel.NEVER:
            where_clauses.append("request_count = 0")

        # 分组筛选
        if group_filter:
            where_clauses.append(f"{group_col} = :group_filter")
            params["group_filter"] = group_filter

        # 注册来源筛选
        if source_filter:
            source_conditions = {
                "github": "github_id IS NOT NULL AND github_id != ''",
                "wechat": "wechat_id IS NOT NULL AND wechat_id != ''",
                "telegram": "telegram_id IS NOT NULL AND telegram_id != ''",
                "discord": "discord_id IS NOT NULL AND discord_id != ''",
                "oidc": "oidc_id IS NOT NULL AND oidc_id != ''",
                "linux_do": "linux_do_id IS NOT NULL AND linux_do_id != ''",
                "password": "(github_id IS NULL OR github_id = '') AND (wechat_id IS NULL OR wechat_id = '') AND (telegram_id IS NULL OR telegram_id = '') AND (discord_id IS NULL OR discord_id = '') AND (oidc_id IS NULL OR oidc_id = '') AND (linux_do_id IS NULL OR linux_do_id = '')",
            }
            if source_filter in source_conditions:
                where_clauses.append(f"({source_conditions[source_filter]})")

        where_sql = ""
        if where_clauses:
            where_sql = " AND " + " AND ".join(where_clauses)

        # 排序
        order_column = "request_count"
        if order_by == "username":
            order_column = "username"
        elif order_by == "quota":
            order_column = "quota"
        elif order_by == "used_quota":
            order_column = "used_quota"
        elif order_by == "id":
            order_column = "id"

        order_sql = f" ORDER BY {order_column} {'DESC' if order_dir.upper() == 'DESC' else 'ASC'}"
        limit_sql = " LIMIT :limit OFFSET :offset"

        try:
            self._db.connect()

            full_sql = base_sql + where_sql + order_sql + limit_sql
            result = self._db.execute(full_sql, params)

            # 总数
            count_sql = f"SELECT COUNT(*) as cnt FROM users WHERE deleted_at IS NULL{where_sql}"
            count_result = self._db.execute(count_sql, params)
            total = int(count_result[0]["cnt"]) if count_result else 0

            # 转换结果
            users = []
            for row in result:
                request_count = int(row.get("request_count") or 0)
                # 简化活跃度判断：有请求=has_activity，无请求=never
                activity = ActivityLevel.NEVER if request_count == 0 else ActivityLevel.ACTIVE

                users.append(UserInfo(
                    id=int(row["id"]),
                    username=row.get("username") or "",
                    display_name=row.get("display_name"),
                    email=row.get("email"),
                    role=int(row.get("role") or 0),
                    status=int(row.get("status") or 0),
                    quota=int(row.get("quota") or 0),
                    used_quota=int(row.get("used_quota") or 0),
                    request_count=request_count,
                    group=row.get("group"),
                    last_request_time=None,  # 快速模式不获取精确时间
                    activity_level=activity,
                    linux_do_id=row.get("linux_do_id"),
                ))

            return {
                "items": users,
                "total": total,
                "page": page,
                "page_size": page_size,
                "total_pages": (total + page_size - 1) // page_size,
            }

        except Exception as e:
            logger.db_error(f"获取用户列表失败: {e}")
            return self._empty_result(page, page_size)

    def _get_users_with_activity(
        self,
        page: int,
        page_size: int,
        activity_filter: Optional[ActivityLevel],
        group_filter: Optional[str],
        source_filter: Optional[str],
        search: Optional[str],
        order_by: str,
        order_dir: str,
    ) -> Dict[str, Any]:
        """
        获取用户列表（按活跃度筛选）

        性能优化（针对大型系统 3万+ 用户）：
        - 使用 EXISTS 子查询代替 JOIN + GROUP BY（从 30+ 分钟优化到秒级）
        - 使用缓存减少重复查询
        - 缓存 TTL 10 分钟
        """
        # 尝试从缓存获取
        if activity_filter:
            cache_key = self._get_activity_list_cache_key(
                activity_filter, page, page_size, search, order_by, order_dir
            )
            try:
                cache = self._get_cache()
                cached_data = cache.get(cache_key)
                if cached_data:
                    # 从缓存恢复 UserInfo 对象
                    items = []
                    for item in cached_data.get("items", []):
                        items.append(UserInfo(
                            id=item["id"],
                            username=item["username"],
                            display_name=item.get("display_name"),
                            email=item.get("email"),
                            role=item.get("role", 0),
                            status=item.get("status", 0),
                            quota=item.get("quota", 0),
                            used_quota=item.get("used_quota", 0),
                            request_count=item.get("request_count", 0),
                            group=item.get("group"),
                            last_request_time=item.get("last_request_time"),
                            activity_level=ActivityLevel(item.get("activity_level", "never")),
                            linux_do_id=item.get("linux_do_id"),
                        ))
                    logger.debug(f"[缓存命中] 用户活跃度列表 filter={activity_filter.value} page={page}")
                    return {
                        "items": items,
                        "total": cached_data.get("total", 0),
                        "page": cached_data.get("page", page),
                        "page_size": cached_data.get("page_size", page_size),
                        "total_pages": cached_data.get("total_pages", 0),
                    }
            except Exception as e:
                logger.warning(f"[缓存] 读取活跃度列表缓存失败: {e}")

        now = int(time.time())
        active_cutoff = now - ACTIVE_THRESHOLD
        inactive_cutoff = now - INACTIVE_THRESHOLD
        offset = (page - 1) * page_size

        # 根据数据库类型选择正确的 SQL
        from .database import DatabaseEngine
        is_pg = self._db.config.engine == DatabaseEngine.POSTGRESQL
        group_col = 'u."group"' if is_pg else 'u.`group`'

        params: Dict[str, Any] = {
            "active_cutoff": active_cutoff,
            "inactive_cutoff": inactive_cutoff,
            "limit": page_size,
            "offset": offset,
        }

        # 搜索条件
        search_clause = ""
        if search:
            search_clause = " AND (u.username LIKE :search OR COALESCE(u.display_name, '') LIKE :search OR COALESCE(u.email, '') LIKE :search OR COALESCE(u.linux_do_id, '') LIKE :search OR COALESCE(u.aff_code, '') LIKE :search)"
            params["search"] = f"%{search}%"

        # 分组筛选
        group_clause = ""
        if group_filter:
            group_clause = f" AND {group_col} = :group_filter"
            params["group_filter"] = group_filter

        # 注册来源筛选
        source_clause = ""
        if source_filter:
            source_conditions = {
                "github": "u.github_id IS NOT NULL AND u.github_id != ''",
                "wechat": "u.wechat_id IS NOT NULL AND u.wechat_id != ''",
                "telegram": "u.telegram_id IS NOT NULL AND u.telegram_id != ''",
                "discord": "u.discord_id IS NOT NULL AND u.discord_id != ''",
                "oidc": "u.oidc_id IS NOT NULL AND u.oidc_id != ''",
                "linux_do": "u.linux_do_id IS NOT NULL AND u.linux_do_id != ''",
                "password": "(u.github_id IS NULL OR u.github_id = '') AND (u.wechat_id IS NULL OR u.wechat_id = '') AND (u.telegram_id IS NULL OR u.telegram_id = '') AND (u.discord_id IS NULL OR u.discord_id = '') AND (u.oidc_id IS NULL OR u.oidc_id = '') AND (u.linux_do_id IS NULL OR u.linux_do_id = '')",
            }
            if source_filter in source_conditions:
                source_clause = f" AND ({source_conditions[source_filter]})"

        # 使用 EXISTS 子查询构建活跃度筛选条件（比 JOIN + GROUP BY 快 100 倍以上）
        activity_clause = ""
        if activity_filter == ActivityLevel.ACTIVE:
            # 活跃：7天内有请求
            activity_clause = """
                AND EXISTS (
                    SELECT 1 FROM logs l 
                    WHERE l.user_id = u.id AND l.type = 2 AND l.created_at >= :active_cutoff
                    LIMIT 1
                )
            """
        elif activity_filter == ActivityLevel.INACTIVE:
            # 不活跃：7-30天内有请求（7天内无请求，但30天内有请求）
            activity_clause = """
                AND NOT EXISTS (
                    SELECT 1 FROM logs l 
                    WHERE l.user_id = u.id AND l.type = 2 AND l.created_at >= :active_cutoff
                    LIMIT 1
                )
                AND EXISTS (
                    SELECT 1 FROM logs l 
                    WHERE l.user_id = u.id AND l.type = 2 AND l.created_at >= :inactive_cutoff
                    LIMIT 1
                )
            """
        elif activity_filter == ActivityLevel.VERY_INACTIVE:
            # 非常不活跃：超过30天无请求（但有请求记录）
            activity_clause = """
                AND u.request_count > 0
                AND NOT EXISTS (
                    SELECT 1 FROM logs l 
                    WHERE l.user_id = u.id AND l.type = 2 AND l.created_at >= :inactive_cutoff
                    LIMIT 1
                )
            """

        # 排序字段
        order_column = "u.request_count"
        if order_by == "username":
            order_column = "u.username"
        elif order_by == "quota":
            order_column = "u.quota"
        elif order_by == "used_quota":
            order_column = "u.used_quota"
        elif order_by == "last_request_time":
            order_column = "u.request_count"  # 快速模式下用 request_count 代替

        order_dir_str = 'DESC' if order_dir.upper() == 'DESC' else 'ASC'

        try:
            self._db.connect()

            # 主查询 - 使用 EXISTS 子查询，不需要 JOIN
            main_sql = f"""
                SELECT
                    u.id, u.username, u.display_name, u.email,
                    u.role, u.status, u.quota, u.used_quota,
                    u.request_count, {group_col}, u.linux_do_id
                FROM users u
                WHERE u.deleted_at IS NULL
                {search_clause}
                {group_clause}
                {source_clause}
                {activity_clause}
                ORDER BY {order_column} {order_dir_str}
                LIMIT :limit OFFSET :offset
            """
            result = self._db.execute(main_sql, params)

            # 总数查询
            count_sql = f"""
                SELECT COUNT(*) as cnt
                FROM users u
                WHERE u.deleted_at IS NULL
                {search_clause}
                {group_clause}
                {source_clause}
                {activity_clause}
            """
            count_result = self._db.execute(count_sql, params)
            total = int(count_result[0]["cnt"]) if count_result else 0

            # 转换结果
            users = []
            for row in result:
                users.append(UserInfo(
                    id=int(row["id"]),
                    username=row.get("username") or "",
                    display_name=row.get("display_name"),
                    email=row.get("email"),
                    role=int(row.get("role") or 0),
                    status=int(row.get("status") or 0),
                    quota=int(row.get("quota") or 0),
                    used_quota=int(row.get("used_quota") or 0),
                    request_count=int(row.get("request_count") or 0),
                    group=row.get("group"),
                    last_request_time=None,  # EXISTS 模式不获取精确时间
                    activity_level=activity_filter or ActivityLevel.ACTIVE,
                    linux_do_id=row.get("linux_do_id"),
                ))

            result_data = {
                "items": users,
                "total": total,
                "page": page,
                "page_size": page_size,
                "total_pages": (total + page_size - 1) // page_size,
            }

            # 保存到缓存
            if activity_filter:
                try:
                    cache = self._get_cache()
                    cache_data = {
                        "items": [
                            {
                                "id": u.id,
                                "username": u.username,
                                "display_name": u.display_name,
                                "email": u.email,
                                "role": u.role,
                                "status": u.status,
                                "quota": u.quota,
                                "used_quota": u.used_quota,
                                "request_count": u.request_count,
                                "group": u.group,
                                "last_request_time": u.last_request_time,
                                "activity_level": u.activity_level.value,
                                "linux_do_id": u.linux_do_id,
                            }
                            for u in users
                        ],
                        "total": total,
                        "page": page,
                        "page_size": page_size,
                        "total_pages": result_data["total_pages"],
                    }
                    cache_key = self._get_activity_list_cache_key(
                        activity_filter, page, page_size, search, order_by, order_dir
                    )
                    cache.set(cache_key, cache_data, ttl=ACTIVITY_LIST_CACHE_TTL)
                    logger.debug(f"[缓存] 保存用户活跃度列表 filter={activity_filter.value} page={page} count={len(users)}")
                except Exception as e:
                    logger.warning(f"[缓存] 保存活跃度列表缓存失败: {e}")

            return result_data

        except Exception as e:
            logger.db_error(f"获取用户列表失败: {e}")
            return self._empty_result(page, page_size)

    def _empty_result(self, page: int, page_size: int) -> Dict[str, Any]:
        """返回空结果"""
        return {
            "items": [],
            "total": 0,
            "page": page,
            "page_size": page_size,
            "total_pages": 0,
        }

    def _calculate_activity_level(self, last_request_time: Optional[int], now: int) -> ActivityLevel:
        """计算活跃度级别"""
        if last_request_time is None:
            return ActivityLevel.NEVER

        elapsed = now - last_request_time
        if elapsed <= ACTIVE_THRESHOLD:
            return ActivityLevel.ACTIVE
        elif elapsed <= INACTIVE_THRESHOLD:
            return ActivityLevel.INACTIVE
        else:
            return ActivityLevel.VERY_INACTIVE

    def delete_user(self, user_id: int, hard_delete: bool = False) -> Dict[str, Any]:
        """
        删除单个用户
        
        Args:
            user_id: 用户 ID
            hard_delete: 是否彻底删除（物理删除）
        """
        try:
            self._db.connect()

            # 检查用户是否存在
            check_sql = "SELECT id, username FROM users WHERE id = :user_id AND deleted_at IS NULL"
            check_result = self._db.execute(check_sql, {"user_id": user_id})

            if not check_result:
                return {"success": False, "message": "用户不存在"}

            username = check_result[0].get("username", "")

            if hard_delete:
                # 彻底删除
                self._hard_delete_users([user_id])
                logger.business("彻底删除用户", user_id=user_id, username=username)
                return {"success": True, "message": f"用户 {username} 已彻底删除"}
            else:
                # 软删除用户 (CURRENT_TIMESTAMP 兼容 MySQL 和 PostgreSQL)
                delete_sql = "UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = :user_id"
                self._db.execute(delete_sql, {"user_id": user_id})

                # 同时软删除用户的 tokens
                token_sql = "UPDATE tokens SET deleted_at = CURRENT_TIMESTAMP WHERE user_id = :user_id AND deleted_at IS NULL"
                self._db.execute(token_sql, {"user_id": user_id})

                logger.business("注销用户", user_id=user_id, username=username)

            # 清除统计缓存和活跃度列表缓存
            self._storage.cache_delete(STATS_CACHE_KEY)
            self.invalidate_activity_list_cache()

            return {"success": True, "message": f"用户 {username} 已注销"}

        except Exception as e:
            logger.db_error(f"删除用户失败: {e}")
            return {"success": False, "message": f"删除失败: {str(e)}"}

    def batch_delete_inactive_users(
        self,
        activity_level: ActivityLevel = ActivityLevel.VERY_INACTIVE,
        dry_run: bool = True,
        hard_delete: bool = False,
    ) -> Dict[str, Any]:
        """
        批量删除不活跃用户
        
        Args:
            activity_level: 活跃度级别筛选
            dry_run: 预览模式，不实际删除
            hard_delete: 彻底删除模式，从数据库物理删除用户及关联数据
        
        性能优化：使用 EXISTS 子查询代替 LEFT JOIN + GROUP BY
        """
        now = int(time.time())
        inactive_cutoff = now - INACTIVE_THRESHOLD

        try:
            self._db.connect()

            # 使用 EXISTS 子查询，与统计逻辑保持一致（性能优化）
            if activity_level == ActivityLevel.VERY_INACTIVE:
                # 非常不活跃：超过30天无请求（但有请求记录）
                find_sql = """
                    SELECT u.id, u.username
                    FROM users u
                    WHERE u.deleted_at IS NULL
                      AND u.request_count > 0
                      AND NOT EXISTS (
                        SELECT 1 FROM logs l 
                        WHERE l.user_id = u.id AND l.type = 2 AND l.created_at >= :cutoff
                        LIMIT 1
                      )
                """
                params: Dict[str, Any] = {"cutoff": inactive_cutoff}
            elif activity_level == ActivityLevel.NEVER:
                # 从未请求：request_count = 0
                find_sql = """
                    SELECT u.id, u.username
                    FROM users u
                    WHERE u.deleted_at IS NULL
                      AND u.request_count = 0
                """
                params = {}
            elif activity_level == ActivityLevel.INACTIVE:
                # 不活跃：7-30天内有请求
                active_cutoff = now - ACTIVE_THRESHOLD
                find_sql = """
                    SELECT u.id, u.username
                    FROM users u
                    WHERE u.deleted_at IS NULL
                      AND u.request_count > 0
                      AND NOT EXISTS (
                        SELECT 1 FROM logs l 
                        WHERE l.user_id = u.id AND l.type = 2 AND l.created_at >= :active_cutoff
                        LIMIT 1
                      )
                      AND EXISTS (
                        SELECT 1 FROM logs l 
                        WHERE l.user_id = u.id AND l.type = 2 AND l.created_at >= :inactive_cutoff
                        LIMIT 1
                      )
                """
                params = {"active_cutoff": active_cutoff, "inactive_cutoff": inactive_cutoff}
            else:
                return {"success": False, "message": "不支持的活跃度级别"}

            result = self._db.execute(find_sql, params)
            user_ids = [row["id"] for row in result]
            usernames = [row.get("username", "") for row in result]

            if dry_run:
                return {
                    "success": True,
                    "dry_run": True,
                    "count": len(user_ids),
                    "users": usernames[:20],
                    "message": f"预览：将{'彻底' if hard_delete else ''}删除 {len(user_ids)} 个用户",
                }

            if not user_ids:
                return {
                    "success": True,
                    "count": 0,
                    "message": "没有需要删除的用户",
                }

            # 执行批量删除
            if hard_delete:
                # 彻底删除：物理删除用户及关联数据
                deleted_count = self._hard_delete_users(user_ids)
            else:
                # 软删除：逐个调用 delete_user
                for user_id in user_ids:
                    self.delete_user(user_id)
                deleted_count = len(user_ids)

            # 清除缓存
            self._storage.cache_delete(STATS_CACHE_KEY)
            self.invalidate_activity_list_cache()

            action = "彻底删除" if hard_delete else "删除"
            logger.business(f"批量{action}不活跃用户", count=deleted_count, activity=activity_level.value, hard_delete=hard_delete)

            return {
                "success": True,
                "count": deleted_count,
                "message": f"已{action} {deleted_count} 个不活跃用户",
            }

        except Exception as e:
            logger.db_error(f"批量删除用户失败: {e}")
            return {"success": False, "message": f"批量删除失败: {str(e)}"}

    def _hard_delete_users(self, user_ids: List[int]) -> int:
        """
        彻底删除用户（物理删除）
        
        删除顺序（考虑外键约束）：
        1. tokens - 用户的令牌
        2. logs - 用户的日志（可选，数据量大时跳过）
        3. quota_data - 用户的配额数据
        4. midjourneys - 用户的 MJ 任务
        5. tasks - 用户的任务
        6. top_ups - 用户的充值记录
        7. redemptions - 用户创建的兑换码
        8. two_fas / two_fa_backup_codes - 2FA 相关
        9. passkey_credentials - Passkey 凭证
        10. users - 最后删除用户本身
        """
        if not user_ids:
            return 0
        
        deleted_count = 0
        
        try:
            self._db.connect()
            
            # 批量处理，每批 100 个用户
            batch_size = 100
            for i in range(0, len(user_ids), batch_size):
                batch_ids = user_ids[i:i + batch_size]
                placeholders = ", ".join([f":id_{j}" for j in range(len(batch_ids))])
                params = {f"id_{j}": uid for j, uid in enumerate(batch_ids)}
                
                # 1. 删除 tokens
                self._db.execute(f"DELETE FROM tokens WHERE user_id IN ({placeholders})", params)
                
                # 2. 删除 quota_data
                self._db.execute(f"DELETE FROM quota_data WHERE user_id IN ({placeholders})", params)
                
                # 3. 删除 midjourneys
                self._db.execute(f"DELETE FROM midjourneys WHERE user_id IN ({placeholders})", params)
                
                # 4. 删除 tasks
                self._db.execute(f"DELETE FROM tasks WHERE user_id IN ({placeholders})", params)
                
                # 5. 删除 top_ups
                self._db.execute(f"DELETE FROM top_ups WHERE user_id IN ({placeholders})", params)
                
                # 6. 删除用户创建的兑换码（user_id 是创建者）
                self._db.execute(f"DELETE FROM redemptions WHERE user_id IN ({placeholders})", params)
                
                # 7. 删除 2FA 相关
                self._db.execute(f"DELETE FROM two_fa_backup_codes WHERE user_id IN ({placeholders})", params)
                self._db.execute(f"DELETE FROM two_fas WHERE user_id IN ({placeholders})", params)
                
                # 8. 删除 passkey_credentials
                self._db.execute(f"DELETE FROM passkey_credentials WHERE user_id IN ({placeholders})", params)
                
                # 9. 最后删除用户
                result = self._db.execute(f"DELETE FROM users WHERE id IN ({placeholders})", params)
                
                # 统计删除数量
                if result and result[0]:
                    affected = int(result[0].get("affected_rows", 0) or len(batch_ids))
                    deleted_count += affected
                else:
                    deleted_count += len(batch_ids)
                
                logger.debug(f"[彻底删除] 批次 {i // batch_size + 1}: 删除 {len(batch_ids)} 个用户")
            
            # 注意：logs 表数据量可能很大，不删除用户日志
            # 如果需要删除日志，可以单独执行或使用异步任务
            
            return deleted_count
            
        except Exception as e:
            logger.db_error(f"彻底删除用户失败: {e}")
            raise

    def get_soft_deleted_users_count(self) -> Dict[str, Any]:
        """
        获取已软删除（注销）用户的数量
        
        注：封禁用户是 status=2 且 deleted_at IS NULL，不会被统计
        """
        try:
            self._db.connect()
            sql = "SELECT COUNT(*) as cnt FROM users WHERE deleted_at IS NOT NULL"
            result = self._db.execute(sql, {})
            count = int(result[0]["cnt"]) if result else 0
            return {"success": True, "count": count}
        except Exception as e:
            logger.db_error(f"获取软删除用户数量失败: {e}")
            return {"success": False, "count": 0, "message": str(e)}

    def purge_soft_deleted_users(self, dry_run: bool = True) -> Dict[str, Any]:
        """
        彻底清理已软删除（注销）的用户（物理删除）
        
        注：封禁用户是 status=2 且 deleted_at IS NULL，不会被清理
        
        Args:
            dry_run: 预览模式，不实际删除
            
        Returns:
            删除结果
        """
        try:
            self._db.connect()
            
            # 获取已软删除的用户
            find_sql = "SELECT id, username FROM users WHERE deleted_at IS NOT NULL"
            result = self._db.execute(find_sql, {})
            user_ids = [row["id"] for row in result]
            usernames = [row.get("username", "") for row in result]
            
            if dry_run:
                return {
                    "success": True,
                    "dry_run": True,
                    "count": len(user_ids),
                    "users": usernames[:20],
                    "message": f"预览：将彻底清理 {len(user_ids)} 个已注销的用户",
                }
            
            if not user_ids:
                return {
                    "success": True,
                    "count": 0,
                    "message": "没有需要清理的注销用户",
                }
            
            # 执行彻底删除
            deleted_count = self._hard_delete_users(user_ids)
            
            # 清除缓存
            self._storage.cache_delete(STATS_CACHE_KEY)
            self.invalidate_activity_list_cache()
            
            logger.business("清理注销用户", count=deleted_count)
            
            return {
                "success": True,
                "count": deleted_count,
                "message": f"已彻底清理 {deleted_count} 个注销用户",
            }
            
        except Exception as e:
            logger.db_error(f"清理注销用户失败: {e}")
            return {"success": False, "message": f"清理失败: {str(e)}"}

    def get_banned_users(
        self,
        page: int = 1,
        page_size: int = 50,
        search: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        获取当前被封禁的用户列表 (status=2)
        
        Args:
            page: 页码
            page_size: 每页数量
            search: 搜索关键词 (用户名)
            
        Returns:
            分页的被封禁用户列表，按封禁时间倒序排列
        """
        try:
            self._db.connect()
            
            # 构建查询条件
            where_clauses = ["status = 2", "deleted_at IS NULL"]
            params: Dict[str, Any] = {}
            
            if search:
                where_clauses.append("(username LIKE :search OR email LIKE :search)")
                params["search"] = f"%{search}%"
            
            where_sql = " AND ".join(where_clauses)
            
            # 先查询所有被封禁用户（不分页），获取封禁信息后再排序分页
            sql = f"""
                SELECT id, username, display_name, email, status, quota, used_quota, request_count
                FROM users
                WHERE {where_sql}
            """
            result = self._db.execute(sql, params)
            
            # 获取每个用户的封禁信息并构建列表
            all_items = []
            for row in result:
                user_id = int(row["id"])
                
                # 从本地存储获取最近的封禁记录
                ban_info = self._storage.get_latest_ban_record(user_id)
                
                all_items.append({
                    "id": user_id,
                    "username": row.get("username") or "",
                    "display_name": row.get("display_name") or "",
                    "email": row.get("email") or "",
                    "quota": int(row.get("quota") or 0),
                    "used_quota": int(row.get("used_quota") or 0),
                    "request_count": int(row.get("request_count") or 0),
                    "banned_at": ban_info.get("created_at") if ban_info else None,
                    "ban_reason": ban_info.get("reason") if ban_info else None,
                    "ban_operator": ban_info.get("operator") if ban_info else None,
                    "ban_context": ban_info.get("context") if ban_info else None,
                })
            
            # 按封禁时间倒序排序（无封禁时间的排在最后）
            all_items.sort(key=lambda x: (x["banned_at"] is None, -(x["banned_at"] or 0)))
            
            # 计算分页
            total = len(all_items)
            offset = (page - 1) * page_size
            items = all_items[offset:offset + page_size]
            
            return {
                "items": items,
                "total": total,
                "page": page,
                "page_size": page_size,
                "total_pages": (total + page_size - 1) // page_size if total > 0 else 1,
            }
            
        except Exception as e:
            logger.db_error(f"获取封禁用户列表失败: {e}")
            return {
                "items": [],
                "total": 0,
                "page": page,
                "page_size": page_size,
                "total_pages": 1,
            }

    def ban_user(
        self,
        user_id: int,
        reason: Optional[str] = None,
        disable_tokens: bool = True,
        operator: str = "",
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """封禁用户（设置 status=2），可选同时禁用其所有 tokens（设置 tokens.status=2）。"""
        try:
            self._db.connect()

            check_sql = "SELECT id, username, status FROM users WHERE id = :user_id AND deleted_at IS NULL"
            check_result = self._db.execute(check_sql, {"user_id": user_id})
            if not check_result:
                return {"success": False, "message": "用户不存在"}

            username = check_result[0].get("username", "")
            current_status = int(check_result[0].get("status") or 0)
            if current_status == 2:
                return {"success": True, "message": f"用户 {username} 已是禁用状态"}

            user_update = self._db.execute(
                "UPDATE users SET status = 2 WHERE id = :user_id AND deleted_at IS NULL",
                {"user_id": user_id},
            )

            tokens_affected = 0
            if disable_tokens:
                token_update = self._db.execute(
                    "UPDATE tokens SET status = 2 WHERE user_id = :user_id AND deleted_at IS NULL",
                    {"user_id": user_id},
                )
                tokens_affected = int((token_update[0] or {}).get("affected_rows", 0) or 0)

            # 清除活跃度列表缓存（用户状态变更）
            self.invalidate_activity_list_cache()

            logger.security("封禁用户", user_id=user_id, username=username, reason=reason or "", tokens=tokens_affected)
            self._storage.add_security_audit(
                action="ban",
                user_id=user_id,
                username=username,
                operator=operator,
                reason=reason or "",
                context={
                    "disable_tokens": bool(disable_tokens),
                    **(context or {}),
                },
            )
            return {
                "success": True,
                "message": f"用户 {username} 已封禁",
                "data": {
                    "user_affected": int((user_update[0] or {}).get("affected_rows", 0) or 0),
                    "tokens_affected": tokens_affected,
                    "status": 2,
                },
            }
        except Exception as e:
            logger.db_error(f"封禁用户失败: {e}")
            return {"success": False, "message": f"封禁失败: {str(e)}"}

    def unban_user(
        self,
        user_id: int,
        reason: Optional[str] = None,
        enable_tokens: bool = False,
        operator: str = "",
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """解除封禁（设置 status=1），可选同时启用其 tokens（设置 tokens.status=1）。"""
        try:
            self._db.connect()

            check_sql = "SELECT id, username, status FROM users WHERE id = :user_id AND deleted_at IS NULL"
            check_result = self._db.execute(check_sql, {"user_id": user_id})
            if not check_result:
                return {"success": False, "message": "用户不存在"}

            username = check_result[0].get("username", "")
            current_status = int(check_result[0].get("status") or 0)
            if current_status != 2:
                return {"success": True, "message": f"用户 {username} 当前非禁用状态"}

            user_update = self._db.execute(
                "UPDATE users SET status = 1 WHERE id = :user_id AND deleted_at IS NULL",
                {"user_id": user_id},
            )

            tokens_affected = 0
            if enable_tokens:
                token_update = self._db.execute(
                    "UPDATE tokens SET status = 1 WHERE user_id = :user_id AND deleted_at IS NULL",
                    {"user_id": user_id},
                )
                tokens_affected = int((token_update[0] or {}).get("affected_rows", 0) or 0)

            # 清除活跃度列表缓存（用户状态变更）
            self.invalidate_activity_list_cache()

            logger.security("解除封禁", user_id=user_id, username=username, reason=reason or "", tokens=tokens_affected)
            self._storage.add_security_audit(
                action="unban",
                user_id=user_id,
                username=username,
                operator=operator,
                reason=reason or "",
                context={
                    "enable_tokens": bool(enable_tokens),
                    **(context or {}),
                },
            )
            return {
                "success": True,
                "message": f"用户 {username} 已解除封禁",
                "data": {
                    "user_affected": int((user_update[0] or {}).get("affected_rows", 0) or 0),
                    "tokens_affected": tokens_affected,
                    "status": 1,
                },
            }
        except Exception as e:
            logger.db_error(f"解除封禁失败: {e}")
            return {"success": False, "message": f"解除封禁失败: {str(e)}"}

    def disable_token(
        self,
        token_id: int,
        reason: Optional[str] = None,
        operator: str = "",
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """禁用单个令牌（设置 status=2）。"""
        try:
            self._db.connect()

            # 获取令牌信息
            token_rows = self._db.execute(
                """SELECT t.id, t.name, t.user_id, t.status, u.username
                   FROM tokens t
                   LEFT JOIN users u ON t.user_id = u.id
                   WHERE t.id = :token_id AND t.deleted_at IS NULL""",
                {"token_id": token_id},
            )

            if not token_rows:
                return {"success": False, "message": "令牌不存在"}

            token_info = token_rows[0]
            token_name = token_info.get("name") or f"Token#{token_id}"
            username = token_info.get("username") or f"User#{token_info.get('user_id')}"
            current_status = token_info.get("status")

            if current_status == 2:
                return {"success": False, "message": "令牌已处于禁用状态"}

            # 更新令牌状态
            result = self._db.execute(
                "UPDATE tokens SET status = 2 WHERE id = :token_id AND deleted_at IS NULL",
                {"token_id": token_id},
            )

            affected = int((result[0] or {}).get("affected_rows", 0) or 0)

            logger.security(
                "禁用令牌",
                token_id=token_id,
                token_name=token_name,
                user_id=token_info.get("user_id"),
                username=username,
                reason=reason or "",
            )

            self._storage.add_security_audit(
                action="disable_token",
                user_id=token_info.get("user_id"),
                username=username,
                operator=operator,
                reason=reason or "",
                context={
                    "token_id": token_id,
                    "token_name": token_name,
                    **(context or {}),
                },
            )

            return {
                "success": True,
                "message": f"令牌 {token_name} 已禁用",
                "data": {
                    "token_id": token_id,
                    "token_name": token_name,
                    "affected": affected,
                },
            }
        except Exception as e:
            logger.db_error(f"禁用令牌失败: {e}")
            return {"success": False, "message": f"禁用令牌失败: {str(e)}"}

    def get_user_invited_list(
        self,
        user_id: int,
        page: int = 1,
        page_size: int = 20,
    ) -> Dict[str, Any]:
        """
        获取用户邀请的账号列表。
        
        Args:
            user_id: 邀请人用户ID
            page: 页码
            page_size: 每页数量
            
        Returns:
            包含被邀请用户列表的字典
        """
        try:
            self._db.connect()
            from .database import DatabaseEngine
            is_pg = self._db.config.engine == DatabaseEngine.POSTGRESQL
            group_col = '"group"' if is_pg else '`group`'
            
            offset = (page - 1) * page_size
            
            # 先获取邀请人信息（包括 aff_code）
            inviter_sql = f"""
                SELECT id, username, display_name, aff_code, aff_count, aff_quota, aff_history
                FROM users
                WHERE id = :user_id AND deleted_at IS NULL
            """
            inviter_rows = self._db.execute(inviter_sql, {"user_id": user_id})
            
            if not inviter_rows:
                return {
                    "success": False,
                    "message": "用户不存在",
                    "inviter": None,
                    "items": [],
                    "total": 0,
                }
            
            inviter = inviter_rows[0]
            inviter_info = {
                "user_id": int(inviter.get("id") or 0),
                "username": inviter.get("username") or "",
                "display_name": inviter.get("display_name") or "",
                "aff_code": inviter.get("aff_code") or "",
                "aff_count": int(inviter.get("aff_count") or 0),
                "aff_quota": int(inviter.get("aff_quota") or 0),
                "aff_history": int(inviter.get("aff_history") or 0),
            }
            
            # 查询被邀请的用户总数
            count_sql = """
                SELECT COUNT(*) as total
                FROM users
                WHERE inviter_id = :user_id AND deleted_at IS NULL
            """
            count_result = self._db.execute(count_sql, {"user_id": user_id})
            total = int(count_result[0].get("total") or 0) if count_result else 0
            
            # 查询被邀请的用户列表
            list_sql = f"""
                SELECT id, username, display_name, email, status, 
                       quota, used_quota, request_count, {group_col},
                       role
                FROM users
                WHERE inviter_id = :user_id AND deleted_at IS NULL
                ORDER BY id DESC
                LIMIT :limit OFFSET :offset
            """
            result = self._db.execute(list_sql, {
                "user_id": user_id,
                "limit": page_size,
                "offset": offset,
            })
            
            items = []
            for row in (result or []):
                items.append({
                    "user_id": int(row.get("id") or 0),
                    "username": row.get("username") or "",
                    "display_name": row.get("display_name") or "",
                    "email": row.get("email") or "",
                    "status": int(row.get("status") or 0),
                    "quota": int(row.get("quota") or 0),
                    "used_quota": int(row.get("used_quota") or 0),
                    "request_count": int(row.get("request_count") or 0),
                    "group": row.get("group") or "default",
                    "role": int(row.get("role") or 0),
                })
            
            # 统计信息
            stats = {
                "total_invited": total,
                "active_count": sum(1 for u in items if u.get("request_count", 0) > 0),
                "banned_count": sum(1 for u in items if u.get("status") == 2),
                "total_used_quota": sum(u.get("used_quota", 0) for u in items),
                "total_requests": sum(u.get("request_count", 0) for u in items),
            }
            
            return {
                "success": True,
                "inviter": inviter_info,
                "items": items,
                "total": total,
                "page": page,
                "page_size": page_size,
                "stats": stats,
            }
            
        except Exception as e:
            logger.db_error(f"获取用户邀请列表失败: {e}")
            return {
                "success": False,
                "message": f"获取失败: {str(e)}",
                "inviter": None,
                "items": [],
                "total": 0,
            }


# 全局实例
_user_management_service: Optional[UserManagementService] = None


def get_user_management_service() -> UserManagementService:
    """获取用户管理服务实例"""
    global _user_management_service
    if _user_management_service is None:
        _user_management_service = UserManagementService()
    return _user_management_service

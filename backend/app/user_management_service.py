"""
用户管理服务模块 - NewAPI Middleware Tool
提供用户列表查询、活跃度分析、批量清理功能

性能优化：
- 统计数据使用缓存（5分钟）
- 用户列表默认不 JOIN logs 表
- 只有筛选活跃/不活跃用户时才 JOIN logs
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

    def get_activity_stats(self) -> ActivityStats:
        """
        获取用户活跃度统计（带缓存）

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

        # 缓存未命中，执行查询
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

    def _fetch_activity_stats(self) -> ActivityStats:
        """
        从数据库获取用户活跃度统计

        使用高效的单次查询统计所有活跃度级别。
        """
        now = int(time.time())
        active_cutoff = now - ACTIVE_THRESHOLD
        inactive_cutoff = now - INACTIVE_THRESHOLD

        try:
            self._db.connect()

            # 使用子查询 + 条件聚合，一次查询完成
            stats_sql = """
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN last_req >= :active_cutoff THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN last_req < :active_cutoff AND last_req >= :inactive_cutoff THEN 1 ELSE 0 END) as inactive,
                    SUM(CASE WHEN last_req < :inactive_cutoff THEN 1 ELSE 0 END) as very_inactive,
                    SUM(CASE WHEN last_req IS NULL THEN 1 ELSE 0 END) as never_req
                FROM (
                    SELECT u.id, MAX(l.created_at) as last_req
                    FROM users u
                    LEFT JOIN logs l ON u.id = l.user_id AND l.type = 2
                    WHERE u.deleted_at IS NULL
                    GROUP BY u.id
                ) user_activity
            """

            result = self._db.execute(stats_sql, {
                "active_cutoff": active_cutoff,
                "inactive_cutoff": inactive_cutoff,
            })

            if result and result[0]:
                row = result[0]
                return ActivityStats(
                    total_users=int(row.get("total") or 0),
                    active_users=int(row.get("active") or 0),
                    inactive_users=int(row.get("inactive") or 0),
                    very_inactive_users=int(row.get("very_inactive") or 0),
                    never_requested=int(row.get("never_req") or 0),
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

    def get_users(
        self,
        page: int = 1,
        page_size: int = 20,
        activity_filter: Optional[ActivityLevel] = None,
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
            return self._get_users_with_activity(page, page_size, activity_filter, search, order_by, order_dir)
        else:
            return self._get_users_fast(page, page_size, activity_filter, search, order_by, order_dir)

    def _get_users_fast(
        self,
        page: int,
        page_size: int,
        activity_filter: Optional[ActivityLevel],
        search: Optional[str],
        order_by: str,
        order_dir: str,
    ) -> Dict[str, Any]:
        """
        快速获取用户列表（不 JOIN logs 表）

        用于：无筛选、筛选"从未请求"的情况
        """
        offset = (page - 1) * page_size

        # 基础查询 - 只查 users 表
        base_sql = """
            SELECT
                id, username, display_name, email,
                role, status, quota, used_quota,
                request_count, `group`
            FROM users
            WHERE deleted_at IS NULL
        """

        base_sql_pg = """
            SELECT
                id, username, display_name, email,
                role, status, quota, used_quota,
                request_count, "group"
            FROM users
            WHERE deleted_at IS NULL
        """

        params: Dict[str, Any] = {
            "limit": page_size,
            "offset": offset,
        }

        where_clauses = []

        # 搜索条件
        if search:
            where_clauses.append("(username LIKE :search OR email LIKE :search)")
            params["search"] = f"%{search}%"

        # 从未请求筛选
        if activity_filter == ActivityLevel.NEVER:
            where_clauses.append("request_count = 0")

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

            # 尝试 MySQL
            try:
                full_sql = base_sql + where_sql + order_sql + limit_sql
                result = self._db.execute(full_sql, params)
            except Exception:
                full_sql = base_sql_pg + where_sql + order_sql + limit_sql
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
        search: Optional[str],
        order_by: str,
        order_dir: str,
    ) -> Dict[str, Any]:
        """
        获取用户列表（带精确活跃度，JOIN logs 表）

        用于：筛选活跃/不活跃/非常不活跃的情况
        """
        now = int(time.time())
        active_cutoff = now - ACTIVE_THRESHOLD
        inactive_cutoff = now - INACTIVE_THRESHOLD
        offset = (page - 1) * page_size

        # 基础查询
        base_sql = """
            SELECT
                u.id, u.username, u.display_name, u.email,
                u.role, u.status, u.quota, u.used_quota,
                u.request_count, u.`group`,
                MAX(l.created_at) as last_request_time
            FROM users u
            LEFT JOIN logs l ON u.id = l.user_id AND l.type = 2
            WHERE u.deleted_at IS NULL
        """

        base_sql_pg = """
            SELECT
                u.id, u.username, u.display_name, u.email,
                u.role, u.status, u.quota, u.used_quota,
                u.request_count, u."group",
                MAX(l.created_at) as last_request_time
            FROM users u
            LEFT JOIN logs l ON u.id = l.user_id AND l.type = 2
            WHERE u.deleted_at IS NULL
        """

        params: Dict[str, Any] = {
            "active_cutoff": active_cutoff,
            "inactive_cutoff": inactive_cutoff,
            "limit": page_size,
            "offset": offset,
        }

        where_clauses = []
        if search:
            where_clauses.append("(u.username LIKE :search OR u.email LIKE :search)")
            params["search"] = f"%{search}%"

        where_sql = ""
        if where_clauses:
            where_sql = " AND " + " AND ".join(where_clauses)

        group_by = " GROUP BY u.id, u.username, u.display_name, u.email, u.role, u.status, u.quota, u.used_quota, u.request_count, u.`group`"
        group_by_pg = ' GROUP BY u.id, u.username, u.display_name, u.email, u.role, u.status, u.quota, u.used_quota, u.request_count, u."group"'

        # 活跃度筛选
        having_clause = ""
        if activity_filter == ActivityLevel.ACTIVE:
            having_clause = " HAVING MAX(l.created_at) >= :active_cutoff"
        elif activity_filter == ActivityLevel.INACTIVE:
            having_clause = " HAVING MAX(l.created_at) < :active_cutoff AND MAX(l.created_at) >= :inactive_cutoff"
        elif activity_filter == ActivityLevel.VERY_INACTIVE:
            having_clause = " HAVING MAX(l.created_at) < :inactive_cutoff"

        # 排序
        order_column = "last_request_time"
        if order_by == "username":
            order_column = "u.username"
        elif order_by == "quota":
            order_column = "u.quota"
        elif order_by == "used_quota":
            order_column = "u.used_quota"
        elif order_by == "request_count":
            order_column = "u.request_count"

        order_clause = f" ORDER BY {order_column} {'DESC' if order_dir.upper() == 'DESC' else 'ASC'} NULLS LAST"
        order_clause_mysql = f" ORDER BY {order_column} IS NULL, {order_column} {'DESC' if order_dir.upper() == 'DESC' else 'ASC'}"
        limit_clause = " LIMIT :limit OFFSET :offset"

        try:
            self._db.connect()

            # 尝试 MySQL 语法
            try:
                full_sql = base_sql + where_sql + group_by + having_clause + order_clause_mysql + limit_clause
                result = self._db.execute(full_sql, params)
            except Exception:
                full_sql = base_sql_pg + where_sql + group_by_pg + having_clause + order_clause + limit_clause
                result = self._db.execute(full_sql, params)

            # 总数
            count_sql = f"""
                SELECT COUNT(*) as cnt FROM (
                    SELECT u.id, MAX(l.created_at) as last_req
                    FROM users u
                    LEFT JOIN logs l ON u.id = l.user_id AND l.type = 2
                    WHERE u.deleted_at IS NULL{where_sql}
                    GROUP BY u.id
                    {having_clause}
                ) sub
            """
            count_result = self._db.execute(count_sql, params)
            total = int(count_result[0]["cnt"]) if count_result else 0

            # 转换结果
            users = []
            for row in result:
                last_req = row.get("last_request_time")
                activity = self._calculate_activity_level(last_req, now)

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
                    last_request_time=int(last_req) if last_req else None,
                    activity_level=activity,
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

    def delete_user(self, user_id: int) -> Dict[str, Any]:
        """软删除单个用户"""
        try:
            self._db.connect()

            # 检查用户是否存在
            check_sql = "SELECT id, username FROM users WHERE id = :user_id AND deleted_at IS NULL"
            check_result = self._db.execute(check_sql, {"user_id": user_id})

            if not check_result:
                return {"success": False, "message": "用户不存在"}

            username = check_result[0].get("username", "")

            # 软删除用户
            try:
                delete_sql = "UPDATE users SET deleted_at = NOW() WHERE id = :user_id"
                self._db.execute(delete_sql, {"user_id": user_id})
            except Exception:
                delete_sql = "UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = :user_id"
                self._db.execute(delete_sql, {"user_id": user_id})

            # 同时软删除用户的 tokens
            try:
                token_sql = "UPDATE tokens SET deleted_at = NOW() WHERE user_id = :user_id AND deleted_at IS NULL"
                self._db.execute(token_sql, {"user_id": user_id})
            except Exception:
                token_sql = "UPDATE tokens SET deleted_at = CURRENT_TIMESTAMP WHERE user_id = :user_id AND deleted_at IS NULL"
                self._db.execute(token_sql, {"user_id": user_id})

            # 清除统计缓存
            self._storage.cache_delete(STATS_CACHE_KEY)

            logger.business("删除用户", user_id=user_id, username=username)
            return {"success": True, "message": f"用户 {username} 已删除"}

        except Exception as e:
            logger.db_error(f"删除用户失败: {e}")
            return {"success": False, "message": f"删除失败: {str(e)}"}

    def batch_delete_inactive_users(
        self,
        activity_level: ActivityLevel = ActivityLevel.VERY_INACTIVE,
        dry_run: bool = True,
    ) -> Dict[str, Any]:
        """批量删除不活跃用户"""
        now = int(time.time())
        inactive_cutoff = now - INACTIVE_THRESHOLD

        try:
            self._db.connect()

            # 查找要删除的用户
            if activity_level == ActivityLevel.VERY_INACTIVE:
                find_sql = """
                    SELECT u.id, u.username
                    FROM users u
                    LEFT JOIN logs l ON u.id = l.user_id AND l.type = 2
                    WHERE u.deleted_at IS NULL
                    GROUP BY u.id, u.username
                    HAVING MAX(l.created_at) < :cutoff
                """
                params = {"cutoff": inactive_cutoff}
            elif activity_level == ActivityLevel.NEVER:
                # 使用 request_count = 0 快速查询
                find_sql = """
                    SELECT id, username
                    FROM users
                    WHERE deleted_at IS NULL AND request_count = 0
                """
                params = {}
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
                    "message": f"预览：将删除 {len(user_ids)} 个用户",
                }

            if not user_ids:
                return {
                    "success": True,
                    "count": 0,
                    "message": "没有需要删除的用户",
                }

            # 执行批量删除
            for user_id in user_ids:
                self.delete_user(user_id)

            # 清除缓存
            self._storage.cache_delete(STATS_CACHE_KEY)

            logger.business("批量删除不活跃用户", count=len(user_ids), level=activity_level.value)

            return {
                "success": True,
                "count": len(user_ids),
                "message": f"已删除 {len(user_ids)} 个不活跃用户",
            }

        except Exception as e:
            logger.db_error(f"批量删除用户失败: {e}")
            return {"success": False, "message": f"批量删除失败: {str(e)}"}


# 全局实例
_user_management_service: Optional[UserManagementService] = None


def get_user_management_service() -> UserManagementService:
    """获取用户管理服务实例"""
    global _user_management_service
    if _user_management_service is None:
        _user_management_service = UserManagementService()
    return _user_management_service

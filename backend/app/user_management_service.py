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
        - 活跃/不活跃/非常不活跃：通过 JOIN logs 表获取最后请求时间判断
        - 从未请求：使用 users.request_count = 0 判断（与用户列表逻辑一致）
        """
        now = int(time.time())
        active_cutoff = now - ACTIVE_THRESHOLD
        inactive_cutoff = now - INACTIVE_THRESHOLD

        try:
            self._db.connect()

            # 先统计从未请求的用户数（使用 request_count 字段，与用户列表一致）
            never_sql = """
                SELECT COUNT(*) as cnt FROM users
                WHERE deleted_at IS NULL AND request_count = 0
            """
            never_result = self._db.execute(never_sql, {})
            never_count = int(never_result[0]["cnt"]) if never_result else 0

            # 统计有请求的用户的活跃度分布
            stats_sql = """
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN last_req >= :active_cutoff THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN last_req < :active_cutoff AND last_req >= :inactive_cutoff THEN 1 ELSE 0 END) as inactive,
                    SUM(CASE WHEN last_req < :inactive_cutoff THEN 1 ELSE 0 END) as very_inactive
                FROM (
                    SELECT u.id, MAX(l.created_at) as last_req
                    FROM users u
                    INNER JOIN logs l ON u.id = l.user_id AND l.type = 2
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
                active_count = int(row.get("total") or 0)
                return ActivityStats(
                    total_users=active_count + never_count,
                    active_users=int(row.get("active") or 0),
                    inactive_users=int(row.get("inactive") or 0),
                    very_inactive_users=int(row.get("very_inactive") or 0),
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

        # 根据数据库类型选择正确的 SQL（group 是保留字）
        from .database import DatabaseEngine
        is_pg = self._db.config.engine == DatabaseEngine.POSTGRESQL
        group_col = '"group"' if is_pg else '`group`'

        base_sql = f"""
            SELECT
                id, username, display_name, email,
                role, status, quota, used_quota,
                request_count, {group_col}
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

        # 根据数据库类型选择正确的 SQL
        from .database import DatabaseEngine
        is_pg = self._db.config.engine == DatabaseEngine.POSTGRESQL
        group_col = 'u."group"' if is_pg else 'u.`group`'

        base_sql = f"""
            SELECT
                u.id, u.username, u.display_name, u.email,
                u.role, u.status, u.quota, u.used_quota,
                u.request_count, {group_col},
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

        group_by = f" GROUP BY u.id, u.username, u.display_name, u.email, u.role, u.status, u.quota, u.used_quota, u.request_count, {group_col}"

        # 活跃度筛选
        having_clause = ""
        if activity_filter == ActivityLevel.ACTIVE:
            having_clause = " HAVING MAX(l.created_at) >= :active_cutoff"
        elif activity_filter == ActivityLevel.INACTIVE:
            having_clause = " HAVING MAX(l.created_at) < :active_cutoff AND MAX(l.created_at) >= :inactive_cutoff"
        elif activity_filter == ActivityLevel.VERY_INACTIVE:
            having_clause = " HAVING MAX(l.created_at) < :inactive_cutoff"

        # 排序 - 根据数据库类型选择 NULL 排序语法
        order_column = "last_request_time"
        if order_by == "username":
            order_column = "u.username"
        elif order_by == "quota":
            order_column = "u.quota"
        elif order_by == "used_quota":
            order_column = "u.used_quota"
        elif order_by == "request_count":
            order_column = "u.request_count"

        order_dir_str = 'DESC' if order_dir.upper() == 'DESC' else 'ASC'
        if is_pg:
            order_clause = f" ORDER BY {order_column} {order_dir_str} NULLS LAST"
        else:
            order_clause = f" ORDER BY {order_column} IS NULL, {order_column} {order_dir_str}"
        limit_clause = " LIMIT :limit OFFSET :offset"

        try:
            self._db.connect()

            full_sql = base_sql + where_sql + group_by + having_clause + order_clause + limit_clause
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

            # 软删除用户 (CURRENT_TIMESTAMP 兼容 MySQL 和 PostgreSQL)
            delete_sql = "UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = :user_id"
            self._db.execute(delete_sql, {"user_id": user_id})

            # 同时软删除用户的 tokens
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
                # 使用 logs 表判断，与统计逻辑一致
                find_sql = """
                    SELECT u.id, u.username
                    FROM users u
                    LEFT JOIN logs l ON u.id = l.user_id AND l.type = 2
                    WHERE u.deleted_at IS NULL
                    GROUP BY u.id, u.username
                    HAVING MAX(l.created_at) IS NULL
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

            logger.business("批量删除不活跃用户", count=len(user_ids), activity=activity_level.value)

            return {
                "success": True,
                "count": len(user_ids),
                "message": f"已删除 {len(user_ids)} 个不活跃用户",
            }

        except Exception as e:
            logger.db_error(f"批量删除用户失败: {e}")
            return {"success": False, "message": f"批量删除失败: {str(e)}"}

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
            分页的被封禁用户列表
        """
        offset = (page - 1) * page_size
        
        try:
            self._db.connect()
            
            # 构建查询条件
            where_clauses = ["status = 2", "deleted_at IS NULL"]
            params: Dict[str, Any] = {
                "limit": page_size,
                "offset": offset,
            }
            
            if search:
                where_clauses.append("(username LIKE :search OR email LIKE :search)")
                params["search"] = f"%{search}%"
            
            where_sql = " AND ".join(where_clauses)
            
            # 查询被封禁用户
            sql = f"""
                SELECT id, username, display_name, email, status, quota, used_quota, request_count
                FROM users
                WHERE {where_sql}
                ORDER BY id DESC
                LIMIT :limit OFFSET :offset
            """
            result = self._db.execute(sql, params)
            
            # 查询总数
            count_sql = f"SELECT COUNT(*) as cnt FROM users WHERE {where_sql}"
            count_result = self._db.execute(count_sql, params)
            total = int(count_result[0]["cnt"]) if count_result else 0
            
            # 获取每个用户最近的封禁记录
            items = []
            for row in result:
                user_id = int(row["id"])
                
                # 从 security_audit 获取最近的封禁记录
                ban_info = self._storage.get_latest_ban_record(user_id)
                
                items.append({
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


# 全局实例
_user_management_service: Optional[UserManagementService] = None


def get_user_management_service() -> UserManagementService:
    """获取用户管理服务实例"""
    global _user_management_service
    if _user_management_service is None:
        _user_management_service = UserManagementService()
    return _user_management_service

"""
自动分组服务 - NewAPI Middleware Tool

将 "default" 组的新用户自动分配到目标用户组。

功能：
- 配置管理（启用/禁用、目标组选择、扫描间隔、白名单）
- 待分配用户预览
- 手动/自动扫描执行分组分配
- 分配日志记录和恢复
- 按注册来源分组
- 批量手动移动分组

安全设计：
- 默认关闭功能，需手动启用
- 目标分组默认为空，必须手动选择才能执行分配
- 不预设任何危险分组
"""
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set
from enum import Enum

from .logger import logger
from .local_storage import get_local_storage
from .database import get_db_manager, DatabaseEngine


class RegistrationSource(Enum):
    """用户注册来源"""
    GITHUB = "github"
    WECHAT = "wechat"
    TELEGRAM = "telegram"
    DISCORD = "discord"
    OIDC = "oidc"
    LINUX_DO = "linux_do"
    PASSWORD = "password"


# 配置常量
AUTO_GROUP_CONFIG_KEY = "auto_group_config"
DEFAULT_SCAN_INTERVAL = 60  # 默认扫描间隔（分钟）


@dataclass
class AutoGroupConfig:
    """自动分组配置"""
    enabled: bool = False
    mode: str = "simple"  # "simple" 或 "by_source"
    target_group: str = ""  # simple 模式使用
    source_rules: Dict[str, str] = None  # by_source 模式使用
    scan_interval_minutes: int = DEFAULT_SCAN_INTERVAL
    auto_scan_enabled: bool = False
    whitelist_ids: List[int] = None

    def __post_init__(self):
        if self.source_rules is None:
            self.source_rules = {
                "github": "",
                "wechat": "",
                "telegram": "",
                "discord": "",
                "oidc": "",
                "linux_do": "",
                "password": "",
            }
        if self.whitelist_ids is None:
            self.whitelist_ids = []


class AutoGroupService:
    """自动分组服务"""

    def __init__(self):
        self._storage = get_local_storage()
        self._config: Optional[AutoGroupConfig] = None
        self._last_scan_time: int = 0
        self._reload_config()

    def _reload_config(self):
        """从本地存储加载配置"""
        stored = self._storage.get_config(AUTO_GROUP_CONFIG_KEY) or {}
        self._config = AutoGroupConfig(
            enabled=stored.get("enabled", False),
            mode=stored.get("mode", "simple"),
            target_group=stored.get("target_group", ""),
            source_rules=stored.get("source_rules", {
                "github": "",
                "wechat": "",
                "telegram": "",
                "discord": "",
                "oidc": "",
                "linux_do": "",
                "password": "",
            }),
            scan_interval_minutes=stored.get("scan_interval_minutes", DEFAULT_SCAN_INTERVAL),
            auto_scan_enabled=stored.get("auto_scan_enabled", False),
            whitelist_ids=stored.get("whitelist_ids", []),
        )

    def get_config(self) -> Dict[str, Any]:
        """获取当前配置"""
        return {
            "enabled": self._config.enabled,
            "mode": self._config.mode,
            "target_group": self._config.target_group,
            "source_rules": self._config.source_rules,
            "scan_interval_minutes": self._config.scan_interval_minutes,
            "auto_scan_enabled": self._config.auto_scan_enabled,
            "whitelist_ids": self._config.whitelist_ids,
            "last_scan_time": self._last_scan_time,
        }

    def save_config(self, config: Dict[str, Any]) -> bool:
        """保存配置到本地存储"""
        try:
            current = self._storage.get_config(AUTO_GROUP_CONFIG_KEY) or {}
            current.update(config)
            self._storage.set_config(AUTO_GROUP_CONFIG_KEY, current)
            self._reload_config()
            logger.business("自动分组配置已更新", **{k: v for k, v in config.items()})
            return True
        except Exception as e:
            logger.error(f"保存自动分组配置失败: {e}")
            return False

    def is_enabled(self) -> bool:
        """检查服务是否启用"""
        return self._config.enabled

    def get_scan_interval(self) -> int:
        """获取扫描间隔（分钟）"""
        if not self._config.auto_scan_enabled:
            return 0
        return self._config.scan_interval_minutes

    def get_available_groups(self) -> List[Dict[str, Any]]:
        """
        获取数据库中所有现有分组

        Returns:
            分组列表，包含分组名称和用户数
        """
        try:
            db = get_db_manager()
            db.connect()

            is_pg = db.config.engine == DatabaseEngine.POSTGRESQL
            group_col = '"group"' if is_pg else '`group`'

            sql = f"""
                SELECT COALESCE({group_col}, 'default') as group_name, COUNT(*) as user_count
                FROM users
                WHERE deleted_at IS NULL
                GROUP BY COALESCE({group_col}, 'default')
                ORDER BY user_count DESC
            """

            rows = db.execute(sql, {})
            return [
                {
                    "group_name": r.get("group_name") or "default",
                    "user_count": int(r.get("user_count") or 0)
                }
                for r in (rows or [])
            ]
        except Exception as e:
            logger.error(f"获取可用分组列表失败: {e}")
            return []

    def detect_registration_source(self, user: Dict[str, Any]) -> RegistrationSource:
        """
        检测用户注册来源

        根据 OAuth ID 字段判断注册来源
        """
        if user.get("github_id"):
            return RegistrationSource.GITHUB
        if user.get("wechat_id"):
            return RegistrationSource.WECHAT
        if user.get("telegram_id"):
            return RegistrationSource.TELEGRAM
        if user.get("discord_id"):
            return RegistrationSource.DISCORD
        if user.get("oidc_id"):
            return RegistrationSource.OIDC
        if user.get("linux_do_id"):
            return RegistrationSource.LINUX_DO
        return RegistrationSource.PASSWORD

    def get_target_group_by_source(self, source: RegistrationSource) -> str:
        """
        根据注册来源获取目标分组

        Args:
            source: 注册来源

        Returns:
            目标分组名称，如果未配置则返回空字符串
        """
        if self._config.mode == "simple":
            return self._config.target_group
        return self._config.source_rules.get(source.value, "")

    def _is_whitelisted(self, user_id: int) -> bool:
        """检查用户是否在白名单中"""
        return user_id in self._config.whitelist_ids

    def get_pending_users(
        self,
        page: int = 1,
        page_size: int = 50,
    ) -> Dict[str, Any]:
        """
        获取待分配用户列表

        筛选条件：
        - 用户当前组必须是 "default"
        - 用户未被软删除（deleted_at IS NULL）
        - 用户状态正常（status = 1）
        - 用户不在白名单中
        """
        try:
            db = get_db_manager()
            db.connect()

            is_pg = db.config.engine == DatabaseEngine.POSTGRESQL
            group_col = '"group"' if is_pg else '`group`'

            # 构建白名单排除条件
            whitelist_ids = self._config.whitelist_ids
            whitelist_condition = ""
            if whitelist_ids:
                placeholders = ", ".join([":wl_" + str(i) for i in range(len(whitelist_ids))])
                whitelist_condition = f"AND id NOT IN ({placeholders})"

            # 计算总数
            count_sql = f"""
                SELECT COUNT(*) as cnt
                FROM users
                WHERE (COALESCE({group_col}, 'default') = 'default' OR {group_col} = '')
                AND deleted_at IS NULL
                AND status = 1
                {whitelist_condition}
            """

            params = {}
            for i, wl_id in enumerate(whitelist_ids):
                params[f"wl_{i}"] = wl_id

            count_result = db.execute(count_sql, params)
            total = int(count_result[0].get("cnt", 0)) if count_result else 0

            # 获取用户列表
            offset = (page - 1) * page_size
            list_sql = f"""
                SELECT id, username, display_name, email, {group_col} as user_group,
                       github_id, wechat_id, telegram_id, discord_id, oidc_id, linux_do_id,
                       status
                FROM users
                WHERE (COALESCE({group_col}, 'default') = 'default' OR {group_col} = '')
                AND deleted_at IS NULL
                AND status = 1
                {whitelist_condition}
                ORDER BY id DESC
                LIMIT :limit OFFSET :offset
            """

            params["limit"] = page_size
            params["offset"] = offset

            rows = db.execute(list_sql, params)

            items = []
            for r in (rows or []):
                user_dict = dict(r)
                source = self.detect_registration_source(user_dict)
                items.append({
                    "id": int(r.get("id")),
                    "username": r.get("username") or "",
                    "display_name": r.get("display_name") or "",
                    "email": r.get("email") or "",
                    "group": r.get("user_group") or "default",
                    "source": source.value,
                    "status": int(r.get("status") or 0),
                })

            return {
                "items": items,
                "total": total,
                "page": page,
                "page_size": page_size,
                "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
            }
        except Exception as e:
            logger.error(f"获取待分配用户列表失败: {e}")
            return {
                "items": [],
                "total": 0,
                "page": page,
                "page_size": page_size,
                "total_pages": 0,
            }

    def get_users(
        self,
        page: int = 1,
        page_size: int = 50,
        group: Optional[str] = None,
        source: Optional[str] = None,
        keyword: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        获取用户列表（支持筛选）

        Args:
            page: 页码
            page_size: 每页数量
            group: 按当前分组筛选
            source: 按注册来源筛选
            keyword: 按用户名/ID搜索
        """
        try:
            db = get_db_manager()
            db.connect()

            is_pg = db.config.engine == DatabaseEngine.POSTGRESQL
            group_col = '"group"' if is_pg else '`group`'

            # 构建查询条件
            conditions = ["deleted_at IS NULL"]
            params = {}

            if group:
                if group == "default":
                    conditions.append(f"(COALESCE({group_col}, 'default') = 'default' OR {group_col} = '')")
                else:
                    conditions.append(f"{group_col} = :group_filter")
                    params["group_filter"] = group

            if keyword:
                if keyword.isdigit():
                    conditions.append("(id = :keyword_id OR username LIKE :keyword_like)")
                    params["keyword_id"] = int(keyword)
                    params["keyword_like"] = f"%{keyword}%"
                else:
                    conditions.append("username LIKE :keyword_like")
                    params["keyword_like"] = f"%{keyword}%"

            where_sql = " AND ".join(conditions)

            # 计算总数
            count_sql = f"SELECT COUNT(*) as cnt FROM users WHERE {where_sql}"
            count_result = db.execute(count_sql, params)
            total = int(count_result[0].get("cnt", 0)) if count_result else 0

            # 获取用户列表
            offset = (page - 1) * page_size
            list_sql = f"""
                SELECT id, username, display_name, email, {group_col} as user_group,
                       github_id, wechat_id, telegram_id, discord_id, oidc_id, linux_do_id,
                       status
                FROM users
                WHERE {where_sql}
                ORDER BY id DESC
                LIMIT :limit OFFSET :offset
            """

            params["limit"] = page_size
            params["offset"] = offset

            rows = db.execute(list_sql, params)

            items = []
            for r in (rows or []):
                user_dict = dict(r)
                user_source = self.detect_registration_source(user_dict)

                # 如果指定了来源筛选，过滤不匹配的用户
                if source and user_source.value != source:
                    continue

                items.append({
                    "id": int(r.get("id")),
                    "username": r.get("username") or "",
                    "display_name": r.get("display_name") or "",
                    "email": r.get("email") or "",
                    "group": r.get("user_group") or "default",
                    "source": user_source.value,
                    "status": int(r.get("status") or 0),
                })

            # 如果有来源筛选，需要重新计算总数（因为来源是在应用层过滤的）
            if source:
                # 重新获取所有用户并过滤
                all_sql = f"""
                    SELECT id, github_id, wechat_id, telegram_id, discord_id, oidc_id, linux_do_id
                    FROM users
                    WHERE {where_sql}
                """
                all_rows = db.execute(all_sql, {k: v for k, v in params.items() if k not in ["limit", "offset"]})
                filtered_count = 0
                for r in (all_rows or []):
                    user_dict = dict(r)
                    user_source = self.detect_registration_source(user_dict)
                    if user_source.value == source:
                        filtered_count += 1
                total = filtered_count

            return {
                "items": items,
                "total": total,
                "page": page,
                "page_size": page_size,
                "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
            }
        except Exception as e:
            logger.error(f"获取用户列表失败: {e}")
            return {
                "items": [],
                "total": 0,
                "page": page,
                "page_size": page_size,
                "total_pages": 0,
            }

    def assign_user(
        self,
        user_id: int,
        target_group: str,
        operator: str = "system",
    ) -> Dict[str, Any]:
        """
        分配单个用户到目标分组

        Args:
            user_id: 用户ID
            target_group: 目标分组
            operator: 操作者

        Returns:
            操作结果
        """
        try:
            db = get_db_manager()
            db.connect()

            is_pg = db.config.engine == DatabaseEngine.POSTGRESQL
            group_col = '"group"' if is_pg else '`group`'

            # 获取用户信息
            user_sql = f"""
                SELECT id, username, {group_col} as user_group,
                       github_id, wechat_id, telegram_id, discord_id, oidc_id, linux_do_id
                FROM users
                WHERE id = :user_id AND deleted_at IS NULL
            """
            user_result = db.execute(user_sql, {"user_id": user_id})

            if not user_result:
                return {"success": False, "message": "用户不存在"}

            user = user_result[0]
            old_group = user.get("user_group") or "default"
            username = user.get("username") or ""
            source = self.detect_registration_source(dict(user))

            # 更新用户分组
            update_sql = f"""
                UPDATE users
                SET {group_col} = :target_group
                WHERE id = :user_id
            """
            db.execute(update_sql, {"target_group": target_group, "user_id": user_id})

            # 记录日志
            self._storage.add_auto_group_log(
                user_id=user_id,
                username=username,
                old_group=old_group,
                new_group=target_group,
                action="assign",
                source=source.value,
                operator=operator,
            )

            logger.business(
                "自动分组: 用户分配",
                user_id=user_id,
                username=username,
                old_group=old_group,
                new_group=target_group,
                source=source.value,
                operator=operator,
            )

            return {
                "success": True,
                "message": f"用户 {username} 已分配到 {target_group}",
                "user_id": user_id,
                "username": username,
                "old_group": old_group,
                "new_group": target_group,
                "source": source.value,
            }
        except Exception as e:
            logger.error(f"分配用户失败: {e}")
            return {"success": False, "message": str(e)}

    def batch_move_users(
        self,
        user_ids: List[int],
        target_group: str,
        operator: str = "admin",
    ) -> Dict[str, Any]:
        """
        批量移动用户到指定分组

        Args:
            user_ids: 用户ID列表
            target_group: 目标分组
            operator: 操作者

        Returns:
            操作结果
        """
        if not user_ids:
            return {"success": False, "message": "未选择用户"}

        if not target_group:
            return {"success": False, "message": "未指定目标分组"}

        success_count = 0
        failed_count = 0
        results = []

        for user_id in user_ids:
            result = self.assign_user(user_id, target_group, operator)
            if result.get("success"):
                success_count += 1
            else:
                failed_count += 1
            results.append(result)

        return {
            "success": failed_count == 0,
            "message": f"成功移动 {success_count} 个用户，失败 {failed_count} 个",
            "success_count": success_count,
            "failed_count": failed_count,
            "results": results,
        }

    def revert_user(self, log_id: int, operator: str = "admin") -> Dict[str, Any]:
        """
        恢复用户到原分组

        Args:
            log_id: 日志ID
            operator: 操作者

        Returns:
            操作结果
        """
        try:
            # 获取日志记录
            log = self._storage.get_auto_group_log_by_id(log_id)
            if not log:
                return {"success": False, "message": "日志记录不存在"}

            user_id = log["user_id"]
            old_group = log["old_group"]
            new_group = log["new_group"]
            username = log["username"]

            db = get_db_manager()
            db.connect()

            is_pg = db.config.engine == DatabaseEngine.POSTGRESQL
            group_col = '"group"' if is_pg else '`group`'

            # 检查用户当前分组是否是之前分配的分组
            user_sql = f"""
                SELECT id, {group_col} as user_group
                FROM users
                WHERE id = :user_id AND deleted_at IS NULL
            """
            user_result = db.execute(user_sql, {"user_id": user_id})

            if not user_result:
                return {"success": False, "message": "用户不存在"}

            current_group = user_result[0].get("user_group") or "default"
            if current_group != new_group:
                return {
                    "success": False,
                    "message": f"用户当前分组 ({current_group}) 与日志记录不符 ({new_group})，无法恢复"
                }

            # 恢复用户分组
            update_sql = f"""
                UPDATE users
                SET {group_col} = :old_group
                WHERE id = :user_id
            """
            db.execute(update_sql, {"old_group": old_group, "user_id": user_id})

            # 记录恢复日志
            self._storage.add_auto_group_log(
                user_id=user_id,
                username=username,
                old_group=new_group,
                new_group=old_group,
                action="revert",
                source=log.get("source", ""),
                operator=operator,
            )

            logger.business(
                "自动分组: 用户恢复",
                user_id=user_id,
                username=username,
                from_group=new_group,
                to_group=old_group,
                operator=operator,
            )

            return {
                "success": True,
                "message": f"用户 {username} 已恢复到 {old_group}",
                "user_id": user_id,
                "username": username,
                "old_group": new_group,
                "new_group": old_group,
            }
        except Exception as e:
            logger.error(f"恢复用户失败: {e}")
            return {"success": False, "message": str(e)}

    def run_scan(self, dry_run: bool = False, operator: str = "system") -> Dict[str, Any]:
        """
        执行扫描分配

        Args:
            dry_run: 是否为试运行模式（不实际执行分配）
            operator: 操作者

        Returns:
            扫描结果
        """
        if not self._config.enabled:
            return {
                "success": False,
                "message": "自动分组功能未启用",
            }

        # 检查是否配置了目标分组
        if self._config.mode == "simple" and not self._config.target_group:
            return {
                "success": False,
                "message": "未配置目标分组",
            }

        if self._config.mode == "by_source":
            has_any_rule = any(v for v in self._config.source_rules.values())
            if not has_any_rule:
                return {
                    "success": False,
                    "message": "未配置任何来源分组规则",
                }

        start_time = time.time()
        results = []
        assigned_count = 0
        skipped_count = 0
        error_count = 0

        # 获取待分配用户
        pending = self.get_pending_users(page=1, page_size=1000)
        users = pending.get("items", [])

        logger.info(f"自动分组扫描: 发现 {len(users)} 个待分配用户")

        for user in users:
            user_id = user["id"]
            username = user["username"]
            source = RegistrationSource(user["source"])

            # 获取目标分组
            target_group = self.get_target_group_by_source(source)

            if not target_group:
                skipped_count += 1
                results.append({
                    "user_id": user_id,
                    "username": username,
                    "source": source.value,
                    "action": "skipped",
                    "message": f"来源 {source.value} 未配置目标分组",
                })
                continue

            if dry_run:
                assigned_count += 1
                results.append({
                    "user_id": user_id,
                    "username": username,
                    "source": source.value,
                    "target_group": target_group,
                    "action": "would_assign",
                    "message": f"[试运行] 将分配到 {target_group}",
                })
            else:
                result = self.assign_user(user_id, target_group, operator)
                if result.get("success"):
                    assigned_count += 1
                    results.append({
                        "user_id": user_id,
                        "username": username,
                        "source": source.value,
                        "target_group": target_group,
                        "action": "assigned",
                        "message": result.get("message"),
                    })
                else:
                    error_count += 1
                    results.append({
                        "user_id": user_id,
                        "username": username,
                        "source": source.value,
                        "action": "error",
                        "message": result.get("message"),
                    })

        elapsed = time.time() - start_time
        self._last_scan_time = int(time.time())

        logger.business(
            "自动分组扫描完成",
            dry_run=dry_run,
            total=len(users),
            assigned=assigned_count,
            skipped=skipped_count,
            errors=error_count,
            elapsed=f"{elapsed:.2f}s",
        )

        return {
            "success": True,
            "dry_run": dry_run,
            "stats": {
                "total": len(users),
                "assigned": assigned_count,
                "skipped": skipped_count,
                "errors": error_count,
            },
            "elapsed_seconds": round(elapsed, 2),
            "results": results,
        }

    def get_logs(
        self,
        page: int = 1,
        page_size: int = 50,
        action: Optional[str] = None,
        user_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """获取分配日志"""
        return self._storage.get_auto_group_logs(
            page=page,
            page_size=page_size,
            action=action,
            user_id=user_id,
        )

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        try:
            db = get_db_manager()
            db.connect()

            is_pg = db.config.engine == DatabaseEngine.POSTGRESQL
            group_col = '"group"' if is_pg else '`group`'

            # 构建白名单排除条件
            whitelist_ids = self._config.whitelist_ids
            whitelist_condition = ""
            params = {}
            if whitelist_ids:
                placeholders = ", ".join([":wl_" + str(i) for i in range(len(whitelist_ids))])
                whitelist_condition = f"AND id NOT IN ({placeholders})"
                for i, wl_id in enumerate(whitelist_ids):
                    params[f"wl_{i}"] = wl_id

            # 获取待分配用户数
            pending_sql = f"""
                SELECT COUNT(*) as cnt
                FROM users
                WHERE (COALESCE({group_col}, 'default') = 'default' OR {group_col} = '')
                AND deleted_at IS NULL
                AND status = 1
                {whitelist_condition}
            """
            pending_result = db.execute(pending_sql, params)
            pending_count = int(pending_result[0].get("cnt", 0)) if pending_result else 0

            # 获取累计处理数（从日志表）
            logs = self._storage.get_auto_group_logs(page=1, page_size=1, action="assign")
            total_assigned = logs.get("total", 0)

            # 计算下次扫描时间
            next_scan_time = 0
            if self._config.auto_scan_enabled and self._config.scan_interval_minutes > 0:
                next_scan_time = self._last_scan_time + (self._config.scan_interval_minutes * 60)

            return {
                "pending_count": pending_count,
                "total_assigned": total_assigned,
                "last_scan_time": self._last_scan_time,
                "next_scan_time": next_scan_time,
                "enabled": self._config.enabled,
                "auto_scan_enabled": self._config.auto_scan_enabled,
            }
        except Exception as e:
            logger.error(f"获取统计信息失败: {e}")
            return {
                "pending_count": 0,
                "total_assigned": 0,
                "last_scan_time": 0,
                "next_scan_time": 0,
                "enabled": self._config.enabled,
                "auto_scan_enabled": self._config.auto_scan_enabled,
            }


# 全局实例
_auto_group_service: Optional[AutoGroupService] = None


def get_auto_group_service() -> AutoGroupService:
    """获取自动分组服务实例"""
    global _auto_group_service
    if _auto_group_service is None:
        _auto_group_service = AutoGroupService()
    return _auto_group_service

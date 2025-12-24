"""
Risk Monitoring Service for NewAPI Middleware Tool.
Provides real-time usage leaderboards and per-user usage analysis for moderation.
"""
import time
from typing import Any, Dict, List, Optional

from .database import DatabaseManager, DatabaseEngine, get_db_manager
from .logger import logger


WINDOW_SECONDS: dict[str, int] = {
    "1h": 1 * 3600,
    "3h": 3 * 3600,
    "6h": 6 * 3600,
    "12h": 12 * 3600,
    "24h": 24 * 3600,
}


class RiskMonitoringService:
    """Service for real-time usage monitoring and moderation insights."""

    def __init__(self, db: Optional[DatabaseManager] = None):
        self._db = db

    @property
    def db(self) -> DatabaseManager:
        if self._db is None:
            self._db = get_db_manager()
        return self._db

    def get_leaderboards(self, windows: List[str], limit: int = 10, sort_by: str = "requests") -> Dict[str, Any]:
        now = int(time.time())
        data: Dict[str, Any] = {}
        for w in windows:
            seconds = WINDOW_SECONDS.get(w)
            if not seconds:
                continue
            data[w] = self.get_leaderboard(window_seconds=seconds, limit=limit, now=now, sort_by=sort_by)
        return {"generated_at": now, "windows": data}

    def get_leaderboard(
        self,
        window_seconds: int,
        limit: int = 10,
        now: Optional[int] = None,
        sort_by: str = "requests",
    ) -> List[Dict[str, Any]]:
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        order_by_map = {
            "requests": "total_requests DESC",
            "quota": "quota_used DESC",
            "failure_rate": "failure_rate DESC, total_requests DESC",
        }
        order_by = order_by_map.get(sort_by, order_by_map["requests"])

        sql = """
            SELECT
                l.user_id as user_id,
                COALESCE(MAX(u.display_name), MAX(u.username), MAX(l.username)) as username,
                COALESCE(MAX(u.status), 0) as user_status,
                COUNT(*) as total_requests,
                SUM(CASE WHEN l.type = 5 THEN 1 ELSE 0 END) as failure_requests,
                (SUM(CASE WHEN l.type = 5 THEN 1 ELSE 0 END) * 1.0) / NULLIF(COUNT(*), 0) as failure_rate,
                COALESCE(SUM(l.quota), 0) as quota_used,
                COALESCE(SUM(l.prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(l.completion_tokens), 0) as completion_tokens,
                COALESCE(COUNT(DISTINCT NULLIF(l.ip, '')), 0) as unique_ips
            FROM logs l
            LEFT JOIN users u ON u.id = l.user_id AND u.deleted_at IS NULL
            WHERE l.created_at >= :start_time AND l.created_at <= :end_time
                AND l.type IN (2, 5)
                AND l.user_id IS NOT NULL
            GROUP BY l.user_id
            ORDER BY """ + order_by + """
            LIMIT :limit
        """

        try:
            self.db.connect()
            rows = self.db.execute(sql, {"start_time": start_time, "end_time": now, "limit": limit})
        except Exception as e:
            logger.db_error(f"获取实时排行失败: {e}")
            return []

        result: List[Dict[str, Any]] = []
        for r in rows:
            result.append({
                "user_id": int(r.get("user_id") or 0),
                "username": r.get("username") or "",
                "user_status": int(r.get("user_status") or 0),
                "request_count": int(r.get("total_requests") or 0),
                "failure_requests": int(r.get("failure_requests") or 0),
                "failure_rate": float(r.get("failure_rate") or 0),
                "quota_used": int(r.get("quota_used") or 0),
                "prompt_tokens": int(r.get("prompt_tokens") or 0),
                "completion_tokens": int(r.get("completion_tokens") or 0),
                "unique_ips": int(r.get("unique_ips") or 0),
            })
        return result

    def get_user_analysis(self, user_id: int, window_seconds: int, now: Optional[int] = None) -> Dict[str, Any]:
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        self.db.connect()

        # 根据数据库类型选择正确的引号（group 是保留字）
        is_pg = self.db.config.engine == DatabaseEngine.POSTGRESQL
        group_col = '"group"' if is_pg else '`group`'

        user_sql = f"""
            SELECT id, username, display_name, email, status, {group_col}, remark
            FROM users
            WHERE id = :user_id AND deleted_at IS NULL
            LIMIT 1
        """
        user_rows = self.db.execute(user_sql, {"user_id": user_id})

        user = user_rows[0] if user_rows else None

        summary_sql = """
            SELECT
                COUNT(*) as total_requests,
                SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as success_requests,
                SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_requests,
                COALESCE(SUM(quota), 0) as quota_used,
                COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) as completion_tokens,
                COALESCE(AVG(use_time), 0) as avg_use_time,
                COUNT(DISTINCT NULLIF(ip, '')) as unique_ips,
                COUNT(DISTINCT token_id) as unique_tokens,
                COUNT(DISTINCT model_name) as unique_models,
                COUNT(DISTINCT channel_id) as unique_channels,
                SUM(CASE WHEN type = 2 AND completion_tokens = 0 THEN 1 ELSE 0 END) as empty_count
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time
                AND type IN (2, 5)
        """
        summary = (self.db.execute(summary_sql, {"user_id": user_id, "start_time": start_time, "end_time": now}) or [{}])[0]

        top_models_sql = """
            SELECT
                COALESCE(model_name, 'unknown') as model_name,
                COUNT(*) as requests,
                COALESCE(SUM(quota), 0) as quota_used,
                SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as success_requests,
                SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_requests,
                SUM(CASE WHEN type = 2 AND completion_tokens = 0 THEN 1 ELSE 0 END) as empty_count
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time
                AND type IN (2, 5)
            GROUP BY COALESCE(model_name, 'unknown')
            ORDER BY requests DESC
            LIMIT 10
        """
        top_models = self.db.execute(top_models_sql, {"user_id": user_id, "start_time": start_time, "end_time": now})

        top_channels_sql = """
            SELECT
                channel_id,
                COALESCE(MAX(channel_name), '') as channel_name,
                COUNT(*) as requests,
                COALESCE(SUM(quota), 0) as quota_used
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time
                AND type IN (2, 5)
            GROUP BY channel_id
            ORDER BY requests DESC
            LIMIT 10
        """
        top_channels = self.db.execute(top_channels_sql, {"user_id": user_id, "start_time": start_time, "end_time": now})

        top_ips_sql = """
            SELECT
                ip,
                COUNT(*) as requests
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time
                AND type IN (2, 5)
                AND ip IS NOT NULL AND ip <> ''
            GROUP BY ip
            ORDER BY requests DESC
            LIMIT 10
        """
        top_ips = self.db.execute(top_ips_sql, {"user_id": user_id, "start_time": start_time, "end_time": now})

        recent_sql = """
            SELECT
                id, created_at, type, model_name, quota, prompt_tokens, completion_tokens,
                use_time, ip, channel_id, channel_name, token_id, token_name
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time
                AND type IN (2, 5)
            ORDER BY id DESC
            LIMIT 50
        """
        recent_logs = self.db.execute(recent_sql, {"user_id": user_id, "start_time": start_time, "end_time": now})

        total_requests = int(summary.get("total_requests") or 0)
        success_requests = int(summary.get("success_requests") or 0)
        failure_requests = int(summary.get("failure_requests") or 0)
        empty_count = int(summary.get("empty_count") or 0)

        failure_rate = (failure_requests / total_requests) if total_requests else 0.0
        empty_rate = (empty_count / success_requests) if success_requests else 0.0
        requests_per_minute = (total_requests / window_seconds) * 60 if window_seconds else 0.0
        quota_used = int(summary.get("quota_used") or 0)
        avg_quota_per_request = (quota_used / total_requests) if total_requests else 0.0

        risk_flags: List[str] = []
        if requests_per_minute >= 120:
            risk_flags.append("HIGH_RPM")
        if int(summary.get("unique_ips") or 0) >= 5:
            risk_flags.append("MANY_IPS")
        if failure_rate >= 0.2:
            risk_flags.append("HIGH_FAILURE_RATE")
        if empty_rate >= 0.3 and success_requests >= 20:
            risk_flags.append("HIGH_EMPTY_RATE")

        return {
            "range": {"start_time": start_time, "end_time": now, "window_seconds": window_seconds},
            "user": {
                "id": int(user.get("id")) if user else user_id,
                "username": (user.get("username") if user else "") or "",
                "display_name": (user.get("display_name") if user else None),
                "email": (user.get("email") if user else None),
                "status": int(user.get("status")) if user and user.get("status") is not None else 0,
                "group": (user.get("group") if user else None),
                "remark": (user.get("remark") if user else None),
            },
            "summary": {
                "total_requests": total_requests,
                "success_requests": success_requests,
                "failure_requests": failure_requests,
                "quota_used": quota_used,
                "prompt_tokens": int(summary.get("prompt_tokens") or 0),
                "completion_tokens": int(summary.get("completion_tokens") or 0),
                "avg_use_time": float(summary.get("avg_use_time") or 0),
                "unique_ips": int(summary.get("unique_ips") or 0),
                "unique_tokens": int(summary.get("unique_tokens") or 0),
                "unique_models": int(summary.get("unique_models") or 0),
                "unique_channels": int(summary.get("unique_channels") or 0),
                "empty_count": empty_count,
                "failure_rate": failure_rate,
                "empty_rate": empty_rate,
            },
            "risk": {
                "requests_per_minute": requests_per_minute,
                "avg_quota_per_request": avg_quota_per_request,
                "risk_flags": risk_flags,
            },
            "top_models": [
                {
                    "model_name": r.get("model_name") or "unknown",
                    "requests": int(r.get("requests") or 0),
                    "quota_used": int(r.get("quota_used") or 0),
                    "success_requests": int(r.get("success_requests") or 0),
                    "failure_requests": int(r.get("failure_requests") or 0),
                    "empty_count": int(r.get("empty_count") or 0),
                }
                for r in (top_models or [])
            ],
            "top_channels": [
                {
                    "channel_id": int(r.get("channel_id") or 0),
                    "channel_name": r.get("channel_name") or "",
                    "requests": int(r.get("requests") or 0),
                    "quota_used": int(r.get("quota_used") or 0),
                }
                for r in (top_channels or [])
            ],
            "top_ips": [
                {"ip": r.get("ip") or "", "requests": int(r.get("requests") or 0)}
                for r in (top_ips or [])
            ],
            "recent_logs": [
                {
                    "id": int(r.get("id") or 0),
                    "created_at": int(r.get("created_at") or 0),
                    "type": int(r.get("type") or 0),
                    "model_name": r.get("model_name") or "",
                    "quota": int(r.get("quota") or 0),
                    "prompt_tokens": int(r.get("prompt_tokens") or 0),
                    "completion_tokens": int(r.get("completion_tokens") or 0),
                    "use_time": int(r.get("use_time") or 0),
                    "ip": r.get("ip") or "",
                    "channel_id": int(r.get("channel_id") or 0),
                    "channel_name": r.get("channel_name") or "",
                    "token_id": int(r.get("token_id") or 0),
                    "token_name": r.get("token_name") or "",
                }
                for r in (recent_logs or [])
            ],
        }


_risk_monitoring_service: Optional[RiskMonitoringService] = None


def get_risk_monitoring_service() -> RiskMonitoringService:
    global _risk_monitoring_service
    if _risk_monitoring_service is None:
        _risk_monitoring_service = RiskMonitoringService()
    return _risk_monitoring_service

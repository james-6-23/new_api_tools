"""
Risk Monitoring Service for NewAPI Middleware Tool.
Provides real-time usage leaderboards and per-user usage analysis for moderation.

Optimizations:
- In-memory cache for leaderboards (5-10 seconds TTL)
- Merged SQL queries for user analysis (5 queries -> 2 queries)
- Recommended index: CREATE INDEX idx_logs_created_user_type ON logs(created_at, user_id, type);
"""
import time
import threading
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from .database import DatabaseManager, DatabaseEngine, get_db_manager
from .logger import logger


WINDOW_SECONDS: dict[str, int] = {
    "1h": 1 * 3600,
    "3h": 3 * 3600,
    "6h": 6 * 3600,
    "12h": 12 * 3600,
    "24h": 24 * 3600,
    "3d": 3 * 24 * 3600,
    "7d": 7 * 24 * 3600,
}

# Cache TTL in seconds
LEADERBOARD_CACHE_TTL = 8


@dataclass
class CacheEntry:
    """Cache entry with data and expiration time."""
    data: Any
    expires_at: float


class SimpleCache:
    """Thread-safe in-memory cache with TTL."""
    
    def __init__(self):
        self._cache: Dict[str, CacheEntry] = {}
        self._lock = threading.Lock()
    
    def get(self, key: str) -> Optional[Any]:
        """Get value from cache if not expired."""
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            if time.time() > entry.expires_at:
                del self._cache[key]
                return None
            return entry.data
    
    def set(self, key: str, value: Any, ttl: float):
        """Set value in cache with TTL."""
        with self._lock:
            self._cache[key] = CacheEntry(data=value, expires_at=time.time() + ttl)
    
    def clear(self):
        """Clear all cache entries."""
        with self._lock:
            self._cache.clear()


# Global cache instance
_cache = SimpleCache()


class RiskMonitoringService:
    """Service for real-time usage monitoring and moderation insights."""

    def __init__(self, db: Optional[DatabaseManager] = None):
        self._db = db

    @property
    def db(self) -> DatabaseManager:
        if self._db is None:
            self._db = get_db_manager()
        return self._db

    def get_leaderboards(
        self,
        windows: List[str],
        limit: int = 10,
        sort_by: str = "requests",
        use_cache: bool = True,
    ) -> Dict[str, Any]:
        """
        Get leaderboards for multiple time windows.
        Uses cache to reduce database load.
        """
        now = int(time.time())
        cache_key = f"leaderboards:{','.join(sorted(windows))}:{limit}:{sort_by}"
        
        # Check cache
        if use_cache:
            cached = _cache.get(cache_key)
            if cached is not None:
                return cached
        
        # Fetch from database
        data: Dict[str, Any] = {}
        for w in windows:
            seconds = WINDOW_SECONDS.get(w)
            if not seconds:
                continue
            data[w] = self._get_leaderboard_internal(
                window_seconds=seconds, limit=limit, now=now, sort_by=sort_by
            )
        
        result = {"generated_at": now, "windows": data}
        
        # Store in cache
        _cache.set(cache_key, result, LEADERBOARD_CACHE_TTL)
        
        return result

    def get_leaderboard(
        self,
        window_seconds: int,
        limit: int = 10,
        now: Optional[int] = None,
        sort_by: str = "requests",
    ) -> List[Dict[str, Any]]:
        """Get leaderboard for a single time window (no cache, for direct calls)."""
        return self._get_leaderboard_internal(window_seconds, limit, now, sort_by)

    def _get_leaderboard_internal(
        self,
        window_seconds: int,
        limit: int = 10,
        now: Optional[int] = None,
        sort_by: str = "requests",
    ) -> List[Dict[str, Any]]:
        """Internal method to fetch leaderboard from database."""
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
                COALESCE(
                    NULLIF(MAX(u.display_name), ''),
                    NULLIF(MAX(u.username), ''),
                    NULLIF(MAX(l.username), '')
                ) as username,
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

        return [
            {
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
            }
            for r in rows
        ]

    def get_user_analysis(self, user_id: int, window_seconds: int, now: Optional[int] = None) -> Dict[str, Any]:
        """
        Get detailed analysis for a specific user.
        Optimized: merged summary + top_models + top_channels + top_ips into fewer queries.
        """
        if now is None:
            now = int(time.time())
        start_time = now - window_seconds

        self.db.connect()

        # 根据数据库类型选择正确的引号（group 是保留字）
        is_pg = self.db.config.engine == DatabaseEngine.POSTGRESQL
        group_col = '"group"' if is_pg else '`group`'

        # Query 1: User info
        user_sql = f"""
            SELECT id, username, display_name, email, status, {group_col}, remark
            FROM users
            WHERE id = :user_id AND deleted_at IS NULL
            LIMIT 1
        """
        user_rows = self.db.execute(user_sql, {"user_id": user_id})
        user = user_rows[0] if user_rows else None

        # Query 2: Combined summary + aggregations (merged from 4 separate queries)
        # This single query gets summary stats and we'll do separate small queries for top lists
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
        params = {"user_id": user_id, "start_time": start_time, "end_time": now}
        summary = (self.db.execute(summary_sql, params) or [{}])[0]

        # Query 3: Top models, channels, IPs combined using UNION ALL
        # This reduces 3 queries to 1 by using tagged results
        combined_tops_sql = """
            SELECT 'model' as category, COALESCE(model_name, 'unknown') as name, 
                   COUNT(*) as requests, COALESCE(SUM(quota), 0) as quota_used,
                   SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as success_requests,
                   SUM(CASE WHEN type = 5 THEN 1 ELSE 0 END) as failure_requests,
                   SUM(CASE WHEN type = 2 AND completion_tokens = 0 THEN 1 ELSE 0 END) as empty_count,
                   0 as channel_id, '' as channel_name
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time AND type IN (2, 5)
            GROUP BY COALESCE(model_name, 'unknown')
            
            UNION ALL
            
            SELECT 'channel' as category, '' as name,
                   COUNT(*) as requests, COALESCE(SUM(quota), 0) as quota_used,
                   0 as success_requests, 0 as failure_requests, 0 as empty_count,
                   channel_id, COALESCE(MAX(channel_name), '') as channel_name
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time AND type IN (2, 5)
            GROUP BY channel_id
            
            UNION ALL
            
            SELECT 'ip' as category, ip as name,
                   COUNT(*) as requests, 0 as quota_used,
                   0 as success_requests, 0 as failure_requests, 0 as empty_count,
                   0 as channel_id, '' as channel_name
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time 
                AND type IN (2, 5) AND ip IS NOT NULL AND ip <> ''
            GROUP BY ip
        """
        combined_rows = self.db.execute(combined_tops_sql, params) or []
        
        # Parse combined results
        top_models_raw = []
        top_channels_raw = []
        top_ips_raw = []
        
        for r in combined_rows:
            category = r.get("category")
            if category == "model":
                top_models_raw.append(r)
            elif category == "channel":
                top_channels_raw.append(r)
            elif category == "ip":
                top_ips_raw.append(r)
        
        # Sort and limit
        top_models_raw.sort(key=lambda x: x.get("requests", 0), reverse=True)
        top_channels_raw.sort(key=lambda x: x.get("requests", 0), reverse=True)
        top_ips_raw.sort(key=lambda x: x.get("requests", 0), reverse=True)
        
        top_models = top_models_raw[:10]
        top_channels = top_channels_raw[:10]
        top_ips = top_ips_raw[:10]

        # Query 4: Recent logs (kept separate as it needs different columns)
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
        recent_logs = self.db.execute(recent_sql, params)

        # Query 5: IP切换频率分析 - 获取按时间排序的IP序列
        ip_sequence_sql = """
            SELECT created_at, ip
            FROM logs
            WHERE user_id = :user_id AND created_at >= :start_time AND created_at <= :end_time
                AND type IN (2, 5) AND ip IS NOT NULL AND ip <> ''
            ORDER BY created_at ASC
        """
        ip_sequence = self.db.execute(ip_sequence_sql, params) or []
        
        # 分析IP切换模式
        ip_switch_analysis = self._analyze_ip_switches(ip_sequence)

        # Calculate derived metrics
        total_requests = int(summary.get("total_requests") or 0)
        success_requests = int(summary.get("success_requests") or 0)
        failure_requests = int(summary.get("failure_requests") or 0)
        empty_count = int(summary.get("empty_count") or 0)

        failure_rate = (failure_requests / total_requests) if total_requests else 0.0
        empty_rate = (empty_count / success_requests) if success_requests else 0.0
        requests_per_minute = (total_requests / window_seconds) * 60 if window_seconds else 0.0
        quota_used = int(summary.get("quota_used") or 0)
        avg_quota_per_request = (quota_used / total_requests) if total_requests else 0.0

        # Risk flags - 只关注 IP 相关风险
        # 注意：空回复率和失败率不作为风险标签，因为嵌入模型本身不返回文本内容
        risk_flags: List[str] = []
        if int(summary.get("unique_ips") or 0) >= 10:
            risk_flags.append("MANY_IPS")

        # IP切换频率风险检测
        if ip_switch_analysis.get("rapid_switch_count", 0) >= 3:
            risk_flags.append("IP_RAPID_SWITCH")
        if ip_switch_analysis.get("avg_ip_duration", float('inf')) < 30 and ip_switch_analysis.get("switch_count", 0) >= 3:
            risk_flags.append("IP_HOPPING")

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
                "ip_switch_analysis": ip_switch_analysis,
            },
            "top_models": [
                {
                    "model_name": r.get("name") or "unknown",
                    "requests": int(r.get("requests") or 0),
                    "quota_used": int(r.get("quota_used") or 0),
                    "success_requests": int(r.get("success_requests") or 0),
                    "failure_requests": int(r.get("failure_requests") or 0),
                    "empty_count": int(r.get("empty_count") or 0),
                }
                for r in top_models
            ],
            "top_channels": [
                {
                    "channel_id": int(r.get("channel_id") or 0),
                    "channel_name": r.get("channel_name") or "",
                    "requests": int(r.get("requests") or 0),
                    "quota_used": int(r.get("quota_used") or 0),
                }
                for r in top_channels
            ],
            "top_ips": [
                {"ip": r.get("name") or "", "requests": int(r.get("requests") or 0)}
                for r in top_ips
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

    def _analyze_ip_switches(self, ip_sequence: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        分析IP切换模式，检测异常的IP跳动行为。
        
        正常行为：几分钟或十几分钟换一次IP（机场自动选择）
        异常行为：十几秒甚至几秒内频繁切换IP
        
        返回:
        - switch_count: 总切换次数
        - rapid_switch_count: 快速切换次数（60秒内切换）
        - avg_ip_duration: 平均每个IP的使用时长（秒）
        - min_switch_interval: 最短切换间隔（秒）
        - switch_details: 切换详情列表
        """
        if len(ip_sequence) < 2:
            return {
                "switch_count": 0,
                "rapid_switch_count": 0,
                "avg_ip_duration": 0,
                "min_switch_interval": 0,
                "switch_details": [],
            }
        
        switches = []  # 记录每次切换的时间间隔
        ip_durations = {}  # 记录每个IP的使用时长
        rapid_switches = 0  # 60秒内的快速切换次数
        
        prev_ip = None
        prev_time = None
        ip_start_time = None
        
        for row in ip_sequence:
            current_ip = row.get("ip")
            current_time = int(row.get("created_at") or 0)
            
            if not current_ip or not current_time:
                continue
            
            if prev_ip is None:
                # 第一条记录
                prev_ip = current_ip
                prev_time = current_time
                ip_start_time = current_time
                continue
            
            if current_ip != prev_ip:
                # IP发生切换
                switch_interval = current_time - prev_time
                switches.append({
                    "from_ip": prev_ip,
                    "to_ip": current_ip,
                    "interval": switch_interval,
                    "time": current_time,
                })
                
                # 统计快速切换（60秒内）
                if switch_interval <= 60:
                    rapid_switches += 1
                
                # 记录上一个IP的使用时长
                ip_duration = current_time - ip_start_time
                if prev_ip not in ip_durations:
                    ip_durations[prev_ip] = []
                ip_durations[prev_ip].append(ip_duration)
                
                # 重置为新IP
                prev_ip = current_ip
                ip_start_time = current_time
            
            prev_time = current_time
        
        # 计算统计数据
        switch_count = len(switches)
        min_switch_interval = min((s["interval"] for s in switches), default=0)
        
        # 计算平均IP使用时长
        all_durations = []
        for durations in ip_durations.values():
            all_durations.extend(durations)
        avg_ip_duration = sum(all_durations) / len(all_durations) if all_durations else 0
        
        # 只返回最近的10次切换详情
        recent_switches = switches[-10:] if switches else []
        
        return {
            "switch_count": switch_count,
            "rapid_switch_count": rapid_switches,
            "avg_ip_duration": round(avg_ip_duration, 1),
            "min_switch_interval": min_switch_interval,
            "switch_details": recent_switches,
        }


_risk_monitoring_service: Optional[RiskMonitoringService] = None


def get_risk_monitoring_service() -> RiskMonitoringService:
    global _risk_monitoring_service
    if _risk_monitoring_service is None:
        _risk_monitoring_service = RiskMonitoringService()
    return _risk_monitoring_service


def clear_risk_cache():
    """Clear the risk monitoring cache (useful after data changes)."""
    _cache.clear()

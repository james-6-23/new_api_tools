"""
AI 自动封禁服务 - NewAPI Middleware Tool

基于 OpenAI API 的智能风险评估和自动封禁功能。

功能：
- 定时扫描可疑用户
- 调用 AI 进行风险评估
- 根据 AI 决策自动封禁或告警
- 完整的审计日志记录
- 支持前端配置 API 地址、Key 和模型

安全机制：
- 置信度阈值（< 0.8 转人工）
- 风险分阈值（< 8 只告警不封禁）
- 白名单保护（管理员/VIP）
- 冷却期（24小时内不重复评估）
"""
import json
import time
import asyncio
import uuid
import httpx
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from enum import Enum

from .logger import logger
from .local_storage import get_local_storage
from .risk_monitoring_service import get_risk_monitoring_service, WINDOW_SECONDS
from .user_management_service import get_user_management_service


class AIBanAction(Enum):
    """AI 决策动作"""
    BAN = "ban"              # 立即封禁
    WARN = "warn"            # 仅告警
    MONITOR = "monitor"      # 继续观察
    SKIP = "skip"            # 跳过（白名单等）


@dataclass
class AIAssessmentResult:
    """AI 评估结果"""
    should_ban: bool
    risk_score: int          # 1-10
    confidence: float        # 0.0-1.0
    reason: str              # 封禁/告警理由
    action: AIBanAction
    raw_response: Optional[str] = None
    # AI API 调用信息
    model: Optional[str] = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    api_duration_ms: int = 0  # API 调用耗时（毫秒）


# 配置常量
AI_ASSESSMENT_COOLDOWN = 24 * 3600  # 24小时冷却期
RISK_SCORE_BAN_THRESHOLD = 8        # 风险分 >= 8 才自动封禁
CONFIDENCE_THRESHOLD = 0.8          # 置信度 >= 0.8 才自动执行
DEFAULT_AI_MODEL = ""    # 不预设模型，用户需手动选择
DEFAULT_BASE_URL = ""  # 不预设API地址，用户需手动配置
AI_CONFIG_KEY = "ai_ban_config"     # 本地存储配置键名

# API 重试配置
API_MAX_RETRIES = 3                 # 最大重试次数
API_RETRY_DELAY = 2                 # 重试间隔（秒）
API_FAILURE_COOLDOWN = 300          # API 失败后冷却时间（秒），5分钟
API_MAX_CONSECUTIVE_FAILURES = 5    # 连续失败次数阈值，超过后暂停服务

# 默认 AI 评估提示词模板
# 使用 {变量名} 作为占位符，系统会自动替换为实际数据
DEFAULT_ASSESSMENT_PROMPT = """你是一个 API 风控系统的 AI 助手。请分析以下用户的行为数据，判断是否存在滥用行为。

## 用户信息
- 用户ID: {user_id}
- 用户名: {username}
- 用户组: {user_group}

## 请求概况（最近1小时）
- 请求总数: {total_requests}
- 使用模型数: {unique_models}
- 使用令牌数: {unique_tokens}

## IP 行为分析
- 使用 IP 数量: {unique_ips}
- IP 总切换次数: {switch_count}
- 真实切换次数（排除双栈）: {real_switch_count}
- 双栈切换次数（同位置 v4/v6）: {dual_stack_switches}
- 快速切换次数（60秒内，排除双栈）: {rapid_switch_count}
- 平均 IP 停留时间: {avg_ip_duration} 秒
- 最短切换间隔: {min_switch_interval} 秒
- 已触发风险标签: {risk_flags}

## Token 使用分析
- 使用 Token 数量: {unique_tokens}
- 平均每 Token 请求数: {avg_requests_per_token}
- Token 轮换风险: {token_rotation_risk}

## 判断标准
1. **IP 切换异常**：几秒内频繁切换 IP 是明显异常（可能是多人共用账号）
2. **长停留时间豁免**：如果平均 IP 停留时间 >= 300秒（5分钟），即使有快速切换也可能是网络波动，应降低风险
3. **Token 轮换**：使用多个 Token 且每个 Token 请求很少，可能在规避限制
4. **双栈用户**：同一位置的 IPv4/IPv6 切换是正常行为，不应视为风险
5. 多项风险标签叠加时风险更高
6. 该用户已通过请求量门槛（>= 50次），属于活跃用户

注意：空回复率和失败率不作为判断依据，因为嵌入模型本身不返回文本内容。

## 请返回 JSON 格式（严格遵循）:
```json
{{
  "should_ban": true或false,
  "risk_score": 1到10的整数,
  "confidence": 0.0到1.0的小数,
  "reason": "封禁或放行理由（中文，100字以内）"
}}
```

注意：
- risk_score >= 8 且 confidence >= 0.8 时才会自动封禁
- 请谨慎判断，避免误封正常用户
- 双栈切换是正常行为，应降低风险评分
- 只返回 JSON，不要有其他内容"""


class AIAutoBanService:
    """AI 自动封禁服务"""

    def __init__(self):
        self._storage = get_local_storage()
        self._risk_service = get_risk_monitoring_service()
        self._user_service = get_user_management_service()
        
        # API 健康状态
        self._consecutive_failures = 0      # 连续失败次数
        self._last_failure_time = 0         # 上次失败时间
        self._api_suspended = False         # API 是否暂停
        self._last_error_message = ""       # 最后一次错误信息

        # 模型列表缓存 key（用于检测 API 地址变化）
        self._models_cache_key = "ai_models_list"
        self._models_cache_url_key = "ai_models_base_url"
        
        self._reload_config()
        self._ensure_default_whitelist()

    def _reload_config(self):
        """从本地存储加载配置（仅从SQLite读取，不再使用环境变量）"""
        stored_config = self._storage.get_config(AI_CONFIG_KEY) or {}

        # 所有配置仅从本地存储读取
        self._openai_api_key = stored_config.get("api_key", "")
        self._openai_base_url = stored_config.get("base_url", DEFAULT_BASE_URL)
        self._ai_model = stored_config.get("model", DEFAULT_AI_MODEL)
        self._enabled = stored_config.get("enabled", False)
        self._dry_run = stored_config.get("dry_run", True)

        # 定时扫描配置（0 表示关闭，单位：分钟）
        self._scan_interval_minutes = int(stored_config.get("scan_interval_minutes", 0))

        # 自定义提示词配置（空字符串表示使用默认提示词）
        self._custom_prompt = stored_config.get("custom_prompt", "")

        # IP 白名单和黑名单（用于提示词变量，帮助 AI 做出更准确的判断）
        self._whitelist_ips = stored_config.get("whitelist_ips", [])
        self._blacklist_ips = stored_config.get("blacklist_ips", [])

        # 排除模型列表（这些模型的请求不计入风险分析，如嵌入、翻译模型）
        self._excluded_models = stored_config.get("excluded_models", [])
        # 排除分组列表（这些分组的请求不计入风险分析，如高并发专用分组）
        self._excluded_groups = stored_config.get("excluded_groups", [])

        # 白名单用户ID（从本地存储读取）
        whitelist_ids = stored_config.get("whitelist_ids", [])
        if isinstance(whitelist_ids, str):
            self._whitelist_ids = set(
                int(x.strip()) for x in whitelist_ids.split(",") if x.strip().isdigit()
            )
        elif isinstance(whitelist_ids, list):
            self._whitelist_ids = set(int(x) for x in whitelist_ids if str(x).isdigit())
        else:
            self._whitelist_ids = set()

    def _ensure_default_whitelist(self):
        """
        确保默认白名单包含管理员和超级管理员。
        - ID 为 1 的用户（超级管理员）
        - 所有 role >= 10 的管理员用户
        
        只在首次初始化时执行，已有白名单配置则跳过。
        """
        try:
            stored_config = self._storage.get_config(AI_CONFIG_KEY) or {}
            
            # 检查是否已经初始化过白名单
            if stored_config.get("whitelist_initialized"):
                return
            
            # 获取需要加入白名单的用户
            admin_ids = set()
            
            # 1. 添加 ID 为 1 的超级管理员
            admin_ids.add(1)
            
            # 2. 查询所有管理员用户 (role >= 10)
            try:
                from .database import get_db_manager
                db = get_db_manager()
                db.connect()
                
                admin_sql = """
                    SELECT id FROM users 
                    WHERE role >= 10 AND deleted_at IS NULL
                """
                rows = db.execute(admin_sql, {})
                for row in rows:
                    admin_ids.add(int(row.get("id")))
            except Exception as e:
                logger.warning(f"查询管理员用户失败: {e}")
            
            # 合并到现有白名单
            new_whitelist = self._whitelist_ids | admin_ids
            
            if new_whitelist != self._whitelist_ids:
                self._whitelist_ids = new_whitelist
                # 保存配置并标记已初始化
                stored_config["whitelist_ids"] = list(self._whitelist_ids)
                stored_config["whitelist_initialized"] = True
                self._storage.set_config(AI_CONFIG_KEY, stored_config)
                
                logger.success(f"AI封禁白名单已初始化", 管理员数=len(admin_ids))
            else:
                # 只标记已初始化
                stored_config["whitelist_initialized"] = True
                self._storage.set_config(AI_CONFIG_KEY, stored_config)
                
        except Exception as e:
            logger.warning(f"初始化默认白名单失败: {e}")

    def save_config(self, config: Dict[str, Any]) -> bool:
        """保存配置到本地存储"""
        try:
            current = self._storage.get_config(AI_CONFIG_KEY) or {}
            current.update(config)
            self._storage.set_config(AI_CONFIG_KEY, current)
            self._reload_config()
            logger.business("AI封禁配置已更新", **{k: v if k != "api_key" else "***" for k, v in config.items()})
            return True
        except Exception as e:
            logger.error(f"保存AI封禁配置失败: {e}")
            return False

    def get_saved_config(self) -> Dict[str, Any]:
        """获取保存的配置"""
        return self._storage.get_config(AI_CONFIG_KEY) or {}

    def is_enabled(self) -> bool:
        """检查服务是否启用"""
        return self._enabled and bool(self._openai_api_key)

    def is_dry_run(self) -> bool:
        """检查是否为试运行模式"""
        return self._dry_run

    def _is_in_cooldown(self, user_id: int) -> bool:
        """检查用户是否在冷却期内"""
        key = f"ai_ban_cooldown:{user_id}"
        last_check = self._storage.cache_get(key)
        return last_check is not None

    def _set_cooldown(self, user_id: int):
        """设置用户冷却期"""
        key = f"ai_ban_cooldown:{user_id}"
        self._storage.cache_set(key, int(time.time()), ttl=AI_ASSESSMENT_COOLDOWN)

    def _is_whitelisted(self, user_id: int, user_role: int = 0) -> bool:
        """检查用户是否在白名单中"""
        # 管理员角色（role >= 10）自动白名单
        if user_role >= 10:
            return True
        return user_id in self._whitelist_ids

    def get_whitelist(self) -> List[Dict[str, Any]]:
        """获取白名单列表（包含用户详情）"""
        whitelist_users = []
        
        for user_id in self._whitelist_ids:
            user_info = self._user_service.get_user_by_id(user_id)
            if user_info:
                whitelist_users.append({
                    "user_id": user_id,
                    "username": user_info.get("username", ""),
                    "display_name": user_info.get("display_name", ""),
                    "role": user_info.get("role", 0),
                    "is_admin": user_info.get("role", 0) >= 10,
                })
            else:
                whitelist_users.append({
                    "user_id": user_id,
                    "username": f"用户#{user_id}",
                    "display_name": "",
                    "role": 0,
                    "is_admin": False,
                })
        
        return whitelist_users

    def add_to_whitelist(self, user_id: int) -> Dict[str, Any]:
        """添加用户到白名单"""
        if user_id in self._whitelist_ids:
            return {"success": False, "message": "用户已在白名单中"}
        
        # 获取用户信息
        user_info = self._user_service.get_user_by_id(user_id)
        if not user_info:
            return {"success": False, "message": "用户不存在"}
        
        # 添加到白名单
        self._whitelist_ids.add(user_id)
        
        # 保存到配置
        self.save_config({"whitelist_ids": list(self._whitelist_ids)})
        
        logger.business(
            "AI封禁白名单添加",
            user_id=user_id,
            username=user_info.get("username", ""),
        )
        
        return {
            "success": True,
            "message": "已添加到白名单",
            "user": {
                "user_id": user_id,
                "username": user_info.get("username", ""),
                "display_name": user_info.get("display_name", ""),
            }
        }

    def remove_from_whitelist(self, user_id: int) -> Dict[str, Any]:
        """从白名单移除用户"""
        if user_id not in self._whitelist_ids:
            return {"success": False, "message": "用户不在白名单中"}
        
        # 从白名单移除
        self._whitelist_ids.discard(user_id)
        
        # 保存到配置
        self.save_config({"whitelist_ids": list(self._whitelist_ids)})
        
        logger.business("AI封禁白名单移除", user_id=user_id)
        
        return {"success": True, "message": "已从白名单移除"}

    def search_user_for_whitelist(self, query: str) -> List[Dict[str, Any]]:
        """搜索用户（用于添加白名单）"""
        results = []
        
        # 尝试按 ID 搜索
        if query.isdigit():
            user_info = self._user_service.get_user_by_id(int(query))
            if user_info:
                results.append({
                    "user_id": user_info.get("id"),
                    "username": user_info.get("username", ""),
                    "display_name": user_info.get("display_name", ""),
                    "role": user_info.get("role", 0),
                    "is_admin": user_info.get("role", 0) >= 10,
                    "in_whitelist": user_info.get("id") in self._whitelist_ids,
                })
        
        # 按用户名搜索
        users = self._user_service.search_users(query, limit=10)
        for user in users:
            user_id = user.get("id")
            if not any(r["user_id"] == user_id for r in results):
                results.append({
                    "user_id": user_id,
                    "username": user.get("username", ""),
                    "display_name": user.get("display_name", ""),
                    "role": user.get("role", 0),
                    "is_admin": user.get("role", 0) >= 10,
                    "in_whitelist": user_id in self._whitelist_ids,
                })
        
        return results[:10]

    def get_suspicious_users(self, window: str = "1h", limit: int = 20) -> List[Dict[str, Any]]:
        """
        获取可疑用户列表（触发风险阈值的用户）

        筛选条件：
        1. 请求量 >= 50（低活跃用户不进入可疑列表）
        2. 满足任一 IP 风险标签：
           - IP数量过多 (>= 10)
           - IP快速切换 (>= 3次/60秒内)
           - IP跳动异常 (平均停留<30秒且切换>=3次)
        3. 排除的模型/分组请求占比 < 80%（主要使用排除模型/分组的用户不进入可疑列表）

        注意：空回复率和失败率不作为筛选条件，因为嵌入模型本身不返回文本内容
        """
        window_seconds = WINDOW_SECONDS.get(window, 3600)

        # 获取排行榜数据
        leaderboards = self._risk_service.get_leaderboards(
            windows=[window],
            limit=50,
            sort_by="requests",
            use_cache=False,
        )

        candidates = leaderboards.get("windows", {}).get(window, [])
        suspicious = []

        # 只关注 IP 相关的风险标签
        ip_risk_flags = {"MANY_IPS", "IP_RAPID_SWITCH", "IP_HOPPING"}
        # 最低请求量门槛
        min_requests_threshold = 50
        # 排除模型/分组的请求占比阈值（超过此比例则跳过）
        excluded_ratio_threshold = 0.8

        for user in candidates:
            user_id = user.get("user_id")
            if not user_id:
                continue

            # 跳过冷却期内的用户
            if self._is_in_cooldown(user_id):
                continue

            # 获取详细分析
            analysis = self._risk_service.get_user_analysis(user_id, window_seconds)

            # 检查请求量门槛
            total_requests = analysis.get("summary", {}).get("total_requests", 0)
            if total_requests < min_requests_threshold:
                continue

            # 检查排除的模型/分组
            if self._should_exclude_by_model_or_group(analysis, total_requests, excluded_ratio_threshold):
                logger.debug(f"AI封禁: 用户 {user_id} 主要使用排除的模型/分组，跳过")
                continue

            risk_flags = set(analysis.get("risk", {}).get("risk_flags", []))

            # 判断是否可疑 - 只检查 IP 相关风险
            is_suspicious = bool(risk_flags & ip_risk_flags)

            if is_suspicious:
                suspicious.append({
                    "user_id": user_id,
                    "username": user.get("username", ""),
                    "analysis": analysis,
                })

                if len(suspicious) >= limit:
                    break

        return suspicious

    def _should_exclude_by_model_or_group(
        self,
        analysis: Dict[str, Any],
        total_requests: int,
        threshold: float = 0.8
    ) -> bool:
        """
        检查用户是否应该因为主要使用排除的模型/分组而被排除

        Args:
            analysis: 用户分析数据
            total_requests: 用户总请求数
            threshold: 排除阈值，排除请求占比超过此值则返回 True

        Returns:
            True 表示应该排除（跳过该用户），False 表示不排除
        """
        if not self._excluded_models and not self._excluded_groups:
            return False

        if total_requests <= 0:
            return False

        excluded_requests = 0

        # 检查排除的模型
        if self._excluded_models:
            top_models = analysis.get("top_models", [])
            for model in top_models:
                model_name = model.get("model_name", "")
                # 支持前缀匹配（如 text-embedding-* 匹配所有嵌入模型）
                for excluded in self._excluded_models:
                    if excluded.endswith("*"):
                        if model_name.startswith(excluded[:-1]):
                            excluded_requests += model.get("requests", 0)
                            break
                    elif model_name == excluded:
                        excluded_requests += model.get("requests", 0)
                        break

        # 检查排除的分组
        if self._excluded_groups:
            top_groups = analysis.get("top_groups", [])
            for group in top_groups:
                group_name = group.get("group_name", "")
                if group_name in self._excluded_groups:
                    excluded_requests += group.get("requests", 0)

        # 计算排除请求占比
        excluded_ratio = excluded_requests / total_requests
        return excluded_ratio >= threshold

    def _build_assessment_prompt(self, analysis: Dict[str, Any]) -> str:
        """构建 AI 评估 Prompt（支持自定义提示词）"""
        summary = analysis.get("summary", {})
        risk = analysis.get("risk", {})
        ip_switch = risk.get("ip_switch_analysis", {})
        user = analysis.get("user", {})

        # 获取用户使用的 IP 列表
        user_ips = [ip.get('ip') for ip in analysis.get('top_ips', []) if ip.get('ip')]

        # 计算用户 IP 中有多少在白名单/黑名单中
        whitelisted_ips = [ip for ip in user_ips if ip in self._whitelist_ips]
        blacklisted_ips = [ip for ip in user_ips if ip in self._blacklist_ips]

        # 计算 Token 轮换风险
        unique_tokens = summary.get('unique_tokens', 0)
        total_requests = summary.get('total_requests', 0)
        avg_requests_per_token = round(total_requests / unique_tokens, 2) if unique_tokens > 0 else 0
        
        # Token 轮换风险判断
        token_rotation_risk = "低"
        if unique_tokens >= 5 and avg_requests_per_token <= 10:
            token_rotation_risk = "高（多Token轮换，每Token请求少）"
        elif unique_tokens >= 3 and avg_requests_per_token <= 20:
            token_rotation_risk = "中"

        # 准备变量替换数据
        prompt_vars = {
            "user_id": user.get('id', ''),
            "username": user.get('username', ''),
            "user_group": user.get('group') or '默认',
            "total_requests": total_requests,
            "unique_models": summary.get('unique_models', 0),
            "unique_tokens": unique_tokens,
            "unique_ips": summary.get('unique_ips', 0),
            "switch_count": ip_switch.get('switch_count', 0),
            "real_switch_count": ip_switch.get('real_switch_count', ip_switch.get('switch_count', 0)),
            "dual_stack_switches": ip_switch.get('dual_stack_switches', 0),
            "rapid_switch_count": ip_switch.get('rapid_switch_count', 0),
            "avg_ip_duration": ip_switch.get('avg_ip_duration', 0),
            "min_switch_interval": ip_switch.get('min_switch_interval', 0),
            "risk_flags": risk.get('risk_flags', []),
            # Token 轮换相关
            "avg_requests_per_token": avg_requests_per_token,
            "token_rotation_risk": token_rotation_risk,
            # IP 白名单/黑名单相关变量
            "whitelist_ips": self._whitelist_ips,
            "blacklist_ips": self._blacklist_ips,
            "user_whitelisted_ips": whitelisted_ips,
            "user_blacklisted_ips": blacklisted_ips,
            "user_ips": user_ips,
        }

        # 使用自定义提示词或默认提示词
        prompt_template = self._custom_prompt.strip() if self._custom_prompt else DEFAULT_ASSESSMENT_PROMPT

        try:
            # 使用 format 进行变量替换
            return prompt_template.format(**prompt_vars)
        except KeyError as e:
            # 如果自定义提示词中有未知变量，回退到默认提示词
            logger.warning(f"自定义提示词变量替换失败: {e}，使用默认提示词")
            return DEFAULT_ASSESSMENT_PROMPT.format(**prompt_vars)

    def _get_endpoint_url(self, base_url: str, endpoint: str) -> str:
        """
        智能构建 API URL
        如果 base_url 不包含 /v1 且 endpoint 需要，则自动补充
        """
        base = base_url.rstrip("/")
        # 如果 base_url 已经包含 /v1，或者是其他非标准版本号路径，则直接使用
        if base.endswith("/v1"):
            return f"{base}{endpoint}"
        
        # 否则默认补充 /v1
        return f"{base}/v1{endpoint}"

    async def _call_openai_api(self, prompt: str) -> Optional[Dict[str, Any]]:
        """
        调用 OpenAI API（带重试和故障处理）

        Returns:
            成功时返回包含 content、usage、model、duration_ms 的字典，失败返回 None
        """
        if not self._openai_api_key:
            self._last_error_message = "OpenAI API Key 未配置"
            logger.warning("AI自动封禁: OpenAI API Key 未配置")
            return None

        # 检查 API 是否处于暂停状态
        if self._api_suspended:
            # 检查冷却期是否已过
            if time.time() - self._last_failure_time < API_FAILURE_COOLDOWN:
                remaining = int(API_FAILURE_COOLDOWN - (time.time() - self._last_failure_time))
                self._last_error_message = f"API 服务暂停中，剩余冷却时间 {remaining} 秒"
                logger.warning(f"AI自动封禁: {self._last_error_message}")
                return None
            else:
                # 冷却期已过，重置状态尝试恢复
                logger.info("AI自动封禁: API 冷却期结束，尝试恢复服务")
                self._api_suspended = False
                self._consecutive_failures = 0

        headers = {
            "Authorization": f"Bearer {self._openai_api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": self._ai_model,
            "messages": [
                {"role": "system", "content": "你是一个专业的 API 风控分析师，擅长识别异常用户行为。请只返回 JSON 格式的响应，不要包含任何其他文本。"},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 500,
        }
        
        # 尝试添加 response_format 参数（OpenAI 兼容 API 支持）
        # 注意：某些 API 可能不支持此参数，会被忽略
        try:
            payload["response_format"] = {"type": "json_object"}
        except Exception:
            pass

        last_error = None
        url = self._get_endpoint_url(self._openai_base_url, "/chat/completions")

        for attempt in range(1, API_MAX_RETRIES + 1):
            try:
                start_time = time.time()
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        url,
                        headers=headers,
                        json=payload,
                    )
                    response.raise_for_status()
                    data = response.json()
                    duration_ms = int((time.time() - start_time) * 1000)

                    # 成功调用，重置失败计数
                    if self._consecutive_failures > 0:
                        logger.info(f"AI自动封禁: API 调用恢复正常，之前连续失败 {self._consecutive_failures} 次")
                    self._consecutive_failures = 0
                    self._last_error_message = ""

                    # 提取 usage 信息
                    usage = data.get("usage", {})
                    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    # 获取实际使用的模型（API 返回的可能和请求的不同）
                    actual_model = data.get("model", self._ai_model)

                    return {
                        "content": content,
                        "model": actual_model,
                        "prompt_tokens": usage.get("prompt_tokens", 0),
                        "completion_tokens": usage.get("completion_tokens", 0),
                        "total_tokens": usage.get("total_tokens", 0),
                        "duration_ms": duration_ms,
                    }

            except httpx.HTTPStatusError as e:
                last_error = f"HTTP {e.response.status_code}: {e.response.text[:200]}"
                logger.warning(f"AI自动封禁: API 请求失败 (尝试 {attempt}/{API_MAX_RETRIES}) - {last_error}")
            except httpx.TimeoutException:
                last_error = "请求超时"
                logger.warning(f"AI自动封禁: API 请求超时 (尝试 {attempt}/{API_MAX_RETRIES})")
            except Exception as e:
                last_error = str(e)
                logger.warning(f"AI自动封禁: API 调用异常 (尝试 {attempt}/{API_MAX_RETRIES}) - {e}")

            # 如果不是最后一次尝试，等待后重试
            if attempt < API_MAX_RETRIES:
                await asyncio.sleep(API_RETRY_DELAY * attempt)  # 递增延迟

        # 所有重试都失败了
        self._consecutive_failures += 1
        self._last_failure_time = time.time()
        self._last_error_message = last_error or "未知错误"

        logger.error(f"AI自动封禁: API 调用失败，已重试 {API_MAX_RETRIES} 次，连续失败 {self._consecutive_failures} 次，错误: {last_error}")

        # 检查是否需要暂停服务
        if self._consecutive_failures >= API_MAX_CONSECUTIVE_FAILURES:
            self._api_suspended = True
            logger.error(f"AI自动封禁: 连续失败 {self._consecutive_failures} 次，API 服务已暂停，将在 {API_FAILURE_COOLDOWN} 秒后自动尝试恢复")
            logger.business(
                "AI封禁服务暂停",
                reason="API连续调用失败",
                consecutive_failures=self._consecutive_failures,
                last_error=self._last_error_message,
                cooldown_seconds=API_FAILURE_COOLDOWN,
            )

        return None

    async def fetch_models(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        """
        获取可用模型列表 (OpenAI Compatible /v1/models)

        永久缓存策略：
        - 缓存永久有效，除非 API 地址变化或手动刷新
        - API 地址变化时自动清除旧缓存并重新获取

        Args:
            base_url: API地址，不传则使用当前配置
            api_key: API Key，不传则使用当前配置
            force_refresh: 是否强制刷新缓存
        """
        base = (base_url or self._openai_base_url).rstrip("/")
        key = api_key or self._openai_api_key

        if not key:
            return {"success": False, "message": "API Key 未配置", "models": []}

        # 检查 API 地址是否变化
        cached_url = self._storage.cache_get(self._models_cache_url_key)
        url_changed = cached_url != base

        if url_changed:
            logger.info(f"AI配置: API 地址已变化 ({cached_url} -> {base})，将重新获取模型列表")
            force_refresh = True

        # 检查缓存（永久有效，TTL 设为 30 天）
        if not force_refresh:
            cached = self._storage.cache_get(self._models_cache_key)
            if cached and isinstance(cached, list) and len(cached) > 0:
                logger.debug(f"AI配置: 使用缓存的模型列表 (共 {len(cached)} 个)")
                return {
                    "success": True,
                    "message": f"获取到 {len(cached)} 个模型",
                    "models": cached,
                }

        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

        try:
            logger.info(f"AI配置: 从 API 获取模型列表 (base_url={base})")
            async with httpx.AsyncClient(timeout=15.0) as client:
                url = self._get_endpoint_url(base, "/models")
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                data = response.json()

                # 解析模型列表
                models = []
                raw_models = data.get("data", [])
                for m in raw_models:
                    model_id = m.get("id", "")
                    if model_id:
                        models.append({
                            "id": model_id,
                            "owned_by": m.get("owned_by", ""),
                            "created": m.get("created", 0),
                        })

                # 按模型名排序
                models.sort(key=lambda x: x["id"])

                # 永久缓存（TTL 设为 30 天，实际上相当于永久）
                cache_ttl = 30 * 24 * 3600  # 30 天
                self._storage.cache_set(self._models_cache_key, models, ttl=cache_ttl)
                self._storage.cache_set(self._models_cache_url_key, base, ttl=cache_ttl)
                logger.info(f"AI配置: 获取到 {len(models)} 个模型，已永久缓存")

                return {
                    "success": True,
                    "message": f"获取到 {len(models)} 个模型",
                    "models": models,
                }
        except httpx.HTTPStatusError as e:
            return {
                "success": False,
                "message": f"请求失败: {e.response.status_code}",
                "models": [],
            }
        except httpx.ConnectError:
            return {
                "success": False,
                "message": "连接失败，请检查 API 地址",
                "models": [],
            }
        except Exception as e:
            return {
                "success": False,
                "message": f"获取模型列表失败: {str(e)}",
                "models": [],
            }

    async def test_model(
        self,
        model: str,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        测试指定模型是否可用
        
        Args:
            model: 模型名称
            base_url: API地址，不传则使用当前配置
            api_key: API Key，不传则使用当前配置
        """
        base = (base_url or self._openai_base_url).rstrip("/")
        key = api_key or self._openai_api_key
        
        if not key:
            return {"success": False, "message": "API Key 未配置"}
        
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

        test_message = "你好，这是一条 API 连接测试消息，请简短回复确认连接正常。"

        payload = {
            "model": model,
            "messages": [
                {"role": "user", "content": test_message},
            ],
            "max_tokens": 100,
        }

        # 记录发送的测试请求
        logger.info(f"AI配置测试: 发送测试请求 (model={model}, base_url={base})")
        logger.info(f"AI配置测试: 发送消息: {test_message}")

        try:
            start_time = time.time()
            async with httpx.AsyncClient(timeout=30.0) as client:
                url = self._get_endpoint_url(base, "/chat/completions")
                response = await client.post(
                    url,
                    headers=headers,
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()
                elapsed = time.time() - start_time

                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                usage = data.get("usage", {})
                actual_model = data.get("model", model)

                # 记录成功响应
                logger.info(f"AI配置测试: 连接成功 (延迟={int(elapsed * 1000)}ms, 实际模型={actual_model})")
                logger.info(f"AI配置测试: AI回复: {content}")
                logger.info(f"AI配置测试: Token用量: prompt={usage.get('prompt_tokens', 0)}, completion={usage.get('completion_tokens', 0)}")

                return {
                    "success": True,
                    "message": "连接成功",
                    "model": actual_model,
                    "test_message": test_message,
                    "response": content,
                    "latency_ms": int(elapsed * 1000),
                    "usage": {
                        "prompt_tokens": usage.get("prompt_tokens", 0),
                        "completion_tokens": usage.get("completion_tokens", 0),
                    },
                }
        except httpx.HTTPStatusError as e:
            error_detail = ""
            try:
                error_data = e.response.json()
                error_detail = error_data.get("error", {}).get("message", "")
            except:
                error_detail = e.response.text[:200]
            error_msg = f"请求失败 ({e.response.status_code}): {error_detail}"
            logger.error(f"AI配置测试: {error_msg}")
            return {
                "success": False,
                "message": error_msg,
            }
        except httpx.ConnectError as e:
            logger.error(f"AI配置测试: 连接失败 - {e}")
            return {
                "success": False,
                "message": "连接失败，请检查 API 地址",
            }
        except httpx.TimeoutException:
            logger.error("AI配置测试: 请求超时")
            return {
                "success": False,
                "message": "请求超时",
            }
        except Exception as e:
            logger.error(f"AI配置测试: 测试失败 - {type(e).__name__}: {e}")
            return {
                "success": False,
                "message": f"测试失败: {str(e)}",
            }

    def _extract_json_from_response(self, response: str) -> tuple[str, str]:
        """
        从 AI 响应中提取 JSON 字符串
        
        Returns:
            (json_str, extraction_method)
        """
        import re
        
        # 方法1: 直接尝试解析整个响应
        try:
            json.loads(response.strip())
            return response.strip(), "direct"
        except json.JSONDecodeError:
            pass
        
        # 方法2: 提取 ```json ... ``` 代码块
        if "```json" in response:
            try:
                json_str = response.split("```json")[1].split("```")[0].strip()
                json.loads(json_str)  # 验证是否有效
                return json_str, "json_code_block"
            except (IndexError, json.JSONDecodeError):
                pass
        
        # 方法3: 提取 ``` ... ``` 代码块
        if "```" in response:
            try:
                json_str = response.split("```")[1].split("```")[0].strip()
                json.loads(json_str)  # 验证是否有效
                return json_str, "code_block"
            except (IndexError, json.JSONDecodeError):
                pass
        
        # 方法4: 查找第一个 { 到最后一个 } 之间的内容
        first_brace = response.find('{')
        last_brace = response.rfind('}')
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            try:
                json_str = response[first_brace:last_brace + 1]
                json.loads(json_str)  # 验证是否有效
                return json_str, "brace_extract"
            except json.JSONDecodeError:
                pass
        
        # 方法5: 使用正则匹配包含 should_ban 的 JSON（支持嵌套）
        # 从包含 should_ban 的位置向前找 {，向后找匹配的 }
        match = re.search(r'"should_ban"', response)
        if match:
            start_pos = match.start()
            # 向前找最近的 {
            brace_start = response.rfind('{', 0, start_pos)
            if brace_start != -1:
                # 从 brace_start 开始，找匹配的 }
                depth = 0
                for i, char in enumerate(response[brace_start:], brace_start):
                    if char == '{':
                        depth += 1
                    elif char == '}':
                        depth -= 1
                        if depth == 0:
                            try:
                                json_str = response[brace_start:i + 1]
                                json.loads(json_str)  # 验证是否有效
                                return json_str, "nested_extract"
                            except json.JSONDecodeError:
                                break
        
        # 所有方法都失败，返回原始响应
        return response, "fallback"

    def _parse_ai_response(
        self,
        response: str,
        model: Optional[str] = None,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        total_tokens: int = 0,
        api_duration_ms: int = 0,
    ) -> Optional[AIAssessmentResult]:
        """解析 AI 响应"""
        if not response:
            self._last_error_message = "AI 响应内容为空"
            logger.error(f"AI自动封禁: 响应内容为空 (model={model})")
            return None

        try:
            # 尝试提取 JSON
            json_str, extraction_method = self._extract_json_from_response(response)

            logger.debug(f"AI自动封禁: 解析响应 (method={extraction_method}, model={model}), JSON预览: {json_str[:300]}...")

            data = json.loads(json_str.strip())

            # 验证必需字段
            if "should_ban" not in data:
                self._last_error_message = f"响应缺少必需字段 'should_ban' (model={model})"
                logger.error(f"AI自动封禁: {self._last_error_message}, 解析结果: {data}")
                return None

            should_ban = bool(data.get("should_ban", False))
            risk_score = int(data.get("risk_score", 1))
            confidence = float(data.get("confidence", 0.0))
            reason = str(data.get("reason", ""))

            # 确定动作
            if should_ban and risk_score >= RISK_SCORE_BAN_THRESHOLD and confidence >= CONFIDENCE_THRESHOLD:
                action = AIBanAction.BAN
            elif should_ban or risk_score >= 6:
                action = AIBanAction.WARN
            elif risk_score >= 4:
                action = AIBanAction.MONITOR
            else:
                action = AIBanAction.SKIP

            return AIAssessmentResult(
                should_ban=should_ban,
                risk_score=risk_score,
                confidence=confidence,
                reason=reason,
                action=action,
                raw_response=response,
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                api_duration_ms=api_duration_ms,
            )
        except json.JSONDecodeError as e:
            self._last_error_message = f"JSON 解析失败 (model={model}): {e}"
            logger.error(f"AI自动封禁: JSON 解析失败 - {e}")
            logger.error(f"AI自动封禁: 提取方法={extraction_method}, 尝试解析的内容: {json_str[:500]}")
            logger.error(f"AI自动封禁: 完整原始响应: {response}")
            return None
        except (KeyError, ValueError, TypeError) as e:
            self._last_error_message = f"响应数据格式错误 (model={model}): {e}"
            logger.error(f"AI自动封禁: 响应数据格式错误 - {e}, 原始响应: {response[:500]}")
            return None
        except Exception as e:
            self._last_error_message = f"响应解析异常 (model={model}): {type(e).__name__}: {e}"
            logger.error(f"AI自动封禁: 响应解析异常 - {type(e).__name__}: {e}, 原始响应: {response[:500]}")
            return None

    async def assess_user(self, user_id: int, analysis: Dict[str, Any]) -> Optional[AIAssessmentResult]:
        """
        对单个用户进行 AI 风险评估

        Args:
            user_id: 用户ID
            analysis: 用户行为分析数据

        Returns:
            AI 评估结果
        """
        user = analysis.get("user", {})
        user_role = user.get("role", 0)

        # 检查白名单
        if self._is_whitelisted(user_id, user_role):
            return AIAssessmentResult(
                should_ban=False,
                risk_score=0,
                confidence=1.0,
                reason="白名单用户，跳过评估",
                action=AIBanAction.SKIP,
            )

        # 构建 prompt 并调用 AI
        prompt = self._build_assessment_prompt(analysis)
        api_result = await self._call_openai_api(prompt)

        if not api_result:
            return None

        # 解析响应并传入 API 调用信息
        # 记录 AI 原始响应（用于调试）
        content = api_result.get("content", "")
        logger.info(f"AI自动封禁: 收到AI响应 (tokens: {api_result.get('total_tokens', 0)}, 耗时: {api_result.get('duration_ms', 0)}ms), 内容预览: {content[:300]}...")
        return self._parse_ai_response(
            response=content,
            model=api_result.get("model"),
            prompt_tokens=api_result.get("prompt_tokens", 0),
            completion_tokens=api_result.get("completion_tokens", 0),
            total_tokens=api_result.get("total_tokens", 0),
            api_duration_ms=api_result.get("duration_ms", 0),
        )

    async def process_user(
        self,
        user_id: int,
        username: str,
        analysis: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        处理单个可疑用户
        
        Returns:
            处理结果
        """
        result = {
            "user_id": user_id,
            "username": username,
            "action": None,
            "assessment": None,
            "executed": False,
            "message": "",
        }
        
        # AI 评估
        assessment = await self.assess_user(user_id, analysis)
        if not assessment:
            result["action"] = "error"
            result["message"] = f"AI 评估失败: {self._last_error_message or 'API 调用失败或响应解析错误'}"
            return result
        
        result["assessment"] = {
            "should_ban": assessment.should_ban,
            "risk_score": assessment.risk_score,
            "confidence": assessment.confidence,
            "reason": assessment.reason,
            "action": assessment.action.value,
            # AI API 调用信息
            "model": assessment.model,
            "prompt_tokens": assessment.prompt_tokens,
            "completion_tokens": assessment.completion_tokens,
            "total_tokens": assessment.total_tokens,
            "api_duration_ms": assessment.api_duration_ms,
        }
        result["action"] = assessment.action.value
        
        # 设置冷却期
        self._set_cooldown(user_id)
        
        # 根据决策执行
        if assessment.action == AIBanAction.BAN:
            if self._dry_run:
                result["message"] = f"[试运行] 建议封禁: {assessment.reason}"
                result["executed"] = False
            else:
                # 执行封禁
                ban_result = self._user_service.ban_user(
                    user_id=user_id,
                    reason=f"[AI自动封禁] {assessment.reason}",
                    disable_tokens=True,
                    operator="AI自动封禁",
                    context={
                        "source": "ai_auto_ban",
                        "risk_score": assessment.risk_score,
                        "confidence": assessment.confidence,
                        "ai_reason": assessment.reason,
                    },
                )
                result["executed"] = ban_result.get("success", False)
                result["message"] = ban_result.get("message", "")
        
        elif assessment.action == AIBanAction.WARN:
            result["message"] = f"风险告警: {assessment.reason}"
            # 记录告警日志
            self._storage.add_security_audit(
                action="ai_warn",
                user_id=user_id,
                username=username,
                operator="AI自动封禁",
                reason=assessment.reason,
                context={
                    "source": "ai_auto_ban",
                    "risk_score": assessment.risk_score,
                    "confidence": assessment.confidence,
                },
            )
        
        elif assessment.action == AIBanAction.MONITOR:
            result["message"] = f"继续观察: {assessment.reason}"
        
        else:
            result["message"] = f"跳过: {assessment.reason}"
        
        return result

    async def run_scan(self, window: str = "1h", limit: int = 10, manual: bool = False) -> Dict[str, Any]:
        """
        执行一次扫描
        
        Args:
            window: 时间窗口
            limit: 最大处理用户数
            manual: 是否为手动触发
            
        Returns:
            扫描结果
        """
        scan_id = str(uuid.uuid4())[:8]
        scan_type = "手动扫描" if manual else "定时扫描"
        
        if not self.is_enabled():
            logger.warning(f"AI封禁{scan_type}: 服务未启用，跳过扫描")
            return {
                "success": False,
                "message": "AI 自动封禁服务未启用",
                "enabled": False,
            }
        
        # 检查 API 是否暂停
        if self._api_suspended:
            remaining = max(0, int(API_FAILURE_COOLDOWN - (time.time() - self._last_failure_time)))
            logger.warning(f"AI封禁{scan_type}: API服务暂停中，剩余冷却时间 {remaining} 秒")
            return {
                "success": False,
                "message": f"API 服务暂停中，剩余冷却时间 {remaining} 秒",
                "api_suspended": True,
            }
        
        logger.info(f"AI封禁{scan_type}: 开始扫描 (scan_id={scan_id}, window={window}, limit={limit})")
        
        start_time = time.time()
        results = []
        
        # 获取可疑用户
        suspicious_users = self.get_suspicious_users(window=window, limit=limit)
        
        logger.info(f"AI封禁{scan_type}: 发现 {len(suspicious_users)} 个可疑用户")
        
        for user_data in suspicious_users:
            user_id = user_data["user_id"]
            username = user_data["username"]
            analysis = user_data["analysis"]
            
            try:
                result = await self.process_user(user_id, username, analysis)
                results.append(result)
                logger.info(f"AI封禁{scan_type}: 用户 {username}(ID:{user_id}) 处理完成 - 动作: {result.get('action')}")
            except Exception as e:
                logger.error(f"AI封禁{scan_type}: 处理用户 {username}(ID:{user_id}) 失败 - {e}")
                results.append({
                    "user_id": user_id,
                    "username": username,
                    "action": "error",
                    "message": str(e),
                })
        
        elapsed = time.time() - start_time
        
        # 统计
        stats = {
            "total_scanned": len(suspicious_users),
            "total_processed": len(results),
            "banned": sum(1 for r in results if r.get("action") == "ban" and r.get("executed")),
            "warned": sum(1 for r in results if r.get("action") == "warn"),
            "skipped": sum(1 for r in results if r.get("action") in ["skip", "monitor"]),
            "errors": sum(1 for r in results if r.get("action") == "error"),
        }
        
        # 确定状态
        if stats["errors"] > 0 and stats["errors"] == stats["total_processed"]:
            status = "failed"
        elif stats["errors"] > 0:
            status = "partial"
        elif stats["total_scanned"] == 0:
            status = "empty"
        else:
            status = "success"
        
        # 只有扫描到用户时才记录审查日志
        if stats["total_scanned"] > 0:
            self._storage.add_ai_audit_log(
                scan_id=scan_id,
                status=status,
                window=window,
                total_scanned=stats["total_scanned"],
                total_processed=stats["total_processed"],
                banned_count=stats["banned"],
                warned_count=stats["warned"],
                skipped_count=stats["skipped"],
                error_count=stats["errors"],
                dry_run=self._dry_run,
                elapsed_seconds=round(elapsed, 2),
                details=results if results else None,
            )
        
        # 输出扫描完成日志
        logger.business(
            f"AI封禁{scan_type}完成",
            scan_id=scan_id,
            window=window,
            dry_run=self._dry_run,
            **stats,
            elapsed=f"{elapsed:.2f}s",
        )
        
        return {
            "success": True,
            "scan_id": scan_id,
            "dry_run": self._dry_run,
            "window": window,
            "elapsed_seconds": round(elapsed, 2),
            "stats": stats,
            "results": results,
        }

    def get_config(self) -> Dict[str, Any]:
        """获取当前配置"""
        # 遮蔽 API Key，只显示前4位和后4位
        masked_api_key = ""
        if self._openai_api_key:
            key = self._openai_api_key
            if len(key) > 8:
                masked_api_key = key[:4] + "*" * (len(key) - 8) + key[-4:]
            else:
                masked_api_key = "*" * len(key)
        
        # 计算 API 暂停剩余时间
        api_cooldown_remaining = 0
        if self._api_suspended:
            api_cooldown_remaining = max(0, int(API_FAILURE_COOLDOWN - (time.time() - self._last_failure_time)))
        
        return {
            "enabled": self._enabled,
            "dry_run": self._dry_run,
            "model": self._ai_model,
            "base_url": self._openai_base_url,
            "has_api_key": bool(self._openai_api_key),
            "api_key": self._openai_api_key,  # 完整 key
            "masked_api_key": masked_api_key,  # 遮蔽版
            "whitelist_count": len(self._whitelist_ids),
            "risk_score_threshold": RISK_SCORE_BAN_THRESHOLD,
            "confidence_threshold": CONFIDENCE_THRESHOLD,
            "cooldown_hours": AI_ASSESSMENT_COOLDOWN // 3600,
            "scan_interval_minutes": self._scan_interval_minutes,
            # 自定义提示词
            "custom_prompt": self._custom_prompt,
            "default_prompt": DEFAULT_ASSESSMENT_PROMPT,
            # IP 白名单/黑名单
            "whitelist_ips": self._whitelist_ips,
            "blacklist_ips": self._blacklist_ips,
            # 排除模型/分组（这些请求不计入风险分析）
            "excluded_models": self._excluded_models,
            "excluded_groups": self._excluded_groups,
            # API 健康状态
            "api_health": {
                "suspended": self._api_suspended,
                "consecutive_failures": self._consecutive_failures,
                "last_error": self._last_error_message if self._consecutive_failures > 0 else None,
                "cooldown_remaining": api_cooldown_remaining,
            },
        }
    
    def reset_api_health(self) -> bool:
        """手动重置 API 健康状态（用于管理员手动恢复服务）"""
        self._api_suspended = False
        self._consecutive_failures = 0
        self._last_failure_time = 0
        self._last_error_message = ""
        logger.business("AI封禁服务手动恢复", action="reset_api_health")
        return True

    def get_audit_logs(self, limit: int = 50, offset: int = 0, status: Optional[str] = None) -> Dict[str, Any]:
        """获取审查记录"""
        return self._storage.get_ai_audit_logs(limit=limit, offset=offset, status=status)

    def clear_audit_logs(self) -> int:
        """清空审查记录"""
        count = self._storage.delete_ai_audit_logs()
        logger.business("AI审查记录已手动清空", count=count)
        return count

    def get_scan_interval(self) -> int:
        """获取定时扫描间隔（分钟），0 表示关闭"""
        return self._scan_interval_minutes

    def get_available_groups(self, days: int = 7) -> List[Dict[str, Any]]:
        """
        获取最近使用的分组列表（用于配置排除分组）

        Args:
            days: 查询最近多少天的数据

        Returns:
            分组列表，包含分组名称和请求数
        """
        from .database import get_db_manager, DatabaseEngine

        try:
            db = get_db_manager()
            db.connect()

            is_pg = db.config.engine == DatabaseEngine.POSTGRESQL
            group_col = '"group"' if is_pg else '`group`'

            now = int(time.time())
            start_time = now - (days * 24 * 3600)

            sql = f"""
                SELECT COALESCE({group_col}, 'default') as group_name, COUNT(*) as requests
                FROM logs
                WHERE created_at >= :start_time AND type IN (2, 5)
                GROUP BY COALESCE({group_col}, 'default')
                ORDER BY requests DESC
                LIMIT 50
            """

            rows = db.execute(sql, {"start_time": start_time})
            return [
                {"group_name": r.get("group_name") or "default", "requests": int(r.get("requests") or 0)}
                for r in (rows or [])
            ]
        except Exception as e:
            logger.error(f"获取可用分组列表失败: {e}")
            return []

    def get_available_models(self, days: int = 7) -> List[Dict[str, Any]]:
        """
        获取最近使用的模型列表（用于配置排除模型）

        Args:
            days: 查询最近多少天的数据

        Returns:
            模型列表，包含模型名称和请求数
        """
        from .database import get_db_manager

        try:
            db = get_db_manager()
            db.connect()

            now = int(time.time())
            start_time = now - (days * 24 * 3600)

            sql = """
                SELECT COALESCE(model_name, 'unknown') as model_name, COUNT(*) as requests
                FROM logs
                WHERE created_at >= :start_time AND type IN (2, 5)
                GROUP BY COALESCE(model_name, 'unknown')
                ORDER BY requests DESC
                LIMIT 100
            """

            rows = db.execute(sql, {"start_time": start_time})
            return [
                {"model_name": r.get("model_name") or "unknown", "requests": int(r.get("requests") or 0)}
                for r in (rows or [])
            ]
        except Exception as e:
            logger.error(f"获取可用模型列表失败: {e}")
            return []


# 全局实例
_ai_auto_ban_service: Optional[AIAutoBanService] = None


def get_ai_auto_ban_service() -> AIAutoBanService:
    """获取 AI 自动封禁服务实例"""
    global _ai_auto_ban_service
    if _ai_auto_ban_service is None:
        _ai_auto_ban_service = AIAutoBanService()
    return _ai_auto_ban_service

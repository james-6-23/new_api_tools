"""
AI 自动封禁 API 路由 - NewAPI Middleware Tool
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from .auth import verify_auth
from .ai_auto_ban_service import get_ai_auto_ban_service
from .risk_monitoring_service import get_risk_monitoring_service, WINDOW_SECONDS


router = APIRouter(prefix="/api/ai-ban", tags=["AI Auto Ban"])


class ManualAssessRequest(BaseModel):
    """手动评估请求"""
    user_id: int
    window: str = "1h"


class SaveConfigRequest(BaseModel):
    """保存配置请求"""
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    enabled: Optional[bool] = None
    dry_run: Optional[bool] = None
    scan_interval_minutes: Optional[int] = None  # 定时扫描间隔（分钟），0表示关闭
    custom_prompt: Optional[str] = None  # 自定义 AI 评估提示词
    whitelist_ips: Optional[list] = None  # IP 白名单（可信IP，如办公室、机房IP）
    blacklist_ips: Optional[list] = None  # IP 黑名单（已知恶意IP）
    excluded_models: Optional[list] = None  # 排除模型列表（这些模型的请求不计入风险分析）
    excluded_groups: Optional[list] = None  # 排除分组列表（这些分组的请求不计入风险分析）


class FetchModelsRequest(BaseModel):
    """获取模型列表请求"""
    base_url: str
    api_key: Optional[str] = None  # 可选，不传则使用已保存的配置
    force_refresh: bool = False    # 是否强制刷新缓存


class TestModelRequest(BaseModel):
    """测试模型请求"""
    base_url: str
    api_key: Optional[str] = None  # 可选，不传则使用已保存的配置
    model: str


class WhitelistAddRequest(BaseModel):
    """添加白名单请求"""
    user_id: int


class WhitelistRemoveRequest(BaseModel):
    """移除白名单请求"""
    user_id: int


@router.get("/config")
async def get_config(_: str = Depends(verify_auth)):
    """获取 AI 自动封禁配置"""
    service = get_ai_auto_ban_service()
    return {
        "success": True,
        "data": service.get_config(),
    }


@router.post("/config")
async def save_config(
    request: SaveConfigRequest,
    _: str = Depends(verify_auth),
):
    """保存 AI 自动封禁配置"""
    service = get_ai_auto_ban_service()
    
    config = {}
    if request.base_url is not None:
        config["base_url"] = request.base_url.rstrip("/")
    if request.api_key is not None:
        config["api_key"] = request.api_key
    if request.model is not None:
        config["model"] = request.model
    if request.enabled is not None:
        config["enabled"] = request.enabled
    if request.dry_run is not None:
        config["dry_run"] = request.dry_run
    if request.scan_interval_minutes is not None:
        # 限制扫描间隔范围：0（关闭）或 15-1440 分钟（15分钟到24小时）
        interval = request.scan_interval_minutes
        if interval != 0 and (interval < 15 or interval > 1440):
            raise HTTPException(status_code=400, detail="扫描间隔必须为0（关闭）或15-1440分钟")
        config["scan_interval_minutes"] = interval
    if request.custom_prompt is not None:
        config["custom_prompt"] = request.custom_prompt
    if request.whitelist_ips is not None:
        config["whitelist_ips"] = request.whitelist_ips
    if request.blacklist_ips is not None:
        config["blacklist_ips"] = request.blacklist_ips
    if request.excluded_models is not None:
        config["excluded_models"] = request.excluded_models
    if request.excluded_groups is not None:
        config["excluded_groups"] = request.excluded_groups

    if not config:
        raise HTTPException(status_code=400, detail="没有要保存的配置")
    
    success = service.save_config(config)
    
    if success:
        return {
            "success": True,
            "message": "配置已保存",
            "data": service.get_config(),
        }
    else:
        raise HTTPException(status_code=500, detail="保存配置失败")


@router.post("/reset-api-health")
async def reset_api_health(_: str = Depends(verify_auth)):
    """手动重置 API 健康状态，恢复暂停的服务"""
    service = get_ai_auto_ban_service()
    success = service.reset_api_health()
    return {
        "success": success,
        "message": "API 健康状态已重置" if success else "重置失败",
        "data": service.get_config(),
    }


@router.get("/audit-logs")
async def get_audit_logs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    status: Optional[str] = Query(default=None),
    _: str = Depends(verify_auth),
):
    """获取 AI 审查记录"""
    service = get_ai_auto_ban_service()
    result = service.get_audit_logs(limit=limit, offset=offset, status=status)
    return {
        "success": True,
        "data": result,
    }


@router.delete("/audit-logs")
async def clear_audit_logs(
    _: str = Depends(verify_auth),
):
    """清空 AI 审查记录"""
    service = get_ai_auto_ban_service()
    count = service.clear_audit_logs()
    return {
        "success": True,
        "message": f"已清空 {count} 条记录",
        "count": count,
    }


@router.get("/available-groups")
async def get_available_groups(
    days: int = Query(default=7, ge=1, le=30, description="查询最近多少天的数据"),
    _: str = Depends(verify_auth),
):
    """获取最近使用的分组列表（用于配置排除分组）"""
    service = get_ai_auto_ban_service()
    groups = service.get_available_groups(days=days)
    return {
        "success": True,
        "data": {
            "items": groups,
            "total": len(groups),
        },
    }


@router.get("/available-models-for-exclude")
async def get_available_models_for_exclude(
    days: int = Query(default=7, ge=1, le=30, description="查询最近多少天的数据"),
    _: str = Depends(verify_auth),
):
    """获取最近使用的模型列表（用于配置排除模型，与 AI API 的模型列表不同）"""
    service = get_ai_auto_ban_service()
    models = service.get_available_models(days=days)
    return {
        "success": True,
        "data": {
            "items": models,
            "total": len(models),
        },
    }


@router.post("/models")
async def fetch_models(
    request: FetchModelsRequest,
    _: str = Depends(verify_auth),
):
    """获取可用模型列表 (OpenAI Compatible /v1/models)，支持缓存"""
    service = get_ai_auto_ban_service()
    result = await service.fetch_models(
        base_url=request.base_url,
        api_key=request.api_key,
        force_refresh=request.force_refresh,
    )
    return result


@router.post("/test-model")
async def test_model(
    request: TestModelRequest,
    _: str = Depends(verify_auth),
):
    """测试指定模型是否可用"""
    service = get_ai_auto_ban_service()
    result = await service.test_model(
        model=request.model,
        base_url=request.base_url,
        api_key=request.api_key,
    )
    return result


@router.get("/suspicious-users")
async def get_suspicious_users(
    window: str = Query(default="1h", description="时间窗口"),
    limit: int = Query(default=20, ge=1, le=100, description="最大数量"),
    _: str = Depends(verify_auth),
):
    """获取可疑用户列表"""
    service = get_ai_auto_ban_service()
    
    if window not in WINDOW_SECONDS:
        raise HTTPException(status_code=400, detail=f"无效的时间窗口: {window}")
    
    users = service.get_suspicious_users(window=window, limit=limit)
    
    # 简化返回数据
    items = []
    for u in users:
        analysis = u.get("analysis", {})
        items.append({
            "user_id": u["user_id"],
            "username": u["username"],
            "risk_flags": analysis.get("risk", {}).get("risk_flags", []),
            "rpm": round(analysis.get("risk", {}).get("requests_per_minute", 0), 1),
            "total_requests": analysis.get("summary", {}).get("total_requests", 0),
            "empty_rate": round(analysis.get("summary", {}).get("empty_rate", 0) * 100, 1),
            "failure_rate": round(analysis.get("summary", {}).get("failure_rate", 0) * 100, 1),
            "unique_ips": analysis.get("summary", {}).get("unique_ips", 0),
            "rapid_switch_count": analysis.get("risk", {}).get("ip_switch_analysis", {}).get("rapid_switch_count", 0),
        })
    
    return {
        "success": True,
        "data": {
            "window": window,
            "count": len(items),
            "items": items,
        },
    }


@router.post("/assess")
async def manual_assess(
    request: ManualAssessRequest,
    _: str = Depends(verify_auth),
):
    """
    手动触发单个用户的 AI 评估
    
    不会自动执行封禁，仅返回评估结果
    """
    service = get_ai_auto_ban_service()
    
    if not service.is_enabled():
        raise HTTPException(status_code=400, detail="AI 自动封禁服务未启用，请先配置并启用")
    
    window_seconds = WINDOW_SECONDS.get(request.window, 3600)
    
    # 获取用户分析数据
    risk_service = get_risk_monitoring_service()
    analysis = risk_service.get_user_analysis(request.user_id, window_seconds)
    
    if not analysis.get("user", {}).get("id"):
        raise HTTPException(status_code=404, detail="用户不存在")
    
    # 执行 AI 评估
    assessment = await service.assess_user(request.user_id, analysis)
    
    if not assessment:
        raise HTTPException(status_code=500, detail="AI 评估失败，请检查 API 配置")
    
    return {
        "success": True,
        "data": {
            "user_id": request.user_id,
            "username": analysis.get("user", {}).get("username", ""),
            "window": request.window,
            "assessment": {
                "should_ban": assessment.should_ban,
                "risk_score": assessment.risk_score,
                "confidence": assessment.confidence,
                "reason": assessment.reason,
                "action": assessment.action.value,
            },
            "would_execute": (
                assessment.action.value == "ban" and 
                assessment.risk_score >= 8 and 
                assessment.confidence >= 0.8
            ),
        },
    }


@router.post("/scan")
async def run_scan(
    window: str = Query(default="1h", description="时间窗口"),
    limit: int = Query(default=10, ge=1, le=50, description="最大处理用户数"),
    _: str = Depends(verify_auth),
):
    """
    手动触发一次扫描
    
    会根据配置决定是否实际执行封禁（dry_run 模式下不会执行）
    """
    service = get_ai_auto_ban_service()
    
    if not service.is_enabled():
        raise HTTPException(status_code=400, detail="AI 自动封禁服务未启用，请先配置并启用")
    
    if window not in WINDOW_SECONDS:
        raise HTTPException(status_code=400, detail=f"无效的时间窗口: {window}")
    
    result = await service.run_scan(window=window, limit=limit, manual=True)
    
    return {
        "success": result.get("success", False),
        "data": result,
    }


@router.post("/test-connection")
async def test_connection(_: str = Depends(verify_auth)):
    """测试当前配置的 API 连接"""
    service = get_ai_auto_ban_service()
    
    if not service._openai_api_key:
        return {
            "success": False,
            "message": "API Key 未配置",
        }
    
    result = await service.test_model(
        model=service._ai_model,
        base_url=service._openai_base_url,
        api_key=service._openai_api_key,
    )
    return result


# ==================== 白名单管理 ====================

@router.get("/whitelist")
async def get_whitelist(_: str = Depends(verify_auth)):
    """获取白名单列表"""
    service = get_ai_auto_ban_service()
    whitelist = service.get_whitelist()
    return {
        "success": True,
        "data": {
            "items": whitelist,
            "total": len(whitelist),
        }
    }


@router.post("/whitelist/add")
async def add_to_whitelist(
    request: WhitelistAddRequest,
    _: str = Depends(verify_auth),
):
    """添加用户到白名单"""
    service = get_ai_auto_ban_service()
    result = service.add_to_whitelist(request.user_id)
    return result


@router.post("/whitelist/remove")
async def remove_from_whitelist(
    request: WhitelistRemoveRequest,
    _: str = Depends(verify_auth),
):
    """从白名单移除用户"""
    service = get_ai_auto_ban_service()
    result = service.remove_from_whitelist(request.user_id)
    return result


@router.get("/whitelist/search")
async def search_user_for_whitelist(
    q: str = Query(..., min_length=1, description="搜索关键词（用户名或ID）"),
    _: str = Depends(verify_auth),
):
    """搜索用户（用于添加白名单）"""
    service = get_ai_auto_ban_service()
    results = service.search_user_for_whitelist(q)
    return {
        "success": True,
        "data": results,
    }

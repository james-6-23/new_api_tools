"""
IP Monitoring API Routes for NewAPI Middleware Tool.
Provides IP usage analysis and management endpoints.
"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from .auth import verify_auth
from .main import InvalidParamsError
from .ip_monitoring_service import WINDOW_SECONDS, get_ip_monitoring_service

router = APIRouter(prefix="/api/ip", tags=["IP Monitoring"])


class StatsResponse(BaseModel):
    success: bool
    data: dict


class SharedIPsResponse(BaseModel):
    success: bool
    data: dict


class MultiIPTokensResponse(BaseModel):
    success: bool
    data: dict


class MultiIPUsersResponse(BaseModel):
    success: bool
    data: dict


class EnableAllResponse(BaseModel):
    success: bool
    data: dict
    message: str


@router.get("/stats", response_model=StatsResponse)
async def get_ip_stats(
    _: str = Depends(verify_auth),
):
    """Get IP recording statistics across all users."""
    service = get_ip_monitoring_service()
    data = service.get_ip_recording_stats()
    return StatsResponse(success=True, data=data)


@router.get("/shared-ips", response_model=SharedIPsResponse)
async def get_shared_ips(
    window: str = Query(default="24h", description="时间窗口 (1h/3h/6h/12h/24h/3d/7d)"),
    min_tokens: int = Query(default=2, ge=2, le=100, description="最小令牌数阈值"),
    limit: int = Query(default=50, ge=1, le=200, description="返回数量"),
    no_cache: bool = Query(default=False, description="强制刷新，跳过缓存"),
    _: str = Depends(verify_auth),
):
    """Get IPs used by multiple tokens."""
    seconds = WINDOW_SECONDS.get(window)
    if not seconds:
        raise InvalidParamsError(message=f"Invalid window: {window}")

    service = get_ip_monitoring_service()
    data = service.get_shared_ips(
        window_seconds=seconds,
        min_tokens=min_tokens,
        limit=limit,
        use_cache=not no_cache,
    )
    return SharedIPsResponse(success=True, data=data)


@router.get("/multi-ip-tokens", response_model=MultiIPTokensResponse)
async def get_multi_ip_tokens(
    window: str = Query(default="24h", description="时间窗口 (1h/3h/6h/12h/24h/3d/7d)"),
    min_ips: int = Query(default=2, ge=2, le=100, description="最小 IP 数阈值"),
    limit: int = Query(default=50, ge=1, le=200, description="返回数量"),
    no_cache: bool = Query(default=False, description="强制刷新，跳过缓存"),
    _: str = Depends(verify_auth),
):
    """Get tokens used from multiple IPs."""
    seconds = WINDOW_SECONDS.get(window)
    if not seconds:
        raise InvalidParamsError(message=f"Invalid window: {window}")

    service = get_ip_monitoring_service()
    data = service.get_multi_ip_tokens(
        window_seconds=seconds,
        min_ips=min_ips,
        limit=limit,
        use_cache=not no_cache,
    )
    return MultiIPTokensResponse(success=True, data=data)


@router.get("/multi-ip-users", response_model=MultiIPUsersResponse)
async def get_multi_ip_users(
    window: str = Query(default="24h", description="时间窗口 (1h/3h/6h/12h/24h/3d/7d)"),
    min_ips: int = Query(default=3, ge=2, le=100, description="最小 IP 数阈值"),
    limit: int = Query(default=50, ge=1, le=200, description="返回数量"),
    no_cache: bool = Query(default=False, description="强制刷新，跳过缓存"),
    _: str = Depends(verify_auth),
):
    """Get users accessing from multiple IPs."""
    seconds = WINDOW_SECONDS.get(window)
    if not seconds:
        raise InvalidParamsError(message=f"Invalid window: {window}")

    service = get_ip_monitoring_service()
    data = service.get_multi_ip_users(
        window_seconds=seconds,
        min_ips=min_ips,
        limit=limit,
        use_cache=not no_cache,
    )
    return MultiIPUsersResponse(success=True, data=data)


@router.post("/enable-all", response_model=EnableAllResponse)
async def enable_all_ip_recording(
    _: str = Depends(verify_auth),
):
    """Enable IP recording for all users."""
    service = get_ip_monitoring_service()
    try:
        data = service.enable_all_ip_recording()
        return EnableAllResponse(
            success=True,
            data=data,
            message=f"已更新 {data['updated_count']} 个用户，跳过 {data['skipped_count']} 个已开启的用户",
        )
    except Exception as e:
        raise InvalidParamsError(message=f"操作失败: {str(e)}")


class IPLookupResponse(BaseModel):
    success: bool
    data: dict


@router.get("/lookup/{ip:path}", response_model=IPLookupResponse)
async def lookup_ip_users(
    ip: str,
    window: str = Query(default="24h", description="时间窗口 (1h/3h/6h/12h/24h/3d/7d)"),
    limit: int = Query(default=100, ge=1, le=500, description="返回数量"),
    no_cache: bool = Query(default=False, description="强制刷新，跳过缓存"),
    include_geo: bool = Query(default=True, description="是否包含 IP 地理位置信息"),
    _: str = Depends(verify_auth),
):
    """通过 IP 反查所有使用该 IP 的用户和令牌。"""
    seconds = WINDOW_SECONDS.get(window)
    if not seconds:
        raise InvalidParamsError(message=f"Invalid window: {window}")

    # 基本的 IP 格式验证
    ip = ip.strip()
    if not ip or len(ip) > 45:
        raise InvalidParamsError(message=f"Invalid IP address: {ip}")

    service = get_ip_monitoring_service()
    data = service.get_ip_users(
        ip=ip,
        window_seconds=seconds,
        limit=limit,
        use_cache=not no_cache,
    )

    # 可选：附加 GeoIP 信息
    if include_geo:
        from .ip_geo_service import get_ip_geo_service
        geo_service = get_ip_geo_service()
        try:
            geo_info = await geo_service.query_single(ip)
            data["geo"] = geo_info.to_dict()
        except Exception:
            data["geo"] = None

    return IPLookupResponse(success=True, data=data)


@router.get("/users/{user_id}/ips", response_model=SharedIPsResponse)
async def get_user_ips(
    user_id: int,
    window: str = Query(default="24h", description="时间窗口 (1h/3h/6h/12h/24h/3d/7d)"),
    _: str = Depends(verify_auth),
):
    """Get all unique IPs for a specific user."""
    seconds = WINDOW_SECONDS.get(window)
    if not seconds:
        raise InvalidParamsError(message=f"Invalid window: {window}")

    service = get_ip_monitoring_service()
    data = service.get_user_ips(
        user_id=user_id,
        window_seconds=seconds,
    )
    return SharedIPsResponse(success=True, data={"items": data})


class EnsureIndexesResponse(BaseModel):
    success: bool
    data: dict
    message: str


class IndexStatusResponse(BaseModel):
    success: bool
    data: dict


@router.get("/index-status", response_model=IndexStatusResponse)
async def get_index_status(
    _: str = Depends(verify_auth),
):
    """Get status of all recommended indexes."""
    from .database import get_db_manager
    
    db = get_db_manager()
    db.connect()
    
    try:
        status = db.get_index_status()
        return IndexStatusResponse(success=True, data=status)
    except Exception as e:
        raise InvalidParamsError(message=f"获取索引状态失败: {str(e)}")


@router.post("/ensure-indexes", response_model=EnsureIndexesResponse)
async def ensure_indexes(
    _: str = Depends(verify_auth),
):
    """Ensure all recommended indexes exist for IP monitoring queries."""
    from .database import get_db_manager
    
    db = get_db_manager()
    db.connect()
    
    try:
        results = db.ensure_recommended_indexes()
        created_count = sum(1 for v in results.values() if v)
        existing_count = len(results) - created_count
        
        return EnsureIndexesResponse(
            success=True,
            data={"indexes": results, "created": created_count, "existing": existing_count},
            message=f"已创建 {created_count} 个索引，{existing_count} 个索引已存在",
        )
    except Exception as e:
        raise InvalidParamsError(message=f"创建索引失败: {str(e)}")


class IPGeoResponse(BaseModel):
    success: bool
    data: dict


class IPGeoBatchRequest(BaseModel):
    ips: list[str]


@router.get("/geo/{ip}", response_model=IPGeoResponse)
async def get_ip_geo(
    ip: str,
    _: str = Depends(verify_auth),
):
    """Get geographic information for a single IP address."""
    from .ip_geo_service import get_ip_geo_service
    
    service = get_ip_geo_service()
    try:
        info = await service.query_single(ip)
        return IPGeoResponse(success=True, data=info.to_dict())
    except Exception as e:
        raise InvalidParamsError(message=f"查询 IP 地理位置失败: {str(e)}")


@router.post("/geo/batch", response_model=IPGeoResponse)
async def get_ip_geo_batch(
    request: IPGeoBatchRequest,
    _: str = Depends(verify_auth),
):
    """Get geographic information for multiple IP addresses (max 100)."""
    from .ip_geo_service import get_ip_geo_service
    
    if len(request.ips) > 100:
        raise InvalidParamsError(message="最多支持 100 个 IP 批量查询")
    
    service = get_ip_geo_service()
    try:
        results = await service.query_batch(request.ips)
        return IPGeoResponse(
            success=True,
            data={
                "items": {ip: info.to_dict() for ip, info in results.items()},
                "total": len(results),
            }
        )
    except Exception as e:
        raise InvalidParamsError(message=f"批量查询 IP 地理位置失败: {str(e)}")

"""
API Routes for NewAPI Middleware Tool.
Implements redemption code generation, listing, and deletion endpoints.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from .auth import verify_auth
from .expiration_calculator import ExpireMode
from .main import InvalidParamsError, NotFoundError
from .quota_calculator import QuotaMode
from .redemption_service import (
    GenerateParams,
    ListParams,
    RedemptionStatus,
    get_redemption_service,
)
from .logger import logger

router = APIRouter(prefix="/api", tags=["Redemptions"])


# Request/Response Models

class GenerateRequest(BaseModel):
    """Request model for generating redemption codes."""
    name: str = Field(..., description="兑换码名称")
    count: int = Field(..., ge=1, le=1000, description="生成数量 (1-1000)")
    key_prefix: Optional[str] = Field(default="", max_length=20, description="Key 前缀 (max 20 chars)")
    quota_mode: QuotaMode = Field(default=QuotaMode.FIXED, description="额度模式")
    fixed_amount: Optional[float] = Field(default=None, ge=0, description="固定额度 (USD)")
    min_amount: Optional[float] = Field(default=None, ge=0, description="最小额度 (USD)")
    max_amount: Optional[float] = Field(default=None, ge=0, description="最大额度 (USD)")
    expire_mode: ExpireMode = Field(default=ExpireMode.NEVER, description="过期模式")
    expire_days: Optional[int] = Field(default=None, ge=0, description="过期天数")
    expire_date: Optional[str] = Field(default=None, description="过期日期 (ISO 8601)")


class GenerateResponseData(BaseModel):
    """Data model for generate response."""
    keys: List[str]
    count: int


class GenerateResponse(BaseModel):
    """Response model for generating redemption codes."""
    success: bool
    message: str
    data: Optional[GenerateResponseData] = None


class RedemptionCodeResponse(BaseModel):
    """Response model for a single redemption code."""
    id: int
    key: str
    name: str
    quota: int
    created_time: int
    redeemed_time: int
    used_user_id: int
    used_username: str = ""
    expired_time: int
    status: str


class ListResponseData(BaseModel):
    """Data model for list response."""
    items: List[RedemptionCodeResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class ListResponse(BaseModel):
    """Response model for listing redemption codes."""
    success: bool
    data: ListResponseData


class DeleteResponse(BaseModel):
    """Response model for deleting redemption codes."""
    success: bool
    message: str


class BatchDeleteRequest(BaseModel):
    """Request model for batch deletion."""
    ids: List[int] = Field(..., min_length=1, description="要删除的兑换码 ID 列表")


class RedemptionStatisticsData(BaseModel):
    """Data model for redemption statistics."""
    total_count: int
    unused_count: int
    used_count: int
    expired_count: int
    total_quota: int
    unused_quota: int
    used_quota: int
    expired_quota: int


class StatisticsResponse(BaseModel):
    """Response model for redemption statistics."""
    success: bool
    data: RedemptionStatisticsData


# API Endpoints

@router.post("/redemptions/generate", response_model=GenerateResponse)
async def generate_redemption_codes(request: GenerateRequest, _: str = Depends(verify_auth)):
    """
    批量生成兑换码。
    
    - **name**: 兑换码名称
    - **count**: 生成数量 (1-1000)
    - **key_prefix**: Key 前缀 (可选, max 20 chars)
    - **quota_mode**: 额度模式 (fixed/random)
    - **fixed_amount**: 固定额度 (USD, quota_mode=fixed 时必填)
    - **min_amount**: 最小额度 (USD, quota_mode=random 时必填)
    - **max_amount**: 最大额度 (USD, quota_mode=random 时必填)
    - **expire_mode**: 过期模式 (never/days/date)
    - **expire_days**: 过期天数 (expire_mode=days 时必填)
    - **expire_date**: 过期日期 ISO 8601 (expire_mode=date 时必填)
    """
    try:
        # Convert request to GenerateParams
        params = GenerateParams(
            name=request.name,
            count=request.count,
            key_prefix=request.key_prefix or "",
            quota_mode=request.quota_mode,
            fixed_amount=request.fixed_amount,
            min_amount=request.min_amount,
            max_amount=request.max_amount,
            expire_mode=request.expire_mode,
            expire_days=request.expire_days,
            expire_date=request.expire_date,
        )
        
        service = get_redemption_service()
        result = service.generate_codes(params)

        if result.success:
            quota_str = f"${request.fixed_amount}" if request.quota_mode == QuotaMode.FIXED else f"${request.min_amount}-${request.max_amount}"
            logger.business("兑换码生成", name=request.name, count=result.count, quota=quota_str)

        return GenerateResponse(
            success=result.success,
            message=result.message,
            data=GenerateResponseData(
                keys=result.keys,
                count=result.count,
            ) if result.success else None,
        )
        
    except ValueError as e:
        raise InvalidParamsError(message=str(e))


@router.get("/redemptions/statistics", response_model=StatisticsResponse)
async def get_redemption_statistics(
    start_date: Optional[str] = Query(default=None, description="起始日期 (ISO 8601)"),
    end_date: Optional[str] = Query(default=None, description="结束日期 (ISO 8601)"),
    _: str = Depends(verify_auth),
):
    """
    获取兑换码统计数据。
    
    - **start_date**: 起始日期
    - **end_date**: 结束日期
    """
    try:
        service = get_redemption_service()
        stats = service.get_statistics(start_date, end_date)
        
        return StatisticsResponse(
            success=True,
            data=RedemptionStatisticsData(
                total_count=stats.total_count,
                unused_count=stats.unused_count,
                used_count=stats.used_count,
                expired_count=stats.expired_count,
                total_quota=stats.total_quota,
                unused_quota=stats.unused_quota,
                used_quota=stats.used_quota,
                expired_quota=stats.expired_quota,
            ),
        )
    except ValueError as e:
        raise InvalidParamsError(message=str(e))


@router.get("/redemptions", response_model=ListResponse)
async def list_redemption_codes(
    page: int = Query(default=1, ge=1, description="页码"),
    page_size: int = Query(default=20, ge=1, le=100, description="每页数量"),
    name: Optional[str] = Query(default=None, description="名称筛选"),
    status: Optional[RedemptionStatus] = Query(default=None, description="状态筛选"),
    start_date: Optional[str] = Query(default=None, description="创建时间起始 (ISO 8601)"),
    end_date: Optional[str] = Query(default=None, description="创建时间结束 (ISO 8601)"),
    _: str = Depends(verify_auth),
):
    """
    查询兑换码列表，支持分页和筛选。
    
    - **page**: 页码 (default: 1)
    - **page_size**: 每页数量 (default: 20, max: 100)
    - **name**: 名称筛选 (模糊匹配)
    - **status**: 状态筛选 (unused/used/expired)
    - **start_date**: 创建时间起始
    - **end_date**: 创建时间结束
    """
    try:
        params = ListParams(
            page=page,
            page_size=page_size,
            name=name,
            status=status,
            start_date=start_date,
            end_date=end_date,
        )
        
        service = get_redemption_service()
        result = service.list_codes(params)
        
        return ListResponse(
            success=True,
            data=ListResponseData(
                items=[
                    RedemptionCodeResponse(
                        id=item.id,
                        key=item.key,
                        name=item.name,
                        quota=item.quota,
                        created_time=item.created_time,
                        redeemed_time=item.redeemed_time,
                        used_user_id=item.used_user_id,
                        used_username=item.used_username,
                        expired_time=item.expired_time,
                        status=item.status.value,
                    )
                    for item in result.items
                ],
                total=result.total,
                page=result.page,
                page_size=result.page_size,
                total_pages=result.total_pages,
            ),
        )
        
    except ValueError as e:
        raise InvalidParamsError(message=str(e))


@router.delete("/redemptions/batch", response_model=DeleteResponse)
async def batch_delete_redemption_codes(request: BatchDeleteRequest, _: str = Depends(verify_auth)):
    """
    批量删除兑换码（软删除）。
    
    - **ids**: 要删除的兑换码 ID 列表
    """
    try:
        service = get_redemption_service()
        success = service.delete_codes(request.ids)

        if success:
            logger.business("批量删除兑换码", count=len(request.ids))

        return DeleteResponse(
            success=success,
            message=f"Successfully deleted {len(request.ids)} redemption codes" if success else "No redemption codes were deleted",
        )
        
    except ValueError as e:
        raise InvalidParamsError(message=str(e))


@router.delete("/redemptions/{id}", response_model=DeleteResponse)
async def delete_redemption_code(id: int, _: str = Depends(verify_auth)):
    """
    删除单个兑换码（软删除）。
    
    - **id**: 兑换码 ID
    """
    service = get_redemption_service()
    
    # Check if code exists
    code = service.get_code_by_id(id)
    if not code:
        raise NotFoundError(message=f"Redemption code with id {id} not found")
    
    success = service.delete_code(id)

    if success:
        logger.business("删除兑换码", id=id)

    return DeleteResponse(
        success=success,
        message=f"Successfully deleted redemption code {id}" if success else f"Failed to delete redemption code {id}",
    )

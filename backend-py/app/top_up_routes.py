"""
Top Up API Routes for NewAPI Middleware Tool.
Implements top up record listing and statistics endpoints.
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from .auth import verify_auth
from .main import InvalidParamsError
from .top_up_service import (
    ListTopUpParams,
    TopUpStatistics,
    TopUpStatus,
    get_top_up_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/top-ups", tags=["Top Ups"])


# Response Models

class TopUpRecordResponse(BaseModel):
    """Response model for a single top up record."""
    id: int
    user_id: int
    username: Optional[str] = None
    amount: int
    money: float
    trade_no: str
    payment_method: str
    create_time: int
    complete_time: int
    status: str


class TopUpListResponseData(BaseModel):
    """Data model for list response."""
    items: List[TopUpRecordResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class TopUpListResponse(BaseModel):
    """Response model for listing top up records."""
    success: bool
    data: TopUpListResponseData


class TopUpStatisticsResponse(BaseModel):
    """Response model for top up statistics."""
    success: bool
    data: dict


class PaymentMethodsResponse(BaseModel):
    """Response model for payment methods list."""
    success: bool
    data: List[str]


# API Endpoints

@router.get("", response_model=TopUpListResponse)
async def list_top_ups(
    page: int = Query(default=1, ge=1, description="页码"),
    page_size: int = Query(default=20, ge=1, le=100, description="每页数量"),
    user_id: Optional[int] = Query(default=None, description="用户ID筛选"),
    status: Optional[TopUpStatus] = Query(default=None, description="状态筛选"),
    payment_method: Optional[str] = Query(default=None, description="支付方式筛选"),
    trade_no: Optional[str] = Query(default=None, description="交易号搜索"),
    start_date: Optional[str] = Query(default=None, description="创建时间起始 (ISO 8601)"),
    end_date: Optional[str] = Query(default=None, description="创建时间结束 (ISO 8601)"),
    _: str = Depends(verify_auth),
):
    """
    查询充值记录列表，支持分页和筛选。

    - **page**: 页码 (default: 1)
    - **page_size**: 每页数量 (default: 20, max: 100)
    - **user_id**: 用户ID筛选
    - **status**: 状态筛选 (pending/success/failed)
    - **payment_method**: 支付方式筛选
    - **trade_no**: 交易号搜索 (模糊匹配)
    - **start_date**: 创建时间起始
    - **end_date**: 创建时间结束
    """
    try:
        params = ListTopUpParams(
            page=page,
            page_size=page_size,
            user_id=user_id,
            status=status,
            payment_method=payment_method,
            trade_no=trade_no,
            start_date=start_date,
            end_date=end_date,
        )

        service = get_top_up_service()
        result = service.list_records(params)

        return TopUpListResponse(
            success=True,
            data=TopUpListResponseData(
                items=[
                    TopUpRecordResponse(
                        id=item.id,
                        user_id=item.user_id,
                        username=item.username,
                        amount=item.amount,
                        money=item.money,
                        trade_no=item.trade_no,
                        payment_method=item.payment_method,
                        create_time=item.create_time,
                        complete_time=item.complete_time,
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


@router.get("/statistics", response_model=TopUpStatisticsResponse)
async def get_top_up_statistics(
    start_date: Optional[str] = Query(default=None, description="统计起始时间 (ISO 8601)"),
    end_date: Optional[str] = Query(default=None, description="统计结束时间 (ISO 8601)"),
    _: str = Depends(verify_auth),
):
    """
    获取充值统计数据。

    - **start_date**: 统计起始时间
    - **end_date**: 统计结束时间
    """
    try:
        service = get_top_up_service()
        stats = service.get_statistics(start_date=start_date, end_date=end_date)

        return TopUpStatisticsResponse(
            success=True,
            data={
                "total_count": stats.total_count,
                "total_amount": stats.total_amount,
                "total_money": stats.total_money,
                "success_count": stats.success_count,
                "success_amount": stats.success_amount,
                "success_money": stats.success_money,
                "pending_count": stats.pending_count,
                "pending_amount": stats.pending_amount,
                "pending_money": stats.pending_money,
                "failed_count": stats.failed_count,
                "failed_amount": stats.failed_amount,
                "failed_money": stats.failed_money,
            },
        )

    except ValueError as e:
        raise InvalidParamsError(message=str(e))


@router.get("/payment-methods", response_model=PaymentMethodsResponse)
async def get_payment_methods(
    _: str = Depends(verify_auth),
):
    """
    获取所有支付方式列表。
    """
    service = get_top_up_service()
    methods = service.get_payment_methods()

    return PaymentMethodsResponse(
        success=True,
        data=methods,
    )


@router.get("/{id}", response_model=dict)
async def get_top_up_record(
    id: int,
    _: str = Depends(verify_auth),
):
    """
    获取单个充值记录详情。

    - **id**: 充值记录 ID
    """
    from .main import NotFoundError

    service = get_top_up_service()
    record = service.get_record_by_id(id)

    if not record:
        raise NotFoundError(message=f"Top up record with id {id} not found")

    return {
        "success": True,
        "data": TopUpRecordResponse(
            id=record.id,
            user_id=record.user_id,
            username=record.username,
            amount=record.amount,
            money=record.money,
            trade_no=record.trade_no,
            payment_method=record.payment_method,
            create_time=record.create_time,
            complete_time=record.complete_time,
            status=record.status.value,
        ),
    }

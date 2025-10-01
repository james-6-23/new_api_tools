"""
Redemptions API 路由
"""
from fastapi import APIRouter, Query

router = APIRouter()


@router.get("/")
async def get_redemptions(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200)
):
    """获取兑换码列表"""
    # TODO: 实现兑换码查询逻辑
    return {
        "page": page,
        "page_size": page_size,
        "total": 0,
        "items": []
    }


@router.post("/")
async def create_redemption():
    """创建兑换码"""
    # TODO: 实现创建兑换码逻辑
    return {"message": "Create redemption not implemented yet"}


@router.post("/batch")
async def create_batch_redemptions():
    """批量创建兑换码"""
    # TODO: 实现批量创建逻辑
    return {"message": "Batch create not implemented yet"}



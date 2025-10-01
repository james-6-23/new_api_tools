"""
Users API 路由
"""
from fastapi import APIRouter, Query

router = APIRouter()


@router.get("/")
async def get_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200)
):
    """获取用户列表"""
    # TODO: 实现用户查询逻辑
    return {
        "page": page,
        "page_size": page_size,
        "total": 0,
        "items": []
    }


@router.get("/{user_id}")
async def get_user_detail(user_id: int):
    """获取用户详情"""
    # TODO: 实现用户详情查询
    return {
        "id": user_id,
        "message": "User detail not implemented yet"
    }


@router.put("/{user_id}/quota")
async def update_user_quota(user_id: int):
    """更新用户配额"""
    # TODO: 实现配额更新逻辑
    return {"message": f"Update quota for user {user_id} not implemented yet"}



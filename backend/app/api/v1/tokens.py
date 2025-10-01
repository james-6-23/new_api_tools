"""
Tokens API 路由
"""
from fastapi import APIRouter, Query

router = APIRouter()


@router.get("/")
async def get_tokens(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200)
):
    """获取 Token 列表"""
    # TODO: 实现 Token 查询逻辑
    return {
        "page": page,
        "page_size": page_size,
        "total": 0,
        "items": []
    }


@router.post("/")
async def create_token():
    """创建 Token"""
    # TODO: 实现创建 Token 逻辑
    return {"message": "Create token not implemented yet"}


@router.delete("/{token_id}")
async def delete_token(token_id: int):
    """删除 Token"""
    # TODO: 实现删除 Token 逻辑
    return {"message": f"Delete token {token_id} not implemented yet"}


@router.get("/{token_id}/stats")
async def get_token_stats(token_id: int):
    """获取 Token 使用统计"""
    # TODO: 实现 Token 统计逻辑
    return {
        "token_id": token_id,
        "stats": {}
    }



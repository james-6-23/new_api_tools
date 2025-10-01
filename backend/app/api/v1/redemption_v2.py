"""
兑换码管理 API - 精简版
"""
from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel, Field
from typing import Literal
import random
import string
from app.services.newapi_client import NewAPIClient

router = APIRouter()


class BatchRedemptionCreate(BaseModel):
    """批量创建兑换码请求"""
    count: int = Field(..., ge=1, le=1000, description="生成数量")
    quota_type: Literal['fixed', 'random'] = Field(..., description="额度类型")
    fixed_quota: int = Field(None, ge=0, description="固定额度")
    min_quota: int = Field(None, ge=0, description="最小额度")
    max_quota: int = Field(None, ge=0, description="最大额度")
    expired_time: int = Field(0, description="过期时间戳，0表示永不过期")
    name_prefix: str = Field("Redemption", max_length=50, description="名称前缀")


@router.post("/batch")
async def create_batch_redemptions(request: BatchRedemptionCreate = Body(...)):
    """
    批量生成兑换码
    
    支持：
    - 固定额度：所有兑换码相同额度
    - 随机额度：在指定范围内随机生成
    """
    # 验证参数
    if request.quota_type == 'fixed' and request.fixed_quota is None:
        raise HTTPException(400, "固定额度模式必须提供 fixed_quota")
    
    if request.quota_type == 'random':
        if request.min_quota is None or request.max_quota is None:
            raise HTTPException(400, "随机额度模式必须提供 min_quota 和 max_quota")
        if request.min_quota > request.max_quota:
            raise HTTPException(400, "min_quota 不能大于 max_quota")
    
    client = NewAPIClient()
    results = []
    failed = []
    
    # 批量生成
    for i in range(request.count):
        try:
            # 计算额度
            if request.quota_type == 'fixed':
                quota = request.fixed_quota
            else:
                quota = random.randint(request.min_quota, request.max_quota)
            
            # 生成随机 key（16位字母数字组合）
            key = ''.join(random.choices(
                string.ascii_letters + string.digits, k=16
            ))
            
            # 调用 NewAPI 创建兑换码
            result = await client.create_redemption(
                quota=quota,
                count=1,
                expired_time=request.expired_time,
                name=f"{request.name_prefix}_{i+1:04d}",
                key=key
            )
            
            results.append({
                'name': f"{request.name_prefix}_{i+1:04d}",
                'key': key,
                'quota': quota,
                'result': result
            })
        
        except Exception as e:
            failed.append({
                'index': i,
                'error': str(e)
            })
    
    return {
        'success': True,
        'total': request.count,
        'created': len(results),
        'failed': len(failed),
        'redemptions': results,
        'errors': failed if failed else None
    }


@router.get("/list")
async def get_redemption_list(
    page: int = 1,
    page_size: int = 50
):
    """获取兑换码列表"""
    client = NewAPIClient()
    
    try:
        result = await client.get_redemptions(page, page_size)
        return result
    except Exception as e:
        raise HTTPException(500, f"获取兑换码列表失败: {str(e)}")


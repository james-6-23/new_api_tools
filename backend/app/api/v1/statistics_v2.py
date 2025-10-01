"""
统计分析 API - 精简版
"""
from fastapi import APIRouter, Query, HTTPException
from app.services.stats_calculator import StatsCalculator

router = APIRouter()


@router.get("/user-ranking")
async def get_user_ranking(
    metric: str = Query('requests', regex='^(requests|quota)$'),
    period: str = Query('week', regex='^(day|week|month)$'),
    limit: int = Query(10, ge=1, le=100)
):
    """
    获取用户排行榜
    
    参数：
    - metric: 'requests' (请求数) | 'quota' (额度消耗)
    - period: 'day' (1天) | 'week' (7天) | 'month' (30天)
    - limit: 返回数量
    
    返回：
    - 用户排行列表，包含请求数、额度、成功失败次数
    """
    try:
        calculator = StatsCalculator()
        ranking = await calculator.get_user_ranking(metric, period, limit)
        
        return {
            'success': True,
            'period': period,
            'metric': metric,
            'count': len(ranking),
            'ranking': ranking
        }
    except Exception as e:
        raise HTTPException(500, f"统计失败: {str(e)}")


@router.get("/model-stats")
async def get_model_stats(
    period: str = Query('day', regex='^(day|week|month)$')
):
    """
    获取模型统计
    
    参数：
    - period: 统计时间段
    
    返回：
    - 模型请求热度
    - 成功率/失败率
    - Token 消耗
    - 排行榜
    """
    try:
        calculator = StatsCalculator()
        stats = await calculator.get_model_stats(period)
        
        return {
            'success': True,
            'period': period,
            'count': len(stats),
            'models': stats
        }
    except Exception as e:
        raise HTTPException(500, f"统计失败: {str(e)}")


@router.get("/token-consumption")
async def get_token_consumption(
    period: str = Query('week', regex='^(day|week|month)$'),
    group_by: str = Query('total', regex='^(total|user|model)$')
):
    """
    获取 Token 消耗统计
    
    参数：
    - period: 统计时间段
    - group_by: 'total' (总计) | 'user' (按用户) | 'model' (按模型)
    
    返回：
    - prompt_tokens 总和
    - completion_tokens 总和
    - total_tokens 总和
    - 按维度分组的详细数据
    """
    try:
        calculator = StatsCalculator()
        stats = await calculator.get_token_consumption(period, group_by)
        
        return {
            'success': True,
            **stats
        }
    except Exception as e:
        raise HTTPException(500, f"统计失败: {str(e)}")


@router.get("/daily-trend")
async def get_daily_trend(
    days: int = Query(7, ge=1, le=90)
):
    """
    获取每日趋势
    
    参数：
    - days: 天数（1-90）
    
    返回：
    - 每天的请求数
    - 每天的 quota 消耗
    - 每天的 token 消耗
    - 成功率趋势
    """
    try:
        calculator = StatsCalculator()
        trend = await calculator.get_daily_trend(days)
        
        return {
            'success': True,
            'days': days,
            'data': trend
        }
    except Exception as e:
        raise HTTPException(500, f"统计失败: {str(e)}")


@router.get("/overview")
async def get_overview():
    """
    获取总览数据
    
    返回：
    - 今日、本周、本月的各项统计
    """
    try:
        calculator = StatsCalculator()
        
        # 并行获取多个统计
        day_tokens = await calculator.get_token_consumption('day', 'total')
        week_tokens = await calculator.get_token_consumption('week', 'total')
        month_tokens = await calculator.get_token_consumption('month', 'total')
        
        # 获取排行榜
        top_users = await calculator.get_user_ranking('quota', 'week', 5)
        top_models = await calculator.get_model_stats('day')
        
        return {
            'success': True,
            'today': {
                'requests': day_tokens['total_requests'],
                'quota': day_tokens['total_quota'],
                'tokens': day_tokens['total_tokens']
            },
            'week': {
                'requests': week_tokens['total_requests'],
                'quota': week_tokens['total_quota'],
                'tokens': week_tokens['total_tokens']
            },
            'month': {
                'requests': month_tokens['total_requests'],
                'quota': month_tokens['total_quota'],
                'tokens': month_tokens['total_tokens']
            },
            'top_users': top_users[:5],
            'top_models': top_models[:5]
        }
    except Exception as e:
        raise HTTPException(500, f"获取总览失败: {str(e)}")


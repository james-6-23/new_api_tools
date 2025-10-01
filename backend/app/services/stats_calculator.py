"""
统计计算服务
基于 NewAPI 日志数据进行统计分析
优化版：高效处理大量JSON数据
"""
from typing import List, Dict, Any
from datetime import datetime, timedelta
from collections import defaultdict
from app.services.newapi_client import NewAPIClient
from app.services.json_optimizer import (
    JSONOptimizer, 
    fast_count_by_field, 
    fast_sum_by_group
)


class StatsCalculator:
    """统计计算器"""
    
    def __init__(self):
        self.client = NewAPIClient()
    
    def _get_time_range(self, period: str) -> tuple[int, int]:
        """
        获取时间范围
        
        period: 'day' | 'week' | 'month'
        返回: (start_timestamp, end_timestamp)
        """
        end_time = datetime.now()
        
        if period == 'day':
            start_time = end_time - timedelta(days=1)
        elif period == 'week':
            start_time = end_time - timedelta(weeks=1)
        elif period == 'month':
            start_time = end_time - timedelta(days=30)
        else:
            start_time = end_time - timedelta(weeks=1)  # 默认一周
        
        return int(start_time.timestamp()), int(end_time.timestamp())
    
    async def get_user_ranking(
        self,
        metric: str = 'requests',
        period: str = 'week',
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        获取用户排行榜（优化版）
        
        metric: 'requests' | 'quota'
        period: 'day' | 'week' | 'month'
        
        性能优化：
        - 使用快速聚合函数
        - 减少循环次数
        - 只处理必要字段
        """
        start_ts, end_ts = self._get_time_range(period)
        
        # 获取日志
        logs = await self.client.get_all_logs_in_range(start_ts, end_ts)
        
        # 优化的数据处理 - 只提取需要的字段
        processed_logs = JSONOptimizer.batch_process_logs(
            logs,
            extract_fields=['username', 'user_id', 'quota', 'type']
        )
        
        # 快速统计
        user_stats = defaultdict(lambda: {
            'username': '',
            'user_id': 0,
            'requests': 0,
            'quota': 0,
            'success_requests': 0,
            'failed_requests': 0
        })
        
        # 单次遍历完成所有统计
        for log in processed_logs:
            username = log.get('username', 'unknown')
            user_id = log.get('user_id', 0)
            
            stats = user_stats[username]
            stats['username'] = username
            stats['user_id'] = user_id
            stats['requests'] += 1
            stats['quota'] += log.get('quota', 0)
            
            if log.get('type') == 2:  # 成功
                stats['success_requests'] += 1
            else:
                stats['failed_requests'] += 1
        
        # 排序并限制数量
        ranking = sorted(
            user_stats.values(),
            key=lambda x: x[metric],
            reverse=True
        )[:limit]
        
        # 添加排名
        for idx, item in enumerate(ranking, 1):
            item['rank'] = idx
        
        return ranking
    
    async def get_model_stats(
        self,
        period: str = 'day'
    ) -> List[Dict[str, Any]]:
        """
        获取模型统计（优化版）
        
        返回：模型请求热度、成功率等
        
        性能优化：
        - 批量处理日志数据
        - 使用更高效的数据结构
        - 减少重复计算
        """
        start_ts, end_ts = self._get_time_range(period)
        
        # 获取日志
        logs = await self.client.get_all_logs_in_range(start_ts, end_ts)
        
        # 优化：只提取需要的字段
        processed_logs = JSONOptimizer.batch_process_logs(
            logs,
            extract_fields=['model_name', 'type', 'quota', 'prompt_tokens', 'completion_tokens']
        )
        
        # 快速统计 - 使用字典避免重复初始化
        model_stats = defaultdict(lambda: {
            'model_name': '',
            'total_requests': 0,
            'success_requests': 0,
            'failed_requests': 0,
            'total_quota': 0,
            'prompt_tokens': 0,
            'completion_tokens': 0
        })
        
        # 单次遍历完成所有统计
        for log in processed_logs:
            model = log.get('model_name', 'unknown')
            stats = model_stats[model]
            
            stats['model_name'] = model
            stats['total_requests'] += 1
            stats['total_quota'] += log.get('quota', 0)
            stats['prompt_tokens'] += log.get('prompt_tokens', 0)
            stats['completion_tokens'] += log.get('completion_tokens', 0)
            
            if log.get('type') == 2:
                stats['success_requests'] += 1
            else:
                stats['failed_requests'] += 1
        
        # 批量计算成功率和总 tokens
        for model in model_stats.values():
            total = model['total_requests']
            model['success_rate'] = round(
                (model['success_requests'] / total * 100) if total > 0 else 0.0, 2
            )
            model['total_tokens'] = (
                model['prompt_tokens'] + model['completion_tokens']
            )
        
        # 排序
        ranking = sorted(
            model_stats.values(),
            key=lambda x: x['total_requests'],
            reverse=True
        )
        
        # 添加排名
        for idx, item in enumerate(ranking, 1):
            item['rank'] = idx
        
        return ranking
    
    async def get_token_consumption(
        self,
        period: str = 'week',
        group_by: str = 'total'
    ) -> Dict[str, Any]:
        """
        获取 Token 消耗统计
        
        group_by: 'total' | 'user' | 'model'
        """
        start_ts, end_ts = self._get_time_range(period)
        
        # 获取日志
        logs = await self.client.get_all_logs_in_range(start_ts, end_ts)
        
        if group_by == 'total':
            # 总计
            total_prompt = sum(log.get('prompt_tokens', 0) for log in logs)
            total_completion = sum(log.get('completion_tokens', 0) for log in logs)
            total_requests = len(logs)
            total_quota = sum(log.get('quota', 0) for log in logs)
            
            return {
                'period': period,
                'total_requests': total_requests,
                'total_prompt_tokens': total_prompt,
                'total_completion_tokens': total_completion,
                'total_tokens': total_prompt + total_completion,
                'total_quota': total_quota,
                'start_time': datetime.fromtimestamp(start_ts).isoformat(),
                'end_time': datetime.fromtimestamp(end_ts).isoformat()
            }
        
        elif group_by == 'user':
            # 按用户统计
            user_tokens = defaultdict(lambda: {
                'username': '',
                'prompt_tokens': 0,
                'completion_tokens': 0,
                'requests': 0,
                'quota': 0
            })
            
            for log in logs:
                username = log.get('username', 'unknown')
                user_tokens[username]['username'] = username
                user_tokens[username]['prompt_tokens'] += log.get('prompt_tokens', 0)
                user_tokens[username]['completion_tokens'] += log.get('completion_tokens', 0)
                user_tokens[username]['requests'] += 1
                user_tokens[username]['quota'] += log.get('quota', 0)
            
            # 计算总和
            for user in user_tokens.values():
                user['total_tokens'] = (
                    user['prompt_tokens'] + user['completion_tokens']
                )
            
            ranking = sorted(
                user_tokens.values(),
                key=lambda x: x['total_tokens'],
                reverse=True
            )
            
            return {
                'period': period,
                'group_by': 'user',
                'data': ranking
            }
        
        else:  # model
            # 按模型统计
            model_tokens = defaultdict(lambda: {
                'model_name': '',
                'prompt_tokens': 0,
                'completion_tokens': 0,
                'requests': 0,
                'quota': 0
            })
            
            for log in logs:
                model = log.get('model_name', 'unknown')
                model_tokens[model]['model_name'] = model
                model_tokens[model]['prompt_tokens'] += log.get('prompt_tokens', 0)
                model_tokens[model]['completion_tokens'] += log.get('completion_tokens', 0)
                model_tokens[model]['requests'] += 1
                model_tokens[model]['quota'] += log.get('quota', 0)
            
            for model in model_tokens.values():
                model['total_tokens'] = (
                    model['prompt_tokens'] + model['completion_tokens']
                )
            
            ranking = sorted(
                model_tokens.values(),
                key=lambda x: x['total_tokens'],
                reverse=True
            )
            
            return {
                'period': period,
                'group_by': 'model',
                'data': ranking
            }
    
    async def get_daily_trend(
        self,
        days: int = 7
    ) -> List[Dict[str, Any]]:
        """
        获取每日趋势数据
        
        返回：每天的请求数、quota、token 消耗
        """
        end_time = datetime.now()
        start_time = end_time - timedelta(days=days)
        
        start_ts = int(start_time.timestamp())
        end_ts = int(end_time.timestamp())
        
        # 获取所有日志
        logs = await self.client.get_all_logs_in_range(start_ts, end_ts)
        
        # 按日期分组
        daily_stats = defaultdict(lambda: {
            'date': '',
            'requests': 0,
            'quota': 0,
            'prompt_tokens': 0,
            'completion_tokens': 0,
            'success_requests': 0,
            'failed_requests': 0
        })
        
        for log in logs:
            # 转换为日期
            log_time = datetime.fromtimestamp(log.get('created_at', 0))
            date_key = log_time.strftime('%Y-%m-%d')
            
            daily_stats[date_key]['date'] = date_key
            daily_stats[date_key]['requests'] += 1
            daily_stats[date_key]['quota'] += log.get('quota', 0)
            daily_stats[date_key]['prompt_tokens'] += log.get('prompt_tokens', 0)
            daily_stats[date_key]['completion_tokens'] += log.get('completion_tokens', 0)
            
            if log.get('type') == 2:
                daily_stats[date_key]['success_requests'] += 1
            else:
                daily_stats[date_key]['failed_requests'] += 1
        
        # 计算总 tokens
        for stats in daily_stats.values():
            stats['total_tokens'] = (
                stats['prompt_tokens'] + stats['completion_tokens']
            )
            
            # 计算成功率
            total = stats['requests']
            if total > 0:
                stats['success_rate'] = round(
                    stats['success_requests'] / total * 100, 2
                )
            else:
                stats['success_rate'] = 0.0
        
        # 按日期排序
        trend = sorted(daily_stats.values(), key=lambda x: x['date'])
        
        return trend


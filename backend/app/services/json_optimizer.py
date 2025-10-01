"""
JSON 数据优化处理器
高效处理大量 JSON 数据
"""
import json
from typing import Any, Dict, List, Optional
from functools import lru_cache
import asyncio
from collections import defaultdict


class JSONOptimizer:
    """JSON 数据优化处理器"""
    
    @staticmethod
    def parse_log_item(log: Dict[str, Any]) -> Dict[str, Any]:
        """
        优化的日志解析
        只提取需要的字段，避免处理不必要的数据
        """
        return {
            'id': log.get('id', 0),
            'user_id': log.get('user_id', 0),
            'username': log.get('username', ''),
            'model_name': log.get('model_name', ''),
            'type': log.get('type', 0),
            'quota': log.get('quota', 0),
            'prompt_tokens': log.get('prompt_tokens', 0),
            'completion_tokens': log.get('completion_tokens', 0),
            'created_at': log.get('created_at', 0),
        }
    
    @staticmethod
    def batch_process_logs(
        logs: List[Dict[str, Any]], 
        extract_fields: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        批量处理日志，只提取需要的字段
        
        性能优化：
        - 避免重复的字典访问
        - 使用列表推导式
        - 减少函数调用
        """
        if extract_fields:
            # 只提取指定字段
            return [
                {field: log.get(field) for field in extract_fields}
                for log in logs
            ]
        
        # 提取所有常用字段
        return [JSONOptimizer.parse_log_item(log) for log in logs]
    
    @staticmethod
    def aggregate_by_key(
        logs: List[Dict[str, Any]], 
        group_key: str,
        sum_fields: List[str]
    ) -> Dict[str, Dict[str, int]]:
        """
        高效聚合数据
        
        使用 defaultdict 避免重复的键检查
        """
        result = defaultdict(lambda: {field: 0 for field in sum_fields})
        result[group_key] = defaultdict(int)
        
        for log in logs:
            key = log.get(group_key, 'unknown')
            for field in sum_fields:
                result[key][field] += log.get(field, 0)
        
        return dict(result)
    
    @staticmethod
    async def process_large_dataset(
        logs: List[Dict[str, Any]],
        chunk_size: int = 1000
    ) -> List[Dict[str, Any]]:
        """
        异步处理大数据集
        
        分块处理，避免内存溢出
        """
        results = []
        
        for i in range(0, len(logs), chunk_size):
            chunk = logs[i:i + chunk_size]
            # 异步处理每个块
            processed = await asyncio.to_thread(
                JSONOptimizer.batch_process_logs, chunk
            )
            results.extend(processed)
        
        return results
    
    @staticmethod
    @lru_cache(maxsize=128)
    def calculate_stats(
        data_tuple: tuple
    ) -> Dict[str, Any]:
        """
        缓存统计计算结果
        
        使用 LRU 缓存避免重复计算
        注意：参数必须是可哈希的，所以使用 tuple
        """
        # 将 tuple 转回 list
        data = list(data_tuple)
        
        total = len(data)
        if total == 0:
            return {'total': 0, 'sum': 0, 'avg': 0}
        
        total_sum = sum(data)
        return {
            'total': total,
            'sum': total_sum,
            'avg': total_sum / total
        }


class StreamJSONProcessor:
    """流式 JSON 处理器 - 处理超大数据集"""
    
    @staticmethod
    async def process_stream(
        logs: List[Dict[str, Any]],
        processor_func,
        chunk_size: int = 500
    ):
        """
        流式处理 JSON 数据
        
        适用于非常大的数据集
        """
        for i in range(0, len(logs), chunk_size):
            chunk = logs[i:i + chunk_size]
            yield await asyncio.to_thread(processor_func, chunk)


# 快速统计辅助函数
def fast_count_by_field(
    logs: List[Dict[str, Any]], 
    field: str
) -> Dict[str, int]:
    """快速按字段计数"""
    counter = defaultdict(int)
    for log in logs:
        counter[log.get(field, 'unknown')] += 1
    return dict(counter)


def fast_sum_by_group(
    logs: List[Dict[str, Any]],
    group_field: str,
    sum_field: str
) -> Dict[str, int]:
    """快速按组求和"""
    result = defaultdict(int)
    for log in logs:
        key = log.get(group_field, 'unknown')
        result[key] += log.get(sum_field, 0)
    return dict(result)


def fast_filter_logs(
    logs: List[Dict[str, Any]],
    filters: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    快速过滤日志
    
    使用生成器表达式和 all() 提高性能
    """
    return [
        log for log in logs
        if all(log.get(k) == v for k, v in filters.items())
    ]


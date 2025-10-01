"""
NewAPI 客户端封装
直接调用现有的 NewAPI 接口
"""
import httpx
from typing import Optional, Dict, Any
from app.config import settings


class NewAPIClient:
    """NewAPI HTTP 客户端"""
    
    def __init__(self):
        self.base_url = settings.NEWAPI_BASE_URL
        self.session_cookie = settings.NEWAPI_SESSION
        self.user_id = settings.NEWAPI_USER_ID
        self.timeout = 30.0
    
    def _get_headers(self) -> Dict[str, str]:
        """构建请求头"""
        return {
            'Cookie': f'session={self.session_cookie}',
            'New-Api-User': self.user_id,
            'new-api-user': self.user_id,
            'Content-Type': 'application/json'
        }
    
    async def create_redemption(
        self,
        quota: int,
        count: int,
        expired_time: int,
        name: str,
        key: str
    ) -> Dict[str, Any]:
        """
        创建兑换码
        
        POST /api/redemption/
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/api/redemption/",
                json={
                    "quota": quota,
                    "count": count,
                    "expired_time": expired_time,
                    "name": name,
                    "key": key
                },
                headers=self._get_headers()
            )
            response.raise_for_status()
            return response.json()
    
    async def get_redemptions(
        self,
        page: int = 1,
        page_size: int = 50
    ) -> Dict[str, Any]:
        """
        获取兑换码列表
        
        GET /api/redemption/?p=2&page_size=50
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/api/redemption/",
                params={'p': page, 'page_size': page_size},
                headers=self._get_headers()
            )
            response.raise_for_status()
            return response.json()
    
    async def get_logs(
        self,
        page: int = 1,
        page_size: int = 1000,
        start_timestamp: Optional[int] = None,
        end_timestamp: Optional[int] = None,
        log_type: int = 0,
        username: str = '',
        token_name: str = '',
        model_name: str = '',
        channel: str = '',
        group: str = ''
    ) -> Dict[str, Any]:
        """
        获取日志
        
        GET /api/log/?p=1&page_size=1000&type=0&...
        """
        params = {
            'p': page,
            'page_size': page_size,
            'type': log_type,
            'username': username,
            'token_name': token_name,
            'model_name': model_name,
            'channel': channel,
            'group': group
        }
        
        if start_timestamp:
            params['start_timestamp'] = start_timestamp
        if end_timestamp:
            params['end_timestamp'] = end_timestamp
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/api/log/",
                params=params,
                headers=self._get_headers()
            )
            response.raise_for_status()
            return response.json()
    
    async def get_data(
        self,
        start_timestamp: int,
        end_timestamp: int,
        username: str = '',
        default_time: str = 'week'
    ) -> Dict[str, Any]:
        """
        获取使用数据（统计）
        
        GET /api/data/?username=&start_timestamp=xxx&end_timestamp=xxx&default_time=week
        """
        params = {
            'username': username,
            'start_timestamp': start_timestamp,
            'end_timestamp': end_timestamp,
            'default_time': default_time
        }
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/api/data/",
                params=params,
                headers=self._get_headers()
            )
            response.raise_for_status()
            return response.json()
    
    async def get_all_logs_in_range(
        self,
        start_timestamp: int,
        end_timestamp: int,
        **kwargs
    ) -> list:
        """
        获取时间范围内的所有日志（自动分页）
        """
        all_logs = []
        page = 1
        page_size = 1000
        
        while True:
            result = await self.get_logs(
                page=page,
                page_size=page_size,
                start_timestamp=start_timestamp,
                end_timestamp=end_timestamp,
                **kwargs
            )
            
            if not result.get('success'):
                break
            
            data = result.get('data', {})
            items = data.get('items', [])
            
            if not items:
                break
            
            all_logs.extend(items)
            
            # 检查是否还有更多数据
            total = data.get('total', 0)
            if len(all_logs) >= total:
                break
            
            page += 1
        
        return all_logs


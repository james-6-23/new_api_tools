"""
IP 地理位置查询服务 - NewAPI Middleware Tool

使用 ip-api.com 免费 API 查询 IP 地理位置信息。
支持批量查询、缓存和双栈用户检测。

限制：
- ip-api.com 免费版限制 45 次/分钟
- 批量查询最多 100 个 IP
"""
import time
import asyncio
import ipaddress
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum

import httpx

from .logger import logger
from .local_storage import get_local_storage


class IPVersion(Enum):
    """IP 版本"""
    V4 = "v4"
    V6 = "v6"
    UNKNOWN = "unknown"


@dataclass
class IPGeoInfo:
    """IP 地理位置信息"""
    ip: str
    version: IPVersion
    country: str
    country_code: str
    region: str
    city: str
    isp: str
    org: str
    asn: str  # AS 编号，如 "AS15169"
    success: bool
    cached: bool = False
    
    def get_location_key(self) -> str:
        """获取位置标识（用于判断是否同一位置）"""
        # 使用 ASN + 城市 作为位置标识
        return f"{self.asn}:{self.city}:{self.country_code}"
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "ip": self.ip,
            "version": self.version.value,
            "country": self.country,
            "country_code": self.country_code,
            "region": self.region,
            "city": self.city,
            "isp": self.isp,
            "org": self.org,
            "asn": self.asn,
            "success": self.success,
            "cached": self.cached,
        }


# 缓存配置
IP_GEO_CACHE_TTL = 24 * 3600  # 24小时缓存
IP_GEO_CACHE_PREFIX = "ip_geo:"

# API 配置
IP_API_URL = "http://ip-api.com/json/{ip}?fields=status,message,country,countryCode,region,regionName,city,isp,org,as,query"
IP_API_BATCH_URL = "http://ip-api.com/batch?fields=status,message,country,countryCode,region,regionName,city,isp,org,as,query"
IP_API_RATE_LIMIT = 45  # 每分钟请求数
IP_API_BATCH_SIZE = 100  # 批量查询最大数量


def get_ip_version(ip: str) -> IPVersion:
    """判断 IP 版本"""
    try:
        addr = ipaddress.ip_address(ip)
        if isinstance(addr, ipaddress.IPv4Address):
            return IPVersion.V4
        elif isinstance(addr, ipaddress.IPv6Address):
            return IPVersion.V6
    except ValueError:
        pass
    return IPVersion.UNKNOWN


def is_private_ip(ip: str) -> bool:
    """判断是否为私有 IP"""
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback or addr.is_reserved
    except ValueError:
        return False


class IPGeoService:
    """IP 地理位置查询服务"""
    
    def __init__(self):
        self._storage = get_local_storage()
        self._last_request_time = 0
        self._request_count = 0
        self._rate_limit_reset = 0
    
    def _get_cached(self, ip: str) -> Optional[IPGeoInfo]:
        """从缓存获取 IP 信息"""
        key = f"{IP_GEO_CACHE_PREFIX}{ip}"
        data = self._storage.cache_get(key)
        if data:
            return IPGeoInfo(
                ip=data.get("ip", ip),
                version=IPVersion(data.get("version", "unknown")),
                country=data.get("country", ""),
                country_code=data.get("country_code", ""),
                region=data.get("region", ""),
                city=data.get("city", ""),
                isp=data.get("isp", ""),
                org=data.get("org", ""),
                asn=data.get("asn", ""),
                success=data.get("success", False),
                cached=True,
            )
        return None
    
    def _set_cached(self, info: IPGeoInfo):
        """缓存 IP 信息"""
        key = f"{IP_GEO_CACHE_PREFIX}{info.ip}"
        self._storage.cache_set(key, {
            "ip": info.ip,
            "version": info.version.value,
            "country": info.country,
            "country_code": info.country_code,
            "region": info.region,
            "city": info.city,
            "isp": info.isp,
            "org": info.org,
            "asn": info.asn,
            "success": info.success,
        }, ttl=IP_GEO_CACHE_TTL)
    
    def _check_rate_limit(self) -> bool:
        """检查是否超过速率限制"""
        now = time.time()
        
        # 重置计数器（每分钟）
        if now - self._rate_limit_reset >= 60:
            self._request_count = 0
            self._rate_limit_reset = now
        
        return self._request_count < IP_API_RATE_LIMIT
    
    def _increment_request_count(self, count: int = 1):
        """增加请求计数"""
        self._request_count += count
    
    def _create_private_ip_info(self, ip: str) -> IPGeoInfo:
        """为私有 IP 创建信息"""
        return IPGeoInfo(
            ip=ip,
            version=get_ip_version(ip),
            country="Private",
            country_code="--",
            region="",
            city="Private Network",
            isp="Private",
            org="Private",
            asn="Private",
            success=True,
            cached=False,
        )
    
    def _create_failed_info(self, ip: str, reason: str = "") -> IPGeoInfo:
        """创建查询失败的信息"""
        return IPGeoInfo(
            ip=ip,
            version=get_ip_version(ip),
            country="",
            country_code="",
            region="",
            city=reason or "Query Failed",
            isp="",
            org="",
            asn="",
            success=False,
            cached=False,
        )
    
    async def query_single(self, ip: str) -> IPGeoInfo:
        """查询单个 IP 的地理位置"""
        # 检查缓存
        cached = self._get_cached(ip)
        if cached:
            return cached
        
        # 私有 IP 不查询
        if is_private_ip(ip):
            info = self._create_private_ip_info(ip)
            self._set_cached(info)
            return info
        
        # 检查速率限制
        if not self._check_rate_limit():
            logger.warning(f"IP 地理位置查询速率限制，跳过: {ip}")
            return self._create_failed_info(ip, "Rate Limited")
        
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                url = IP_API_URL.format(ip=ip)
                response = await client.get(url)
                response.raise_for_status()
                data = response.json()
                
                self._increment_request_count()
                
                if data.get("status") == "success":
                    info = IPGeoInfo(
                        ip=ip,
                        version=get_ip_version(ip),
                        country=data.get("country", ""),
                        country_code=data.get("countryCode", ""),
                        region=data.get("regionName", ""),
                        city=data.get("city", ""),
                        isp=data.get("isp", ""),
                        org=data.get("org", ""),
                        asn=data.get("as", "").split()[0] if data.get("as") else "",
                        success=True,
                    )
                    self._set_cached(info)
                    return info
                else:
                    return self._create_failed_info(ip, data.get("message", "Unknown"))
                    
        except Exception as e:
            logger.warning(f"IP 地理位置查询失败 {ip}: {e}")
            return self._create_failed_info(ip, str(e))
    
    async def query_batch(self, ips: List[str]) -> Dict[str, IPGeoInfo]:
        """批量查询 IP 地理位置"""
        results: Dict[str, IPGeoInfo] = {}
        to_query: List[str] = []
        
        # 先检查缓存和私有 IP
        for ip in ips:
            if not ip:
                continue
                
            # 检查缓存
            cached = self._get_cached(ip)
            if cached:
                results[ip] = cached
                continue
            
            # 私有 IP
            if is_private_ip(ip):
                info = self._create_private_ip_info(ip)
                self._set_cached(info)
                results[ip] = info
                continue
            
            to_query.append(ip)
        
        # 没有需要查询的
        if not to_query:
            return results
        
        # 检查速率限制
        if not self._check_rate_limit():
            logger.warning(f"IP 地理位置查询速率限制，跳过 {len(to_query)} 个 IP")
            for ip in to_query:
                results[ip] = self._create_failed_info(ip, "Rate Limited")
            return results
        
        # 分批查询
        for i in range(0, len(to_query), IP_API_BATCH_SIZE):
            batch = to_query[i:i + IP_API_BATCH_SIZE]
            
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    payload = [{"query": ip} for ip in batch]
                    response = await client.post(IP_API_BATCH_URL, json=payload)
                    response.raise_for_status()
                    data_list = response.json()
                    
                    self._increment_request_count()
                    
                    for data in data_list:
                        ip = data.get("query", "")
                        if not ip:
                            continue
                        
                        if data.get("status") == "success":
                            info = IPGeoInfo(
                                ip=ip,
                                version=get_ip_version(ip),
                                country=data.get("country", ""),
                                country_code=data.get("countryCode", ""),
                                region=data.get("regionName", ""),
                                city=data.get("city", ""),
                                isp=data.get("isp", ""),
                                org=data.get("org", ""),
                                asn=data.get("as", "").split()[0] if data.get("as") else "",
                                success=True,
                            )
                        else:
                            info = self._create_failed_info(ip, data.get("message", ""))
                        
                        self._set_cached(info)
                        results[ip] = info
                        
            except Exception as e:
                logger.warning(f"IP 批量查询失败: {e}")
                for ip in batch:
                    if ip not in results:
                        results[ip] = self._create_failed_info(ip, str(e))
            
            # 批次间延迟，避免触发速率限制
            if i + IP_API_BATCH_SIZE < len(to_query):
                await asyncio.sleep(1.5)
        
        return results
    
    def is_same_location(self, info1: IPGeoInfo, info2: IPGeoInfo) -> bool:
        """判断两个 IP 是否来自同一位置"""
        if not info1.success or not info2.success:
            return False
        
        # 使用 ASN + 城市 判断
        return info1.get_location_key() == info2.get_location_key()
    
    def is_dual_stack_pair(self, ip1: str, ip2: str, info1: Optional[IPGeoInfo] = None, info2: Optional[IPGeoInfo] = None) -> bool:
        """
        判断两个 IP 是否为双栈配对（同一位置的 IPv4 和 IPv6）
        
        Args:
            ip1: 第一个 IP
            ip2: 第二个 IP
            info1: 第一个 IP 的地理信息（可选，避免重复查询）
            info2: 第二个 IP 的地理信息（可选）
        """
        v1 = get_ip_version(ip1)
        v2 = get_ip_version(ip2)
        
        # 必须是一个 v4 一个 v6
        if not ((v1 == IPVersion.V4 and v2 == IPVersion.V6) or 
                (v1 == IPVersion.V6 and v2 == IPVersion.V4)):
            return False
        
        # 如果没有地理信息，无法判断
        if not info1 or not info2:
            return False
        
        # 判断是否同一位置
        return self.is_same_location(info1, info2)


# 全局服务实例
_ip_geo_service: Optional[IPGeoService] = None


def get_ip_geo_service() -> IPGeoService:
    global _ip_geo_service
    if _ip_geo_service is None:
        _ip_geo_service = IPGeoService()
    return _ip_geo_service

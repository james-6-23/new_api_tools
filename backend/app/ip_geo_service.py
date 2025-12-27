"""
IP 地理位置查询服务 - NewAPI Middleware Tool

使用 MaxMind GeoLite2 本地数据库查询 IP 地理位置信息。
无需 API Key，无速率限制，完全离线运行。

数据库来源：https://github.com/adysec/IP_database
部署时自动下载，无需手动配置。
"""
import os
import ipaddress
from pathlib import Path
from typing import Any, Dict, List, Optional
from dataclasses import dataclass
from enum import Enum

from .logger import logger
from .local_storage import get_local_storage

# GeoIP2 库（可选依赖）
try:
    import geoip2.database
    import geoip2.errors
    GEOIP2_AVAILABLE = True
except ImportError:
    GEOIP2_AVAILABLE = False
    logger.warning("geoip2 库未安装，IP 地理位置查询功能将不可用")


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

# GeoIP 数据库路径配置
GEOIP_DATA_DIR = os.environ.get("GEOIP_DATA_DIR", "/app/data/geoip")
GEOIP_CITY_DB = os.path.join(GEOIP_DATA_DIR, "GeoLite2-City.mmdb")
GEOIP_ASN_DB = os.path.join(GEOIP_DATA_DIR, "GeoLite2-ASN.mmdb")


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
    """IP 地理位置查询服务 - 使用 MaxMind GeoLite2 本地数据库"""
    
    def __init__(self):
        self._storage = get_local_storage()
        self._city_reader: Optional["geoip2.database.Reader"] = None
        self._asn_reader: Optional["geoip2.database.Reader"] = None
        self._db_available = False
        self._init_databases()
    
    def _init_databases(self):
        """初始化 GeoIP 数据库"""
        if not GEOIP2_AVAILABLE:
            logger.warning("geoip2 库未安装，无法使用本地 GeoIP 数据库")
            return
        
        # 尝试加载 City 数据库
        if os.path.exists(GEOIP_CITY_DB):
            try:
                self._city_reader = geoip2.database.Reader(GEOIP_CITY_DB)
                logger.info(f"已加载 GeoLite2-City 数据库: {GEOIP_CITY_DB}")
            except Exception as e:
                logger.error(f"加载 GeoLite2-City 数据库失败: {e}")
        else:
            logger.warning(f"GeoLite2-City 数据库不存在: {GEOIP_CITY_DB}")
        
        # 尝试加载 ASN 数据库
        if os.path.exists(GEOIP_ASN_DB):
            try:
                self._asn_reader = geoip2.database.Reader(GEOIP_ASN_DB)
                logger.info(f"已加载 GeoLite2-ASN 数据库: {GEOIP_ASN_DB}")
            except Exception as e:
                logger.error(f"加载 GeoLite2-ASN 数据库失败: {e}")
        else:
            logger.warning(f"GeoLite2-ASN 数据库不存在: {GEOIP_ASN_DB}")
        
        self._db_available = self._city_reader is not None
        
        if not self._db_available:
            logger.warning(
                "GeoIP 数据库未找到，IP 地理位置查询功能不可用。\n"
                "请运行更新脚本自动下载，或手动下载到 data/geoip/ 目录"
            )
    
    def is_available(self) -> bool:
        """检查 GeoIP 服务是否可用"""
        return self._db_available
    
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
    
    def _query_local(self, ip: str) -> IPGeoInfo:
        """使用本地数据库查询 IP 信息"""
        country = ""
        country_code = ""
        region = ""
        city = ""
        isp = ""
        org = ""
        asn = ""
        
        # 查询 City 数据库
        if self._city_reader:
            try:
                response = self._city_reader.city(ip)
                country = response.country.name or ""
                country_code = response.country.iso_code or ""
                if response.subdivisions:
                    region = response.subdivisions.most_specific.name or ""
                city = response.city.name or ""
            except geoip2.errors.AddressNotFoundError:
                pass
            except Exception as e:
                logger.debug(f"City 数据库查询失败 {ip}: {e}")
        
        # 查询 ASN 数据库
        if self._asn_reader:
            try:
                response = self._asn_reader.asn(ip)
                asn = f"AS{response.autonomous_system_number}" if response.autonomous_system_number else ""
                org = response.autonomous_system_organization or ""
                isp = org  # ASN 数据库中 org 通常就是 ISP
            except geoip2.errors.AddressNotFoundError:
                pass
            except Exception as e:
                logger.debug(f"ASN 数据库查询失败 {ip}: {e}")
        
        # 只要有 country 信息就算成功
        success = bool(country_code)
        
        return IPGeoInfo(
            ip=ip,
            version=get_ip_version(ip),
            country=country,
            country_code=country_code,
            region=region,
            city=city,
            isp=isp,
            org=org,
            asn=asn,
            success=success,
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
        
        # 检查数据库是否可用
        if not self._db_available:
            return self._create_failed_info(ip, "GeoIP DB Not Available")
        
        # 本地查询（无速率限制）
        info = self._query_local(ip)
        if info.success:
            self._set_cached(info)
        
        return info
    
    async def query_batch(self, ips: List[str]) -> Dict[str, IPGeoInfo]:
        """批量查询 IP 地理位置（本地数据库，无速率限制）"""
        results: Dict[str, IPGeoInfo] = {}
        
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
            
            # 数据库不可用
            if not self._db_available:
                results[ip] = self._create_failed_info(ip, "GeoIP DB Not Available")
                continue
            
            # 本地查询
            info = self._query_local(ip)
            if info.success:
                self._set_cached(info)
            results[ip] = info
        
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
    
    def close(self):
        """关闭数据库连接"""
        if self._city_reader:
            self._city_reader.close()
            self._city_reader = None
        if self._asn_reader:
            self._asn_reader.close()
            self._asn_reader = None
        self._db_available = False


# 全局服务实例
_ip_geo_service: Optional[IPGeoService] = None


def get_ip_geo_service() -> IPGeoService:
    global _ip_geo_service
    if _ip_geo_service is None:
        _ip_geo_service = IPGeoService()
    return _ip_geo_service

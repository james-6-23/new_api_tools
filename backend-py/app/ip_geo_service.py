"""
IP 地理位置查询服务 - NewAPI Middleware Tool

使用 MaxMind GeoLite2 本地数据库查询 IP 地理位置信息。
无需 API Key，无速率限制，完全离线运行。

数据库来源：https://github.com/adysec/IP_database
部署时自动下载，每天自动更新。
"""
import os
import time
import asyncio
import ipaddress
import httpx
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
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

# GeoIP 数据库下载 URL
GEOIP_DOWNLOAD_URLS = {
    "city": [
        "https://raw.githubusercontent.com/adysec/IP_database/main/geolite/GeoLite2-City.mmdb",
        "https://raw.gitmirror.com/adysec/IP_database/main/geolite/GeoLite2-City.mmdb",
    ],
    "asn": [
        "https://raw.githubusercontent.com/adysec/IP_database/main/geolite/GeoLite2-ASN.mmdb",
        "https://raw.gitmirror.com/adysec/IP_database/main/geolite/GeoLite2-ASN.mmdb",
    ],
}

# 更新间隔（秒）- 默认 24 小时
GEOIP_UPDATE_INTERVAL = int(os.environ.get("GEOIP_UPDATE_INTERVAL", 86400))


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
                logger.success(f"GeoLite2-City 数据库已加载", path=GEOIP_CITY_DB)
            except Exception as e:
                logger.fail(f"GeoLite2-City 数据库加载失败", error=str(e))
        else:
            logger.warn(f"GeoLite2-City 数据库不存在: {GEOIP_CITY_DB}")

        # 尝试加载 ASN 数据库
        if os.path.exists(GEOIP_ASN_DB):
            try:
                self._asn_reader = geoip2.database.Reader(GEOIP_ASN_DB)
                logger.success(f"GeoLite2-ASN 数据库已加载", path=GEOIP_ASN_DB)
            except Exception as e:
                logger.fail(f"GeoLite2-ASN 数据库加载失败", error=str(e))
        else:
            logger.warn(f"GeoLite2-ASN 数据库不存在: {GEOIP_ASN_DB}")
        
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
    
    async def query_batch(self, ips: List[str], log_progress: bool = False) -> Dict[str, IPGeoInfo]:
        """
        批量查询 IP 地理位置（本地数据库，无速率限制）
        
        Args:
            ips: IP 地址列表
            log_progress: 是否输出进度日志
        """
        results: Dict[str, IPGeoInfo] = {}
        total = len(ips)
        cached_count = 0
        queried_count = 0
        private_count = 0
        
        if total == 0:
            return results
        
        # 进度日志间隔（每处理 500 个 IP 输出一次）
        progress_interval = 500
        last_progress = 0
        start_time = time.time()
        
        for idx, ip in enumerate(ips):
            if not ip:
                continue
            
            # 检查缓存
            cached = self._get_cached(ip)
            if cached:
                results[ip] = cached
                cached_count += 1
                continue
            
            # 私有 IP
            if is_private_ip(ip):
                info = self._create_private_ip_info(ip)
                self._set_cached(info)
                results[ip] = info
                private_count += 1
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
            queried_count += 1
            
            # 输出进度日志（包含预计剩余时间）
            if log_progress and (idx - last_progress) >= progress_interval:
                progress_pct = (idx + 1) / total * 100
                elapsed = time.time() - start_time
                if idx > 0:
                    remaining = elapsed / (idx + 1) * (total - idx - 1)
                    logger.system(f"[IP分布] GeoIP 查询进度: {idx + 1:,}/{total:,} ({progress_pct:.1f}%)，剩余约 {remaining:.0f}s")
                else:
                    logger.system(f"[IP分布] GeoIP 查询进度: {idx + 1:,}/{total:,} ({progress_pct:.1f}%)")
                last_progress = idx
                
                # 让出 CPU，避免阻塞其他任务
                await asyncio.sleep(0)
        
        # 最终进度日志
        if log_progress and total > 0:
            elapsed = time.time() - start_time
            logger.system(f"[IP分布] GeoIP 查询完成: 缓存命中 {cached_count:,}, 新查询 {queried_count:,}, 私有IP {private_count:,}, 耗时 {elapsed:.1f}s")
        
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
    
    def reload_databases(self):
        """重新加载数据库（更新后调用）"""
        self.close()
        self._init_databases()
    
    def get_db_info(self) -> Dict[str, Any]:
        """获取数据库信息"""
        info = {
            "available": self._db_available,
            "city_db": None,
            "asn_db": None,
        }
        
        if os.path.exists(GEOIP_CITY_DB):
            stat = os.stat(GEOIP_CITY_DB)
            info["city_db"] = {
                "path": GEOIP_CITY_DB,
                "size_mb": round(stat.st_size / (1024 * 1024), 2),
                "modified_time": int(stat.st_mtime),
            }
        
        if os.path.exists(GEOIP_ASN_DB):
            stat = os.stat(GEOIP_ASN_DB)
            info["asn_db"] = {
                "path": GEOIP_ASN_DB,
                "size_mb": round(stat.st_size / (1024 * 1024), 2),
                "modified_time": int(stat.st_mtime),
            }
        
        return info


async def download_geoip_database(db_type: str, force: bool = False) -> Tuple[bool, str]:
    """
    下载 GeoIP 数据库
    
    Args:
        db_type: 数据库类型 ("city" 或 "asn")
        force: 是否强制下载（忽略已存在的文件）
    
    Returns:
        (success, message)
    """
    if db_type not in GEOIP_DOWNLOAD_URLS:
        return False, f"未知的数据库类型: {db_type}"
    
    db_path = GEOIP_CITY_DB if db_type == "city" else GEOIP_ASN_DB
    db_name = "GeoLite2-City.mmdb" if db_type == "city" else "GeoLite2-ASN.mmdb"
    
    # 检查是否需要下载
    if not force and os.path.exists(db_path):
        stat = os.stat(db_path)
        age = time.time() - stat.st_mtime
        if age < GEOIP_UPDATE_INTERVAL:
            return True, f"{db_name} 已是最新（{int(age/3600)}小时前更新）"
    
    # 确保目录存在
    os.makedirs(GEOIP_DATA_DIR, exist_ok=True)
    
    # 尝试从多个 URL 下载
    urls = GEOIP_DOWNLOAD_URLS[db_type]
    temp_path = f"{db_path}.tmp"
    
    for url in urls:
        try:
            logger.info(f"[GeoIP] 正在下载 {db_name} 从 {url[:50]}...")
            
            async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
                response = await client.get(url)
                response.raise_for_status()
                
                # 写入临时文件
                with open(temp_path, "wb") as f:
                    f.write(response.content)
                
                # 验证文件大小（至少 1MB）
                if os.path.getsize(temp_path) < 1024 * 1024:
                    os.remove(temp_path)
                    logger.warning(f"[GeoIP] {db_name} 文件太小，可能下载不完整")
                    continue
                
                # 替换旧文件
                if os.path.exists(db_path):
                    os.remove(db_path)
                os.rename(temp_path, db_path)
                
                size_mb = round(os.path.getsize(db_path) / (1024 * 1024), 2)
                logger.info(f"[GeoIP] {db_name} 下载完成，大小: {size_mb}MB")
                return True, f"{db_name} 下载成功 ({size_mb}MB)"
                
        except Exception as e:
            logger.warning(f"[GeoIP] 从 {url[:50]}... 下载失败: {e}")
            if os.path.exists(temp_path):
                os.remove(temp_path)
            continue
    
    return False, f"{db_name} 下载失败，所有源都不可用"


async def update_all_geoip_databases(force: bool = False) -> Dict[str, Any]:
    """
    更新所有 GeoIP 数据库
    
    Args:
        force: 是否强制更新
    
    Returns:
        更新结果
    """
    results = {
        "success": True,
        "city": {"success": False, "message": ""},
        "asn": {"success": False, "message": ""},
    }
    
    # 下载 City 数据库
    success, message = await download_geoip_database("city", force)
    results["city"] = {"success": success, "message": message}
    if not success:
        results["success"] = False
    
    # 下载 ASN 数据库
    success, message = await download_geoip_database("asn", force)
    results["asn"] = {"success": success, "message": message}
    if not success:
        results["success"] = False
    
    # 如果有更新，重新加载数据库
    if results["city"]["success"] or results["asn"]["success"]:
        service = get_ip_geo_service()
        service.reload_databases()
        logger.info("[GeoIP] 数据库已重新加载")
    
    return results


# 全局服务实例
_ip_geo_service: Optional[IPGeoService] = None


def get_ip_geo_service() -> IPGeoService:
    global _ip_geo_service
    if _ip_geo_service is None:
        _ip_geo_service = IPGeoService()
    return _ip_geo_service

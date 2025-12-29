"""
IP 地区分布统计服务 - NewAPI Middleware Tool

统计 IP 访问的地区分布，支持按国家、省份、城市维度聚合。
使用缓存减少数据库和 GeoIP 查询压力。

优化策略：
1. SQL 使用 ip > '' 过滤空值，利用索引
2. 限制返回 IP 数量（最多 3000 个）
3. 结果缓存，避免重复查询
4. 预热采用延迟执行，不阻塞启动
"""
import asyncio
import time
from collections import defaultdict
from typing import Any, Dict, List, Optional

from .database import get_db_manager
from .ip_geo_service import get_ip_geo_service, IPGeoInfo
from .cache_manager import get_cache_manager
from .logger import logger


# 时间窗口映射（秒）
WINDOW_SECONDS = {
    "1h": 3600,
    "6h": 6 * 3600,
    "24h": 24 * 3600,
    "7d": 7 * 24 * 3600,
}

# 缓存 TTL（秒）
CACHE_TTL = {
    "1h": 300,      # 5 分钟
    "6h": 600,      # 10 分钟
    "24h": 1800,    # 30 分钟
    "7d": 3600,     # 1 小时
}

# 中国国内判断
DOMESTIC_COUNTRY_CODES = {"CN", "HK", "MO", "TW"}


class IPDistributionService:
    """IP 地区分布统计服务"""
    
    def __init__(self):
        self._db = get_db_manager()
        self._geo = get_ip_geo_service()
        self._cache = get_cache_manager()
    
    async def get_distribution(
        self,
        window: str = "24h",
        use_cache: bool = True,
        log_progress: bool = False,
    ) -> Dict[str, Any]:
        """
        获取 IP 地区分布统计
        
        Args:
            window: 时间窗口 (1h/6h/24h/7d)
            use_cache: 是否使用缓存
            log_progress: 是否输出进度日志
        
        Returns:
            {
                "total_ips": int,
                "total_requests": int,
                "domestic_percentage": float,
                "overseas_percentage": float,
                "by_country": [...],
                "by_province": [...],
                "top_cities": [...],
                "snapshot_time": int,
            }
        """
        cache_key = f"ip_dist:{window}"
        
        # 尝试从缓存获取
        if use_cache:
            cached = self._cache.get(cache_key)
            if cached:
                return cached
        
        # 获取时间范围
        window_seconds = WINDOW_SECONDS.get(window, 86400)
        start_time = int(time.time()) - window_seconds
        
        # 查询唯一 IP 及其请求数
        if log_progress:
            logger.system(f"[IP分布] 正在查询 {window} 窗口的 IP 数据...")
        
        # _query_ip_stats 是同步 DB 查询：放到线程池里跑，避免阻塞事件循环
        loop = asyncio.get_event_loop()
        ip_stats = await loop.run_in_executor(None, lambda: self._query_ip_stats(start_time))
        
        if not ip_stats:
            if log_progress:
                logger.system("[IP分布] 无 IP 数据")
            result = self._empty_result()
            ttl = CACHE_TTL.get(window, 1800)
            self._cache.set(cache_key, result, ttl=ttl)
            logger.success(
                f"IP分布 缓存更新: {window}",
                状态="空数据",
                TTL=f"{ttl}s"
            )
            return result
        
        total_ips = len(ip_stats)
        total_requests = sum(s["request_count"] for s in ip_stats.values())
        
        if log_progress:
            logger.system(f"[IP分布] 查询到 {total_ips:,} 个唯一 IP，共 {total_requests:,} 次请求")
            logger.system(f"[IP分布] 正在查询 IP 地理位置...")
        
        # 批量查询 IP 地理位置（带进度）
        ips = list(ip_stats.keys())
        geo_results = await self._geo.query_batch(ips, log_progress=log_progress)
        
        if log_progress:
            logger.system(f"[IP分布] 地理位置查询完成，正在聚合统计...")
        
        # 聚合统计
        result = self._aggregate_stats(ip_stats, geo_results)
        result["snapshot_time"] = int(time.time())

        # 缓存结果
        ttl = CACHE_TTL.get(window, 1800)
        self._cache.set(cache_key, result, ttl=ttl)
        logger.success(
            f"IP分布 缓存更新: {window}",
            IP数=total_ips,
            请求数=total_requests,
            国家数=len(result['by_country']),
            省份数=len(result['by_province']),
            TTL=f"{ttl}s"
        )

        if log_progress:
            logger.system(f"[IP分布] 统计完成: {len(result['by_country'])} 个国家, {len(result['by_province'])} 个省份")
        
        return result
    
    def _query_ip_stats(self, start_time: int) -> Dict[str, Dict[str, int]]:
        """
        查询 IP 统计数据
        
        优化策略：
        1. 使用索引 idx_logs_created_ip_token 加速查询
        2. 过滤空 IP（旧数据未开启 IP 记录）
        3. 限制返回数量避免内存溢出
        
        Returns:
            {ip: {"request_count": int, "user_count": int}}
        """
        # 优化后的 SQL：
        # - ip > '' 比 ip != '' 和 ip IS NOT NULL 更高效，能利用索引
        # - 先过滤再聚合，减少扫描行数
        sql = """
            SELECT 
                ip,
                COUNT(*) as request_count,
                COUNT(DISTINCT user_id) as user_count
            FROM logs
            WHERE created_at >= :start_time
                AND ip > ''
                AND type IN (2, 5)
            GROUP BY ip
            ORDER BY request_count DESC
            LIMIT 3000
        """
        
        try:
            rows = self._db.execute(sql, {"start_time": start_time})
            return {
                row["ip"]: {
                    "request_count": row["request_count"],
                    "user_count": row["user_count"],
                }
                for row in rows
                if row["ip"]
            }
        except Exception as e:
            logger.error(f"[IP分布] 查询失败: {e}")
            return {}
    
    def _aggregate_stats(
        self,
        ip_stats: Dict[str, Dict[str, int]],
        geo_results: Dict[str, IPGeoInfo],
    ) -> Dict[str, Any]:
        """聚合统计数据"""
        total_ips = len(ip_stats)
        total_requests = sum(s["request_count"] for s in ip_stats.values())
        
        # 按国家聚合
        by_country: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
            "ip_count": 0,
            "request_count": 0,
            "user_count": 0,
            "country_code": "",
        })
        
        # 按省份聚合（仅中国）
        by_province: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
            "ip_count": 0,
            "request_count": 0,
            "user_count": 0,
            "country": "",
            "country_code": "",
        })
        
        # 按城市聚合
        by_city: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
            "ip_count": 0,
            "request_count": 0,
            "user_count": 0,
            "country": "",
            "country_code": "",
            "region": "",
        })
        
        domestic_requests = 0
        overseas_requests = 0
        
        for ip, stats in ip_stats.items():
            geo = geo_results.get(ip)
            if not geo or not geo.success:
                # 未知地区
                country = "未知"
                country_code = "XX"
                region = ""
                city = ""
            else:
                country = geo.country or "未知"
                country_code = geo.country_code or "XX"
                region = geo.region or ""
                city = geo.city or ""
            
            req_count = stats["request_count"]
            user_count = stats["user_count"]
            
            # 国内/海外统计
            if country_code in DOMESTIC_COUNTRY_CODES:
                domestic_requests += req_count
            else:
                overseas_requests += req_count
            
            # 按国家聚合
            by_country[country]["ip_count"] += 1
            by_country[country]["request_count"] += req_count
            by_country[country]["user_count"] += user_count
            by_country[country]["country_code"] = country_code
            
            # 按省份聚合（仅中国大陆）
            if country_code == "CN" and region:
                by_province[region]["ip_count"] += 1
                by_province[region]["request_count"] += req_count
                by_province[region]["user_count"] += user_count
                by_province[region]["country"] = country
                by_province[region]["country_code"] = country_code
            
            # 按城市聚合
            if city:
                city_key = f"{country}:{region}:{city}"
                by_city[city_key]["ip_count"] += 1
                by_city[city_key]["request_count"] += req_count
                by_city[city_key]["user_count"] += user_count
                by_city[city_key]["country"] = country
                by_city[city_key]["country_code"] = country_code
                by_city[city_key]["region"] = region
                by_city[city_key]["city"] = city
        
        # 转换为列表并排序
        country_list = [
            {
                "country": name,
                "country_code": data["country_code"],
                "ip_count": data["ip_count"],
                "request_count": data["request_count"],
                "user_count": data["user_count"],
                "percentage": round(data["request_count"] / total_requests * 100, 2) if total_requests > 0 else 0,
            }
            for name, data in by_country.items()
        ]
        country_list.sort(key=lambda x: x["request_count"], reverse=True)
        
        province_list = [
            {
                "country": data["country"],
                "country_code": data["country_code"],
                "region": name,
                "ip_count": data["ip_count"],
                "request_count": data["request_count"],
                "user_count": data["user_count"],
                "percentage": round(data["request_count"] / total_requests * 100, 2) if total_requests > 0 else 0,
            }
            for name, data in by_province.items()
        ]
        province_list.sort(key=lambda x: x["request_count"], reverse=True)
        
        city_list = [
            {
                "country": data["country"],
                "country_code": data["country_code"],
                "region": data["region"],
                "city": data.get("city", ""),
                "ip_count": data["ip_count"],
                "request_count": data["request_count"],
                "user_count": data["user_count"],
                "percentage": round(data["request_count"] / total_requests * 100, 2) if total_requests > 0 else 0,
            }
            for key, data in by_city.items()
        ]
        city_list.sort(key=lambda x: x["request_count"], reverse=True)
        
        # 计算国内/海外占比
        domestic_pct = round(domestic_requests / total_requests * 100, 2) if total_requests > 0 else 0
        overseas_pct = round(overseas_requests / total_requests * 100, 2) if total_requests > 0 else 0
        
        return {
            "total_ips": total_ips,
            "total_requests": total_requests,
            "domestic_percentage": domestic_pct,
            "overseas_percentage": overseas_pct,
            "by_country": country_list[:50],  # 最多返回 50 个国家
            "by_province": province_list[:30],  # 最多返回 30 个省份
            "top_cities": city_list[:50],  # 最多返回 50 个城市
        }
    
    def _empty_result(self) -> Dict[str, Any]:
        """返回空结果"""
        return {
            "total_ips": 0,
            "total_requests": 0,
            "domestic_percentage": 0,
            "overseas_percentage": 0,
            "by_country": [],
            "by_province": [],
            "top_cities": [],
            "snapshot_time": int(time.time()),
        }


# 全局服务实例
_ip_distribution_service: Optional[IPDistributionService] = None


def get_ip_distribution_service() -> IPDistributionService:
    global _ip_distribution_service
    if _ip_distribution_service is None:
        _ip_distribution_service = IPDistributionService()
    return _ip_distribution_service


async def warmup_ip_distribution():
    """
    预热 IP 地区分布数据（所有窗口：1h/6h/24h/7d）
    
    特点：
    1. 延迟执行，不阻塞系统启动
    2. 预热所有窗口数据，用户切换时无需等待
    3. 失败不影响系统运行
    4. 输出详细进度日志
    
    缓存存储：使用 CacheManager 统一缓存管理器（SQLite + Redis 混合）
    """
    try:
        service = get_ip_distribution_service()
        cache = get_cache_manager()
        
        # 需要预热的窗口列表
        windows_to_warmup = ["1h", "6h", "24h", "7d"]

        logger.phase(6, "预热 IP 地区分布")
        total_start = time.time()
        
        warmed = []
        skipped = []
        failed = []
        
        for idx, window in enumerate(windows_to_warmup):
            # 检查是否已有缓存
            if cache.get(f"ip_dist:{window}"):
                skipped.append(window)
                continue
            
            try:
                start = time.time()
                # 执行查询（use_cache=False 强制刷新）
                # 只对第一个窗口输出详细进度，避免日志过多
                log_progress = (idx == 0 and not skipped)
                result = await service.get_distribution(window=window, use_cache=False, log_progress=log_progress)
                elapsed = time.time() - start
                
                if result:
                    logger.success(
                        f"IP分布 {window} 预热完成",
                        耗时=f"{elapsed:.2f}s",
                        IP数=result.get('total_ips', 0),
                        请求数=result.get('total_requests', 0),
                    )
                    warmed.append(window)
                else:
                    logger.bullet(f"IP分布 {window} 预热完成 (无数据)，耗时 {elapsed:.2f}s")
                    warmed.append(window)
                    
            except Exception as e:
                logger.warn(f"IP分布 {window} 预热失败: {e}")
                failed.append(window)
        
        total_elapsed = time.time() - total_start
        
        # 输出汇总（与排行榜预热格式一致）
        summary = {}
        if warmed:
            summary["成功"] = ", ".join(warmed)
        if skipped:
            summary["跳过(已缓存)"] = ", ".join(skipped)
        if failed:
            summary["失败"] = ", ".join(failed)
        summary["总耗时"] = f"{total_elapsed:.1f}s"
        
        logger.kvs(summary)
        
    except Exception as e:
        logger.warn(f"[IP分布] 预热失败: {e}")

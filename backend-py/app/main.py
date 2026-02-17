"""
NewAPI Middleware Tool - FastAPI Backend
Main application entry point with CORS, logging, and exception handling.
"""
import asyncio
import logging
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# Load environment variables from .env file in project root
env_path = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(env_path)

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .logger import logger

# Suppress noisy loggers
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("uvicorn.error").setLevel(logging.WARNING)


class ErrorResponse(BaseModel):
    """Standard error response format."""
    success: bool = False
    error: dict[str, Any]


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    version: str


# Custom exceptions
class AppException(Exception):
    """Base application exception."""
    def __init__(self, code: str, message: str, status_code: int = 500, details: Any = None):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(message)


class ContainerNotFoundError(AppException):
    """Raised when NewAPI container is not found."""
    def __init__(self, message: str = "NewAPI container not found"):
        super().__init__(
            code="CONTAINER_NOT_FOUND",
            message=message,
            status_code=503
        )


class DatabaseConnectionError(AppException):
    """Raised when database connection fails."""
    def __init__(self, message: str = "Database connection failed", details: Any = None):
        # Build descriptive error message with connection details
        if details:
            connection_info = []
            if "engine" in details:
                connection_info.append(f"engine={details['engine']}")
            if "host" in details:
                connection_info.append(f"host={details['host']}")
            if "port" in details:
                connection_info.append(f"port={details['port']}")
            if "database" in details:
                connection_info.append(f"database={details['database']}")
            if connection_info:
                message = f"{message} ({', '.join(connection_info)})"
        
        super().__init__(
            code="DB_CONNECTION_FAILED",
            message=message,
            status_code=503,
            details=details
        )


class InvalidParamsError(AppException):
    """Raised when request parameters are invalid."""
    def __init__(self, message: str = "Invalid parameters", details: Any = None):
        super().__init__(
            code="INVALID_PARAMS",
            message=message,
            status_code=400,
            details=details
        )


class UnauthorizedError(AppException):
    """Raised when API key is invalid."""
    def __init__(self, message: str = "Unauthorized"):
        super().__init__(
            code="UNAUTHORIZED",
            message=message,
            status_code=401
        )


class NotFoundError(AppException):
    """Raised when resource is not found."""
    def __init__(self, message: str = "Resource not found"):
        super().__init__(
            code="NOT_FOUND",
            message=message,
            status_code=404
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.system("NewAPI Middleware Tool 启动中...")

    # 初始化数据库连接
    db = None
    index_status = {"all_ready": True}  # 默认值，防止数据库连接失败时未定义
    try:
        from .database import get_db_manager
        db = get_db_manager()
        db.connect()
        logger.system(f"数据库连接成功: {db.config.engine.value} @ {db.config.host}:{db.config.port}")
        
        # 检查并清理冗余索引，然后检查索引状态
        try:
            # 先分析索引情况
            analysis = db.get_logs_index_analysis()
            system_count = analysis.get('system_count', 0)
            ours_count = analysis.get('ours_count', 0)
            redundant_count = analysis.get('redundant_count', 0)
            unknown_count = analysis.get('unknown_count', 0)
            
            # 始终输出索引分析结果
            logger.system(f"Logs表索引分析: 系统={system_count}, 工具={ours_count}, 冗余={redundant_count}, 未知={unknown_count}")
            
            if redundant_count > 0:
                redundant_list = analysis.get('details', {}).get('redundant', [])
                logger.system(f"发现 {redundant_count} 个冗余索引: {redundant_list}，开始清理...")
                cleanup_result = db.cleanup_redundant_indexes(log_progress=True)
                deleted = cleanup_result.get("deleted", 0)
                if deleted > 0:
                    logger.system(f"已清理 {deleted} 个冗余索引: {cleanup_result.get('deleted_indexes', [])}")
                else:
                    logger.system(f"冗余索引清理完成，无需删除")
        except Exception as e:
            logger.warning(f"索引分析/清理失败: {e}", category="数据库")
        
        # 检查索引状态并输出
        index_status = db.get_index_status()
        if index_status["all_ready"]:
            logger.system(f"索引检查完成: {index_status['existing']}/{index_status['total']} 个索引已就绪")
        else:
            logger.system(f"索引状态: {index_status['existing']}/{index_status['total']} 已存在，{index_status['missing']} 个待创建")
        
        # 检测系统规模
        try:
            from .system_scale_service import get_scale_service
            service = get_scale_service()
            result = service.detect_scale()
            metrics = result.get("metrics", {})
            settings = result.get("settings", {})
            logger.stats_box(f"系统规模: {settings.get('description', '未知')}", {
                "总用户": metrics.get('total_users', 0),
                "24h活跃": metrics.get('active_users_24h', 0),
                "24h日志": metrics.get('logs_24h', 0),
                "RPM": f"{metrics.get('rpm_avg', 0):.1f}",
                "刷新间隔": f"{settings.get('frontend_refresh_interval', 60)}s",
            })
        except Exception as e:
            logger.fail(f"系统规模检测失败", error=str(e))
    except Exception as e:
        logger.warning(f"数据库初始化失败: {e}", category="数据库")

    # 启动后台索引创建任务（仅当有缺失索引时）
    global _indexes_ready
    index_task = None
    if db and not index_status.get("all_ready", True):
        _indexes_ready = False  # 有索引需要创建，标记为未就绪
        index_task = asyncio.create_task(background_ensure_indexes())

    # 启动后台缓存预热任务（预热完成后会启动日志同步任务和 AI 封禁任务）
    cache_warmup_task = asyncio.create_task(background_cache_warmup())

    # 启动 GeoIP 数据库自动更新任务
    geoip_update_task = asyncio.create_task(background_geoip_update())

    # 启动 IP 记录强制开启任务
    ip_recording_task = asyncio.create_task(background_enforce_ip_recording())

    yield

    # 停止后台任务
    cache_warmup_task.cancel()
    geoip_update_task.cancel()
    ip_recording_task.cancel()
    if index_task:
        index_task.cancel()
    try:
        await cache_warmup_task
    except asyncio.CancelledError:
        pass
    try:
        await ip_recording_task
    except asyncio.CancelledError:
        pass
    if index_task:
        try:
            await index_task
        except asyncio.CancelledError:
            pass
    logger.system("NewAPI Middleware Tool 已关闭")


async def background_ensure_indexes():
    """
    Background task to create missing indexes without blocking app startup.
    Creates indexes one by one with delays to minimize database load.
    """
    global _indexes_ready
    
    # Wait a bit for app to fully start
    await asyncio.sleep(5)
    
    try:
        from .database import get_db_manager
        db = get_db_manager()
        
        logger.system("开始后台创建缺失索引...")
        
        # Run index creation in thread pool to avoid blocking event loop
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, db.ensure_indexes_async_safe)
        
        logger.system("后台索引创建完成")
    except asyncio.CancelledError:
        logger.system("索引创建任务已取消")
    except Exception as e:
        logger.warning(f"后台索引创建失败: {e}", category="数据库")
    finally:
        # 无论成功失败，都标记索引任务完成，让预热继续
        _indexes_ready = True


# 索引创建完成标志
_indexes_ready = True  # 默认 True，如果没有索引任务则直接就绪


async def background_enforce_ip_recording():
    """
    后台任务：每 30 分钟检查并强制开启所有用户的 IP 记录功能。
    防止用户自行关闭 IP 记录导致风控数据缺失。
    """
    from .ip_monitoring_service import get_ip_monitoring_service

    # 启动后等待 60 秒再开始检查
    await asyncio.sleep(60)
    logger.system("IP 记录强制开启任务已启动")

    while True:
        try:
            service = get_ip_monitoring_service()
            
            # 获取当前 IP 记录状态
            stats = service.get_ip_recording_stats()
            total_users = stats.get("total_users", 0)
            enabled_count = stats.get("enabled_count", 0)
            disabled_count = stats.get("disabled_count", 0)
            
            if disabled_count > 0:
                # 有用户关闭了 IP 记录，强制开启
                logger.system(f"[IP记录] 检测到 {disabled_count} 个用户关闭了 IP 记录，正在强制开启...")
                
                result = service.enable_all_ip_recording()
                updated = result.get("updated", 0)
                
                if updated > 0:
                    logger.system(f"[IP记录] 已强制开启 {updated} 个用户的 IP 记录")
                else:
                    logger.debug("[IP记录] 无需更新")
            else:
                logger.debug(f"[IP记录] 所有用户 ({total_users}) 已开启 IP 记录")

        except asyncio.CancelledError:
            logger.system("IP 记录强制开启任务已取消")
            break
        except Exception as e:
            logger.warning(f"[IP记录] 强制开启任务失败: {e}", category="任务")

        # 每 30 分钟检查一次
        await asyncio.sleep(30 * 60)


async def background_log_sync():
    """后台定时同步日志分析数据"""
    from .log_analytics_service import get_log_analytics_service

    # 预热完成后立即启动
    logger.success("后台日志同步任务已启动", category="任务")

    while True:
        try:
            service = get_log_analytics_service()

            # 检查是否需要初始化同步，未初始化时跳过自动同步
            sync_status = service.get_sync_status()
            if sync_status.get("needs_initial_sync") or sync_status.get("is_initializing"):
                # 未初始化，跳过自动同步，等待用户手动触发
                await asyncio.sleep(300)
                continue

            # 检查数据一致性
            service.check_and_auto_reset()

            # 处理新日志（每次最多处理 5000 条）
            total_processed = 0
            for _ in range(5):  # 最多 5 轮，每轮 1000 条
                result = service.process_new_logs()
                if not result.get("success") or result.get("processed", 0) == 0:
                    break
                total_processed += result.get("processed", 0)

            if total_processed > 0:
                logger.analytics("后台同步完成", processed=total_processed)

        except Exception as e:
            logger.error(f"后台日志同步失败: {e}", category="任务")

        # 每 5 分钟同步一次
        await asyncio.sleep(300)


async def _warmup_dashboard_data():
    """
    预热 Dashboard 数据，避免首次访问时数据库超时。

    对于大型系统（千万级日志），直接查询可能需要 10-30 秒。
    在启动时预热可以确保用户首次访问时数据已经缓存。

    前端 Dashboard 首次加载会并发调用：
    1. /api/dashboard/overview?period=7d
    2. /api/dashboard/usage?period=7d
    3. /api/dashboard/models?period=7d&limit=8
    4. /api/dashboard/trends/daily?days=7
    5. /api/dashboard/top-users?period=7d&limit=10  <-- 关键！

    必须全部预热，否则首次访问会导致高并发数据库查询。

    缓存存储：使用 CacheManager 统一缓存管理器（SQLite + Redis 混合）

    增量缓存：对于 3d/7d/14d 周期的 usage/models/top_users，
    使用槽缓存增量模式，只查询缺失的时间槽，大幅减少查询时间。
    """
    from .cached_dashboard import get_cached_dashboard_service, INCREMENTAL_PERIODS
    from .user_management_service import get_user_management_service
    from .system_scale_service import get_scale_service

    logger.phase(4, "预热 Dashboard 数据")
    warmup_start = time.time()

    dashboard_service = get_cached_dashboard_service()
    user_service = get_user_management_service()

    # 获取系统规模信息用于估算
    try:
        scale_service = get_scale_service()
        scale_result = scale_service.detect_scale()
        metrics = scale_result.get("metrics", {})
        logs_24h = metrics.get('logs_24h', 0)
        total_logs = metrics.get('total_logs', 0)
    except:
        logs_24h = 0
        total_logs = 0

    # 预热项目列表（按前端加载顺序）
    # 必须包含所有 Dashboard 首次加载时调用的 API
    # 格式: (name, period, method, kwargs, estimated_logs_multiplier)
    # - period: 用于判断是否使用增量缓存（3d/7d/14d）
    # - method: 方法名
    # - kwargs: 方法参数
    # - multiplier: 基于 24h 日志数估算扫描量
    warmup_items = [
        # === 核心 Dashboard API（前端 Promise.all 并发调用）===
        ("overview_7d", "7d", "get_system_overview", {"period": "7d"}, 5.0),
        ("usage_7d", "7d", "get_usage_statistics", {"period": "7d"}, 5.0),
        ("models_7d", "7d", "get_model_usage", {"period": "7d", "limit": 8}, 5.0),
        ("trends_daily_7d", None, "get_daily_trends", {"days": 7}, 5.0),
        ("top_users_7d", "7d", "get_top_users", {"period": "7d", "limit": 10}, 5.0),

        # === 常用的其他时间周期 ===
        ("overview_24h", "24h", "get_system_overview", {"period": "24h"}, 1.0),
        ("usage_24h", "24h", "get_usage_statistics", {"period": "24h"}, 1.0),
        ("trends_hourly_24h", None, "get_hourly_trends", {"hours": 24}, 1.0),

        # === 3天周期（用户切换时间周期时需要）===
        ("overview_3d", "3d", "get_system_overview", {"period": "3d"}, 2.5),
        ("usage_3d", "3d", "get_usage_statistics", {"period": "3d"}, 2.5),
        ("models_3d", "3d", "get_model_usage", {"period": "3d", "limit": 8}, 2.5),
        ("trends_daily_3d", None, "get_daily_trends", {"days": 3}, 2.5),
        ("top_users_3d", "3d", "get_top_users", {"period": "3d", "limit": 10}, 2.5),

        # === 14天周期（用户切换时间周期时需要）===
        ("overview_14d", "14d", "get_system_overview", {"period": "14d"}, 10.0),
        ("usage_14d", "14d", "get_usage_statistics", {"period": "14d"}, 10.0),
        ("models_14d", "14d", "get_model_usage", {"period": "14d", "limit": 8}, 10.0),
        ("trends_daily_14d", None, "get_daily_trends", {"days": 14}, 10.0),
        ("top_users_14d", "14d", "get_top_users", {"period": "14d", "limit": 10}, 10.0),

        # === 用户统计（UserManagement 页面需要）===
        ("user_stats", None, None, {}, 1.0),
    ]

    # 计算预计扫描总日志数
    total_estimated_logs = sum(int(logs_24h * m) for _, _, _, _, m in warmup_items)

    # 统计增量缓存项目数
    incremental_count = sum(
        1 for _, period, method, _, _ in warmup_items
        if period in INCREMENTAL_PERIODS and method in ("get_usage_statistics", "get_model_usage", "get_top_users")
    )

    logger.kvs({
        "待预热项目": f"{len(warmup_items)} 个",
        "增量缓存项目": f"{incremental_count} 个",
        "预计扫描日志": f"{total_estimated_logs:,} 条",
    })

    total_items = len(warmup_items)
    success_count = 0
    failed_items = []

    for idx, (name, period, method, kwargs, multiplier) in enumerate(warmup_items):
        estimated_logs = int(logs_24h * multiplier)

        # 判断是否使用增量缓存（仅 usage/models/top_users 支持）
        is_incremental = (
            period in INCREMENTAL_PERIODS and
            method in ("get_usage_statistics", "get_model_usage", "get_top_users")
        )
        mode_tag = " [增量]" if is_incremental else ""

        try:
            item_start = time.time()

            # 构建调用参数
            call_kwargs = {"use_cache": False, **kwargs}
            if is_incremental:
                call_kwargs["log_progress"] = True

            # 获取要调用的方法
            if method is None:
                # user_stats 特殊处理
                fetch_func = lambda: user_service.get_activity_stats()
            else:
                service_method = getattr(dashboard_service, method)
                # 使用闭包捕获当前参数
                fetch_func = lambda m=service_method, k=call_kwargs: m(**k)

            # 在线程池中执行，避免阻塞事件循环
            await asyncio.get_event_loop().run_in_executor(None, fetch_func)
            item_elapsed = time.time() - item_start
            logger.success(f"Dashboard {name}{mode_tag} 预热完成", 耗时=f"{item_elapsed:.2f}s")
            success_count += 1
        except Exception as e:
            failed_items.append(name)
            logger.warn(f"Dashboard {name}{mode_tag} 预热失败: {e}")

    total_elapsed = time.time() - warmup_start

    # 输出汇总（与排行榜预热格式一致）
    if failed_items:
        logger.kvs({
            "成功项目": f"{success_count}/{total_items}",
            "失败项目": ", ".join(failed_items),
            "总耗时": f"{total_elapsed:.1f}s",
        })
    else:
        logger.kvs({
            "成功项目": f"{success_count}/{total_items}",
            "总耗时": f"{total_elapsed:.1f}s",
        })


async def _warmup_user_activity_list():
    """
    预热用户管理活跃度筛选数据（仅大型/超大型系统）。

    对于大型系统，活跃度筛选需要 JOIN logs 表，首次查询可能需要 10-30 秒。
    预热可以确保用户首次访问用户管理页面时数据已经缓存。

    预热内容：
    - active（活跃用户）第1页
    - inactive（不活跃用户）第1页
    - very_inactive（非常不活跃用户）第1页

    小型/中型系统跳过此预热（查询本身较快）。
    """
    from .system_scale_service import get_scale_service
    from .user_management_service import get_user_management_service, ActivityLevel

    # 检查系统规模
    try:
        scale_service = get_scale_service()
        scale_result = scale_service.detect_scale()
        scale = scale_result.get("scale", "medium")
    except Exception:
        scale = "medium"

    # 只有大型/超大型系统才预热
    if scale not in ("large", "xlarge"):
        logger.bullet(f"用户活跃度列表：跳过预热（系统规模={scale}，无需预热）")
        return

    logger.phase(5, "预热用户活跃度列表（大型系统）")
    warmup_start = time.time()

    user_service = get_user_management_service()

    # 预热项目：3种活跃度筛选的第1页
    warmup_items = [
        ("active", ActivityLevel.ACTIVE),
        ("inactive", ActivityLevel.INACTIVE),
        ("very_inactive", ActivityLevel.VERY_INACTIVE),
    ]

    success_count = 0
    failed_items = []

    for name, activity_filter in warmup_items:
        try:
            item_start = time.time()
            # 在线程池中执行，避免阻塞事件循环
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda af=activity_filter: user_service.get_users(
                    page=1,
                    page_size=20,
                    activity_filter=af,
                    order_by="last_request_time",
                    order_dir="DESC",
                )
            )
            item_elapsed = time.time() - item_start
            logger.success(f"用户活跃度 {name} 预热完成", 耗时=f"{item_elapsed:.2f}s")
            success_count += 1
        except Exception as e:
            failed_items.append(name)
            logger.warn(f"用户活跃度 {name} 预热失败: {e}")

        # 每个查询之间延迟 1 秒，避免数据库压力
        await asyncio.sleep(1)

    total_elapsed = time.time() - warmup_start

    if failed_items:
        logger.kvs({
            "成功项目": f"{success_count}/{len(warmup_items)}",
            "失败项目": ", ".join(failed_items),
            "总耗时": f"{total_elapsed:.1f}s",
        })
    else:
        logger.kvs({
            "成功项目": f"{success_count}/{len(warmup_items)}",
            "总耗时": f"{total_elapsed:.1f}s",
        })


async def _warmup_ip_monitoring_data():
    """
    预热 IP 监控数据（共享IP、多IP令牌、多IP用户、IP Stats）

    特点：
    1. 预热多个时间窗口（1h, 24h, 7d）
    2. 使用 limit=200 匹配前端请求
    3. 支持缓存复用（key不包含limit）
    """
    from .ip_monitoring_service import get_ip_monitoring_service, WINDOW_SECONDS
    from .cache_manager import get_cache_manager

    logger.phase(5, "预热 IP 监控数据")

    ip_service = get_ip_monitoring_service()
    cache = get_cache_manager()
    IP_WARMUP_LIMIT = 200
    IP_WARMUP_WINDOWS = ["1h", "24h", "7d"]

    warmup_start = time.time()
    success_count = 0
    failed_items = []

    for window_key in IP_WARMUP_WINDOWS:
        window_seconds = WINDOW_SECONDS.get(window_key, 86400)

        # 检查是否使用增量缓存（3d/7d）
        is_incremental = cache.is_incremental_window(window_key)
        mode_tag = " [增量]" if is_incremental else ""

        # 共享IP
        try:
            start = time.time()
            ip_service.get_shared_ips(
                window_seconds=window_seconds,
                min_tokens=2,
                limit=IP_WARMUP_LIMIT,
                use_cache=False,
                log_progress=is_incremental,  # 增量模式时显示详细日志
            )
            logger.success(f"IP监控 shared_ips({window_key}){mode_tag} 预热完成", 耗时=f"{time.time()-start:.2f}s")
            success_count += 1
        except Exception as e:
            failed_items.append(f"shared_ips({window_key})")
            logger.warn(f"IP监控 shared_ips({window_key}) 预热失败: {e}")

        # 多IP令牌
        try:
            start = time.time()
            ip_service.get_multi_ip_tokens(
                window_seconds=window_seconds,
                min_ips=2,
                limit=IP_WARMUP_LIMIT,
                use_cache=False,
                log_progress=is_incremental,
            )
            logger.success(f"IP监控 multi_ip_tokens({window_key}){mode_tag} 预热完成", 耗时=f"{time.time()-start:.2f}s")
            success_count += 1
        except Exception as e:
            failed_items.append(f"multi_ip_tokens({window_key})")
            logger.warn(f"IP监控 multi_ip_tokens({window_key}) 预热失败: {e}")

        # 多IP用户
        try:
            start = time.time()
            ip_service.get_multi_ip_users(
                window_seconds=window_seconds,
                min_ips=3,
                limit=IP_WARMUP_LIMIT,
                use_cache=False,
                log_progress=is_incremental,
            )
            logger.success(f"IP监控 multi_ip_users({window_key}){mode_tag} 预热完成", 耗时=f"{time.time()-start:.2f}s")
            success_count += 1
        except Exception as e:
            failed_items.append(f"multi_ip_users({window_key})")
            logger.warn(f"IP监控 multi_ip_users({window_key}) 预热失败: {e}")

    # IP Stats
    try:
        start = time.time()
        ip_service.get_ip_recording_stats(use_cache=False)
        logger.success(f"IP监控 ip_stats 预热完成", 耗时=f"{time.time()-start:.2f}s")
        success_count += 1
    except Exception as e:
        failed_items.append("ip_stats")
        logger.warn(f"IP监控 ip_stats 预热失败: {e}")

    total_elapsed = time.time() - warmup_start
    total_items = len(IP_WARMUP_WINDOWS) * 3 + 1  # 3种查询 × N窗口 + IP Stats

    if failed_items:
        logger.kvs({
            "成功项目": f"{success_count}/{total_items}",
            "失败项目": ", ".join(failed_items),
            "总耗时": f"{total_elapsed:.1f}s",
        })
    else:
        logger.kvs({
            "成功项目": f"{success_count}/{total_items}",
            "总耗时": f"{total_elapsed:.1f}s",
        })


async def background_cache_warmup():
    """
    后台缓存预热任务 - 智能恢复模式
    
    新策略：
    1. 等待索引创建完成（如果有）
    2. 优先从 SQLite 恢复缓存（秒级恢复）
    3. 仅缺失的窗口才查询 PostgreSQL
    4. 恢复后进入定时刷新循环
    
    千万级数据处理策略：
    ========================
    本系统不会加载全量数据到内存，而是采用以下优化策略：
    
    1. 聚合查询：SQL 使用 GROUP BY user_id 聚合，只返回 Top 50 用户
       - 即使有 1000 万条日志，也只返回 50 条聚合结果
       - 数据库在服务端完成聚合，不传输原始数据
    
    2. 索引优化：使用复合索引 idx_logs_created_type_user
       - 索引覆盖 (created_at, type, user_id)
       - 查询只扫描索引，不回表读取全部字段
    
    3. 时间窗口：按时间窗口分别缓存 (1h/3h/6h/12h/24h/3d/7d)
       - 每个窗口独立缓存，独立刷新
       - 短窗口数据量小，查询快
    
    4. 三层缓存：Redis → SQLite → PostgreSQL
       - 热数据在 Redis（毫秒级响应）
       - 持久化到 SQLite（重启后秒级恢复）
       - 只有缓存失效才查询 PostgreSQL
    
    5. 延迟策略：根据系统规模调整查询间隔
       - 小型系统：无延迟
       - 中型系统：0.5s 延迟
       - 大型系统：1s 延迟
       - 超大型系统：2s 延迟
    """
    from .system_scale_service import get_detected_settings, get_scale_service, SystemScale
    from .database import get_db_manager
    from .cache_manager import get_cache_manager

    warmup_start_time = time.time()

    # 启动后等待 3 秒，让数据库连接就绪
    await asyncio.sleep(3)
    
    # 等待索引创建完成（最多等待 10 分钟）
    global _indexes_ready
    if not _indexes_ready:
        logger.system("等待索引创建完成后再开始预热...")
        _set_warmup_status("initializing", 0, "等待索引创建完成...")
        
        wait_count = 0
        max_wait = 600  # 最多等待 600 秒（10 分钟）
        while not _indexes_ready and wait_count < max_wait:
            await asyncio.sleep(5)
            wait_count += 5
        
        if _indexes_ready:
            logger.system("索引创建完成，开始预热")
        else:
            logger.warning("索引创建超时，继续预热（可能较慢）")
    
    logger.banner("🚀 缓存恢复任务启动")

    # 初始化预热步骤
    steps = [
        {"name": "恢复缓存", "status": "pending"},
        {"name": "检查缓存有效性", "status": "pending"},
        {"name": "预热排行榜数据", "status": "pending"},
        {"name": "预热 Dashboard", "status": "pending"},
        {"name": "预热用户活跃度", "status": "pending"},
        {"name": "预热 IP 监控", "status": "pending"},
        {"name": "预热 IP 分布", "status": "pending"},
        {"name": "预热模型状态", "status": "pending"},
    ]

    _set_warmup_status("initializing", 0, "正在初始化缓存...", steps)

    # 获取缓存管理器
    cache = get_cache_manager()
    
    # 阶段1：从 SQLite 恢复到 Redis（如果 Redis 可用）
    logger.phase(1, "从 SQLite 恢复缓存到 Redis")
    steps[0]["status"] = "done"
    _set_warmup_status("initializing", 5, "正在恢复缓存...", steps)
    if cache.redis_available:
        restored = cache.restore_to_redis()
        if restored > 0:
            logger.success(f"恢复完成", count=restored)
        else:
            logger.bullet("无缓存数据需要恢复")
    else:
        logger.bullet("Redis 未配置，使用纯 SQLite 模式")
    
    # 阶段2：检查缓存有效性
    logger.phase(2, "检查缓存有效性")
    steps[1]["status"] = "done"
    _set_warmup_status("initializing", 10, "正在检查缓存有效性...", steps)

    windows = ["1h", "3h", "6h", "12h", "24h", "3d", "7d"]
    cached_windows = cache.get_cached_windows()
    missing_windows = [w for w in windows if w not in cached_windows]

    if not missing_windows:
        # 所有缓存都有效，但仍需预热 Dashboard、IP监控 和 IP 分布
        logger.success("所有缓存有效，无需预热排行榜")
        steps[2]["status"] = "done"  # 排行榜跳过
        _set_warmup_status("initializing", 40, "排行榜缓存有效，正在预热 Dashboard...", steps)

        # 预热 Dashboard 数据
        steps[3]["status"] = "pending"
        try:
            await _warmup_dashboard_data()
            steps[3]["status"] = "done"
        except Exception as e:
            logger.warn(f"Dashboard 预热异常: {e}")
            steps[3]["status"] = "error"
        _set_warmup_status("initializing", 55, "正在预热用户活跃度列表...", steps)

        # 预热用户活跃度列表（仅大型系统）
        try:
            await _warmup_user_activity_list()
            steps[4]["status"] = "done"
        except Exception as e:
            logger.warn(f"用户活跃度列表预热异常: {e}")
            steps[4]["status"] = "error"
        _set_warmup_status("initializing", 65, "正在预热 IP 监控数据...", steps)

        # 预热 IP 监控数据（共享IP、多IP令牌、多IP用户、IP Stats）
        try:
            await _warmup_ip_monitoring_data()
            steps[5]["status"] = "done"
        except Exception as e:
            logger.warn(f"IP监控预热异常: {e}")
            steps[5]["status"] = "error"
        _set_warmup_status("initializing", 80, "正在预热 IP 地区分布...", steps)

        # 预热 IP 地区分布
        try:
            from .ip_distribution_service import warmup_ip_distribution
            await warmup_ip_distribution()
            steps[6]["status"] = "done"
        except Exception as e:
            logger.warning(f"[IP分布] 预热异常: {e}")
            steps[6]["status"] = "error"
        _set_warmup_status("initializing", 90, "正在预热模型状态...", steps)

        # 预热模型状态监控数据（动态获取所有可用模型）
        try:
            from .model_status_service import warmup_model_status
            await warmup_model_status()
            steps[7]["status"] = "done"
        except Exception as e:
            logger.warning(f"[模型状态] 预热异常: {e}")
            steps[7]["status"] = "error"
        
        # 所有预热完成
        elapsed = time.time() - warmup_start_time
        _set_warmup_status("ready", 100, f"预热完成，耗时 {elapsed:.1f}s", steps)
        logger.banner("✅ 缓存预热完成")
        logger.kvs({
            "总耗时": f"{elapsed:.1f}s",
        })
        
        # 预热完成后启动后台任务
        asyncio.create_task(background_log_sync())
        asyncio.create_task(background_ai_auto_ban_scan())
        asyncio.create_task(background_auto_group_scan())
        
        # 进入定时刷新循环
        await _background_refresh_loop(cache)
        return
    
    logger.bullet(f"已缓存: {cached_windows or '无'}")
    logger.bullet(f"需预热: {missing_windows}")

    # 检测系统规模
    scale_service = get_scale_service()
    scale_result = scale_service.detect_scale()
    scale = SystemScale(scale_result["scale"])
    metrics = scale_result.get("metrics", {})

    # 输出系统规模详情
    logger.stats_box("系统规模检测", {
        "系统规模": scale.value,
        "总用户数": metrics.get('total_users', 0),
        "活跃用户(24h)": metrics.get('active_users_24h', 0),
        "日志数(24h)": metrics.get('logs_24h', 0),
        "总日志数": metrics.get('total_logs', 0),
        "平均 RPM": f"{metrics.get('rpm_avg', 0):.1f}",
    })

    # 获取预热策略
    strategy = WARMUP_STRATEGY.get(scale.value, WARMUP_STRATEGY["medium"])
    query_delay = strategy['query_delay']
    
    # 估算预热时间和数据量
    total_to_warm = len(missing_windows)
    logs_24h = metrics.get('logs_24h', 0)
    total_logs = metrics.get('total_logs', 0)
    
    # 根据系统规模估算每个窗口的查询时间
    if logs_24h > 5000000:  # 500万+
        estimated_query_time = 5.0  # 大数据量，每个窗口约5秒
    elif logs_24h > 1000000:  # 100万+
        estimated_query_time = 3.0
    elif logs_24h > 100000:  # 10万+
        estimated_query_time = 1.5
    else:
        estimated_query_time = 0.5
    
    # 估算每个窗口需要扫描的日志数量
    # 基于 24h 日志数按比例估算
    window_logs_estimate = {}
    window_hours = {"1h": 1, "3h": 3, "6h": 6, "12h": 12, "24h": 24, "3d": 72, "7d": 168}
    hourly_rate = logs_24h / 24 if logs_24h > 0 else 0
    
    total_logs_to_scan = 0
    for w in missing_windows:
        hours = window_hours.get(w, 24)
        if hours <= 24:
            # 24小时内，按小时比例估算
            estimated_logs = int(hourly_rate * hours)
        else:
            # 超过24小时，假设历史数据量递减（越早的数据越少）
            # 使用 24h 数据 * 系数估算
            if w == "3d":
                estimated_logs = int(logs_24h * 2.5)  # 3天约为24h的2.5倍
            else:  # 7d
                estimated_logs = int(logs_24h * 5)  # 7天约为24h的5倍
        
        window_logs_estimate[w] = estimated_logs
        total_logs_to_scan += estimated_logs
    
    # 总预计时间 = (查询时间 + 延迟) * 窗口数
    estimated_total_time = (estimated_query_time + query_delay) * total_to_warm
    
    # 预热数据条数说明
    # 每个窗口返回 Top 50 用户的聚合数据
    estimated_records = total_to_warm * 50

    # === 阶段3：仅预热缺失的窗口 ===
    logger.phase(3, "预热缺失的窗口")
    logger.kvs({
        "待预热窗口": f"{total_to_warm} 个",
        "预计扫描日志": f"{total_logs_to_scan:,} 条",
        "预计缓存数据": f"{estimated_records} 条",
        "查询延迟": f"{query_delay}s/窗口",
        "预计耗时": f"{estimated_total_time:.0f}~{estimated_total_time * 1.5:.0f} 秒",
    })
    _set_warmup_status("initializing", 15, f"正在预热排行榜 ({total_to_warm} 个窗口)...", steps)

    from .risk_monitoring_service import get_risk_monitoring_service
    service = get_risk_monitoring_service()
    
    warmed = []
    failed = []
    window_times = []  # 记录每个窗口的实际耗时，用于动态估算
    
    for idx, window in enumerate(missing_windows):
        # progress: 15% -> 50% (排行榜预热占 35%)
        progress = 15 + int((idx / max(total_to_warm, 1)) * 35)
        
        # 获取该窗口预计扫描的日志数
        window_estimated_logs = window_logs_estimate.get(window, 0)
        
        # 计算剩余预计时间
        if window_times:
            avg_time = sum(window_times) / len(window_times)
            remaining_windows = total_to_warm - idx
            remaining_time = (avg_time + query_delay) * remaining_windows
            _set_warmup_status("initializing", progress, f"排行榜: {window} ({idx + 1}/{total_to_warm})，剩余约 {remaining_time:.0f}s", steps)
        else:
            remaining_time = estimated_total_time - (estimated_query_time + query_delay) * idx
            _set_warmup_status("initializing", progress, f"排行榜: {window} ({idx + 1}/{total_to_warm})，剩余约 {remaining_time:.0f}s", steps)
        
        window_start = time.time()

        # 检查是否使用增量缓存（3d/7d）
        is_incremental = cache.is_incremental_window(window)
        if is_incremental:
            # 检查槽缓存状态
            missing_slots, cached_slots = cache.get_missing_slots(window, "requests")
            total_slots = len(missing_slots) + len(cached_slots)
            if cached_slots:
                logger.step(idx + 1, total_to_warm, f"预热 {window} 窗口 [增量模式: {len(cached_slots)}/{total_slots} 槽已缓存]")
            else:
                logger.step(idx + 1, total_to_warm, f"预热 {window} 窗口 [增量模式: 需查询 {total_slots} 个槽]")
        else:
            logger.step(idx + 1, total_to_warm, f"预热 {window} 窗口，预计扫描 {window_estimated_logs:,} 条日志...")

        try:
            # 查询 PostgreSQL（只读）
            # 注意：这里只查询 Top 50 用户的聚合数据，不是全量数据
            # 即使有千万级日志，SQL 使用索引聚合，只返回 50 条结果
            # 对于 3d/7d，使用增量缓存模式，复用已有槽数据
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(
                None,
                lambda: service.get_leaderboards(
                    windows=[window],
                    limit=50,
                    sort_by="requests",
                    use_cache=False,
                    log_progress=True,
                ),
            )

            window_elapsed = time.time() - window_start
            window_times.append(window_elapsed)  # 记录实际耗时

            if data and window in data.get("windows", {}):
                result_count = len(data["windows"][window])
                warmed.append(window)
                if is_incremental:
                    logger.success(f"{window} 预热完成 [增量]", 数据=result_count, 耗时=f"{window_elapsed:.2f}s")
                else:
                    logger.success(f"{window} 预热完成", 数据=result_count, 耗时=f"{window_elapsed:.2f}s")
            else:
                failed.append(window)
                logger.warn(f"{window} 无数据", 耗时=f"{window_elapsed:.2f}s")

        except Exception as e:
            window_elapsed = time.time() - window_start
            window_times.append(window_elapsed)  # 即使失败也记录耗时
            failed.append(window)
            logger.fail(f"{window} 预热失败", error=str(e), 耗时=f"{window_elapsed:.2f}s")

        # 延迟，避免数据库压力
        if query_delay > 0 and idx < total_to_warm - 1:
            await asyncio.sleep(query_delay)

    # 完成汇总
    total_elapsed = time.time() - warmup_start_time
    total_cached_records = len(warmed) * 50  # 每个窗口 50 条

    logger.divider("═")
    if failed:
        logger.bullet(f"成功: {warmed}")
        logger.bullet(f"失败: {failed}")
    else:
        logger.success(f"全部窗口预热完成", 窗口=warmed)

    logger.kvs({
        "已缓存数据": f"{total_cached_records} 条 ({len(warmed)} 窗口 × 50 用户)",
        "总耗时": f"{total_elapsed:.1f}s",
    })

    # 排行榜窗口预热完成
    steps[2]["status"] = "done" if not failed else "error"
    window_status_msg = (
        f"排行榜预热完成（部分失败），正在预热 Dashboard..."
        if failed
        else f"排行榜预热完成，正在预热 Dashboard..."
    )
    _set_warmup_status("initializing", 50, window_status_msg, steps)

    # === 阶段4：预热 Dashboard 数据（重要！避免首次访问超时）===
    try:
        await _warmup_dashboard_data()
        steps[3]["status"] = "done"
    except Exception as e:
        logger.warn(f"Dashboard 预热异常: {e}")
        steps[3]["status"] = "error"
    _set_warmup_status("initializing", 60, "正在预热用户活跃度列表...", steps)

    # === 阶段5：预热用户活跃度列表（仅大型系统）===
    try:
        await _warmup_user_activity_list()
        steps[4]["status"] = "done"
    except Exception as e:
        logger.warn(f"用户活跃度列表预热异常: {e}")
        steps[4]["status"] = "error"
    _set_warmup_status("initializing", 70, "正在预热 IP 监控数据...", steps)

    # === 阶段5.5：预热 IP 监控数据 ===
    try:
        await _warmup_ip_monitoring_data()
        steps[5]["status"] = "done"
    except Exception as e:
        logger.warn(f"IP监控预热异常: {e}")
        steps[5]["status"] = "error"
    _set_warmup_status("initializing", 80, "正在预热 IP 地区分布...", steps)

    # === 阶段6：预热 IP 地区分布 ===
    try:
        from .ip_distribution_service import warmup_ip_distribution
        await warmup_ip_distribution()
        steps[6]["status"] = "done"
    except Exception as e:
        logger.warning(f"[IP分布] 预热异常: {e}")
        steps[6]["status"] = "error"
    _set_warmup_status("initializing", 90, "正在预热模型状态...", steps)

    # === 阶段7：预热模型状态监控数据（动态获取所有可用模型）
    try:
        from .model_status_service import warmup_model_status
        await warmup_model_status()
        steps[7]["status"] = "done"
    except Exception as e:
        logger.warning(f"[模型状态] 预热异常: {e}")
        steps[7]["status"] = "error"

    # 所有预热完成后输出完成日志
    total_warmup_elapsed = time.time() - warmup_start_time
    has_errors = any(s["status"] == "error" for s in steps)
    final_msg = (
        f"预热完成（部分失败），耗时 {total_warmup_elapsed:.1f}s"
        if has_errors
        else f"预热完成，耗时 {total_warmup_elapsed:.1f}s"
    )
    _set_warmup_status("ready", 100, final_msg, steps)
    logger.banner("✅ 缓存预热完成")
    logger.kvs({
        "总耗时": f"{total_warmup_elapsed:.1f}s",
    })

    # 预热完成后启动后台任务
    asyncio.create_task(background_log_sync())
    asyncio.create_task(background_ai_auto_ban_scan())

    # 进入定时刷新循环
    await _background_refresh_loop(cache)


async def _background_refresh_loop(cache):
    """
    后台定时刷新缓存

    刷新内容：
    1. 排行榜数据（所有时间窗口）
    2. 仪表盘核心数据（避免用户访问时触发慢查询）
    3. 模型状态数据（模型列表和状态缓存）

    针对大型系统优化：
    - 根据系统规模调整刷新间隔
    - 分批刷新避免瞬间高负载
    - 仪表盘数据每 3 个周期刷新一次
    - 模型状态数据每 6 个周期刷新一次（约 30 分钟）
    """
    from .system_scale_service import get_detected_settings
    from .risk_monitoring_service import get_risk_monitoring_service
    from .cached_dashboard import get_cached_dashboard_service
    from .model_status_service import get_model_status_service

    windows = ["1h", "3h", "6h", "12h", "24h", "3d", "7d"]
    dashboard_refresh_counter = 0  # 仪表盘刷新计数器
    model_status_refresh_counter = 0  # 模型状态刷新计数器

    while True:
        try:
            settings = get_detected_settings()
            interval = settings.leaderboard_cache_ttl

            logger.debug(f"[定时刷新] 下次刷新在 {interval}s 后")
            await asyncio.sleep(interval)

            refresh_start = time.time()

            # === 刷新排行榜数据 ===
            service = get_risk_monitoring_service()
            for window in windows:
                try:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(
                        None,
                        lambda w=window: service.get_leaderboards(
                            windows=[w],
                            limit=50,
                            use_cache=False,
                        ),
                    )
                    # 短暂延迟，避免瞬间高负载
                    await asyncio.sleep(0.5)
                except Exception:
                    pass

            # === 刷新仪表盘数据（每 3 个周期刷新一次）===
            dashboard_refresh_counter += 1
            if dashboard_refresh_counter >= 3:
                dashboard_refresh_counter = 0
                try:
                    dashboard_service = get_cached_dashboard_service()
                    loop = asyncio.get_event_loop()

                    # 刷新核心仪表盘数据
                    await loop.run_in_executor(
                        None,
                        lambda: dashboard_service.get_system_overview(period="7d", use_cache=False)
                    )
                    await asyncio.sleep(0.5)

                    await loop.run_in_executor(
                        None,
                        lambda: dashboard_service.get_usage_statistics(period="7d", use_cache=False)
                    )
                    await asyncio.sleep(0.5)

                    await loop.run_in_executor(
                        None,
                        lambda: dashboard_service.get_daily_trends(days=7, use_cache=False)
                    )
                    await asyncio.sleep(0.5)

                    await loop.run_in_executor(
                        None,
                        lambda: dashboard_service.get_top_users(period="7d", limit=10, use_cache=False)
                    )

                    logger.debug("[定时刷新] 仪表盘数据已刷新")
                except Exception as e:
                    logger.warning(f"[定时刷新] 仪表盘刷新失败: {e}")

            # === 刷新模型状态数据（每 6 个周期刷新一次，约 30 分钟）===
            model_status_refresh_counter += 1
            if model_status_refresh_counter >= 6:
                model_status_refresh_counter = 0
                try:
                    model_service = get_model_status_service()
                    loop = asyncio.get_event_loop()

                    # 刷新模型列表（含 24h 请求统计）
                    await loop.run_in_executor(
                        None,
                        lambda: model_service.get_available_models_with_stats(use_cache=False)
                    )
                    logger.debug("[定时刷新] 模型状态数据已刷新")
                except Exception as e:
                    logger.warning(f"[定时刷新] 模型状态刷新失败: {e}")

            refresh_elapsed = time.time() - refresh_start
            logger.debug(f"[定时刷新] 完成，耗时 {refresh_elapsed:.1f}s")

        except asyncio.CancelledError:
            logger.system("缓存刷新任务已取消")
            break
        except Exception as e:
            logger.warning(f"[定时刷新] 失败: {e}")
            await asyncio.sleep(60)


# 预热状态存储
_warmup_state = {
    "status": "pending",  # pending, initializing, ready
    "progress": 0,
    "message": "等待启动...",
    "steps": [],
    "started_at": None,
    "completed_at": None,
}
_warmup_lock = threading.Lock()


def _set_warmup_status(status: str, progress: int, message: str, steps: list = None):
    """更新预热状态"""
    global _warmup_state
    with _warmup_lock:
        _warmup_state["status"] = status
        _warmup_state["progress"] = progress
        _warmup_state["message"] = message
        if steps is not None:
            _warmup_state["steps"] = steps
        if status == "initializing" and _warmup_state["started_at"] is None:
            _warmup_state["started_at"] = time.time()
        if status == "ready":
            _warmup_state["completed_at"] = time.time()


def get_warmup_status() -> dict:
    """获取预热状态（供 API 调用）"""
    with _warmup_lock:
        return _warmup_state.copy()


import threading


# 根据系统规模定义预热策略
# 所有规模都预热全部窗口，只是延迟时间不同
WARMUP_STRATEGY = {
    # scale: {
    #   windows: 预热的时间窗口（全部窗口）
    #   query_delay: 每个查询之间的延迟（秒），规模越大延迟越长
    #   ip_window: IP 监控使用的时间窗口
    #   limit: 排行榜查询数量限制
    # }
    "small": {
        "windows": ["1h", "3h", "6h", "12h", "24h", "3d", "7d"],
        "query_delay": 0.5,
        "ip_window": "24h",
        "limit": 10,
    },
    "medium": {
        "windows": ["1h", "3h", "6h", "12h", "24h", "3d", "7d"],
        "query_delay": 1.5,
        "ip_window": "24h",
        "limit": 10,
    },
    "large": {
        "windows": ["1h", "3h", "6h", "12h", "24h", "3d", "7d"],
        "query_delay": 3.0,
        "ip_window": "24h",
        "limit": 10,
    },
    "xlarge": {
        "windows": ["1h", "3h", "6h", "12h", "24h", "3d", "7d"],
        "query_delay": 5.0,  # 超大规模系统，延迟更长
        "ip_window": "24h",
        "limit": 10,
    },
}


async def _do_complete_warmup(scale):
    """
    执行完整的渐进式缓存预热

    Args:
        scale: SystemScale 枚举值

    预热顺序（全部完成后才标记为就绪）：
    1. 排行榜数据：逐个窗口预热（1h → 3h → 6h → 12h → 24h → 3d → 7d）
    2. IP 监控数据：共享IP、多IP令牌、多IP用户
    3. 用户统计数据
    """
    import asyncio

    strategy = WARMUP_STRATEGY.get(scale.value, WARMUP_STRATEGY["medium"])
    windows = strategy["windows"]
    query_delay = strategy["query_delay"]
    ip_window = strategy["ip_window"]
    limit = strategy["limit"]

    logger.system(f"开始完整预热: 窗口 {windows}, 查询延迟 {query_delay}s")

    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: _warmup_complete_sync(
                windows=windows,
                query_delay=query_delay,
                ip_window=ip_window,
                limit=limit,
            )
        )
    except Exception as e:
        logger.warning(f"完整预热异常: {e}", category="缓存")
        _set_warmup_status("ready", 100, "预热完成（部分失败）")


def _warmup_complete_sync(
    windows: list,
    query_delay: float,
    ip_window: str,
    limit: int,
):
    """
    同步执行完整的渐进式缓存预热（在线程池中运行）

    采用温和策略，确保所有数据都预热完成：
    1. 逐个窗口预热排行榜，每个查询之间有延迟
    2. 逐个查询预热 IP 监控
    3. 预热用户统计

    容错机制：
    - 单个查询超时控制（默认60秒）
    - 失败自动重试（最多2次）
    - 部分失败不阻塞其他步骤
    - 详细的错误追踪
    """
    from .risk_monitoring_service import get_risk_monitoring_service
    from .ip_monitoring_service import get_ip_monitoring_service, WINDOW_SECONDS
    from .user_management_service import get_user_management_service
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

    start_time = time.time()
    warmed = []
    failed = []
    steps = []
    total_windows = len(windows)
    step_times = []
    errors_detail = []  # 详细错误记录

    # 容错配置
    QUERY_TIMEOUT = 120  # 单个查询超时（秒）- 大数据量需要更长时间
    MAX_RETRIES = 2      # 最大重试次数
    RETRY_DELAY = 5      # 重试间隔（秒）

    # 计算总步骤数
    total_steps = total_windows + 3 + 1
    current_step = 0

    def update_progress(message: str, step_name: str = None, step_status: str = None):
        nonlocal current_step
        current_step += 1
        progress = 10 + int((current_step / total_steps) * 85)
        if step_name and step_status:
            steps.append({"name": step_name, "status": step_status})
        _set_warmup_status("initializing", min(progress, 95), message, steps)

    def execute_with_timeout_and_retry(func, name: str, timeout: int = QUERY_TIMEOUT) -> tuple:
        """
        带超时和重试的查询执行器

        Returns:
            (success: bool, elapsed: float, error: str or None)
        """
        last_error = None

        for attempt in range(MAX_RETRIES + 1):
            query_start = time.time()
            try:
                with ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(func)
                    future.result(timeout=timeout)

                elapsed = time.time() - query_start
                if attempt > 0:
                    logger.system(f"[预热] {name}: 重试成功 (尝试 {attempt + 1})")
                return True, elapsed, None

            except FuturesTimeoutError:
                elapsed = time.time() - query_start
                last_error = f"超时 ({timeout}s)"
                logger.warning(f"[预热] {name}: 超时 ({elapsed:.1f}s > {timeout}s)", category="缓存")

            except Exception as e:
                elapsed = time.time() - query_start
                last_error = str(e)
                logger.warning(f"[预热] {name}: 失败 - {e}", category="缓存")

            # 重试前等待
            if attempt < MAX_RETRIES:
                retry_wait = RETRY_DELAY * (attempt + 1)  # 递增等待
                logger.system(f"[预热] {name}: 等待 {retry_wait}s 后重试 ({attempt + 2}/{MAX_RETRIES + 1})")
                time.sleep(retry_wait)

        return False, time.time() - query_start, last_error

    # === Step 1: 逐个预热风控排行榜窗口 ===
    logger.system(f"[预热] 排行榜: 共 {total_windows} 个窗口, 超时={QUERY_TIMEOUT}s, 重试={MAX_RETRIES}次")
    _set_warmup_status("initializing", 10, f"正在加载排行榜数据 (0/{total_windows})...", steps)

    leaderboard_start = time.time()
    leaderboard_success = 0
    leaderboard_failed = 0

    try:
        risk_service = get_risk_monitoring_service()

        for idx, window in enumerate(windows):
            update_progress(f"正在加载排行榜: {window} ({idx + 1}/{total_windows})...")

            def query_leaderboard():
                risk_service.get_leaderboards(
                    windows=[window],
                    limit=limit,
                    sort_by="requests",
                    use_cache=False,
                )

            success, elapsed, error = execute_with_timeout_and_retry(
                query_leaderboard,
                f"排行榜 {window}",
                timeout=QUERY_TIMEOUT
            )

            if success:
                leaderboard_success += 1
                logger.system(f"[预热] 排行榜 {window}: {elapsed:.2f}s ✓")
            else:
                leaderboard_failed += 1
                errors_detail.append(f"排行榜 {window}: {error}")
                logger.warning(f"[预热] 排行榜 {window}: 失败 ✗ ({error})", category="缓存")

            # 延迟
            if query_delay > 0:
                time.sleep(query_delay)

        leaderboard_elapsed = time.time() - leaderboard_start
        step_times.append(f"排行榜={leaderboard_elapsed:.1f}s({leaderboard_success}/{total_windows})")

        if leaderboard_failed == 0:
            warmed.append(f"排行榜({total_windows}个窗口)")
            steps.append({"name": "排行榜", "status": "done"})
        elif leaderboard_success > 0:
            warmed.append(f"排行榜({leaderboard_success}/{total_windows})")
            failed.append(f"排行榜({leaderboard_failed}失败)")
            steps.append({"name": "排行榜", "status": "partial"})
        else:
            failed.append("排行榜(全部失败)")
            steps.append({"name": "排行榜", "status": "error"})

        logger.system(f"[预热] 排行榜完成: {leaderboard_success}/{total_windows} 成功, 耗时 {leaderboard_elapsed:.1f}s")

    except Exception as e:
        logger.error(f"[预热] 排行榜服务异常: {e}", category="缓存")
        steps.append({"name": "排行榜", "status": "error", "error": str(e)})
        failed.append("排行榜(服务异常)")
        errors_detail.append(f"排行榜服务: {e}")

    # === Step 2: 预热 IP 监控数据（多窗口 + 大 limit）===
    # 预热多个时间窗口，匹配前端请求的 limit=200
    IP_WARMUP_LIMIT = 200  # 前端请求的最大 limit
    IP_WARMUP_WINDOWS = ["1h", "24h", "7d"]  # 预热的时间窗口

    logger.system(f"[预热] IP监控: 窗口={IP_WARMUP_WINDOWS}, limit={IP_WARMUP_LIMIT}")
    ip_start = time.time()
    ip_success = 0
    ip_failed = 0
    ip_total = len(IP_WARMUP_WINDOWS) * 3  # 3种查询 × N个窗口

    try:
        ip_service = get_ip_monitoring_service()

        for window_key in IP_WARMUP_WINDOWS:
            window_seconds = WINDOW_SECONDS.get(window_key, 86400)

            ip_queries = [
                (f"共享IP({window_key})", lambda ws=window_seconds: ip_service.get_shared_ips(
                    window_seconds=ws, min_tokens=2, limit=IP_WARMUP_LIMIT, use_cache=False
                )),
                (f"多IP令牌({window_key})", lambda ws=window_seconds: ip_service.get_multi_ip_tokens(
                    window_seconds=ws, min_ips=2, limit=IP_WARMUP_LIMIT, use_cache=False
                )),
                (f"多IP用户({window_key})", lambda ws=window_seconds: ip_service.get_multi_ip_users(
                    window_seconds=ws, min_ips=3, limit=IP_WARMUP_LIMIT, use_cache=False
                )),
            ]

            for query_name, query_func in ip_queries:
                update_progress(f"正在加载{query_name}数据...")

                success, elapsed, error = execute_with_timeout_and_retry(
                    query_func,
                    query_name,
                    timeout=QUERY_TIMEOUT
                )

                if success:
                    ip_success += 1
                    logger.system(f"[预热] {query_name}: {elapsed:.2f}s ✓")
                else:
                    ip_failed += 1
                    errors_detail.append(f"{query_name}: {error}")
                    logger.warning(f"[预热] {query_name}: 失败 ✗ ({error})", category="缓存")

                if query_delay > 0:
                    time.sleep(query_delay)

        ip_elapsed = time.time() - ip_start
        step_times.append(f"IP监控={ip_elapsed:.1f}s({ip_success}/{ip_total})")

        if ip_failed == 0:
            warmed.append(f"IP监控({len(IP_WARMUP_WINDOWS)}窗口)")
            steps.append({"name": "IP监控", "status": "done"})
        elif ip_success > 0:
            warmed.append(f"IP监控({ip_success}/{ip_total})")
            failed.append(f"IP监控({ip_failed}失败)")
            steps.append({"name": "IP监控", "status": "partial"})
        else:
            failed.append("IP监控(全部失败)")
            steps.append({"name": "IP监控", "status": "error"})

        # 预热 IP Stats（IP记录状态统计）
        update_progress("正在加载IP记录状态...")
        success, elapsed, error = execute_with_timeout_and_retry(
            lambda: ip_service.get_ip_recording_stats(use_cache=False),
            "IP Stats",
            timeout=QUERY_TIMEOUT
        )
        if success:
            logger.system(f"[预热] IP Stats: {elapsed:.2f}s ✓")
        else:
            logger.warning(f"[预热] IP Stats: 失败 ✗ ({error})", category="缓存")

        logger.system(f"[预热] IP监控完成: {ip_success}/{ip_total} 成功, 耗时 {ip_elapsed:.1f}s")

    except Exception as e:
        logger.error(f"[预热] IP监控服务异常: {e}", category="缓存")
        steps.append({"name": "IP监控", "status": "error", "error": str(e)})
        failed.append("IP监控(服务异常)")
        errors_detail.append(f"IP监控服务: {e}")

    # === Step 3: 预热用户统计 ===
    logger.system("[预热] 用户统计")
    update_progress("正在加载用户统计数据...")
    stats_start = time.time()

    try:
        user_service = get_user_management_service()

        def query_stats():
            user_service.get_activity_stats()

        success, elapsed, error = execute_with_timeout_and_retry(
            query_stats,
            "用户统计",
            timeout=QUERY_TIMEOUT
        )

        if success:
            step_times.append(f"用户统计={elapsed:.1f}s")
            warmed.append("用户统计")
            steps.append({"name": "用户统计", "status": "done"})
            logger.system(f"[预热] 用户统计: {elapsed:.2f}s ✓")
        else:
            failed.append("用户统计")
            errors_detail.append(f"用户统计: {error}")
            steps.append({"name": "用户统计", "status": "error", "error": error})
            logger.warning(f"[预热] 用户统计: 失败 ✗ ({error})", category="缓存")

    except Exception as e:
        logger.error(f"[预热] 用户统计服务异常: {e}", category="缓存")
        steps.append({"name": "用户统计", "status": "error", "error": str(e)})
        failed.append("用户统计(服务异常)")
        errors_detail.append(f"用户统计服务: {e}")

    elapsed = time.time() - start_time

    # 确定最终状态
    if failed:
        status_msg = f"预热完成（部分失败），耗时 {elapsed:.1f}s"
    else:
        status_msg = f"预热完成，耗时 {elapsed:.1f}s"

    _set_warmup_status("ready", 100, status_msg, steps)

    # 输出预热摘要
    logger.system("=" * 50)
    logger.system("[预热摘要]")
    logger.system(f"  成功: {', '.join(warmed) if warmed else '无'}")
    if failed:
        logger.system(f"  失败: {', '.join(failed)}")
    logger.system(f"  各步耗时: {', '.join(step_times)}")
    logger.system(f"  总耗时: {elapsed:.1f}s")

    if errors_detail:
        logger.system("-" * 30)
        logger.system("[错误详情]")
        for err in errors_detail:
            logger.system(f"  - {err}")

    logger.system("=" * 50)


async def _do_cache_warmup(is_initial: bool = False):
    """执行缓存预热"""
    import asyncio
    
    try:
        loop = asyncio.get_event_loop()
        
        # 在线程池中执行同步操作，避免阻塞事件循环
        await loop.run_in_executor(None, lambda: _warmup_sync(is_initial))
        
    except Exception as e:
        logger.warning(f"缓存预热异常: {e}", category="缓存")
        if is_initial:
            _set_warmup_status("ready", 100, "预热完成（部分失败）")


def _warmup_sync(is_initial: bool = False):
    """
    同步执行缓存预热（在线程池中运行）

    用于定期刷新缓存，采用温和策略：
    - 逐个窗口预热，每个查询之间有延迟
    - 根据系统规模调整参数
    - 带超时和重试的容错机制
    """
    from .risk_monitoring_service import get_risk_monitoring_service
    from .ip_monitoring_service import get_ip_monitoring_service, WINDOW_SECONDS
    from .user_management_service import get_user_management_service
    from .system_scale_service import get_detected_settings
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

    start_time = time.time()
    warmed = []
    failed = []

    # 定时刷新的容错配置（比初始预热更宽松）
    REFRESH_TIMEOUT = 60  # 单个查询超时（秒）
    REFRESH_RETRIES = 1   # 最大重试次数

    def execute_with_timeout(func, name: str) -> bool:
        """带超时和重试的查询执行器（定时刷新版本）"""
        for attempt in range(REFRESH_RETRIES + 1):
            try:
                with ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(func)
                    future.result(timeout=REFRESH_TIMEOUT)
                return True
            except FuturesTimeoutError:
                logger.warning(f"[刷新] {name}: 超时 ({REFRESH_TIMEOUT}s)", category="缓存")
            except Exception as e:
                logger.warning(f"[刷新] {name}: 失败 - {e}", category="缓存")

            if attempt < REFRESH_RETRIES:
                time.sleep(2)  # 短暂等待后重试

        return False

    # 获取当前系统规模设置
    settings = get_detected_settings()
    scale = settings.scale.value

    # 根据系统规模确定策略
    strategy = WARMUP_STRATEGY.get(scale, WARMUP_STRATEGY["medium"])
    query_delay = strategy["query_delay"]
    all_windows = strategy["windows"]
    ip_window = strategy["ip_window"]

    # Step 1: 逐个预热风控排行榜窗口（温和方式）
    leaderboard_success = 0
    leaderboard_failed = 0

    try:
        risk_service = get_risk_monitoring_service()

        for idx, window in enumerate(all_windows):
            def query_leaderboard():
                risk_service.get_leaderboards(
                    windows=[window],
                    limit=10,
                    sort_by="requests",
                    use_cache=False,
                )

            if execute_with_timeout(query_leaderboard, f"排行榜 {window}"):
                leaderboard_success += 1
            else:
                leaderboard_failed += 1

            # 延迟，给数据库喘息的机会
            if query_delay > 0 and idx < len(all_windows) - 1:
                time.sleep(query_delay)

        if leaderboard_failed == 0:
            warmed.append("排行榜")
        elif leaderboard_success > 0:
            warmed.append(f"排行榜({leaderboard_success}/{len(all_windows)})")
            failed.append(f"排行榜({leaderboard_failed}失败)")
        else:
            failed.append("排行榜")
    except Exception as e:
        logger.warning(f"排行榜服务异常: {e}", category="缓存")
        failed.append("排行榜(服务异常)")

    # 延迟后继续
    if query_delay > 0:
        time.sleep(query_delay)

    # Step 2: 预热 IP 监控数据（多窗口 + 大 limit）
    IP_REFRESH_LIMIT = 200  # 匹配前端请求的 limit
    IP_REFRESH_WINDOWS = ["1h", "24h", "7d"]  # 刷新的时间窗口

    ip_success = 0
    ip_failed = 0
    ip_total = len(IP_REFRESH_WINDOWS) * 3

    try:
        ip_service = get_ip_monitoring_service()

        for window_key in IP_REFRESH_WINDOWS:
            window_seconds = WINDOW_SECONDS.get(window_key, 86400)

            # 共享 IP
            if execute_with_timeout(
                lambda ws=window_seconds: ip_service.get_shared_ips(
                    window_seconds=ws,
                    min_tokens=2,
                    limit=IP_REFRESH_LIMIT,
                    use_cache=False
                ),
                f"共享IP({window_key})"
            ):
                ip_success += 1
            else:
                ip_failed += 1

            if query_delay > 0:
                time.sleep(query_delay)

            # 多 IP 令牌
            if execute_with_timeout(
                lambda ws=window_seconds: ip_service.get_multi_ip_tokens(
                    window_seconds=ws,
                    min_ips=2,
                    limit=IP_REFRESH_LIMIT,
                    use_cache=False
                ),
                f"多IP令牌({window_key})"
            ):
                ip_success += 1
            else:
                ip_failed += 1

            if query_delay > 0:
                time.sleep(query_delay)

            # 多 IP 用户
            if execute_with_timeout(
                lambda ws=window_seconds: ip_service.get_multi_ip_users(
                    window_seconds=ws,
                    min_ips=3,
                    limit=IP_REFRESH_LIMIT,
                    use_cache=False
                ),
                f"多IP用户({window_key})"
            ):
                ip_success += 1
            else:
                ip_failed += 1

            if query_delay > 0:
                time.sleep(query_delay)

        if ip_failed == 0:
            warmed.append(f"IP监控({len(IP_REFRESH_WINDOWS)}窗口)")
        elif ip_success > 0:
            warmed.append(f"IP监控({ip_success}/{ip_total})")
            failed.append(f"IP监控({ip_failed}失败)")
        else:
            failed.append("IP监控")

        # 刷新 IP Stats（IP记录状态统计）
        if execute_with_timeout(
            lambda: ip_service.get_ip_recording_stats(use_cache=False),
            "IP Stats"
        ):
            pass  # IP Stats 不单独计入 warmed，包含在 IP监控 中
        # IP Stats 失败不单独报告

    except Exception as e:
        logger.warning(f"IP监控服务异常: {e}", category="缓存")
        failed.append("IP监控(服务异常)")

    # 延迟后继续
    if query_delay > 0:
        time.sleep(query_delay)

    # Step 3: 预热用户统计
    try:
        user_service = get_user_management_service()
        if execute_with_timeout(
            lambda: user_service.get_activity_stats(),
            "用户统计"
        ):
            warmed.append("用户统计")
        else:
            failed.append("用户统计")
    except Exception as e:
        logger.warning(f"用户统计服务异常: {e}", category="缓存")
        failed.append("用户统计(服务异常)")

    elapsed = time.time() - start_time

    # 输出刷新结果
    if warmed and not failed:
        logger.system(f"定时缓存刷新完成: {', '.join(warmed)} | 耗时 {elapsed:.2f}s")
    elif warmed:
        logger.system(f"定时缓存刷新部分完成: 成功=[{', '.join(warmed)}] 失败=[{', '.join(failed)}] | 耗时 {elapsed:.2f}s")
    elif failed:
        logger.warning(f"定时缓存刷新失败: {', '.join(failed)} | 耗时 {elapsed:.2f}s", category="缓存")


async def background_ai_auto_ban_scan():
    """后台定时执行 AI 自动封禁扫描"""
    from .ai_auto_ban_service import get_ai_auto_ban_service

    # 预热完成后立即启动
    logger.success("AI 自动封禁后台任务已启动", category="任务")

    while True:
        try:
            service = get_ai_auto_ban_service()

            # 检查是否启用定时扫描
            scan_interval = service.get_scan_interval()
            if scan_interval <= 0:
                # 定时扫描已关闭，等待 1 分钟后再检查配置
                await asyncio.sleep(60)
                continue

            # 检查服务是否启用
            if not service.is_enabled():
                await asyncio.sleep(60)
                continue

            # 先等待配置的扫描间隔，再执行扫描
            logger.system(f"AI 自动封禁: 等待 {scan_interval} 分钟后执行定时扫描")
            await asyncio.sleep(scan_interval * 60)
            
            # 再次检查配置（可能在等待期间被修改）
            service = get_ai_auto_ban_service()
            if not service.is_enabled() or service.get_scan_interval() <= 0:
                continue

            # 执行扫描
            logger.system(f"AI 自动封禁: 开始定时扫描 (间隔: {scan_interval}分钟)")
            result = await service.run_scan(window="1h", limit=10)

            if result.get("success"):
                stats = result.get("stats", {})
                if stats.get("total_scanned", 0) > 0:
                    logger.business(
                        "AI 自动封禁定时扫描完成",
                        scanned=stats.get("total_scanned", 0),
                        banned=stats.get("banned", 0),
                        warned=stats.get("warned", 0),
                        dry_run=result.get("dry_run", True),
                    )

        except asyncio.CancelledError:
            logger.system("AI 自动封禁后台任务已取消")
            break
        except Exception as e:
            logger.error(f"AI 自动封禁后台任务异常: {e}", category="任务")
            # 出错后等待 5 分钟再重试
            await asyncio.sleep(300)


async def background_geoip_update():
    """后台定时更新 GeoIP 数据库（每天一次）"""
    from .ip_geo_service import update_all_geoip_databases, get_ip_geo_service, GEOIP_UPDATE_INTERVAL

    # 启动后等待 60 秒，让其他服务先初始化
    await asyncio.sleep(60)
    
    # 检查并初始化 GeoIP 数据库
    service = get_ip_geo_service()
    if not service.is_available():
        logger.system("[GeoIP] 数据库不可用，尝试下载...")
        try:
            result = await update_all_geoip_databases(force=True)
            if result["success"]:
                logger.system("[GeoIP] 数据库下载完成")
            else:
                logger.warning(f"[GeoIP] 数据库下载失败: {result}")
        except Exception as e:
            logger.error(f"[GeoIP] 数据库下载异常: {e}")
    else:
        logger.success("GeoIP 数据库已就绪，后台更新任务已启动", category="任务")

    while True:
        try:
            # 等待更新间隔（默认 24 小时）
            logger.system(f"[GeoIP] 下次更新检查在 {GEOIP_UPDATE_INTERVAL // 3600} 小时后")
            await asyncio.sleep(GEOIP_UPDATE_INTERVAL)
            
            # 执行更新
            logger.system("[GeoIP] 开始检查数据库更新...")
            result = await update_all_geoip_databases(force=False)
            
            if result["city"]["success"] or result["asn"]["success"]:
                logger.system(
                    f"[GeoIP] 更新完成 - City: {result['city']['message']}, ASN: {result['asn']['message']}"
                )
            else:
                logger.debug(f"[GeoIP] 无需更新 - {result['city']['message']}, {result['asn']['message']}")

        except asyncio.CancelledError:
            logger.system("[GeoIP] 后台更新任务已取消")
            break
        except Exception as e:
            logger.error(f"[GeoIP] 后台更新任务异常: {e}", category="任务")
            # 出错后等待 1 小时再重试
            await asyncio.sleep(3600)


async def background_auto_group_scan():
    """后台定时执行自动分组扫描"""
    from .auto_group_service import get_auto_group_service

    # 预热完成后等待 2 分钟再启动
    await asyncio.sleep(120)
    logger.success("自动分组后台任务已启动", category="任务")

    while True:
        try:
            service = get_auto_group_service()

            # 检查是否启用定时扫描
            scan_interval = service.get_scan_interval()
            if scan_interval <= 0:
                # 定时扫描已关闭，等待 1 分钟后再检查配置
                await asyncio.sleep(60)
                continue

            # 检查服务是否启用
            if not service.is_enabled():
                await asyncio.sleep(60)
                continue

            # 先等待配置的扫描间隔，再执行扫描
            logger.system(f"自动分组: 等待 {scan_interval} 分钟后执行定时扫描")
            await asyncio.sleep(scan_interval * 60)

            # 再次检查配置（可能在等待期间被修改）
            service = get_auto_group_service()
            if not service.is_enabled() or service.get_scan_interval() <= 0:
                continue

            # 执行扫描（非试运行模式）
            logger.system(f"自动分组: 开始定时扫描 (间隔: {scan_interval}分钟)")
            result = service.run_scan(dry_run=False, operator="system")

            if result.get("success"):
                stats = result.get("stats", {})
                if stats.get("total", 0) > 0:
                    logger.business(
                        "自动分组定时扫描完成",
                        total=stats.get("total", 0),
                        assigned=stats.get("assigned", 0),
                        skipped=stats.get("skipped", 0),
                        errors=stats.get("errors", 0),
                    )

        except asyncio.CancelledError:
            logger.system("自动分组后台任务已取消")
            break
        except Exception as e:
            logger.error(f"自动分组后台任务异常: {e}", category="任务")
            # 出错后等待 5 分钟再重试
            await asyncio.sleep(300)


# Import routes after app is created to avoid circular imports
def include_routes(app: FastAPI):
    """Include API routes."""
    from .routes import router
    from .auth_routes import router as auth_router
    from .top_up_routes import router as top_up_router
    from .dashboard_routes import router as dashboard_router
    from .storage_routes import router as storage_router
    from .log_analytics_routes import router as analytics_router
    from .user_management_routes import router as user_management_router
    from .risk_monitoring_routes import router as risk_monitoring_router
    from .ip_monitoring_routes import router as ip_monitoring_router
    from .ai_auto_ban_routes import router as ai_auto_ban_router
    from .system_routes import router as system_router
    from .model_status_routes import router as model_status_router
    from .auto_group_routes import router as auto_group_router
    app.include_router(router)
    app.include_router(auth_router)
    app.include_router(top_up_router)
    app.include_router(dashboard_router)
    app.include_router(storage_router)
    app.include_router(analytics_router)
    app.include_router(user_management_router)
    app.include_router(risk_monitoring_router)
    app.include_router(ip_monitoring_router)
    app.include_router(ai_auto_ban_router)
    app.include_router(system_router)
    app.include_router(model_status_router)
    app.include_router(auto_group_router)


# Create FastAPI application
app = FastAPI(
    title="NewAPI Middleware Tool",
    description="API for managing NewAPI redemption codes and database operations",
    version="0.1.0",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Will be configured via environment variable in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
include_routes(app)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all API requests with timestamp and client information."""
    # Skip logging for health check endpoints
    if request.url.path in ["/api/health", "/api/health/db"]:
        return await call_next(request)

    start_time = time.time()
    client_host = request.client.host if request.client else "unknown"

    response = await call_next(request)

    process_time = time.time() - start_time
    status_code = response.status_code

    # Use the new logger for API requests
    if status_code >= 500:
        logger.api_error(
            request.method,
            request.url.path,
            status_code,
            "服务器内部错误",
            client_host
        )
    elif status_code == 401:
        # 401 认证失败是正常流程（token 过期等），用 WARN 级别
        logger.api_warn(
            request.method,
            request.url.path,
            status_code,
            "认证失败",
            client_host
        )
    elif status_code >= 400:
        logger.api_error(
            request.method,
            request.url.path,
            status_code,
            "客户端错误",
            client_host
        )
    else:
        logger.api(
            request.method,
            request.url.path,
            status_code,
            process_time,
            client_host
        )

    return response


@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    """Handle application-specific exceptions."""
    logger.error(f"应用异常: {exc.code} - {exc.message}", category="系统")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details
            }
        }
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions."""
    logger.error(f"未预期异常: {exc}", category="系统", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred",
                "details": None
            }
        }
    )


@app.get("/api/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """Health check endpoint."""
    return HealthResponse(status="healthy", version="0.1.0")


@app.get("/api/health/db", tags=["Health"])
async def database_health_check():
    """Database health check endpoint."""
    from .database import get_db_manager
    
    db = get_db_manager()
    try:
        db.connect()
        return {
            "success": True,
            "status": "connected",
            "engine": db.config.engine.value,
            "host": db.config.host,
            "database": db.config.database,
        }
    except DatabaseConnectionError as e:
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "status": "disconnected",
                "error": {
                    "code": e.code,
                    "message": e.message,
                    "details": e.details
                }
            }
        )

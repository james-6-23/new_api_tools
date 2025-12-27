"""
NewAPI Middleware Tool - FastAPI Backend
Main application entry point with CORS, logging, and exception handling.
"""
import asyncio
import logging
import threading
import time
from contextlib import asynccontextmanager
from typing import Any

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
            logger.system(
                f"系统规模检测完成: {settings.get('description', '未知')} | "
                f"用户={metrics.get('total_users', 0)} | "
                f"24h活跃={metrics.get('active_users_24h', 0)} | "
                f"24h日志={metrics.get('logs_24h', 0):,} | "
                f"RPM={metrics.get('rpm_avg', 0):.1f} | "
                f"推荐刷新间隔={settings.get('frontend_refresh_interval', 60)}s"
            )
        except Exception as e:
            logger.warning(f"系统规模检测失败: {e}", category="系统")
    except Exception as e:
        logger.warning(f"数据库初始化失败: {e}", category="数据库")

    # 启动后台日志同步任务
    sync_task = asyncio.create_task(background_log_sync())

    # 启动后台索引创建任务（仅当有缺失索引时）
    index_task = None
    if db and not index_status.get("all_ready", True):
        index_task = asyncio.create_task(background_ensure_indexes())

    # 启动 AI 自动封禁后台任务
    ai_ban_task = asyncio.create_task(background_ai_auto_ban_scan())

    # 启动后台缓存预热任务
    cache_warmup_task = asyncio.create_task(background_cache_warmup())

    # 启动 GeoIP 数据库自动更新任务
    geoip_update_task = asyncio.create_task(background_geoip_update())

    yield

    # 停止后台任务
    sync_task.cancel()
    ai_ban_task.cancel()
    cache_warmup_task.cancel()
    geoip_update_task.cancel()
    if index_task:
        index_task.cancel()
    try:
        await sync_task
    except asyncio.CancelledError:
        pass
    try:
        await ai_ban_task
    except asyncio.CancelledError:
        pass
    try:
        await cache_warmup_task
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


async def background_log_sync():
    """后台定时同步日志分析数据"""
    from .log_analytics_service import get_log_analytics_service

    # 启动后等待 10 秒再开始同步
    await asyncio.sleep(10)
    logger.system("后台日志同步任务已启动")

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


async def background_cache_warmup():
    """
    后台缓存预热任务 - 智能恢复模式
    
    新策略：
    1. 优先从 SQLite 恢复缓存（秒级恢复）
    2. 仅缺失的窗口才查询 PostgreSQL
    3. 恢复后进入定时刷新循环
    """
    from .system_scale_service import get_detected_settings, get_scale_service, SystemScale
    from .database import get_db_manager
    from .cache_manager import get_cache_manager

    warmup_start_time = time.time()

    # 启动后等待 3 秒，让数据库连接就绪
    await asyncio.sleep(3)
    logger.system("=" * 50)
    logger.system("缓存恢复任务启动")
    logger.system("=" * 50)

    _set_warmup_status("initializing", 0, "正在初始化缓存...")

    # 获取缓存管理器
    cache = get_cache_manager()
    
    # 阶段1：从 SQLite 恢复到 Redis（如果 Redis 可用）
    if cache.redis_available:
        logger.system("[阶段1] 从 SQLite 恢复缓存到 Redis")
        restored = cache.restore_to_redis()
        if restored > 0:
            logger.system(f"[阶段1] 恢复完成: {restored} 条数据")
    else:
        logger.system("[阶段1] Redis 未配置，使用纯 SQLite 模式")
    
    # 阶段2：检查缓存有效性
    _set_warmup_status("initializing", 20, "正在检查缓存有效性...")
    
    windows = ["1h", "3h", "6h", "12h", "24h", "3d", "7d"]
    cached_windows = cache.get_cached_windows()
    missing_windows = [w for w in windows if w not in cached_windows]
    
    if not missing_windows:
        # 所有缓存都有效，直接完成
        elapsed = time.time() - warmup_start_time
        _set_warmup_status("ready", 100, f"缓存恢复完成，耗时 {elapsed:.2f}s")
        logger.system(f"[完成] 所有缓存有效，无需预热，耗时 {elapsed:.2f}s")
        logger.system("=" * 50)
        
        # 进入定时刷新循环
        await _background_refresh_loop(cache)
        return
    
    logger.system(f"[阶段2] 已缓存: {cached_windows or '无'}")
    logger.system(f"[阶段2] 需预热: {missing_windows}")
    
    # 检测系统规模
    scale_service = get_scale_service()
    scale_result = scale_service.detect_scale()
    scale = SystemScale(scale_result["scale"])
    metrics = scale_result.get("metrics", {})

    # 输出系统规模详情
    logger.system(f"[规模检测] 系统规模: {scale.value}")
    logger.system(f"[规模检测] 总用户数: {metrics.get('total_users', 0):,}")
    logger.system(f"[规模检测] 活跃用户(24h): {metrics.get('active_users_24h', 0):,}")
    logger.system(f"[规模检测] 日志数(24h): {metrics.get('logs_24h', 0):,}")
    logger.system(f"[规模检测] 总日志数: {metrics.get('total_logs', 0):,}")
    logger.system(f"[规模检测] 平均 RPM: {metrics.get('rpm_avg', 0):.1f}")

    # 获取预热策略
    strategy = WARMUP_STRATEGY.get(scale.value, WARMUP_STRATEGY["medium"])
    query_delay = strategy['query_delay']

    # === 阶段3：仅预热缺失的窗口 ===
    logger.system("-" * 50)
    logger.system("[阶段3] 预热缺失的窗口")
    _set_warmup_status("initializing", 30, f"正在预热 {len(missing_windows)} 个窗口...")

    from .risk_monitoring_service import get_risk_monitoring_service
    service = get_risk_monitoring_service()
    
    warmed = []
    failed = []
    total_to_warm = len(missing_windows)
    
    for idx, window in enumerate(missing_windows):
        progress = 30 + int((idx / max(total_to_warm, 1)) * 60)
        _set_warmup_status("initializing", progress, f"正在预热: {window}")
        
        try:
            # 查询 PostgreSQL（只读）
            data = service.get_leaderboards(
                windows=[window],
                limit=50,
                sort_by="requests",
                use_cache=False
            )
            
            if data and window in data.get("windows", {}):
                warmed.append(window)
                logger.system(f"[预热] {window} 完成")
            else:
                failed.append(window)
                logger.warning(f"[预热] {window} 无数据")
                
        except Exception as e:
            failed.append(window)
            logger.warning(f"[预热] {window} 失败: {e}")
        
        # 延迟，避免数据库压力
        if query_delay > 0 and idx < total_to_warm - 1:
            await asyncio.sleep(query_delay)

    # 完成
    total_elapsed = time.time() - warmup_start_time
    
    if failed:
        _set_warmup_status("ready", 100, f"预热完成（部分失败），耗时 {total_elapsed:.1f}s")
        logger.system(f"[完成] 成功: {warmed}, 失败: {failed}")
    else:
        _set_warmup_status("ready", 100, f"预热完成，耗时 {total_elapsed:.1f}s")
        logger.system(f"[完成] 全部成功: {warmed}")
    
    logger.system(f"[完成] 总耗时: {total_elapsed:.1f}s")
    logger.system("=" * 50)

    # 进入定时刷新循环
    await _background_refresh_loop(cache)


async def _background_refresh_loop(cache):
    """后台定时刷新缓存"""
    from .system_scale_service import get_detected_settings
    from .risk_monitoring_service import get_risk_monitoring_service
    
    windows = ["1h", "3h", "6h", "12h", "24h", "3d", "7d"]
    
    while True:
        try:
            settings = get_detected_settings()
            interval = settings.leaderboard_cache_ttl
            
            logger.debug(f"[定时刷新] 下次刷新在 {interval}s 后")
            await asyncio.sleep(interval)
            
            # 刷新所有窗口
            service = get_risk_monitoring_service()
            refresh_start = time.time()
            
            for window in windows:
                try:
                    service.get_leaderboards(
                        windows=[window],
                        limit=50,
                        use_cache=False
                    )
                except Exception:
                    pass
            
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

    # === Step 2: 预热 IP 监控数据 ===
    logger.system(f"[预热] IP监控: 窗口={ip_window}")
    ip_start = time.time()
    ip_success = 0
    ip_failed = 0

    try:
        ip_service = get_ip_monitoring_service()
        window_seconds = WINDOW_SECONDS.get(ip_window, 86400)

        ip_queries = [
            ("共享IP", lambda: ip_service.get_shared_ips(
                window_seconds=window_seconds, min_tokens=2, limit=50, use_cache=False
            )),
            ("多IP令牌", lambda: ip_service.get_multi_ip_tokens(
                window_seconds=window_seconds, min_ips=2, limit=50, use_cache=False
            )),
            ("多IP用户", lambda: ip_service.get_multi_ip_users(
                window_seconds=window_seconds, min_ips=3, limit=50, use_cache=False
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
        step_times.append(f"IP监控={ip_elapsed:.1f}s({ip_success}/3)")

        if ip_failed == 0:
            warmed.append(f"IP监控({ip_window})")
            steps.append({"name": "IP监控", "status": "done"})
        elif ip_success > 0:
            warmed.append(f"IP监控({ip_success}/3)")
            failed.append(f"IP监控({ip_failed}失败)")
            steps.append({"name": "IP监控", "status": "partial"})
        else:
            failed.append("IP监控(全部失败)")
            steps.append({"name": "IP监控", "status": "error"})

        logger.system(f"[预热] IP监控完成: {ip_success}/3 成功, 耗时 {ip_elapsed:.1f}s")

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

    # Step 2: 预热 IP 监控数据（温和方式）
    ip_success = 0
    ip_failed = 0

    try:
        ip_service = get_ip_monitoring_service()
        window_seconds = WINDOW_SECONDS.get(ip_window, 86400)

        # 共享 IP
        if execute_with_timeout(
            lambda: ip_service.get_shared_ips(
                window_seconds=window_seconds,
                min_tokens=2,
                limit=30,
                use_cache=False
            ),
            "共享IP"
        ):
            ip_success += 1
        else:
            ip_failed += 1

        if query_delay > 0:
            time.sleep(query_delay)

        # 多 IP 令牌
        if execute_with_timeout(
            lambda: ip_service.get_multi_ip_tokens(
                window_seconds=window_seconds,
                min_ips=2,
                limit=30,
                use_cache=False
            ),
            "多IP令牌"
        ):
            ip_success += 1
        else:
            ip_failed += 1

        if query_delay > 0:
            time.sleep(query_delay)

        # 多 IP 用户
        if execute_with_timeout(
            lambda: ip_service.get_multi_ip_users(
                window_seconds=window_seconds,
                min_ips=3,
                limit=30,
                use_cache=False
            ),
            "多IP用户"
        ):
            ip_success += 1
        else:
            ip_failed += 1

        if ip_failed == 0:
            warmed.append("IP监控")
        elif ip_success > 0:
            warmed.append(f"IP监控({ip_success}/3)")
            failed.append(f"IP监控({ip_failed}失败)")
        else:
            failed.append("IP监控")
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

    # 启动后等待 30 秒再开始
    await asyncio.sleep(30)
    logger.system("AI 自动封禁后台任务已启动")

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
        logger.system("[GeoIP] 数据库已就绪，后台更新任务已启动")

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

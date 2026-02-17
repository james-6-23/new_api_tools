"""
日志管理器模块 - NewAPI Middleware Tool
支持多种日志类型、中文信息、格式化输出
"""
import logging
import sys
import os
from datetime import datetime
from enum import Enum
from typing import Any, Optional
from functools import wraps
import time


class LogCategory(Enum):
    """日志分类"""
    SYSTEM = "系统"      # 系统启动、关闭、配置
    API = "接口"         # API请求响应
    DATABASE = "数据库"  # 数据库操作
    AUTH = "认证"        # 登录、授权、Token
    BUSINESS = "业务"    # 业务逻辑操作
    ANALYTICS = "分析"   # 日志分析相关
    SECURITY = "安全"    # 安全相关事件
    TASK = "任务"        # 后台任务、定时任务


class LogLevel(Enum):
    """日志级别"""
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARN = "WARN"
    ERROR = "ERROR"
    FATAL = "FATAL"


# ANSI 颜色代码
class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    ITALIC = "\033[3m"
    UNDERLINE = "\033[4m"

    # 前景色
    BLACK = "\033[30m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"
    WHITE = "\033[37m"
    GRAY = "\033[90m"

    # 亮色
    BRIGHT_RED = "\033[91m"
    BRIGHT_GREEN = "\033[92m"
    BRIGHT_YELLOW = "\033[93m"
    BRIGHT_BLUE = "\033[94m"
    BRIGHT_MAGENTA = "\033[95m"
    BRIGHT_CYAN = "\033[96m"
    BRIGHT_WHITE = "\033[97m"

    # 背景色
    BG_RED = "\033[41m"
    BG_GREEN = "\033[42m"
    BG_YELLOW = "\033[43m"
    BG_BLUE = "\033[44m"
    BG_MAGENTA = "\033[45m"
    BG_CYAN = "\033[46m"
    BG_GRAY = "\033[100m"


class LogFormatter(logging.Formatter):
    """自定义日志格式化器，支持颜色和对齐"""

    # 日志级别颜色映射
    LEVEL_COLORS = {
        "DEBUG": Colors.BRIGHT_BLUE,
        "INFO": Colors.BRIGHT_GREEN,
        "WARN": Colors.BRIGHT_YELLOW,
        "WARNING": Colors.BRIGHT_YELLOW,
        "ERROR": Colors.BRIGHT_RED,
        "FATAL": Colors.BG_RED + Colors.WHITE,
        "CRITICAL": Colors.BG_RED + Colors.WHITE,
    }

    # 分类颜色映射
    CATEGORY_COLORS = {
        "系统": Colors.BRIGHT_CYAN,
        "接口": Colors.BRIGHT_BLUE,
        "数据库": Colors.BRIGHT_MAGENTA,
        "认证": Colors.BRIGHT_YELLOW,
        "业务": Colors.BRIGHT_GREEN,
        "分析": Colors.CYAN,
        "安全": Colors.BRIGHT_RED,
        "任务": Colors.MAGENTA,
    }

    def __init__(self, use_color: bool = True):
        super().__init__()
        self.use_color = use_color and sys.stdout.isatty()

    def format(self, record: logging.LogRecord) -> str:
        # 时间戳
        timestamp = datetime.fromtimestamp(record.created).strftime("%Y-%m-%d %H:%M:%S")

        # 日志级别 (5字符宽度)
        level = record.levelname
        if level == "WARNING":
            level = "WARN"
        level_str = f"{level:<5}"

        # 分类 (从 extra 中获取，默认为"系统")
        category = getattr(record, 'category', '系统')
        category_str = f"[{category}]"
        # 中文字符占2个宽度，计算填充
        cn_chars = sum(1 for c in category if '\u4e00' <= c <= '\u9fff')
        padding = 6 - len(category) - cn_chars
        category_str = f"{category_str}{' ' * max(0, padding)}"

        # 消息
        message = record.getMessage()

        # 应用颜色
        if self.use_color:
            level_color = self.LEVEL_COLORS.get(record.levelname, "")
            category_color = self.CATEGORY_COLORS.get(category, "")

            level_str = f"{level_color}{level_str}{Colors.RESET}"
            category_str = f"{category_color}{category_str}{Colors.RESET}"

        # 组装日志
        log_line = f"{timestamp} | {level_str} | {category_str} | {message}"

        # 添加异常信息
        if record.exc_info:
            log_line += "\n" + self.formatException(record.exc_info)

        return log_line


class AppLogger:
    """
    应用日志管理器

    使用示例:
        from app.logger import logger

        logger.info("系统启动完成", category="系统")
        logger.business("用户登录成功", user_id=123, username="test")
        logger.db("执行查询", table="users", rows=100)
        logger.security("登录失败", ip="192.168.1.1", reason="密码错误")
    """

    _instance: Optional['AppLogger'] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self._initialized = True
        self._logger = logging.getLogger("newapi-tools")
        self._logger.setLevel(logging.DEBUG)
        self._logger.handlers.clear()

        # 控制台处理器
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(LogFormatter(use_color=True))
        self._logger.addHandler(console_handler)

        # 可选：文件处理器
        log_file = os.environ.get("LOG_FILE")
        if log_file:
            file_handler = logging.FileHandler(log_file, encoding='utf-8')
            file_handler.setLevel(logging.DEBUG)
            file_handler.setFormatter(LogFormatter(use_color=False))
            self._logger.addHandler(file_handler)

        # 阻止传播到根日志器
        self._logger.propagate = False

    def _log(
        self,
        level: int,
        message: str,
        category: str = "系统",
        **kwargs
    ):
        """内部日志方法"""
        # 构建详细消息
        if kwargs:
            details = " | ".join(f"{k}={v}" for k, v in kwargs.items())
            message = f"{message} | {details}"

        self._logger.log(level, message, extra={"category": category})

    # ========== 基础日志方法 ==========

    def debug(self, message: str, category: str = "系统", **kwargs):
        """调试日志"""
        self._log(logging.DEBUG, message, category, **kwargs)

    def info(self, message: str, category: str = "系统", **kwargs):
        """信息日志"""
        self._log(logging.INFO, message, category, **kwargs)

    def warn(self, message: str, category: str = "系统", **kwargs):
        """警告日志"""
        self._log(logging.WARNING, message, category, **kwargs)

    def warning(self, message: str, category: str = "系统", **kwargs):
        """警告日志 (warn的别名，兼容标准logging命名)"""
        self.warn(message, category, **kwargs)

    def error(self, message: str, category: str = "系统", exc_info: bool = False, **kwargs):
        """错误日志"""
        if exc_info:
            self._logger.error(message, exc_info=True, extra={"category": category})
        else:
            self._log(logging.ERROR, message, category, **kwargs)

    def fatal(self, message: str, category: str = "系统", **kwargs):
        """致命错误日志"""
        self._log(logging.CRITICAL, message, category, **kwargs)

    # ========== 分类快捷方法 ==========

    def system(self, message: str, **kwargs):
        """系统日志"""
        self.info(message, category="系统", **kwargs)

    def api(self, method: str, path: str, status: int, duration: float, ip: str, **kwargs):
        """API请求日志"""
        # 格式化对齐
        method_str = f"{method:<6}"
        path_str = path[:40].ljust(40) if len(path) <= 40 else path[:37] + "..."
        time_str = f"{duration:.3f}s"

        message = f"{method_str} | {path_str} | {status} | {time_str:>8} | {ip}"
        self._log(logging.INFO, message, category="接口", **kwargs)

    def api_error(self, method: str, path: str, status: int, error: str, ip: str, **kwargs):
        """API错误日志"""
        method_str = f"{method:<6}"
        message = f"{method_str} | {path} | {status} | {error}"
        self._log(logging.ERROR, message, category="接口", ip=ip, **kwargs)

    def api_warn(self, method: str, path: str, status: int, error: str, ip: str, **kwargs):
        """API警告日志（用于401认证失败等正常流程）"""
        method_str = f"{method:<6}"
        message = f"{method_str} | {path} | {status} | {error}"
        self._log(logging.WARNING, message, category="接口", ip=ip, **kwargs)

    def db(self, message: str, **kwargs):
        """数据库日志"""
        self.info(message, category="数据库", **kwargs)

    def db_error(self, message: str, **kwargs):
        """数据库错误日志"""
        self.error(message, category="数据库", **kwargs)

    def auth(self, message: str, **kwargs):
        """认证日志"""
        self.info(message, category="认证", **kwargs)

    def auth_fail(self, message: str, **kwargs):
        """认证失败日志"""
        self.warn(message, category="认证", **kwargs)

    def business(self, message: str, **kwargs):
        """业务日志"""
        self.info(message, category="业务", **kwargs)

    def analytics(self, message: str, **kwargs):
        """分析日志"""
        self.info(message, category="分析", **kwargs)

    def security(self, message: str, **kwargs):
        """安全日志"""
        self.warn(message, category="安全", **kwargs)

    def security_alert(self, message: str, **kwargs):
        """安全警报日志"""
        self.error(message, category="安全", **kwargs)

    def task(self, message: str, **kwargs):
        """任务日志"""
        self.info(message, category="任务", **kwargs)

    def task_error(self, message: str, **kwargs):
        """任务错误日志"""
        self.error(message, category="任务", **kwargs)

    # ========== 格式化输出方法 ==========

    def _colorize(self, text: str, color: str) -> str:
        """为文本添加颜色"""
        if sys.stdout.isatty():
            return f"{color}{text}{Colors.RESET}"
        return text

    def _format_value(self, value: Any) -> str:
        """格式化并高亮值"""
        if isinstance(value, bool):
            if value:
                return self._colorize("✓ 是", Colors.BRIGHT_GREEN)
            else:
                return self._colorize("✗ 否", Colors.BRIGHT_RED)
        elif isinstance(value, (int, float)):
            # 数字使用青色高亮
            if isinstance(value, float):
                formatted = f"{value:,.2f}"
            else:
                formatted = f"{value:,}"
            return self._colorize(formatted, Colors.BRIGHT_CYAN)
        elif isinstance(value, str):
            # 特殊状态关键词高亮
            lower = value.lower()
            if lower in ('success', 'ok', '成功', '完成', 'ready', 'active'):
                return self._colorize(value, Colors.BRIGHT_GREEN)
            elif lower in ('error', 'fail', 'failed', '失败', '错误'):
                return self._colorize(value, Colors.BRIGHT_RED)
            elif lower in ('warning', 'warn', '警告', 'pending', '等待'):
                return self._colorize(value, Colors.BRIGHT_YELLOW)
            elif lower in ('skip', 'skipped', '跳过', 'none', '无'):
                return self._colorize(value, Colors.GRAY)
            return self._colorize(value, Colors.BRIGHT_WHITE)
        elif isinstance(value, list):
            if not value:
                return self._colorize("无", Colors.GRAY)
            items = ", ".join(str(v) for v in value)
            return self._colorize(f"[{items}]", Colors.BRIGHT_CYAN)
        return str(value)

    def banner(self, title: str, char: str = "=", width: int = 60, category: str = "系统"):
        """
        打印大标题横幅

        示例输出:
        ════════════════════════════════════════════════════════════
          🚀 缓存恢复任务启动
        ════════════════════════════════════════════════════════════
        """
        line = char * width
        colored_line = self._colorize(line, Colors.BRIGHT_CYAN)
        colored_title = self._colorize(f"  {title}", Colors.BOLD + Colors.BRIGHT_WHITE)

        self._logger.log(logging.INFO, "", extra={"category": category})
        self._logger.log(logging.INFO, colored_line, extra={"category": category})
        self._logger.log(logging.INFO, colored_title, extra={"category": category})
        self._logger.log(logging.INFO, colored_line, extra={"category": category})

    def section(self, title: str, char: str = "-", width: int = 50, category: str = "系统"):
        """
        打印小节标题

        示例输出:
        ────────────────────────────────────────────────────
        📋 阶段3: 预热缺失的窗口
        ────────────────────────────────────────────────────
        """
        line = char * width
        colored_line = self._colorize(line, Colors.GRAY)
        colored_title = self._colorize(f"📋 {title}", Colors.BOLD + Colors.BRIGHT_YELLOW)

        self._logger.log(logging.INFO, colored_line, extra={"category": category})
        self._logger.log(logging.INFO, colored_title, extra={"category": category})

    def divider(self, char: str = "─", width: int = 50, category: str = "系统"):
        """打印分隔线"""
        line = self._colorize(char * width, Colors.GRAY)
        self._logger.log(logging.INFO, line, extra={"category": category})

    def kv(self, label: str, value: Any, category: str = "系统", prefix: str = "  "):
        """
        打印带高亮的键值对

        示例输出:
          总用户数: 6,068
          活跃用户(24h): 313
        """
        formatted_value = self._format_value(value)
        colored_label = self._colorize(f"{prefix}{label}:", Colors.GRAY)
        message = f"{colored_label} {formatted_value}"
        self._logger.log(logging.INFO, message, extra={"category": category})

    def kvs(self, data: dict, category: str = "系统", prefix: str = "  "):
        """
        批量打印键值对
        """
        for key, value in data.items():
            self.kv(key, value, category, prefix)

    def progress(
        self,
        current: int,
        total: int,
        label: str = "",
        category: str = "系统",
        width: int = 30
    ):
        """
        打印进度条

        示例输出:
          预热进度: [████████████░░░░░░░░░░░░░░░░░░] 40% (2/5)
        """
        if total <= 0:
            return

        ratio = current / total
        filled = int(width * ratio)
        empty = width - filled

        bar = "█" * filled + "░" * empty
        percent = int(ratio * 100)

        colored_bar = self._colorize(bar, Colors.BRIGHT_CYAN)
        colored_percent = self._colorize(f"{percent}%", Colors.BRIGHT_GREEN if percent == 100 else Colors.BRIGHT_YELLOW)
        colored_count = self._colorize(f"({current}/{total})", Colors.GRAY)

        if label:
            message = f"  {label}: [{colored_bar}] {colored_percent} {colored_count}"
        else:
            message = f"  [{colored_bar}] {colored_percent} {colored_count}"

        self._logger.log(logging.INFO, message, extra={"category": category})

    def step(self, current: int, total: int, message: str, category: str = "系统"):
        """
        打印步骤进度

        示例输出:
          [2/5] 预热 3h 窗口...
        """
        step_indicator = self._colorize(f"[{current}/{total}]", Colors.BRIGHT_CYAN)
        full_message = f"  {step_indicator} {message}"
        self._logger.log(logging.INFO, full_message, extra={"category": category})

    def success(self, message: str, category: str = "系统", **kwargs):
        """
        打印成功消息

        示例输出:
          ✓ 缓存预热完成
        """
        icon = self._colorize("✓", Colors.BRIGHT_GREEN)
        colored_msg = self._colorize(message, Colors.BRIGHT_GREEN)
        full_message = f"  {icon} {colored_msg}"
        if kwargs:
            details = " | ".join(f"{k}={self._format_value(v)}" for k, v in kwargs.items())
            full_message += f" | {details}"
        self._logger.log(logging.INFO, full_message, extra={"category": category})

    def fail(self, message: str, category: str = "系统", **kwargs):
        """
        打印失败消息

        示例输出:
          ✗ 缓存预热失败
        """
        icon = self._colorize("✗", Colors.BRIGHT_RED)
        colored_msg = self._colorize(message, Colors.BRIGHT_RED)
        full_message = f"  {icon} {colored_msg}"
        if kwargs:
            details = " | ".join(f"{k}={self._format_value(v)}" for k, v in kwargs.items())
            full_message += f" | {details}"
        self._logger.log(logging.ERROR, full_message, extra={"category": category})

    def bullet(self, message: str, category: str = "系统", indent: int = 1):
        """
        打印项目符号列表项

        示例输出:
          • 已缓存: 1h, 3h, 6h
          • 需预热: 12h, 24h
        """
        prefix = "  " * indent
        bullet = self._colorize("•", Colors.BRIGHT_CYAN)
        full_message = f"{prefix}{bullet} {message}"
        self._logger.log(logging.INFO, full_message, extra={"category": category})

    def table_row(self, cols: list, widths: list = None, category: str = "系统"):
        """
        打印表格行

        示例:
          | 窗口  | 日志数   | 耗时   | 状态   |
          | 1h    | 926     | 0.01s | 完成   |
        """
        if widths is None:
            widths = [12] * len(cols)

        cells = []
        for i, col in enumerate(cols):
            width = widths[i] if i < len(widths) else 12
            # 计算实际显示宽度（考虑中文字符）
            display_width = sum(2 if '\u4e00' <= c <= '\u9fff' else 1 for c in str(col))
            padding = width - display_width
            cells.append(f"{col}{' ' * max(0, padding)}")

        row = self._colorize("│ ", Colors.GRAY) + self._colorize(" │ ", Colors.GRAY).join(cells) + self._colorize(" │", Colors.GRAY)
        self._logger.log(logging.INFO, f"  {row}", extra={"category": category})

    def stats_box(self, title: str, stats: dict, category: str = "系统"):
        """
        打印统计信息框

        示例输出:
        ┌─────────────────────────────────────┐
        │  📊 系统规模检测结果                  │
        ├─────────────────────────────────────┤
        │  系统规模: 中型系统                   │
        │  总用户数: 6,068                     │
        │  活跃用户: 313                       │
        └─────────────────────────────────────┘
        """
        box_width = 45

        # 顶边
        top = self._colorize(f"  ┌{'─' * box_width}┐", Colors.GRAY)
        self._logger.log(logging.INFO, top, extra={"category": category})

        # 标题行
        title_text = f"  📊 {title}"
        title_padding = box_width - len(title_text) - 2
        title_line = self._colorize("  │", Colors.GRAY) + self._colorize(title_text, Colors.BOLD + Colors.BRIGHT_WHITE) + " " * max(0, title_padding) + self._colorize("│", Colors.GRAY)
        self._logger.log(logging.INFO, title_line, extra={"category": category})

        # 分隔线
        sep = self._colorize(f"  ├{'─' * box_width}┤", Colors.GRAY)
        self._logger.log(logging.INFO, sep, extra={"category": category})

        # 内容行
        for key, value in stats.items():
            formatted_value = self._format_value(value)
            # 去掉 ANSI 颜色码计算实际宽度
            import re
            plain_value = re.sub(r'\033\[[0-9;]*m', '', formatted_value)
            content = f"  {key}: {formatted_value}"
            plain_content = f"  {key}: {plain_value}"
            padding = box_width - len(plain_content) - 2
            content_line = self._colorize("  │", Colors.GRAY) + content + " " * max(0, padding) + self._colorize("│", Colors.GRAY)
            self._logger.log(logging.INFO, content_line, extra={"category": category})

        # 底边
        bottom = self._colorize(f"  └{'─' * box_width}┘", Colors.GRAY)
        self._logger.log(logging.INFO, bottom, extra={"category": category})

    def phase(self, phase_num: int, title: str, category: str = "系统"):
        """
        打印阶段标题

        示例输出:
        ▸ 阶段 1: 从 SQLite 恢复缓存到 Redis
        """
        phase_label = self._colorize(f"▸ 阶段 {phase_num}:", Colors.BOLD + Colors.BRIGHT_MAGENTA)
        colored_title = self._colorize(title, Colors.BRIGHT_WHITE)
        self._logger.log(logging.INFO, f"{phase_label} {colored_title}", extra={"category": category})

    def timer(self, label: str, seconds: float, category: str = "系统"):
        """
        打印计时信息

        示例输出:
          ⏱ 预热完成: 12.7s
        """
        icon = self._colorize("⏱", Colors.BRIGHT_YELLOW)
        time_str = self._colorize(f"{seconds:.2f}s", Colors.BRIGHT_CYAN)
        message = f"  {icon} {label}: {time_str}"
        self._logger.log(logging.INFO, message, extra={"category": category})

    # ========== 业务场景快捷方法 ==========

    def user_login(self, user_id: int, username: str, ip: str, success: bool = True):
        """用户登录日志"""
        if success:
            self.auth("用户登录成功", user_id=user_id, username=username, ip=ip)
        else:
            self.auth_fail("用户登录失败", user_id=user_id, username=username, ip=ip)

    def user_logout(self, user_id: int, username: str):
        """用户登出日志"""
        self.auth("用户登出", user_id=user_id, username=username)

    def redemption_created(self, count: int, name: str, quota: str):
        """兑换码创建日志"""
        self.business("兑换码生成", count=count, name=name, quota=quota)

    def redemption_used(self, key: str, user_id: int, quota: int):
        """兑换码使用日志"""
        self.business("兑换码兑换", key=key[:8] + "...", user_id=user_id, quota=f"${quota/500000:.2f}")

    def analytics_sync(self, processed: int, total: int, progress: float):
        """分析同步日志"""
        self.analytics("日志同步", processed=processed, total=total, progress=f"{progress:.1f}%")

    def analytics_reset(self, reason: str):
        """分析重置日志"""
        self.analytics("数据重置", reason=reason)

    def db_connected(self, engine: str, host: str, database: str):
        """数据库连接日志"""
        self.db("数据库连接成功", engine=engine, host=host, database=database)

    def db_disconnected(self, reason: str = "正常关闭"):
        """数据库断开日志"""
        self.db("数据库连接断开", reason=reason)

    def rate_limit(self, ip: str, endpoint: str, limit: int):
        """速率限制日志"""
        self.security("触发速率限制", ip=ip, endpoint=endpoint, limit=f"{limit}/min")

    def invalid_token(self, token_prefix: str, ip: str, reason: str):
        """无效Token日志"""
        self.security("无效Token访问", token=token_prefix + "...", ip=ip, reason=reason)


# 全局日志实例
logger = AppLogger()


# ========== 装饰器 ==========

def log_execution_time(category: str = "任务"):
    """
    记录函数执行时间的装饰器

    使用:
        @log_execution_time("业务")
        def my_function():
            pass
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            start = time.time()
            try:
                result = func(*args, **kwargs)
                duration = time.time() - start
                logger.info(
                    f"函数执行完成: {func.__name__}",
                    category=category,
                    duration=f"{duration:.3f}s"
                )
                return result
            except Exception as e:
                duration = time.time() - start
                logger.error(
                    f"函数执行失败: {func.__name__}",
                    category=category,
                    duration=f"{duration:.3f}s",
                    error=str(e)
                )
                raise
        return wrapper
    return decorator


def log_async_execution_time(category: str = "任务"):
    """
    记录异步函数执行时间的装饰器
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            start = time.time()
            try:
                result = await func(*args, **kwargs)
                duration = time.time() - start
                logger.info(
                    f"异步函数执行完成: {func.__name__}",
                    category=category,
                    duration=f"{duration:.3f}s"
                )
                return result
            except Exception as e:
                duration = time.time() - start
                logger.error(
                    f"异步函数执行失败: {func.__name__}",
                    category=category,
                    duration=f"{duration:.3f}s",
                    error=str(e)
                )
                raise
        return wrapper
    return decorator

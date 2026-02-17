package logger

import (
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/mattn/go-colorable"
	"github.com/rs/zerolog"
)

// Category constants matching Python's LogCategory
const (
	CatSystem    = "系统"
	CatAPI       = "接口"
	CatDatabase  = "数据库"
	CatAuth      = "认证"
	CatBusiness  = "业务"
	CatAnalytics = "分析"
	CatSecurity  = "安全"
	CatTask      = "任务"
	CatCache     = "缓存"
)

// ANSI color codes matching Python's Colors class
const (
	reset = "\033[0m"
	bold  = "\033[1m"
	dim   = "\033[2m"

	red     = "\033[31m"
	green   = "\033[32m"
	yellow  = "\033[33m"
	blue    = "\033[34m"
	magenta = "\033[35m"
	cyan    = "\033[36m"
	gray    = "\033[90m"

	brightRed     = "\033[91m"
	brightGreen   = "\033[92m"
	brightYellow  = "\033[93m"
	brightBlue    = "\033[94m"
	brightMagenta = "\033[95m"
	brightCyan    = "\033[96m"
	brightWhite   = "\033[97m"

	bgRed = "\033[41m"
	white = "\033[37m"
)

// Level colors matching Python's LEVEL_COLORS
var levelColors = map[string]string{
	"DBG": brightBlue,
	"INF": brightGreen,
	"WRN": brightYellow,
	"ERR": brightRed,
	"FTL": bgRed + white,
}

// Category colors matching Python's CATEGORY_COLORS
var categoryColors = map[string]string{
	CatSystem:    brightCyan,
	CatAPI:       brightBlue,
	CatDatabase:  brightMagenta,
	CatAuth:      brightYellow,
	CatBusiness:  brightGreen,
	CatAnalytics: cyan,
	CatSecurity:  brightRed,
	CatTask:      magenta,
	CatCache:     brightCyan,
}

// AppLogger wraps zerolog with formatted, colorful console output
type AppLogger struct {
	zl       zerolog.Logger
	useColor bool
}

// L is the global logger instance
var L *AppLogger

// Init initializes the global logger
func Init(level string, logFile string) {
	lvl, err := zerolog.ParseLevel(strings.ToLower(level))
	if err != nil {
		lvl = zerolog.InfoLevel
	}

	var writers []io.Writer

	// Console writer with custom formatting (matching Python's log format)
	consoleWriter := zerolog.ConsoleWriter{
		Out:        colorable.NewColorableStdout(),
		TimeFormat: "2006-01-02 15:04:05",
		NoColor:    false,
		FormatTimestamp: func(i interface{}) string {
			t := fmt.Sprintf("%s", i)
			return t
		},
		FormatLevel: func(i interface{}) string {
			level := strings.ToUpper(fmt.Sprintf("%s", i))
			// Map zerolog levels to 5-char display
			switch level {
			case "DEBUG":
				level = "DBG"
			case "INFO":
				level = "INF"
			case "WARN":
				level = "WRN"
			case "ERROR":
				level = "ERR"
			case "FATAL":
				level = "FTL"
			}
			padded := fmt.Sprintf("%-5s", level)
			if color, ok := levelColors[level]; ok {
				return color + padded + reset
			}
			return padded
		},
		FormatMessage: func(i interface{}) string {
			return fmt.Sprintf("| %s", i)
		},
		FormatFieldName: func(i interface{}) string {
			return fmt.Sprintf("%s=", i)
		},
		FormatFieldValue: func(i interface{}) string {
			return fmt.Sprintf("%s", i)
		},
		PartsOrder: []string{
			zerolog.TimestampFieldName,
			zerolog.LevelFieldName,
			"category",
			zerolog.MessageFieldName,
		},
		FieldsExclude: []string{"category"},
		FormatPrepare: func(m map[string]interface{}) error {
			// Format category field for display
			if cat, ok := m["category"]; ok {
				catStr := fmt.Sprintf("%s", cat)
				catDisplay := fmt.Sprintf("[%s]", catStr)
				// Pad to align (accounting for CJK characters)
				cjkCount := 0
				for _, c := range catStr {
					if c >= '\u4e00' && c <= '\u9fff' {
						cjkCount++
					}
				}
				padding := 6 - len(catStr) - cjkCount
				if padding > 0 {
					catDisplay += strings.Repeat(" ", padding)
				}
				if color, ok := categoryColors[catStr]; ok {
					catDisplay = color + catDisplay + reset
				}
				m["category"] = catDisplay
			} else {
				catDisplay := fmt.Sprintf("[%s]", CatSystem)
				if color, ok := categoryColors[CatSystem]; ok {
					catDisplay = color + catDisplay + reset
				}
				m["category"] = catDisplay
			}
			return nil
		},
	}
	writers = append(writers, consoleWriter)

	// Optional file writer
	if logFile != "" {
		f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err == nil {
			writers = append(writers, f)
		}
	}

	multi := zerolog.MultiLevelWriter(writers...)
	zl := zerolog.New(multi).Level(lvl).With().Timestamp().Logger()

	L = &AppLogger{
		zl:       zl,
		useColor: true,
	}
}

// WithCategory returns a zerolog.Event with the category field set
func (l *AppLogger) withCategory(cat string) *zerolog.Event {
	return l.zl.Info().Str("category", cat)
}

// ========== Basic log methods ==========

func (l *AppLogger) Debug(msg string, category ...string) {
	cat := CatSystem
	if len(category) > 0 {
		cat = category[0]
	}
	l.zl.Debug().Str("category", cat).Msg(msg)
}

func (l *AppLogger) Info(msg string, category ...string) {
	cat := CatSystem
	if len(category) > 0 {
		cat = category[0]
	}
	l.zl.Info().Str("category", cat).Msg(msg)
}

func (l *AppLogger) Warn(msg string, category ...string) {
	cat := CatSystem
	if len(category) > 0 {
		cat = category[0]
	}
	l.zl.Warn().Str("category", cat).Msg(msg)
}

func (l *AppLogger) Error(msg string, category ...string) {
	cat := CatSystem
	if len(category) > 0 {
		cat = category[0]
	}
	l.zl.Error().Str("category", cat).Msg(msg)
}

func (l *AppLogger) Fatal(msg string, category ...string) {
	cat := CatSystem
	if len(category) > 0 {
		cat = category[0]
	}
	l.zl.Fatal().Str("category", cat).Msg(msg)
}

// ========== Category shortcut methods ==========

func (l *AppLogger) System(msg string) {
	l.Info(msg, CatSystem)
}

func (l *AppLogger) DB(msg string) {
	l.Info(msg, CatDatabase)
}

func (l *AppLogger) DBError(msg string) {
	l.Error(msg, CatDatabase)
}

func (l *AppLogger) Auth(msg string) {
	l.Info(msg, CatAuth)
}

func (l *AppLogger) AuthFail(msg string) {
	l.Warn(msg, CatAuth)
}

func (l *AppLogger) Business(msg string) {
	l.Info(msg, CatBusiness)
}

func (l *AppLogger) Analytics(msg string) {
	l.Info(msg, CatAnalytics)
}

func (l *AppLogger) Security(msg string) {
	l.Warn(msg, CatSecurity)
}

func (l *AppLogger) SecurityAlert(msg string) {
	l.Error(msg, CatSecurity)
}

func (l *AppLogger) Task(msg string) {
	l.Info(msg, CatTask)
}

func (l *AppLogger) TaskError(msg string) {
	l.Error(msg, CatTask)
}

// ========== API log methods ==========

func (l *AppLogger) API(method, path string, status int, duration time.Duration, ip string) {
	methodStr := fmt.Sprintf("%-6s", method)
	if len(path) > 40 {
		path = path[:37] + "..."
	}
	pathStr := fmt.Sprintf("%-40s", path)
	timeStr := fmt.Sprintf("%7.3fs", duration.Seconds())

	msg := fmt.Sprintf("%s | %s | %d | %s | %s", methodStr, pathStr, status, timeStr, ip)
	l.zl.Info().Str("category", CatAPI).Msg(msg)
}

func (l *AppLogger) APIError(method, path string, status int, errMsg, ip string) {
	methodStr := fmt.Sprintf("%-6s", method)
	msg := fmt.Sprintf("%s | %s | %d | %s", methodStr, path, status, errMsg)
	l.zl.Error().Str("category", CatAPI).Str("ip", ip).Msg(msg)
}

func (l *AppLogger) APIWarn(method, path string, status int, errMsg, ip string) {
	methodStr := fmt.Sprintf("%-6s", method)
	msg := fmt.Sprintf("%s | %s | %d | %s", methodStr, path, status, errMsg)
	l.zl.Warn().Str("category", CatAPI).Str("ip", ip).Msg(msg)
}

// ========== Formatted output methods ==========

func (l *AppLogger) Banner(title string) {
	line := strings.Repeat("═", 60)
	l.System("")
	l.System(line)
	l.System("  " + title)
	l.System(line)
}

func (l *AppLogger) Section(title string) {
	line := strings.Repeat("─", 50)
	l.System(line)
	l.System("📋 " + title)
}

func (l *AppLogger) Divider() {
	l.System(strings.Repeat("─", 50))
}

func (l *AppLogger) Success(msg string) {
	l.System("  ✓ " + msg)
}

func (l *AppLogger) Fail(msg string) {
	l.Error("  ✗ "+msg, CatSystem)
}

func (l *AppLogger) Timer(label string, seconds float64) {
	l.System(fmt.Sprintf("  ⏱ %s: %.2fs", label, seconds))
}

// ========== Business shortcut methods ==========

func (l *AppLogger) DBConnected(engine, host, database string) {
	l.DB(fmt.Sprintf("数据库连接成功 | engine=%s | host=%s | database=%s", engine, host, database))
}

func (l *AppLogger) DBDisconnected(reason string) {
	l.DB(fmt.Sprintf("数据库连接断开 | reason=%s", reason))
}

// Zerolog returns the underlying zerolog.Logger for advanced usage
func (l *AppLogger) Zerolog() zerolog.Logger {
	return l.zl
}

func init() {
	// Initialize with defaults; will be re-initialized in main
	Init("info", "")
}

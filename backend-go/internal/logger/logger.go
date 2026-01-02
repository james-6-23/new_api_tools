package logger

import (
	"os"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var log *zap.Logger
var sugar *zap.SugaredLogger

// Init 初始化日志系统
func Init(mode string) error {
	var config zap.Config

	if mode == "debug" {
		config = zap.NewDevelopmentConfig()
		config.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
	} else {
		config = zap.NewProductionConfig()
		config.EncoderConfig.TimeKey = "timestamp"
		config.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	}

	// 设置日志级别
	config.Level = zap.NewAtomicLevelAt(zapcore.InfoLevel)
	if mode == "debug" {
		config.Level = zap.NewAtomicLevelAt(zapcore.DebugLevel)
	}

	// 输出到控制台
	config.OutputPaths = []string{"stdout"}
	config.ErrorOutputPaths = []string{"stderr"}

	var err error
	log, err = config.Build(zap.AddCallerSkip(1))
	if err != nil {
		return err
	}

	sugar = log.Sugar()
	return nil
}

// GetLogger 获取 zap.Logger
func GetLogger() *zap.Logger {
	if log == nil {
		// 如果未初始化，使用默认配置
		log, _ = zap.NewProduction()
	}
	return log
}

// GetSugar 获取 SugaredLogger
func GetSugar() *zap.SugaredLogger {
	if sugar == nil {
		sugar = GetLogger().Sugar()
	}
	return sugar
}

// Sync 刷新日志缓冲区
func Sync() {
	if log != nil {
		_ = log.Sync()
	}
}

// 便捷方法
func Debug(msg string, fields ...zap.Field) {
	GetLogger().Debug(msg, fields...)
}

func Info(msg string, fields ...zap.Field) {
	GetLogger().Info(msg, fields...)
}

func Warn(msg string, fields ...zap.Field) {
	GetLogger().Warn(msg, fields...)
}

func Error(msg string, fields ...zap.Field) {
	GetLogger().Error(msg, fields...)
}

func Fatal(msg string, fields ...zap.Field) {
	GetLogger().Fatal(msg, fields...)
	os.Exit(1)
}

func Debugf(template string, args ...interface{}) {
	GetSugar().Debugf(template, args...)
}

func Infof(template string, args ...interface{}) {
	GetSugar().Infof(template, args...)
}

func Warnf(template string, args ...interface{}) {
	GetSugar().Warnf(template, args...)
}

func Errorf(template string, args ...interface{}) {
	GetSugar().Errorf(template, args...)
}

func Fatalf(template string, args ...interface{}) {
	GetSugar().Fatalf(template, args...)
	os.Exit(1)
}

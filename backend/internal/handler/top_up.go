package handler

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/models"
	"github.com/new-api-tools/backend/internal/service"
)

// 每个调用方（按 user_sub / api_key / IP 退化）同一时刻只允许一个 CSV 导出在跑。
// 60s 长查询连点 5 次会同时打 5 条 / top_ups —— 这把它压成串行。
var exportInFlight sync.Map // map[string]struct{}

func exportLockKey(c *gin.Context) string {
	if sub, ok := c.Get("user_sub"); ok {
		if s, ok := sub.(string); ok && s != "" {
			return "jwt:" + s
		}
	}
	if m, ok := c.Get("auth_method"); ok && m == "api_key" {
		// api_key 请求没有 subject，按 IP + 鉴权方式区分；同一 key + 同一 IP 也算一个使用者。
		return "key:" + c.ClientIP()
	}
	return "ip:" + c.ClientIP()
}

// RegisterTopUpRoutes registers /api/top-ups endpoints
func RegisterTopUpRoutes(r *gin.RouterGroup) {
	g := r.Group("/top-ups")
	{
		g.GET("", ListTopUps)
		g.GET("/statistics", GetTopUpStatistics)
		g.GET("/payment-methods", GetPaymentMethods)
		g.GET("/payment-providers", GetPaymentProviders)
		g.GET("/export", ExportTopUps)
		g.GET("/:id", GetTopUpRecord)
	}
}

// GET /api/top-ups
func ListTopUps(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	params := service.ListTopUpParams{
		Page:            page,
		PageSize:        pageSize,
		Status:          c.Query("status"),
		PaymentMethod:   c.Query("payment_method"),
		PaymentProvider: c.Query("payment_provider"),
		TradeNo:         c.Query("trade_no"),
		StartDate:       c.Query("start_date"),
		EndDate:         c.Query("end_date"),
	}

	// Parse optional user_id
	if userIDStr := c.Query("user_id"); userIDStr != "" {
		uid, err := strconv.ParseInt(userIDStr, 10, 64)
		if err == nil {
			params.UserID = &uid
		}
	}

	result, err := service.ListTopUpRecords(params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// GET /api/top-ups/statistics
func GetTopUpStatistics(c *gin.Context) {
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")

	stats, err := service.GetTopUpStatistics(startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    stats,
	})
}

// GET /api/top-ups/payment-methods
func GetPaymentMethods(c *gin.Context) {
	methods, err := service.GetPaymentMethods()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    methods,
	})
}

// GET /api/top-ups/payment-providers
func GetPaymentProviders(c *gin.Context) {
	providers, err := service.GetPaymentProviders()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    providers,
	})
}

// GET /api/top-ups/:id
func GetTopUpRecord(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResp("INVALID_PARAMS", "Invalid ID", ""))
		return
	}

	record, err := service.GetTopUpByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResp("NOT_FOUND", "Top up record not found", ""))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    record,
	})
}

// GET /api/top-ups/export — streams matching records as CSV. Filters mirror /api/top-ups.
func ExportTopUps(c *gin.Context) {
	// 并发互斥：同一个用户已有导出在跑就直接 429，不让长查询叠加。
	lockKey := exportLockKey(c)
	if _, busy := exportInFlight.LoadOrStore(lockKey, struct{}{}); busy {
		c.JSON(http.StatusTooManyRequests, models.ErrorResp(
			"EXPORT_IN_PROGRESS",
			"上一次导出尚未完成，请稍候再试",
			"",
		))
		return
	}
	defer exportInFlight.Delete(lockKey)

	params := service.ListTopUpParams{
		Status:          c.Query("status"),
		PaymentMethod:   c.Query("payment_method"),
		PaymentProvider: c.Query("payment_provider"),
		TradeNo:         c.Query("trade_no"),
		StartDate:       c.Query("start_date"),
		EndDate:         c.Query("end_date"),
	}
	if userIDStr := c.Query("user_id"); userIDStr != "" {
		if uid, err := strconv.ParseInt(userIDStr, 10, 64); err == nil {
			params.UserID = &uid
		}
	}

	total, err := service.CountTopUps(params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	if total > service.TopUpExportLimit {
		c.JSON(http.StatusBadRequest, models.ErrorResp(
			"EXPORT_TOO_LARGE",
			fmt.Sprintf("数据量 %d 行超过 %d 行上限，请收窄日期或筛选范围", total, service.TopUpExportLimit),
			"",
		))
		return
	}

	filename := fmt.Sprintf("top_ups_%s.csv", time.Now().Format("20060102_150405"))
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")

	// 审计日志：合规要求"谁、何时、按什么过滤、导出多少行"，便于事后追踪。
	subject, _ := c.Get("user_sub")
	method, _ := c.Get("auth_method")
	log.Printf(
		"audit top_ups_export user=%v auth=%v rows=%d filters={status:%q payment:%q provider:%q trade_no:%q user_id:%v start:%q end:%q} ip=%s",
		subject, method, total,
		params.Status, params.PaymentMethod, params.PaymentProvider, params.TradeNo, params.UserID,
		params.StartDate, params.EndDate, c.ClientIP(),
	)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()

	if err := service.ExportTopUpsToCSV(ctx, c.Writer, params); err != nil {
		// 响应头已发出，无法切回 JSON。CSV 末尾追加注释会污染 Excel 解析，
		// 这里仅 server log，前端通过文件最后一行可观察到截断。
		if !errors.Is(err, context.Canceled) {
			log.Printf("top_ups export failed: %v", err)
		}
	}
}

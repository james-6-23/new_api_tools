package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/models"
	"github.com/new-api-tools/backend/internal/service"
)

// RegisterAffiliateStatsRoutes 挂载邀请返利统计相关接口。
//
//	GET /api/users/affiliate-stats          —— 按 inviter_id 聚合的分页列表
//	GET /api/users/affiliate-stats/summary  —— 顶部统计卡片所需的整体汇总
func RegisterAffiliateStatsRoutes(r *gin.RouterGroup) {
	g := r.Group("/users/affiliate-stats")
	{
		g.GET("", ListAffiliateStats)
		g.GET("/summary", GetAffiliateStatsSummary)
	}
}

func parseAffiliateParams(c *gin.Context) service.AffiliateStatsParams {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	return service.AffiliateStatsParams{
		Page:      page,
		PageSize:  pageSize,
		Search:    c.Query("search"),
		StartDate: c.Query("start_date"),
		EndDate:   c.Query("end_date"),
		SortBy:    c.Query("sort_by"),
		SortDir:   c.Query("sort_dir"),
	}
}

// GET /api/users/affiliate-stats
func ListAffiliateStats(c *gin.Context) {
	params := parseAffiliateParams(c)
	result, err := service.ListAffiliateStats(params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// GET /api/users/affiliate-stats/summary
func GetAffiliateStatsSummary(c *gin.Context) {
	params := parseAffiliateParams(c)
	summary, err := service.GetAffiliateStatsSummary(params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResp("QUERY_ERROR", err.Error(), ""))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    summary,
	})
}

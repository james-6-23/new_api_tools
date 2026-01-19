package service

import (
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/ketches/new-api-tools/internal/database"
	"github.com/ketches/new-api-tools/internal/models"
	"gorm.io/gorm"
)

// setupTestDB 创建测试用的内存数据库
func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("无法创建测试数据库: %v", err)
	}

	// 自动迁移表结构
	err = db.AutoMigrate(
		&models.User{},
		&models.Token{},
		&models.Channel{},
		&models.Log{},
		&models.Redemption{},
		&models.Ability{},
	)
	if err != nil {
		t.Fatalf("无法迁移表结构: %v", err)
	}

	return db
}

// seedTestData 插入测试数据
func seedTestData(t *testing.T, db *gorm.DB) {
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()

	// 创建用户
	users := []models.User{
		{ID: 1, Username: "user1", Status: models.UserStatusEnabled, Quota: 10000, UsedQuota: 5000},
		{ID: 2, Username: "user2", Status: models.UserStatusEnabled, Quota: 20000, UsedQuota: 10000},
		{ID: 3, Username: "user3", Status: models.UserStatusBanned, Quota: 5000, UsedQuota: 2000},
	}
	for _, u := range users {
		db.Create(&u)
	}

	// 创建令牌
	tokens := []models.Token{
		{ID: 1, UserID: 1, Name: "token1", Status: models.TokenStatusEnabled},
		{ID: 2, UserID: 1, Name: "token2", Status: models.TokenStatusDisabled},
		{ID: 3, UserID: 2, Name: "token3", Status: models.TokenStatusEnabled},
	}
	for _, tok := range tokens {
		db.Create(&tok)
	}

	// 创建渠道
	channels := []models.Channel{
		{ID: 1, Name: "channel1", Status: models.ChannelStatusEnabled},
		{ID: 2, Name: "channel2", Status: models.ChannelStatusEnabled},
		{ID: 3, Name: "channel3", Status: models.ChannelStatusDisabled},
	}
	for _, ch := range channels {
		db.Create(&ch)
	}

	// 创建能力（模型配置）
	abilities := []models.Ability{
		{ID: 1, Model: "gpt-4", ChannelID: 1, Enabled: true},
		{ID: 2, Model: "gpt-3.5-turbo", ChannelID: 1, Enabled: true},
		{ID: 3, Model: "gpt-4", ChannelID: 2, Enabled: true}, // 重复模型，应该去重
		{ID: 4, Model: "claude-3-opus", ChannelID: 2, Enabled: true},
		{ID: 5, Model: "disabled-model", ChannelID: 3, Enabled: true}, // 渠道禁用
	}
	for _, ab := range abilities {
		db.Create(&ab)
	}

	// 创建兑换码
	redemptions := []models.Redemption{
		{ID: 1, Key: "key1", Status: models.RedemptionStatusEnabled, Quota: 1000},
		{ID: 2, Key: "key2", Status: models.RedemptionStatusEnabled, Quota: 2000},
		{ID: 3, Key: "key3", Status: models.RedemptionStatusUsed, Quota: 500},
	}
	for _, r := range redemptions {
		db.Create(&r)
	}

	// 创建日志
	logs := []models.Log{
		{ID: 1, UserID: 1, TokenID: 1, Type: models.LogTypeConsume, ModelName: "gpt-4", Quota: 100, PromptTokens: 50, CompletionTokens: 30, UseTime: 1000, CreatedAt: todayStart + 100},
		{ID: 2, UserID: 1, TokenID: 1, Type: models.LogTypeConsume, ModelName: "gpt-4", Quota: 200, PromptTokens: 100, CompletionTokens: 80, UseTime: 1500, CreatedAt: todayStart + 200},
		{ID: 3, UserID: 2, TokenID: 3, Type: models.LogTypeConsume, ModelName: "gpt-3.5-turbo", Quota: 50, PromptTokens: 30, CompletionTokens: 20, UseTime: 500, CreatedAt: todayStart + 300},
	}
	for _, l := range logs {
		db.Create(&l)
	}
}

func TestGetOverview(t *testing.T) {
	db := setupTestDB(t)
	seedTestData(t, db)

	// 设置测试数据库
	database.SetTestDB(db)
	defer database.ClearTestDB()

	service := NewDashboardService()
	data, err := service.fetchOverviewData()
	if err != nil {
		t.Fatalf("fetchOverviewData 失败: %v", err)
	}

	// 验证用户统计
	if data.TotalUsers != 3 {
		t.Errorf("TotalUsers 期望 3, 实际 %d", data.TotalUsers)
	}
	if data.ActiveUsers != 2 {
		t.Errorf("ActiveUsers 期望 2, 实际 %d", data.ActiveUsers)
	}

	// 验证令牌统计
	if data.TotalTokens != 3 {
		t.Errorf("TotalTokens 期望 3, 实际 %d", data.TotalTokens)
	}
	if data.ActiveTokens != 2 {
		t.Errorf("ActiveTokens 期望 2, 实际 %d", data.ActiveTokens)
	}

	// 验证渠道统计
	if data.TotalChannels != 3 {
		t.Errorf("TotalChannels 期望 3, 实际 %d", data.TotalChannels)
	}
	if data.ActiveChannels != 2 {
		t.Errorf("ActiveChannels 期望 2, 实际 %d", data.ActiveChannels)
	}

	// 验证模型数量（启用渠道的唯一模型数: gpt-4, gpt-3.5-turbo, claude-3-opus）
	if data.TotalModels != 3 {
		t.Errorf("TotalModels 期望 3, 实际 %d", data.TotalModels)
	}

	// 验证兑换码统计
	if data.TotalRedemptions != 3 {
		t.Errorf("TotalRedemptions 期望 3, 实际 %d", data.TotalRedemptions)
	}
	if data.UnusedRedemptions != 2 {
		t.Errorf("UnusedRedemptions 期望 2, 实际 %d", data.UnusedRedemptions)
	}

	// 验证额度统计
	if data.TotalQuota != 35000 {
		t.Errorf("TotalQuota 期望 35000, 实际 %d", data.TotalQuota)
	}
	if data.TotalUsedQuota != 17000 {
		t.Errorf("TotalUsedQuota 期望 17000, 实际 %d", data.TotalUsedQuota)
	}

	// 验证今日请求和额度
	if data.TodayRequests != 3 {
		t.Errorf("TodayRequests 期望 3, 实际 %d", data.TodayRequests)
	}
	if data.TodayQuota != 350 {
		t.Errorf("TodayQuota 期望 350, 实际 %d", data.TodayQuota)
	}
}

func TestGetUsage(t *testing.T) {
	db := setupTestDB(t)
	seedTestData(t, db)

	// 设置测试数据库
	database.SetTestDB(db)
	defer database.ClearTestDB()

	service := NewDashboardService()
	data, err := service.fetchUsageData("today")
	if err != nil {
		t.Fatalf("fetchUsageData 失败: %v", err)
	}

	// 验证基础统计
	if data.TotalRequests != 3 {
		t.Errorf("TotalRequests 期望 3, 实际 %d", data.TotalRequests)
	}
	if data.TotalQuota != 350 {
		t.Errorf("TotalQuota 期望 350, 实际 %d", data.TotalQuota)
	}

	// 验证 Token 统计
	expectedPromptTokens := int64(50 + 100 + 30)
	if data.TotalPromptTokens != expectedPromptTokens {
		t.Errorf("TotalPromptTokens 期望 %d, 实际 %d", expectedPromptTokens, data.TotalPromptTokens)
	}

	expectedCompletionTokens := int64(30 + 80 + 20)
	if data.TotalCompletionTokens != expectedCompletionTokens {
		t.Errorf("TotalCompletionTokens 期望 %d, 实际 %d", expectedCompletionTokens, data.TotalCompletionTokens)
	}

	// 验证平均响应时间 (1000 + 1500 + 500) / 3 = 1000
	expectedAvgTime := float64(1000+1500+500) / 3
	if data.AverageResponseTime != expectedAvgTime {
		t.Errorf("AverageResponseTime 期望 %f, 实际 %f", expectedAvgTime, data.AverageResponseTime)
	}

	// 验证 TotalQuotaUsed 与 TotalQuota 一致
	if data.TotalQuotaUsed != data.TotalQuota {
		t.Errorf("TotalQuotaUsed 期望与 TotalQuota 一致 (%d), 实际 %d", data.TotalQuota, data.TotalQuotaUsed)
	}

	// 验证唯一用户和令牌
	if data.UniqueUsers != 2 {
		t.Errorf("UniqueUsers 期望 2, 实际 %d", data.UniqueUsers)
	}
	if data.UniqueTokens != 2 {
		t.Errorf("UniqueTokens 期望 2, 实际 %d", data.UniqueTokens)
	}
}

func TestGetModelUsage(t *testing.T) {
	db := setupTestDB(t)
	seedTestData(t, db)

	// 设置测试数据库
	database.SetTestDB(db)
	defer database.ClearTestDB()

	service := NewDashboardService()
	data, err := service.fetchModelUsage("today", 10)
	if err != nil {
		t.Fatalf("fetchModelUsage 失败: %v", err)
	}

	// 验证返回模型数量
	if len(data) != 2 {
		t.Errorf("模型数量期望 2, 实际 %d", len(data))
	}

	// 验证排序（按请求数降序）
	if len(data) >= 1 && data[0].ModelName != "gpt-4" {
		t.Errorf("第一个模型期望 gpt-4, 实际 %s", data[0].ModelName)
	}

	// 验证 gpt-4 统计
	for _, m := range data {
		if m.ModelName == "gpt-4" {
			if m.RequestCount != 2 {
				t.Errorf("gpt-4 RequestCount 期望 2, 实际 %d", m.RequestCount)
			}
			if m.QuotaUsed != 300 {
				t.Errorf("gpt-4 QuotaUsed 期望 300, 实际 %d", m.QuotaUsed)
			}
			if m.PromptTokens != 150 {
				t.Errorf("gpt-4 PromptTokens 期望 150, 实际 %d", m.PromptTokens)
			}
			if m.CompletionTokens != 110 {
				t.Errorf("gpt-4 CompletionTokens 期望 110, 实际 %d", m.CompletionTokens)
			}
		}
	}
}

func TestGetUsageWithDifferentPeriods(t *testing.T) {
	db := setupTestDB(t)
	seedTestData(t, db)

	database.SetTestDB(db)
	defer database.ClearTestDB()

	service := NewDashboardService()

	periods := []string{"today", "24h", "7d", "14d", "month"}
	for _, period := range periods {
		data, err := service.fetchUsageData(period)
		if err != nil {
			t.Errorf("fetchUsageData(%s) 失败: %v", period, err)
			continue
		}
		if data.Period != period {
			t.Errorf("Period 期望 %s, 实际 %s", period, data.Period)
		}
	}
}

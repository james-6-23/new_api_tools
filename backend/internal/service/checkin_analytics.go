package service

import (
	"time"

	"github.com/new-api-tools/backend/internal/database"
)

// CheckinAnalyticsService 签到运营分析（checkins 表只读）
// checkin_date 为 YYYY-MM-DD 字符串（上游 new-api/model/checkin.go）
type CheckinAnalyticsService struct {
	db *database.Manager
}

func NewCheckinAnalyticsService() *CheckinAnalyticsService {
	return &CheckinAnalyticsService{db: database.Get()}
}

func dateStr(t time.Time) string {
	return t.Format("2006-01-02")
}

// GetCheckinOverview 签到总览统计
func (s *CheckinAnalyticsService) GetCheckinOverview() (map[string]interface{}, error) {
	now := time.Now()
	today := dateStr(now)
	d7 := dateStr(now.AddDate(0, 0, -6))
	d30 := dateStr(now.AddDate(0, 0, -29))

	totalRow, err := s.db.QueryOne(s.db.RebindQuery(`
		SELECT COUNT(*) as total,
			COUNT(DISTINCT user_id) as users,
			COALESCE(SUM(quota_awarded), 0) as quota_awarded
		FROM checkins`))
	if err != nil {
		return nil, err
	}

	windowRow, err := s.db.QueryOne(s.db.RebindQuery(`
		SELECT
			SUM(CASE WHEN checkin_date = ? THEN 1 ELSE 0 END) as today_count,
			SUM(CASE WHEN checkin_date >= ? THEN 1 ELSE 0 END) as d7_count,
			SUM(CASE WHEN checkin_date >= ? THEN 1 ELSE 0 END) as d30_count,
			COALESCE(SUM(CASE WHEN checkin_date >= ? THEN quota_awarded ELSE 0 END), 0) as d30_quota
		FROM checkins
		WHERE checkin_date >= ?`), today, d7, d30, d30, d30)
	if err != nil {
		return nil, err
	}

	result := map[string]interface{}{
		"total":         int64(0),
		"users":         int64(0),
		"quota_awarded": int64(0),
		"today_count":   int64(0),
		"d7_count":      int64(0),
		"d30_count":     int64(0),
		"d30_quota":     int64(0),
	}
	if totalRow != nil {
		result["total"] = toInt64(totalRow["total"])
		result["users"] = toInt64(totalRow["users"])
		result["quota_awarded"] = toInt64(totalRow["quota_awarded"])
	}
	if windowRow != nil {
		result["today_count"] = toInt64(windowRow["today_count"])
		result["d7_count"] = toInt64(windowRow["d7_count"])
		result["d30_count"] = toInt64(windowRow["d30_count"])
		result["d30_quota"] = toInt64(windowRow["d30_quota"])
	}
	return result, nil
}

// GetCheckinTrend 按天的签到人数与发放额度
func (s *CheckinAnalyticsService) GetCheckinTrend(days int) ([]map[string]interface{}, error) {
	if days <= 0 || days > 90 {
		days = 30
	}
	since := dateStr(time.Now().AddDate(0, 0, -(days - 1)))

	rows, err := s.db.Query(s.db.RebindQuery(`
		SELECT checkin_date,
			COUNT(*) as count,
			COALESCE(SUM(quota_awarded), 0) as quota_awarded
		FROM checkins
		WHERE checkin_date >= ?
		GROUP BY checkin_date
		ORDER BY checkin_date ASC`), since)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	return rows, nil
}

// GetFreeloaders 薅羊毛嫌疑：窗口期内高频签到、从未成功充值的用户，
// 按签到次数排序，附带发放额度与消耗额度供人工判断。
func (s *CheckinAnalyticsService) GetFreeloaders(days, limit int) ([]map[string]interface{}, error) {
	if days <= 0 || days > 90 {
		days = 30
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	since := dateStr(time.Now().AddDate(0, 0, -(days - 1)))

	args := []interface{}{since}
	whitelistCond := ""
	if cond, wlArgs := PanelWhitelistNotInClause("u.id"); cond != "" {
		whitelistCond = " AND " + cond
		args = append(args, wlArgs...)
	}
	args = append(args, limit)

	query := s.db.RebindQuery(`
		SELECT u.id as user_id, u.username, u.status as user_status,
			c.cnt as checkin_count,
			c.qsum as quota_awarded,
			COALESCE(u.used_quota, 0) as used_quota,
			COALESCE(u.quota, 0) as quota,
			COALESCE(u.last_login_at, 0) as last_login_at
		FROM (
			SELECT user_id, COUNT(*) as cnt, COALESCE(SUM(quota_awarded), 0) as qsum
			FROM checkins
			WHERE checkin_date >= ?
			GROUP BY user_id
		) c
		JOIN users u ON u.id = c.user_id AND u.deleted_at IS NULL
		LEFT JOIN (
			SELECT user_id, SUM(money) as paid
			FROM top_ups
			WHERE status = 'success'
			GROUP BY user_id
		) t ON t.user_id = c.user_id
		WHERE COALESCE(t.paid, 0) = 0` + whitelistCond + `
		ORDER BY c.cnt DESC, c.qsum DESC
		LIMIT ?`)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	return rows, nil
}

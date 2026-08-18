package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/new-api-tools/backend/internal/database"
)

// TaskLogService 任务日志（tasks 表）查询与「任务 ↔ 使用日志」关联。
// 上游提交日志缺 task_id（new-api service/task_billing.go LogTaskConsumption），
// 只有结算/退款日志带 other."task_id"，故关联采用双引擎：
//   exact     — logs.other 含 "task_id":"<id>"（结算/退款日志、上游修复后的全部日志）
//   heuristic — 提交消费日志：user_id + channel_id + quota 相等 + other 含 is_task
//               + 时间与 submit_time 相差 ≤120s（存量生图日志唯一可行的匹配）
type TaskLogService struct {
	db    *database.Manager
	logDB *database.Manager
}

func NewTaskLogService() *TaskLogService {
	return &TaskLogService{db: database.Get(), logDB: database.GetLog()}
}

// TaskListParams 任务列表查询参数
type TaskListParams struct {
	Page     int
	PageSize int
	Username string // 模糊搜索用户名
	UserID   int64
	Platform string
	Status   string
	TaskID   string // 精确查找任务 ID
}

// ListTasks 分页查询任务日志（join users 支持用户搜索）
func (s *TaskLogService) ListTasks(params TaskListParams) (map[string]interface{}, error) {
	if params.Page < 1 {
		params.Page = 1
	}
	if params.PageSize < 1 || params.PageSize > 100 {
		params.PageSize = 20
	}

	groupCol := s.db.QuoteIdentifier("group")
	var conditions []string
	var args []interface{}

	if params.Username != "" {
		conditions = append(conditions, "u.username LIKE ?")
		args = append(args, "%"+params.Username+"%")
	}
	if params.UserID > 0 {
		conditions = append(conditions, "t.user_id = ?")
		args = append(args, params.UserID)
	} else if cond, wlArgs := PanelWhitelistNotInClause("t.user_id"); cond != "" {
		conditions = append(conditions, cond)
		args = append(args, wlArgs...)
	}
	if params.Platform != "" {
		conditions = append(conditions, "t.platform = ?")
		args = append(args, params.Platform)
	}
	if params.Status != "" {
		conditions = append(conditions, "t.status = ?")
		args = append(args, params.Status)
	}
	if params.TaskID != "" {
		conditions = append(conditions, "t.task_id = ?")
		args = append(args, strings.TrimSpace(params.TaskID))
	}

	whereClause := "1=1"
	if len(conditions) > 0 {
		whereClause = strings.Join(conditions, " AND ")
	}

	countRow, err := s.db.QueryOne(s.db.RebindQuery(fmt.Sprintf(`
		SELECT COUNT(*) as total
		FROM tasks t
		LEFT JOIN users u ON t.user_id = u.id
		WHERE %s`, whereClause)), args...)
	if err != nil {
		return nil, err
	}
	total := int64(0)
	if countRow != nil {
		total = toInt64(countRow["total"])
	}
	totalPages := (total + int64(params.PageSize) - 1) / int64(params.PageSize)
	if totalPages < 1 {
		totalPages = 1
	}

	offset := (params.Page - 1) * params.PageSize
	rows, err := s.db.Query(s.db.RebindQuery(fmt.Sprintf(`
		SELECT t.id, t.task_id, COALESCE(t.platform, '') as platform,
			t.user_id, COALESCE(u.username, '') as username,
			COALESCE(t.channel_id, 0) as channel_id,
			COALESCE(t.%s, '') as task_group,
			COALESCE(t.quota, 0) as quota,
			COALESCE(t.action, '') as action,
			COALESCE(t.status, '') as status,
			COALESCE(t.progress, '') as progress,
			COALESCE(t.fail_reason, '') as fail_reason,
			COALESCE(t.submit_time, 0) as submit_time,
			COALESCE(t.start_time, 0) as start_time,
			COALESCE(t.finish_time, 0) as finish_time
		FROM tasks t
		LEFT JOIN users u ON t.user_id = u.id
		WHERE %s
		ORDER BY t.id DESC
		LIMIT ? OFFSET ?`, groupCol, whereClause)),
		append(args, params.PageSize, offset)...)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}

	return map[string]interface{}{
		"items":       rows,
		"total":       total,
		"page":        params.Page,
		"page_size":   params.PageSize,
		"total_pages": totalPages,
	}, nil
}

// GetTaskStatistics 任务状态/平台聚合统计
func (s *TaskLogService) GetTaskStatistics() (map[string]interface{}, error) {
	statusRows, err := s.db.Query(`
		SELECT COALESCE(status, '') as status, COUNT(*) as count,
			COALESCE(SUM(quota), 0) as quota
		FROM tasks
		GROUP BY COALESCE(status, '')`)
	if err != nil {
		return nil, err
	}
	platformRows, _ := s.db.Query(`
		SELECT COALESCE(platform, '') as platform, COUNT(*) as count
		FROM tasks
		GROUP BY COALESCE(platform, '')
		ORDER BY count DESC`)
	if statusRows == nil {
		statusRows = []map[string]interface{}{}
	}
	if platformRows == nil {
		platformRows = []map[string]interface{}{}
	}
	return map[string]interface{}{
		"by_status":   statusRows,
		"by_platform": platformRows,
	}, nil
}

// GetTaskRelatedLogs 找出与任务关联的使用日志（精确 + 启发式）
func (s *TaskLogService) GetTaskRelatedLogs(taskDBID int64) (map[string]interface{}, error) {
	task, err := s.db.QueryOne(s.db.RebindQuery(`
		SELECT id, task_id, user_id, COALESCE(channel_id, 0) as channel_id,
			COALESCE(quota, 0) as quota,
			COALESCE(submit_time, 0) as submit_time,
			COALESCE(finish_time, 0) as finish_time
		FROM tasks WHERE id = ?`), taskDBID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, fmt.Errorf("task %d not found", taskDBID)
	}

	taskID := fmt.Sprintf("%v", task["task_id"])
	userID := toInt64(task["user_id"])
	channelID := toInt64(task["channel_id"])
	quota := toInt64(task["quota"])
	submitTime := toInt64(task["submit_time"])
	finishTime := toInt64(task["finish_time"])

	// 时间窗：提交前 5 分钟 ~ 完成后 1 小时（未完成则提交后 24 小时），
	// 让查询先走 created_at 索引收窄，再做 LIKE。
	windowStart := submitTime - 300
	windowEnd := finishTime + 3600
	if finishTime <= 0 {
		windowEnd = submitTime + 86400
	}
	if submitTime <= 0 {
		windowStart = time.Now().Unix() - 7*86400
		windowEnd = time.Now().Unix()
	}

	selectCols := `id, created_at, type, COALESCE(model_name, '') as model_name,
			COALESCE(quota, 0) as quota,
			COALESCE(token_name, '') as token_name,
			COALESCE(content, '') as content,
			COALESCE(ip, '') as ip,
			COALESCE(other, '') as other`

	// ===== 精确匹配：other 含 "task_id":"<id>" =====
	exact := []map[string]interface{}{}
	if taskID != "" {
		exactRows, err := s.logDB.QueryWithTimeout(30*time.Second, s.logDB.RebindQuery(fmt.Sprintf(`
			SELECT %s
			FROM logs
			WHERE user_id = ? AND created_at >= ? AND created_at <= ?
				AND other LIKE ?
			ORDER BY id ASC`, selectCols)),
			userID, windowStart, windowEnd, `%"task_id":"`+taskID+`"%`)
		if err == nil && exactRows != nil {
			exact = exactRows
		}
	}
	exactIDs := make(map[int64]bool, len(exact))
	for _, row := range exact {
		row["match_type"] = "exact"
		exactIDs[toInt64(row["id"])] = true
	}

	// ===== 启发式匹配：提交消费日志（缺 task_id 的存量生图日志） =====
	heuristic := []map[string]interface{}{}
	if quota > 0 {
		heuRows, err := s.logDB.QueryWithTimeout(30*time.Second, s.logDB.RebindQuery(fmt.Sprintf(`
			SELECT %s
			FROM logs
			WHERE user_id = ? AND created_at >= ? AND created_at <= ?
				AND channel_id = ? AND quota = ? AND type = 2
				AND other LIKE ?
			ORDER BY id ASC`, selectCols)),
			userID, submitTime-120, submitTime+120, channelID, quota, `%"is_task":true%`)
		if err == nil {
			for _, row := range heuRows {
				if exactIDs[toInt64(row["id"])] {
					continue
				}
				row["match_type"] = "heuristic"
				heuristic = append(heuristic, row)
			}
		}
	}

	logs := append(exact, heuristic...)
	return map[string]interface{}{
		"task_id":         taskID,
		"logs":            logs,
		"exact_count":     len(exact),
		"heuristic_count": len(heuristic),
	}, nil
}

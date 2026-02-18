package service

import (
	"sync"

	"github.com/new-api-tools/backend/internal/database"
	"github.com/new-api-tools/backend/internal/logger"
)

var (
	quotaDataOnce      sync.Once
	quotaDataAvailable bool
)

// IsQuotaDataAvailable checks (once) whether the quota_data table exists and has data
func IsQuotaDataAvailable() bool {
	quotaDataOnce.Do(func() {
		db := database.Get()
		exists, err := db.TableExists("quota_data")
		if err != nil || !exists {
			logger.L.System("quota_data 表不存在，使用 logs 表回退查询")
			return
		}
		// Check if it has any data
		row, err := db.QueryOne("SELECT 1 FROM quota_data LIMIT 1")
		if err != nil || row == nil {
			logger.L.System("quota_data 表为空，使用 logs 表回退查询")
			return
		}
		quotaDataAvailable = true
		logger.L.System("quota_data 表可用，启用加速查询路径")
	})
	return quotaDataAvailable
}

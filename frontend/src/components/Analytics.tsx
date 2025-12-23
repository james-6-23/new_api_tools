import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { ConfirmModal } from './ConfirmModal'

interface UserRanking {
  user_id: number
  username: string
  request_count: number
  quota_used: number
}

interface ModelStats {
  model_name: string
  total_requests: number
  success_count: number
  empty_count: number
  success_rate: number
  empty_rate: number
}

interface AnalyticsState {
  last_log_id: number
  last_processed_at: number
  total_processed: number
}

interface SyncStatus {
  last_log_id: number
  max_log_id: number
  init_cutoff_id: number | null
  total_logs_in_db: number
  total_processed: number
  progress_percent: number
  remaining_logs: number
  is_synced: boolean
  is_initializing: boolean
  data_inconsistent: boolean
  needs_reset: boolean
}

export function Analytics() {
  const { token } = useAuth()
  const { showToast } = useToast()

  const [state, setState] = useState<AnalyticsState | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [requestRanking, setRequestRanking] = useState<UserRanking[]>([])
  const [quotaRanking, setQuotaRanking] = useState<UserRanking[]>([])
  const [modelStats, setModelStats] = useState<ModelStats[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [batchProcessing, setBatchProcessing] = useState(false)
  
  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean
    title: string
    message: string
    type: 'warning' | 'danger' | 'info'
    onConfirm: () => void
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'warning',
    onConfirm: () => {},
  })

  const apiUrl = import.meta.env.VITE_API_URL || ''

  const getAuthHeaders = useCallback(() => {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    }
  }, [token])

  // Fetch sync status
  const fetchSyncStatus = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/analytics/sync-status`, {
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        setSyncStatus(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch sync status:', error)
    }
  }, [apiUrl, getAuthHeaders])

  // Fetch all analytics data
  const fetchAnalytics = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/analytics/summary`, {
        headers: getAuthHeaders(),
      })
      const data = await response.json()

      if (data.success) {
        setState(data.data.state)
        setRequestRanking(data.data.user_request_ranking || [])
        setQuotaRanking(data.data.user_quota_ranking || [])
        setModelStats(data.data.model_statistics || [])
      }
    } catch (error) {
      console.error('Failed to fetch analytics:', error)
      showToast('error', '加载分析数据失败')
    } finally {
      setLoading(false)
    }
  }, [apiUrl, getAuthHeaders, showToast])

  // Process new logs (single batch)
  const processLogs = async () => {
    setProcessing(true)
    try {
      const response = await fetch(`${apiUrl}/api/analytics/process`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      const data = await response.json()

      if (data.success) {
        if (data.processed > 0) {
          showToast('success', `已处理 ${data.processed} 条日志`)
          fetchAnalytics()
          fetchSyncStatus()
        } else {
          showToast('info', '没有新日志需要处理')
        }
      } else {
        showToast('error', data.message || '处理失败')
      }
    } catch (error) {
      console.error('Failed to process logs:', error)
      showToast('error', '处理日志失败')
    } finally {
      setProcessing(false)
    }
  }

  // Batch process logs (for initial sync) - auto continues until complete
  const batchProcessLogs = async (isAutoSync = false) => {
    if (!isAutoSync) {
      setConfirmModal({
        isOpen: true,
        title: '批量同步',
        message: '确定要进行批量处理吗？这将处理所有历史日志，可能需要几分钟时间。',
        type: 'info',
        onConfirm: () => {
          setConfirmModal(prev => ({ ...prev, isOpen: false }))
          startBatchProcess()
        },
      })
      return
    }
    await startBatchProcess()
  }

  const startBatchProcess = async () => {
    setBatchProcessing(true)
    try {
      const response = await fetch(`${apiUrl}/api/analytics/batch?max_iterations=10000`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      const data = await response.json()

      if (data.success) {
        if (data.completed) {
          showToast('success', `同步完成！共处理 ${data.total_processed} 条日志，耗时 ${data.elapsed_seconds} 秒`)
          // Refresh both analytics and sync status to update UI
          await Promise.all([fetchAnalytics(), fetchSyncStatus()])
          setBatchProcessing(false)
        } else {
          // Not completed yet, continue automatically
          // Update sync status to show progress
          await fetchSyncStatus()
          // Auto continue after a short delay
          setTimeout(() => batchProcessLogs(true), 100)
        }
      } else {
        showToast('error', '批量处理失败')
        setBatchProcessing(false)
      }
    } catch (error) {
      console.error('Failed to batch process logs:', error)
      showToast('error', '批量处理失败')
      setBatchProcessing(false)
    }
  }

  // Reset analytics
  const resetAnalytics = async () => {
    setConfirmModal({
      isOpen: true,
      title: '重置分析数据',
      message: '确定要重置所有分析数据吗？此操作不可恢复，需要重新同步所有日志。',
      type: 'danger',
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }))
        try {
          const response = await fetch(`${apiUrl}/api/analytics/reset`, {
            method: 'POST',
            headers: getAuthHeaders(),
          })
          const data = await response.json()

          if (data.success) {
            showToast('success', '分析数据已重置')
            fetchAnalytics()
            fetchSyncStatus()
          } else {
            showToast('error', '重置失败')
          }
        } catch (error) {
          console.error('Failed to reset analytics:', error)
          showToast('error', '重置失败')
        }
      },
    })
  }

  // Auto reset when data is inconsistent (logs deleted)
  const autoResetInconsistent = async () => {
    try {
      const response = await fetch(`${apiUrl}/api/analytics/check-consistency?auto_reset=true`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      const data = await response.json()

      if (data.success && data.reset) {
        showToast('success', '检测到日志已删除，分析数据已自动重置')
        fetchAnalytics()
        fetchSyncStatus()
      }
    } catch (error) {
      console.error('Failed to auto reset:', error)
      showToast('error', '自动重置失败')
    }
  }

  useEffect(() => {
    fetchAnalytics()
    fetchSyncStatus()
  }, [fetchAnalytics, fetchSyncStatus])

  const formatQuota = (quota: number) => {
    return `$${(quota / 500000).toFixed(2)}`
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`
    }
    return num.toString()
  }

  const formatTimestamp = (ts: number) => {
    if (!ts) return '从未'
    return new Date(ts * 1000).toLocaleString('zh-CN')
  }

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 95) return 'text-green-600'
    if (rate >= 80) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getEmptyRateColor = (rate: number) => {
    if (rate <= 5) return 'text-green-600'
    if (rate <= 15) return 'text-yellow-600'
    return 'text-red-600'
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Data Inconsistent Warning */}
      {syncStatus && syncStatus.data_inconsistent && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start">
            <svg className="w-5 h-5 mt-0.5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-red-800">
                数据不一致
              </h3>
              <p className="text-sm mt-1 text-red-700">
                检测到日志数据已被删除。本地分析数据已过时（本地记录到 <span className="font-semibold">#{syncStatus.last_log_id}</span>，
                数据库最大ID为 <span className="font-semibold">#{syncStatus.max_log_id}</span>）。
                请点击重置按钮清空分析数据后重新同步。
              </p>
            </div>
            <button
              onClick={autoResetInconsistent}
              className="ml-4 inline-flex items-center px-3 py-1.5 border border-red-600 text-sm font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none"
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              自动重置
            </button>
          </div>
        </div>
      )}

      {/* Sync Status Card */}
      {syncStatus && !syncStatus.is_synced && !syncStatus.data_inconsistent && (
        <div className={`border rounded-lg p-4 ${syncStatus.is_initializing ? 'bg-blue-50 border-blue-200' : 'bg-yellow-50 border-yellow-200'}`}>
          <div className="flex items-start">
            <svg className={`w-5 h-5 mt-0.5 ${syncStatus.is_initializing ? 'text-blue-600' : 'text-yellow-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {syncStatus.is_initializing ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              )}
            </svg>
            <div className="ml-3 flex-1">
              <h3 className={`text-sm font-medium ${syncStatus.is_initializing ? 'text-blue-800' : 'text-yellow-800'}`}>
                {syncStatus.is_initializing ? '正在初始化同步...' : '需要初始化同步'}
              </h3>
              <p className={`text-sm mt-1 ${syncStatus.is_initializing ? 'text-blue-700' : 'text-yellow-700'}`}>
                {syncStatus.is_initializing ? (
                  <>
                    初始化截止点: <span className="font-semibold">#{syncStatus.init_cutoff_id}</span>，
                    已处理到 <span className="font-semibold">#{syncStatus.last_log_id}</span>
                  </>
                ) : (
                  <>
                    数据库中共有 <span className="font-semibold">{formatNumber(syncStatus.total_logs_in_db)}</span> 条日志，
                    已处理 <span className="font-semibold">{formatNumber(syncStatus.total_processed)}</span> 条
                  </>
                )}
                {' '}({syncStatus.progress_percent}%)
              </p>
              <div className="mt-3">
                <div className={`flex items-center justify-between text-xs mb-1 ${syncStatus.is_initializing ? 'text-blue-700' : 'text-yellow-700'}`}>
                  <span>同步进度</span>
                  <span>{syncStatus.progress_percent}%</span>
                </div>
                <div className={`w-full rounded-full h-2 ${syncStatus.is_initializing ? 'bg-blue-200' : 'bg-yellow-200'}`}>
                  <div
                    className={`h-2 rounded-full transition-all ${syncStatus.is_initializing ? 'bg-blue-500' : 'bg-yellow-500'}`}
                    style={{ width: `${syncStatus.progress_percent}%` }}
                  ></div>
                </div>
                <p className={`text-xs mt-2 ${syncStatus.is_initializing ? 'text-blue-600' : 'text-yellow-600'}`}>
                  剩余 {formatNumber(syncStatus.remaining_logs)} 条待处理
                  {syncStatus.is_initializing && ' (初始化期间新增日志将在完成后处理)'}
                </p>
              </div>
            </div>
            <button
              onClick={() => batchProcessLogs(false)}
              disabled={batchProcessing}
              className={`ml-4 inline-flex items-center px-3 py-1.5 border text-sm font-medium rounded-md focus:outline-none disabled:opacity-50 ${
                syncStatus.is_initializing
                  ? 'border-blue-600 text-blue-700 bg-blue-100 hover:bg-blue-200'
                  : 'border-yellow-600 text-yellow-700 bg-yellow-100 hover:bg-yellow-200'
              }`}
            >
              {batchProcessing ? (
                <>
                  <svg className="animate-spin -ml-0.5 mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  同步中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {syncStatus.is_initializing ? '继续同步' : '开始同步'}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Header with Actions */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center space-x-3">
              <h2 className="text-lg font-medium text-gray-900">日志分析</h2>
              {syncStatus?.is_synced && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1"></span>
                  已同步
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              已处理 <span className="font-medium text-blue-600">{formatNumber(state?.total_processed || 0)}</span> 条日志
              {state?.last_processed_at ? (
                <span className="ml-2">
                  · 上次更新: {formatTimestamp(state.last_processed_at)}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={processLogs}
              disabled={processing || batchProcessing}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {processing ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  处理中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  处理新日志
                </>
              )}
            </button>
            <button
              onClick={resetAnalytics}
              className="inline-flex items-center px-4 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              重置
            </button>
          </div>
        </div>
      </div>

      {/* User Rankings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Request Count Ranking */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">
              用户请求数排行
              <span className="ml-2 text-sm font-normal text-gray-500">Top 10</span>
            </h3>
          </div>
          {requestRanking.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">排名</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">用户</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">请求数</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {requestRanking.map((user, index) => (
                    <tr key={user.user_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <RankBadge rank={index + 1} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-medium text-blue-600">
                            {user.username.charAt(0).toUpperCase()}
                          </div>
                          <div className="ml-3">
                            <div className="text-sm font-medium text-gray-900">{user.username}</div>
                            <div className="text-xs text-gray-500">ID: {user.user_id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <span className="text-sm font-semibold text-gray-900">
                          {formatNumber(user.request_count)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-gray-500">暂无数据</div>
          )}
        </div>

        {/* Quota Consumption Ranking */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">
              用户额度消耗排行
              <span className="ml-2 text-sm font-normal text-gray-500">Top 10</span>
            </h3>
          </div>
          {quotaRanking.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">排名</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">用户</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">消耗额度</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {quotaRanking.map((user, index) => (
                    <tr key={user.user_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <RankBadge rank={index + 1} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center text-sm font-medium text-green-600">
                            {user.username.charAt(0).toUpperCase()}
                          </div>
                          <div className="ml-3">
                            <div className="text-sm font-medium text-gray-900">{user.username}</div>
                            <div className="text-xs text-gray-500">ID: {user.user_id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <span className="text-sm font-semibold text-green-600">
                          {formatQuota(user.quota_used)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-gray-500">暂无数据</div>
          )}
        </div>
      </div>

      {/* Model Statistics */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">
            模型统计
            <span className="ml-2 text-sm font-normal text-gray-500">成功率 & 空回复率</span>
          </h3>
        </div>
        {modelStats.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">模型</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">总请求</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">成功数</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">空回复数</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">成功率</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">空回复率</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {modelStats.map((model) => (
                  <tr key={model.model_name} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-gray-900 max-w-xs truncate block" title={model.model_name}>
                        {model.model_name}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900">
                      {model.total_requests.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900">
                      {model.success_count.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900">
                      {model.empty_count.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <span className={`text-sm font-semibold ${getSuccessRateColor(model.success_rate)}`}>
                        {model.success_rate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <span className={`text-sm font-semibold ${getEmptyRateColor(model.empty_rate)}`}>
                        {model.empty_rate.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-12 text-center text-gray-500">暂无数据，请先处理日志</div>
        )}
      </div>

      {/* Legend */}
      <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
        <div className="flex flex-wrap gap-6">
          <div className="flex items-center">
            <span className="w-3 h-3 rounded-full bg-green-500 mr-2"></span>
            <span>成功率 ≥ 95% / 空回复率 ≤ 5%</span>
          </div>
          <div className="flex items-center">
            <span className="w-3 h-3 rounded-full bg-yellow-500 mr-2"></span>
            <span>成功率 80-95% / 空回复率 5-15%</span>
          </div>
          <div className="flex items-center">
            <span className="w-3 h-3 rounded-full bg-red-500 mr-2"></span>
            <span>成功率 &lt; 80% / 空回复率 &gt; 15%</span>
          </div>
        </div>
      </div>

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        type={confirmModal.type}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-yellow-400 text-yellow-900 text-xs font-bold">
        1
      </span>
    )
  }
  if (rank === 2) {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-300 text-gray-700 text-xs font-bold">
        2
      </span>
    )
  }
  if (rank === 3) {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-300 text-orange-800 text-xs font-bold">
        3
      </span>
    )
  }
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 text-gray-500 text-sm">
      {rank}
    </span>
  )
}

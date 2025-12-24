import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { RefreshCw, Trash2, AlertTriangle, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Progress } from './ui/progress'
import { Badge } from './ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

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
  const [displayProgress, setDisplayProgress] = useState(0) // 平滑显示的进度
  const [requestRanking, setRequestRanking] = useState<UserRanking[]>([])
  const [quotaRanking, setQuotaRanking] = useState<UserRanking[]>([])
  const [modelStats, setModelStats] = useState<ModelStats[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [batchProcessing, setBatchProcessing] = useState(false)
  
  const [confirmDialog, setConfirmDialog] = useState<{
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

  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  // 平滑进度动画：在实际进度和显示进度之间插值
  useEffect(() => {
    if (!syncStatus || !batchProcessing) {
      setDisplayProgress(syncStatus?.progress_percent || 0)
      return
    }

    const targetProgress = syncStatus.progress_percent
    if (displayProgress >= targetProgress) {
      setDisplayProgress(targetProgress)
      return
    }

    // 每 50ms 增加一点进度，模拟平滑过渡
    const interval = setInterval(() => {
      setDisplayProgress(prev => {
        const diff = targetProgress - prev
        if (diff <= 0.1) return targetProgress
        // 每次增加差值的 10%，实现缓动效果
        return prev + Math.max(0.1, diff * 0.1)
      })
    }, 50)

    return () => clearInterval(interval)
  }, [syncStatus?.progress_percent, batchProcessing, displayProgress])

  const fetchSyncStatus = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/analytics/sync-status`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) setSyncStatus(data.data)
    } catch (error) {
      console.error('Failed to fetch sync status:', error)
    }
  }, [apiUrl, getAuthHeaders])

  const fetchAnalytics = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/analytics/summary`, { headers: getAuthHeaders() })
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

  const batchProcessLogs = async (isAutoSync = false) => {
    if (!isAutoSync) {
      setConfirmDialog({
        isOpen: true,
        title: '批量同步',
        message: '确定要进行批量处理吗？这将处理所有历史日志，可能需要几分钟时间。',
        type: 'info',
        onConfirm: () => {
          setConfirmDialog(prev => ({ ...prev, isOpen: false }))
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
      const response = await fetch(`${apiUrl}/api/analytics/batch?max_iterations=100`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        await fetchSyncStatus()
        if (data.completed) {
          showToast('success', `同步完成！共处理 ${data.total_processed.toLocaleString()} 条日志`)
          await fetchAnalytics()
          setBatchProcessing(false)
        } else {
          setTimeout(() => startBatchProcess(), 50)
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

  const resetAnalytics = async () => {
    setConfirmDialog({
      isOpen: true,
      title: '重置分析数据',
      message: '确定要重置所有分析数据吗？此操作不可恢复，需要重新同步所有日志。',
      type: 'danger',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }))
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

  const formatQuota = (quota: number) => `$${(quota / 500000).toFixed(2)}`
  const formatNumber = (num: number) => num.toLocaleString('zh-CN')
  const formatTimestamp = (ts: number) => ts ? new Date(ts * 1000).toLocaleString('zh-CN') : '从未'

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    )
  }


  return (
    <div className="space-y-6">
      {/* Data Inconsistent Warning */}
      {syncStatus?.data_inconsistent && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-destructive">数据不一致</h3>
                <p className="text-sm text-destructive/80 mt-1">
                  检测到日志数据已被删除。本地记录到 #{syncStatus.last_log_id}，数据库最大ID为 #{syncStatus.max_log_id}。
                </p>
              </div>
              <Button variant="destructive" size="sm" onClick={autoResetInconsistent}>
                <RefreshCw className="h-4 w-4 mr-1" />
                自动重置
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sync Status */}
      {syncStatus && !syncStatus.is_synced && !syncStatus.data_inconsistent && (
        <Card className={syncStatus.is_initializing ? 'border-primary bg-primary/5' : 'border-yellow-500 bg-yellow-50'}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <RefreshCw className={`h-5 w-5 mt-0.5 ${syncStatus.is_initializing ? 'text-primary' : 'text-yellow-600'}`} />
              <div className="flex-1">
                <h3 className={`font-medium ${syncStatus.is_initializing ? 'text-primary' : 'text-yellow-800'}`}>
                  {syncStatus.is_initializing ? '正在初始化同步...' : '需要初始化同步'}
                </h3>
                <p className={`text-sm mt-1 ${syncStatus.is_initializing ? 'text-primary/80' : 'text-yellow-700'}`}>
                  {syncStatus.is_initializing
                    ? `初始化截止点: #${syncStatus.init_cutoff_id}，已处理到 #${syncStatus.last_log_id}`
                    : `数据库共有 ${formatNumber(syncStatus.total_logs_in_db)} 条日志，已处理 ${formatNumber(syncStatus.total_processed)} 条`
                  } ({displayProgress.toFixed(2)}%)
                </p>
                <div className="mt-3">
                  <Progress 
                    value={displayProgress} 
                    className="h-2"
                    indicatorClassName={syncStatus.is_initializing ? 'bg-primary' : 'bg-yellow-500'}
                  />
                  <p className={`text-xs mt-2 ${syncStatus.is_initializing ? 'text-primary/70' : 'text-yellow-600'}`}>
                    剩余 {formatNumber(syncStatus.remaining_logs)} 条待处理
                  </p>
                </div>
              </div>
              <Button
                variant={syncStatus.is_initializing ? 'default' : 'outline'}
                size="sm"
                onClick={() => batchProcessLogs(false)}
                disabled={batchProcessing}
              >
                {batchProcessing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                {batchProcessing ? '同步中...' : syncStatus.is_initializing ? '继续同步' : '开始同步'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Header */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-medium">日志分析</h2>
                {syncStatus?.is_synced && <Badge variant="success">已同步</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                已处理 <span className="font-medium text-primary">{formatNumber(state?.total_processed || 0)}</span> 条日志
                {state?.last_processed_at && <span className="ml-2">· 上次更新: {formatTimestamp(state.last_processed_at)}</span>}
              </p>
            </div>
            <div className="flex gap-3">
              <Button onClick={processLogs} disabled={processing || batchProcessing}>
                {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                处理新日志
              </Button>
              <Button variant="destructive" onClick={resetAnalytics}>
                <Trash2 className="h-4 w-4 mr-2" />
                重置
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* User Rankings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">用户请求数排行 <span className="text-sm font-normal text-muted-foreground">Top 10</span></CardTitle>
          </CardHeader>
          <CardContent>
            {requestRanking.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">排名</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead className="text-right">请求数</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requestRanking.map((user, index) => (
                    <TableRow key={user.user_id}>
                      <TableCell><RankBadge rank={index + 1} /></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                            {user.username.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium">{user.username}</div>
                            <div className="text-xs text-muted-foreground">ID: {user.user_id}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{formatNumber(user.request_count)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="py-12 text-center text-muted-foreground">暂无数据</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">用户额度消耗排行 <span className="text-sm font-normal text-muted-foreground">Top 10</span></CardTitle>
          </CardHeader>
          <CardContent>
            {quotaRanking.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">排名</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead className="text-right">消耗额度</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotaRanking.map((user, index) => (
                    <TableRow key={user.user_id}>
                      <TableCell><RankBadge rank={index + 1} /></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center text-sm font-medium text-green-600">
                            {user.username.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium">{user.username}</div>
                            <div className="text-xs text-muted-foreground">ID: {user.user_id}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-green-600">{formatQuota(user.quota_used)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="py-12 text-center text-muted-foreground">暂无数据</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Model Statistics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">模型统计 <span className="text-sm font-normal text-muted-foreground">成功率 & 空回复率</span></CardTitle>
        </CardHeader>
        <CardContent>
          {modelStats.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>模型</TableHead>
                  <TableHead className="text-right">总请求</TableHead>
                  <TableHead className="text-right">成功数</TableHead>
                  <TableHead className="text-right">空回复数</TableHead>
                  <TableHead className="text-right">成功率</TableHead>
                  <TableHead className="text-right">空回复率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modelStats.map((model) => (
                  <TableRow key={model.model_name}>
                    <TableCell className="font-medium max-w-xs truncate" title={model.model_name}>{model.model_name}</TableCell>
                    <TableCell className="text-right">{model.total_requests.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{model.success_count.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{model.empty_count.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <span className={model.success_rate >= 95 ? 'text-green-600' : model.success_rate >= 80 ? 'text-yellow-600' : 'text-red-600'}>
                        {model.success_rate.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={model.empty_rate <= 5 ? 'text-green-600' : model.empty_rate <= 15 ? 'text-yellow-600' : 'text-red-600'}>
                        {model.empty_rate.toFixed(1)}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="py-12 text-center text-muted-foreground">暂无数据，请先处理日志</div>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-green-500" />
              <span>成功率 ≥ 95% / 空回复率 ≤ 5%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-yellow-500" />
              <span>成功率 80-95% / 空回复率 5-15%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500" />
              <span>成功率 &lt; 80% / 空回复率 &gt; 15%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Confirm Dialog */}
      <Dialog open={confirmDialog.isOpen} onOpenChange={(open: boolean) => setConfirmDialog(prev => ({ ...prev, isOpen: open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmDialog.title}</DialogTitle>
            <DialogDescription>{confirmDialog.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}>取消</Button>
            <Button variant={confirmDialog.type === 'danger' ? 'destructive' : 'default'} onClick={confirmDialog.onConfirm}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  const colors = {
    1: 'bg-yellow-400 text-yellow-900',
    2: 'bg-gray-300 text-gray-700',
    3: 'bg-orange-300 text-orange-800',
  }
  if (rank <= 3) {
    return <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${colors[rank as 1|2|3]}`}>{rank}</span>
  }
  return <span className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground text-sm">{rank}</span>
}

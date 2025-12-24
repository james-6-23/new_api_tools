import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { RefreshCw, ShieldBan, ShieldCheck, Loader2, Activity, AlertTriangle, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Progress } from './ui/progress'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Select } from './ui/select'
import { cn } from '../lib/utils'

type WindowKey = '1h' | '3h' | '6h' | '12h' | '24h'
type SortKey = 'requests' | 'quota' | 'failure_rate'

interface LeaderboardItem {
  user_id: number
  username: string
  user_status: number
  request_count: number
  failure_requests: number
  failure_rate: number
  quota_used: number
  prompt_tokens: number
  completion_tokens: number
  unique_ips: number
}

interface UserAnalysis {
  range: { start_time: number; end_time: number; window_seconds: number }
  user: { id: number; username: string; display_name?: string | null; email?: string | null; status: number; group?: string | null; remark?: string | null }
  summary: {
    total_requests: number
    success_requests: number
    failure_requests: number
    quota_used: number
    prompt_tokens: number
    completion_tokens: number
    avg_use_time: number
    unique_ips: number
    unique_tokens: number
    unique_models: number
    unique_channels: number
    empty_count: number
    failure_rate: number
    empty_rate: number
  }
  risk: { requests_per_minute: number; avg_quota_per_request: number; risk_flags: string[] }
  top_models: Array<{ model_name: string; requests: number; quota_used: number; success_requests: number; failure_requests: number; empty_count: number }>
  top_channels: Array<{ channel_id: number; channel_name: string; requests: number; quota_used: number }>
  top_ips: Array<{ ip: string; requests: number }>
  recent_logs: Array<{ id: number; created_at: number; type: number; model_name: string; quota: number; prompt_tokens: number; completion_tokens: number; use_time: number; ip: string; channel_name: string; token_name: string }>
}

const WINDOW_LABELS: Record<WindowKey, string> = { '1h': '1小时内', '3h': '3小时内', '6h': '6小时内', '12h': '12小时内', '24h': '24小时内' }
const SORT_LABELS: Record<SortKey, string> = { requests: '请求次数', quota: '额度消耗', failure_rate: '失败率' }

function formatNumber(n: number) {
  return n.toLocaleString('zh-CN')
}

function formatTime(ts: number) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatQuota(quota: number) {
  return `$${(quota / 500000).toFixed(2)}`
}

function rankBadgeClass(rank: number) {
  if (rank === 1) return 'bg-yellow-500 text-white shadow-sm'
  if (rank === 2) return 'bg-slate-500 text-white shadow-sm'
  if (rank === 3) return 'bg-orange-500 text-white shadow-sm'
  return 'bg-muted text-muted-foreground font-medium'
}

interface BanRecordItem {
  id: number
  action: 'ban' | 'unban'
  user_id: number
  username: string
  operator: string
  reason: string
  context: Record<string, any>
  created_at: number
}

export function RealtimeRanking() {
  const { token } = useAuth()
  const { showToast } = useToast()
  const apiUrl = import.meta.env.VITE_API_URL || ''

  const windows = useMemo<WindowKey[]>(() => ['1h', '3h', '6h', '12h', '24h'], [])
  const [view, setView] = useState<'leaderboards' | 'ban_records'>('leaderboards')
  const [sortBy, setSortBy] = useState<SortKey>('requests')
  const [data, setData] = useState<Record<WindowKey, LeaderboardItem[]>>({ '1h': [], '3h': [], '6h': [], '12h': [], '24h': [] })
  const [generatedAt, setGeneratedAt] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [countdown, setCountdown] = useState(10)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [selected, setSelected] = useState<{ item: LeaderboardItem; window: WindowKey } | null>(null)
  const [analysis, setAnalysis] = useState<UserAnalysis | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [banReason, setBanReason] = useState('')
  const [disableTokens, setDisableTokens] = useState(true)
  const [enableTokens, setEnableTokens] = useState(false)
  const [mutating, setMutating] = useState(false)

  const [records, setRecords] = useState<BanRecordItem[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsRefreshing, setRecordsRefreshing] = useState(false)
  const [recordsPage, setRecordsPage] = useState(1)
  const [recordsTotalPages, setRecordsTotalPages] = useState(1)

  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  const fetchLeaderboards = useCallback(async (showSuccessToast = false) => {
    try {
      const response = await fetch(`${apiUrl}/api/risk/leaderboards?windows=${windows.join(',')}&limit=10&sort_by=${sortBy}`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        const windowsData = res.data?.windows || {}
        setData({
          '1h': windowsData['1h'] || [],
          '3h': windowsData['3h'] || [],
          '6h': windowsData['6h'] || [],
          '12h': windowsData['12h'] || [],
          '24h': windowsData['24h'] || [],
        })
        setGeneratedAt(res.data?.generated_at || 0)
        setCountdown(10)
        if (showSuccessToast) showToast('success', '已刷新')
      } else {
        showToast('error', res.message || '获取排行榜失败')
      }
    } catch (e) {
      console.error('Failed to fetch leaderboards:', e)
      showToast('error', '获取排行榜失败')
    } finally {
      setLoading(false)
    }
  }, [apiUrl, getAuthHeaders, showToast, windows, sortBy])

  const fetchBanRecords = useCallback(async (page = 1, showSuccessToast = false) => {
    setRecordsLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/risk/ban-records?page=${page}&page_size=50`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        setRecords(res.data?.items || [])
        setRecordsPage(res.data?.page || page)
        setRecordsTotalPages(res.data?.total_pages || 1)
        if (showSuccessToast) showToast('success', '已刷新')
      } else {
        showToast('error', res.message || '获取封禁记录失败')
      }
    } catch (e) {
      console.error('Failed to fetch ban records:', e)
      showToast('error', '获取封禁记录失败')
    } finally {
      setRecordsLoading(false)
    }
  }, [apiUrl, getAuthHeaders, showToast])

  const openUserDialog = (item: LeaderboardItem, window: WindowKey) => {
    setSelected({ item, window })
    setDialogOpen(true)
    setAnalysis(null)
    setBanReason('')
    setDisableTokens(true)
    setEnableTokens(false)
  }

  useEffect(() => {
    if (view === 'leaderboards') fetchLeaderboards()
    if (view === 'ban_records') fetchBanRecords(1)
  }, [fetchLeaderboards, fetchBanRecords, view])

  useEffect(() => {
    if (view !== 'leaderboards') return
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchLeaderboards()
          return 10
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [fetchLeaderboards, view])

  useEffect(() => {
    const load = async () => {
      if (!dialogOpen || !selected) return
      setAnalysisLoading(true)
      try {
        const response = await fetch(`${apiUrl}/api/risk/users/${selected.item.user_id}/analysis?window=${selected.window}`, { headers: getAuthHeaders() })
        const res = await response.json()
        if (res.success) setAnalysis(res.data)
        else showToast('error', res.message || '加载分析失败')
      } catch (e) {
        console.error('Failed to fetch analysis:', e)
        showToast('error', '加载分析失败')
      } finally {
        setAnalysisLoading(false)
      }
    }
    load()
  }, [dialogOpen, selected, apiUrl, getAuthHeaders, showToast])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchLeaderboards(true)
    setRefreshing(false)
  }

  const handleRefreshRecords = async () => {
    setRecordsRefreshing(true)
    await fetchBanRecords(recordsPage, true)
    setRecordsRefreshing(false)
  }

  const metricLabel = SORT_LABELS[sortBy]

  const renderMetric = (item: LeaderboardItem) => {
    if (sortBy === 'quota') return formatQuota(item.quota_used)
    if (sortBy === 'failure_rate') return `${(item.failure_rate * 100).toFixed(2)}%`
    return formatNumber(item.request_count)
  }

  const doBan = async () => {
    if (!selected) return
    setMutating(true)
    try {
      const response = await fetch(`${apiUrl}/api/users/${selected.item.user_id}/ban`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          reason: banReason || null,
          disable_tokens: disableTokens,
          context: {
            source: 'risk_center',
            window: selected.window,
            generated_at: generatedAt,
            risk: analysis?.risk || null,
            summary: analysis ? {
              total_requests: analysis.summary.total_requests,
              failure_rate: analysis.summary.failure_rate,
              empty_rate: analysis.summary.empty_rate,
              unique_ips: analysis.summary.unique_ips,
              unique_tokens: analysis.summary.unique_tokens,
              unique_models: analysis.summary.unique_models,
              unique_channels: analysis.summary.unique_channels,
            } : null,
          },
        }),
      })
      const res = await response.json()
      if (res.success) {
        showToast('success', res.message || '已封禁')
        setDialogOpen(false)
        fetchLeaderboards()
        fetchBanRecords(1)
      } else {
        showToast('error', res.message || '封禁失败')
      }
    } catch (e) {
      console.error('Failed to ban user:', e)
      showToast('error', '封禁失败')
    } finally {
      setMutating(false)
    }
  }

  const doUnban = async () => {
    if (!selected) return
    setMutating(true)
    try {
      const response = await fetch(`${apiUrl}/api/users/${selected.item.user_id}/unban`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          reason: banReason || null,
          enable_tokens: enableTokens,
          context: {
            source: 'risk_center',
            window: selected.window,
            generated_at: generatedAt,
            risk: analysis?.risk || null,
          },
        }),
      })
      const res = await response.json()
      if (res.success) {
        showToast('success', res.message || '已解除封禁')
        setDialogOpen(false)
        fetchLeaderboards()
        fetchBanRecords(1)
      } else {
        showToast('error', res.message || '解除封禁失败')
      }
    } catch (e) {
      console.error('Failed to unban user:', e)
      showToast('error', '解除封禁失败')
    } finally {
      setMutating(false)
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-bold tracking-tight">风控中心</h2>
            {view === 'leaderboards' && (
              <Badge variant="outline" className="animate-pulse border-green-500 text-green-600 bg-green-50 dark:bg-green-950/20">
                <div className="w-2 h-2 rounded-full bg-green-500 mr-2" />
                实时监控中
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1">实时 Top 10 · 深度分析 · 快速封禁</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {view === 'leaderboards' && (
            <>
              <div className="text-xs text-muted-foreground flex items-center tabular-nums">
                <Clock className="w-3 h-3 mr-1" /> {countdown}s 后刷新
              </div>
              <div className="w-40">
                <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
                  <option value="requests">按请求次数</option>
                  <option value="quota">按额度消耗</option>
                  <option value="failure_rate">按失败率</option>
                </Select>
              </div>
            </>
          )}
          {view === 'leaderboards' ? (
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="h-9">
              <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
              刷新
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={handleRefreshRecords} disabled={recordsRefreshing} className="h-9">
              <RefreshCw className={cn("h-4 w-4 mr-2", recordsRefreshing && "animate-spin")} />
              刷新
            </Button>
          )}
        </div>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as any)}>
        <TabsList>
          <TabsTrigger value="leaderboards">实时排行</TabsTrigger>
          <TabsTrigger value="ban_records">封禁记录</TabsTrigger>
        </TabsList>

        <TabsContent value="leaderboards">
          {/* Responsive Grid Layout: 1 col on mobile, 2 cols on tablet/desktop */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {windows.map((w, index) => (
              <Card 
                key={w} 
                className={cn(
                  "rounded-xl shadow-sm transition-all duration-200 hover:shadow-md",
                  // Make the 5th item (24h) span full width on medium screens to be symmetrical (2+2+1)
                  index === 4 && "md:col-span-2"
                )}
              >
                <CardHeader className="pb-3 border-b bg-muted/20">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Activity className="h-4 w-4 text-primary" />
                      {WINDOW_LABELS[w]}
                    </CardTitle>
                    {index === 4 && <span className="text-xs text-muted-foreground">全周期汇总</span>}
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-0">
                  {loading ? (
                    <div className="h-48 flex items-center justify-center text-muted-foreground">
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />加载中...
                    </div>
                  ) : (data[w]?.length ? (
                    <div className="divide-y">
                      {data[w].slice(0, 10).map((item, idx) => {
                        const name = item.username || `User#${item.user_id}`
                        const isBanned = item.user_status === 2
                        return (
                          <div
                            key={`${w}-${item.user_id}`}
                            className={cn(
                              "flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors group",
                              isBanned && "opacity-60 bg-muted/10"
                            )}
                          >
                            <div className={cn(
                              "h-6 w-6 rounded flex items-center justify-center text-xs font-bold flex-shrink-0",
                              rankBadgeClass(idx + 1)
                            )}>
                              {idx + 1}
                            </div>
                            
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm truncate">{name}</span>
                                {isBanned && <Badge variant="destructive" className="h-4 px-1 text-[10px]">禁用</Badge>}
                              </div>
                              <div className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-2">
                                <span>ID: {item.user_id}</span>
                                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                                <span>IP: {item.unique_ips}</span>
                                {index === 4 && (
                                  <>
                                    <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                                    <span>失败: {(item.failure_rate * 100).toFixed(1)}%</span>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <div className="font-bold text-sm tabular-nums">{renderMetric(item)}</div>
                                <div className="text-[10px] text-muted-foreground uppercase">{metricLabel}</div>
                              </div>
                              <Button
                                variant={isBanned ? 'secondary' : 'ghost'}
                                size="icon"
                                className={cn(
                                  "h-8 w-8 transition-opacity",
                                  isBanned ? "opacity-100" : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                )}
                                onClick={() => openUserDialog(item, w)}
                                title={isBanned ? '查看/解除封禁' : '分析/封禁'}
                              >
                                {isBanned ? <ShieldCheck className="h-4 w-4" /> : <ShieldBan className="h-4 w-4" />}
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="h-40 flex flex-col items-center justify-center text-muted-foreground text-sm">
                      <ShieldCheck className="h-8 w-8 mb-2 opacity-20" />
                      暂无风险数据
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="ban_records">
          <Card className="rounded-xl shadow-sm">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-lg">封禁审计记录</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recordsLoading ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 mr-2 animate-spin" />加载中...
                </div>
              ) : (
                <>
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableHead className="w-[180px]">时间</TableHead>
                          <TableHead className="w-[100px]">动作</TableHead>
                          <TableHead className="w-[150px]">操作者</TableHead>
                          <TableHead className="w-[200px]">用户</TableHead>
                          <TableHead>原因</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {records.length ? records.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="text-sm text-muted-foreground font-mono">{formatTime(r.created_at)}</TableCell>
                            <TableCell>
                              {r.action === 'ban'
                                ? <Badge variant="destructive" className="font-normal">封禁</Badge>
                                : <Badge variant="success" className="font-normal">解封</Badge>}
                            </TableCell>
                            <TableCell className="text-sm">{r.operator || '-'}</TableCell>
                            <TableCell className="text-sm">
                              <div className="font-medium">{r.username || `User#${r.user_id}`}</div>
                              <div className="text-xs text-muted-foreground">ID: {r.user_id}</div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-md truncate" title={r.reason}>{r.reason || '-'}</TableCell>
                          </TableRow>
                        )) : (
                          <TableRow>
                            <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">暂无记录</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {recordsTotalPages > 1 && (
                    <div className="flex items-center justify-between p-4 border-t">
                      <div className="text-sm text-muted-foreground">第 {recordsPage} / {recordsTotalPages} 页</div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={recordsPage <= 1 || recordsLoading} onClick={() => fetchBanRecords(recordsPage - 1)}>
                          上一页
                        </Button>
                        <Button variant="outline" size="sm" disabled={recordsPage >= recordsTotalPages || recordsLoading} onClick={() => fetchBanRecords(recordsPage + 1)}>
                          下一页
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Optimized Analysis Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl w-full max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden rounded-xl border-border/50 shadow-2xl">
          {/* Fixed Header */}
          <DialogHeader className="p-5 border-b bg-muted/10 flex-shrink-0">
            <div className="flex justify-between items-start pr-6">
              <div>
                <DialogTitle className="text-xl">用户行为分析</DialogTitle>
                <DialogDescription className="mt-1.5 flex items-center gap-2">
                  <Badge variant="outline">{selected ? WINDOW_LABELS[selected.window] : '-'}</Badge>
                  <span>用户 ID: <span className="font-mono text-foreground">{selected?.item.user_id}</span></span>
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-5 min-h-0 bg-background">
            {analysisLoading ? (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                <Loader2 className="h-8 w-8 mb-4 animate-spin text-primary/50" />
                <p>正在分析海量日志...</p>
              </div>
            ) : analysis ? (
              <div className="space-y-6">
                {/* Risk Overview Tags */}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="px-3 py-1 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    RPM: {analysis.risk.requests_per_minute.toFixed(1)}
                  </Badge>
                  <Badge variant="secondary" className="px-3 py-1 bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                    均额: ${((analysis.risk.avg_quota_per_request || 0) / 500000).toFixed(4)}
                  </Badge>
                  {analysis.risk.risk_flags.length > 0 ? (
                    analysis.risk.risk_flags.map((f) => (
                      <Badge key={f} variant="destructive" className="px-3 py-1 animate-pulse">
                        <AlertTriangle className="w-3 h-3 mr-1" /> {f}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="success" className="px-3 py-1 bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300">
                      <ShieldCheck className="w-3 h-3 mr-1" /> 无明显异常
                    </Badge>
                  )}
                </div>

                {/* Core Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="bg-muted/20 border-none shadow-sm">
                    <CardContent className="p-4 text-center">
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">请求总数</div>
                      <div className="text-2xl font-bold tabular-nums">{formatNumber(analysis.summary.total_requests)}</div>
                    </CardContent>
                  </Card>
                  <Card className={cn("border-none shadow-sm", analysis.summary.failure_rate > 0.5 ? "bg-red-50 dark:bg-red-950/20" : "bg-muted/20")}>
                    <CardContent className="p-4 text-center">
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">失败率</div>
                      <div className={cn("text-2xl font-bold tabular-nums", analysis.summary.failure_rate > 0.5 && "text-red-600")}>
                        {(analysis.summary.failure_rate * 100).toFixed(1)}%
                      </div>
                    </CardContent>
                  </Card>
                  <Card className={cn("border-none shadow-sm", analysis.summary.empty_rate > 0.5 ? "bg-yellow-50 dark:bg-yellow-950/20" : "bg-muted/20")}>
                    <CardContent className="p-4 text-center">
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">空回复率</div>
                      <div className={cn("text-2xl font-bold tabular-nums", analysis.summary.empty_rate > 0.5 && "text-yellow-600")}>
                        {(analysis.summary.empty_rate * 100).toFixed(1)}%
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-muted/20 border-none shadow-sm">
                    <CardContent className="p-4 text-center">
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">IP 来源</div>
                      <div className="text-2xl font-bold tabular-nums">{formatNumber(analysis.summary.unique_ips)}</div>
                    </CardContent>
                  </Card>
                </div>

                {/* Distributions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-muted-foreground">模型偏好 (Top 5)</h4>
                    {analysis.top_models.slice(0, 5).length ? (
                      analysis.top_models.slice(0, 5).map((m) => {
                        const pct = analysis.summary.total_requests ? (m.requests / analysis.summary.total_requests) * 100 : 0
                        return (
                          <div key={m.model_name} className="space-y-1.5">
                            <div className="flex justify-between text-xs">
                              <span className="font-medium truncate max-w-[180px]">{m.model_name}</span>
                              <span className="text-muted-foreground">{formatNumber(m.requests)} ({pct.toFixed(0)}%)</span>
                            </div>
                            <Progress value={pct} className="h-1.5" />
                          </div>
                        )
                      })
                    ) : <div className="text-xs text-muted-foreground italic">无数据</div>}
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-muted-foreground">来源 IP (Top 5)</h4>
                    {analysis.top_ips.slice(0, 5).length ? (
                      analysis.top_ips.slice(0, 5).map((ip) => {
                        const pct = analysis.summary.total_requests ? (ip.requests / analysis.summary.total_requests) * 100 : 0
                        return (
                          <div key={ip.ip} className="space-y-1.5">
                            <div className="flex justify-between text-xs">
                              <span className="font-medium truncate">{ip.ip}</span>
                              <span className="text-muted-foreground">{formatNumber(ip.requests)} ({pct.toFixed(0)}%)</span>
                            </div>
                            <Progress value={pct} className="h-1.5" />
                          </div>
                        )
                      })
                    ) : <div className="text-xs text-muted-foreground italic">无数据</div>}
                  </div>
                </div>

                {/* Recent Logs Table */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-muted-foreground">最近轨迹 (Latest 10)</h4>
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="h-8 bg-muted/50 hover:bg-muted/50">
                          <TableHead className="h-8 text-xs w-[140px]">时间</TableHead>
                          <TableHead className="h-8 text-xs w-[60px]">状态</TableHead>
                          <TableHead className="h-8 text-xs">模型</TableHead>
                          <TableHead className="h-8 text-xs text-right">耗时</TableHead>
                          <TableHead className="h-8 text-xs text-right w-[120px]">IP</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {analysis.recent_logs.slice(0, 10).map((l) => (
                          <TableRow key={l.id} className="h-8 hover:bg-muted/30">
                            <TableCell className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">{formatTime(l.created_at)}</TableCell>
                            <TableCell className="py-1.5 text-xs">
                              {l.type === 5 ? <span className="text-red-500 font-medium">失败</span> : <span className="text-green-500">成功</span>}
                            </TableCell>
                            <TableCell className="py-1.5 text-xs font-medium truncate max-w-[150px]" title={l.model_name}>{l.model_name}</TableCell>
                            <TableCell className="py-1.5 text-xs text-right text-muted-foreground">{l.use_time}ms</TableCell>
                            <TableCell className="py-1.5 text-xs text-right text-muted-foreground font-mono">{l.ip}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                暂无分析数据
              </div>
            )}
          </div>

          {/* Fixed Footer */}
          <div className="p-5 border-t bg-muted/10 flex-shrink-0 space-y-4">
            <div className="flex items-center gap-3">
              <Input 
                value={banReason} 
                onChange={(e) => setBanReason(e.target.value)} 
                placeholder="填写操作原因（可选）..." 
                className="flex-1"
              />
              {analysis?.user.status === 2 ? (
                <label className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap cursor-pointer">
                  <input type="checkbox" checked={enableTokens} onChange={(e) => setEnableTokens(e.target.checked)} className="rounded border-gray-300" />
                  同时启用Tokens
                </label>
              ) : (
                <label className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap cursor-pointer">
                  <input type="checkbox" checked={disableTokens} onChange={(e) => setDisableTokens(e.target.checked)} className="rounded border-gray-300" />
                  同时禁用Tokens
                </label>
              )}
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span>当前状态:</span>
                {analysis ? (
                  analysis.user.status === 2 ? (
                    <Badge variant="destructive">已禁用</Badge>
                  ) : (
                    <Badge variant="success">正常</Badge>
                  )
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={mutating}>取消</Button>
                {analysis?.user.status === 2 ? (
                  <Button onClick={doUnban} disabled={mutating || analysisLoading} className="min-w-28 bg-green-600 hover:bg-green-700">
                    {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                    解除封禁
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={doBan} disabled={mutating || analysisLoading} className="min-w-28">
                    {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldBan className="h-4 w-4 mr-2" />}
                    立即封禁
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}


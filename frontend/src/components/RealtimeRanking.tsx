import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { RefreshCw, ShieldBan, ShieldCheck, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Progress } from './ui/progress'
import { Input } from './ui/input'
import { Badge } from './ui/badge'

type WindowKey = '1h' | '3h' | '6h' | '12h' | '24h'

interface LeaderboardItem {
  user_id: number
  username: string
  user_status: number
  request_count: number
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

function formatNumber(n: number) {
  return n.toLocaleString('zh-CN')
}

function formatTime(ts: number) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function rankBadgeClass(rank: number) {
  if (rank === 1) return 'bg-yellow-500 text-white'
  if (rank === 2) return 'bg-slate-500 text-white'
  if (rank === 3) return 'bg-orange-500 text-white'
  return 'bg-muted text-muted-foreground'
}

export function RealtimeRanking() {
  const { token } = useAuth()
  const { showToast } = useToast()
  const apiUrl = import.meta.env.VITE_API_URL || ''

  const windows = useMemo<WindowKey[]>(() => ['1h', '3h', '6h', '12h', '24h'], [])
  const [data, setData] = useState<Record<WindowKey, LeaderboardItem[]>>({ '1h': [], '3h': [], '6h': [], '12h': [], '24h': [] })
  const [generatedAt, setGeneratedAt] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [selected, setSelected] = useState<{ item: LeaderboardItem; window: WindowKey } | null>(null)
  const [analysis, setAnalysis] = useState<UserAnalysis | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [banReason, setBanReason] = useState('')
  const [disableTokens, setDisableTokens] = useState(true)
  const [enableTokens, setEnableTokens] = useState(false)
  const [mutating, setMutating] = useState(false)

  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  const fetchLeaderboards = useCallback(async (showSuccessToast = false) => {
    try {
      const response = await fetch(`${apiUrl}/api/risk/leaderboards?windows=${windows.join(',')}&limit=10`, { headers: getAuthHeaders() })
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
  }, [apiUrl, getAuthHeaders, showToast, windows])

  const openUserDialog = (item: LeaderboardItem, window: WindowKey) => {
    setSelected({ item, window })
    setDialogOpen(true)
    setAnalysis(null)
    setBanReason('')
    setDisableTokens(true)
    setEnableTokens(false)
  }

  useEffect(() => {
    fetchLeaderboards()
  }, [fetchLeaderboards])

  useEffect(() => {
    const t = setInterval(() => fetchLeaderboards(), 10_000)
    return () => clearInterval(t)
  }, [fetchLeaderboards])

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

  const doBan = async () => {
    if (!selected) return
    setMutating(true)
    try {
      const response = await fetch(`${apiUrl}/api/users/${selected.item.user_id}/ban`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason: banReason || null, disable_tokens: disableTokens }),
      })
      const res = await response.json()
      if (res.success) {
        showToast('success', res.message || '已封禁')
        setDialogOpen(false)
        fetchLeaderboards()
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
        body: JSON.stringify({ reason: banReason || null, enable_tokens: enableTokens }),
      })
      const res = await response.json()
      if (res.success) {
        showToast('success', res.message || '已解除封禁')
        setDialogOpen(false)
        fetchLeaderboards()
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
          <h2 className="text-3xl font-bold tracking-tight">风控中心</h2>
          <p className="text-muted-foreground mt-1">实时 Top 10 · 一键分析与封禁决策</p>
          {generatedAt > 0 && <p className="text-xs text-muted-foreground mt-2">上次更新: {formatTime(generatedAt)}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="h-9">
          <RefreshCw className={(refreshing ? 'animate-spin ' : '') + 'h-4 w-4 mr-2'} />
          刷新
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {windows.map((w) => (
          <Card key={w} className="rounded-2xl shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{WINDOW_LABELS[w]}</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />加载中...
                </div>
              ) : (data[w]?.length ? (
                <div className="max-h-80 overflow-auto pr-2 space-y-2">
                  {data[w].slice(0, 10).map((item, idx) => {
                    const name = item.username || `User#${item.user_id}`
                    const isBanned = item.user_status === 2
                    return (
                      <div
                        key={`${w}-${item.user_id}`}
                        className={'flex items-center gap-3 rounded-xl px-3 py-2 bg-muted/20 hover:bg-muted/30 transition-colors ' + (isBanned ? 'opacity-60' : '')}
                      >
                        <div className={'h-7 w-7 rounded-lg flex items-center justify-center text-sm font-bold ' + rankBadgeClass(idx + 1)}>
                          {idx + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{name}</div>
                          <div className="text-xs text-muted-foreground truncate">ID: {item.user_id} · IP: {item.unique_ips}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <div className="font-semibold tabular-nums">{formatNumber(item.request_count)}</div>
                            <div className="text-[10px] text-muted-foreground">次</div>
                          </div>
                          <Button
                            variant={isBanned ? 'secondary' : 'outline'}
                            size="icon"
                            className="h-8 w-8"
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
                <div className="h-48 flex items-center justify-center text-muted-foreground">暂无数据</div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl rounded-2xl border border-border/50 bg-background shadow-[10px_10px_30px_rgba(0,0,0,0.12),-10px_-10px_30px_rgba(255,255,255,0.6)] dark:shadow-[10px_10px_30px_rgba(0,0,0,0.4),-10px_-10px_30px_rgba(255,255,255,0.04)]">
          <DialogHeader>
            <DialogTitle>用户使用分析</DialogTitle>
            <DialogDescription>
              {selected ? `窗口：${WINDOW_LABELS[selected.window]} · 用户ID：${selected.item.user_id}` : ''}
            </DialogDescription>
          </DialogHeader>

          {analysisLoading ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />加载中...
            </div>
          ) : analysis ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">RPM: {analysis.risk.requests_per_minute.toFixed(1)}</Badge>
                <Badge variant="secondary">均额/次: ${((analysis.risk.avg_quota_per_request || 0) / 500000).toFixed(4)}</Badge>
                {analysis.risk.risk_flags.map((f) => (
                  <Badge key={f} variant="destructive">{f}</Badge>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="rounded-xl">
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">请求数</div>
                    <div className="text-xl font-bold tabular-nums">{formatNumber(analysis.summary.total_requests)}</div>
                  </CardContent>
                </Card>
                <Card className="rounded-xl">
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">失败率</div>
                    <div className="text-xl font-bold tabular-nums">{(analysis.summary.failure_rate * 100).toFixed(2)}%</div>
                  </CardContent>
                </Card>
                <Card className="rounded-xl">
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">空回复率</div>
                    <div className="text-xl font-bold tabular-nums">{(analysis.summary.empty_rate * 100).toFixed(2)}%</div>
                  </CardContent>
                </Card>
                <Card className="rounded-xl">
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">独立IP</div>
                    <div className="text-xl font-bold tabular-nums">{formatNumber(analysis.summary.unique_ips)}</div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Card className="rounded-xl">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">模型分布（Top 10）</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {analysis.top_models.length ? (
                      analysis.top_models.map((m) => {
                        const pct = analysis.summary.total_requests ? (m.requests / analysis.summary.total_requests) * 100 : 0
                        return (
                          <div key={m.model_name} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="truncate max-w-[220px]" title={m.model_name}>{m.model_name}</span>
                              <span className="text-muted-foreground tabular-nums">{formatNumber(m.requests)}</span>
                            </div>
                            <Progress value={pct} />
                          </div>
                        )
                      })
                    ) : (
                      <div className="text-sm text-muted-foreground">暂无数据</div>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-xl">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">IP 分布（Top 10）</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {analysis.top_ips.length ? (
                      analysis.top_ips.map((ip) => (
                        <div key={ip.ip} className="flex items-center justify-between text-sm">
                          <span className="truncate max-w-[240px]" title={ip.ip}>{ip.ip}</span>
                          <span className="text-muted-foreground tabular-nums">{formatNumber(ip.requests)}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground">暂无数据</div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">最近请求（最新 10 条）</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {analysis.recent_logs.slice(0, 10).map((l) => (
                    <div key={l.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-1 rounded-lg bg-muted/20 px-3 py-2">
                      <div className="text-sm truncate">
                        <span className="text-muted-foreground mr-2">#{l.id}</span>
                        <span className="font-medium">{l.model_name || '-'}</span>
                        <span className="text-muted-foreground ml-2">{l.type === 5 ? '失败' : '成功'}</span>
                      </div>
                      <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
                        <span>{formatTime(l.created_at)}</span>
                        {l.ip && <span>IP: {l.ip}</span>}
                        {l.channel_name && <span>渠道: {l.channel_name}</span>}
                        {l.use_time ? <span>耗时: {l.use_time}ms</span> : null}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">封禁原因（可选）</div>
                <Input value={banReason} onChange={(e) => setBanReason(e.target.value)} placeholder="例如：疑似刷量/异常IP/高失败率…" />
              </div>

              <div className="flex items-center justify-between rounded-xl bg-muted/20 px-4 py-3">
                <div className="text-sm">
                  当前状态：
                  <span className={'ml-2 font-medium ' + (analysis.user.status === 2 ? 'text-destructive' : 'text-green-600')}>
                    {analysis.user.status === 2 ? '禁用' : '正常'}
                  </span>
                </div>
                {analysis.user.status === 2 ? (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground select-none">
                    <input type="checkbox" checked={enableTokens} onChange={(e) => setEnableTokens(e.target.checked)} />
                    同时启用 tokens
                  </label>
                ) : (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground select-none">
                    <input type="checkbox" checked={disableTokens} onChange={(e) => setDisableTokens(e.target.checked)} />
                    同时禁用 tokens
                  </label>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">暂无分析数据</div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={mutating}>取消</Button>
            {analysis?.user.status === 2 ? (
              <Button onClick={doUnban} disabled={mutating || analysisLoading} className="min-w-28">
                {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                解除封禁
              </Button>
            ) : (
              <Button variant="destructive" onClick={doBan} disabled={mutating || analysisLoading} className="min-w-28">
                {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldBan className="h-4 w-4 mr-2" />}
                封禁
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

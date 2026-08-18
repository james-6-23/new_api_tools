import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import {
  Key, Loader2, RefreshCw, ShieldBan, ShieldCheck, AlertTriangle, Globe,
  Activity, Clock, User, BarChart3,
} from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Select } from './ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from './ui/dialog'
import { cn } from '../lib/utils'

interface TokenAnalysisData {
  range: { start_time: number; end_time: number; window_seconds: number }
  token: {
    id: number
    key: string
    name: string
    user_id: number
    username: string
    status: number
    remain_quota: number
    used_quota: number
    unlimited_quota: boolean
    allow_ips: string
    model_limits: string
    group: string
    created_time: number
    expired_time: number
  }
  summary: {
    total_requests: number
    success_requests: number
    failure_requests: number
    quota_used: number
    prompt_tokens: number
    completion_tokens: number
    avg_use_time: number
    unique_ips: number
    unique_models: number
    empty_count: number
    failure_rate: number
    empty_rate: number
  }
  risk: {
    requests_per_minute: number
    risk_flags: string[]
    ip_geo_analysis?: { distinct_cities?: number; distinct_countries?: number; cross_city_switches?: number }
  }
  top_models: { model_name: string; requests: number; quota_used: number; failure_requests: number }[]
  top_ips: { ip: string; requests: number; first_seen: number; last_seen: number; geo_label?: string; country_code?: string }[]
  hourly: { slot_idx: number; requests: number; quota_used: number }[]
  recent_logs: { id: number; created_at: number; type: number; model_name: string; quota: number; prompt_tokens: number; completion_tokens: number; use_time: number; ip: string }[]
}

const RISK_FLAG_LABELS: Record<string, string> = {
  HIGH_RPM: '高频请求',
  HIGH_FAILURE_RATE: '高失败率',
  LEAK_SUSPECT: '疑似泄漏',
  MANY_IPS: '多 IP',
  CROSS_CITY_SWITCH: '跨城跳变',
  CROSS_COUNTRY: '跨国来源',
  FREQUENT_IP_SWITCH: '频繁切换 IP',
}

interface TokenAnalysisDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tokenId: number
  tokenName: string
  onOpenUser?: (userId: number, username: string) => void
  onChanged?: () => void
}

export function TokenAnalysisDialog({ open, onOpenChange, tokenId, tokenName, onOpenUser, onChanged }: TokenAnalysisDialogProps) {
  const { token } = useAuth()
  const { showToast } = useToast()

  const [data, setData] = useState<TokenAnalysisData | null>(null)
  const [loading, setLoading] = useState(false)
  const [window_, setWindow] = useState('24h')
  const [opLoading, setOpLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  const fetchAnalysis = useCallback(async () => {
    if (!open || !tokenId) return
    setLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/tokens/${tokenId}/analysis?window=${window_}`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) setData(res.data)
      else showToast('error', res.message || '获取令牌分析失败')
    } catch (error) {
      showToast('error', '网络错误，请重试')
      console.error('Failed to fetch token analysis:', error)
    } finally { setLoading(false) }
  }, [apiUrl, getAuthHeaders, open, tokenId, window_, showToast])

  useEffect(() => { fetchAnalysis() }, [fetchAnalysis])
  useEffect(() => { if (!open) { setData(null); setConfirming(false) } }, [open])

  const formatQuota = (q: number) => `$${((Number(q) || 0) / 500000).toFixed(2)}`
  const formatTs = (ts: number) => {
    if (!ts || ts <= 0) return '-'
    return new Date(ts * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const toggleStatus = async () => {
    if (!data) return
    const disabling = data.token.status === 1
    if (disabling && !confirming) { setConfirming(true); return }
    setOpLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/tokens/batch-${disabling ? 'disable' : 'enable'}`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ids: [tokenId] }),
      })
      const res = await response.json()
      if (res.success) {
        showToast('success', disabling ? '已禁用该令牌' : '已启用该令牌')
        onChanged?.()
        fetchAnalysis()
      } else {
        showToast('error', res.message || '操作失败')
      }
    } catch { showToast('error', '网络错误，请重试') } finally {
      setOpLoading(false)
      setConfirming(false)
    }
  }

  const t = data?.token
  const s = data?.summary
  const maxHourly = Math.max(...(data?.hourly.map(h => Number(h.requests) || 0) || [0]), 1)
  const windowHours = data ? Math.round(data.range.window_seconds / 3600) : 24
  const maxModelReq = Math.max(...(data?.top_models.map(m => Number(m.requests) || 0) || [0]), 1)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Key className="w-5 h-5 text-primary" />
            令牌分析：{tokenName || t?.name || `#${tokenId}`}
            {t && (t.status === 1
              ? <Badge variant="success">启用</Badge>
              : <Badge variant="secondary">禁用</Badge>)}
            {t?.group && <Badge variant="outline">{t.group}</Badge>}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-3 flex-wrap">
            {t && <code className="text-xs font-mono">{t.key}</code>}
            {t && t.user_id > 0 && (
              <button
                type="button"
                onClick={() => onOpenUser?.(t.user_id, t.username || `用户 #${t.user_id}`)}
                className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
              >
                <User className="w-3 h-3" />
                {t.username || `#${t.user_id}`} 的用户画像 →
              </button>
            )}
          </DialogDescription>
        </DialogHeader>

        {loading && !data ? (
          <div className="flex justify-center items-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !data ? (
          <div className="py-16 text-center text-muted-foreground text-sm">暂无数据</div>
        ) : (
          <div className="space-y-4">
            {/* 档案 + 窗口选择 */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <span>额度：{t!.unlimited_quota ? <span className="text-blue-600 font-medium">无限</span> : `剩 ${formatQuota(t!.remain_quota)} / 已用 ${formatQuota(t!.used_quota)}`}</span>
                <span>
                  IP 白名单：{t!.allow_ips
                    ? <code className="font-mono">{t!.allow_ips}</code>
                    : <span className="text-red-500 font-medium">未设置</span>}
                </span>
                <span>创建 {formatTs(t!.created_time)}</span>
                <span>{t!.expired_time > 0 ? `过期 ${formatTs(t!.expired_time)}` : '永不过期'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Select value={window_} onChange={(e) => setWindow(e.target.value)} className="h-8 w-24 text-xs">
                  <option value="1h">近 1 小时</option>
                  <option value="6h">近 6 小时</option>
                  <option value="24h">近 24 小时</option>
                  <option value="3d">近 3 天</option>
                  <option value="7d">近 7 天</option>
                </Select>
                <Button variant="ghost" size="sm" onClick={fetchAnalysis} disabled={loading} className="h-8 w-8 px-0">
                  <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                </Button>
              </div>
            </div>

            {/* 风险标记 */}
            {data.risk.risk_flags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                {data.risk.risk_flags.map(flag => (
                  <span key={flag} className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300 font-medium whitespace-nowrap">
                    {RISK_FLAG_LABELS[flag] || flag}
                  </span>
                ))}
              </div>
            )}

            {/* 窗口统计 */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {[
                { label: '请求数', value: (s!.total_requests || 0).toLocaleString(), icon: Activity },
                { label: '失败率', value: `${((s!.failure_rate || 0) * 100).toFixed(1)}%`, danger: (s!.failure_rate || 0) > 0.1 },
                { label: '消耗额度', value: formatQuota(s!.quota_used) },
                { label: '平均耗时', value: `${(s!.avg_use_time || 0).toFixed(1)}s`, icon: Clock },
                { label: '来源 IP', value: `${s!.unique_ips || 0}`, danger: (s!.unique_ips || 0) >= 5, icon: Globe },
                { label: '空回复率', value: `${((s!.empty_rate || 0) * 100).toFixed(1)}%`, danger: (s!.empty_rate || 0) > 0.1 },
              ].map(({ label, value, danger }) => (
                <div key={label} className="rounded-lg border bg-muted/20 px-2.5 py-2">
                  <div className="text-[10px] text-muted-foreground">{label}</div>
                  <div className={cn('text-sm font-semibold font-mono mt-0.5', danger && 'text-red-600')}>{value}</div>
                </div>
              ))}
            </div>

            {/* 按小时用量 */}
            {data.hourly.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5" />每小时请求（近 {windowHours} 小时）
                </div>
                <div className="flex items-end gap-[2px] h-16">
                  {Array.from({ length: Math.min(windowHours, 168) }, (_, i) => {
                    const slot = data.hourly.find(h => Number(h.slot_idx) === i)
                    const reqs = Number(slot?.requests) || 0
                    return (
                      <div
                        key={i}
                        className={cn('flex-1 min-w-[2px] rounded-t-sm', reqs > 0 ? 'bg-primary/70 hover:bg-primary' : 'bg-muted')}
                        style={{ height: `${Math.max((reqs / maxHourly) * 100, 4)}%` }}
                        title={slot ? `${reqs} 次请求 · ${formatQuota(Number(slot.quota_used))}` : '无请求'}
                      />
                    )
                  })}
                </div>
              </div>
            )}

            {/* Top IP */}
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />来源 IP（{data.top_ips.length}）
              </div>
              {data.top_ips.length === 0 ? (
                <div className="text-xs text-muted-foreground py-4 text-center border rounded-lg">窗口期内无调用记录</div>
              ) : (
                <div className="border rounded-lg overflow-y-auto max-h-[200px] custom-scrollbar">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0">
                      <TableRow>
                        <TableHead className="h-8 text-xs">IP</TableHead>
                        <TableHead className="h-8 text-xs">位置</TableHead>
                        <TableHead className="h-8 text-xs text-right">请求</TableHead>
                        <TableHead className="h-8 text-xs">首次</TableHead>
                        <TableHead className="h-8 text-xs">最后</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.top_ips.map(ip => (
                        <TableRow key={ip.ip} className="hover:bg-muted/50">
                          <TableCell className="py-1.5 font-mono text-xs">{ip.ip}</TableCell>
                          <TableCell className="py-1.5 text-xs text-muted-foreground">{ip.geo_label || '-'}</TableCell>
                          <TableCell className="py-1.5 text-xs font-mono text-right">{Number(ip.requests).toLocaleString()}</TableCell>
                          <TableCell className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">{formatTs(ip.first_seen)}</TableCell>
                          <TableCell className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">{formatTs(ip.last_seen)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Top 模型 */}
            {data.top_models.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1.5">模型消耗 Top {data.top_models.length}</div>
                <div className="space-y-1">
                  {data.top_models.map(m => (
                    <div key={m.model_name} className="flex items-center gap-2 text-xs">
                      <span className="font-mono w-40 truncate" title={m.model_name}>{m.model_name}</span>
                      <div className="flex-1 h-3.5 rounded bg-muted overflow-hidden">
                        <div className="h-full bg-primary/60 rounded" style={{ width: `${(Number(m.requests) / maxModelReq) * 100}%` }} />
                      </div>
                      <span className="font-mono text-muted-foreground w-14 text-right">{Number(m.requests).toLocaleString()}</span>
                      <span className="font-mono text-muted-foreground w-16 text-right">{formatQuota(Number(m.quota_used))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 最近调用 */}
            {data.recent_logs.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1.5">最近调用（{data.recent_logs.length} 条）</div>
                <div className="border rounded-lg overflow-y-auto max-h-[180px] custom-scrollbar">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0">
                      <TableRow>
                        <TableHead className="h-8 text-xs">时间</TableHead>
                        <TableHead className="h-8 text-xs">类型</TableHead>
                        <TableHead className="h-8 text-xs">模型</TableHead>
                        <TableHead className="h-8 text-xs text-right">额度</TableHead>
                        <TableHead className="h-8 text-xs text-right">tokens</TableHead>
                        <TableHead className="h-8 text-xs text-right">耗时</TableHead>
                        <TableHead className="h-8 text-xs">IP</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recent_logs.map(log => (
                        <TableRow key={log.id} className="hover:bg-muted/50">
                          <TableCell className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">{formatTs(log.created_at)}</TableCell>
                          <TableCell className="py-1.5">
                            {log.type === 5
                              ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">失败</span>
                              : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">成功</span>}
                          </TableCell>
                          <TableCell className="py-1.5 font-mono text-xs max-w-[130px] truncate" title={log.model_name}>{log.model_name || '-'}</TableCell>
                          <TableCell className="py-1.5 text-xs font-mono text-right">{formatQuota(log.quota)}</TableCell>
                          <TableCell className="py-1.5 text-xs font-mono text-right text-muted-foreground">{Number(log.prompt_tokens)}/{Number(log.completion_tokens)}</TableCell>
                          <TableCell className="py-1.5 text-xs font-mono text-right text-muted-foreground">{Number(log.use_time)}s</TableCell>
                          <TableCell className="py-1.5 font-mono text-xs text-muted-foreground">{log.ip || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* 操作 */}
            <div className="flex justify-end gap-2 pt-1 border-t">
              {t!.status === 1 ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={toggleStatus}
                  disabled={opLoading}
                  className={cn(confirming && 'animate-pulse')}
                >
                  {opLoading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ShieldBan className="w-3.5 h-3.5 mr-1.5" />}
                  {confirming ? '再次点击确认禁用' : '禁用此令牌'}
                </Button>
              ) : t!.status === 2 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleStatus}
                  disabled={opLoading}
                  className="text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700 dark:border-green-900 dark:hover:bg-green-950"
                >
                  {opLoading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />}
                  启用此令牌
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

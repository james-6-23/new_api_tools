import { useState, useEffect, useCallback, useMemo } from 'react'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import { Server, Loader2, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Wallet, Activity } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Select } from './ui/select'
import { StatCard } from './StatCard'
import { cn } from '../lib/utils'

interface ChannelRecord {
  id: number
  name: string
  type: number
  status: number
  priority: number
  weight: number
  balance: number
  balance_updated_time: number
  response_time: number
  test_time: number
  used_quota: number
  group: string
  tag: string
  model_count: number
  created_time: number
}

interface ChannelLogStat {
  channel_id: number
  total: number
  errors: number
  avg_use_time: number | null
}

interface ModelHealth {
  model_name: string
  total: number
  errors: number
  empty_count: number
  avg_use_time: number | null
  max_use_time: number | null
  bucket_fast: number
  bucket_mid: number
  bucket_slow: number
  bucket_very_slow: number
}

interface ErrorAnalysis {
  categories: Record<string, number>
  samples: {
    created_at: number
    model_name: string
    channel_id: number
    username: string
    content: string
    category: string
  }[]
  sampled: number
}

interface SinglePointModel {
  model: string
  channel_id: number
  channel_name: string
  group: string
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  rate_limit: { label: '限流 429', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' },
  auth: { label: '认证失败', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
  timeout: { label: '超时', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400' },
  upstream: { label: '上游 5xx', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400' },
  quota: { label: '额度不足', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' },
  other: { label: '其他', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400' },
}

export function ChannelMonitor() {
  const { showToast } = useToast()
  const { token } = useAuth()

  const [channels, setChannels] = useState<ChannelRecord[]>([])
  const [logStats, setLogStats] = useState<Map<number, ChannelLogStat>>(new Map())
  const [modelHealth, setModelHealth] = useState<ModelHealth[]>([])
  const [errorAnalysis, setErrorAnalysis] = useState<ErrorAnalysis | null>(null)
  const [singlePoint, setSinglePoint] = useState<SinglePointModel[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [hours, setHours] = useState(24)

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  const fetchAll = useCallback(async () => {
    try {
      const [chRes, lsRes, mhRes, eaRes, amRes] = await Promise.all([
        fetch(`${apiUrl}/api/channels/overview`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/channels/log-stats?hours=${hours}`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/channels/model-health?hours=${hours}`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/channels/error-analysis?hours=${hours}`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/channels/ability-matrix`, { headers: getAuthHeaders() }),
      ])
      const [ch, ls, mh, ea, am] = await Promise.all([chRes.json(), lsRes.json(), mhRes.json(), eaRes.json(), amRes.json()])
      if (ch.success) setChannels(ch.data || [])
      if (ls.success) {
        const m = new Map<number, ChannelLogStat>()
        for (const s of ls.data || []) m.set(s.channel_id, s)
        setLogStats(m)
      }
      if (mh.success) setModelHealth(mh.data || [])
      if (ea.success) setErrorAnalysis(ea.data)
      if (am.success) setSinglePoint(am.data?.single_point_models || [])
    } catch (error) {
      showToast('error', '获取渠道数据失败')
      console.error('Failed to fetch channel data:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [apiUrl, getAuthHeaders, hours, showToast])

  useEffect(() => { setLoading(true); fetchAll() }, [fetchAll])

  const handleRefresh = () => { setRefreshing(true); fetchAll() }

  const formatQuota = (q: number) => `$${(q / 500000).toFixed(2)}`
  const formatTs = (ts: number) => {
    if (!ts || ts <= 0) return '-'
    return new Date(ts * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const statusBadge = (s: number) => {
    if (s === 1) return <Badge variant="success">启用</Badge>
    if (s === 2) return <Badge variant="secondary">手动禁用</Badge>
    if (s === 3) return <Badge variant="destructive">自动禁用</Badge>
    return <Badge variant="secondary">未知({s})</Badge>
  }

  const totals = useMemo(() => {
    const active = channels.filter(c => c.status === 1).length
    const balance = channels.reduce((s, c) => s + (Number(c.balance) || 0), 0)
    let reqs = 0, errs = 0
    logStats.forEach(s => { reqs += Number(s.total) || 0; errs += Number(s.errors) || 0 })
    return { active, balance, reqs, errs, errRate: reqs > 0 ? (errs / reqs) * 100 : 0 }
  }, [channels, logStats])

  const errRateOf = (id: number) => {
    const s = logStats.get(id)
    if (!s || !s.total) return null
    return (Number(s.errors) / Number(s.total)) * 100
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-32">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">渠道监控</h2>
          <p className="text-muted-foreground mt-1">渠道余额、性能与错误率一览（只读，不含渠道密钥）</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={String(hours)} onChange={(e) => setHours(Number(e.target.value))} className="h-9 w-28">
            <option value="24">近 24 小时</option>
            <option value="72">近 3 天</option>
            <option value="168">近 7 天</option>
          </Select>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="h-9">
            <RefreshCw className={cn('h-4 w-4 mr-2', refreshing && 'animate-spin')} />
            刷新
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="渠道总数" value={`${channels.length}`} icon={Server} color="blue" className="border-l-4 border-l-blue-500" />
        <StatCard title="启用渠道" value={`${totals.active}`} icon={CheckCircle2} color="green" className="border-l-4 border-l-green-500" />
        <StatCard title="余额合计" value={`$${totals.balance.toFixed(2)}`} icon={Wallet} color="yellow" className="border-l-4 border-l-yellow-500" />
        <StatCard title={`窗口错误率`} value={`${totals.errRate.toFixed(2)}%`} icon={Activity} color={totals.errRate > 5 ? 'red' : 'green'} className={cn('border-l-4', totals.errRate > 5 ? 'border-l-red-500' : 'border-l-green-500')} />
      </div>

      {/* 单点模型预警 */}
      {singlePoint.length > 0 && (
        <Card className="border-yellow-300/60 dark:border-yellow-800/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
              <AlertTriangle className="w-4 h-4" />
              单点风险模型（仅一个启用渠道支撑）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {singlePoint.map((m) => (
                <span key={`${m.group}-${m.model}`} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800" title={`分组 ${m.group} · 渠道 ${m.channel_name || m.channel_id}`}>
                  <code className="font-mono">{m.model}</code>
                  <span className="text-muted-foreground">→ {m.channel_name || `#${m.channel_id}`}</span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 渠道表 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">渠道列表</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {channels.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <Server className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p>暂无渠道：请先在 NewAPI 管理台添加渠道</p>
            </div>
          ) : (
            <div className="overflow-x-auto border-t">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-[50px]">ID</TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>分组</TableHead>
                    <TableHead>优先级/权重</TableHead>
                    <TableHead>余额</TableHead>
                    <TableHead>测速</TableHead>
                    <TableHead>已用额度</TableHead>
                    <TableHead>模型数</TableHead>
                    <TableHead>窗口请求</TableHead>
                    <TableHead>错误率</TableHead>
                    <TableHead>平均耗时</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {channels.map((c) => {
                    const stat = logStats.get(c.id)
                    const er = errRateOf(c.id)
                    return (
                      <TableRow key={c.id} className="hover:bg-muted/50">
                        <TableCell className="font-mono text-xs text-muted-foreground">{c.id}</TableCell>
                        <TableCell className="font-medium text-sm max-w-[160px] truncate" title={c.name}>
                          {c.name}
                          {c.tag && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{c.tag}</span>}
                        </TableCell>
                        <TableCell>{statusBadge(c.status)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[100px] truncate" title={c.group}>{c.group || 'default'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">{c.priority} / {c.weight}</TableCell>
                        <TableCell>
                          <div className="flex flex-col text-xs">
                            <span className={cn('font-medium', Number(c.balance) <= 0 ? 'text-muted-foreground' : Number(c.balance) < 5 ? 'text-red-600' : 'text-green-600')}>
                              ${Number(c.balance).toFixed(2)}
                            </span>
                            <span className="text-muted-foreground">{formatTs(c.balance_updated_time)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {c.response_time > 0 ? `${(c.response_time / 1000).toFixed(1)}s` : '-'}
                          <span className="block">{formatTs(c.test_time)}</span>
                        </TableCell>
                        <TableCell className="text-xs">{formatQuota(c.used_quota)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.model_count}</TableCell>
                        <TableCell className="text-xs font-mono">{stat ? Number(stat.total).toLocaleString() : '-'}</TableCell>
                        <TableCell>
                          {er === null ? <span className="text-xs text-muted-foreground">-</span> : (
                            <span className={cn('text-xs font-medium', er > 5 ? 'text-red-600' : er > 1 ? 'text-yellow-600' : 'text-green-600')}>
                              {er.toFixed(1)}%
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {stat?.avg_use_time != null ? `${Number(stat.avg_use_time).toFixed(1)}s` : '-'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 模型健康 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">模型健康（窗口期内）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {modelHealth.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">窗口期内暂无调用日志</div>
          ) : (
            <div className="overflow-x-auto border-t">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>模型</TableHead>
                    <TableHead>请求数</TableHead>
                    <TableHead>错误率</TableHead>
                    <TableHead>空回复率</TableHead>
                    <TableHead>平均/最大耗时</TableHead>
                    <TableHead className="min-w-[180px]">耗时分布 (&lt;3s / 3-10s / 10-30s / &gt;30s)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modelHealth.map((m) => {
                    const total = Number(m.total) || 0
                    const er = total > 0 ? (Number(m.errors) / total) * 100 : 0
                    const success = total - Number(m.errors)
                    const emptyRate = success > 0 ? (Number(m.empty_count) / success) * 100 : 0
                    const buckets = [Number(m.bucket_fast), Number(m.bucket_mid), Number(m.bucket_slow), Number(m.bucket_very_slow)]
                    const bucketSum = buckets.reduce((a, b) => a + b, 0) || 1
                    const colors = ['bg-green-500', 'bg-yellow-500', 'bg-orange-500', 'bg-red-500']
                    return (
                      <TableRow key={m.model_name} className="hover:bg-muted/50">
                        <TableCell className="font-mono text-xs max-w-[200px] truncate" title={m.model_name}>{m.model_name}</TableCell>
                        <TableCell className="text-xs font-mono">{total.toLocaleString()}</TableCell>
                        <TableCell>
                          <span className={cn('text-xs font-medium', er > 5 ? 'text-red-600' : er > 1 ? 'text-yellow-600' : 'text-green-600')}>{er.toFixed(1)}%</span>
                        </TableCell>
                        <TableCell>
                          <span className={cn('text-xs', emptyRate > 10 ? 'text-red-600 font-medium' : 'text-muted-foreground')}>{emptyRate.toFixed(1)}%</span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {m.avg_use_time != null ? `${Number(m.avg_use_time).toFixed(1)}s` : '-'} / {m.max_use_time != null ? `${Number(m.max_use_time)}s` : '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex h-3 w-full max-w-[220px] rounded-full overflow-hidden bg-muted" title={`<3s: ${buckets[0]} · 3-10s: ${buckets[1]} · 10-30s: ${buckets[2]} · >30s: ${buckets[3]}`}>
                            {buckets.map((b, i) => (
                              b > 0 ? <div key={i} className={colors[i]} style={{ width: `${(b / bucketSum) * 100}%` }} /> : null
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 错误分析 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-500" />
            错误分析（最近 {errorAnalysis?.sampled || 0} 条错误样本）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!errorAnalysis || errorAnalysis.sampled === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">窗口期内没有错误日志 🎉</div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {Object.entries(errorAnalysis.categories).sort((a, b) => b[1] - a[1]).map(([cat, count]) => {
                  const meta = CATEGORY_LABELS[cat] || CATEGORY_LABELS.other
                  return (
                    <span key={cat} className={cn('inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium', meta.color)}>
                      {meta.label} × {count}
                    </span>
                  )
                })}
              </div>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="w-[110px]">时间</TableHead>
                      <TableHead>类别</TableHead>
                      <TableHead>模型</TableHead>
                      <TableHead>渠道</TableHead>
                      <TableHead>用户</TableHead>
                      <TableHead>内容</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {errorAnalysis.samples.slice(0, 50).map((s, i) => {
                      const meta = CATEGORY_LABELS[s.category] || CATEGORY_LABELS.other
                      return (
                        <TableRow key={i} className="hover:bg-muted/50">
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatTs(s.created_at)}</TableCell>
                          <TableCell><span className={cn('text-[11px] px-1.5 py-0.5 rounded-full', meta.color)}>{meta.label}</span></TableCell>
                          <TableCell className="font-mono text-xs max-w-[140px] truncate" title={s.model_name}>{s.model_name || '-'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">#{s.channel_id}</TableCell>
                          <TableCell className="text-xs">{s.username || '-'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[320px] truncate" title={s.content}>{s.content}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

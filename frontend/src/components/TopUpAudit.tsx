import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ElementType } from 'react'
import { Activity, AlertTriangle, Clock, CreditCard, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Select } from './ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

interface ProviderHealth {
  provider: string
  method: string
  total_count: number
  success_count: number
  pending_count: number
  failed_count: number
  expired_count: number
  unknown_count: number
  success_rate: number
  failure_rate: number
  expired_rate: number
  revenue: number
  avg_completion_secs: number
  p95_completion_secs: number
}

interface AuditSummary {
  total_anomalies: number
  overdue_pending: number
  pending_30m: number
  pending_2h: number
  pending_24h: number
  success_missing_complete: number
  complete_before_create: number
  invalid_money: number
  invalid_amount: number
  empty_trade_no: number
  unknown_status: number
}

interface AnomalyRecord {
  id: number
  user_id: number
  username: string | null
  amount: number
  money: number
  trade_no: string
  payment_method: string
  payment_provider: string
  create_time: number
  complete_time: number
  status: string
  status_bucket: string
  completion_seconds: number
  anomaly_reasons?: string[]
  age_hours: number
}

interface AnomaliesResponse {
  days: number
  pending_hours: number
  summary: AuditSummary
  items: AnomalyRecord[]
}

interface Props { active: boolean }

const fmtMoney = (n: number) => `¥${(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtNum = (n: number) => (n || 0).toLocaleString()
const fmtPct = (n: number) => `${(n || 0).toFixed(2)}%`
const fmtTime = (ts: number) => ts ? new Date(ts * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'

function formatDuration(secs: number) {
  if (!secs) return '-'
  if (secs < 60) return `${secs.toFixed(0)} 秒`
  if (secs < 3600) return `${(secs / 60).toFixed(1)} 分钟`
  return `${(secs / 3600).toFixed(2)} 小时`
}

function statusLabel(status: string) {
  if (status === 'success') return '成功'
  if (status === 'pending') return '待处理'
  if (status === 'failed') return '失败'
  if (status === 'expired') return '已过期'
  if (status === 'unknown') return '未知'
  return status || '-'
}

function statusVariant(status: string): 'success' | 'warning' | 'destructive' | 'outline' {
  if (status === 'success') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'failed') return 'destructive'
  return 'outline'
}

export function TopUpAudit({ active }: Props) {
  const { token } = useAuth()
  const { showToast } = useToast()
  const apiUrl = import.meta.env.VITE_API_URL || ''
  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  const [days, setDays] = useState(30)
  const [pendingHours, setPendingHours] = useState(2)
  const [providerHealth, setProviderHealth] = useState<ProviderHealth[]>([])
  const [anomalies, setAnomalies] = useState<AnomaliesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const initialLoadedRef = useRef(false)

  const safeFetch = useCallback(async <T,>(path: string): Promise<T | null> => {
    try {
      const res = await fetch(`${apiUrl}${path}`, { headers })
      const data = await res.json()
      if (!data.success) {
        console.warn(`fetch ${path} failed:`, data.error?.message)
        return null
      }
      return data.data as T
    } catch (error) {
      console.error(`fetch ${path} error:`, error)
      return null
    }
  }, [apiUrl, headers])

  const fetchProviderHealth = useCallback(async () => {
    const data = await safeFetch<ProviderHealth[]>(`/api/top-ups/analytics/provider-health?days=${days}`)
    if (data) setProviderHealth(data)
  }, [safeFetch, days])

  const fetchAnomalies = useCallback(async () => {
    const data = await safeFetch<AnomaliesResponse>(`/api/top-ups/analytics/anomalies?days=${days}&pending_hours=${pendingHours}&limit=50`)
    if (data) setAnomalies(data)
  }, [safeFetch, days, pendingHours])

  const fetchAll = useCallback(async (showDoneToast = false) => {
    setRefreshing(true)
    await Promise.all([fetchProviderHealth(), fetchAnomalies()])
    setRefreshing(false)
    if (showDoneToast) showToast('success', '审计数据已刷新')
  }, [fetchProviderHealth, fetchAnomalies, showToast])

  useEffect(() => {
    if (!active || initialLoadedRef.current) return
    initialLoadedRef.current = true
    setLoading(true)
    fetchAll().finally(() => setLoading(false))
  }, [active, fetchAll])

  useEffect(() => {
    if (initialLoadedRef.current) fetchAll()
  }, [fetchAll])

  if (loading && !initialLoadedRef.current) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    )
  }

  const summary = anomalies?.summary

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-32">
            <Select value={days.toString()} onChange={e => setDays(parseInt(e.target.value))}>
              <option value="7">近 7 天</option>
              <option value="30">近 30 天</option>
              <option value="90">近 90 天</option>
              <option value="365">近 1 年</option>
            </Select>
          </div>
          <div className="w-36">
            <Select value={pendingHours.toString()} onChange={e => setPendingHours(parseInt(e.target.value))}>
              <option value="1">超时 1 小时</option>
              <option value="2">超时 2 小时</option>
              <option value="6">超时 6 小时</option>
              <option value="24">超时 24 小时</option>
            </Select>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchAll(true)} disabled={refreshing} className="h-9">
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          刷新审计
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <AuditMetric title="异常订单" value={summary?.total_anomalies || 0} detail={`${fmtNum(summary?.unknown_status || 0)} 个未知状态`} icon={AlertTriangle} tone="red" />
        <AuditMetric title="超时待支付" value={summary?.overdue_pending || 0} detail={`${fmtNum(summary?.pending_24h || 0)} 笔超过 24 小时`} icon={Clock} tone="amber" />
        <AuditMetric title="时间异常" value={summary?.complete_before_create || 0} detail="完成时间早于创建时间" icon={Activity} tone="blue" />
        <AuditMetric title="金额异常" value={(summary?.invalid_money || 0) + (summary?.invalid_amount || 0)} detail={`${fmtNum(summary?.empty_trade_no || 0)} 笔空交易号`} icon={CreditCard} tone="slate" />
      </div>

      <ProviderHealthTable data={providerHealth} />
      <AnomalyTable data={anomalies?.items || []} />
    </div>
  )
}

function AuditMetric({
  title, value, detail, icon: Icon, tone,
}: {
  title: string
  value: number
  detail: string
  icon: ElementType
  tone: 'red' | 'amber' | 'blue' | 'slate'
}) {
  const toneClass = {
    red: 'text-red-600 bg-red-50 dark:bg-red-950/20',
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-950/20',
    blue: 'text-blue-600 bg-blue-50 dark:bg-blue-950/20',
    slate: 'text-slate-600 bg-slate-50 dark:bg-slate-900/40',
  }[tone]

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">{title}</div>
            <div className="mt-2 text-2xl font-bold tabular-nums">{fmtNum(value)}</div>
          </div>
          <div className={`rounded-full p-2 ${toneClass}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  )
}

function ProviderHealthTable({ data }: { data: ProviderHealth[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          支付渠道健康度
        </CardTitle>
        <CardDescription>按支付渠道和方式统计成功率、失败率、过期率与完成耗时</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>渠道</TableHead>
              <TableHead>方式</TableHead>
              <TableHead className="text-right">订单</TableHead>
              <TableHead className="text-right">成功率</TableHead>
              <TableHead className="text-right hidden md:table-cell">失败 / 过期</TableHead>
              <TableHead className="text-right hidden lg:table-cell">平均 / P95</TableHead>
              <TableHead className="text-right">收入</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">暂无数据</TableCell>
              </TableRow>
            ) : data.map(row => (
              <TableRow key={`${row.provider}-${row.method}`}>
                <TableCell className="font-medium">{row.provider}</TableCell>
                <TableCell><Badge variant="outline" className="font-normal">{row.method}</Badge></TableCell>
                <TableCell className="text-right tabular-nums">{fmtNum(row.total_count)}</TableCell>
                <TableCell className="text-right">
                  <Badge variant={row.success_rate >= 90 ? 'success' : row.success_rate >= 70 ? 'warning' : 'destructive'} className="justify-center min-w-[4rem]">
                    {fmtPct(row.success_rate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right hidden md:table-cell text-sm text-muted-foreground">
                  {fmtPct(row.failure_rate)} / {fmtPct(row.expired_rate)}
                </TableCell>
                <TableCell className="text-right hidden lg:table-cell text-sm text-muted-foreground">
                  {formatDuration(row.avg_completion_secs)} / {formatDuration(row.p95_completion_secs)}
                </TableCell>
                <TableCell className="text-right font-mono">{fmtMoney(row.revenue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function AnomalyTable({ data }: { data: AnomalyRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          异常订单中心
        </CardTitle>
        <CardDescription>展示最近范围内需要人工核对的充值订单</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>渠道</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>异常</TableHead>
              <TableHead className="text-right hidden md:table-cell">金额</TableHead>
              <TableHead className="text-right hidden lg:table-cell">已创建</TableHead>
              <TableHead className="text-right">创建时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">暂无异常订单</TableCell>
              </TableRow>
            ) : data.map(row => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">{row.id}</TableCell>
                <TableCell>
                  <div className="font-medium">{row.username || '未知用户'}</div>
                  <div className="text-xs text-muted-foreground">ID {row.user_id}</div>
                </TableCell>
                <TableCell>
                  <div className="text-sm">{row.payment_provider || '未知'}</div>
                  <div className="text-xs text-muted-foreground">{row.payment_method || '未知'}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(row.status_bucket)}>{statusLabel(row.status_bucket)}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 max-w-[260px]">
                    {(row.anomaly_reasons || []).map(reason => (
                      <Badge key={reason} variant="outline" className="font-normal">{reason}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right hidden md:table-cell font-mono">{fmtMoney(row.money)}</TableCell>
                <TableCell className="text-right hidden lg:table-cell text-sm text-muted-foreground">{row.age_hours.toFixed(1)} 小时</TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">{fmtTime(row.create_time)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

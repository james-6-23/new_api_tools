import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import {
  TrendingUp, TrendingDown, ArrowRight, Loader2, RefreshCw,
  CalendarDays, CalendarRange, Calendar as CalendarIcon,
  Trophy, CreditCard, Activity, Zap, Filter, Users, BarChart3, LineChart,
  HelpCircle
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Select } from './ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { cn } from '../lib/utils'

interface Props { active: boolean }

interface RealtimeStats {
  today_money: number; today_count: number
  yesterday_money: number; yesterday_count: number
  day_growth: number
  week_money: number; week_count: number
  last_week_money: number; last_week_count: number
  week_growth: number
  month_money: number; month_count: number
  last_month_money: number; last_month_count: number
  month_growth: number
}
interface TrendPoint {
  date: string; timestamp: number
  count: number; money: number; amount: number
  success_count: number; success_money: number
}
interface FinancialSummary {
  period: string; revenue: number; count: number
  avg_order: number; growth_rate: number; amount: number; success_rate: number
}
interface TopUser {
  user_id: number; username: string; count: number; money: number; amount: number
}
interface PaymentDist {
  method: string; count: number; money: number; percentage: number
}
interface HeatmapPoint {
  day_of_week: number; hour: number; count: number; money: number
}
interface FunnelStatus { status: string; count: number; money: number }
interface FunnelPayment { method: string; total_count: number; success_count: number; success_rate: number }
interface FunnelData {
  status_breakdown: FunnelStatus[]
  by_payment_method: FunnelPayment[]
  avg_completion_secs: number
  total_count: number
}
interface PayerCohorts {
  days: number
  paying_users: number
  first_time_payers: number
  repeat_payers: number
  repeat_rate: number
  total_revenue: number
  arppu: number
  avg_orders_per_payer: number
  avg_first_pay_delay_hours: number
  repeat_revenue_share: number
  top1_revenue_share: number
  top5_revenue_share: number
  top10_revenue_share: number
}

type Granularity = 'daily' | 'weekly' | 'monthly'
type TrendChartType = 'bar' | 'line'

const fmtMoney = (n: number) => `¥${(n || 0).toFixed(2)}`
const fmtExactMoney = (n: number) => `¥${(n || 0).toLocaleString('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`
const fmtNum = (n: number) => (n || 0).toLocaleString()
const fmtPct = (n: number) => `${(n || 0).toFixed(2)}%`

// 自定义渲染同/环比标签的小组件，按正负值着色 + 箭头
function GrowthBadge({ value }: { value: number }) {
  if (!isFinite(value) || value === 0) {
    return <span className="inline-flex items-center text-xs text-muted-foreground gap-1"><ArrowRight className="h-3 w-3" />持平</span>
  }
  const positive = value > 0
  return (
    <span className={cn(
      "inline-flex items-center text-xs gap-1 font-medium",
      positive ? "text-green-600" : "text-red-600"
    )}>
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(value).toFixed(2)}%
    </span>
  )
}

export function TopUpAnalytics({ active }: Props) {
  const { showToast } = useToast()
  const { token } = useAuth()
  const apiUrl = import.meta.env.VITE_API_URL || ''

  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  const [realtime, setRealtime] = useState<RealtimeStats | null>(null)
  const [trends, setTrends] = useState<TrendPoint[]>([])
  const [trendGranularity, setTrendGranularity] = useState<Granularity>('daily')
  const [trendDays, setTrendDays] = useState(30)
  const [trendChartType, setTrendChartType] = useState<TrendChartType>('bar')
  const [financial, setFinancial] = useState<FinancialSummary[]>([])
  const [financialMonths, setFinancialMonths] = useState(12)
  const [topUsers, setTopUsers] = useState<TopUser[]>([])
  const [topUsersDays, setTopUsersDays] = useState(30)
  const [topUsersLimit, setTopUsersLimit] = useState(10)
  const [payment, setPayment] = useState<PaymentDist[]>([])
  const [paymentDays, setPaymentDays] = useState(30)
  const [heatmap, setHeatmap] = useState<HeatmapPoint[]>([])
  const [heatmapDays, setHeatmapDays] = useState(30)
  const [funnel, setFunnel] = useState<FunnelData | null>(null)
  const [funnelDays, setFunnelDays] = useState(30)
  const [payerCohorts, setPayerCohorts] = useState<PayerCohorts | null>(null)
  const [payerDays, setPayerDays] = useState(30)

  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const initialLoadedRef = useRef(false)

  // 通用 fetch helper —— 失败时不让单个模块挂掉整个面板
  const safeFetch = useCallback(async <T,>(path: string): Promise<T | null> => {
    try {
      const res = await fetch(`${apiUrl}${path}`, { headers })
      const data = await res.json()
      if (!data.success) {
        console.warn(`fetch ${path} failed:`, data.error?.message)
        return null
      }
      return data.data as T
    } catch (e) {
      console.error(`fetch ${path} error:`, e)
      return null
    }
  }, [apiUrl, headers])

  const fetchRealtime = useCallback(async () => {
    const d = await safeFetch<RealtimeStats>('/api/top-ups/analytics/realtime')
    if (d) setRealtime(d)
  }, [safeFetch])

  const fetchTrends = useCallback(async () => {
    const d = await safeFetch<TrendPoint[]>(
      `/api/top-ups/analytics/trends?granularity=${trendGranularity}&days=${trendDays}`)
    if (d) setTrends(d)
  }, [safeFetch, trendGranularity, trendDays])

  const fetchFinancial = useCallback(async () => {
    const d = await safeFetch<FinancialSummary[]>(`/api/top-ups/analytics/financial-summary?months=${financialMonths}`)
    if (d) setFinancial(d)
  }, [safeFetch, financialMonths])

  const fetchTopUsers = useCallback(async () => {
    const d = await safeFetch<TopUser[]>(`/api/top-ups/analytics/top-users?limit=${topUsersLimit}&days=${topUsersDays}`)
    if (d) setTopUsers(d)
  }, [safeFetch, topUsersLimit, topUsersDays])

  const fetchPayment = useCallback(async () => {
    const d = await safeFetch<PaymentDist[]>(`/api/top-ups/analytics/payment-distribution?days=${paymentDays}`)
    if (d) setPayment(d)
  }, [safeFetch, paymentDays])

  const fetchHeatmap = useCallback(async () => {
    const d = await safeFetch<HeatmapPoint[]>(`/api/top-ups/analytics/heatmap?days=${heatmapDays}`)
    if (d) setHeatmap(d)
  }, [safeFetch, heatmapDays])

  const fetchFunnel = useCallback(async () => {
    const d = await safeFetch<FunnelData>(`/api/top-ups/analytics/funnel?days=${funnelDays}`)
    if (d) setFunnel(d)
  }, [safeFetch, funnelDays])

  const fetchPayerCohorts = useCallback(async () => {
    const d = await safeFetch<PayerCohorts>(`/api/top-ups/analytics/payer-cohorts?days=${payerDays}`)
    if (d) setPayerCohorts(d)
  }, [safeFetch, payerDays])

  // 首次激活才发起所有请求；后续受控字段（granularity/days）变化只触发对应模块
  useEffect(() => {
    if (!active || initialLoadedRef.current) return
    initialLoadedRef.current = true
    setLoading(true)
    Promise.all([
      fetchRealtime(), fetchTrends(), fetchFinancial(),
      fetchTopUsers(), fetchPayment(), fetchHeatmap(), fetchFunnel(), fetchPayerCohorts(),
    ]).finally(() => setLoading(false))
  }, [active, fetchRealtime, fetchTrends, fetchFinancial, fetchTopUsers, fetchPayment, fetchHeatmap, fetchFunnel, fetchPayerCohorts])

  // 受控参数变化时单独刷新
  useEffect(() => { if (initialLoadedRef.current) fetchTrends() }, [fetchTrends])
  useEffect(() => { if (initialLoadedRef.current) fetchFinancial() }, [fetchFinancial])
  useEffect(() => { if (initialLoadedRef.current) fetchTopUsers() }, [fetchTopUsers])
  useEffect(() => { if (initialLoadedRef.current) fetchPayment() }, [fetchPayment])
  useEffect(() => { if (initialLoadedRef.current) fetchHeatmap() }, [fetchHeatmap])
  useEffect(() => { if (initialLoadedRef.current) fetchFunnel() }, [fetchFunnel])
  useEffect(() => { if (initialLoadedRef.current) fetchPayerCohorts() }, [fetchPayerCohorts])

  const handleRefreshAll = async () => {
    setRefreshing(true)
    await Promise.all([
      fetchRealtime(), fetchTrends(), fetchFinancial(),
      fetchTopUsers(), fetchPayment(), fetchHeatmap(), fetchFunnel(), fetchPayerCohorts(),
    ])
    setRefreshing(false)
    showToast('success', '已刷新所有分析数据')
  }

  if (loading && !initialLoadedRef.current) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={handleRefreshAll} disabled={refreshing} className="h-9">
          <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
          刷新全部
        </Button>
      </div>

      {/* 模块 1：实时对比 */}
      <RealtimeBlock data={realtime} />

      {/* 模块 2：收入趋势 */}
      <TrendsBlock
        data={trends}
        granularity={trendGranularity}
        days={trendDays}
        chartType={trendChartType}
        onGranularityChange={setTrendGranularity}
        onDaysChange={setTrendDays}
        onChartTypeChange={setTrendChartType}
      />

      {/* 模块 2.5：付费用户质量 */}
      <PayerQualityBlock data={payerCohorts} days={payerDays} onDaysChange={setPayerDays} />

      {/* 模块 3 & 4：财务汇总 + Top 用户 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FinancialBlock data={financial} months={financialMonths} onMonthsChange={setFinancialMonths} />
        <TopUsersBlock
          data={topUsers}
          limit={topUsersLimit}
          days={topUsersDays}
          onLimitChange={setTopUsersLimit}
          onDaysChange={setTopUsersDays}
        />
      </div>

      {/* 模块 5 & 7：支付方式分布 + 漏斗 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PaymentBlock data={payment} days={paymentDays} onDaysChange={setPaymentDays} />
        <FunnelBlock data={funnel} days={funnelDays} onDaysChange={setFunnelDays} />
      </div>

      {/* 模块 6：热力图 */}
      <HeatmapBlock data={heatmap} days={heatmapDays} onDaysChange={setHeatmapDays} />
    </div>
  )
}

// ============ 模块 1: 实时对比 ============
function RealtimeBlock({ data }: { data: RealtimeStats | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          实时对比
        </CardTitle>
        <CardDescription>今日 / 本周 / 本月 实收金额与同比环比（仅成功充值）</CardDescription>
      </CardHeader>
      <CardContent>
        {!data ? (
          <div className="text-sm text-muted-foreground py-4">数据加载中...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ComparePanel
              label="今日"
              icon={CalendarIcon}
              value={data.today_money}
              count={data.today_count}
              prevLabel="昨日"
              prevValue={data.yesterday_money}
              prevCount={data.yesterday_count}
              growth={data.day_growth}
            />
            <ComparePanel
              label="本周"
              icon={CalendarRange}
              value={data.week_money}
              count={data.week_count}
              prevLabel="上周"
              prevValue={data.last_week_money}
              prevCount={data.last_week_count}
              growth={data.week_growth}
            />
            <ComparePanel
              label="本月"
              icon={CalendarDays}
              value={data.month_money}
              count={data.month_count}
              prevLabel="上月"
              prevValue={data.last_month_money}
              prevCount={data.last_month_count}
              growth={data.month_growth}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ComparePanel({
  label, icon: Icon, value, count, prevLabel, prevValue, prevCount, growth,
}: {
  label: string
  icon: React.ElementType
  value: number; count: number
  prevLabel: string; prevValue: number; prevCount: number
  growth: number
}) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <GrowthBadge value={growth} />
      </div>
      <div className="text-2xl font-bold">{fmtMoney(value)}</div>
      <div className="text-xs text-muted-foreground">{fmtNum(count)} 笔</div>
      <div className="text-xs text-muted-foreground border-t pt-2">
        {prevLabel}: <span className="font-medium">{fmtMoney(prevValue)}</span>
        <span className="ml-2">{fmtNum(prevCount)} 笔</span>
      </div>
    </div>
  )
}

// ============ 模块 2.5: 付费用户质量 ============
function PayerQualityBlock({
  data, days, onDaysChange,
}: {
  data: PayerCohorts | null
  days: number
  onDaysChange: (d: number) => void
}) {
  const delayText = data?.avg_first_pay_delay_hours
    ? data.avg_first_pay_delay_hours < 24
      ? `${data.avg_first_pay_delay_hours.toFixed(1)} 小时`
      : `${(data.avg_first_pay_delay_hours / 24).toFixed(1)} 天`
    : '-'

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              付费用户质量
            </CardTitle>
            <CardDescription>首充、复购、ARPPU 与收入集中度</CardDescription>
          </div>
          <div className="w-28">
            <Select value={days.toString()} onChange={e => onDaysChange(parseInt(e.target.value))}>
              <option value="7">近 7 天</option>
              <option value="30">近 30 天</option>
              <option value="90">近 90 天</option>
              <option value="365">近 1 年</option>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!data ? (
          <div className="text-sm text-muted-foreground py-6 text-center">数据加载中...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <MetricPanel label="付费用户" value={fmtNum(data.paying_users)} detail={`首充 ${fmtNum(data.first_time_payers)} 人`} />
            <MetricPanel label="ARPPU" value={fmtMoney(data.arppu)} detail={`人均 ${data.avg_orders_per_payer.toFixed(2)} 笔`} />
            <MetricPanel label="复购率" value={fmtPct(data.repeat_rate)} detail={`复购收入占比 ${fmtPct(data.repeat_revenue_share)}`} />
            <MetricPanel label="首充耗时" value={delayText} detail={`Top 5 收入占比 ${fmtPct(data.top5_revenue_share)}`} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MetricPanel({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  )
}

// ============ 模块 2: 收入趋势 ============
function TrendsBlock({
  data, granularity, days, chartType,
  onGranularityChange, onDaysChange, onChartTypeChange,
}: {
  data: TrendPoint[]
  granularity: Granularity
  days: number
  chartType: TrendChartType
  onGranularityChange: (g: Granularity) => void
  onDaysChange: (d: number) => void
  onChartTypeChange: (t: TrendChartType) => void
}) {
  const { points, max } = useMemo(() => {
    const pts = data || []
    const m = Math.max(1, ...pts.map(p => p.success_money || 0))
    return { points: pts, max: m }
  }, [data])
  const total = points.reduce((sum, p) => sum + (p.success_money || 0), 0)
  const linePoints = useMemo(() => {
    return points.map((p, i) => {
      const x = points.length <= 1 ? 50 : (i / (points.length - 1)) * 100
      const y = 100 - ((p.success_money || 0) / max) * 100
      return { x, y: Math.min(100, Math.max(0, y)), point: p, index: i }
    })
  }, [points, max])
  const linePath = linePoints.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ')
  const areaPath = linePoints.length
    ? `${linePath} L ${linePoints[linePoints.length - 1].x} 100 L ${linePoints[0].x} 100 Z`
    : ''

  const formatLabel = (p: TrendPoint, i: number, total: number) => {
    if (granularity === 'monthly') return p.date
    if (granularity === 'weekly') return p.date
    if (total <= 14) return p.date.slice(5)
    if (i % Math.ceil(total / 10) === 0) return p.date.slice(5)
    return ''
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              收入趋势
            </CardTitle>
            <CardDescription>按粒度统计成功充值金额</CardDescription>
          </div>
          <div className="flex items-center gap-2 text-right">
            <div className="text-xl font-bold text-primary tabular-nums">{fmtExactMoney(total)}</div>
            <span className="text-xs text-muted-foreground">区间合计</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <div className="flex gap-1">
            {(['daily', 'weekly', 'monthly'] as Granularity[]).map(g => (
              <Button
                key={g}
                variant={granularity === g ? 'default' : 'outline'}
                size="sm"
                onClick={() => onGranularityChange(g)}
                className="h-8"
              >
                {g === 'daily' ? '日' : g === 'weekly' ? '周' : '月'}
              </Button>
            ))}
          </div>
          <div className="w-32">
            <Select value={days.toString()} onChange={e => onDaysChange(parseInt(e.target.value))}>
              <option value="7">近 7 天</option>
              <option value="14">近 14 天</option>
              <option value="30">近 30 天</option>
              <option value="60">近 60 天</option>
              <option value="90">近 90 天</option>
              <option value="180">近 180 天</option>
              <option value="365">近 365 天</option>
            </Select>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-input bg-background p-0.5 shadow-sm">
            <Button
              variant={chartType === 'bar' ? 'default' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              aria-label="柱状图"
              aria-pressed={chartType === 'bar'}
              title="柱状图"
              onClick={() => onChartTypeChange('bar')}
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
            <Button
              variant={chartType === 'line' ? 'default' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              aria-label="折线图"
              aria-pressed={chartType === 'line'}
              title="折线图"
              onClick={() => onChartTypeChange('line')}
            >
              <LineChart className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">暂无数据</div>
        ) : chartType === 'line' ? (
          <div className="relative h-[220px] border-b border-border/50 pb-6">
            <div className="absolute inset-x-0 top-0 bottom-6">
              <svg className="h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {areaPath && <path d={areaPath} className="fill-primary/10" />}
                {linePath && (
                  <path
                    d={linePath}
                    className="fill-none stroke-primary"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>
              {linePoints.map(({ x, y, point, index }) => (
                <div
                  key={index}
                  className="absolute group"
                  style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
                >
                  <div className="h-3 w-3 rounded-full border-2 border-background bg-primary shadow-sm" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-popover text-popover-foreground text-[10px] rounded px-2 py-1 shadow-md border whitespace-nowrap z-10">
                    <div className="font-medium">{point.date}</div>
                    <div>实收 {fmtMoney(point.success_money)}</div>
                    <div className="text-muted-foreground">{point.success_count} 笔成功 / 共 {point.count} 笔</div>
                  </div>
                </div>
              ))}
            </div>
            {linePoints.map(({ x, point, index }) => {
              const label = formatLabel(point, index, points.length)
              if (!label) return null
              return (
                <div
                  key={`label-${index}`}
                  className="absolute bottom-0 text-[9px] text-muted-foreground whitespace-nowrap"
                  style={{ left: `${x}%`, transform: 'translateX(-50%)' }}
                >
                  {label}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="relative h-[220px] flex items-end gap-1 border-b border-border/50 pb-6">
            {points.map((p, i) => {
              const h = (p.success_money / max) * 100
              const label = formatLabel(p, i, points.length)
              return (
                <div key={i} className="relative flex-1 h-full flex items-end justify-center group">
                  <div
                    className="w-full bg-gradient-to-t from-primary/70 to-primary rounded-t-sm hover:opacity-90 transition-opacity"
                    style={{ height: `${Math.max(h, 1)}%` }}
                  >
                    {/* 鼠标悬停显示完整数值 */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-popover text-popover-foreground text-[10px] rounded px-2 py-1 shadow-md border whitespace-nowrap z-10">
                      <div className="font-medium">{p.date}</div>
                      <div>实收 {fmtMoney(p.success_money)}</div>
                      <div className="text-muted-foreground">{p.success_count} 笔成功 / 共 {p.count} 笔</div>
                    </div>
                  </div>
                  {label && (
                    <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground whitespace-nowrap">
                      {label}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ============ 模块 3: 月度财务汇总 ============
function FinancialBlock({
  data, months, onMonthsChange,
}: {
  data: FinancialSummary[]
  months: number
  onMonthsChange: (m: number) => void
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              月度财务汇总
            </CardTitle>
            <CardDescription>近 N 个月成功充值收入与环比</CardDescription>
          </div>
          <div className="w-28">
            <Select value={months.toString()} onChange={e => onMonthsChange(parseInt(e.target.value))}>
              <option value="6">近 6 月</option>
              <option value="12">近 12 月</option>
              <option value="24">近 24 月</option>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>月份</TableHead>
                <TableHead className="text-right">收入</TableHead>
                <TableHead className="text-right hidden sm:table-cell">笔数</TableHead>
                <TableHead className="text-right hidden md:table-cell">客单价</TableHead>
                <TableHead className="text-right">环比</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">暂无数据</TableCell>
                </TableRow>
              ) : (
                data.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{row.period}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(row.revenue)}</TableCell>
                    <TableCell className="text-right hidden sm:table-cell">{fmtNum(row.count)}</TableCell>
                    <TableCell className="text-right hidden md:table-cell">{fmtMoney(row.avg_order)}</TableCell>
                    <TableCell className="text-right">
                      {/* 最早一个月没有更早数据可比，growth_rate 一定为 0，显示 - */}
                      {i === data.length - 1 ? <span className="text-muted-foreground text-xs">-</span> : <GrowthBadge value={row.growth_rate} />}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

// ============ 模块 4: Top 用户 ============
function TopUsersBlock({
  data, limit, days, onLimitChange, onDaysChange,
}: {
  data: TopUser[]
  limit: number
  days: number
  onLimitChange: (n: number) => void
  onDaysChange: (n: number) => void
}) {
  const max = Math.max(1, ...data.map(u => u.money || 0))
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              Top 充值用户
            </CardTitle>
            <CardDescription>按成功充值金额排序</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-24">
              <Select value={limit.toString()} onChange={e => onLimitChange(parseInt(e.target.value))}>
                <option value="5">前 5</option>
                <option value="10">前 10</option>
                <option value="20">前 20</option>
                <option value="50">前 50</option>
              </Select>
            </div>
            <div className="w-24">
              <Select value={days.toString()} onChange={e => onDaysChange(parseInt(e.target.value))}>
                <option value="7">近 7 天</option>
                <option value="30">近 30 天</option>
                <option value="90">近 90 天</option>
                <option value="365">近 1 年</option>
              </Select>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {data.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">暂无数据</div>
        ) : (
          <div className="space-y-2">
            {data.map((u, i) => {
              const pct = (u.money / max) * 100
              const rankColor = i === 0 ? 'bg-amber-500 text-white' : i === 1 ? 'bg-slate-400 text-white' : i === 2 ? 'bg-orange-700 text-white' : 'bg-muted text-muted-foreground'
              return (
                <div key={u.user_id} className="flex items-center gap-3">
                  <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0", rankColor)}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-medium truncate" title={u.username}>{u.username || `用户${u.user_id}`}</span>
                      <span className="text-sm font-mono font-semibold flex-shrink-0">{fmtMoney(u.money)}</span>
                    </div>
                    <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      ID {u.user_id} · {u.count} 笔 · 入账 {fmtNum(u.amount)} USD
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ============ 模块 5: 支付方式分布 ============
function PaymentBlock({
  data, days, onDaysChange,
}: {
  data: PaymentDist[]
  days: number
  onDaysChange: (d: number) => void
}) {
  const palette = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-teal-500']
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-primary" />
              支付方式分布
            </CardTitle>
            <CardDescription>按成功充值金额占比</CardDescription>
          </div>
          <div className="w-28">
            <Select value={days.toString()} onChange={e => onDaysChange(parseInt(e.target.value))}>
              <option value="7">近 7 天</option>
              <option value="30">近 30 天</option>
              <option value="90">近 90 天</option>
              <option value="365">近 1 年</option>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">暂无数据</div>
        ) : (
          <div className="space-y-3">
            {/* 堆叠条 */}
            <div className="flex h-3 rounded-full overflow-hidden bg-muted">
              {data.map((p, i) => (
                <div
                  key={p.method}
                  className={cn("h-full", palette[i % palette.length])}
                  style={{ width: `${p.percentage}%` }}
                  title={`${p.method}: ${fmtPct(p.percentage)}`}
                />
              ))}
            </div>
            {/* 列表 */}
            <div className="space-y-1.5">
              {data.map((p, i) => (
                <div key={p.method} className="flex items-center gap-2 text-sm">
                  <span className={cn("w-2.5 h-2.5 rounded-sm flex-shrink-0", palette[i % palette.length])} />
                  <span className="flex-1 truncate">{p.method || '未知'}</span>
                  <span className="text-muted-foreground text-xs">{fmtNum(p.count)} 笔</span>
                  <span className="font-mono w-20 text-right">{fmtMoney(p.money)}</span>
                  <Badge variant="outline" className="font-normal text-xs w-14 justify-center">{fmtPct(p.percentage)}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ============ 模块 6: 24x7 热力图 ============
function HeatmapBlock({
  data, days, onDaysChange,
}: {
  data: HeatmapPoint[]
  days: number
  onDaysChange: (d: number) => void
}) {
  // 把扁平数据 [day_of_week, hour, ...] 重整成 7x24 矩阵；后端固定按 0=Sun 编码
  const grid = useMemo(() => {
    const g: HeatmapPoint[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => ({ day_of_week: 0, hour: 0, count: 0, money: 0 }))
    )
    let max = 0
    for (const pt of data) {
      if (pt.day_of_week >= 0 && pt.day_of_week < 7 && pt.hour >= 0 && pt.hour < 24) {
        g[pt.day_of_week][pt.hour] = pt
        if (pt.count > max) max = pt.count
      }
    }
    return { g, max: Math.max(1, max) }
  }, [data])

  const dayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

  // 按 count 比例选色：深蓝渐变
  const cellColor = (count: number) => {
    if (count === 0) return 'bg-muted/40'
    const ratio = count / grid.max
    if (ratio > 0.8) return 'bg-blue-700'
    if (ratio > 0.6) return 'bg-blue-600'
    if (ratio > 0.4) return 'bg-blue-500'
    if (ratio > 0.2) return 'bg-blue-400'
    if (ratio > 0.05) return 'bg-blue-300'
    return 'bg-blue-200'
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              充值时段热力图
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                    aria-label="查看充值时段热力图说明"
                    title="查看说明"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-xl">
                  <DialogHeader>
                    <DialogTitle>充值时段热力图说明</DialogTitle>
                    <DialogDescription>
                      用来观察最近一段时间内，用户在每周各小时段的成功充值活跃度。
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 text-sm leading-6 text-muted-foreground">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                        <div className="font-medium text-foreground">横轴</div>
                        <div>一天 24 小时，顶部每隔 3 小时显示一个刻度。</div>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                        <div className="font-medium text-foreground">纵轴</div>
                        <div>周日到周六，后端按 0=周日、6=周六返回。</div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                      <div className="font-medium text-foreground">颜色含义</div>
                      <div>每个格子代表某个“星期几 + 小时”的成功充值笔数。颜色越深，表示该时段相对充值笔数越多；颜色越浅，表示充值笔数越少。</div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                      <div className="font-medium text-foreground">统计口径</div>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        <li>只统计成功充值，不包含待处理或失败订单。</li>
                        <li>统计的是充值笔数，不是充值金额；金额只在悬停提示中辅助查看。</li>
                        <li>右上角可切换近 7、30、60、90 天，颜色深浅会按当前范围内的最大笔数重新归一化。</li>
                        <li>时间按本地时区聚合，所以看到的是本地业务时间，而不是 UTC。</li>
                      </ul>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                      <div className="font-medium text-foreground">查看明细</div>
                      <div>把鼠标悬停在任意格子上，可以看到对应星期、小时、充值笔数和充值金额。</div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </CardTitle>
            <CardDescription>按星期 × 小时统计成功充值笔数（本地时区）</CardDescription>
          </div>
          <div className="w-28">
            <Select value={days.toString()} onChange={e => onDaysChange(parseInt(e.target.value))}>
              <option value="7">近 7 天</option>
              <option value="30">近 30 天</option>
              <option value="60">近 60 天</option>
              <option value="90">近 90 天</option>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            {/* 小时表头 */}
            <div className="flex pl-10 mb-1">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="flex-1 min-w-[16px] text-center text-[9px] text-muted-foreground">
                  {h % 3 === 0 ? h : ''}
                </div>
              ))}
            </div>
            {/* 7 行星期 */}
            {dayLabels.map((label, dow) => (
              <div key={dow} className="flex items-center mb-1">
                <div className="w-10 text-xs text-muted-foreground text-right pr-2 flex-shrink-0">{label}</div>
                {grid.g[dow].map((cell, h) => (
                  <div
                    key={h}
                    className={cn(
                      "flex-1 min-w-[16px] h-6 mx-px rounded-sm transition-all hover:ring-2 hover:ring-primary cursor-pointer",
                      cellColor(cell.count)
                    )}
                    title={`${label} ${h}:00 · ${cell.count} 笔 · ${fmtMoney(cell.money)}`}
                  />
                ))}
              </div>
            ))}
            {/* 图例 */}
            <div className="flex items-center gap-2 mt-3 text-[10px] text-muted-foreground">
              <span>少</span>
              <div className="w-4 h-3 rounded-sm bg-muted/40" />
              <div className="w-4 h-3 rounded-sm bg-blue-200" />
              <div className="w-4 h-3 rounded-sm bg-blue-300" />
              <div className="w-4 h-3 rounded-sm bg-blue-400" />
              <div className="w-4 h-3 rounded-sm bg-blue-500" />
              <div className="w-4 h-3 rounded-sm bg-blue-600" />
              <div className="w-4 h-3 rounded-sm bg-blue-700" />
              <span>多</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============ 模块 7: 转化漏斗 ============
function FunnelBlock({
  data, days, onDaysChange,
}: {
  data: FunnelData | null
  days: number
  onDaysChange: (d: number) => void
}) {
  const statusColor = (s: string) => (
    s === 'success' ? 'bg-green-500'
      : s === 'pending' ? 'bg-yellow-500'
        : s === 'expired' ? 'bg-slate-500'
          : s === 'unknown' ? 'bg-purple-500'
            : 'bg-red-500'
  )
  const statusLabel = (s: string) => (
    s === 'success' ? '成功'
      : s === 'pending' ? '待处理'
        : s === 'expired' ? '已过期'
          : s === 'unknown' ? '未知'
            : '失败'
  )
  const total = data?.total_count || 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              转化漏斗
            </CardTitle>
            <CardDescription>状态分布与按支付方式的成功率</CardDescription>
          </div>
          <div className="w-28">
            <Select value={days.toString()} onChange={e => onDaysChange(parseInt(e.target.value))}>
              <option value="7">近 7 天</option>
              <option value="30">近 30 天</option>
              <option value="90">近 90 天</option>
              <option value="365">近 1 年</option>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data ? (
          <div className="text-sm text-muted-foreground py-4 text-center">暂无数据</div>
        ) : (
          <>
            {/* 状态分布 */}
            <div className="space-y-2">
              {data.status_breakdown.map(s => {
                const pct = total > 0 ? (s.count / total) * 100 : 0
                return (
                  <div key={s.status}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("w-2 h-2 rounded-full", statusColor(s.status))} />
                        <span className="font-medium">{statusLabel(s.status)}</span>
                      </div>
                      <span className="text-muted-foreground">
                        {fmtNum(s.count)} 笔 · {fmtMoney(s.money)} · {pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                      <div className={cn("absolute inset-y-0 left-0 rounded-full transition-all", statusColor(s.status))} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
            {/* 平均完成时长 */}
            <div className="flex items-center justify-between text-sm border-t pt-3">
              <span className="text-muted-foreground">平均完成时长</span>
              <span className="font-medium font-mono">
                {data.avg_completion_secs > 0 ? formatDuration(data.avg_completion_secs) : '-'}
              </span>
            </div>
            {/* 支付方式成功率 */}
            <div className="border-t pt-3">
              <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <Users className="h-3 w-3" />
                支付方式成功率
              </div>
              {data.by_payment_method.length === 0 ? (
                <div className="text-xs text-muted-foreground py-2">暂无数据</div>
              ) : (
                <div className="space-y-1.5">
                  {data.by_payment_method.map(p => (
                    <div key={p.method} className="flex items-center justify-between text-xs">
                      <span className="truncate flex-1">{p.method}</span>
                      <span className="text-muted-foreground tabular-nums w-32 text-right">
                        {fmtNum(p.success_count)} / {fmtNum(p.total_count)}
                      </span>
                      <Badge variant={p.success_rate >= 90 ? 'success' : p.success_rate >= 70 ? 'warning' : 'destructive'} className="ml-2 w-14 justify-center">
                        {fmtPct(p.success_rate)}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs.toFixed(0)} 秒`
  if (secs < 3600) return `${(secs / 60).toFixed(1)} 分钟`
  return `${(secs / 3600).toFixed(2)} 小时`
}

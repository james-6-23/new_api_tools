import { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import { CalendarCheck, Loader2, RefreshCw, Users, Coins, TrendingUp, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Select } from './ui/select'
import { StatCard } from './StatCard'
import { cn } from '../lib/utils'

interface CheckinOverview {
  total: number
  users: number
  quota_awarded: number
  today_count: number
  d7_count: number
  d30_count: number
  d30_quota: number
}

interface TrendPoint {
  checkin_date: string
  count: number
  quota_awarded: number
}

interface Freeloader {
  user_id: number
  username: string
  user_status: number
  checkin_count: number
  quota_awarded: number
  used_quota: number
  quota: number
  last_login_at: number
}

export function CheckinAnalytics() {
  const { showToast } = useToast()
  const { token } = useAuth()

  const [overview, setOverview] = useState<CheckinOverview | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [freeloaders, setFreeloaders] = useState<Freeloader[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [days, setDays] = useState(30)

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  const fetchAll = useCallback(async () => {
    try {
      const [ovRes, trRes, flRes] = await Promise.all([
        fetch(`${apiUrl}/api/checkins/overview`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/checkins/trend?days=${days}`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/checkins/freeloaders?days=${days}&limit=50`, { headers: getAuthHeaders() }),
      ])
      const [ov, tr, fl] = await Promise.all([ovRes.json(), trRes.json(), flRes.json()])
      if (ov.success) setOverview(ov.data)
      if (tr.success) setTrend(tr.data || [])
      if (fl.success) setFreeloaders(fl.data || [])
    } catch (error) {
      showToast('error', '获取签到数据失败')
      console.error('Failed to fetch checkin data:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [apiUrl, getAuthHeaders, days, showToast])

  useEffect(() => { setLoading(true); fetchAll() }, [fetchAll])

  const handleRefresh = () => { setRefreshing(true); fetchAll() }

  const formatQuota = (q: number) => `$${(q / 500000).toFixed(2)}`
  const formatTs = (ts: number) => {
    if (!ts || ts <= 0) return '-'
    return new Date(ts * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const maxCount = Math.max(...trend.map(t => Number(t.count) || 0), 1)

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
          <h2 className="text-3xl font-bold tracking-tight">签到分析</h2>
          <p className="text-muted-foreground mt-1">签到活跃度、额度发放成本与薅羊毛识别</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="h-9 w-28">
            <option value="7">近 7 天</option>
            <option value="30">近 30 天</option>
            <option value="90">近 90 天</option>
          </Select>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="h-9">
            <RefreshCw className={cn('h-4 w-4 mr-2', refreshing && 'animate-spin')} />
            刷新
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="今日签到" value={`${overview?.today_count ?? 0}`} icon={CalendarCheck} color="blue" className="border-l-4 border-l-blue-500" />
        <StatCard title="近 7 天签到" value={`${overview?.d7_count ?? 0}`} icon={TrendingUp} color="green" className="border-l-4 border-l-green-500" />
        <StatCard title="签到用户总数" value={`${overview?.users ?? 0}`} icon={Users} color="yellow" className="border-l-4 border-l-yellow-500" />
        <StatCard title="累计发放额度" value={formatQuota(overview?.quota_awarded ?? 0)} icon={Coins} color="red" className="border-l-4 border-l-red-500" />
      </div>

      {/* 趋势图 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">每日签到趋势（近 {days} 天 · 30 天发放 {formatQuota(overview?.d30_quota ?? 0)}）</CardTitle>
        </CardHeader>
        <CardContent>
          {trend.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">窗口期内暂无签到记录</div>
          ) : (
            <div className="flex items-end gap-[3px] h-40 overflow-x-auto pt-2">
              {trend.map((t) => {
                const count = Number(t.count) || 0
                return (
                  <div
                    key={t.checkin_date}
                    className="group relative flex-1 min-w-[8px] bg-primary/70 hover:bg-primary rounded-t-sm transition-colors"
                    style={{ height: `${Math.max((count / maxCount) * 100, 2)}%` }}
                    title={`${t.checkin_date}：${count} 人签到，发放 ${formatQuota(Number(t.quota_awarded) || 0)}`}
                  />
                )
              })}
            </div>
          )}
          {trend.length > 0 && (
            <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5 font-mono">
              <span>{trend[0].checkin_date}</span>
              <span>{trend[trend.length - 1].checkin_date}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 薅羊毛嫌疑 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
            薅羊毛嫌疑（窗口期内高频签到且从未充值）
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {freeloaders.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">窗口期内没有符合条件的用户</div>
          ) : (
            <div className="overflow-x-auto border-t">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>用户</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>签到次数</TableHead>
                    <TableHead>获得额度</TableHead>
                    <TableHead>已用额度</TableHead>
                    <TableHead>当前余额</TableHead>
                    <TableHead>最后登录</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {freeloaders.map((f) => (
                    <TableRow key={f.user_id} className="hover:bg-muted/50">
                      <TableCell className="text-sm font-medium">
                        {f.username} <span className="text-[11px] text-muted-foreground font-mono">#{f.user_id}</span>
                      </TableCell>
                      <TableCell>
                        {f.user_status === 1 ? <Badge variant="success">正常</Badge> : <Badge variant="destructive">封禁</Badge>}
                      </TableCell>
                      <TableCell>
                        <span className={cn('text-sm font-mono', Number(f.checkin_count) >= days * 0.9 ? 'text-red-600 font-semibold' : '')}>
                          {f.checkin_count} / {days}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{formatQuota(Number(f.quota_awarded) || 0)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatQuota(Number(f.used_quota) || 0)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatQuota(Number(f.quota) || 0)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatTs(f.last_login_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { Users, Key, Server, Box, Ticket, Zap, Crown, Loader2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Progress } from './ui/progress'

interface SystemOverview {
  total_users: number
  active_users: number
  total_tokens: number
  active_tokens: number
  total_channels: number
  active_channels: number
  total_models: number
  total_redemptions: number
  unused_redemptions: number
}

interface UsageStatistics {
  period: string
  total_requests: number
  total_quota_used: number
  total_prompt_tokens: number
  total_completion_tokens: number
  average_response_time: number
}

interface ModelUsage {
  model_name: string
  request_count: number
  quota_used: number
  prompt_tokens: number
  completion_tokens: number
}

interface DailyTrend {
  date: string
  request_count: number
  quota_used: number
  unique_users: number
}

interface AnalyticsSummary {
  request_king: { user_id: number; username: string; request_count: number } | null
  quota_king: { user_id: number; username: string; quota_used: number } | null
}

type PeriodType = '24h' | '3d' | '7d' | '14d'

export function Dashboard() {
  const { token } = useAuth()
  const { showToast } = useToast()
  const [overview, setOverview] = useState<SystemOverview | null>(null)
  const [usage, setUsage] = useState<UsageStatistics | null>(null)
  const [models, setModels] = useState<ModelUsage[]>([])
  const [dailyTrends, setDailyTrends] = useState<DailyTrend[]>([])
  const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [period, setPeriod] = useState<PeriodType>('7d')

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  const fetchOverview = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/dashboard/overview`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) setOverview(data.data)
    } catch (error) { console.error('Failed to fetch overview:', error) }
  }, [apiUrl, getAuthHeaders])

  const fetchUsage = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/dashboard/usage?period=${period}`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) setUsage(data.data)
    } catch (error) { console.error('Failed to fetch usage:', error) }
  }, [apiUrl, getAuthHeaders, period])

  const fetchModels = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/dashboard/models?period=${period}&limit=10`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) setModels(data.data)
    } catch (error) { console.error('Failed to fetch models:', error) }
  }, [apiUrl, getAuthHeaders, period])

  const fetchTrends = useCallback(async () => {
    const days = period === '24h' ? 1 : period === '3d' ? 3 : period === '7d' ? 7 : 14
    try {
      const response = await fetch(`${apiUrl}/api/dashboard/trends/daily?days=${days}`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) setDailyTrends(data.data)
    } catch (error) { console.error('Failed to fetch trends:', error) }
  }, [apiUrl, getAuthHeaders, period])

  const fetchAnalyticsSummary = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/dashboard/top-users?period=${period}&limit=10`, { headers: getAuthHeaders() })
      const data = await response.json()
      
      if (data.success && data.data.length > 0) {
        const sortedByRequest = [...data.data].sort((a: any, b: any) => b.request_count - a.request_count)
        const sortedByQuota = [...data.data].sort((a: any, b: any) => b.quota_used - a.quota_used)
        
        setAnalyticsSummary({
          request_king: sortedByRequest.length > 0 ? {
            user_id: sortedByRequest[0].user_id,
            username: sortedByRequest[0].username,
            request_count: sortedByRequest[0].request_count,
          } : null,
          quota_king: sortedByQuota.length > 0 ? {
            user_id: sortedByQuota[0].user_id,
            username: sortedByQuota[0].username,
            quota_used: sortedByQuota[0].quota_used,
          } : null,
        })
      } else {
        setAnalyticsSummary(null)
      }
    } catch (error) { console.error('Failed to fetch analytics summary:', error) }
  }, [apiUrl, getAuthHeaders, period])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      await Promise.all([fetchOverview(), fetchUsage(), fetchModels(), fetchTrends(), fetchAnalyticsSummary()])
      setLoading(false)
    }
    loadData()
  }, [fetchOverview, fetchUsage, fetchModels, fetchTrends, fetchAnalyticsSummary])

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchOverview(), fetchUsage(), fetchModels(), fetchTrends(), fetchAnalyticsSummary()])
    setRefreshing(false)
    showToast('success', '数据已刷新')
  }

  const formatQuota = (quota: number) => `${(quota / 500000).toFixed(2)}`
  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }
  const getMaxValue = (data: number[]) => Math.max(...data, 1)
  const getPeriodLabel = () => period === '24h' ? '24小时' : period === '3d' ? '3天' : period === '7d' ? '7天' : '14天'

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Period Selector & Refresh */}
      <div className="flex justify-between items-center">
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          刷新
        </Button>
        <div className="inline-flex rounded-lg border bg-card p-1">
          {(['24h', '3d', '7d', '14d'] as PeriodType[]).map((p) => (
            <Button key={p} variant={period === p ? 'default' : 'ghost'} size="sm" onClick={() => setPeriod(p)}>
              {p === '24h' ? '24小时' : p === '3d' ? '3天' : p === '7d' ? '7天' : '14天'}
            </Button>
          ))}
        </div>
      </div>

      {/* System Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <OverviewCard title="用户总数" value={overview?.total_users || 0} subValue={`活跃: ${overview?.active_users || 0}`} icon={Users} color="blue" />
        <OverviewCard title="Token总数" value={overview?.total_tokens || 0} subValue={`活跃: ${overview?.active_tokens || 0}`} icon={Key} color="green" />
        <OverviewCard title="渠道总数" value={overview?.total_channels || 0} subValue={`在线: ${overview?.active_channels || 0}`} icon={Server} color="purple" />
        <OverviewCard title="模型数量" value={overview?.total_models || 0} icon={Box} color="orange" />
        <OverviewCard title="兑换码" value={overview?.total_redemptions || 0} subValue={`未使用: ${overview?.unused_redemptions || 0}`} icon={Ticket} color="pink" />
      </div>

      {/* Usage Statistics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <UsageCard title="请求总数" value={formatNumber(usage?.total_requests || 0)} color="blue" />
        <UsageCard title="消耗额度" value={formatQuota(usage?.total_quota_used || 0)} color="green" />
        <UsageCard title="输入Token" value={formatNumber(usage?.total_prompt_tokens || 0)} color="purple" />
        <UsageCard title="输出Token" value={formatNumber(usage?.total_completion_tokens || 0)} color="orange" />
        <UsageCard title="平均响应" value={`${usage?.average_response_time || 0}ms`} color="pink" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg">每日趋势</CardTitle></CardHeader>
          <CardContent>
            {dailyTrends.length > 0 ? (
              <div className="space-y-4">
                <div className="h-48 flex items-end space-x-2">
                  {dailyTrends.map((trend, index) => {
                    const maxRequests = getMaxValue(dailyTrends.map(t => t.request_count))
                    const height = (trend.request_count / maxRequests) * 100
                    return (
                      <div key={index} className="flex-1 flex flex-col items-center">
                        <div className="w-full bg-primary rounded-t transition-all hover:bg-primary/80" style={{ height: `${Math.max(height, 2)}%` }} title={`${trend.request_count} 请求`} />
                        <span className="text-xs text-muted-foreground mt-2 truncate w-full text-center">{trend.date.slice(5)}</span>
                      </div>
                    )
                  })}
                </div>
                <div className="flex justify-between text-sm text-muted-foreground"><span>请求数</span><span>日期</span></div>
              </div>
            ) : (<div className="h-48 flex items-center justify-center text-muted-foreground">暂无数据</div>)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">模型使用分布</CardTitle></CardHeader>
          <CardContent>
            {models.length > 0 ? (
              <div className="space-y-3">
                {models.slice(0, 8).map((model, index) => {
                  const maxRequests = getMaxValue(models.map(m => m.request_count))
                  const percentage = (model.request_count / maxRequests) * 100
                  const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-cyan-500', 'bg-yellow-500', 'bg-red-500']
                  return (
                    <div key={index} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-foreground truncate max-w-[200px]" title={model.model_name}>{model.model_name}</span>
                        <span className="text-muted-foreground">{formatNumber(model.request_count)}</span>
                      </div>
                      <Progress value={percentage} indicatorClassName={colors[index % colors.length]} />
                    </div>
                  )
                })}
              </div>
            ) : (<div className="h-48 flex items-center justify-center text-muted-foreground">暂无数据</div>)}
          </CardContent>
        </Card>
      </div>

      {/* Analytics Kings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <KingCard title="🏆 请求王" subtitle={`${getPeriodLabel()}内请求数最多`} icon={Zap} user={analyticsSummary?.request_king} valueLabel="总请求数" value={analyticsSummary?.request_king?.request_count.toLocaleString()} gradient="from-blue-500 to-blue-600" />
        <KingCard title="👑 额度王" subtitle={`${getPeriodLabel()}内消耗额度最多`} icon={Crown} user={analyticsSummary?.quota_king} valueLabel="总消耗额度" value={analyticsSummary?.quota_king ? `$${(analyticsSummary.quota_king.quota_used / 500000).toFixed(2)}` : undefined} gradient="from-green-500 to-green-600" />
      </div>
    </div>
  )
}

interface OverviewCardProps {
  title: string
  value: number
  subValue?: string
  icon: React.ElementType
  color: 'blue' | 'green' | 'purple' | 'orange' | 'pink'
}

function OverviewCard({ title, value, subValue, icon: Icon, color }: OverviewCardProps) {
  const colorClasses = { blue: 'bg-blue-500', green: 'bg-green-500', purple: 'bg-purple-500', orange: 'bg-orange-500', pink: 'bg-pink-500' }
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center">
          <div className={`${colorClasses[color]} p-3 rounded-lg`}><Icon className="w-6 h-6 text-white" /></div>
          <div className="ml-4">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value.toLocaleString()}</p>
            {subValue && <p className="text-xs text-muted-foreground">{subValue}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface UsageCardProps { title: string; value: string; color: 'blue' | 'green' | 'purple' | 'orange' | 'pink' }

function UsageCard({ title, value, color }: UsageCardProps) {
  const borderColors = { blue: 'border-l-blue-500', green: 'border-l-green-500', purple: 'border-l-purple-500', orange: 'border-l-orange-500', pink: 'border-l-pink-500' }
  return (
    <Card className={`border-l-4 ${borderColors[color]}`}>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="text-xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  )
}

interface KingCardProps {
  title: string
  subtitle: string
  icon: React.ElementType
  user: { user_id: number; username: string } | null | undefined
  valueLabel: string
  value: string | undefined
  gradient: string
}

function KingCard({ title, subtitle, icon: Icon, user, valueLabel, value, gradient }: KingCardProps) {
  return (
    <div className={`bg-gradient-to-br ${gradient} rounded-lg shadow-lg p-6 text-white`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white/80 text-sm font-medium">{title}</p>
          <p className="text-xs text-white/60 mt-1">{subtitle}</p>
        </div>
        <div className="bg-white/20 rounded-full p-3"><Icon className="w-8 h-8" /></div>
      </div>
      {user ? (
        <div className="mt-4">
          <div className="flex items-center">
            <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center text-xl font-bold">{user.username.charAt(0).toUpperCase()}</div>
            <div className="ml-4">
              <p className="text-xl font-bold">{user.username}</p>
              <p className="text-white/70 text-sm">ID: {user.user_id}</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/20">
            <p className="text-3xl font-bold">{value}</p>
            <p className="text-white/70 text-sm">{valueLabel}</p>
          </div>
        </div>
      ) : (<div className="mt-4 text-center py-6 text-white/70">暂无数据</div>)}
    </div>
  )
}

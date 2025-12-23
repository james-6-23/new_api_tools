import { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'

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

interface TopUser {
  user_id: number
  username: string
  request_count: number
  quota_used: number
}

type PeriodType = '24h' | '7d' | '30d'

export function Dashboard() {
  const { showToast } = useToast()
  const { token } = useAuth()

  const [overview, setOverview] = useState<SystemOverview | null>(null)
  const [usage, setUsage] = useState<UsageStatistics | null>(null)
  const [models, setModels] = useState<ModelUsage[]>([])
  const [dailyTrends, setDailyTrends] = useState<DailyTrend[]>([])
  const [topUsers, setTopUsers] = useState<TopUser[]>([])

  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<PeriodType>('7d')

  const apiUrl = import.meta.env.VITE_API_URL || ''

  const getAuthHeaders = useCallback(() => {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    }
  }, [token])

  // Fetch system overview
  const fetchOverview = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/dashboard/overview`, {
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        setOverview(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch overview:', error)
    }
  }, [apiUrl, getAuthHeaders])

  // Fetch usage statistics
  const fetchUsage = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/dashboard/usage?period=${period}`, {
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        setUsage(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch usage:', error)
    }
  }, [apiUrl, getAuthHeaders, period])

  // Fetch model usage
  const fetchModels = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/dashboard/models?period=${period}&limit=10`, {
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        setModels(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch models:', error)
    }
  }, [apiUrl, getAuthHeaders, period])

  // Fetch daily trends
  const fetchTrends = useCallback(async () => {
    const days = period === '24h' ? 1 : period === '7d' ? 7 : 30
    try {
      const response = await fetch(`${apiUrl}/api/dashboard/trends/daily?days=${days}`, {
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        setDailyTrends(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch trends:', error)
    }
  }, [apiUrl, getAuthHeaders, period])

  // Fetch top users
  const fetchTopUsers = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/dashboard/top-users?period=${period}&limit=10`, {
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        setTopUsers(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch top users:', error)
    }
  }, [apiUrl, getAuthHeaders, period])

  // Load all data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      await Promise.all([
        fetchOverview(),
        fetchUsage(),
        fetchModels(),
        fetchTrends(),
        fetchTopUsers(),
      ])
      setLoading(false)
    }
    loadData()
  }, [fetchOverview, fetchUsage, fetchModels, fetchTrends, fetchTopUsers])

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

  const getMaxValue = (data: number[]) => {
    return Math.max(...data, 1)
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
      {/* Period Selector */}
      <div className="flex justify-end">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          {(['24h', '7d', '30d'] as PeriodType[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                period === p
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {p === '24h' ? '24小时' : p === '7d' ? '7天' : '30天'}
            </button>
          ))}
        </div>
      </div>

      {/* System Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <OverviewCard
          title="用户总数"
          value={overview?.total_users || 0}
          subValue={`活跃: ${overview?.active_users || 0}`}
          icon="users"
          color="blue"
        />
        <OverviewCard
          title="Token总数"
          value={overview?.total_tokens || 0}
          subValue={`活跃: ${overview?.active_tokens || 0}`}
          icon="key"
          color="green"
        />
        <OverviewCard
          title="渠道总数"
          value={overview?.total_channels || 0}
          subValue={`在线: ${overview?.active_channels || 0}`}
          icon="server"
          color="purple"
        />
        <OverviewCard
          title="模型数量"
          value={overview?.total_models || 0}
          icon="cube"
          color="orange"
        />
        <OverviewCard
          title="兑换码"
          value={overview?.total_redemptions || 0}
          subValue={`未使用: ${overview?.unused_redemptions || 0}`}
          icon="ticket"
          color="pink"
        />
      </div>

      {/* Usage Statistics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <UsageCard
          title="请求总数"
          value={formatNumber(usage?.total_requests || 0)}
          color="blue"
        />
        <UsageCard
          title="消耗额度"
          value={formatQuota(usage?.total_quota_used || 0)}
          color="green"
        />
        <UsageCard
          title="输入Token"
          value={formatNumber(usage?.total_prompt_tokens || 0)}
          color="purple"
        />
        <UsageCard
          title="输出Token"
          value={formatNumber(usage?.total_completion_tokens || 0)}
          color="orange"
        />
        <UsageCard
          title="平均响应"
          value={`${usage?.average_response_time || 0}ms`}
          color="pink"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Trends Chart */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">每日趋势</h3>
          {dailyTrends.length > 0 ? (
            <div className="space-y-4">
              <div className="h-48 flex items-end space-x-2">
                {dailyTrends.map((trend, index) => {
                  const maxRequests = getMaxValue(dailyTrends.map(t => t.request_count))
                  const height = (trend.request_count / maxRequests) * 100
                  return (
                    <div
                      key={index}
                      className="flex-1 flex flex-col items-center"
                    >
                      <div
                        className="w-full bg-blue-500 rounded-t transition-all hover:bg-blue-600"
                        style={{ height: `${Math.max(height, 2)}%` }}
                        title={`${trend.request_count} 请求`}
                      ></div>
                      <span className="text-xs text-gray-500 mt-2 truncate w-full text-center">
                        {trend.date.slice(5)}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>请求数</span>
                <span>日期</span>
              </div>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-500">
              暂无数据
            </div>
          )}
        </div>

        {/* Model Usage Distribution */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">模型使用分布</h3>
          {models.length > 0 ? (
            <div className="space-y-3">
              {models.slice(0, 8).map((model, index) => {
                const maxRequests = getMaxValue(models.map(m => m.request_count))
                const percentage = (model.request_count / maxRequests) * 100
                const colors = [
                  'bg-blue-500',
                  'bg-green-500',
                  'bg-purple-500',
                  'bg-orange-500',
                  'bg-pink-500',
                  'bg-cyan-500',
                  'bg-yellow-500',
                  'bg-red-500',
                ]
                return (
                  <div key={index} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-700 truncate max-w-[200px]" title={model.model_name}>
                        {model.model_name}
                      </span>
                      <span className="text-gray-500">{formatNumber(model.request_count)}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${colors[index % colors.length]} rounded-full transition-all`}
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-500">
              暂无数据
            </div>
          )}
        </div>
      </div>

      {/* Top Users */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">用户消耗排行</h3>
        </div>
        {topUsers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    排名
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    用户
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    请求数
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    消耗额度
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    占比
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {topUsers.map((user, index) => {
                  const totalQuota = topUsers.reduce((sum, u) => sum + u.quota_used, 0)
                  const percentage = totalQuota > 0 ? (user.quota_used / totalQuota) * 100 : 0
                  return (
                    <tr key={user.user_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <RankBadge rank={index + 1} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
                            {user.username.charAt(0).toUpperCase()}
                          </div>
                          <div className="ml-3">
                            <div className="text-sm font-medium text-gray-900">{user.username}</div>
                            <div className="text-xs text-gray-500">ID: {user.user_id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatNumber(user.request_count)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                        {formatQuota(user.quota_used)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden mr-2">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${percentage}%` }}
                            ></div>
                          </div>
                          <span className="text-sm text-gray-500">{percentage.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-12 text-center text-gray-500">
            暂无数据
          </div>
        )}
      </div>
    </div>
  )
}

interface OverviewCardProps {
  title: string
  value: number
  subValue?: string
  icon: string
  color: 'blue' | 'green' | 'purple' | 'orange' | 'pink'
}

function OverviewCard({ title, value, subValue, icon, color }: OverviewCardProps) {
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
    orange: 'bg-orange-500',
    pink: 'bg-pink-500',
  }

  const iconSvg = {
    users: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    ),
    key: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
    ),
    server: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
    ),
    cube: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    ),
    ticket: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
    ),
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center">
        <div className={`${colorClasses[color]} p-3 rounded-lg`}>
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {iconSvg[icon as keyof typeof iconSvg]}
          </svg>
        </div>
        <div className="ml-4">
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</p>
          {subValue && (
            <p className="text-xs text-gray-400">{subValue}</p>
          )}
        </div>
      </div>
    </div>
  )
}

interface UsageCardProps {
  title: string
  value: string
  color: 'blue' | 'green' | 'purple' | 'orange' | 'pink'
}

function UsageCard({ title, value, color }: UsageCardProps) {
  const borderColors = {
    blue: 'border-l-blue-500',
    green: 'border-l-green-500',
    purple: 'border-l-purple-500',
    orange: 'border-l-orange-500',
    pink: 'border-l-pink-500',
  }

  return (
    <div className={`bg-white rounded-lg shadow p-4 border-l-4 ${borderColors[color]}`}>
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-xl font-bold text-gray-900 mt-1">{value}</p>
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

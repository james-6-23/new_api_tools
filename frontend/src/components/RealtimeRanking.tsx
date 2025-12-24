import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { RefreshCw, ShieldBan, ShieldCheck, Loader2, Activity, AlertTriangle, Clock, Globe, ChevronDown, Ban, Eye } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Progress } from './ui/progress'
import { Badge } from './ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Select } from './ui/select'
import { cn } from '../lib/utils'

type WindowKey = '1h' | '3h' | '6h' | '12h' | '24h' | '3d' | '7d'
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

const WINDOW_LABELS: Record<WindowKey, string> = { '1h': '1小时内', '3h': '3小时内', '6h': '6小时内', '12h': '12小时内', '24h': '24小时内', '3d': '3天内', '7d': '7天内' }
const SORT_LABELS: Record<SortKey, string> = { requests: '请求次数', quota: '额度消耗', failure_rate: '失败率' }

// 预设封禁原因（基于风控检测的风险类型）
const BAN_REASONS = [
  { value: '', label: '请选择封禁原因' },
  { value: '请求频率过高 (HIGH_RPM)', label: '请求频率过高 (HIGH_RPM)' },
  { value: '多 IP 访问异常 (MANY_IPS)', label: '多 IP 访问异常 (MANY_IPS)' },
  { value: '失败率过高 (HIGH_FAILURE_RATE)', label: '失败率过高 (HIGH_FAILURE_RATE)' },
  { value: '空回复率过高 (HIGH_EMPTY_RATE)', label: '空回复率过高 (HIGH_EMPTY_RATE)' },
  { value: '账号共享嫌疑', label: '账号共享嫌疑' },
  { value: '令牌泄露风险', label: '令牌泄露风险' },
  { value: '滥用 API 资源', label: '滥用 API 资源' },
  { value: '违反使用条款', label: '违反使用条款' },
]

// 预设解封原因
const UNBAN_REASONS = [
  { value: '', label: '请选择解封原因' },
  { value: '误封解除', label: '误封解除' },
  { value: '用户申诉通过', label: '用户申诉通过' },
  { value: '风险已排除', label: '风险已排除' },
  { value: '账号核实完成', label: '账号核实完成' },
  { value: '临时解封观察', label: '临时解封观察' },
]

const REASON_STYLES: Record<string, string> = {
  'HIGH_RPM': 'bg-red-50 text-red-700 border-red-100 dark:bg-red-900/20 dark:text-red-400',
  'MANY_IPS': 'bg-orange-50 text-orange-700 border-orange-100 dark:bg-orange-900/20 dark:text-orange-400',
  'HIGH_FAILURE_RATE': 'bg-yellow-50 text-yellow-700 border-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400',
  'HIGH_EMPTY_RATE': 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-400',
  '账号共享': 'bg-purple-50 text-purple-700 border-purple-100 dark:bg-purple-900/20 dark:text-purple-400',
  '令牌泄露': 'bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-400',
  '滥用': 'bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-900/20 dark:text-rose-400',
  '违反使用条款': 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-400',
  '误封': 'bg-green-50 text-green-700 border-green-100 dark:bg-green-900/20 dark:text-green-400',
  '申诉': 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/20 dark:text-blue-400',
  '风险已排除': 'bg-teal-50 text-teal-700 border-teal-100 dark:bg-teal-900/20 dark:text-teal-400',
  '核实完成': 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400',
  '临时解封': 'bg-cyan-50 text-cyan-700 border-cyan-100 dark:bg-cyan-900/20 dark:text-cyan-400',
}

const getReasonStyle = (reason: string) => {
  if (!reason) return 'text-muted-foreground'
  for (const [key, style] of Object.entries(REASON_STYLES)) {
    if (reason.includes(key)) return style
  }
  return 'bg-muted text-muted-foreground'
}

const renderReasonBadge = (reason: string | null) => {
  if (!reason) return <span className="text-muted-foreground">-</span>
  return (
    <Badge variant="outline" className={cn("font-normal py-0 h-5", getReasonStyle(reason))}>
      {reason}
    </Badge>
  )
}

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
  context: Record<string, any> & {
    disable_tokens?: boolean
    enable_tokens?: boolean
    token_id?: number
    token_name?: string
    source?: string
  }
  created_at: number
}

// 被封禁用户列表项
interface BannedUserItem {
  id: number
  username: string
  display_name: string
  email: string
  quota: number
  used_quota: number
  request_count: number
  banned_at: number | null
  ban_reason: string | null
  ban_operator: string | null
  ban_context: Record<string, any> | null
}

// IP Monitoring Types
interface IPStats {
  total_users: number
  enabled_count: number
  disabled_count: number
  enabled_percentage: number
  unique_ips_24h: number
}

interface SharedIPItem {
  ip: string
  token_count: number
  user_count: number
  request_count: number
  tokens: Array<{
    token_id: number
    token_name: string
    user_id: number
    username: string
    request_count: number
  }>
}

interface MultiIPTokenItem {
  token_id: number
  token_name: string
  user_id: number
  username: string
  ip_count: number
  request_count: number
  ips: Array<{ ip: string; request_count: number }>
}

interface MultiIPUserItem {
  user_id: number
  username: string
  ip_count: number
  request_count: number
  top_ips: Array<{ ip: string; request_count: number }>
}

export function RealtimeRanking() {
  const { token } = useAuth()
  const { showToast } = useToast()
  const apiUrl = import.meta.env.VITE_API_URL || ''

  const allWindows = useMemo<WindowKey[]>(() => ['1h', '3h', '6h', '12h', '24h', '3d', '7d'], [])
  const windows = useMemo<WindowKey[]>(() => ['1h', '3h', '6h', '12h'], [])
  const extendedWindows = useMemo<WindowKey[]>(() => ['24h', '3d', '7d'], [])
  const [selectedWindow, setSelectedWindow] = useState<WindowKey>('24h')
  const [view, setView] = useState<'leaderboards' | 'banned_list' | 'ip_monitoring' | 'audit_logs'>('leaderboards')
  const [sortBy, setSortBy] = useState<SortKey>('requests')
  const [data, setData] = useState<Record<WindowKey, LeaderboardItem[]>>({ '1h': [], '3h': [], '6h': [], '12h': [], '24h': [], '3d': [], '7d': [] })
  const [generatedAt, setGeneratedAt] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [countdown, setCountdown] = useState(10)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [selected, setSelected] = useState<{ item: LeaderboardItem; window: WindowKey } | null>(null)
  const [analysis, setAnalysis] = useState<UserAnalysis | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [mutating, setMutating] = useState(false)

  // 封禁列表状态
  const [bannedUsers, setBannedUsers] = useState<BannedUserItem[]>([])
  const [bannedLoading, setBannedLoading] = useState(false)
  const [bannedPage, setBannedPage] = useState(1)
  const [bannedTotalPages, setBannedTotalPages] = useState(1)
  const [bannedTotal, setBannedTotal] = useState(0)

  // 审计日志状态 (原封禁记录)
  const [records, setRecords] = useState<BanRecordItem[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsRefreshing, setRecordsRefreshing] = useState(false)
  const [recordsPage, setRecordsPage] = useState(1)
  const [recordsTotalPages, setRecordsTotalPages] = useState(1)

  // IP Monitoring states
  const [ipStats, setIpStats] = useState<IPStats | null>(null)
  const [sharedIps, setSharedIps] = useState<SharedIPItem[]>([])
  const [multiIpTokens, setMultiIpTokens] = useState<MultiIPTokenItem[]>([])
  const [multiIpUsers, setMultiIpUsers] = useState<MultiIPUserItem[]>([])
  const [ipWindow, setIpWindow] = useState<WindowKey>('24h')
  const [ipLoading, setIpLoading] = useState(false)
  const [ipRefreshing, setIpRefreshing] = useState(false)
  const [enableAllDialogOpen, setEnableAllDialogOpen] = useState(false)
  const [enableAllLoading, setEnableAllLoading] = useState(false)
  const [expandedSharedIps, setExpandedSharedIps] = useState<Set<string>>(new Set())
  const [expandedTokens, setExpandedTokens] = useState<Set<number>>(new Set())

  // 确认弹窗状态
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    title: string
    description: string
    onConfirm: () => void
    confirmText?: string
    variant?: 'default' | 'destructive'
  }>({ open: false, title: '', description: '', onConfirm: () => {} })

  // 封禁/解封确认弹窗状态
  const [banConfirmDialog, setBanConfirmDialog] = useState<{
    open: boolean
    type: 'ban' | 'unban'
    userId: number
    username: string
    reason: string
    disableTokens: boolean
    enableTokens: boolean
  }>({ open: false, type: 'ban', userId: 0, username: '', reason: '', disableTokens: true, enableTokens: false })

  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  const fetchLeaderboards = useCallback(async (showSuccessToast = false) => {
    try {
      const response = await fetch(`${apiUrl}/api/risk/leaderboards?windows=${allWindows.join(',')}&limit=10&sort_by=${sortBy}`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        const windowsData = res.data?.windows || {}
        setData({
          '1h': windowsData['1h'] || [],
          '3h': windowsData['3h'] || [],
          '6h': windowsData['6h'] || [],
          '12h': windowsData['12h'] || [],
          '24h': windowsData['24h'] || [],
          '3d': windowsData['3d'] || [],
          '7d': windowsData['7d'] || [],
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
  }, [apiUrl, getAuthHeaders, showToast, allWindows, sortBy])

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
        showToast('error', res.message || '获取审计日志失败')
      }
    } catch (e) {
      console.error('Failed to fetch ban records:', e)
      showToast('error', '获取审计日志失败')
    } finally {
      setRecordsLoading(false)
    }
  }, [apiUrl, getAuthHeaders, showToast])

  // 获取封禁列表
  const fetchBannedUsers = useCallback(async (page = 1, showSuccessToast = false) => {
    setBannedLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/users/banned?page=${page}&page_size=50`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        setBannedUsers(res.data?.items || [])
        setBannedPage(res.data?.page || page)
        setBannedTotalPages(res.data?.total_pages || 1)
        setBannedTotal(res.data?.total || 0)
        if (showSuccessToast) showToast('success', '已刷新')
      } else {
        showToast('error', res.message || '获取封禁列表失败')
      }
    } catch (e) {
      console.error('Failed to fetch banned users:', e)
      showToast('error', '获取封禁列表失败')
    } finally {
      setBannedLoading(false)
    }
  }, [apiUrl, getAuthHeaders, showToast])

  // IP Monitoring fetch functions
  const fetchIPStats = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/ip/stats`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        setIpStats(res.data)
      }
    } catch (e) {
      console.error('Failed to fetch IP stats:', e)
    }
  }, [apiUrl, getAuthHeaders])

  const fetchIPData = useCallback(async (showSuccessToast = false) => {
    setIpLoading(true)
    try {
      const [statsRes, sharedRes, tokensRes, usersRes] = await Promise.all([
        fetch(`${apiUrl}/api/ip/stats`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/ip/shared-ips?window=${ipWindow}&min_tokens=2&limit=50`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/ip/multi-ip-tokens?window=${ipWindow}&min_ips=2&limit=50`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/ip/multi-ip-users?window=${ipWindow}&min_ips=3&limit=50`, { headers: getAuthHeaders() }),
      ])
      
      const [stats, shared, tokens, users] = await Promise.all([
        statsRes.json(),
        sharedRes.json(),
        tokensRes.json(),
        usersRes.json(),
      ])
      
      if (stats.success) setIpStats(stats.data)
      if (shared.success) setSharedIps(shared.data?.items || [])
      if (tokens.success) setMultiIpTokens(tokens.data?.items || [])
      if (users.success) setMultiIpUsers(users.data?.items || [])
      
      if (showSuccessToast) showToast('success', '已刷新')
    } catch (e) {
      console.error('Failed to fetch IP data:', e)
      showToast('error', '获取 IP 数据失败')
    } finally {
      setIpLoading(false)
    }
  }, [apiUrl, getAuthHeaders, ipWindow, showToast])

  const handleEnableAllIPRecording = async () => {
    setEnableAllLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/ip/enable-all`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      const res = await response.json()
      if (res.success) {
        showToast('success', res.message || '已开启所有用户 IP 记录')
        setEnableAllDialogOpen(false)
        fetchIPStats()
      } else {
        showToast('error', res.message || '操作失败')
      }
    } catch (e) {
      console.error('Failed to enable all IP recording:', e)
      showToast('error', '操作失败')
    } finally {
      setEnableAllLoading(false)
    }
  }

  // 禁用单个令牌
  const handleDisableToken = async (tokenId: number, tokenName: string) => {
    setConfirmDialog({
      open: true,
      title: '禁用令牌',
      description: `确定要禁用令牌 "${tokenName}" 吗？`,
      confirmText: '禁用',
      variant: 'destructive',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }))
        try {
          const response = await fetch(`${apiUrl}/api/users/tokens/${tokenId}/disable`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ reason: 'IP 监控检测到多 IP 使用', context: { source: 'ip_monitoring' } }),
          })
          const res = await response.json()
          if (res.success) {
            showToast('success', res.message || '令牌已禁用')
            fetchIPData()
          } else {
            showToast('error', res.message || '禁用失败')
          }
        } catch (e) {
          console.error('Failed to disable token:', e)
          showToast('error', '禁用令牌失败')
        }
      }
    })
  }

  // 从 IP 监控快速封禁用户 - 打开用户分析弹窗
  const handleQuickBanUser = (userId: number, username: string) => {
    openUserAnalysisFromIP(userId, username)
  }

  // 从 IP 监控打开用户分析弹窗
  const openUserAnalysisFromIP = (userId: number, username: string) => {
    const mockItem: LeaderboardItem = {
      user_id: userId,
      username: username,
      user_status: 1,
      request_count: 0,
      failure_requests: 0,
      failure_rate: 0,
      quota_used: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      unique_ips: 0,
    }
    openUserDialog(mockItem, ipWindow)
  }

  const openUserDialog = (item: LeaderboardItem, window: WindowKey) => {
    setSelected({ item, window })
    setDialogOpen(true)
    setAnalysis(null)
  }

  useEffect(() => {
    if (view === 'leaderboards') fetchLeaderboards()
    if (view === 'banned_list') fetchBannedUsers(1)
    if (view === 'audit_logs') fetchBanRecords(1)
    if (view === 'ip_monitoring') fetchIPData()
  }, [fetchLeaderboards, fetchBanRecords, fetchBannedUsers, fetchIPData, view])

  useEffect(() => {
    if (view === 'ip_monitoring') fetchIPData()
  }, [ipWindow, fetchIPData, view])

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

  const handleRefreshIP = async () => {
    setIpRefreshing(true)
    await fetchIPData(true)
    setIpRefreshing(false)
  }

  const toggleSharedIpExpand = (ip: string) => {
    setExpandedSharedIps(prev => {
      const next = new Set(prev)
      if (next.has(ip)) next.delete(ip)
      else next.add(ip)
      return next
    })
  }

  const toggleTokenExpand = (tokenId: number) => {
    setExpandedTokens(prev => {
      const next = new Set(prev)
      if (next.has(tokenId)) next.delete(tokenId)
      else next.add(tokenId)
      return next
    })
  }

  const metricLabel = SORT_LABELS[sortBy]

  const renderMetric = (item: LeaderboardItem) => {
    if (sortBy === 'quota') return formatQuota(item.quota_used)
    if (sortBy === 'failure_rate') return `${(item.failure_rate * 100).toFixed(2)}%`
    return formatNumber(item.request_count)
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
          {view === 'leaderboards' && (
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="h-9">
              <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
              刷新
            </Button>
          )}
          {view === 'audit_logs' && (
            <Button variant="outline" size="sm" onClick={handleRefreshRecords} disabled={recordsRefreshing} className="h-9">
              <RefreshCw className={cn("h-4 w-4 mr-2", recordsRefreshing && "animate-spin")} />
              刷新
            </Button>
          )}
        </div>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as any)}>
        <TabsList>
          <TabsTrigger value="leaderboards" className="gap-2"><Activity className="w-4 h-4"/> 实时排行</TabsTrigger>
          <TabsTrigger value="ip_monitoring" className="gap-2"><Globe className="w-4 h-4"/> IP 监控</TabsTrigger>
          <TabsTrigger value="banned_list" className="gap-2"><ShieldBan className="w-4 h-4"/> 封禁列表</TabsTrigger>
          <TabsTrigger value="audit_logs" className="gap-2"><Clock className="w-4 h-4"/> 审计日志</TabsTrigger>
        </TabsList>

        <TabsContent value="leaderboards">
          {/* Responsive Grid Layout: 1 col on mobile, 2 cols on tablet/desktop */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {windows.map((w) => (
              <Card 
                key={w} 
                className="rounded-xl shadow-sm transition-all duration-200 hover:shadow-md"
              >
                <CardHeader className="pb-3 border-b bg-muted/20">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Activity className="h-4 w-4 text-primary" />
                      {WINDOW_LABELS[w]}
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={handleRefresh}
                      disabled={refreshing}
                      title="刷新"
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                    </Button>
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
                        const name = item.username || item.user_id
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

          {/* 第5个卡片：可选时间段排行榜 (24h/3d/7d) */}
          <Card className="rounded-xl shadow-sm mt-6">
            <CardHeader className="pb-3 border-b bg-muted/20">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  {WINDOW_LABELS[selectedWindow]}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Select
                    value={selectedWindow}
                    onChange={(e) => setSelectedWindow(e.target.value as WindowKey)}
                    className="w-28 h-8 text-sm"
                  >
                    {extendedWindows.map((w) => (
                      <option key={w} value={w}>{WINDOW_LABELS[w]}</option>
                    ))}
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    title="刷新"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-0">
              {loading ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />加载中...
                </div>
              ) : (data[selectedWindow]?.length ? (
                <div className="divide-y">
                  {data[selectedWindow].slice(0, 10).map((item, idx) => {
                    const name = item.username || item.user_id
                    const isBanned = item.user_status === 2
                    return (
                      <div
                        key={`selected-${item.user_id}`}
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
                            <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                            <span>失败: {(item.failure_rate * 100).toFixed(1)}%</span>
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
                            onClick={() => openUserDialog(item, selectedWindow)}
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
        </TabsContent>

        {/* 封禁列表 Tab */}
        <TabsContent value="banned_list">
          <Card className="rounded-xl shadow-sm border">
            <CardHeader className="pb-3 border-b bg-muted/20">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <ShieldBan className="h-5 w-5 text-destructive" />
                  封禁列表
                </CardTitle>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-muted-foreground">
                    共 {bannedTotal} 个用户被封禁
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => fetchBannedUsers(1, true)} 
                    disabled={bannedLoading}
                    className="h-8"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", bannedLoading && "animate-spin")} />
                    刷新
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {bannedLoading ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 mr-2 animate-spin" />加载中...
                </div>
              ) : (
                <>
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableHead className="w-[80px]">ID</TableHead>
                          <TableHead className="w-[150px]">用户</TableHead>
                          <TableHead className="w-[140px]">封禁时间</TableHead>
                          <TableHead className="w-[100px]">操作者</TableHead>
                          <TableHead>封禁原因</TableHead>
                          <TableHead className="w-[100px] text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bannedUsers.length ? bannedUsers.map((user) => (
                          <TableRow key={user.id} className="group hover:bg-muted/30">
                            <TableCell className="text-xs text-muted-foreground font-mono py-2">
                              {user.id}
                            </TableCell>
                            <TableCell className="py-2">
                              <div className="flex flex-col">
                                <span className="font-medium text-sm truncate max-w-[130px]" title={user.username}>
                                  {user.username}
                                </span>
                                {user.display_name && user.display_name !== user.username && (
                                  <span className="text-[10px] text-muted-foreground truncate max-w-[130px]">
                                    {user.display_name}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground font-mono whitespace-nowrap py-2">
                              {user.banned_at ? formatTime(user.banned_at) : '-'}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground py-2">
                              {user.ban_operator || '系统'}
                            </TableCell>
                            <TableCell className="py-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {renderReasonBadge(user.ban_reason)}
                                {user.ban_context?.source && (
                                  <Badge variant="secondary" className="text-[10px] h-4 font-normal px-1">
                                    {user.ban_context.source === 'risk_center' ? '风控' : 
                                     user.ban_context.source === 'ip_monitoring' ? 'IP监控' : user.ban_context.source}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right py-2">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs hover:bg-green-500/10 hover:text-green-600 px-2"
                                  disabled={mutating}
                                  onClick={() => {
                                    setBanConfirmDialog({
                                      open: true,
                                      type: 'unban',
                                      userId: user.id,
                                      username: user.username,
                                      reason: '',
                                      disableTokens: false,
                                      enableTokens: true,
                                    })
                                  }}
                                >
                                  <ShieldCheck className="h-3 w-3 mr-1" />
                                  解封
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs hover:bg-primary/10 hover:text-primary px-2"
                                  onClick={() => {
                                    const mockItem: LeaderboardItem = {
                                      user_id: user.id,
                                      username: user.username,
                                      user_status: 2,
                                      request_count: user.request_count,
                                      failure_requests: 0,
                                      failure_rate: 0,
                                      quota_used: user.used_quota,
                                      prompt_tokens: 0,
                                      completion_tokens: 0,
                                      unique_ips: 0
                                    }
                                    openUserDialog(mockItem, '24h')
                                  }}
                                >
                                  <Eye className="h-3 w-3 mr-1" />
                                  查看
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )) : (
                          <TableRow>
                            <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                              <div className="flex flex-col items-center justify-center gap-2">
                                <ShieldCheck className="h-8 w-8 opacity-20" />
                                <span>暂无被封禁用户</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {bannedTotalPages > 1 && (
                    <div className="flex items-center justify-between p-4 border-t bg-muted/10">
                      <div className="text-xs text-muted-foreground">
                        第 {bannedPage} / {bannedTotalPages} 页
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-8 text-xs"
                          disabled={bannedPage <= 1 || bannedLoading} 
                          onClick={() => fetchBannedUsers(bannedPage - 1)}
                        >
                          上一页
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-8 text-xs"
                          disabled={bannedPage >= bannedTotalPages || bannedLoading} 
                          onClick={() => fetchBannedUsers(bannedPage + 1)}
                        >
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

        {/* 审计日志 Tab (原封禁记录) */}
        <TabsContent value="audit_logs">
          <Card className="rounded-xl shadow-sm border">
            <CardHeader className="pb-3 border-b bg-muted/20">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Activity className="h-5 w-5 text-muted-foreground" />
                  审计日志
                </CardTitle>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-muted-foreground">
                    共 {records.length} 条记录 (本页)
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => fetchBanRecords(1, true)} 
                    disabled={recordsLoading}
                    className="h-8"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", recordsLoading && "animate-spin")} />
                    刷新
                  </Button>
                </div>
              </div>
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
                          <TableHead className="w-[140px]">时间</TableHead>
                          <TableHead className="w-[80px]">动作</TableHead>
                          <TableHead className="w-[120px]">用户</TableHead>
                          <TableHead className="w-[80px]">操作者</TableHead>
                          <TableHead>原因</TableHead>
                          <TableHead className="w-[80px] text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {records.length ? records.map((r) => {
                          const isTokenBan = r.context?.token_id !== undefined
                          const tokenName = r.context?.token_name || ''

                          return (
                            <TableRow key={r.id} className="group hover:bg-muted/30">
                              <TableCell className="text-xs text-muted-foreground font-mono whitespace-nowrap py-2">
                                {formatTime(r.created_at)}
                              </TableCell>
                              <TableCell className="py-2">
                                <div className="flex flex-col gap-1">
                                  {r.action === 'ban' ? (
                                    <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
                                      <ShieldBan className="w-3.5 h-3.5" />
                                      <span className="text-xs font-medium">封禁</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                                      <ShieldCheck className="w-3.5 h-3.5" />
                                      <span className="text-xs font-medium">解封</span>
                                    </div>
                                  )}
                                  {isTokenBan && (
                                    <Badge variant="outline" className="text-[10px] h-4 px-1 w-fit">令牌</Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="py-2">
                                <div className="flex flex-col">
                                  <span className="font-medium text-sm truncate max-w-[100px]" title={r.username}>{r.username || `User#${r.user_id}`}</span>
                                  <span className="text-[10px] text-muted-foreground">ID: {r.user_id}</span>
                                  {isTokenBan && tokenName && (
                                    <span className="text-[10px] text-orange-600 dark:text-orange-400 truncate max-w-[100px]" title={tokenName}>
                                      令牌: {tokenName}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground py-2">
                                {r.operator || '系统'}
                              </TableCell>
                              <TableCell className="py-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {renderReasonBadge(r.reason)}
                                  {r.context?.source && (
                                    <Badge variant="secondary" className="text-[10px] h-4 font-normal px-1">
                                      {r.context.source === 'risk_center' ? '风控' : 
                                       r.context.source === 'ip_monitoring' ? 'IP监控' : 
                                       r.context.source === 'ban_records' ? '记录' : r.context.source}
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right py-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs hover:bg-primary/10 hover:text-primary px-2"
                                  onClick={() => {
                                    const mockItem: LeaderboardItem = {
                                      user_id: r.user_id,
                                      username: r.username,
                                      user_status: r.action === 'ban' ? 2 : 1,
                                      request_count: 0,
                                      failure_requests: 0,
                                      failure_rate: 0,
                                      quota_used: 0,
                                      prompt_tokens: 0,
                                      completion_tokens: 0,
                                      unique_ips: 0
                                    }
                                    openUserDialog(mockItem, '24h')
                                  }}
                                >
                                  <Eye className="h-3 w-3 mr-1" />
                                  查看
                                </Button>
                              </TableCell>
                            </TableRow>
                          )
                        }) : (
                          <TableRow>
                            <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                              <div className="flex flex-col items-center justify-center gap-2">
                                <Activity className="h-8 w-8 opacity-20" />
                                <span>暂无审计日志</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {recordsTotalPages > 1 && (
                    <div className="flex items-center justify-between p-4 border-t bg-muted/10">
                      <div className="text-xs text-muted-foreground">
                        第 {recordsPage} / {recordsTotalPages} 页
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-8 text-xs"
                          disabled={recordsPage <= 1 || recordsLoading} 
                          onClick={() => fetchBanRecords(recordsPage - 1)}
                        >
                          上一页
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-8 text-xs"
                          disabled={recordsPage >= recordsTotalPages || recordsLoading} 
                          onClick={() => fetchBanRecords(recordsPage + 1)}
                        >
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

        {/* IP Monitoring Tab */}
        <TabsContent value="ip_monitoring">
          <div className="space-y-6">
            {/* Header with controls */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Select value={ipWindow} onChange={(e) => setIpWindow(e.target.value as WindowKey)} className="w-32 h-9">
                  {allWindows.map((w) => (
                    <option key={w} value={w}>{WINDOW_LABELS[w]}</option>
                  ))}
                </Select>
              </div>
              <Button variant="outline" size="sm" onClick={handleRefreshIP} disabled={ipRefreshing} className="h-9">
                <RefreshCw className={cn("h-4 w-4 mr-2", ipRefreshing && "animate-spin")} />
                刷新
              </Button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="rounded-xl border-l-4 border-l-blue-500 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">IP 记录状态</div>
                      <div className="text-2xl font-bold">{ipStats?.enabled_percentage?.toFixed(1) || 0}%</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {ipStats?.enabled_count || 0} / {ipStats?.total_users || 0} 用户已开启
                      </div>
                    </div>
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-full">
                      <Globe className="h-6 w-6 text-blue-500" />
                    </div>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full mt-3 h-8 text-xs"
                    onClick={() => setEnableAllDialogOpen(true)}
                    disabled={ipStats?.enabled_percentage === 100}
                  >
                    全部开启
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-xl border-l-4 border-l-green-500 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">24h 唯一 IP</div>
                      <div className="text-2xl font-bold">{formatNumber(ipStats?.unique_ips_24h || 0)}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        系统活跃 IP 总数
                      </div>
                    </div>
                    <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-full">
                      <Activity className="h-6 w-6 text-green-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-xl border-l-4 border-l-orange-500 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">共享 IP (多令牌)</div>
                      <div className="text-2xl font-bold text-orange-600">{sharedIps.length}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        可能的账号共享行为
                      </div>
                    </div>
                    <div className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded-full">
                      <AlertTriangle className="h-6 w-6 text-orange-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-xl border-l-4 border-l-red-500 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">多 IP 令牌</div>
                      <div className="text-2xl font-bold text-red-600">{multiIpTokens.length}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        可能的令牌泄露风险
                      </div>
                    </div>
                    <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded-full">
                      <ShieldBan className="h-6 w-6 text-red-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {ipLoading ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-8 w-8 mr-2 animate-spin text-primary/50" />
                正在分析 IP 数据...
              </div>
            ) : (
              <>
                {/* Shared IPs Table */}
                <Card className="rounded-xl border shadow-sm">
                  <CardHeader className="pb-3 border-b bg-muted/20">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-orange-500" />
                      多令牌共用 IP
                      <Badge variant="secondary" className="ml-2 bg-background">{sharedIps.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {sharedIps.length > 0 ? (
                      <div className="divide-y">
                        {sharedIps.map((item) => (
                          <div key={item.ip} className="px-4 py-3 transition-colors hover:bg-muted/30">
                            <div 
                              className="flex items-center justify-between cursor-pointer"
                              onClick={() => toggleSharedIpExpand(item.ip)}
                            >
                              <div className="flex items-center gap-3">
                                <code className="text-sm bg-muted px-2 py-1 rounded font-mono text-foreground">{item.ip}</code>
                                <div className="flex gap-2">
                                  <Badge variant="outline" className="font-normal">{item.token_count} 令牌</Badge>
                                  <Badge variant="outline" className="font-normal">{item.user_count} 用户</Badge>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground tabular-nums">{formatNumber(item.request_count)} 请求</span>
                                <div className={cn("transition-transform duration-200 p-1 rounded hover:bg-muted", expandedSharedIps.has(item.ip) && "rotate-180")}>
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                </div>
                              </div>
                            </div>
                            {expandedSharedIps.has(item.ip) && (
                              <div className="mt-3 pl-4 space-y-2 animate-in slide-in-from-top-1 duration-200">
                                {item.tokens.map((t) => (
                                  <div key={t.token_id} className="flex items-center justify-between text-sm bg-muted/30 rounded-lg px-3 py-2 border border-border/50">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">{t.token_name || `Token#${t.token_id}`}</span>
                                      <span className="text-muted-foreground text-xs">({t.username || t.user_id})</span>
                                    </div>
                                    <span className="text-muted-foreground text-xs tabular-nums">{formatNumber(t.request_count)} 请求</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-40 flex flex-col items-center justify-center text-muted-foreground text-sm">
                        <ShieldCheck className="h-8 w-8 mb-2 opacity-20" />
                        暂无异常共用 IP
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Multi-IP Tokens Table */}
                <Card className="rounded-xl border shadow-sm">
                  <CardHeader className="pb-3 border-b bg-muted/20">
                    <CardTitle className="text-base flex items-center gap-2">
                      <ShieldBan className="h-4 w-4 text-red-500" />
                      单令牌多 IP (疑似泄露)
                      <Badge variant="secondary" className="ml-2 bg-background">{multiIpTokens.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {multiIpTokens.length > 0 ? (
                      <div className="divide-y">
                        {multiIpTokens.map((item) => (
                          <div key={item.token_id} className="px-4 py-3 group transition-colors hover:bg-muted/30">
                            <div className="flex items-center justify-between">
                              <div
                                className="flex items-center gap-3 flex-1 cursor-pointer min-w-0"
                                onClick={() => toggleTokenExpand(item.token_id)}
                              >
                                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 min-w-0">
                                  <span className="font-medium text-sm truncate">{item.token_name || `Token#${item.token_id}`}</span>
                                  <span
                                    className="text-xs text-muted-foreground hover:text-primary hover:underline cursor-pointer truncate"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openUserAnalysisFromIP(item.user_id, item.username)
                                    }}
                                  >
                                    ({item.username || item.user_id})
                                  </span>
                                </div>
                                <Badge variant="destructive" className="ml-auto sm:ml-0 flex-shrink-0">{item.ip_count} IP</Badge>
                              </div>
                              <div className="flex items-center gap-2 ml-3">
                                <span className="text-sm text-muted-foreground tabular-nums hidden sm:inline">{formatNumber(item.request_count)} 请求</span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDisableToken(item.token_id, item.token_name || `Token#${item.token_id}`)
                                  }}
                                  title="禁用令牌"
                                >
                                  <Ban className="h-4 w-4" />
                                </Button>
                                <div
                                  className={cn("cursor-pointer p-1 rounded hover:bg-muted transition-transform duration-200", expandedTokens.has(item.token_id) && "rotate-180")}
                                  onClick={() => toggleTokenExpand(item.token_id)}
                                >
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                </div>
                              </div>
                            </div>
                            {expandedTokens.has(item.token_id) && (
                              <div className="mt-3 pl-4 space-y-1 animate-in slide-in-from-top-1 duration-200">
                                {item.ips.map((ip) => (
                                  <div key={ip.ip} className="flex items-center justify-between text-sm bg-muted/30 rounded-lg px-3 py-2 border border-border/50">
                                    <code className="text-xs font-mono text-foreground">{ip.ip}</code>
                                    <span className="text-muted-foreground text-xs tabular-nums">{formatNumber(ip.request_count)} 请求</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-40 flex flex-col items-center justify-center text-muted-foreground text-sm">
                        <ShieldCheck className="h-8 w-8 mb-2 opacity-20" />
                        暂无异常多 IP 令牌
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Multi-IP Users Table */}
                <Card className="rounded-xl border shadow-sm">
                  <CardHeader className="pb-3 border-b bg-muted/20">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Activity className="h-4 w-4 text-blue-500" />
                      单用户多 IP (≥3)
                      <Badge variant="secondary" className="ml-2 bg-background">{multiIpUsers.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {multiIpUsers.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50 hover:bg-muted/50">
                            <TableHead className="w-[200px]">用户</TableHead>
                            <TableHead className="w-[100px]">IP 数</TableHead>
                            <TableHead className="w-[120px]">请求数</TableHead>
                            <TableHead className="hidden md:table-cell">Top IPs</TableHead>
                            <TableHead className="w-[100px] text-center">操作</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {multiIpUsers.map((item) => (
                            <TableRow key={item.user_id} className="group hover:bg-muted/30">
                              <TableCell>
                                <div className="flex flex-col">
                                  <span
                                    className="font-medium hover:text-primary hover:underline cursor-pointer truncate max-w-[180px]"
                                    onClick={() => openUserAnalysisFromIP(item.user_id, item.username)}
                                  >
                                    {item.username || item.user_id}
                                  </span>
                                  <span className="text-xs text-muted-foreground">ID: {item.user_id}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="font-normal">{item.ip_count}</Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground text-sm tabular-nums">{formatNumber(item.request_count)}</TableCell>
                              <TableCell className="hidden md:table-cell">
                                <div className="flex flex-wrap gap-1.5">
                                  {item.top_ips.slice(0, 3).map((ip) => (
                                    <code key={ip.ip} className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono border">{ip.ip}</code>
                                  ))}
                                  {item.top_ips.length > 3 && (
                                    <span className="text-[10px] text-muted-foreground flex items-center">+{item.top_ips.length - 3}</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center justify-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-50 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                                    onClick={() => openUserAnalysisFromIP(item.user_id, item.username)}
                                    title="查看详情"
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                                    onClick={() => handleQuickBanUser(item.user_id, item.username || `User#${item.user_id}`)}
                                    title="封禁用户"
                                  >
                                    <ShieldBan className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="h-40 flex flex-col items-center justify-center text-muted-foreground text-sm">
                        <Activity className="h-8 w-8 mb-2 opacity-20" />
                        暂无多 IP 用户
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Enable All IP Recording Dialog */}
      <Dialog open={enableAllDialogOpen} onOpenChange={setEnableAllDialogOpen}>
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>确认开启所有用户 IP 记录</DialogTitle>
            <DialogDescription>
              此操作将为所有用户开启 IP 记录功能。当前有 {ipStats?.disabled_count || 0} 个用户未开启。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setEnableAllDialogOpen(false)} disabled={enableAllLoading}>
              取消
            </Button>
            <Button onClick={handleEnableAllIPRecording} disabled={enableAllLoading}>
              {enableAllLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              确认开启
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <div className="p-5 border-t bg-muted/10 flex-shrink-0">
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
                  <Button 
                    onClick={() => {
                      if (!analysis) return
                      setBanConfirmDialog({
                        open: true,
                        type: 'unban',
                        userId: analysis.user.id,
                        username: analysis.user.username,
                        reason: '',
                        disableTokens: false,
                        enableTokens: true,
                      })
                    }} 
                    disabled={mutating || analysisLoading} 
                    className="min-w-28 bg-green-600 hover:bg-green-700"
                  >
                    <ShieldCheck className="h-4 w-4 mr-2" />
                    解除封禁
                  </Button>
                ) : (
                  <Button 
                    variant="destructive" 
                    onClick={() => {
                      if (!analysis) return
                      setBanConfirmDialog({
                        open: true,
                        type: 'ban',
                        userId: analysis.user.id,
                        username: analysis.user.username,
                        reason: '',
                        disableTokens: true,
                        enableTokens: false,
                      })
                    }} 
                    disabled={mutating || analysisLoading} 
                    className="min-w-28"
                  >
                    <ShieldBan className="h-4 w-4 mr-2" />
                    立即封禁
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 确认弹窗 */}
      <Dialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>{confirmDialog.title}</DialogTitle>
            <DialogDescription>{confirmDialog.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setConfirmDialog(prev => ({ ...prev, open: false }))}>
              取消
            </Button>
            <Button 
              variant={confirmDialog.variant || 'default'} 
              onClick={confirmDialog.onConfirm}
            >
              {confirmDialog.confirmText || '确认'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 封禁/解封确认弹窗 */}
      <Dialog open={banConfirmDialog.open} onOpenChange={(open) => setBanConfirmDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {banConfirmDialog.type === 'ban' ? (
                <>
                  <ShieldBan className="h-5 w-5 text-destructive" />
                  确认封禁用户
                </>
              ) : (
                <>
                  <ShieldCheck className="h-5 w-5 text-green-600" />
                  确认解封用户
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {banConfirmDialog.type === 'ban' 
                ? `即将封禁用户 "${banConfirmDialog.username}"，请选择封禁原因。`
                : `即将解封用户 "${banConfirmDialog.username}"，请选择解封原因。`}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {banConfirmDialog.type === 'ban' ? '封禁原因' : '解封原因'}
              </label>
              <Select
                value={banConfirmDialog.reason}
                onChange={(e) => setBanConfirmDialog(prev => ({ ...prev, reason: e.target.value }))}
                className="w-full"
              >
                {(banConfirmDialog.type === 'ban' ? BAN_REASONS : UNBAN_REASONS).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </div>
            
            {banConfirmDialog.type === 'ban' ? (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={banConfirmDialog.disableTokens} 
                  onChange={(e) => setBanConfirmDialog(prev => ({ ...prev, disableTokens: e.target.checked }))} 
                  className="rounded border-gray-300" 
                />
                同时禁用该用户所有令牌
              </label>
            ) : (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={banConfirmDialog.enableTokens} 
                  onChange={(e) => setBanConfirmDialog(prev => ({ ...prev, enableTokens: e.target.checked }))} 
                  className="rounded border-gray-300" 
                />
                同时启用该用户所有令牌
              </label>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button 
              variant="outline" 
              onClick={() => setBanConfirmDialog(prev => ({ ...prev, open: false }))}
              disabled={mutating}
            >
              取消
            </Button>
            {banConfirmDialog.type === 'ban' ? (
              <Button 
                variant="destructive"
                disabled={mutating}
                onClick={async () => {
                  setMutating(true)
                  try {
                    const response = await fetch(`${apiUrl}/api/users/${banConfirmDialog.userId}/ban`, {
                      method: 'POST',
                      headers: getAuthHeaders(),
                      body: JSON.stringify({
                        reason: banConfirmDialog.reason || null,
                        disable_tokens: banConfirmDialog.disableTokens,
                        context: {
                          source: 'risk_center',
                          window: selected?.window,
                          generated_at: generatedAt,
                          risk: analysis?.risk || null,
                        },
                      }),
                    })
                    const res = await response.json()
                    if (res.success) {
                      showToast('success', res.message || '已封禁')
                      setBanConfirmDialog(prev => ({ ...prev, open: false }))
                      setDialogOpen(false)
                      fetchLeaderboards()
                      fetchBannedUsers(1)
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
                }}
              >
                {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldBan className="h-4 w-4 mr-2" />}
                确认封禁
              </Button>
            ) : (
              <Button 
                className="bg-green-600 hover:bg-green-700"
                disabled={mutating}
                onClick={async () => {
                  setMutating(true)
                  try {
                    const response = await fetch(`${apiUrl}/api/users/${banConfirmDialog.userId}/unban`, {
                      method: 'POST',
                      headers: getAuthHeaders(),
                      body: JSON.stringify({
                        reason: banConfirmDialog.reason || null,
                        enable_tokens: banConfirmDialog.enableTokens,
                        context: {
                          source: 'risk_center',
                        },
                      }),
                    })
                    const res = await response.json()
                    if (res.success) {
                      showToast('success', res.message || '已解封')
                      setBanConfirmDialog(prev => ({ ...prev, open: false }))
                      setDialogOpen(false)
                      fetchLeaderboards()
                      fetchBannedUsers(bannedPage)
                      fetchBanRecords(recordsPage)
                    } else {
                      showToast('error', res.message || '解封失败')
                    }
                  } catch (e) {
                    console.error('Failed to unban user:', e)
                    showToast('error', '解封失败')
                  } finally {
                    setMutating(false)
                  }
                }}
              >
                {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                确认解封
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { RefreshCw, ShieldBan, ShieldCheck, Loader2, Activity, AlertTriangle, Clock, Globe, ChevronDown, Ban, Eye, EyeOff, Settings, Check, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Progress } from './ui/progress'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Select } from './ui/select'
import { Input } from './ui/input'
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

interface IPSwitchDetail {
  from_ip: string
  to_ip: string
  interval: number
  time: number
}

interface IPSwitchAnalysis {
  switch_count: number
  rapid_switch_count: number
  avg_ip_duration: number
  min_switch_interval: number
  switch_details: IPSwitchDetail[]
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
  risk: { requests_per_minute: number; avg_quota_per_request: number; risk_flags: string[]; ip_switch_analysis?: IPSwitchAnalysis }
  top_models: Array<{ model_name: string; requests: number; quota_used: number; success_requests: number; failure_requests: number; empty_count: number }>
  top_channels: Array<{ channel_id: number; channel_name: string; requests: number; quota_used: number }>
  top_ips: Array<{ ip: string; requests: number }>
  recent_logs: Array<{ id: number; created_at: number; type: number; model_name: string; quota: number; prompt_tokens: number; completion_tokens: number; use_time: number; ip: string; channel_name: string; token_name: string }>
}

const WINDOW_LABELS: Record<WindowKey, string> = { '1h': '1小时内', '3h': '3小时内', '6h': '6小时内', '12h': '12小时内', '24h': '24小时内', '3d': '3天内', '7d': '7天内' }
const SORT_LABELS: Record<SortKey, string> = { requests: '请求次数', quota: '额度消耗', failure_rate: '失败率' }

// 风险标签中文映射
const RISK_FLAG_LABELS: Record<string, string> = {
  'HIGH_RPM': '请求频率过高',
  'MANY_IPS': '多IP访问',
  'HIGH_FAILURE_RATE': '失败率过高',
  'HIGH_EMPTY_RATE': '空回复率过高',
  'IP_RAPID_SWITCH': 'IP快速切换',
  'IP_HOPPING': 'IP跳动异常',
}

// 预设封禁原因
const BAN_REASONS = [
  { value: '', label: '请选择封禁原因' },
  { value: '请求频率过高 (HIGH_RPM)', label: '请求频率过高 (HIGH_RPM)' },
  { value: '多 IP 访问异常 (MANY_IPS)', label: '多 IP 访问异常 (MANY_IPS)' },
  { value: '失败率过高 (HIGH_FAILURE_RATE)', label: '失败率过高 (HIGH_FAILURE_RATE)' },
  { value: '空回复率过高 (HIGH_EMPTY_RATE)', label: '空回复率过高 (HIGH_EMPTY_RATE)' },
  { value: 'IP快速切换 (IP_RAPID_SWITCH)', label: 'IP快速切换 (IP_RAPID_SWITCH)' },
  { value: 'IP跳动异常 (IP_HOPPING)', label: 'IP跳动异常 (IP_HOPPING)' },
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
  '请求频率过高': 'bg-red-50 text-red-700 border-red-100 dark:bg-red-900/20 dark:text-red-400',
  'HIGH_RPM': 'bg-red-50 text-red-700 border-red-100 dark:bg-red-900/20 dark:text-red-400',
  '多IP访问': 'bg-orange-50 text-orange-700 border-orange-100 dark:bg-orange-900/20 dark:text-orange-400',
  'MANY_IPS': 'bg-orange-50 text-orange-700 border-orange-100 dark:bg-orange-900/20 dark:text-orange-400',
  '失败率过高': 'bg-yellow-50 text-yellow-700 border-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400',
  'HIGH_FAILURE_RATE': 'bg-yellow-50 text-yellow-700 border-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400',
  '空回复率过高': 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-400',
  'HIGH_EMPTY_RATE': 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-400',
  'IP快速切换': 'bg-pink-50 text-pink-700 border-pink-100 dark:bg-pink-900/20 dark:text-pink-400',
  'IP_RAPID_SWITCH': 'bg-pink-50 text-pink-700 border-pink-100 dark:bg-pink-900/20 dark:text-pink-400',
  'IP跳动异常': 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100 dark:bg-fuchsia-900/20 dark:text-fuchsia-400',
  'IP_HOPPING': 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100 dark:bg-fuchsia-900/20 dark:text-fuchsia-400',
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

// Hash路径映射
const VIEW_HASH_MAP: Record<string, 'leaderboards' | 'banned_list' | 'ip_monitoring' | 'audit_logs' | 'ai_ban'> = {
  '': 'leaderboards',
  'leaderboards': 'leaderboards',
  'ip': 'ip_monitoring',
  'ip_monitoring': 'ip_monitoring',
  'banned': 'banned_list',
  'banned_list': 'banned_list',
  'audit': 'audit_logs',
  'audit_logs': 'audit_logs',
  'ai': 'ai_ban',
  'ai_ban': 'ai_ban',
}

const HASH_VIEW_MAP: Record<string, string> = {
  'leaderboards': '',
  'ip_monitoring': 'ip',
  'banned_list': 'banned',
  'audit_logs': 'audit',
  'ai_ban': 'ai',
}

function getInitialView(): 'leaderboards' | 'banned_list' | 'ip_monitoring' | 'audit_logs' | 'ai_ban' {
  const hash = window.location.hash
  // 匹配 #risk, #risk/, #risk/audit, #risk-audit 等格式
  const match = hash.match(/#risk(?:[/-](\w+))?/)
  if (match && match[1]) {
    return VIEW_HASH_MAP[match[1]] || 'leaderboards'
  }
  return 'leaderboards'
}

export function RealtimeRanking() {
  const { token } = useAuth()
  const { showToast } = useToast()
  const apiUrl = import.meta.env.VITE_API_URL || ''

  const allWindows = useMemo<WindowKey[]>(() => ['1h', '3h', '6h', '12h', '24h', '3d', '7d'], [])
  const windows = useMemo<WindowKey[]>(() => ['1h', '3h', '6h', '12h'], [])
  const extendedWindows = useMemo<WindowKey[]>(() => ['24h', '3d', '7d'], [])
  const [selectedWindow, setSelectedWindow] = useState<WindowKey>('24h')

  const [view, setView] = useState<'leaderboards' | 'banned_list' | 'ip_monitoring' | 'audit_logs' | 'ai_ban'>(getInitialView)

  // Tab 配置
  const riskTabs = useMemo(() => [
    { id: 'leaderboards' as const, label: '实时排行', icon: Activity },
    { id: 'ip_monitoring' as const, label: 'IP 监控', icon: Globe },
    { id: 'banned_list' as const, label: '封禁列表', icon: ShieldBan },
    { id: 'audit_logs' as const, label: '审计日志', icon: Clock },
    { id: 'ai_ban' as const, label: 'AI 封禁', icon: AlertTriangle },
  ], [])

  // 滑动指示器状态
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([])
  const [tabIndicatorStyle, setTabIndicatorStyle] = useState({ left: 0, width: 0, opacity: 0 })

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

  // 审计日志状态
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

  // Pagination for IP monitoring
  const [ipPage, setIpPage] = useState({ shared: 1, tokens: 1, users: 1 })
  const ipPageSize = 10

  const [ipWindow, setIpWindow] = useState<WindowKey>('24h')
  const [ipLoading, setIpLoading] = useState(false)
  const [ipRefreshing, setIpRefreshing] = useState<{ all: boolean; shared: boolean; tokens: boolean; users: boolean }>({
    all: false, shared: false, tokens: false, users: false
  })

  // User IP details dialog
  const [userIpsDialogOpen, setUserIpsDialogOpen] = useState(false)
  const [selectedUserForIps, setSelectedUserForIps] = useState<{ id: number; username: string } | null>(null)
  const [userIpsData, setUserIpsData] = useState<Array<{ ip: string; request_count: number; first_seen: number; last_seen: number }>>([])
  const [userIpsLoading, setUserIpsLoading] = useState(false)

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
  }>({ open: false, title: '', description: '', onConfirm: () => { } })

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

  // AI 自动封禁状态
  const [aiConfig, setAiConfig] = useState<{
    enabled: boolean
    dry_run: boolean
    model: string
    base_url: string
    has_api_key: boolean
    api_key?: string
    masked_api_key?: string
    scan_interval_minutes?: number
  } | null>(null)
  const [aiSuspiciousUsers, setAiSuspiciousUsers] = useState<Array<{
    user_id: number
    username: string
    risk_flags: string[]
    rpm: number
    total_requests: number
    empty_rate: number
    failure_rate: number
    unique_ips: number
    rapid_switch_count: number
  }>>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiScanning, setAiScanning] = useState(false)
  const [aiAssessing, setAiAssessing] = useState<number | null>(null)
  const [aiAssessResult, setAiAssessResult] = useState<{
    user_id: number
    username: string
    assessment: {
      should_ban: boolean
      risk_score: number
      confidence: number
      reason: string
      action: string
    }
  } | null>(null)

  // AI 配置编辑状态
  const [aiConfigEdit, setAiConfigEdit] = useState({
    base_url: '',
    api_key: '',
    model: '',
    enabled: false,
    dry_run: true,
    scan_interval_minutes: 0,  // 0 表示关闭定时扫描
  })
  const [aiModels, setAiModels] = useState<Array<{ id: string; owned_by: string }>>([])
  const [aiModelLoading, setAiModelLoading] = useState(false)
  const [aiTestResult, setAiTestResult] = useState<{
    success: boolean
    message: string
    latency_ms?: number
  } | null>(null)
  const [aiTesting, setAiTesting] = useState(false)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiConfigExpanded, setAiConfigExpanded] = useState(false)
  const [isAiLogicModalOpen, setIsAiLogicModalOpen] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

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

  const fetchIPData = useCallback(async (showSuccessToast = false, resetPage = false) => {
    setIpLoading(true)
    // Only reset page when explicitly requested (e.g., window change), not on refresh
    if (resetPage) {
      setIpPage({ shared: 1, tokens: 1, users: 1 })
    }
    try {
      const [statsRes, sharedRes, tokensRes, usersRes] = await Promise.all([
        fetch(`${apiUrl}/api/ip/stats`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/ip/shared-ips?window=${ipWindow}&min_tokens=2&limit=200`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/ip/multi-ip-tokens?window=${ipWindow}&min_ips=2&limit=200`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/ip/multi-ip-users?window=${ipWindow}&min_ips=3&limit=200`, { headers: getAuthHeaders() }),
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

  const fetchUserIps = useCallback(async (userId: number, window: WindowKey) => {
    setUserIpsLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/ip/users/${userId}/ips?window=${window}`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        setUserIpsData(res.data?.items || [])
      } else {
        showToast('error', res.message || '获取用户 IP 列表失败')
      }
    } catch (e) {
      console.error('Failed to fetch user IPs:', e)
      showToast('error', '获取用户 IP 列表失败')
    } finally {
      setUserIpsLoading(false)
    }
  }, [apiUrl, getAuthHeaders, showToast])

  // AI 自动封禁相关函数
  const fetchAiConfig = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/ai-ban/config`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        setAiConfig(res.data)
      }
    } catch (e) {
      console.error('Failed to fetch AI config:', e)
    }
  }, [apiUrl, getAuthHeaders])

  const fetchAiSuspiciousUsers = useCallback(async (showSuccessToast = false) => {
    setAiLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/ai-ban/suspicious-users?window=1h&limit=20`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        setAiSuspiciousUsers(res.data?.items || [])
        if (showSuccessToast) showToast('success', '已刷新')
      } else {
        showToast('error', res.message || '获取可疑用户失败')
      }
    } catch (e) {
      console.error('Failed to fetch suspicious users:', e)
      showToast('error', '获取可疑用户失败')
    } finally {
      setAiLoading(false)
    }
  }, [apiUrl, getAuthHeaders, showToast])

  const handleAiAssess = async (userId: number) => {
    setAiAssessing(userId)
    setAiAssessResult(null)
    try {
      const response = await fetch(`${apiUrl}/api/ai-ban/assess`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ user_id: userId, window: '1h' }),
      })
      const res = await response.json()
      if (res.success) {
        setAiAssessResult(res.data)
        showToast('success', 'AI 评估完成')
      } else {
        showToast('error', res.message || 'AI 评估失败')
      }
    } catch (e) {
      console.error('Failed to assess user:', e)
      showToast('error', 'AI 评估失败')
    } finally {
      setAiAssessing(null)
    }
  }

  const handleAiScan = async () => {
    setAiScanning(true)
    try {
      const response = await fetch(`${apiUrl}/api/ai-ban/scan?window=1h&limit=10`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      const res = await response.json()
      if (res.success) {
        const stats = res.data?.stats || {}
        showToast('success', `扫描完成: 处理 ${stats.total_processed || 0} 人, 封禁 ${stats.banned || 0} 人, 告警 ${stats.warned || 0} 人`)
        fetchAiSuspiciousUsers()
        fetchBanRecords(1)
      } else {
        showToast('error', res.message || '扫描失败')
      }
    } catch (e) {
      console.error('Failed to run AI scan:', e)
      showToast('error', '扫描失败')
    } finally {
      setAiScanning(false)
    }
  }

  // AI 配置相关函数
  const handleFetchModels = async () => {
    // 如果没有填写新的 api_key，但已经保存过配置，则允许获取模型列表
    const hasApiKey = aiConfigEdit.api_key || aiConfig?.has_api_key
    if (!aiConfigEdit.base_url || !hasApiKey) {
      showToast('error', '请先填写 API 地址和 API Key')
      return
    }
    setAiModelLoading(true)
    setAiModels([])
    try {
      const response = await fetch(`${apiUrl}/api/ai-ban/models`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          base_url: aiConfigEdit.base_url,
          api_key: aiConfigEdit.api_key || undefined,  // 不传则使用已保存的
        }),
      })
      const res = await response.json()
      if (res.success) {
        setAiModels(res.models || [])
        showToast('success', res.message || '获取模型列表成功')
      } else {
        showToast('error', res.message || '获取模型列表失败')
      }
    } catch (e) {
      console.error('Failed to fetch models:', e)
      showToast('error', '获取模型列表失败')
    } finally {
      setAiModelLoading(false)
    }
  }

  const handleTestModel = async () => {
    // 如果没有填写新的 api_key，但已经保存过配置，则允许测试
    const hasApiKey = aiConfigEdit.api_key || aiConfig?.has_api_key
    if (!aiConfigEdit.base_url || !hasApiKey || !aiConfigEdit.model) {
      showToast('error', '请先填写完整配置并选择模型')
      return
    }
    setAiTesting(true)
    setAiTestResult(null)
    try {
      const response = await fetch(`${apiUrl}/api/ai-ban/test-model`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          base_url: aiConfigEdit.base_url,
          api_key: aiConfigEdit.api_key || undefined,  // 不传则使用已保存的
          model: aiConfigEdit.model,
        }),
      })
      const res = await response.json()
      setAiTestResult(res)
      if (res.success) {
        showToast('success', `连接成功，延迟 ${res.latency_ms}ms`)
      } else {
        showToast('error', res.message || '测试失败')
      }
      
      // 3秒后自动清除测试结果
      setTimeout(() => {
        setAiTestResult(null)
      }, 3000)
    } catch (e) {
      console.error('Failed to test model:', e)
      showToast('error', '测试失败')
    } finally {
      setAiTesting(false)
    }
  }

  const handleSaveAiConfig = async () => {
    setAiSaving(true)
    try {
      const response = await fetch(`${apiUrl}/api/ai-ban/config`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          base_url: aiConfigEdit.base_url || undefined,
          api_key: aiConfigEdit.api_key || undefined,
          model: aiConfigEdit.model || undefined,
          enabled: aiConfigEdit.enabled,
          dry_run: aiConfigEdit.dry_run,
          scan_interval_minutes: aiConfigEdit.scan_interval_minutes,
        }),
      })
      const res = await response.json()
      if (res.success) {
        showToast('success', '配置已保存')
        setAiConfig(res.data)
        // 移除自动折叠逻辑，保持展开状态
      } else {
        showToast('error', res.message || '保存失败')
      }
    } catch (e) {
      console.error('Failed to save config:', e)
      showToast('error', '保存配置失败')
    } finally {
      setAiSaving(false)
    }
  }

  // 初始化配置编辑状态
  useEffect(() => {
    if (aiConfig && aiConfigExpanded) {
      setAiConfigEdit({
        base_url: aiConfig.base_url || '',
        api_key: '',  // 不回显 API Key
        model: aiConfig.model || '',
        enabled: aiConfig.enabled,
        dry_run: aiConfig.dry_run,
        scan_interval_minutes: aiConfig.scan_interval_minutes || 0,
      })
    }
  }, [aiConfig, aiConfigExpanded])

  const openUserIpsDialog = (userId: number, username: string) => {
    setSelectedUserForIps({ id: userId, username })
    setUserIpsDialogOpen(true)
    fetchUserIps(userId, ipWindow)
  }

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

  const handleQuickBanUser = (userId: number, username: string) => {
    openUserAnalysisFromIP(userId, username)
  }

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
    const subPath = HASH_VIEW_MAP[view] || ''
    const newHash = subPath ? `#risk/${subPath}` : '#risk'
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, '', newHash)
    }
  }, [view])

  useEffect(() => {
    const handleHashChange = () => {
      const newView = getInitialView()
      setView(newView)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    const activeTabIndex = riskTabs.findIndex(tab => tab.id === view)
    const activeTabElement = tabsRef.current[activeTabIndex]
    if (activeTabElement) {
      setTabIndicatorStyle({
        left: activeTabElement.offsetLeft,
        width: activeTabElement.offsetWidth,
        opacity: 1
      })
    }
  }, [view, riskTabs])

  useEffect(() => {
    const handleResize = () => {
      const activeTabIndex = riskTabs.findIndex(tab => tab.id === view)
      const activeTabElement = tabsRef.current[activeTabIndex]
      if (activeTabElement) {
        setTabIndicatorStyle({
          left: activeTabElement.offsetLeft,
          width: activeTabElement.offsetWidth,
          opacity: 1
        })
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [view, riskTabs])

  useEffect(() => {
    if (view === 'leaderboards') fetchLeaderboards()
    if (view === 'banned_list') fetchBannedUsers(1)
    if (view === 'audit_logs') fetchBanRecords(1)
    if (view === 'ip_monitoring') fetchIPData(false, true)  // Reset page on view change
    if (view === 'ai_ban') {
      fetchAiConfig()
      fetchAiSuspiciousUsers()
    }
  }, [fetchLeaderboards, fetchBanRecords, fetchBannedUsers, fetchIPData, fetchAiConfig, fetchAiSuspiciousUsers, view])

  useEffect(() => {
    if (view === 'ip_monitoring') fetchIPData(false, true)  // Reset page on window change
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

  // 刷新所有 IP 数据
  const handleRefreshIP = async () => {
    setIpRefreshing(prev => ({ ...prev, all: true }))
    await fetchIPData(true)
    setIpRefreshing(prev => ({ ...prev, all: false }))
  }

  // 单独刷新共享 IP 列表
  const handleRefreshSharedIps = async () => {
    setIpRefreshing(prev => ({ ...prev, shared: true }))
    try {
      const response = await fetch(`${apiUrl}/api/ip/shared-ips?window=${ipWindow}&min_tokens=2&limit=200`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        setSharedIps(res.data?.items || [])
        showToast('success', '已刷新')
      }
    } catch (e) {
      showToast('error', '刷新失败')
    } finally {
      setIpRefreshing(prev => ({ ...prev, shared: false }))
    }
  }

  // 单独刷新多 IP 令牌列表
  const handleRefreshMultiIpTokens = async () => {
    setIpRefreshing(prev => ({ ...prev, tokens: true }))
    try {
      const response = await fetch(`${apiUrl}/api/ip/multi-ip-tokens?window=${ipWindow}&min_ips=2&limit=200`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        setMultiIpTokens(res.data?.items || [])
        showToast('success', '已刷新')
      }
    } catch (e) {
      showToast('error', '刷新失败')
    } finally {
      setIpRefreshing(prev => ({ ...prev, tokens: false }))
    }
  }

  // 单独刷新多 IP 用户列表
  const handleRefreshMultiIpUsers = async () => {
    setIpRefreshing(prev => ({ ...prev, users: true }))
    try {
      const response = await fetch(`${apiUrl}/api/ip/multi-ip-users?window=${ipWindow}&min_ips=3&limit=200`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        setMultiIpUsers(res.data?.items || [])
        showToast('success', '已刷新')
      }
    } catch (e) {
      showToast('error', '刷新失败')
    } finally {
      setIpRefreshing(prev => ({ ...prev, users: false }))
    }
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
            <Badge variant="outline" className="animate-pulse border-green-500 text-green-600 bg-green-50 dark:bg-green-950/20">
              <div className="w-2 h-2 rounded-full bg-green-500 mr-2" />
              {view === 'leaderboards' ? '实时流量监控' :
                view === 'ip_monitoring' ? 'IP 实时监控' :
                  view === 'banned_list' ? '策略生效中' : '系统运行中'}
            </Badge>
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

      <div className="relative">
        <div className="relative inline-flex h-10 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
          <div
            className="absolute inset-y-1 bg-background rounded-md shadow-sm transition-all duration-300 ease-out"
            style={{
              left: tabIndicatorStyle.left,
              width: tabIndicatorStyle.width,
              opacity: tabIndicatorStyle.opacity,
            }}
          />

          {riskTabs.map(({ id, label, icon: Icon }, index) => (
            <button
              key={id}
              ref={el => tabsRef.current[index] = el}
              onClick={() => setView(id)}
              className={cn(
                "relative z-10 inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                view === id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/80"
              )}
            >
              <Icon className={cn("w-4 h-4 transition-transform duration-300", view === id && "scale-110")} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'leaderboards' && (
        <div className="mt-4">
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
                                <div
                                  className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted/50 hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer w-fit"
                                  onClick={() => openUserDialog(item, w)}
                                  title="查看用户分析"
                                >
                                  <div className="w-4 h-4 rounded-full bg-background flex items-center justify-center border text-[10px] text-muted-foreground font-bold">
                                    {String(name)[0]?.toUpperCase()}
                                  </div>
                                  <span className="text-xs font-medium truncate max-w-[100px]">{name}</span>
                                </div>
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
                                <div className={cn(
                                  "font-bold text-sm tabular-nums tracking-tight",
                                  sortBy === 'quota' ? "text-primary" : "text-foreground"
                                )}>
                                  {renderMetric(item)}
                                </div>
                                <div className="text-[9px] text-muted-foreground uppercase font-medium">{metricLabel}</div>
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
                            <div
                              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted/50 hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer w-fit"
                              onClick={() => openUserDialog(item, selectedWindow)}
                              title="查看用户分析"
                            >
                              <div className="w-4 h-4 rounded-full bg-background flex items-center justify-center border text-[10px] text-muted-foreground font-bold">
                                {String(name)[0]?.toUpperCase()}
                              </div>
                              <span className="text-xs font-medium truncate max-w-[100px]">{name}</span>
                            </div>
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
                            <div className={cn(
                              "font-bold text-sm tabular-nums tracking-tight",
                              sortBy === 'quota' ? "text-primary" : "text-foreground"
                            )}>
                              {renderMetric(item)}
                            </div>
                            <div className="text-[9px] text-muted-foreground uppercase font-medium">{metricLabel}</div>
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
        </div>
      )}

      {view === 'banned_list' && (
        <div className="mt-4">
          <Card className="rounded-xl shadow-sm border">
            <CardHeader className="pb-3 border-b bg-muted/20">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <ShieldBan className="h-5 w-5 text-destructive" />
                  封禁列表
                </CardTitle>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded-full">
                    当前封禁 {bannedTotal} 个用户
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchBannedUsers(1, true)}
                    disabled={bannedLoading}
                    className="h-8 shadow-sm"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", bannedLoading && "animate-spin")} />
                    刷新列表
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {bannedLoading ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 mr-2 animate-spin text-primary/50" />加载中...
                </div>
              ) : (
                <>
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30 hover:bg-muted/30 border-b">
                          <TableHead className="w-[80px] text-xs uppercase tracking-wider">ID</TableHead>
                          <TableHead className="w-[180px] text-xs uppercase tracking-wider">用户详情</TableHead>
                          <TableHead className="w-[160px] text-xs uppercase tracking-wider">封禁时间</TableHead>
                          <TableHead className="w-[120px] text-xs uppercase tracking-wider">操作者</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">封禁原因</TableHead>
                          <TableHead className="w-[120px] text-right text-xs uppercase tracking-wider">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bannedUsers.length ? bannedUsers.map((user) => (
                          <TableRow key={user.id} className="group hover:bg-muted/20 transition-colors">
                            <TableCell className="text-[12px] text-muted-foreground font-mono py-3">
                              {user.id}
                            </TableCell>
                            <TableCell className="py-3">
                              <div className="flex flex-col gap-1">
                                <div
                                  className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted/50 hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer w-fit"
                                  onClick={() => {
                                    const mockItem: LeaderboardItem = {
                                      user_id: user.id,
                                      username: user.username,
                                      user_status: 2,
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
                                  title="查看用户分析"
                                >
                                  <div className="w-4 h-4 rounded-full bg-background flex items-center justify-center border text-[10px] text-muted-foreground font-bold">
                                    {String(user.username)[0]?.toUpperCase()}
                                  </div>
                                  <span className="text-xs font-medium truncate max-w-[120px]">{user.username}</span>
                                </div>
                                {user.display_name && user.display_name !== user.username && (
                                  <span className="text-[10px] text-muted-foreground truncate max-w-[160px] pl-2">
                                    {user.display_name}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-[12px] text-muted-foreground font-mono whitespace-nowrap py-3">
                              {user.banned_at ? formatTime(user.banned_at) : '-'}
                            </TableCell>
                            <TableCell className="py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-500 border">
                                  {(user.ban_operator || '系')[0].toUpperCase()}
                                </div>
                                <span className="text-xs text-muted-foreground">{user.ban_operator || '系统'}</span>
                              </div>
                            </TableCell>
                            <TableCell className="py-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {renderReasonBadge(user.ban_reason)}
                                {user.ban_context?.source && (
                                  <Badge variant="secondary" className="text-[10px] h-4 font-normal px-1 opacity-60">
                                    {user.ban_context.source === 'risk_center' ? '自动' :
                                      user.ban_context.source === 'ip_monitoring' ? 'IP监控' : user.ban_context.source}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right py-3">
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-xs text-green-600 hover:bg-green-500/10 hover:text-green-700 font-medium"
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
                                  <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                                  解封
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
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
                                  <Eye className="h-4 w-4" />
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
        </div>
      )}

      {view === 'audit_logs' && (
        <div className="mt-4">
          <Card className="rounded-xl shadow-sm border">
            <CardHeader className="pb-3 border-b bg-muted/20">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  审计日志
                </CardTitle>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded-full">
                    本页显示 {records.length} 条记录
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchBanRecords(1, true)}
                    disabled={recordsLoading}
                    className="h-8 shadow-sm"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", recordsLoading && "animate-spin")} />
                    刷新日志
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {recordsLoading ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 mr-2 animate-spin text-primary/50" />加载中...
                </div>
              ) : (
                <>
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30 hover:bg-muted/30 border-b">
                          <TableHead className="w-[160px] text-xs uppercase tracking-wider">时间</TableHead>
                          <TableHead className="w-[100px] text-xs uppercase tracking-wider">动作</TableHead>
                          <TableHead className="w-[160px] text-xs uppercase tracking-wider">受影响用户</TableHead>
                          <TableHead className="w-[120px] text-xs uppercase tracking-wider">操作者</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider">原因与指标</TableHead>
                          <TableHead className="w-[80px] text-right text-xs uppercase tracking-wider">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {records.length ? records.map((r) => {
                          const isTokenBan = r.context?.token_id !== undefined
                          const tokenName = r.context?.token_name || ''
                          const dateObj = new Date(r.created_at * 1000)

                          return (
                            <TableRow key={r.id} className="group hover:bg-muted/30 transition-colors border-b last:border-0">
                              <TableCell className="py-4 align-top">
                                <div className="flex flex-col">
                                  <span className="font-mono text-xs font-medium text-foreground">
                                    {dateObj.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground mt-0.5">
                                    {dateObj.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                                  </span>
                                </div>
                              </TableCell>
                              
                              <TableCell className="py-4 align-top">
                                <div className="flex flex-col items-start gap-1.5">
                                  {r.action === 'ban' ? (
                                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/30">
                                      <ShieldBan className="w-3.5 h-3.5" />
                                      <span className="text-xs font-bold">封禁</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-100 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/30">
                                      <ShieldCheck className="w-3.5 h-3.5" />
                                      <span className="text-xs font-bold">解封</span>
                                    </div>
                                  )}
                                  {isTokenBan && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 border border-orange-100 dark:bg-orange-900/20 dark:text-orange-400 ml-0.5">
                                      令牌级
                                    </span>
                                  )}
                                </div>
                              </TableCell>

                              <TableCell className="py-4 align-top">
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-600 border border-slate-200">
                                      {(r.username || `U`)[0]?.toUpperCase()}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                      <span 
                                        className="text-xs font-bold text-foreground truncate max-w-[120px] hover:text-primary cursor-pointer transition-colors"
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
                                        {r.username || `User#${r.user_id}`}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground font-mono">ID: {r.user_id}</span>
                                    </div>
                                  </div>
                                  
                                  {isTokenBan && tokenName && (
                                    <div className="flex items-center gap-1.5 pl-8">
                                      <div className="w-1 h-1 rounded-full bg-slate-300" />
                                      <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground truncate max-w-[140px]" title={tokenName}>
                                        {tokenName}
                                      </code>
                                    </div>
                                  )}
                                </div>
                              </TableCell>

                              <TableCell className="py-4 align-top">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-[10px] font-bold text-indigo-600 border border-indigo-100">
                                    {(r.operator || '系')[0].toUpperCase()}
                                  </div>
                                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{r.operator || '系统'}</span>
                                </div>
                              </TableCell>

                              <TableCell className="py-4 align-top">
                                <div className="flex flex-col gap-2">
                                  {/* 原因标签行 */}
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {renderReasonBadge(r.reason)}
                                    {r.context?.source && (
                                      <Badge variant="secondary" className="text-[10px] h-5 font-normal px-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 border-slate-200">
                                        {r.context.source === 'risk_center' ? '自动' :
                                          r.context.source === 'ip_monitoring' ? 'IP监控' :
                                            r.context.source === 'ban_records' ? '手动' : 
                                            r.context.source === 'ai_auto_ban' ? 'AI决策' : r.context.source}
                                      </Badge>
                                    )}
                                  </div>

                                  {/* 指标数据行 - 仅当有相关数据时显示 */}
                                  {r.context && (r.context.risk || r.context.summary) && (
                                    <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
                                      {r.context.risk?.requests_per_minute > 0 && (
                                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-50 border border-slate-100">
                                          <Activity className="w-3 h-3 text-blue-500" />
                                          <span className="font-mono">RPM: {r.context.risk.requests_per_minute.toFixed(1)}</span>
                                        </div>
                                      )}
                                      {r.context.summary?.failure_rate !== undefined && (
                                        <div className={cn(
                                          "flex items-center gap-1 px-1.5 py-0.5 rounded border",
                                          r.context.summary.failure_rate > 0.3 ? "bg-red-50 border-red-100 text-red-600" : "bg-slate-50 border-slate-100"
                                        )}>
                                          <AlertTriangle className="w-3 h-3" />
                                          <span className="font-mono">失败: {(r.context.summary.failure_rate * 100).toFixed(0)}%</span>
                                        </div>
                                      )}
                                      {r.context.summary?.unique_ips > 0 && (
                                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-50 border border-slate-100">
                                          <Globe className="w-3 h-3 text-indigo-500" />
                                          <span className="font-mono">IP: {r.context.summary.unique_ips}</span>
                                        </div>
                                      )}
                                      {/* AI 评分展示 */}
                                      {r.context.risk_score !== undefined && (
                                        <div className={cn(
                                          "flex items-center gap-1 px-1.5 py-0.5 rounded border",
                                          r.context.risk_score >= 8 ? "bg-red-50 border-red-100 text-red-600" : "bg-amber-50 border-amber-100 text-amber-600"
                                        )}>
                                          <Activity className="w-3 h-3" />
                                          <span className="font-mono font-bold">Risk: {r.context.risk_score}</span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </TableCell>

                              <TableCell className="py-4 align-top text-right">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors"
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
                                  title="查看行为轨迹"
                                >
                                  <Eye className="h-4 w-4" />
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
        </div>
      )}

      {view === 'ip_monitoring' && (
        <div className="mt-4">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Select value={ipWindow} onChange={(e) => setIpWindow(e.target.value as WindowKey)} className="w-32 h-9">
                  {allWindows.map((w) => (
                    <option key={w} value={w}>{WINDOW_LABELS[w]}</option>
                  ))}
                </Select>
              </div>
              <Button variant="outline" size="sm" onClick={handleRefreshIP} disabled={ipRefreshing.all} className="h-9">
                <RefreshCw className={cn("h-4 w-4 mr-2", ipRefreshing.all && "animate-spin")} />
                全部刷新
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="rounded-xl border-l-4 border-l-blue-500 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider font-semibold">IP 记录状态</div>
                      <div className="text-3xl font-bold tabular-nums text-blue-600">{ipStats?.enabled_percentage?.toFixed(1) || 0}<span className="text-xl ml-0.5">%</span></div>
                      <div className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
                        <span className="font-medium text-foreground/70">{ipStats?.enabled_count || 0}</span> / {ipStats?.total_users || 0} 用户已开启
                      </div>
                    </div>
                    <div className="p-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-full">
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
                      <div className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider font-semibold">24h 唯一 IP</div>
                      <div className="text-3xl font-bold tabular-nums text-green-600">{formatNumber(ipStats?.unique_ips_24h || 0)}</div>
                      <div className="text-[11px] text-muted-foreground mt-1.5">
                        系统活跃 IP 总数
                      </div>
                    </div>
                    <div className="p-2.5 bg-green-50 dark:bg-green-900/20 rounded-full">
                      <Activity className="h-6 w-6 text-green-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-xl border-l-4 border-l-orange-500 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider font-semibold">共享 IP (多令牌)</div>
                      <div className="text-3xl font-bold tabular-nums text-orange-600">{sharedIps.length}</div>
                      <div className="text-[11px] text-muted-foreground mt-1.5">
                        可能的账号共享行为
                      </div>
                    </div>
                    <div className="p-2.5 bg-orange-50 dark:bg-orange-900/20 rounded-full">
                      <AlertTriangle className="h-6 w-6 text-orange-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-xl border-l-4 border-l-red-500 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider font-semibold">多 IP 令牌</div>
                      <div className="text-3xl font-bold tabular-nums text-red-600">{multiIpTokens.length}</div>
                      <div className="text-[11px] text-muted-foreground mt-1.5">
                        可能的令牌泄露风险
                      </div>
                    </div>
                    <div className="p-2.5 bg-red-50 dark:bg-red-900/20 rounded-full">
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
                <Card className="rounded-xl border shadow-sm overflow-hidden">
                  <CardHeader className="pb-3 border-b bg-muted/20">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-orange-500" />
                        多令牌共用 IP
                        <Badge variant="secondary" className="ml-2 bg-background font-mono">{sharedIps.length}</Badge>
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={handleRefreshSharedIps}
                        disabled={ipRefreshing.shared}
                        title="刷新"
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", ipRefreshing.shared && "animate-spin")} />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {sharedIps.length > 0 ? (
                      <>
                        <div className="divide-y">
                          {sharedIps.slice((ipPage.shared - 1) * ipPageSize, ipPage.shared * ipPageSize).map((item) => (
                            <div key={item.ip} className="px-4 py-3 transition-colors hover:bg-muted/30">
                              <div
                                className="flex items-center justify-between cursor-pointer"
                                onClick={() => toggleSharedIpExpand(item.ip)}
                              >
                                <div className="flex items-center gap-3">
                                  <code className="text-sm bg-muted px-2 py-1 rounded font-mono text-foreground border border-border/50">{item.ip}</code>
                                  <div className="flex gap-2">
                                    <Badge variant="outline" className="font-normal bg-background">{item.token_count} 令牌</Badge>
                                    <Badge variant="outline" className="font-normal bg-background">{item.user_count} 用户</Badge>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="flex flex-col items-end">
                                    <span className="text-sm font-bold tabular-nums font-mono text-foreground">
                                      {formatNumber(item.request_count)}
                                    </span>
                                    <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-tight opacity-50">Requests</span>
                                  </div>
                                  <div className={cn("transition-transform duration-200 p-1 rounded hover:bg-muted", expandedSharedIps.has(item.ip) && "rotate-180")}>
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  </div>
                                </div>
                              </div>
                              {expandedSharedIps.has(item.ip) && (
                                <div className="mt-3 pl-4 space-y-2 animate-in slide-in-from-top-1 duration-200">
                                  {item.tokens.map((t) => (
                                    <div key={t.token_id} className="flex items-center justify-between text-sm bg-muted/40 rounded-lg px-3 py-2 border border-border/40">
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold text-primary/80">{t.token_name || `Token#${t.token_id}`}</span>
                                        <div
                                          className="flex items-center gap-2 px-2 py-1 rounded-full bg-muted/50 hover:bg-primary/10 hover:text-primary transition-all cursor-pointer border border-transparent hover:border-primary/20 w-fit group/user"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            openUserAnalysisFromIP(t.user_id, t.username)
                                          }}
                                        >
                                          <div className="w-4 h-4 rounded-full bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold text-[10px] border border-blue-500/20 group-hover/user:bg-blue-500/20">
                                            {t.username[0]?.toUpperCase()}
                                          </div>
                                          <span className="text-xs font-semibold whitespace-nowrap">{t.username || t.user_id}</span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5 opacity-80">
                                        <span className="text-foreground font-bold tabular-nums font-mono text-xs">{formatNumber(t.request_count)}</span>
                                        <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-tighter opacity-60">reqs</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        {sharedIps.length > ipPageSize && (
                          <div className="flex items-center justify-between p-3 border-t bg-muted/5">
                            <div className="text-[11px] text-muted-foreground">
                              显示 {Math.min(sharedIps.length, (ipPage.shared - 1) * ipPageSize + 1)} - {Math.min(sharedIps.length, ipPage.shared * ipPageSize)}，共 {sharedIps.length} 条
                            </div>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={ipPage.shared <= 1} onClick={() => setIpPage(p => ({ ...p, shared: p.shared - 1 }))}>上一页</Button>
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={ipPage.shared * ipPageSize >= sharedIps.length} onClick={() => setIpPage(p => ({ ...p, shared: p.shared + 1 }))}>下一页</Button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="h-40 flex flex-col items-center justify-center text-muted-foreground text-sm">
                        <ShieldCheck className="h-8 w-8 mb-2 opacity-20" />
                        暂无异常共用 IP
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Multi-IP Tokens Table (Refactored) */}
                <Card className="rounded-xl border shadow-sm overflow-hidden">
                  <CardHeader className="pb-3 border-b bg-muted/20">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <ShieldBan className="h-4 w-4 text-red-500" />
                        单令牌多 IP (疑似泄露)
                        <Badge variant="secondary" className="ml-2 bg-background font-mono">{multiIpTokens.length}</Badge>
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={handleRefreshMultiIpTokens}
                        disabled={ipRefreshing.tokens}
                        title="刷新"
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", ipRefreshing.tokens && "animate-spin")} />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {multiIpTokens.length > 0 ? (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50 hover:bg-muted/50 border-b">
                              <TableHead className="w-[200px] text-[11px] uppercase tracking-wider py-3 px-4 text-muted-foreground font-bold">令牌信息</TableHead>
                              <TableHead className="w-[80px] text-[11px] uppercase tracking-wider py-3 text-muted-foreground font-bold">IP 数量</TableHead>
                              <TableHead className="w-[150px] text-[11px] uppercase tracking-wider py-3 text-muted-foreground font-bold">所属用户</TableHead>
                              <TableHead className="w-[100px] text-right text-[11px] uppercase tracking-wider py-3 pr-4 text-muted-foreground font-bold">请求总量</TableHead>
                              <TableHead className="w-[100px] text-center text-[11px] uppercase tracking-wider py-3 text-muted-foreground font-bold">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {multiIpTokens.slice((ipPage.tokens - 1) * ipPageSize, ipPage.tokens * ipPageSize).map((item) => (
                              <React.Fragment key={item.token_id}>
                                <TableRow className="group transition-colors border-b last:border-0 hover:bg-muted/30">
                                  <TableCell className="py-3 px-4">
                                    <div
                                      className="flex flex-col cursor-pointer hover:text-primary transition-colors"
                                      onClick={() => toggleTokenExpand(item.token_id)}
                                    >
                                      <span className="font-bold text-sm truncate max-w-[180px]" title={item.token_name}>
                                        {item.token_name || `Token#${item.token_id}`}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground font-mono opacity-70 leading-none mt-0.5">ID: {item.token_id}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="py-3">
                                    <Badge
                                      variant="destructive"
                                      className="font-bold tabular-nums bg-red-500/10 text-red-500 border-red-500/20 px-2 py-0.5 h-5 min-w-[28px] justify-center"
                                    >
                                      {item.ip_count}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="py-3">
                                    <div
                                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/50 hover:bg-primary/10 hover:text-primary transition-all cursor-pointer border border-transparent hover:border-primary/20 w-fit"
                                      onClick={() => openUserAnalysisFromIP(item.user_id, item.username)}
                                    >
                                      <div className="w-4 h-4 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 text-[10px] text-primary font-bold">
                                        {item.username[0]?.toUpperCase()}
                                      </div>
                                      <span className="text-xs font-semibold truncate max-w-[100px]">{item.username || item.user_id}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="py-3">
                                    <div className="flex flex-col items-end pr-4">
                                      <span className="text-base font-bold tabular-nums font-mono text-primary">
                                        {formatNumber(item.request_count)}
                                      </span>
                                      <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-tight opacity-50">Total Reqs</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="py-3 text-center">
                                    <div className="flex items-center gap-1 justify-center">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                                        onClick={() => handleDisableToken(item.token_id, item.token_name || `Token#${item.token_id}`)}
                                        title="禁用令牌"
                                      >
                                        <Ban className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className={cn("h-8 w-8 text-muted-foreground transition-transform duration-300", expandedTokens.has(item.token_id) && "rotate-180 bg-muted")}
                                        onClick={() => toggleTokenExpand(item.token_id)}
                                      >
                                        <ChevronDown className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                                {/* Expandable IP List Row */}
                                {expandedTokens.has(item.token_id) && (
                                  <TableRow className="bg-muted/10 hover:bg-muted/10">
                                    <TableCell colSpan={5} className="py-3 px-6">
                                      <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                                        <div className="h-1 w-1 rounded-full bg-primary" />
                                        活跃 IP 详细分布
                                      </div>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                        {item.ips.map((ip) => (
                                          <div key={ip.ip} className="flex items-center justify-between text-xs bg-background/50 rounded-md px-3 py-2 border border-border/40 hover:border-primary/20 transition-colors">
                                            <code className="font-mono text-foreground font-semibold text-xs">{ip.ip}</code>
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-primary font-bold tabular-nums font-mono">{formatNumber(ip.request_count)}</span>
                                              <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-tighter opacity-60">reqs</span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                )}
                              </React.Fragment>
                            ))}
                          </TableBody>
                        </Table>
                        {multiIpTokens.length > ipPageSize && (
                          <div className="flex items-center justify-between p-3 border-t bg-muted/5">
                            <div className="text-[11px] text-muted-foreground font-medium opacity-70">
                              第 {ipPage.tokens} / {Math.ceil(multiIpTokens.length / ipPageSize)} 页 · 共 {multiIpTokens.length} 条
                            </div>
                            <div className="flex gap-1">
                              <Button variant="outline" size="sm" className="h-7 px-3 text-[11px] shadow-sm" disabled={ipPage.tokens <= 1} onClick={() => setIpPage(p => ({ ...p, tokens: p.tokens - 1 }))}>上一页</Button>
                              <Button variant="outline" size="sm" className="h-7 px-3 text-[11px] shadow-sm" disabled={ipPage.tokens * ipPageSize >= multiIpTokens.length} onClick={() => setIpPage(p => ({ ...p, tokens: p.tokens + 1 }))}>下一页</Button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="h-40 flex flex-col items-center justify-center text-muted-foreground text-sm">
                        <ShieldCheck className="h-8 w-8 mb-2 opacity-20" />
                        暂无异常多 IP 令牌
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Multi-IP Users Table */}
                <Card className="rounded-xl border shadow-sm overflow-hidden">
                  <CardHeader className="pb-3 border-b bg-muted/20">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Activity className="h-4 w-4 text-blue-500" />
                        单用户多 IP (≥3)
                        <Badge variant="secondary" className="ml-2 bg-background font-mono">{multiIpUsers.length}</Badge>
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={handleRefreshMultiIpUsers}
                        disabled={ipRefreshing.users}
                        title="刷新"
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", ipRefreshing.users && "animate-spin")} />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {multiIpUsers.length > 0 ? (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50 hover:bg-muted/50 border-b">
                              <TableHead className="w-[200px] text-[11px] uppercase tracking-wider py-3 px-4 text-muted-foreground font-bold">用户详情</TableHead>
                              <TableHead className="w-[60px] text-[11px] uppercase tracking-wider py-3 text-muted-foreground font-bold">IP 数量</TableHead>
                              <TableHead className="w-[100px] text-[11px] uppercase tracking-wider py-3 text-muted-foreground font-bold">请求总量</TableHead>
                              <TableHead className="hidden md:table-cell text-[11px] uppercase tracking-wider py-3 text-muted-foreground font-bold">常用 IP 分布</TableHead>
                              <TableHead className="w-[80px] text-center text-[11px] uppercase tracking-wider py-3 text-muted-foreground font-bold">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {multiIpUsers.slice((ipPage.users - 1) * ipPageSize, ipPage.users * ipPageSize).map((item) => (
                              <TableRow key={item.user_id} className="group hover:bg-muted/30 transition-colors border-b last:border-0">
                                <TableCell className="py-2.5 px-4">
                                  <div
                                    className="flex items-center gap-2 px-2 py-1 rounded-full bg-muted/50 hover:bg-primary/10 hover:text-primary transition-all cursor-pointer border border-transparent hover:border-primary/20 w-fit group/user"
                                    onClick={() => openUserAnalysisFromIP(item.user_id, item.username)}
                                  >
                                    <div className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold text-[10px] border border-blue-500/20 group-hover/user:bg-blue-500/20">
                                      {item.username[0]?.toUpperCase()}
                                    </div>
                                    <div className="flex flex-col leading-tight">
                                      <span className="font-bold text-sm whitespace-nowrap">{item.username || item.user_id}</span>
                                      <span className="text-[9px] opacity-60 font-mono mt-0.5 leading-none">ID: {item.user_id}</span>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="py-2.5">
                                  <Badge
                                    variant="outline"
                                    className="font-bold text-sm tabular-nums bg-background border-blue-200 text-blue-600 hover:bg-blue-600 hover:text-white transition-all cursor-pointer px-2.5 py-0.5 h-7 min-w-[36px] justify-center"
                                    onClick={() => openUserIpsDialog(item.user_id, item.username)}
                                    title="点击查看完整 IP 列表"
                                  >
                                    {item.ip_count}
                                  </Badge>
                                </TableCell>
                                <TableCell className="py-2.5">
                                  <div className="flex flex-col items-start">
                                    <span className="text-lg font-black tabular-nums font-mono text-blue-600 dark:text-blue-400">
                                      {formatNumber(item.request_count)}
                                    </span>
                                    <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-tight opacity-50">Total Requests</span>
                                  </div>
                                </TableCell>
                                <TableCell className="hidden md:table-cell py-2.5">
                                  <div className="flex flex-wrap gap-1.5">
                                    {item.top_ips.slice(0, 2).map((ip) => (
                                      <code key={ip.ip} className="text-xs font-medium bg-muted/80 px-2 py-1 rounded font-mono border border-border/50 text-foreground/90 tabular-nums">
                                        {ip.ip}
                                      </code>
                                    ))}
                                    {item.ip_count > 2 && (
                                      <button
                                        className="text-[11px] text-primary font-bold hover:underline bg-primary/5 hover:bg-primary/10 px-2 py-0.5 rounded border border-primary/20 transition-all"
                                        onClick={() => openUserIpsDialog(item.user_id, item.username)}
                                      >
                                        +{item.ip_count - 2}
                                      </button>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="py-2.5">
                                  <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"
                                      onClick={() => openUserAnalysisFromIP(item.user_id, item.username)}
                                      title="行为分析"
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                      onClick={() => handleQuickBanUser(item.user_id, item.username || `User#${item.user_id}`)}
                                      title="封禁用户"
                                    >
                                      <ShieldBan className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {multiIpUsers.length > ipPageSize && (
                          <div className="flex items-center justify-between p-3 border-t bg-muted/5">
                            <div className="text-[11px] text-muted-foreground font-medium opacity-70">
                              第 {ipPage.users} / {Math.ceil(multiIpUsers.length / ipPageSize)} 页 · 共 {multiIpUsers.length} 条
                            </div>
                            <div className="flex gap-1">
                              <Button variant="outline" size="sm" className="h-7 px-3 text-[11px] shadow-sm" disabled={ipPage.users <= 1} onClick={() => setIpPage(p => ({ ...p, users: p.users - 1 }))}>上一页</Button>
                              <Button variant="outline" size="sm" className="h-7 px-3 text-[11px] shadow-sm" disabled={ipPage.users * ipPageSize >= multiIpUsers.length} onClick={() => setIpPage(p => ({ ...p, users: p.users + 1 }))}>下一页</Button>
                            </div>
                          </div>
                        )}
                      </>
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
        </div>
      )}

      {/* AI 自动封禁 */}
          {view === 'ai_ban' && (
            <div className="mt-4 space-y-6">
              {/* 顶栏状态卡片 */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center gap-4">
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
                    aiConfig?.enabled ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-400"
                  )}>
                    {aiConfig?.enabled ? <ShieldCheck className="w-6 h-6" /> : <ShieldBan className="w-6 h-6" />}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">服务状态</span>
                    <span className={cn("text-lg font-bold", aiConfig?.enabled ? "text-emerald-600" : "text-slate-500")}>
                      {aiConfig?.enabled ? "已启用" : "已禁用"}
                    </span>
                  </div>
                </div>

                <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center gap-4">
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
                    aiConfig?.dry_run !== false ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                  )}>
                    <Activity className="w-6 h-6" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">运行模式</span>
                    <span className={cn("text-lg font-bold", aiConfig?.dry_run !== false ? "text-emerald-600" : "text-rose-600")}>
                      {aiConfig?.dry_run !== false ? "试运行" : "正式运行"}
                    </span>
                  </div>
                </div>

                <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <Settings className="w-6 h-6" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">AI 模型</span>
                    <span className="text-lg font-bold text-blue-600 truncate" title={aiConfig?.model}>
                      {aiConfig?.model || "未配置"}
                    </span>
                  </div>
                </div>

                <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">可疑用户</span>
                    <span className="text-lg font-bold text-rose-600">
                      {aiSuspiciousUsers.length}
                    </span>
                  </div>
                </div>
              </div>

              {/* API 配置面板 */}
              <Card className="rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div
                  className="px-6 py-4 border-b border-slate-100 bg-white flex justify-between items-center"
                >
                  <div
                    className="flex items-center gap-3 cursor-pointer flex-1"
                    onClick={() => setAiConfigExpanded(!aiConfigExpanded)}
                  >
                    <h3 className="font-bold text-lg text-slate-800">API 配置</h3>
                    <ChevronDown className={cn("h-5 w-5 text-slate-400 transition-transform", aiConfigExpanded && "rotate-180")} />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 text-xs font-medium gap-1.5"
                    onClick={() => setIsAiLogicModalOpen(true)}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    了解运行逻辑
                  </Button>
                </div>

                {aiConfigExpanded && (
                  <div className="p-6 bg-white space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      {/* Left Column */}
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-sm font-semibold text-slate-700">API 地址</label>
                          <Input
                            placeholder="https://api.openai.com/v1"
                            value={aiConfigEdit.base_url}
                            onChange={(e) => setAiConfigEdit(prev => ({ ...prev, base_url: e.target.value }))}
                            className="h-10 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
                          />
                          {aiConfigEdit.base_url && (
                            <div className="px-1 py-0.5 animate-in fade-in slide-in-from-top-1 duration-200">
                              <p className="text-xs font-semibold text-slate-500 uppercase tracking-tight mb-0.5">最终请求路径预览:</p>
                              <p className="text-sm font-bold text-blue-600 font-mono break-all" title={`${aiConfigEdit.base_url.replace(/\/+$/, "")}${/\/v1$/.test(aiConfigEdit.base_url.replace(/\/+$/, "")) ? "" : "/v1"}/chat/completions`}>
                                {aiConfigEdit.base_url.replace(/\/+$/, "")}{/\/v1$/.test(aiConfigEdit.base_url.replace(/\/+$/, "")) ? "" : "/v1"}/chat/completions
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-sm font-semibold text-slate-700">API 密钥</label>
                          <div className="relative">
                            <Input
                              type={showApiKey ? "text" : "password"}
                              placeholder="sk-..."
                              value={aiConfigEdit.api_key || (aiConfig?.has_api_key ? (showApiKey && aiConfig.api_key ? aiConfig.api_key : aiConfig.masked_api_key) : '')}
                              onChange={(e) => setAiConfigEdit(prev => ({ ...prev, api_key: e.target.value }))}
                              className="h-10 bg-slate-50 border-slate-200 focus:bg-white transition-colors pr-10"
                            />
                            {(aiConfig?.has_api_key || aiConfigEdit.api_key) && (
                              <button
                                type="button"
                                onClick={() => setShowApiKey(!showApiKey)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                                title={showApiKey ? "隐藏密钥" : "显示密钥"}
                              >
                                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            )}
                          </div>
                          {aiConfig?.has_api_key && !aiConfigEdit.api_key && (
                            <p className="text-xs text-slate-500">留空则使用已保存的密钥</p>
                          )}
                        </div>
                      </div>

                      {/* Right Column */}
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-sm font-semibold text-slate-700">模型选择</label>
                          <div className="flex gap-2">
                            <Select
                              value={aiConfigEdit.model}
                              onChange={(e) => setAiConfigEdit(prev => ({ ...prev, model: e.target.value }))}
                              className="flex-1 h-10 bg-slate-50 border-slate-200 focus:bg-white"
                            >
                              <option value="">选择模型</option>
                              {aiModels.map((m) => (
                                <option key={m.id} value={m.id}>{m.id}</option>
                              ))}
                              {aiConfigEdit.model && !aiModels.find(m => m.id === aiConfigEdit.model) && (
                                <option value={aiConfigEdit.model}>{aiConfigEdit.model} (当前)</option>
                              )}
                            </Select>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={handleFetchModels}
                              disabled={aiModelLoading || !aiConfigEdit.base_url || (!aiConfigEdit.api_key && !aiConfig?.has_api_key)}
                              className="h-10 w-10 shrink-0"
                              title="刷新模型列表"
                            >
                              {aiModelLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={handleTestModel}
                              disabled={aiTesting || !aiConfigEdit.model}
                              className="h-10 whitespace-nowrap"
                            >
                              {aiTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Activity className="h-4 w-4 mr-2" />}
                              测试
                            </Button>
                          </div>
                          {/* Test Result Message - Positioned here for better UX */}
                          {aiTestResult && (
                            <div className={cn(
                              "mt-2 rounded-lg border px-3 py-2 text-xs flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-300",
                              aiTestResult.success ? "bg-emerald-50 border-emerald-100 text-emerald-700" : "bg-rose-50 border-rose-100 text-rose-700"
                            )}>
                              {aiTestResult.success ? <Check className="h-3.5 w-3.5 shrink-0" /> : <X className="h-3.5 w-3.5 shrink-0" />}
                              <span className="font-medium">{aiTestResult.message}</span>
                              {aiTestResult.latency_ms && <span className="opacity-70 ml-auto tabular-nums">{aiTestResult.latency_ms}ms</span>}
                            </div>
                          )}
                        </div>

                        <div className="pt-2 space-y-3">
                          <div className="flex items-start space-x-3 p-3 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                            <input
                              id="enable_ai_ban"
                              type="checkbox"
                              checked={aiConfigEdit.enabled}
                              onChange={(e) => setAiConfigEdit(prev => ({ ...prev, enabled: e.target.checked }))}
                              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <label htmlFor="enable_ai_ban" className="text-sm cursor-pointer select-none">
                              <span className="font-semibold text-slate-800 block mb-0.5">启用 AI 封禁</span>
                              <span className="text-slate-500 leading-snug">使用 AI 实时分析流量并检测可疑行为。</span>
                            </label>
                          </div>

                          <div className="flex items-start space-x-3 p-3 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                            <input
                              id="dry_run_mode"
                              type="checkbox"
                              checked={aiConfigEdit.dry_run}
                              onChange={(e) => setAiConfigEdit(prev => ({ ...prev, dry_run: e.target.checked }))}
                              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <label htmlFor="dry_run_mode" className="text-sm cursor-pointer select-none">
                              <span className="font-semibold text-slate-800 block mb-0.5">试运行模式</span>
                              <span className="text-slate-500 leading-snug">仅分析流量并记录风险，不执行任何封禁操作。</span>
                            </label>
                          </div>

                          <div className="flex items-center gap-3 pt-1">
                            <span className="text-sm font-medium text-slate-700 shrink-0">定时扫描:</span>
                            <Select
                              value={aiConfigEdit.scan_interval_minutes}
                              onChange={(e) => setAiConfigEdit(prev => ({ ...prev, scan_interval_minutes: parseInt(e.target.value) }))}
                              className="w-full h-10 bg-slate-50 border-slate-200 focus:bg-white"
                            >
                              <option value={0}>已禁用</option>
                              <option value={15}>每 15 分钟</option>
                              <option value={30}>每 30 分钟</option>
                              <option value={60}>每 1 小时</option>
                              <option value={120}>每 2 小时</option>
                              <option value={360}>每 6 小时</option>
                              <option value={720}>每 12 小时</option>
                              <option value={1440}>每 24 小时</option>
                            </Select>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end pt-4 border-t border-slate-100 gap-3">
                      <Button variant="outline" onClick={() => setAiConfigExpanded(false)}>
                        取消
                      </Button>
                      <Button onClick={handleSaveAiConfig} disabled={aiSaving} className="bg-blue-600 hover:bg-blue-700 text-white min-w-[100px]">
                        {aiSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                        保存
                      </Button>
                    </div>
                  </div>
                )}
              </Card>

              {/* 状态栏 + 操作栏 */}
              <div className="bg-blue-50/80 border border-blue-100 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div className="text-sm text-blue-900">
                    <div className="font-semibold flex items-center gap-2">
                      当前状态:
                      {aiConfig?.dry_run !== false ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                          试运行模式
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                          正式运行模式
                        </span>
                      )}
                    </div>
                    <div className="text-blue-700/80 mt-1 leading-relaxed">
                      AI 扫描上次运行为 {aiConfig?.scan_interval_minutes ? '自动执行' : '手动执行'}.
                      {(aiConfig?.scan_interval_minutes ?? 0) > 0
                        ? ` 下次计划扫描在 ${(aiConfig?.scan_interval_minutes ?? 0)} 分钟后。`
                        : ' 自动扫描已禁用。'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 w-full md:w-auto">
                  <Button
                    variant="outline"
                    onClick={() => fetchAiSuspiciousUsers(true)}
                    disabled={aiLoading}
                    className="bg-white border-blue-200 text-blue-700 hover:bg-blue-50 flex-1 md:flex-none"
                  >
                    <RefreshCw className={cn("h-4 w-4 mr-2", aiLoading && "animate-spin")} />
                    刷新列表
                  </Button>
                  <Button
                    onClick={handleAiScan}
                    disabled={!aiConfig?.enabled || aiScanning}
                    className="bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 flex-1 md:flex-none"
                  >
                    {aiScanning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Activity className="h-4 w-4 mr-2" />}
                    执行 AI 扫描
                  </Button>
                </div>
              </div>

              {/* Suspicious Users Table */}
              <Card className="rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <CardHeader className="px-6 py-4 border-b border-slate-100 bg-white">
                  <h3 className="font-bold text-lg text-slate-800">可疑用户列表</h3>
                </CardHeader>
                <div className="bg-white overflow-x-auto">
                  {aiLoading ? (
                    <div className="h-64 flex items-center justify-center text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin text-blue-500/50" />
                    </div>
                  ) : aiSuspiciousUsers.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/50 hover:bg-slate-50/50 border-b border-slate-100">
                          <TableHead className="w-[180px] font-semibold text-slate-600">用户</TableHead>
                          <TableHead className="font-semibold text-slate-600">风险标签</TableHead>
                          <TableHead className="text-right font-semibold text-slate-600">RPM</TableHead>
                          <TableHead className="text-right font-semibold text-slate-600">请求数</TableHead>
                          <TableHead className="text-right font-semibold text-slate-600">空回复率</TableHead>
                          <TableHead className="text-right font-semibold text-slate-600">IP 数</TableHead>
                          <TableHead className="text-center font-semibold text-slate-600 w-[120px]">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {aiSuspiciousUsers.map((user) => (
                          <TableRow key={user.user_id} className="hover:bg-slate-50 border-b border-slate-50 last:border-0 transition-colors">
                            <TableCell className="py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-sm border border-slate-200">
                                  {user.username[0]?.toUpperCase() || 'U'}
                                </div>
                                <div className="flex flex-col">
                                  <span className="font-semibold text-slate-900 text-sm">{user.username}</span>
                                  <span className="text-xs text-slate-500">ID: {user.user_id}</span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="py-4">
                              <div className="flex flex-wrap gap-1.5">
                                {user.risk_flags.map((flag) => (
                                  <Badge key={flag} variant="destructive" className="rounded px-2 py-0.5 text-[11px] font-medium border-0 opacity-90">
                                    {RISK_FLAG_LABELS[flag] || flag}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="py-4 text-right font-mono text-sm text-slate-600">{user.rpm}</TableCell>
                            <TableCell className="py-4 text-right font-mono text-sm text-slate-600">{formatNumber(user.total_requests)}</TableCell>
                            <TableCell className="py-4 text-right">
                              <span className={cn(
                                "font-mono text-sm",
                                user.empty_rate >= 80 ? "text-rose-600 font-bold" : "text-slate-600"
                              )}>
                                {user.empty_rate}%
                              </span>
                            </TableCell>
                            <TableCell className="py-4 text-right font-mono text-sm text-slate-600">{user.unique_ips}</TableCell>
                            <TableCell className="py-4">
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                  onClick={() => {
                                    const mockItem: LeaderboardItem = {
                                      user_id: user.user_id,
                                      username: user.username,
                                      user_status: 1,
                                      request_count: user.total_requests,
                                      failure_requests: 0,
                                      failure_rate: user.failure_rate / 100,
                                      quota_used: 0,
                                      prompt_tokens: 0,
                                      completion_tokens: 0,
                                      unique_ips: user.unique_ips,
                                    }
                                    openUserDialog(mockItem, '1h')
                                  }}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                                  onClick={() => handleAiAssess(user.user_id)}
                                  disabled={aiAssessing === user.user_id || !aiConfig?.enabled}
                                >
                                  {aiAssessing === user.user_id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <ShieldBan className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="h-64 flex flex-col items-center justify-center text-muted-foreground bg-slate-50/30">
                      <ShieldCheck className="h-12 w-12 mb-3 text-emerald-500/20" />
                      <p className="font-medium text-slate-500">未发现可疑用户</p>
                      <p className="text-xs text-slate-400 mt-1">系统运行正常</p>
                    </div>
                  )}
                </div>
              </Card>

              {/* AI 评估结果弹窗 */}
              {aiAssessResult && (
                <Card className="rounded-xl shadow-lg border-2 border-primary/20">
                  <CardHeader className="pb-3 border-b bg-primary/5">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Activity className="h-5 w-5 text-primary" />
                        AI 评估结果
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => setAiAssessResult(null)}>
                        关闭
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="text-sm text-muted-foreground">用户:</div>
                      <div className="font-medium">{aiAssessResult.username} (ID: {aiAssessResult.user_id})</div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="rounded-lg border p-3 text-center">
                        <div className={cn(
                          "text-2xl font-bold",
                          aiAssessResult.assessment.risk_score >= 8 ? "text-red-600" :
                            aiAssessResult.assessment.risk_score >= 5 ? "text-amber-600" : "text-green-600"
                        )}>
                          {aiAssessResult.assessment.risk_score}/10
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">风险评分</div>
                      </div>
                      <div className="rounded-lg border p-3 text-center">
                        <div className="text-2xl font-bold">
                          {(aiAssessResult.assessment.confidence * 100).toFixed(0)}%
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">置信度</div>
                      </div>
                      <div className="rounded-lg border p-3 text-center">
                        <div className={cn(
                          "text-lg font-bold",
                          aiAssessResult.assessment.action === 'ban' ? "text-red-600" :
                            aiAssessResult.assessment.action === 'warn' ? "text-amber-600" : "text-green-600"
                        )}>
                          {aiAssessResult.assessment.action === 'ban' ? '建议封禁' :
                            aiAssessResult.assessment.action === 'warn' ? '风险告警' :
                              aiAssessResult.assessment.action === 'monitor' ? '继续观察' : '正常'}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">AI 决策</div>
                      </div>
                    </div>

                    <div className="rounded-lg border p-3 bg-muted/30">
                      <div className="text-xs text-muted-foreground mb-1">AI 分析理由:</div>
                      <div className="text-sm">{aiAssessResult.assessment.reason}</div>
                    </div>

                    {aiAssessResult.assessment.should_ban && (
                      <div className="flex justify-end">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setBanConfirmDialog({
                              open: true,
                              type: 'ban',
                              userId: aiAssessResult.user_id,
                              username: aiAssessResult.username,
                              reason: `[AI建议] ${aiAssessResult.assessment.reason}`,
                              disableTokens: true,
                              enableTokens: false,
                            })
                          }}
                        >
                          <ShieldBan className="h-4 w-4 mr-2" />
                          执行封禁
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* AI 运行逻辑说明弹窗 */}
              <Dialog open={isAiLogicModalOpen} onOpenChange={setIsAiLogicModalOpen}>
                <DialogContent className="max-w-4xl p-0 overflow-hidden border-0 rounded-2xl shadow-2xl bg-white">
                  {/* Header with decorative background */}
                  <div className="bg-slate-50/80 border-b border-slate-100 p-6 pb-5">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-3 text-xl text-slate-800">
                        <div className="p-2.5 bg-blue-600/10 rounded-xl text-blue-600">
                          <Activity className="h-5 w-5" />
                        </div>
                        AI 自动封禁系统运行逻辑
                      </DialogTitle>
                      <DialogDescription className="text-slate-500 ml-1 mt-1">
                        系统基于实时流量特征，通过三个阶段进行智能风控决策。
                      </DialogDescription>
                    </DialogHeader>
                  </div>

                  {/* Body Content - Grid Layout to avoid scrolling */}
                  <div className="p-6 space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                      {/* Stage 1 */}
                      <div className="flex flex-col space-y-3 p-4 rounded-xl border border-slate-100 bg-white shadow-sm hover:shadow-md transition-shadow h-full relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
                          <Globe className="w-16 h-16 text-blue-600" />
                        </div>
                        <h4 className="font-bold text-slate-800 flex items-center gap-2 z-10">
                          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold">1</span>
                          特征筛选
                        </h4>
                        <p className="text-xs text-slate-500 leading-relaxed z-10">
                          系统实时监控并过滤有效流量，仅对满足特定门槛的用户触发评估。
                        </p>
                        <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 space-y-1.5 flex-1 z-10 border border-slate-100/50">
                          <div className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-blue-400"></div>请求量 &ge; 50 (活跃用户)</div>
                          <div className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-orange-400"></div>命中 IP 异常标签</div>
                          <div className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-slate-400"></div>非白名单/VIP 用户</div>
                          <div className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-slate-400"></div>不在 24h 冷却期内</div>
                        </div>
                      </div>

                      {/* Stage 2 */}
                      <div className="flex flex-col space-y-3 p-4 rounded-xl border border-slate-100 bg-white shadow-sm hover:shadow-md transition-shadow h-full relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
                          <Activity className="w-16 h-16 text-purple-600" />
                        </div>
                        <h4 className="font-bold text-slate-800 flex items-center gap-2 z-10">
                          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 text-purple-600 text-xs font-bold">2</span>
                          AI 模型研判
                        </h4>
                        <p className="text-xs text-slate-500 leading-relaxed z-10">
                          将用户的行为指纹发送至大模型，模拟资深风控师进行深度分析。
                        </p>
                        <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 space-y-1.5 flex-1 z-10 border border-slate-100/50">
                          <div className="font-medium text-slate-700 mb-1">分析维度：</div>
                          <div className="grid grid-cols-2 gap-1">
                            <span className="bg-white px-1.5 py-0.5 rounded border text-center">IP 停留时长</span>
                            <span className="bg-white px-1.5 py-0.5 rounded border text-center">跳变频率</span>
                            <span className="bg-white px-1.5 py-0.5 rounded border text-center">模型分布</span>
                            <span className="bg-white px-1.5 py-0.5 rounded border text-center">Token 规律</span>
                          </div>
                        </div>
                      </div>

                      {/* Stage 3 */}
                      <div className="flex flex-col space-y-3 p-4 rounded-xl border border-slate-100 bg-white shadow-sm hover:shadow-md transition-shadow h-full relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
                          <ShieldBan className="w-16 h-16 text-red-600" />
                        </div>
                        <h4 className="font-bold text-slate-800 flex items-center gap-2 z-10">
                          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-600 text-xs font-bold">3</span>
                          决策执行
                        </h4>
                        <p className="text-xs text-slate-500 leading-relaxed z-10">
                          根据 AI 返回的风险评分 (1-10) 和置信度，执行相应的动作。
                        </p>
                        <div className="space-y-2 z-10 flex-1">
                          <div className="flex items-center justify-between p-2 rounded-lg bg-red-50/50 border border-red-100">
                            <span className="font-bold text-xs text-red-700">封禁 (Ban)</span>
                            <span className="text-[10px] text-red-600/80">评分&ge;8 & 置信度&ge;0.8</span>
                          </div>
                          <div className="flex items-center justify-between p-2 rounded-lg bg-amber-50/50 border border-amber-100">
                            <span className="font-bold text-xs text-amber-700">告警 (Warn)</span>
                            <span className="text-[10px] text-amber-600/80">评分&ge;6 或 置信度不足</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Status Banner */}
                    <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm",
                        aiConfig?.dry_run !== false ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"
                      )}>
                        {aiConfig?.dry_run !== false ? <Activity className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-bold text-slate-800">系统当前策略</span>
                          {aiConfig?.dry_run !== false ? (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold border border-amber-200">试运行模式</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold border border-emerald-200">正式运行模式</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 truncate">
                          {aiConfig?.scan_interval_minutes 
                            ? `自动扫描开启中，周期: ${aiConfig?.scan_interval_minutes} 分钟` 
                            : "自动扫描已关闭，仅支持手动触发"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <DialogFooter className="p-6 pt-0 sm:justify-center">
                    <Button 
                      onClick={() => setIsAiLogicModalOpen(false)} 
                      className="w-full sm:w-40 h-10 rounded-full bg-slate-900 hover:bg-slate-800 text-white shadow-lg shadow-slate-900/10 hover:shadow-slate-900/20 transition-all hover:-translate-y-0.5"
                    >
                      我明白了
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

            </div >
          )}

          {/* User IPs Dialog */}
          <Dialog open={userIpsDialogOpen} onOpenChange={setUserIpsDialogOpen}>
            <DialogContent className="max-w-2xl w-full max-h-[80vh] flex flex-col p-0 overflow-hidden rounded-xl border-border/50 shadow-2xl">
              <DialogHeader className="p-5 border-b bg-muted/10 shrink-0">
                <div className="flex justify-between items-center pr-6">
                  <div>
                    <DialogTitle className="text-xl flex items-center gap-2">
                      <Globe className="h-5 w-5 text-blue-500" />
                      用户 IP 访问列表
                    </DialogTitle>
                    <DialogDescription className="mt-1 flex items-center gap-2">
                      <span className="font-semibold text-foreground">{selectedUserForIps?.username}</span>
                      <span className="text-muted-foreground">(ID: {selectedUserForIps?.id})</span>
                      <Badge variant="outline" className="ml-2">{WINDOW_LABELS[ipWindow]}</Badge>
                    </DialogDescription>
                  </div>
                  <Badge variant="secondary" className="px-3 py-1 font-mono">{userIpsData.length} IPs</Badge>
                </div>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto min-h-0 bg-background">
                {userIpsLoading ? (
                  <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                    <Loader2 className="h-8 w-8 mb-3 animate-spin text-primary/40" />
                    <p className="text-sm">正在检索所有访问 IP...</p>
                  </div>
                ) : userIpsData.length > 0 ? (
                  <div className="p-0">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10 border-b">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="py-2 text-xs uppercase">IP 地址</TableHead>
                          <TableHead className="py-2 text-xs uppercase text-right">请求数</TableHead>
                          <TableHead className="py-2 text-xs uppercase text-right">首次访问</TableHead>
                          <TableHead className="py-2 text-xs uppercase text-right">最近访问</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {userIpsData.map((ip, idx) => (
                          <TableRow key={ip.ip} className="hover:bg-muted/20 transition-colors">
                            <TableCell className="py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-muted-foreground w-5">{idx + 1}</span>
                                <code className="text-xs font-mono bg-muted/60 px-2 py-0.5 rounded border border-border/40 text-foreground">{ip.ip}</code>
                              </div>
                            </TableCell>
                            <TableCell className="py-3 text-right">
                              <div className="flex flex-col items-end">
                                <span className="text-sm font-bold tabular-nums text-primary">
                                  {formatNumber(ip.request_count)}
                                </span>
                                <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-tight opacity-50">Requests</span>
                              </div>
                            </TableCell>
                            <TableCell className="py-3 text-right text-[11px] text-muted-foreground tabular-nums">
                              {formatTime(ip.first_seen)}
                            </TableCell>
                            <TableCell className="py-3 text-right text-[11px] text-muted-foreground tabular-nums">
                              {formatTime(ip.last_seen)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                    <Globe className="h-10 w-10 mb-2 opacity-10" />
                    <p>未发现该用户的访问记录</p>
                  </div>
                )}
              </div>
              <DialogFooter className="p-4 border-t bg-muted/5 sm:justify-start">
                <div className="text-[10px] text-muted-foreground italic">
                  * 列表按请求量排序，显示该用户在所选时间段内的所有唯一访问 IP 及其首末次访问记录。
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="max-w-2xl w-full max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden rounded-xl border-border/50 shadow-2xl">
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

              <div className="flex-1 overflow-y-auto p-5 min-h-0 bg-background">
                {analysisLoading ? (
                  <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                    <Loader2 className="h-8 w-8 mb-4 animate-spin text-primary/50" />
                    <p>正在分析海量日志...</p>
                  </div>
                ) : analysis ? (
                  <div className="space-y-6">
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
                            <AlertTriangle className="w-3 h-3 mr-1" /> {RISK_FLAG_LABELS[f] || f}
                          </Badge>
                        ))
                      ) : (
                        <Badge variant="success" className="px-3 py-1 bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300">
                          <ShieldCheck className="w-3 h-3 mr-1" /> 无明显异常
                        </Badge>
                      )}
                    </div>

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

                    {/* IP 切换分析 */}
                    {analysis.risk.ip_switch_analysis && analysis.risk.ip_switch_analysis.switch_count > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                          IP 切换分析
                          {(analysis.risk.ip_switch_analysis.rapid_switch_count >= 3 || analysis.risk.ip_switch_analysis.avg_ip_duration < 30) && (
                            <Badge variant="destructive" className="text-xs px-1.5 py-0">异常</Badge>
                          )}
                        </h4>

                        {/* 统计卡片 */}
                        <div className="grid grid-cols-3 gap-2">
                          <div className="rounded-lg border bg-muted/30 p-2.5 text-center">
                            <div className="text-lg font-bold">{analysis.risk.ip_switch_analysis.switch_count}</div>
                            <div className="text-xs text-muted-foreground">切换次数</div>
                          </div>
                          <div className={cn(
                            "rounded-lg border p-2.5 text-center",
                            analysis.risk.ip_switch_analysis.rapid_switch_count >= 3
                              ? "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
                              : "bg-muted/30"
                          )}>
                            <div className={cn(
                              "text-lg font-bold",
                              analysis.risk.ip_switch_analysis.rapid_switch_count >= 3 && "text-red-600 dark:text-red-400"
                            )}>
                              {analysis.risk.ip_switch_analysis.rapid_switch_count}
                            </div>
                            <div className="text-xs text-muted-foreground">快速切换 (60s内)</div>
                          </div>
                          <div className={cn(
                            "rounded-lg border p-2.5 text-center",
                            analysis.risk.ip_switch_analysis.avg_ip_duration < 30 && analysis.risk.ip_switch_analysis.switch_count >= 3
                              ? "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
                              : "bg-muted/30"
                          )}>
                            <div className={cn(
                              "text-lg font-bold",
                              analysis.risk.ip_switch_analysis.avg_ip_duration < 30 && analysis.risk.ip_switch_analysis.switch_count >= 3 && "text-red-600 dark:text-red-400"
                            )}>
                              {analysis.risk.ip_switch_analysis.avg_ip_duration}s
                            </div>
                            <div className="text-xs text-muted-foreground">平均停留</div>
                          </div>
                        </div>

                        {/* 切换记录 */}
                        {analysis.risk.ip_switch_analysis.switch_details.length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-semibold text-muted-foreground">最近切换记录 (显示 IP 跳变逻辑):</div>
                              <div className="text-xs text-muted-foreground italic flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" /> 间隔越短，共享账号可能性越大
                              </div>
                            </div>
                            <div className="rounded-lg border overflow-hidden shadow-sm">
                              <div className="bg-muted/30 px-3 py-2 flex text-xs uppercase tracking-wider font-bold text-muted-foreground border-b border-border/60">
                                <div className="w-[120px]">切换时间</div>
                                <div className="flex-1 px-2 text-center">源 IP 地址</div>
                                <div className="w-8"></div>
                                <div className="flex-1 px-2 text-center">目标 IP 地址</div>
                                <div className="w-24 text-right">切换间隔</div>
                              </div>
                              <div className="max-h-[220px] overflow-y-auto overflow-x-hidden bg-background">
                                {analysis.risk.ip_switch_analysis.switch_details.slice(-12).reverse().map((detail, idx) => (
                                  <div
                                    key={idx}
                                    className={cn(
                                      "flex items-center px-3 py-2.5 text-xs border-b last:border-b-0 hover:bg-muted/5 transition-colors group",
                                      detail.interval <= 60 ? "bg-red-50/40 dark:bg-red-900/10" : "bg-background"
                                    )}
                                  >
                                    <div className="w-[120px] text-muted-foreground font-mono tabular-nums">
                                      {formatTime(detail.time)}
                                    </div>
                                    <div className="flex-1 px-2 flex justify-center">
                                      <code className="px-1.5 py-0.5 rounded bg-muted/50 border border-border/80 font-mono text-xs text-foreground inline-block whitespace-nowrap">
                                        {detail.from_ip}
                                      </code>
                                    </div>
                                    <div className="w-8 flex justify-center">
                                      <span className="text-muted-foreground/50 group-hover:text-primary transition-colors">→</span>
                                    </div>
                                    <div className="flex-1 px-2 flex justify-center">
                                      <code className="px-1.5 py-0.5 rounded bg-muted/50 border border-border/80 font-mono text-xs text-foreground inline-block whitespace-nowrap">
                                        {detail.to_ip}
                                      </code>
                                    </div>
                                    <div className="w-24 text-right">
                                      <Badge
                                        variant={detail.interval <= 60 ? "destructive" : "outline"}
                                        className={cn(
                                          "px-2 py-0.5 h-6 text-xs font-mono",
                                          detail.interval > 60 && "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400"
                                        )}
                                      >
                                        {detail.interval <= 60 ? <AlertTriangle className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
                                        {detail.interval}s
                                      </Badge>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

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

          <Dialog open={banConfirmDialog.open} onOpenChange={(open) => setBanConfirmDialog(prev => ({ ...prev, open }))}>
            <DialogContent className="max-w-[600px] w-full rounded-xl gap-6 p-6 overflow-visible">
              <DialogHeader className="space-y-2">
                <DialogTitle className="flex items-center gap-2 text-lg">
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
                <DialogDescription className="text-sm">
                  {banConfirmDialog.type === 'ban'
                    ? <span className="block break-words">即将封禁用户 <span className="font-medium text-foreground">{banConfirmDialog.username}</span></span>
                    : <span className="block break-words">即将解封用户 <span className="font-medium text-foreground">{banConfirmDialog.username}</span></span>}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    {banConfirmDialog.type === 'ban' ? '请选择封禁原因' : '请选择解封原因'}
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

                <label className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none bg-muted/30 p-2 rounded-md border border-transparent hover:border-border">
                  <input
                    type="checkbox"
                    checked={banConfirmDialog.type === 'ban' ? banConfirmDialog.disableTokens : banConfirmDialog.enableTokens}
                    onChange={(e) => banConfirmDialog.type === 'ban'
                      ? setBanConfirmDialog(prev => ({ ...prev, disableTokens: e.target.checked }))
                      : setBanConfirmDialog(prev => ({ ...prev, enableTokens: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  {banConfirmDialog.type === 'ban' ? '同时禁用该用户所有令牌' : '同时启用该用户所有令牌'}
                </label>
              </div>

              <DialogFooter className="gap-2 sm:gap-0 mt-2">
                <Button
                  variant="ghost"
                  onClick={() => setBanConfirmDialog(prev => ({ ...prev, open: false }))}
                  disabled={mutating}
                  className="flex-1 sm:flex-none"
                >
                  取消
                </Button>
                {banConfirmDialog.type === 'ban' ? (
                  <Button
                    variant="destructive"
                    disabled={mutating}
                    className="flex-1 sm:flex-none min-w-[100px]"
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
                    className="bg-green-600 hover:bg-green-700 flex-1 sm:flex-none min-w-[100px]"
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
        </div >
      )
      }

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { RefreshCw, ShieldBan, ShieldCheck, Loader2, Activity, AlertTriangle, Clock, Globe, ChevronDown, Ban, Eye, EyeOff, Settings, Check, X, Search, Timer, Filter, Cpu, Tag } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Select } from './ui/select'
import { Input } from './ui/input'
import { cn, isCloudflareIp } from '../lib/utils'
import { UserAnalysisDialog, BAN_REASONS, UNBAN_REASONS, RISK_FLAG_LABELS } from './UserAnalysisDialog'

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

const WINDOW_LABELS: Record<WindowKey, string> = { '1h': '1小时内', '3h': '3小时内', '6h': '6小时内', '12h': '12小时内', '24h': '24小时内', '3d': '3天内', '7d': '7天内' }
const SORT_LABELS: Record<SortKey, string> = { requests: '请求次数', quota: '额度消耗', failure_rate: '失败率' }

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
    <Badge variant="outline" className={cn("font-medium px-2.5 py-0.5 h-6 text-xs", getReasonStyle(reason))}>
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

function formatCountdown(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`
}

const getIntervalLabel = (interval: number) => {
  switch (interval) {
    case 0: return '关闭'
    case 10: return '10秒'
    case 30: return '30秒'
    case 60: return '1分钟'
    case 120: return '2分钟'
    case 300: return '5分钟'
    case 600: return '10分钟'
    default: return '关闭'
  }
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

// URL 路径映射 (History API)
const VIEW_PATH_MAP: Record<string, 'leaderboards' | 'banned_list' | 'ip_monitoring' | 'audit_logs' | 'ai_ban'> = {
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

const PATH_VIEW_MAP: Record<string, string> = {
  'leaderboards': '',
  'ip_monitoring': 'ip',
  'banned_list': 'banned',
  'audit_logs': 'audit',
  'ai_ban': 'ai',
}

function getInitialView(): 'leaderboards' | 'banned_list' | 'ip_monitoring' | 'audit_logs' | 'ai_ban' {
  const pathname = window.location.pathname
  // 匹配 /risk, /risk/, /risk/audit 等格式
  const match = pathname.match(/\/risk(?:\/(\w+))?/)
  if (match && match[1]) {
    return VIEW_PATH_MAP[match[1]] || 'leaderboards'
  }
  // 兼容旧的 hash 路由，自动迁移
  const hash = window.location.hash
  const hashMatch = hash.match(/#risk(?:[/-](\w+))?/)
  if (hashMatch && hashMatch[1]) {
    const view = VIEW_PATH_MAP[hashMatch[1]] || 'leaderboards'
    const subPath = PATH_VIEW_MAP[view]
    const newPath = subPath ? `/risk/${subPath}` : '/risk'
    window.history.replaceState(null, '', newPath)
    return view
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
  const [refreshing, setRefreshing] = useState<WindowKey | 'all' | null>(null)  // 追踪哪个窗口正在刷新

  // 刷新间隔状态 - 从 localStorage 恢复，支持持久化
  const LEADERBOARD_REFRESH_KEY = 'risk_leaderboard_refresh_interval'
  const IP_REFRESH_KEY = 'risk_ip_refresh_interval'
  const [refreshInterval, setRefreshInterval] = useState(() => {
    const saved = localStorage.getItem(LEADERBOARD_REFRESH_KEY)
    return saved ? parseInt(saved, 10) : 60
  })
  const [countdown, setCountdown] = useState(() => {
    const saved = localStorage.getItem(LEADERBOARD_REFRESH_KEY)
    return saved ? parseInt(saved, 10) : 60
  })
  const [systemScale, setSystemScale] = useState<string>('')  // 系统规模

  // IP 监控刷新间隔
  const [ipRefreshInterval, setIpRefreshInterval] = useState(() => {
    const saved = localStorage.getItem(IP_REFRESH_KEY)
    return saved ? parseInt(saved, 10) : 60
  })
  const [ipCountdown, setIpCountdown] = useState(() => {
    const saved = localStorage.getItem(IP_REFRESH_KEY)
    return saved ? parseInt(saved, 10) : 60
  })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [selected, setSelected] = useState<{ item: LeaderboardItem; window: WindowKey; endTime?: number } | null>(null)
  const [mutating, setMutating] = useState(false)

  // 封禁列表状态
  const [bannedUsers, setBannedUsers] = useState<BannedUserItem[]>([])
  const [bannedLoading, setBannedLoading] = useState(false)
  const [bannedPage, setBannedPage] = useState(1)
  const [bannedTotalPages, setBannedTotalPages] = useState(1)
  const [bannedTotal, setBannedTotal] = useState(0)
  const [bannedSearch, setBannedSearch] = useState('')
  const [showIntervalDropdown, setShowIntervalDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowIntervalDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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
    displayName?: string
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
    whitelist_count?: number
    custom_prompt?: string
    default_prompt?: string
    whitelist_ips?: string[]
    blacklist_ips?: string[]
    excluded_models?: string[]
    excluded_groups?: string[]
    api_health?: {
      suspended: boolean
      consecutive_failures: number
      last_error: string | null
      cooldown_remaining: number
    }
  } | null>(null)

  // 排除模型/分组配置
  const [availableGroups, setAvailableGroups] = useState<Array<{ group_name: string; requests: number }>>([])
  const [availableModelsForExclude, setAvailableModelsForExclude] = useState<Array<{ model_name: string; requests: number }>>([])
  const [excludeConfigLoading, setExcludeConfigLoading] = useState(false)

  // AI 审查记录
  const [aiAuditLogs, setAiAuditLogs] = useState<Array<{
    id: number
    scan_id: string
    status: string
    window: string
    total_scanned: number
    total_processed: number
    banned_count: number
    warned_count: number
    skipped_count: number
    error_count: number
    dry_run: boolean
    elapsed_seconds: number
    error_message: string
    details: any
    created_at: number
  }>>([])
  const [aiAuditLogsTotal, setAiAuditLogsTotal] = useState(0)
  const [aiAuditLogsLoading, setAiAuditLogsLoading] = useState(false)
  const [aiAuditLogsPage, setAiAuditLogsPage] = useState(1)
  const [aiAuditLogsLimit] = useState(10)

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
    model?: string
    test_message?: string
    response?: string
    usage?: { prompt_tokens: number; completion_tokens: number }
  } | null>(null)
  const [aiTesting, setAiTesting] = useState(false)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiConfigExpanded, setAiConfigExpanded] = useState(false)
  const [isAiLogicModalOpen, setIsAiLogicModalOpen] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [selectedAuditLog, setSelectedAuditLog] = useState<{
    id: number
    scan_id: string
    status: string
    window: string
    total_scanned: number
    total_processed: number
    banned_count: number
    warned_count: number
    skipped_count: number
    error_count: number
    dry_run: boolean
    elapsed_seconds: number
    error_message: string
    details: any
    created_at: number
  } | null>(null)

  // 白名单管理状态
  const [whitelistModalOpen, setWhitelistModalOpen] = useState(false)
  const [whitelist, setWhitelist] = useState<Array<{
    user_id: number
    username: string
    display_name: string
    role: number
    is_admin: boolean
  }>>([])
  const [whitelistLoading, setWhitelistLoading] = useState(false)
  const [whitelistSearchQuery, setWhitelistSearchQuery] = useState('')
  const [whitelistSearchResults, setWhitelistSearchResults] = useState<Array<{
    user_id: number
    username: string
    display_name: string
    role: number
    is_admin: boolean
    in_whitelist: boolean
  }>>([])
  const [whitelistSearching, setWhitelistSearching] = useState(false)

  // 自定义提示词弹窗状态
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const [promptContent, setPromptContent] = useState('')
  const [promptSaving, setPromptSaving] = useState(false)
  const [whitelistIpsInput, setWhitelistIpsInput] = useState('')
  const [blacklistIpsInput, setBlacklistIpsInput] = useState('')
  // 排除模型/分组输入状态
  const [excludedModelsInput, setExcludedModelsInput] = useState<string[]>([])
  const [excludedGroupsInput, setExcludedGroupsInput] = useState<string[]>([])

  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  // 获取系统规模设置，自动调整刷新间隔（仅当用户没有手动设置时）
  const fetchSystemScale = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/system/scale`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success && res.data?.settings) {
        const settings = res.data.settings
        const interval = settings.frontend_refresh_interval || 60
        setSystemScale(settings.description || '')

        // 只有在用户没有手动设置过时，才使用系统推荐值
        const savedLeaderboard = localStorage.getItem(LEADERBOARD_REFRESH_KEY)
        const savedIp = localStorage.getItem(IP_REFRESH_KEY)

        if (!savedLeaderboard) {
          setRefreshInterval(interval)
          setCountdown(interval)
        }
        if (!savedIp) {
          setIpRefreshInterval(interval)
          setIpCountdown(interval)
        }

        console.log(`系统规模: ${settings.description}, 推荐刷新间隔: ${interval}秒`)
      }
    } catch (e) {
      console.error('Failed to fetch system scale:', e)
    }
  }, [apiUrl, getAuthHeaders])

  // 组件挂载时获取系统规模设置
  useEffect(() => {
    fetchSystemScale()
  }, [])  // 只在挂载时执行一次

  // 保存刷新间隔到 localStorage
  const handleRefreshIntervalChange = useCallback((val: number) => {
    setRefreshInterval(val)
    setCountdown(val)
    if (val > 0) {
      localStorage.setItem(LEADERBOARD_REFRESH_KEY, val.toString())
      const label = val >= 60 ? `${val / 60}分钟` : `${val}秒`
      showToast('success', `排行榜自动刷新已设置为 ${label}`)
    } else {
      localStorage.removeItem(LEADERBOARD_REFRESH_KEY)
      showToast('info', '排行榜自动刷新已关闭')
    }
  }, [showToast])

  const handleIpRefreshIntervalChange = useCallback((val: number) => {
    setIpRefreshInterval(val)
    setIpCountdown(val)
    if (val > 0) {
      localStorage.setItem(IP_REFRESH_KEY, val.toString())
      const label = val >= 60 ? `${val / 60}分钟` : `${val}秒`
      showToast('success', `IP监控自动刷新已设置为 ${label}`)
    } else {
      localStorage.removeItem(IP_REFRESH_KEY)
      showToast('info', 'IP监控自动刷新已关闭')
    }
  }, [showToast])

  // 使用 ref 存储 refreshInterval，让 fetchLeaderboards 能访问最新值
  const refreshIntervalRef = useRef(refreshInterval)
  useEffect(() => {
    refreshIntervalRef.current = refreshInterval
  }, [refreshInterval])

  // IP 刷新间隔 ref
  const ipRefreshIntervalRef = useRef(ipRefreshInterval)
  useEffect(() => {
    ipRefreshIntervalRef.current = ipRefreshInterval
  }, [ipRefreshInterval])

  const fetchLeaderboards = useCallback(async (showSuccessToast = false, forceRefresh = false, singleWindow?: WindowKey) => {
    try {
      const windowsParam = singleWindow ? singleWindow : allWindows.join(',')
      const noCache = forceRefresh ? '&no_cache=true' : ''
      const response = await fetch(`${apiUrl}/api/risk/leaderboards?windows=${windowsParam}&limit=10&sort_by=${sortBy}${noCache}`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        const windowsData = res.data?.windows || {}
        if (singleWindow) {
          // 单窗口刷新：只更新该窗口的数据
          setData(prev => ({
            ...prev,
            [singleWindow]: windowsData[singleWindow] || [],
          }))
        } else {
          // 全量刷新
          setData({
            '1h': windowsData['1h'] || [],
            '3h': windowsData['3h'] || [],
            '6h': windowsData['6h'] || [],
            '12h': windowsData['12h'] || [],
            '24h': windowsData['24h'] || [],
            '3d': windowsData['3d'] || [],
            '7d': windowsData['7d'] || [],
          })
        }
        setGeneratedAt(res.data?.generated_at || 0)
        setCountdown(refreshIntervalRef.current)  // 使用 ref 获取最新的刷新间隔
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
      const searchParam = bannedSearch ? `&search=${encodeURIComponent(bannedSearch)}` : ''
      const response = await fetch(`${apiUrl}/api/users/banned?page=${page}&page_size=50${searchParam}`, { headers: getAuthHeaders() })
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
  }, [apiUrl, getAuthHeaders, showToast, bannedSearch])

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

  const fetchIPData = useCallback(async (showSuccessToast = false, resetPage = false, forceRefresh = false) => {
    setIpLoading(true)
    // Only reset page when explicitly requested (e.g., window change), not on refresh
    if (resetPage) {
      setIpPage({ shared: 1, tokens: 1, users: 1 })
    }
    const noCache = forceRefresh ? '&no_cache=true' : ''
    try {
      const [statsRes, sharedRes, tokensRes, usersRes] = await Promise.all([
        fetch(`${apiUrl}/api/ip/stats`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/ip/shared-ips?window=${ipWindow}&min_tokens=2&limit=200${noCache}`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/ip/multi-ip-tokens?window=${ipWindow}&min_ips=2&limit=200${noCache}`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/ip/multi-ip-users?window=${ipWindow}&min_ips=3&limit=200${noCache}`, { headers: getAuthHeaders() }),
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

  // 获取可用分组和模型列表（用于排除配置）
  const fetchExcludeOptions = useCallback(async () => {
    setExcludeConfigLoading(true)
    try {
      const [groupsRes, modelsRes] = await Promise.all([
        fetch(`${apiUrl}/api/ai-ban/available-groups`, { headers: getAuthHeaders() }),
        fetch(`${apiUrl}/api/ai-ban/available-models-for-exclude`, { headers: getAuthHeaders() }),
      ])
      const groupsData = await groupsRes.json()
      const modelsData = await modelsRes.json()
      if (groupsData.success) {
        setAvailableGroups(groupsData.data?.items || [])
      }
      if (modelsData.success) {
        setAvailableModelsForExclude(modelsData.data?.items || [])
      }
    } catch (e) {
      console.error('Failed to fetch exclude options:', e)
    } finally {
      setExcludeConfigLoading(false)
    }
  }, [apiUrl, getAuthHeaders])

  // 白名单相关函数
  const fetchWhitelist = useCallback(async () => {
    setWhitelistLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/ai-ban/whitelist`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        setWhitelist(res.data?.items || [])
      }
    } catch (e) {
      console.error('Failed to fetch whitelist:', e)
    } finally {
      setWhitelistLoading(false)
    }
  }, [apiUrl, getAuthHeaders])

  const searchWhitelistUser = async (query: string) => {
    if (!query.trim()) {
      setWhitelistSearchResults([])
      return
    }
    setWhitelistSearching(true)
    try {
      const response = await fetch(`${apiUrl}/api/ai-ban/whitelist/search?q=${encodeURIComponent(query)}`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        setWhitelistSearchResults(res.data || [])
      }
    } catch (e) {
      console.error('Failed to search user:', e)
    } finally {
      setWhitelistSearching(false)
    }
  }

  const addToWhitelist = async (userId: number) => {
    try {
      const response = await fetch(`${apiUrl}/api/ai-ban/whitelist/add`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ user_id: userId }),
      })
      const res = await response.json()
      if (res.success) {
        showToast('success', '已添加到白名单')
        fetchWhitelist()
        fetchAiConfig()  // 更新白名单计数
        // 更新搜索结果中的状态
        setWhitelistSearchResults(prev => prev.map(u =>
          u.user_id === userId ? { ...u, in_whitelist: true } : u
        ))
      } else {
        showToast('error', res.message || '添加失败')
      }
    } catch (e) {
      console.error('Failed to add to whitelist:', e)
      showToast('error', '添加失败')
    }
  }

  const removeFromWhitelist = async (userId: number) => {
    try {
      const response = await fetch(`${apiUrl}/api/ai-ban/whitelist/remove`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ user_id: userId }),
      })
      const res = await response.json()
      if (res.success) {
        showToast('success', '已从白名单移除')
        fetchWhitelist()
        fetchAiConfig()  // 更新白名单计数
        // 更新搜索结果中的状态
        setWhitelistSearchResults(prev => prev.map(u =>
          u.user_id === userId ? { ...u, in_whitelist: false } : u
        ))
      } else {
        showToast('error', res.message || '移除失败')
      }
    } catch (e) {
      console.error('Failed to remove from whitelist:', e)
      showToast('error', '移除失败')
    }
  }

  // ... (其他状态)

  const fetchAiAuditLogs = useCallback(async (showSuccessToast = false, page = 1) => {
    setAiAuditLogsLoading(true)
    try {
      const offset = (page - 1) * aiAuditLogsLimit
      const response = await fetch(`${apiUrl}/api/ai-ban/audit-logs?limit=${aiAuditLogsLimit}&offset=${offset}`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        setAiAuditLogs(res.data?.items || [])
        setAiAuditLogsTotal(res.data?.total || 0)
        if (showSuccessToast) showToast('success', '已刷新')
      }
    } catch (e) {
      console.error('Failed to fetch AI audit logs:', e)
    } finally {
      setAiAuditLogsLoading(false)
    }
  }, [apiUrl, getAuthHeaders, showToast, aiAuditLogsLimit])

  // 当页码改变时重新获取数据
  useEffect(() => {
    if (view === 'ai_ban') {
      fetchAiAuditLogs(false, aiAuditLogsPage)
    }
  }, [aiAuditLogsPage, view, fetchAiAuditLogs])

  const handleClearAuditLogs = async () => {
    setConfirmDialog({
      open: true,
      title: '清空审查记录',
      description: '确定要清空所有 AI 审查记录吗？此操作不可恢复。',
      confirmText: '清空',
      variant: 'destructive',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }))
        try {
          const response = await fetch(`${apiUrl}/api/ai-ban/audit-logs`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
          })
          const res = await response.json()
          if (res.success) {
            showToast('success', res.message || '已清空记录')
            fetchAiAuditLogs(false, 1)
            setAiAuditLogsPage(1)
          } else {
            showToast('error', res.message || '清空失败')
          }
        } catch (e) {
          console.error('Failed to clear audit logs:', e)
          showToast('error', '清空失败')
        }
      }
    })
  }

  const handleResetApiHealth = async () => {
    try {
      const response = await fetch(`${apiUrl}/api/ai-ban/reset-api-health`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      const res = await response.json()
      if (res.success) {
        setAiConfig(res.data)
        showToast('success', 'API 健康状态已重置')
      } else {
        showToast('error', res.message || '重置失败')
      }
    } catch (e) {
      console.error('Failed to reset API health:', e)
      showToast('error', '重置失败')
    }
  }

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
  const handleFetchModels = async (forceRefresh: boolean = false) => {
    // 如果没有填写新的 api_key，但已经保存过配置，则允许获取模型列表
    const hasApiKey = aiConfigEdit.api_key || aiConfig?.has_api_key
    if (!aiConfigEdit.base_url || !hasApiKey) {
      showToast('error', '请先填写 API 地址和 API Key')
      return
    }
    setAiModelLoading(true)
    if (forceRefresh) {
      setAiModels([])  // 强制刷新时清空列表
    }
    try {
      const response = await fetch(`${apiUrl}/api/ai-ban/models`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          base_url: aiConfigEdit.base_url,
          api_key: aiConfigEdit.api_key || undefined,  // 不传则使用已保存的
          force_refresh: forceRefresh,  // 是否强制刷新缓存
        }),
      })
      const res = await response.json()
      if (res.success) {
        setAiModels(res.models || [])
        showToast('success', res.message)
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

      // 8秒后自动清除测试结果（显示发送和回复内容需要更多阅读时间）
      setTimeout(() => {
        setAiTestResult(null)
      }, 8000)
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

  // 打开提示词编辑弹窗
  const handleOpenPromptDialog = () => {
    // 优先使用自定义提示词，否则使用默认提示词
    setPromptContent(aiConfig?.custom_prompt || aiConfig?.default_prompt || '')
    // 加载IP白名单和黑名单（每行一个IP）
    setWhitelistIpsInput((aiConfig?.whitelist_ips || []).join('\n'))
    setBlacklistIpsInput((aiConfig?.blacklist_ips || []).join('\n'))
    // 加载排除模型和分组配置
    setExcludedModelsInput(aiConfig?.excluded_models || [])
    setExcludedGroupsInput(aiConfig?.excluded_groups || [])
    // 获取可选的模型和分组列表
    fetchExcludeOptions()
    setPromptDialogOpen(true)
  }

  // 保存自定义提示词和IP配置
  const handleSavePrompt = async () => {
    setPromptSaving(true)
    try {
      // 解析IP列表（每行一个，过滤空行）
      const whitelistIps = whitelistIpsInput.split('\n').map(ip => ip.trim()).filter(ip => ip)
      const blacklistIps = blacklistIpsInput.split('\n').map(ip => ip.trim()).filter(ip => ip)

      const response = await fetch(`${apiUrl}/api/ai-ban/config`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          custom_prompt: promptContent,
          whitelist_ips: whitelistIps,
          blacklist_ips: blacklistIps,
          excluded_models: excludedModelsInput,
          excluded_groups: excludedGroupsInput,
        }),
      })
      const res = await response.json()
      if (res.success) {
        showToast('success', '配置已保存')
        setAiConfig(res.data)
        setPromptDialogOpen(false)
      } else {
        showToast('error', res.detail || res.message || '保存失败')
      }
    } catch (e) {
      console.error('Failed to save prompt:', e)
      showToast('error', '保存配置失败')
    } finally {
      setPromptSaving(false)
    }
  }

  // 重置为默认提示词
  const handleResetPrompt = () => {
    setPromptContent(aiConfig?.default_prompt || '')
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

  // 配置加载后自动获取模型列表（使用缓存）
  useEffect(() => {
    if (aiConfig?.base_url && aiConfig?.has_api_key && aiModels.length === 0) {
      // 使用缓存获取模型列表，不强制刷新
      const fetchModelsFromCache = async () => {
        try {
          const response = await fetch(`${apiUrl}/api/ai-ban/models`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
              base_url: aiConfig.base_url,
              force_refresh: false,
            }),
          })
          const res = await response.json()
          if (res.success) {
            setAiModels(res.models || [])
          }
        } catch (e) {
          console.error('Failed to fetch models from cache:', e)
        }
      }
      fetchModelsFromCache()
    }
  }, [aiConfig?.base_url, aiConfig?.has_api_key, apiUrl, getAuthHeaders])

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

  const openUserDialog = (item: LeaderboardItem, window: WindowKey, endTime?: number) => {
    setSelected({ item, window, endTime })
    setDialogOpen(true)
  }

  useEffect(() => {
    const subPath = PATH_VIEW_MAP[view] || ''
    const newPath = subPath ? `/risk/${subPath}` : '/risk'
    if (window.location.pathname !== newPath) {
      window.history.pushState(null, '', newPath)
    }
  }, [view])

  useEffect(() => {
    const handlePopState = () => {
      const newView = getInitialView()
      setView(newView)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
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

  // 使用 ref 存储 fetch 函数，避免 useEffect 依赖变化导致重复请求
  const fetchFunctionsRef = useRef({
    fetchLeaderboards,
    fetchBanRecords,
    fetchBannedUsers,
    fetchIPData,
    fetchAiConfig,
    fetchAiSuspiciousUsers,
    fetchAiAuditLogs,
  })

  // 更新 ref 中的函数引用
  useEffect(() => {
    fetchFunctionsRef.current = {
      fetchLeaderboards,
      fetchBanRecords,
      fetchBannedUsers,
      fetchIPData,
      fetchAiConfig,
      fetchAiSuspiciousUsers,
      fetchAiAuditLogs,
    }
  })

  useEffect(() => {
    // 只在 view 变化时触发数据加载，使用 ref 避免函数引用变化导致重复请求
    const fns = fetchFunctionsRef.current
    if (view === 'leaderboards') fns.fetchLeaderboards()
    if (view === 'banned_list') fns.fetchBannedUsers(1)
    if (view === 'audit_logs') fns.fetchBanRecords(1)
    if (view === 'ip_monitoring') fns.fetchIPData(false, true)  // Reset page on view change
    if (view === 'ai_ban') {
      fns.fetchAiConfig()
      fns.fetchAiSuspiciousUsers()
      fns.fetchAiAuditLogs()
    }
  }, [view])  // 只依赖 view，避免函数引用变化导致重复请求

  // sortBy 变化时刷新排行榜数据
  const sortByRef = useRef(sortBy)
  useEffect(() => {
    // 跳过首次渲染
    if (sortByRef.current === sortBy) return
    sortByRef.current = sortBy
    if (view === 'leaderboards') {
      fetchFunctionsRef.current.fetchLeaderboards()
    }
  }, [sortBy, view])

  useEffect(() => {
    if (view === 'ip_monitoring') fetchFunctionsRef.current.fetchIPData(false, true)  // Reset page on window change
  }, [ipWindow, view])

  useEffect(() => {
    if (view !== 'leaderboards') return
    if (refreshInterval === 0) return  // 0 表示关闭自动刷新
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchFunctionsRef.current.fetchLeaderboards()
          return refreshIntervalRef.current
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [view, refreshInterval])

  // IP 监控自动刷新定时器
  useEffect(() => {
    if (view !== 'ip_monitoring') return
    if (ipRefreshInterval === 0) return  // 0 表示关闭自动刷新
    const interval = setInterval(() => {
      setIpCountdown((prev) => {
        if (prev <= 1) {
          fetchFunctionsRef.current.fetchIPData(false, false)
          return ipRefreshIntervalRef.current
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [view, ipRefreshInterval])

  const handleRefresh = async (window?: WindowKey) => {
    setRefreshing(window || 'all')
    await fetchLeaderboards(true, true, window)  // showToast=true, forceRefresh=true, singleWindow
    setRefreshing(null)
  }

  const handleRefreshRecords = async () => {
    setRecordsRefreshing(true)
    await fetchBanRecords(recordsPage, true)
    setRecordsRefreshing(false)
  }

  // 刷新所有 IP 数据
  const handleRefreshIP = async () => {
    setIpRefreshing(prev => ({ ...prev, all: true }))
    await fetchIPData(true, false, true)  // showToast=true, resetPage=false, forceRefresh=true
    setIpRefreshing(prev => ({ ...prev, all: false }))
  }

  // 单独刷新共享 IP 列表
  const handleRefreshSharedIps = async () => {
    setIpRefreshing(prev => ({ ...prev, shared: true }))
    try {
      const response = await fetch(`${apiUrl}/api/ip/shared-ips?window=${ipWindow}&min_tokens=2&limit=200&no_cache=true`, { headers: getAuthHeaders() })
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
      const response = await fetch(`${apiUrl}/api/ip/multi-ip-tokens?window=${ipWindow}&min_ips=2&limit=200&no_cache=true`, { headers: getAuthHeaders() })
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
      const response = await fetch(`${apiUrl}/api/ip/multi-ip-users?window=${ipWindow}&min_ips=3&limit=200&no_cache=true`, { headers: getAuthHeaders() })
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
          <p className="text-muted-foreground mt-1">
            实时 Top 10 · 深度分析 · 快速封禁
            {systemScale && <span className="ml-2 text-xs opacity-70">({systemScale})</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {view === 'leaderboards' && (
            <>
              <div className="relative" ref={dropdownRef}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowIntervalDropdown(!showIntervalDropdown)}
                  className="h-9 min-w-[100px]"
                >
                  <Timer className="h-4 w-4 mr-2" />
                  {refreshInterval > 0 ? (
                    <span className="flex items-center gap-1">
                      <span className="text-primary font-medium">{formatCountdown(countdown)}</span>
                    </span>
                  ) : (
                    '自动刷新'
                  )}
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>

                {showIntervalDropdown && (
                  <div className="absolute right-0 mt-1 w-48 bg-popover border rounded-md shadow-lg z-50">
                    <div className="p-2 border-b">
                      <p className="text-xs text-muted-foreground">刷新间隔</p>
                    </div>
                    <div className="p-1">
                      {([0, 10, 30, 60, 120, 300, 600]).map((interval) => (
                        <button
                          key={interval}
                          onClick={() => {
                            handleRefreshIntervalChange(interval)
                            setShowIntervalDropdown(false)
                          }}
                          className={cn(
                            "w-full text-left px-3 py-2 text-sm rounded hover:bg-accent transition-colors",
                            refreshInterval === interval && "bg-accent text-accent-foreground"
                          )}
                        >
                          {getIntervalLabel(interval)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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
            <Button variant="outline" size="sm" onClick={() => handleRefresh()} disabled={refreshing !== null} className="h-9">
              <RefreshCw className={cn("h-4 w-4 mr-2", refreshing === 'all' && "animate-spin")} />
              刷新全部
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
              ref={el => { tabsRef.current[index] = el }}
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
                      onClick={() => handleRefresh(w)}
                      disabled={refreshing !== null}
                      title="刷新此窗口"
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", (refreshing === w || refreshing === 'all') && "animate-spin")} />
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
                    onClick={() => handleRefresh(selectedWindow)}
                    disabled={refreshing !== null}
                    title="刷新此窗口"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", (refreshing === selectedWindow || refreshing === 'all') && "animate-spin")} />
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
          <Card className="rounded-xl shadow-sm border overflow-hidden">
            <CardHeader className="pb-4 border-b bg-muted/20 px-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-destructive/10 rounded-lg">
                    <ShieldBan className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">封禁列表</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      当前共封禁 <span className="font-mono font-medium text-foreground">{bannedTotal}</span> 个用户
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="搜索用户名..."
                      className="pl-9 h-9 bg-background/50 border-muted-foreground/20 focus:bg-background transition-all"
                      value={bannedSearch}
                      onChange={(e) => setBannedSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && fetchBannedUsers(1)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchBannedUsers(1, true)}
                    disabled={bannedLoading}
                    className="h-9 w-9 p-0 shrink-0"
                    title="刷新列表"
                  >
                    <RefreshCw className={cn("h-4 w-4", bannedLoading && "animate-spin")} />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {bannedLoading ? (
                <div className="h-64 flex flex-col items-center justify-center text-muted-foreground gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
                  <p className="text-sm">正在加载封禁名单...</p>
                </div>
              ) : (
                <>
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30 hover:bg-muted/30 border-b">
                          <TableHead className="w-[250px] pl-6 h-10 text-xs font-semibold uppercase tracking-wider">用户</TableHead>
                          <TableHead className="w-[150px] h-10 text-xs font-semibold uppercase tracking-wider">使用统计</TableHead>
                          <TableHead className="w-[150px] h-10 text-xs font-semibold uppercase tracking-wider">封禁时间</TableHead>
                          <TableHead className="w-[120px] h-10 text-xs font-semibold uppercase tracking-wider">操作者</TableHead>
                          <TableHead className="h-10 text-xs font-semibold uppercase tracking-wider">原因</TableHead>
                          <TableHead className="w-[100px] h-10 text-right pr-6 text-xs font-semibold uppercase tracking-wider">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bannedUsers.length ? bannedUsers.map((user) => {
                          const bannedDate = user.banned_at ? new Date(user.banned_at * 1000) : null

                          return (
                            <TableRow
                              key={user.id}
                              className="group transition-colors duration-200 hover:bg-muted/40"
                            >
                              {/* 用户列 */}
                              <TableCell className="py-4 pl-6">
                                <div
                                  className="flex items-center gap-3 px-3 py-2 rounded-xl bg-muted/30 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all cursor-pointer border border-transparent hover:border-red-200 dark:hover:border-red-800 w-[240px]"
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
                                    // 传入封禁时间，查看封禁时刻的数据
                                    openUserDialog(mockItem, '24h', user.banned_at || undefined)
                                  }}
                                  title={user.display_name && user.display_name !== user.username ? `${user.display_name} (${user.username})` : user.username}
                                >
                                  <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center border border-red-200 dark:border-red-800/50 text-sm font-bold text-red-600 dark:text-red-400 shrink-0">
                                    {(user.display_name || user.username)[0]?.toUpperCase()}
                                  </div>
                                  <div className="flex flex-col min-w-0 w-full">
                                    <div className="flex items-center gap-1.5 w-full">
                                      <span className="font-bold text-sm tracking-tight">{user.display_name || user.username}</span>
                                      <Badge variant="secondary" className="px-1.5 py-0 h-4 text-[9px] font-mono text-muted-foreground bg-muted shrink-0 ml-auto appearance-none">
                                        #{user.id}
                                      </Badge>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5 w-full">
                                      {user.display_name && user.display_name !== user.username && (
                                        <span className="text-[10px] text-muted-foreground">@{user.username}</span>
                                      )}
                                      <span className="text-[10px] text-muted-foreground w-full">
                                        {user.email || '无邮箱'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </TableCell>

                              {/* 统计列 */}
                              <TableCell className="py-4">
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center gap-2 text-xs">
                                    <Activity className="w-3.5 h-3.5 text-muted-foreground/70" />
                                    <span className="font-mono font-medium">{formatNumber(user.request_count)}</span>
                                  </div>
                                  <div className="flex items-center gap-2 text-xs">
                                    <span className="w-3.5 text-center text-muted-foreground/70 font-serif">$</span>
                                    <span className="font-mono font-medium">{formatQuota(user.used_quota)}</span>
                                  </div>
                                </div>
                              </TableCell>

                              {/* 封禁时间列 */}
                              <TableCell className="py-4">
                                {bannedDate ? (
                                  <div className="flex flex-col gap-0.5">
                                    <span className="text-sm font-medium text-foreground">
                                      {bannedDate.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                                    </span>
                                    <span className="text-xs text-muted-foreground font-mono">
                                      {bannedDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </TableCell>

                              {/* 操作者列 */}
                              <TableCell className="py-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-500 border border-slate-200 shrink-0">
                                    {(user.ban_operator || 'S')[0].toUpperCase()}
                                  </div>
                                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate max-w-[80px]">
                                    {user.ban_operator || 'System'}
                                  </span>
                                </div>
                              </TableCell>

                              {/* 封禁原因列 */}
                              <TableCell className="py-4">
                                <div className="flex flex-col items-start gap-1.5">
                                  {renderReasonBadge(user.ban_reason)}
                                  {user.ban_context?.source && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1 opacity-70">
                                      <Activity className="w-3 h-3" />
                                      {user.ban_context.source === 'risk_center' ? '自动风控' :
                                        user.ban_context.source === 'ip_monitoring' ? 'IP监控' :
                                          user.ban_context.source === 'ai_auto_ban' ? 'AI审查' : '人工操作'}
                                    </span>
                                  )}
                                </div>
                              </TableCell>

                              {/* 操作列 */}
                              <TableCell className="py-4 text-right pr-6">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-3 text-xs font-medium hover:bg-green-50 hover:text-green-700 hover:border-green-200 transition-colors"
                                    disabled={mutating}
                                    onClick={() => {
                                      setBanConfirmDialog({
                                        open: true,
                                        type: 'unban',
                                        userId: user.id,
                                        username: user.username,
                                        displayName: user.display_name || undefined,
                                        reason: '',
                                        disableTokens: false,
                                        enableTokens: true,
                                      })
                                    }}
                                  >
                                    解封
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
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
                                      // 传入封禁时间，查看封禁时刻的数据
                                      openUserDialog(mockItem, '24h', user.banned_at || undefined)
                                    }}
                                    title="查看详情"
                                  >
                                    <ChevronDown className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        }) : (
                          <TableRow>
                            <TableCell colSpan={6} className="h-[300px] text-center">
                              <div className="flex flex-col items-center justify-center gap-3">
                                <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
                                  <ShieldCheck className="h-8 w-8 text-muted-foreground/50" />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <h3 className="font-semibold text-foreground">暂无封禁记录</h3>
                                  <p className="text-sm text-muted-foreground max-w-[250px]">
                                    {bannedSearch ? '未找到匹配的用户' : '当前系统运行正常，没有被封禁的用户'}
                                  </p>
                                </div>
                                {bannedSearch && (
                                  <Button variant="outline" size="sm" onClick={() => { setBannedSearch(''); fetchBannedUsers(1); }} className="mt-2">
                                    清除搜索
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {bannedTotalPages > 1 && (
                    <div className="flex items-center justify-between p-4 border-t bg-muted/5">
                      <div className="text-xs text-muted-foreground">
                        显示第 <span className="font-medium text-foreground">{bannedPage}</span> 页，共 {bannedTotalPages} 页
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          disabled={bannedPage <= 1 || bannedLoading}
                          onClick={() => fetchBannedUsers(bannedPage - 1)}
                        >
                          &lt;
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          disabled={bannedPage >= bannedTotalPages || bannedLoading}
                          onClick={() => fetchBannedUsers(bannedPage + 1)}
                        >
                          &gt;
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
                          <TableHead className="w-[140px] text-xs uppercase tracking-wider font-semibold">日志时间</TableHead>
                          <TableHead className="w-[100px] text-xs uppercase tracking-wider font-semibold text-center">审计动作</TableHead>
                          <TableHead className="w-[200px] text-xs uppercase tracking-wider font-semibold">目标用户</TableHead>
                          <TableHead className="w-[140px] text-xs uppercase tracking-wider font-semibold">执行人</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider font-semibold">分析详情与风控指标</TableHead>
                          <TableHead className="w-[60px] text-right text-xs uppercase tracking-wider font-semibold">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {records.length ? records.map((r) => {
                          const isTokenBan = r.context?.token_id !== undefined
                          const tokenName = r.context?.token_name || ''
                          const dateObj = new Date(r.created_at * 1000)

                          return (
                            <TableRow
                              key={r.id}
                              className={cn(
                                "group transition-all duration-200 border-b last:border-0",
                                r.action === 'ban' ? "hover:bg-red-50/30 dark:hover:bg-red-950/10" : "hover:bg-green-50/30 dark:hover:bg-green-950/10"
                              )}
                            >
                              {/* 时间列 */}
                              <TableCell className="py-4 pl-4">
                                <div className="flex items-center gap-2">
                                  <div className={cn(
                                    "w-1 h-10 rounded-full shrink-0",
                                    r.action === 'ban' ? "bg-red-500" : "bg-green-500"
                                  )} />
                                  <div className="flex flex-col gap-0.5">
                                    <span className="font-mono text-sm font-bold text-foreground tabular-nums">
                                      {dateObj.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground font-medium">
                                      {dateObj.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')}
                                    </span>
                                  </div>
                                </div>
                              </TableCell>

                              {/* 动作列 */}
                              <TableCell className="py-4 text-center">
                                <div className="flex flex-col items-center gap-1.5">
                                  {r.action === 'ban' ? (
                                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100/50 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200/50 dark:border-red-800/50 shadow-sm">
                                      <ShieldBan className="w-3.5 h-3.5" />
                                      <span className="text-[11px] font-bold">封禁</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100/50 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200/50 dark:border-green-800/50 shadow-sm">
                                      <ShieldCheck className="w-3.5 h-3.5" />
                                      <span className="text-[11px] font-bold">解封</span>
                                    </div>
                                  )}
                                  {isTokenBan && (
                                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border border-amber-200/40 uppercase tracking-tighter">
                                      Token Level
                                    </span>
                                  )}
                                </div>
                              </TableCell>

                              {/* 用户列 */}
                              <TableCell className="py-4">
                                <div className="flex flex-col gap-2">
                                  <div
                                    className={cn(
                                      "flex items-center gap-3 px-3 py-2 rounded-xl bg-muted/30 transition-all cursor-pointer border border-transparent w-[190px]",
                                      r.action === 'ban' ? "hover:bg-red-50 hover:border-red-200 dark:hover:bg-red-900/10 dark:hover:border-red-800" : "hover:bg-green-50 hover:border-green-200 dark:hover:bg-green-900/10 dark:hover:border-green-800"
                                    )}
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
                                    <div className={cn(
                                      "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border shrink-0",
                                      r.action === 'ban' ? "bg-red-100 text-red-600 border-red-200 dark:bg-red-900/30 dark:border-red-800/50 dark:text-red-400" : "bg-green-100 text-green-600 border-green-200 dark:bg-green-900/30 dark:border-green-800/50 dark:text-green-400"
                                    )}>
                                      {(r.username || `U`)[0]?.toUpperCase()}
                                    </div>
                                    <div className="flex flex-col min-w-0 w-full">
                                      <span className="font-bold text-sm w-full hover:text-primary transition-colors leading-tight tracking-tight">
                                        {r.username || `User#${r.user_id}`}
                                      </span>
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                        <Badge variant="outline" className="px-1.5 py-0 h-4 text-[9px] font-medium leading-none shrink-0 border-muted-foreground/20">
                                          ID: {r.user_id}
                                        </Badge>
                                      </div>
                                    </div>
                                  </div>

                                  {isTokenBan && tokenName && (
                                    <div className="flex items-center gap-2 pl-2">
                                      <div className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                                      <code className="text-[10px] bg-orange-50/50 dark:bg-orange-950/20 px-2 py-0.5 rounded border border-orange-100/50 text-orange-700 dark:text-orange-400 truncate max-w-[150px] font-mono italic" title={tokenName}>
                                        {tokenName}
                                      </code>
                                    </div>
                                  )}
                                </div>
                              </TableCell>

                              {/* 操作者列 */}
                              <TableCell className="py-4">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-black text-slate-500 border border-slate-200 shrink-0">
                                    {(r.operator || 'S')[0].toUpperCase()}
                                  </div>
                                  <span className="text-sm font-semibold text-slate-600 dark:text-slate-400 truncate">{r.operator || 'System'}</span>
                                </div>
                              </TableCell>

                              {/* 原因与指标列 */}
                              <TableCell className="py-4">
                                <div className="flex flex-col gap-2">
                                  {/* 原因标签行 */}
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {renderReasonBadge(r.reason)}
                                    {r.context?.source && (
                                      <Badge variant="secondary" className="text-[10px] h-5 font-bold px-2 bg-indigo-50 text-indigo-600 border-indigo-100/50 dark:bg-indigo-900/20 dark:text-indigo-400">
                                        {r.context.source === 'risk_center' ? 'AUTO-SHIELD' :
                                          r.context.source === 'ip_monitoring' ? 'IP-MONITOR' :
                                            r.context.source === 'ban_records' ? 'MANUAL' :
                                              r.context.source === 'ai_auto_ban' ? 'AI-BRAIN' : r.context.source.toUpperCase()}
                                      </Badge>
                                    )}
                                  </div>

                                  {/* 指标数据行 - 仅封禁操作显示 */}
                                  {r.action === 'ban' && r.context && (r.context.risk || r.context.summary || r.context.risk_score !== undefined) && (
                                    <div className="flex flex-wrap items-center gap-2">
                                      <div className="flex items-center bg-muted/30 rounded-lg p-1 border border-border/40 gap-1">
                                        {r.context.risk?.requests_per_minute > 0 && (
                                          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background border shadow-xs">
                                            <Activity className="w-3 h-3 text-blue-500" />
                                            <span className="text-[10px] font-bold text-muted-foreground">RPM</span>
                                            <span className="text-xs font-mono font-black text-foreground">{r.context.risk.requests_per_minute.toFixed(1)}</span>
                                          </div>
                                        )}
                                        {r.context.summary?.failure_rate !== undefined && r.context.summary.failure_rate > 0 && (
                                          <div className={cn(
                                            "flex items-center gap-1.5 px-2 py-1 rounded-md border shadow-xs",
                                            r.context.summary.failure_rate > 0.3 ? "bg-red-50 border-red-200 text-red-700" : "bg-background"
                                          )}>
                                            <AlertTriangle className="w-3 h-3 text-amber-500" />
                                            <span className="text-[10px] font-bold opacity-70">FAIL</span>
                                            <span className="text-xs font-mono font-black">{(r.context.summary.failure_rate * 100).toFixed(0)}%</span>
                                          </div>
                                        )}
                                        {r.context.summary?.unique_ips > 1 && (
                                          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background border shadow-xs">
                                            <Globe className="w-3 h-3 text-indigo-500" />
                                            <span className="text-[10px] font-bold text-muted-foreground">IP</span>
                                            <span className="text-xs font-mono font-black text-foreground">{r.context.summary.unique_ips}</span>
                                          </div>
                                        )}
                                        {r.context.risk_score !== undefined && (
                                          <div className={cn(
                                            "flex items-center gap-1.5 px-2 py-1 rounded-md border shadow-xs",
                                            r.context.risk_score >= 8 ? "bg-red-600 text-white border-red-700" : "bg-amber-500 text-white border-amber-600"
                                          )}>
                                            <Activity className="w-3 h-3" />
                                            <span className="text-[10px] font-black uppercase">RISK</span>
                                            <span className="text-xs font-mono font-black">{r.context.risk_score}</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </TableCell>

                              <TableCell className="py-4 text-right pr-6">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all rounded-full"
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
              <div className="flex items-center gap-3">
                <div className="relative" ref={dropdownRef}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowIntervalDropdown(!showIntervalDropdown)}
                    className="h-9 min-w-[100px]"
                  >
                    <Timer className="h-4 w-4 mr-2" />
                    {ipRefreshInterval > 0 ? (
                      <span className="flex items-center gap-1">
                        <span className="text-primary font-medium">{formatCountdown(ipCountdown)}</span>
                      </span>
                    ) : (
                      '自动刷新'
                    )}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>

                  {showIntervalDropdown && (
                    <div className="absolute right-0 mt-1 w-48 bg-popover border rounded-md shadow-lg z-50">
                      <div className="p-2 border-b">
                        <p className="text-xs text-muted-foreground">刷新间隔</p>
                      </div>
                      <div className="p-1">
                        {([0, 30, 60, 120, 300, 600]).map((interval) => (
                          <button
                            key={interval}
                            onClick={() => {
                              handleIpRefreshIntervalChange(interval)
                              setShowIntervalDropdown(false)
                            }}
                            className={cn(
                              "w-full text-left px-3 py-2 text-sm rounded hover:bg-accent transition-colors",
                              ipRefreshInterval === interval && "bg-accent text-accent-foreground"
                            )}
                          >
                            {getIntervalLabel(interval)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={handleRefreshIP} disabled={ipRefreshing.all} className="h-9">
                  <RefreshCw className={cn("h-4 w-4 mr-2", ipRefreshing.all && "animate-spin")} />
                  全部刷新
                </Button>
              </div>
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
                                  {isCloudflareIp(item.ip) && (
                                    <Badge className="bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100 px-1.5 py-0 text-[10px] font-bold">CF</Badge>
                                  )}
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
                                            <div className="flex items-center gap-1.5">
                                              <code className="font-mono text-foreground font-semibold text-xs">{ip.ip}</code>
                                              {isCloudflareIp(ip.ip) && (
                                                <span className="bg-orange-100 text-orange-700 border border-orange-200 px-1 py-0 text-[9px] font-bold rounded">CF</span>
                                              )}
                                            </div>
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
                                      <div key={ip.ip} className="flex items-center gap-1">
                                        <code className="text-xs font-medium bg-muted/80 px-2 py-1 rounded font-mono border border-border/50 text-foreground/90 tabular-nums">
                                          {ip.ip}
                                        </code>
                                        {isCloudflareIp(ip.ip) && (
                                          <span className="bg-orange-100 text-orange-700 border border-orange-200 px-1 py-0.5 text-[9px] font-bold rounded">CF</span>
                                        )}
                                      </div>
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

          {/* API 健康状态警告 */}
          {aiConfig?.api_health?.suspended && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold text-amber-800">API 服务已暂停</p>
                  <p className="text-sm text-amber-600">
                    连续失败 {aiConfig.api_health.consecutive_failures} 次
                    {aiConfig.api_health.cooldown_remaining > 0 && (
                      <span>，剩余冷却时间 {aiConfig.api_health.cooldown_remaining} 秒</span>
                    )}
                    {aiConfig.api_health.last_error && (
                      <span className="block mt-1 text-xs">错误: {aiConfig.api_health.last_error}</span>
                    )}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetApiHealth}
                className="border-amber-300 text-amber-700 hover:bg-amber-100"
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                手动恢复
              </Button>
            </div>
          )}

          {/* API 连续失败警告（未暂停但有失败） */}
          {aiConfig?.api_health && !aiConfig.api_health.suspended && aiConfig.api_health.consecutive_failures > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-yellow-100 text-yellow-600 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <p className="font-semibold text-yellow-800">API 调用异常</p>
                <p className="text-sm text-yellow-600">
                  最近连续失败 {aiConfig.api_health.consecutive_failures} 次
                  {aiConfig.api_health.last_error && (
                    <span className="block mt-1 text-xs">错误: {aiConfig.api_health.last_error}</span>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* API 配置面板 */}
          <Card className="rounded-xl shadow-sm border border-slate-200">
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
                          onClick={() => handleFetchModels(true)}
                          disabled={aiModelLoading || !aiConfigEdit.base_url || (!aiConfigEdit.api_key && !aiConfig?.has_api_key)}
                          className="h-10 w-10 shrink-0"
                          title="刷新模型列表（强制刷新缓存）"
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
                          "mt-2 rounded-lg border px-3 py-2.5 text-xs animate-in fade-in slide-in-from-top-1 duration-300 space-y-2",
                          aiTestResult.success ? "bg-emerald-50 border-emerald-100 text-emerald-700" : "bg-rose-50 border-rose-100 text-rose-700"
                        )}>
                          <div className="flex items-center gap-2">
                            {aiTestResult.success ? <Check className="h-3.5 w-3.5 shrink-0" /> : <X className="h-3.5 w-3.5 shrink-0" />}
                            <span className="font-medium">{aiTestResult.message}</span>
                            {aiTestResult.latency_ms && <span className="opacity-70 ml-auto tabular-nums">{aiTestResult.latency_ms}ms</span>}
                          </div>
                          {aiTestResult.success && aiTestResult.test_message && (
                            <div className="space-y-1.5 pt-1 border-t border-emerald-200/50">
                              <div className="flex gap-2">
                                <span className="text-emerald-600 font-medium shrink-0">发送:</span>
                                <span className="text-emerald-700/80">{aiTestResult.test_message}</span>
                              </div>
                              <div className="flex gap-2">
                                <span className="text-emerald-600 font-medium shrink-0">回复:</span>
                                <span className="text-emerald-700/80">{aiTestResult.response || '(无回复)'}</span>
                              </div>
                              {aiTestResult.usage && (
                                <div className="text-emerald-600/70 text-[10px]">
                                  Token: {aiTestResult.usage.prompt_tokens} + {aiTestResult.usage.completion_tokens} = {aiTestResult.usage.prompt_tokens + aiTestResult.usage.completion_tokens}
                                </div>
                              )}
                            </div>
                          )}
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
                  <Button onClick={handleOpenPromptDialog} variant="outline" className="min-w-[120px] relative">
                    <Settings className="h-4 w-4 mr-2" />
                    高级配置
                    {((aiConfig?.excluded_models?.length || 0) > 0 || (aiConfig?.excluded_groups?.length || 0) > 0 || aiConfig?.custom_prompt) && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-purple-500 rounded-full text-[10px] text-white flex items-center justify-center">
                        {(aiConfig?.excluded_models?.length || 0) + (aiConfig?.excluded_groups?.length || 0) + (aiConfig?.custom_prompt ? 1 : 0)}
                      </span>
                    )}
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
                onClick={() => {
                  setWhitelistModalOpen(true)
                  fetchWhitelist()
                }}
                className="bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                白名单 ({aiConfig?.whitelist_count || 0})
              </Button>
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

          {/* AI 审查记录 */}
          <Card className="rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <CardHeader className="px-6 py-4 border-b border-slate-100 bg-white flex flex-row items-center justify-between">
              <h3 className="font-bold text-lg text-slate-800">审查记录</h3>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500 mr-2">共 {aiAuditLogsTotal} 条</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearAuditLogs}
                  disabled={aiAuditLogsLoading || aiAuditLogsTotal === 0}
                  className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                >
                  <Ban className="h-4 w-4 mr-1.5" />
                  清空
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchAiAuditLogs(true)}
                  disabled={aiAuditLogsLoading}
                  className="h-8"
                >
                  {aiAuditLogsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
              </div>
            </CardHeader>
            <div className="bg-white overflow-x-auto">
              {aiAuditLogs.length > 0 ? (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                        <TableHead className="font-bold text-slate-600 w-[100px]">扫描ID</TableHead>
                        <TableHead className="font-bold text-slate-600 w-[100px]">状态</TableHead>
                        <TableHead className="font-bold text-slate-600 w-[100px]">模式</TableHead>
                        <TableHead className="font-bold text-slate-600 text-center">扫描</TableHead>
                        <TableHead className="font-bold text-slate-600 text-center">封禁</TableHead>
                        <TableHead className="font-bold text-slate-600 text-center">告警</TableHead>
                        <TableHead className="font-bold text-slate-600 text-center">错误</TableHead>
                        <TableHead className="font-bold text-slate-600 w-[100px]">耗时</TableHead>
                        <TableHead className="font-bold text-slate-600 w-[180px]">时间</TableHead>
                        <TableHead className="font-bold text-slate-600">错误信息</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aiAuditLogs.map((log) => (
                        <TableRow
                          key={log.id}
                          className="hover:bg-slate-50/50 cursor-pointer"
                          onClick={() => setSelectedAuditLog(log)}
                        >
                          <TableCell className="font-mono text-xs text-slate-500">{log.scan_id}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                log.status === 'success' ? 'success' :
                                  log.status === 'partial' ? 'warning' :
                                    log.status === 'failed' ? 'destructive' :
                                      log.status === 'empty' ? 'secondary' :
                                        log.status === 'suspended' ? 'destructive' :
                                          'outline'
                              }
                              className="text-xs whitespace-nowrap"
                            >
                              {log.status === 'success' ? '成功' :
                                log.status === 'partial' ? '部分成功' :
                                  log.status === 'failed' ? '失败' :
                                    log.status === 'empty' ? '无数据' :
                                      log.status === 'suspended' ? '已暂停' :
                                        log.status === 'skipped' ? '跳过' : log.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={log.dry_run ? 'secondary' : 'default'} className="text-xs whitespace-nowrap">
                              {log.dry_run ? '试运行' : '正式'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center font-mono">{log.total_scanned}</TableCell>
                          <TableCell className="text-center">
                            {log.banned_count > 0 ? (
                              <span className="font-bold text-red-600">{log.banned_count}</span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {log.warned_count > 0 ? (
                              <span className="font-bold text-amber-600">{log.warned_count}</span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {log.error_count > 0 ? (
                              <span className="font-bold text-red-600">{log.error_count}</span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{log.elapsed_seconds}s</TableCell>
                          <TableCell className="text-xs text-slate-500">
                            {new Date(log.created_at * 1000).toLocaleString('zh-CN')}
                          </TableCell>
                          <TableCell className="max-w-[200px]">
                            {log.error_message ? (
                              <span className="text-xs text-red-600 truncate block" title={log.error_message}>
                                {log.error_message}
                              </span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {/* 分页控件 */}
                  <div className="px-4 py-3 border-t flex items-center justify-between bg-slate-50/30">
                    <div className="text-xs text-slate-500">
                      显示 {(aiAuditLogsPage - 1) * aiAuditLogsLimit + 1} - {Math.min(aiAuditLogsPage * aiAuditLogsLimit, aiAuditLogsTotal)} 共 {aiAuditLogsTotal} 条
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAiAuditLogsPage(p => Math.max(1, p - 1))}
                        disabled={aiAuditLogsPage <= 1 || aiAuditLogsLoading}
                        className="h-8 w-8 p-0"
                      >
                        &lt;
                      </Button>
                      <div className="flex items-center justify-center min-w-[32px] text-sm font-medium">
                        {aiAuditLogsPage} / {Math.max(1, Math.ceil(aiAuditLogsTotal / aiAuditLogsLimit))}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAiAuditLogsPage(p => p + 1)}
                        disabled={aiAuditLogsPage >= Math.ceil(aiAuditLogsTotal / aiAuditLogsLimit) || aiAuditLogsLoading}
                        className="h-8 w-8 p-0"
                      >
                        &gt;
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="h-40 flex flex-col items-center justify-center text-muted-foreground bg-slate-50/30">
                  <Clock className="h-10 w-10 mb-2 text-slate-300" />
                  <p className="font-medium text-slate-500">暂无审查记录</p>
                  <p className="text-xs text-slate-400 mt-1">启用定时扫描后将自动记录</p>
                </div>
              )}
            </div>
          </Card>

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
                    <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 space-y-2.5 flex-1 z-10 border border-slate-100/50">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2 font-bold text-slate-700">
                          <div className="w-1 h-1 rounded-full bg-blue-400"></div>
                          请求量 &ge; 50 (活跃用户)
                        </div>
                        <p className="text-[10px] text-slate-500 pl-3">过滤低频调用，确保 AI 分析样本充足并节省 Token 消耗。</p>
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2 font-bold text-slate-700">
                          <div className="w-1 h-1 rounded-full bg-orange-400"></div>
                          命中 IP 异常标签
                        </div>
                        <p className="text-[10px] text-slate-500 pl-3">仅对出现多IP、快速切换或地域跳变等风险特征的用户进行研判。</p>
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2 font-bold text-slate-700">
                          <div className="w-1 h-1 rounded-full bg-slate-400"></div>
                          非白名单 / VIP 用户
                        </div>
                        <p className="text-[10px] text-slate-500 pl-3">管理员、受信任渠道及手动白名单用户受保护，系统永不自动封禁。</p>
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2 font-bold text-slate-700">
                          <div className="w-1 h-1 rounded-full bg-slate-400"></div>
                          不在 24h 冷却期内
                        </div>
                        <p className="text-[10px] text-slate-500 pl-3">同一用户 24 小时内仅执行一次 AI 评估，防止针对同一对象的重复消耗。</p>
                      </div>
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

                {/* Status Banner - Dynamic Configuration Dashboard */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-5 rounded-2xl bg-slate-50 border border-slate-100 shadow-inner">
                  {/* Mode Status */}
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm transition-colors",
                      aiConfig?.dry_run !== false ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"
                    )}>
                      {aiConfig?.dry_run !== false ? <Activity className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-0.5">运行模式</div>
                      <div className={cn(
                        "text-xs font-black truncate",
                        aiConfig?.dry_run !== false ? "text-amber-700" : "text-emerald-700"
                      )}>
                        {aiConfig?.dry_run !== false ? "试运行 (仅记录)" : "正式运行 (自动封禁)"}
                      </div>
                    </div>
                  </div>

                  {/* Model Status */}
                  <div className="flex items-center gap-3 border-l border-slate-200/60 pl-6">
                    <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 shadow-sm">
                      <Settings className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-0.5">配置模型</div>
                      <div className="text-xs font-black text-slate-800 truncate" title={aiConfig?.model || "未配置"}>
                        {aiConfig?.model || "尚未选择模型"}
                      </div>
                    </div>
                  </div>

                  {/* Scan Status */}
                  <div className="flex items-center gap-3 border-l border-slate-200/60 pl-6">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm",
                      aiConfig?.scan_interval_minutes ? "bg-indigo-100 text-indigo-600" : "bg-slate-200 text-slate-400"
                    )}>
                      <Clock className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-0.5">定时扫描</div>
                      <div className={cn(
                        "text-xs font-black truncate",
                        aiConfig?.scan_interval_minutes ? "text-indigo-700" : "text-slate-500"
                      )}>
                        {aiConfig?.scan_interval_minutes
                          ? `每 ${aiConfig.scan_interval_minutes >= 60 ? (aiConfig.scan_interval_minutes / 60).toFixed(0) + " 小时" : aiConfig.scan_interval_minutes + " 分钟"}`
                          : "已禁用 (手动模式)"}
                      </div>
                    </div>
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

          {/* 审查记录详情弹窗 - Clean Light Style */}
          <Dialog open={!!selectedAuditLog} onOpenChange={(open) => !open && setSelectedAuditLog(null)}>
            <DialogContent className="max-w-4xl p-0 overflow-hidden sm:rounded-2xl gap-0 bg-background text-foreground shadow-2xl border-border">
              {selectedAuditLog && (
                <>
                  <div className="p-6 pb-4 border-b bg-card">
                    <DialogHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "p-2.5 rounded-xl border shadow-sm",
                            selectedAuditLog.status === 'success' ? "bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50" :
                              selectedAuditLog.status === 'partial' ? "bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/50" :
                                selectedAuditLog.status === 'failed' ? "bg-red-50 text-red-600 border-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50" :
                                  "bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/50"
                          )}>
                            <Activity className="h-5 w-5" />
                          </div>
                          <div>
                            <DialogTitle className="text-xl font-bold tracking-tight">AI 审查报告</DialogTitle>
                            <DialogDescription className="mt-1 flex items-center gap-2">
                              <Badge variant="outline" className="font-mono text-[10px] h-5 px-1.5">{selectedAuditLog.scan_id}</Badge>
                              <span className="text-xs text-muted-foreground">{new Date(selectedAuditLog.created_at * 1000).toLocaleString('zh-CN')}</span>
                            </DialogDescription>
                          </div>
                        </div>
                        <Badge variant={selectedAuditLog.dry_run ? "secondary" : "destructive"} className="px-3 py-1">
                          {selectedAuditLog.dry_run ? '试运行' : '正式运行'}
                        </Badge>
                      </div>
                    </DialogHeader>
                  </div>

                  <div className="p-6 space-y-6 bg-muted/30 dark:bg-muted/10 min-h-[400px]">
                    {/* Stats */}
                    <div className="grid grid-cols-4 gap-4">
                      {[
                        { label: '扫描总数', value: selectedAuditLog.total_scanned, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-800' },
                        { label: '封禁人数', value: selectedAuditLog.banned_count, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-800' },
                        { label: '告警人数', value: selectedAuditLog.warned_count, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/10 border-orange-100 dark:border-orange-800' },
                        { label: '跳过/正常', value: selectedAuditLog.skipped_count, color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-50 dark:bg-slate-900/10 border-slate-100 dark:border-slate-800' },
                      ].map((stat, i) => (
                        <div key={i} className={cn("p-4 rounded-xl border shadow-sm flex flex-col items-center justify-center gap-1 transition-all hover:shadow-md", stat.bg)}>
                          <div className={cn("text-2xl font-bold tabular-nums", stat.color)}>{stat.value}</div>
                          <div className="text-xs font-medium text-muted-foreground">{stat.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Error Message */}
                    {selectedAuditLog.error_message && (
                      <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-900/50 text-sm flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span className="font-mono">{selectedAuditLog.error_message}</span>
                      </div>
                    )}

                    {/* Details List */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold flex items-center gap-2">
                          <Eye className="h-4 w-4 text-muted-foreground" />
                          处理详情
                        </h4>
                        <span className="text-xs text-muted-foreground">{selectedAuditLog.details?.length || 0} 条记录</span>
                      </div>

                      <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-muted-foreground/20">
                        {selectedAuditLog.details?.map((detail: any, idx: number) => (
                          <Card key={idx} className="overflow-hidden shadow-sm hover:shadow-md transition-shadow bg-card border-border/60">
                            <div className="p-4">
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-500 border border-slate-200 dark:border-slate-700">
                                    {(detail.username || 'U')[0]?.toUpperCase()}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span
                                        className="text-sm font-bold hover:underline cursor-pointer"
                                        onClick={() => {
                                          setSelectedAuditLog(null)
                                          openUserAnalysisFromIP(detail.user_id, detail.username || `用户${detail.user_id}`)
                                        }}
                                      >
                                        {detail.username}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                                        #{detail.user_id}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <Badge variant={
                                  detail.action === 'ban' ? 'destructive' :
                                    detail.action === 'warn' ? 'default' :
                                      detail.action === 'monitor' ? 'secondary' : 'outline'
                                } className="uppercase text-[10px] tracking-wider px-2">
                                  {detail.action === 'ban' ? '已封禁' : detail.action === 'warn' ? '已告警' : detail.action === 'monitor' ? '观察中' : detail.action}
                                </Badge>
                              </div>

                              {/* AI Assessment Section */}
                              {detail.assessment ? (
                                <div className="bg-muted/30 rounded-lg p-3 space-y-3 text-sm border border-border/40">
                                  <div className="flex flex-wrap items-center justify-between gap-4">
                                    <div className="flex items-center gap-6">
                                      <div className="flex flex-col gap-0.5">
                                        <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">风险评分</span>
                                        <div className="flex items-baseline gap-1">
                                          <span className={cn(
                                            "text-lg font-bold tabular-nums",
                                            detail.assessment.risk_score >= 8 ? "text-red-600" :
                                              detail.assessment.risk_score >= 5 ? "text-amber-600" : "text-green-600"
                                          )}>{detail.assessment.risk_score}</span>
                                          <span className="text-xs text-muted-foreground">/10</span>
                                        </div>
                                      </div>

                                      <div className="w-px h-8 bg-border/60"></div>

                                      <div className="flex flex-col gap-0.5">
                                        <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">置信度</span>
                                        <div className="text-lg font-bold tabular-nums">
                                          {(detail.assessment.confidence * 100).toFixed(0)}<span className="text-xs text-muted-foreground ml-0.5">%</span>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-3 text-xs text-muted-foreground bg-background/50 px-3 py-1.5 rounded-full border border-border/30">
                                      <div className="flex items-center gap-1" title="输入 Token">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                                        <span className="font-mono text-foreground">{detail.assessment.prompt_tokens}</span>
                                        <span className="text-[9px]">in</span>
                                      </div>
                                      <div className="w-px h-3 bg-border/60"></div>
                                      <div className="flex items-center gap-1" title="输出 Token">
                                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                                        <span className="font-mono text-foreground">{detail.assessment.completion_tokens}</span>
                                        <span className="text-[9px]">out</span>
                                      </div>
                                      <div className="w-px h-3 bg-border/60"></div>
                                      <div className="flex items-center gap-1" title="API 耗时">
                                        <Clock className="w-3 h-3" />
                                        <span className="font-mono text-foreground">{detail.assessment.api_duration_ms || detail.assessment.cost_time || '-'}</span>
                                        <span className="text-[9px]">ms</span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Analysis Content */}
                                  {detail.assessment.reason && (
                                    <div className="relative pl-3 border-l-2 border-primary/20">
                                      <div className="text-xs font-semibold text-foreground mb-0.5">AI 分析结论</div>
                                      <div className="text-xs text-muted-foreground leading-relaxed">
                                        {detail.assessment.reason}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground italic px-3 py-2 bg-muted/30 rounded border border-dashed">
                                  {detail.message || '暂无 AI 分析详情'}
                                </div>
                              )}

                              {/* Error Message if any */}
                              {detail.message && detail.action === 'error' && (
                                <div className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-2 rounded border border-red-100 dark:border-red-900/30 flex items-center gap-2">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  {detail.message}
                                </div>
                              )}
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  </div>

                  <DialogFooter className="p-4 border-t bg-muted/10 sm:justify-center">
                    <Button variant="outline" onClick={() => setSelectedAuditLog(null)} className="w-full sm:w-auto min-w-[100px]">
                      关闭报告
                    </Button>
                  </DialogFooter>
                </>
              )}
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
                            {isCloudflareIp(ip.ip) && (
                              <span className="bg-orange-100 text-orange-700 border border-orange-200 px-1 py-0.5 text-[9px] font-bold rounded">CF</span>
                            )}
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

      {selected && (
        <UserAnalysisDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          userId={selected.item.user_id}
          username={selected.item.username}
          source="risk_center"
          initialWindow={selected.window}
          endTime={selected.endTime}
          hideWindowSelector
          contextData={{ window: selected.window, generated_at: generatedAt }}
          headerExtra={
            <>
              <Badge variant="outline">{WINDOW_LABELS[selected.window]}</Badge>
              {selected.endTime && (
                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800">
                  封禁时刻: {new Date(selected.endTime * 1000).toLocaleString('zh-CN')}
                </Badge>
              )}
            </>
          }
          onBanned={() => { fetchLeaderboards(); fetchBannedUsers(1); fetchBanRecords(1) }}
          onUnbanned={() => { fetchLeaderboards(); fetchBannedUsers(bannedPage); fetchBanRecords(recordsPage) }}
          onWhitelistChanged={() => { fetchWhitelist(); fetchAiConfig() }}
        />
      )}


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
                ? <span className="block break-words">即将封禁用户 <span className="font-medium text-foreground">{banConfirmDialog.displayName || banConfirmDialog.username}</span>{banConfirmDialog.displayName && banConfirmDialog.displayName !== banConfirmDialog.username && <span className="text-muted-foreground"> (@{banConfirmDialog.username})</span>}</span>
                : <span className="block break-words">即将解封用户 <span className="font-medium text-foreground">{banConfirmDialog.displayName || banConfirmDialog.username}</span>{banConfirmDialog.displayName && banConfirmDialog.displayName !== banConfirmDialog.username && <span className="text-muted-foreground"> (@{banConfirmDialog.username})</span>}</span>}
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

      {/* 白名单管理弹窗 */}
      <Dialog open={whitelistModalOpen} onOpenChange={setWhitelistModalOpen}>
        <DialogContent className="max-w-2xl w-full max-h-[80vh] flex flex-col p-0 overflow-hidden rounded-xl border-border/50 shadow-2xl">
          <DialogHeader className="p-5 border-b bg-muted/10 shrink-0">
            <div className="flex justify-between items-center pr-6">
              <div>
                <DialogTitle className="text-xl flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-green-500" />
                  AI 审查白名单管理
                </DialogTitle>
                <DialogDescription className="mt-1">
                  白名单用户将不会被 AI 自动封禁系统扫描和处理。管理员 (role ≥ 10) 自动受保护。
                </DialogDescription>
              </div>
              <Badge variant="secondary" className="px-3 py-1 font-mono">{whitelist.length} 人</Badge>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0 bg-background">
            {/* 搜索添加区域 */}
            <div className="p-4 border-b bg-slate-50/50">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    placeholder="输入用户名或用户 ID 搜索..."
                    value={whitelistSearchQuery}
                    onChange={(e) => setWhitelistSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && whitelistSearchQuery.trim()) {
                        searchWhitelistUser(whitelistSearchQuery)
                      }
                    }}
                    className="pr-10"
                  />
                  {whitelistSearching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
                <Button
                  onClick={() => searchWhitelistUser(whitelistSearchQuery)}
                  disabled={!whitelistSearchQuery.trim() || whitelistSearching}
                >
                  搜索
                </Button>
              </div>

              {/* 搜索结果 */}
              {whitelistSearchResults.length > 0 && (
                <div className="mt-3 rounded-lg border bg-white overflow-hidden">
                  <div className="px-3 py-2 bg-slate-100 text-xs font-medium text-slate-600 border-b">
                    搜索结果 ({whitelistSearchResults.length})
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {whitelistSearchResults.map((user) => (
                      <div
                        key={user.user_id}
                        className="flex items-center justify-between px-3 py-2.5 border-b last:border-b-0 hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-sm font-medium text-slate-600">
                            {(user.display_name || user.username).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{user.display_name || user.username}</span>
                              {user.display_name && user.display_name !== user.username && (
                                <span className="text-xs text-muted-foreground">@{user.username}</span>
                              )}
                              {user.is_admin && (
                                <Badge variant="secondary" className="text-xs px-1.5 py-0 bg-amber-100 text-amber-700">
                                  管理员
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">ID: {user.user_id}</div>
                          </div>
                        </div>
                        <div>
                          {user.in_whitelist ? (
                            <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                              <Check className="h-3 w-3 mr-1" />
                              已在白名单
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => addToWhitelist(user.user_id)}
                              className="h-7 text-xs"
                            >
                              添加
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 当前白名单列表 */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-slate-700">当前白名单</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fetchWhitelist()}
                  disabled={whitelistLoading}
                  className="h-7 text-xs"
                >
                  <RefreshCw className={cn("h-3 w-3 mr-1", whitelistLoading && "animate-spin")} />
                  刷新
                </Button>
              </div>

              {whitelistLoading ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : whitelist.length > 0 ? (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="py-2 text-xs">用户</TableHead>
                        <TableHead className="py-2 text-xs text-center">类型</TableHead>
                        <TableHead className="py-2 text-xs text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {whitelist.map((user) => (
                        <TableRow key={user.user_id} className="hover:bg-muted/20">
                          <TableCell className="py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-medium text-slate-600">
                                {(user.display_name || user.username).charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-medium text-sm">{user.display_name || user.username}</div>
                                {user.display_name && user.display_name !== user.username && (
                                  <div className="text-xs text-muted-foreground/70">@{user.username}</div>
                                )}
                                <div className="text-xs text-muted-foreground">ID: {user.user_id}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 text-center">
                            {user.is_admin ? (
                              <Badge variant="secondary" className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 border-amber-200">
                                管理员 (自动)
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs px-2 py-0.5">
                                手动添加
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="py-2.5 text-right">
                            {!user.is_admin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeFromWhitelist(user.user_id)}
                                className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                              >
                                <X className="h-3 w-3 mr-1" />
                                移除
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="h-48 flex flex-col items-center justify-center text-muted-foreground border rounded-lg bg-slate-50/50">
                  <ShieldCheck className="h-10 w-10 mb-2 opacity-20" />
                  <p className="text-sm">暂无白名单用户</p>
                  <p className="text-xs mt-1">使用上方搜索框添加用户</p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="p-4 border-t bg-muted/5 sm:justify-center">
            <Button
              onClick={() => {
                setWhitelistModalOpen(false)
                setWhitelistSearchQuery('')
                setWhitelistSearchResults([])
              }}
              className="w-full sm:w-40 h-10 rounded-full bg-slate-900 hover:bg-slate-800 text-white"
            >
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 自定义提示词弹窗 */}
      <Dialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen}>
        <DialogContent className="max-w-4xl w-full max-h-[90vh] flex flex-col p-0 overflow-hidden rounded-xl border-border/50 shadow-2xl">
          <DialogHeader className="p-5 border-b bg-gradient-to-r from-purple-50 to-blue-50 shrink-0">
            <div className="flex justify-between items-center pr-6">
              <div>
                <DialogTitle className="text-xl flex items-center gap-2">
                  <Settings className="h-5 w-5 text-purple-500" />
                  AI 封禁高级配置
                </DialogTitle>
                <DialogDescription className="mt-1">
                  配置 IP 白名单/黑名单、排除模型/分组、自定义 AI 评估提示词等高级选项。
                </DialogDescription>
              </div>
              <div className="flex items-center gap-2">
                {((aiConfig?.excluded_models?.length || 0) > 0 || (aiConfig?.excluded_groups?.length || 0) > 0) && (
                  <Badge variant="secondary" className="px-3 py-1 bg-amber-100 text-amber-700">
                    排除规则 {(aiConfig?.excluded_models?.length || 0) + (aiConfig?.excluded_groups?.length || 0)}
                  </Badge>
                )}
                {aiConfig?.custom_prompt && (
                  <Badge variant="secondary" className="px-3 py-1 bg-purple-100 text-purple-700">
                    已自定义提示词
                  </Badge>
                )}
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0 bg-background p-5 space-y-4">
            {/* 提示词编写技巧 */}
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
              <h4 className="font-semibold text-blue-900 flex items-center gap-2 mb-3">
                <Activity className="h-4 w-4" />
                AI 封禁提示词编写技巧
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-blue-800">
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-blue-200 text-blue-700 flex items-center justify-center text-xs font-bold">1</span>
                    <div>
                      <div className="font-medium">使用变量占位符</div>
                      <div className="text-xs text-blue-600 mt-0.5">
                        系统会自动替换 {'{user_id}'}, {'{username}'}, {'{total_requests}'} 等变量
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-blue-200 text-blue-700 flex items-center justify-center text-xs font-bold">2</span>
                    <div>
                      <div className="font-medium">明确判断标准</div>
                      <div className="text-xs text-blue-600 mt-0.5">
                        清晰定义什么行为应该封禁、告警或放行
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-blue-200 text-blue-700 flex items-center justify-center text-xs font-bold">3</span>
                    <div>
                      <div className="font-medium">指定输出格式</div>
                      <div className="text-xs text-blue-600 mt-0.5">
                        要求 AI 返回 JSON 格式，包含 should_ban, risk_score, confidence, reason
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="font-medium mb-1">可用变量列表：</div>
                  <div className="grid grid-cols-2 gap-1 text-xs font-mono bg-white/50 rounded p-2 border border-blue-200">
                    <span>{'{user_id}'} - 用户ID</span>
                    <span>{'{username}'} - 用户名</span>
                    <span>{'{user_group}'} - 用户组</span>
                    <span>{'{total_requests}'} - 请求总数</span>
                    <span>{'{unique_models}'} - 模型数</span>
                    <span>{'{unique_tokens}'} - 令牌数</span>
                    <span>{'{unique_ips}'} - IP数量</span>
                    <span>{'{switch_count}'} - IP切换次数</span>
                    <span>{'{rapid_switch_count}'} - 快速切换</span>
                    <span>{'{avg_ip_duration}'} - 平均停留</span>
                    <span>{'{min_switch_interval}'} - 最短间隔</span>
                    <span>{'{risk_flags}'} - 风险标签</span>
                    <span>{'{user_ips}'} - 用户使用的IP</span>
                    <span>{'{whitelist_ips}'} - 系统白名单IP</span>
                    <span>{'{blacklist_ips}'} - 系统黑名单IP</span>
                    <span>{'{user_whitelisted_ips}'} - 用户IP中的白名单</span>
                    <span>{'{user_blacklisted_ips}'} - 用户IP中的黑名单</span>
                  </div>
                </div>
              </div>
            </div>

            {/* IP 白名单/黑名单配置 */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
              <h4 className="font-semibold text-slate-700 flex items-center gap-2 mb-3">
                <Globe className="h-4 w-4" />
                IP 白名单 / 黑名单配置
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-green-700 flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    白名单 IP（可信IP）
                  </label>
                  <textarea
                    value={whitelistIpsInput}
                    onChange={(e) => setWhitelistIpsInput(e.target.value)}
                    className="w-full h-24 p-3 text-xs font-mono bg-white border border-green-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    placeholder="每行一个IP地址，如：&#10;192.168.1.100&#10;10.0.0.1"
                  />
                  <div className="text-xs text-slate-500">
                    共 {whitelistIpsInput.split('\n').filter(ip => ip.trim()).length} 个IP
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-red-700 flex items-center gap-1">
                    <ShieldBan className="h-3.5 w-3.5" />
                    黑名单 IP（恶意IP）
                  </label>
                  <textarea
                    value={blacklistIpsInput}
                    onChange={(e) => setBlacklistIpsInput(e.target.value)}
                    className="w-full h-24 p-3 text-xs font-mono bg-white border border-red-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    placeholder="每行一个IP地址，如：&#10;1.2.3.4&#10;5.6.7.8"
                  />
                  <div className="text-xs text-slate-500">
                    共 {blacklistIpsInput.split('\n').filter(ip => ip.trim()).length} 个IP
                  </div>
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-500 bg-white/50 rounded p-2 border border-slate-200">
                提示：配置的IP列表会作为变量传递给AI，帮助AI判断用户IP是否可信。使用变量 {'{user_whitelisted_ips}'} 和 {'{user_blacklisted_ips}'} 获取用户命中的IP。
              </div>
            </div>

            {/* 排除模型/分组配置 */}
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
              <h4 className="font-semibold text-amber-800 flex items-center gap-2 mb-3">
                <Filter className="h-4 w-4" />
                排除模型 / 分组配置
                {excludeConfigLoading && <Loader2 className="h-3 w-3 animate-spin text-amber-500" />}
              </h4>
              <div className="text-xs text-amber-700 mb-3 bg-white/50 rounded p-2 border border-amber-200">
                配置的模型或分组请求不计入风险分析。当用户的排除请求占比 ≥ 80% 时，该用户将跳过 AI 审查。
                适用于嵌入式模型、翻译模型等高并发场景。
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 排除模型 */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-amber-700 flex items-center gap-1">
                    <Cpu className="h-3.5 w-3.5" />
                    排除模型（不计入风险分析）
                  </label>
                  <div className="bg-white border border-amber-200 rounded-lg p-2 max-h-32 overflow-y-auto space-y-1">
                    {availableModelsForExclude.length === 0 ? (
                      <div className="text-xs text-slate-400 p-2 text-center">
                        {excludeConfigLoading ? '加载中...' : '暂无可用模型数据'}
                      </div>
                    ) : (
                      availableModelsForExclude.map((model) => (
                        <label
                          key={model.model_name}
                          className="flex items-center gap-2 p-1.5 rounded hover:bg-amber-50 cursor-pointer text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={excludedModelsInput.includes(model.model_name)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setExcludedModelsInput([...excludedModelsInput, model.model_name])
                              } else {
                                setExcludedModelsInput(excludedModelsInput.filter(m => m !== model.model_name))
                              }
                            }}
                            className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                          />
                          <span className="flex-1 truncate font-mono">{model.model_name}</span>
                          <span className="text-slate-400 text-[10px]">{model.requests.toLocaleString()} 次</span>
                        </label>
                      ))
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>已选 {excludedModelsInput.length} 个模型</span>
                    {excludedModelsInput.length > 0 && (
                      <button
                        onClick={() => setExcludedModelsInput([])}
                        className="text-amber-600 hover:text-amber-700"
                      >
                        清空
                      </button>
                    )}
                  </div>
                </div>

                {/* 排除分组 */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-amber-700 flex items-center gap-1">
                    <Tag className="h-3.5 w-3.5" />
                    排除分组（不计入风险分析）
                  </label>
                  <div className="bg-white border border-amber-200 rounded-lg p-2 max-h-32 overflow-y-auto space-y-1">
                    {availableGroups.length === 0 ? (
                      <div className="text-xs text-slate-400 p-2 text-center">
                        {excludeConfigLoading ? '加载中...' : '暂无可用分组数据'}
                      </div>
                    ) : (
                      availableGroups.map((group) => (
                        <label
                          key={group.group_name}
                          className="flex items-center gap-2 p-1.5 rounded hover:bg-amber-50 cursor-pointer text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={excludedGroupsInput.includes(group.group_name)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setExcludedGroupsInput([...excludedGroupsInput, group.group_name])
                              } else {
                                setExcludedGroupsInput(excludedGroupsInput.filter(g => g !== group.group_name))
                              }
                            }}
                            className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                          />
                          <span className="flex-1 truncate">{group.group_name}</span>
                          <span className="text-slate-400 text-[10px]">{group.requests.toLocaleString()} 次</span>
                        </label>
                      ))
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>已选 {excludedGroupsInput.length} 个分组</span>
                    {excludedGroupsInput.length > 0 && (
                      <button
                        onClick={() => setExcludedGroupsInput([])}
                        className="text-amber-600 hover:text-amber-700"
                      >
                        清空
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 提示词编辑区 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  提示词内容
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetPrompt}
                  className="h-7 text-xs text-slate-500 hover:text-slate-700"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  重置为默认
                </Button>
              </div>
              <textarea
                value={promptContent}
                onChange={(e) => setPromptContent(e.target.value)}
                className="w-full h-[350px] p-4 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="输入自定义提示词..."
              />
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>字符数: {promptContent.length}</span>
                <span>提示：留空将使用系统默认提示词</span>
              </div>
            </div>
          </div>

          <DialogFooter className="p-4 border-t bg-muted/5 flex justify-between items-center">
            <div className="text-xs text-slate-500">
              * 修改配置后，下次 AI 评估将使用新的配置
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setPromptDialogOpen(false)}
                disabled={promptSaving}
              >
                取消
              </Button>
              <Button
                onClick={handleSavePrompt}
                disabled={promptSaving}
                className="bg-purple-600 hover:bg-purple-700 text-white min-w-[100px]"
              >
                {promptSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                保存配置
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div >
  )
}

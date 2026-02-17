import { useState, useCallback, useRef, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import {
  Search, Loader2, User, Key, Clock, Hash,
  MapPin, Globe, Building, Server, ChevronDown, ChevronUp, Cpu,
  Eye, AlertTriangle, ShieldCheck, Activity, ExternalLink
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Progress } from './ui/progress'
import { Select } from './ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { cn } from '../lib/utils'

interface IPLookupItem {
  user_id: number
  username: string
  token_id: number
  token_name: string
  request_count: number
  first_seen: number
  last_seen: number
}

interface ModelUsage {
  model: string
  count: number
}

interface GeoInfo {
  ip: string
  country: string
  country_code: string
  region: string
  city: string
  isp: string
  org: string
  asn: string
  success: boolean
}

interface IPLookupData {
  ip: string
  window: string
  total_requests: number
  unique_users: number
  unique_tokens: number
  items: IPLookupItem[]
  models: ModelUsage[]
  geo: GeoInfo | null
}

// 用户分析数据类型（与 UserManagement 一致）
interface UserAnalysis {
  range: { start_time: number; end_time: number; window_seconds: number }
  user: { id: number; username: string; display_name?: string | null; email?: string | null; status: number; group?: string | null; linux_do_id?: string | null }
  summary: {
    total_requests: number; success_requests: number; failure_requests: number
    quota_used: number; prompt_tokens: number; completion_tokens: number
    avg_use_time: number; unique_ips: number; unique_tokens: number
    unique_models: number; unique_channels: number; empty_count: number
    failure_rate: number; empty_rate: number
  }
  risk: {
    requests_per_minute: number; avg_quota_per_request?: number
    risk_flags: string[]
    ip_switch_analysis?: { switch_count: number; rapid_switch_count: number; avg_ip_duration: number; real_switch_count?: number; dual_stack_switches?: number; switch_details: any[] }
  }
  top_models: { model_name: string; requests: number }[]
  top_ips: { ip: string; requests: number }[]
}

type TimeWindow = '1h' | '6h' | '12h' | '24h' | '3d' | '7d'

const TIME_WINDOWS: { value: TimeWindow; label: string }[] = [
  { value: '1h', label: '1小时' },
  { value: '6h', label: '6小时' },
  { value: '12h', label: '12小时' },
  { value: '24h', label: '24小时' },
  { value: '3d', label: '3天' },
  { value: '7d', label: '7天' },
]

const WINDOW_LABELS: Record<string, string> = { '1h': '1小时内', '3h': '3小时内', '6h': '6小时内', '12h': '12小时内', '24h': '24小时内', '3d': '3天内', '7d': '7天内' }

const RISK_FLAG_LABELS: Record<string, string> = {
  'HIGH_RPM': '请求频率过高', 'MANY_IPS': '多IP访问', 'HIGH_FAILURE_RATE': '失败率过高',
  'HIGH_EMPTY_RATE': '空回复率过高', 'IP_RAPID_SWITCH': 'IP快速切换', 'IP_HOPPING': 'IP跳动异常',
}

function formatTimestamp(ts: number): string {
  if (!ts) return '-'
  const d = new Date(ts * 1000)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatAnalysisNumber(n: number) {
  return n.toLocaleString('zh-CN')
}

export function IPLookup() {
  const { token } = useAuth()
  const { showToast } = useToast()
  const [ip, setIp] = useState('')
  const [window, setWindow] = useState<TimeWindow>('24h')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<IPLookupData | null>(null)
  const [searched, setSearched] = useState(false)
  const [showModels, setShowModels] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 用户分析弹窗状态
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<{ id: number; username: string } | null>(null)
  const [analysisWindow, setAnalysisWindow] = useState<string>('24h')
  const [analysis, setAnalysis] = useState<UserAnalysis | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [linuxDoLookupLoading, setLinuxDoLookupLoading] = useState<string | null>(null)

  const apiUrl = import.meta.env.VITE_API_URL || ''

  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  const handleSearch = useCallback(async () => {
    const trimmed = ip.trim()
    if (!trimmed) {
      showToast('info', '请输入 IP 地址')
      inputRef.current?.focus()
      return
    }

    setLoading(true)
    setSearched(true)
    try {
      const response = await fetch(
        `${apiUrl}/api/ip/lookup/${encodeURIComponent(trimmed)}?window=${window}&include_geo=true`,
        { headers: getAuthHeaders() }
      )
      const result = await response.json()
      if (result.success) {
        setData(result.data)
        if (result.data.items.length === 0) {
          showToast('info', `在过去 ${TIME_WINDOWS.find(w => w.value === window)?.label} 内未找到使用该 IP 的记录`)
        }
      } else {
        showToast('error', result.message || '查询失败')
        setData(null)
      }
    } catch (error) {
      console.error('IP lookup failed:', error)
      showToast('error', 'IP 反查请求失败')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [ip, window, apiUrl, getAuthHeaders, showToast])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }, [handleSearch])

  // 聚焦输入框
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 打开用户分析弹窗
  const openUserAnalysis = (userId: number, username: string) => {
    setSelectedUser({ id: userId, username })
    setAnalysisDialogOpen(true)
    setAnalysis(null)
  }

  // 获取用户分析数据
  const fetchUserAnalysis = useCallback(async () => {
    if (!selectedUser || !analysisDialogOpen) return
    setAnalysisLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/risk/users/${selectedUser.id}/analysis?window=${analysisWindow}`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        setAnalysis(res.data)
      } else {
        showToast('error', res.message || '加载分析失败')
      }
    } catch (e) {
      console.error('Failed to fetch user analysis:', e)
      showToast('error', '加载分析失败')
    } finally {
      setAnalysisLoading(false)
    }
  }, [apiUrl, getAuthHeaders, selectedUser, analysisWindow, analysisDialogOpen, showToast])

  useEffect(() => {
    if (analysisDialogOpen && selectedUser) {
      fetchUserAnalysis()
    }
  }, [analysisDialogOpen, selectedUser, analysisWindow, fetchUserAnalysis])

  // 按用户聚合数据
  const userGroups = data ? Object.values(
    data.items.reduce((acc, item) => {
      const key = item.user_id
      if (!acc[key]) {
        acc[key] = {
          user_id: item.user_id,
          username: item.username,
          total_requests: 0,
          tokens: [],
          first_seen: item.first_seen,
          last_seen: item.last_seen,
        }
      }
      acc[key].total_requests += item.request_count
      acc[key].tokens.push(item)
      if (item.first_seen < acc[key].first_seen) acc[key].first_seen = item.first_seen
      if (item.last_seen > acc[key].last_seen) acc[key].last_seen = item.last_seen
      return acc
    }, {} as Record<number, {
      user_id: number
      username: string
      total_requests: number
      tokens: IPLookupItem[]
      first_seen: number
      last_seen: number
    }>)
  ).sort((a, b) => b.total_requests - a.total_requests) : []

  return (
    <>
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Search className="w-5 h-5 text-muted-foreground" />
            IP 反查用户
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            输入 IP 地址，查找使用过该 IP 的所有用户和令牌
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search Bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Input
                ref={inputRef}
                type="text"
                placeholder="输入 IP 地址，如 192.168.1.1 或 2001:db8::1"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                onKeyDown={handleKeyDown}
                className="pr-10"
              />
              {loading && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <div className="flex gap-2">
              <div className="inline-flex rounded-lg border bg-muted/50 p-1">
                {TIME_WINDOWS.map(({ value: w, label }) => (
                  <Button
                    key={w}
                    variant={window === w ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setWindow(w)}
                    className="h-7 text-xs px-2.5"
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <Button
                onClick={handleSearch}
                disabled={loading}
                className="h-9 px-4"
              >
                <Search className="h-4 w-4 mr-1.5" />
                查询
              </Button>
            </div>
          </div>

          {/* Results */}
          {searched && data && (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MiniStat label="总请求数" value={data.total_requests.toLocaleString('zh-CN')} icon={Hash} />
                <MiniStat label="关联用户" value={data.unique_users.toString()} icon={User} />
                <MiniStat label="关联令牌" value={data.unique_tokens.toString()} icon={Key} />
                <MiniStat
                  label="时间窗口"
                  value={TIME_WINDOWS.find(w => w.value === data.window)?.label || data.window}
                  icon={Clock}
                />
              </div>

              {/* Geo Info */}
              {data.geo && data.geo.success && (
                <div className="flex flex-wrap gap-2 p-3 rounded-lg bg-muted/50 text-sm">
                  <span className="flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                    {data.geo.country}
                    {data.geo.country_code && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {data.geo.country_code}
                      </Badge>
                    )}
                  </span>
                  {data.geo.region && (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      {data.geo.region}
                      {data.geo.city && data.geo.city !== data.geo.region && ` · ${data.geo.city}`}
                    </span>
                  )}
                  {data.geo.isp && (
                    <span className="flex items-center gap-1.5">
                      <Building className="h-3.5 w-3.5 text-muted-foreground" />
                      {data.geo.isp}
                    </span>
                  )}
                  {data.geo.asn && (
                    <span className="flex items-center gap-1.5">
                      <Server className="h-3.5 w-3.5 text-muted-foreground" />
                      {data.geo.asn}
                    </span>
                  )}
                </div>
              )}

              {/* Model Usage (collapsible) */}
              {data.models && data.models.length > 0 && (
                <div className="rounded-lg border">
                  <button
                    onClick={() => setShowModels(!showModels)}
                    className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-muted/50 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-muted-foreground" />
                      模型使用分布 ({data.models.length})
                    </span>
                    {showModels ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                  {showModels && (
                    <div className="px-3 pb-3 flex flex-wrap gap-2">
                      {data.models.map((m) => (
                        <Badge key={m.model} variant="secondary" className="text-xs">
                          {m.model}
                          <span className="ml-1.5 text-muted-foreground">{m.count.toLocaleString('zh-CN')}</span>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* User List */}
              {userGroups.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">用户</th>
                        <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">令牌</th>
                        <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">请求数</th>
                        <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">首次使用</th>
                        <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">最后使用</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userGroups.map((group) => (
                        group.tokens.map((item, idx) => (
                          <tr
                            key={`${item.user_id}-${item.token_id}`}
                            className={cn(
                              "border-b last:border-0 hover:bg-muted/50 transition-colors",
                              idx > 0 && "border-t border-dashed"
                            )}
                          >
                            {idx === 0 ? (
                              <td className="py-2.5 px-4 align-top" rowSpan={group.tokens.length}>
                                {/* 胶囊状可点击用户标签 - 与用户管理一致 */}
                                <div
                                  className="flex items-center gap-2 px-2 py-1 rounded-full bg-muted/50 hover:bg-primary/10 hover:text-primary transition-all cursor-pointer border border-transparent hover:border-primary/20 w-fit"
                                  onClick={() => openUserAnalysis(group.user_id, group.username)}
                                  title="查看用户分析"
                                >
                                  <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 text-[10px] text-primary font-bold">
                                    {group.username ? group.username[0]?.toUpperCase() : '#'}
                                  </div>
                                  <div className="flex flex-col leading-tight">
                                    <span className="font-bold text-sm whitespace-nowrap">
                                      {group.username || `用户 #${group.user_id}`}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                      ID: {group.user_id}
                                      {group.tokens.length > 1 && (
                                        <span className="ml-1.5">共 {group.total_requests.toLocaleString('zh-CN')} 次</span>
                                      )}
                                    </span>
                                  </div>
                                </div>
                              </td>
                            ) : null}
                            <td className="py-2.5 px-4">
                              <div className="flex items-center gap-1.5">
                                <Key className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                <span className="truncate max-w-[200px]" title={item.token_name || `令牌 #${item.token_id}`}>
                                  {item.token_name || `#${item.token_id}`}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-right tabular-nums font-medium">
                              {item.request_count.toLocaleString('zh-CN')}
                            </td>
                            <td className="py-2.5 px-4 text-right tabular-nums text-muted-foreground text-xs">
                              {formatTimestamp(item.first_seen)}
                            </td>
                            <td className="py-2.5 px-4 text-right tabular-nums text-muted-foreground text-xs">
                              {formatTimestamp(item.last_seen)}
                            </td>
                          </tr>
                        ))
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : searched && !loading ? (
                <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-lg">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p>未找到使用该 IP 的记录</p>
                  <p className="text-xs mt-1">尝试更大的时间窗口，或检查 IP 地址是否正确</p>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* User Analysis Dialog */}
      <Dialog open={analysisDialogOpen} onOpenChange={setAnalysisDialogOpen}>
        <DialogContent className="max-w-2xl w-full max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden rounded-xl border-border/50 shadow-2xl">
          <DialogHeader className="p-5 border-b bg-muted/10 flex-shrink-0">
            <div className="flex justify-between items-start pr-6">
              <div>
                <DialogTitle className="text-xl flex items-center gap-2">
                  <Eye className="h-5 w-5 text-primary" />
                  用户行为分析
                </DialogTitle>
                <DialogDescription className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <span>用户: <span className="font-mono text-foreground font-medium">{selectedUser?.username}</span></span>
                  <span className="text-muted-foreground">ID: {selectedUser?.id}</span>
                  {analysis?.user?.linux_do_id && (
                    <button
                      onClick={async () => {
                        const lid = analysis.user.linux_do_id
                        if (!lid || linuxDoLookupLoading) return
                        setLinuxDoLookupLoading(lid)
                        try {
                          const res = await fetch(`${apiUrl}/api/linuxdo/lookup/${encodeURIComponent(lid)}`, { headers: getAuthHeaders() })
                          const data = await res.json()
                          if (data.success && data.data?.profile_url) {
                            globalThis.open(data.data.profile_url, '_blank')
                          } else if (data.error_type === 'rate_limit') {
                            showToast('error', data.message || `请求被限速，请等待 ${data.wait_seconds || '?'} 秒后重试`)
                          } else {
                            showToast('error', data.message || '查询 Linux.do 用户名失败')
                          }
                        } catch { showToast('error', '查询 Linux.do 用户名失败') }
                        finally { setLinuxDoLookupLoading(null) }
                      }}
                      disabled={linuxDoLookupLoading === analysis.user.linux_do_id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 hover:border-orange-300 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800 dark:hover:bg-orange-900/30 transition-colors disabled:opacity-50 cursor-pointer"
                      title="点击查看 Linux.do 用户主页"
                    >
                      <img src="https://linux.do/uploads/default/optimized/3X/9/d/9dd49731091ce8656e94433a26a3ef36062b3994_2_32x32.png" alt="L" className="w-3.5 h-3.5 rounded-sm" />
                      {linuxDoLookupLoading === analysis.user.linux_do_id ? 'Linux.do: 查询中...' : `Linux.do: ${analysis.user.linux_do_id}`}
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </DialogDescription>
              </div>
              <Select
                value={analysisWindow}
                onChange={(e) => setAnalysisWindow(e.target.value)}
                className="w-28 h-8 text-sm"
              >
                {Object.entries(WINDOW_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </Select>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-5 min-h-0 bg-background">
            {analysisLoading ? (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                <Loader2 className="h-8 w-8 mb-4 animate-spin text-primary/50" />
                <p>正在分析用户行为数据...</p>
              </div>
            ) : analysis ? (
              <div className="space-y-6">
                {/* Risk Flags */}
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

                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="bg-muted/20 border-none shadow-sm">
                    <CardContent className="p-4 text-center">
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">请求总数</div>
                      <div className="text-2xl font-bold tabular-nums">{formatAnalysisNumber(analysis.summary.total_requests)}</div>
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
                      <div className="text-2xl font-bold tabular-nums">{formatAnalysisNumber(analysis.summary.unique_ips)}</div>
                    </CardContent>
                  </Card>
                </div>

                {/* Models and IPs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                      <Activity className="w-4 h-4" />
                      模型偏好 (Top 5)
                    </h4>
                    {analysis.top_models.slice(0, 5).length ? (
                      analysis.top_models.slice(0, 5).map((m) => {
                        const pct = analysis.summary.total_requests ? (m.requests / analysis.summary.total_requests) * 100 : 0
                        return (
                          <div key={m.model_name} className="space-y-1.5">
                            <div className="flex justify-between text-xs">
                              <span className="font-medium truncate max-w-[180px]">{m.model_name}</span>
                              <span className="text-muted-foreground tabular-nums">{formatAnalysisNumber(m.requests)} ({pct.toFixed(0)}%)</span>
                            </div>
                            <Progress value={pct} className="h-1.5" />
                          </div>
                        )
                      })
                    ) : <div className="text-xs text-muted-foreground italic">无数据</div>}
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                      <Globe className="w-4 h-4" />
                      来源 IP (Top 5)
                    </h4>
                    {analysis.top_ips.slice(0, 5).length ? (
                      analysis.top_ips.slice(0, 5).map((ipItem) => {
                        const pct = analysis.summary.total_requests ? (ipItem.requests / analysis.summary.total_requests) * 100 : 0
                        return (
                          <div key={ipItem.ip} className="space-y-1.5">
                            <div className="flex justify-between text-xs">
                              <span className="font-medium font-mono truncate">{ipItem.ip}</span>
                              <span className="text-muted-foreground tabular-nums">{formatAnalysisNumber(ipItem.requests)} ({pct.toFixed(0)}%)</span>
                            </div>
                            <Progress value={pct} className="h-1.5" />
                          </div>
                        )
                      })
                    ) : <div className="text-xs text-muted-foreground italic">无数据</div>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                <p>无法加载分析数据</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function MiniStat({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border">
      <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
      </div>
    </div>
  )
}

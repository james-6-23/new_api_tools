import { useState, useCallback, useRef, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import {
  Search, Loader2, User, Key, Clock, Hash,
  MapPin, Globe, Building, Server, ChevronDown, ChevronUp, Cpu,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { UserAnalysisDialog } from './UserAnalysisDialog'
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

type TimeWindow = '1h' | '6h' | '12h' | '24h' | '3d' | '7d'

const TIME_WINDOWS: { value: TimeWindow; label: string }[] = [
  { value: '1h', label: '1小时' },
  { value: '6h', label: '6小时' },
  { value: '12h', label: '12小时' },
  { value: '24h', label: '24小时' },
  { value: '3d', label: '3天' },
  { value: '7d', label: '7天' },
]

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
  }

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
      {selectedUser && (
        <UserAnalysisDialog
          open={analysisDialogOpen}
          onOpenChange={setAnalysisDialogOpen}
          userId={selectedUser.id}
          username={selectedUser.username}
          source="ip_lookup"
          contextData={{ ip: ip.trim() }}
        />
      )}
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

import { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import { Key, Loader2, RefreshCw, Filter, Search, CheckCircle2, XCircle, AlertCircle, Clock, Tag, ShieldBan, ShieldCheck, Globe, Infinity as InfinityIcon, CalendarOff } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Select } from './ui/select'
import { Input } from './ui/input'
import { StatCard } from './StatCard'
import { UserAnalysisDialog } from './UserAnalysisDialog'
import { TokenBatchDisableDialog } from './TokenBatchDisableDialog'
import { TokenAnalysisDialog } from './TokenAnalysisDialog'
import { cn } from '../lib/utils'

interface TokenRecord {
  id: number
  key: string
  name: string
  user_id: number
  username: string
  status: number
  quota: number
  used_quota: number
  remain_quota: number
  unlimited_quota: boolean
  models: string
  subnet: string
  group: string
  created_time: number
  accessed_time: number
  expired_time: number
  // 疑似泄漏模式下由后端返回；普通模式由 ip-stats 接口合并
  ip_count?: number
  request_count?: number
  ips?: string
}

type RiskFilter = '' | 'no_ip_limit' | 'never_expire' | 'unlimited' | 'leak'

interface TokenGroup {
  group_name: string
  token_count: number
  active_count: number
}

interface TokenStatistics {
  total: number
  active: number
  disabled: number
  expired: number
}

interface PaginatedResponse {
  items: TokenRecord[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

type StatusFilter = '' | 'active' | 'disabled' | 'expired'

export function Tokens() {
  const { showToast } = useToast()
  const { token } = useAuth()

  const [tokens, setTokens] = useState<TokenRecord[]>([])
  const [statistics, setStatistics] = useState<TokenStatistics | null>(null)
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [nameSearch, setNameSearch] = useState('')
  const [keySearch, setKeySearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('')
  const [ipStats, setIpStats] = useState<Map<number, number>>(new Map())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [opLoading, setOpLoading] = useState(false)
  const [availableGroups, setAvailableGroups] = useState<TokenGroup[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false)
  const [batchDisableOpen, setBatchDisableOpen] = useState(false)
  const [tokenAnalysisOpen, setTokenAnalysisOpen] = useState(false)
  const [selectedToken, setSelectedToken] = useState<{ id: number; name: string } | null>(null)
  const [selectedUser, setSelectedUser] = useState<{ id: number; username: string } | null>(null)

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  const fetchStatistics = useCallback(async () => {
    setStatsLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/tokens/statistics`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) setStatistics(data.data)
    } catch (error) {
      console.error('Failed to fetch token statistics:', error)
    } finally { setStatsLoading(false) }
  }, [apiUrl, getAuthHeaders])

  const fetchGroups = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/tokens/groups`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) setAvailableGroups(data.data || [])
    } catch (error) {
      console.error('Failed to fetch token groups:', error)
    }
  }, [apiUrl, getAuthHeaders])

  const fetchTokens = useCallback(async () => {
    setLoading(true)
    setSelected(new Set())
    setBulkConfirm(false)
    try {
      // 疑似泄漏模式：独立数据源（24h 内多 IP 令牌，后端已合并用户信息与 IP 统计）
      if (riskFilter === 'leak') {
        const response = await fetch(`${apiUrl}/api/tokens/suspected-leaks?hours=24&min_ips=5&limit=100`, { headers: getAuthHeaders() })
        const data = await response.json()
        if (data.success) {
          const items: TokenRecord[] = data.data || []
          setTokens(items)
          setTotal(items.length)
          setTotalPages(1)
          setIpStats(new Map(items.map(i => [i.id, Number(i.ip_count) || 0])))
        } else {
          showToast('error', data.message || '获取疑似泄漏令牌失败')
        }
        return
      }

      const params = new URLSearchParams({ page: page.toString(), page_size: pageSize.toString() })
      if (statusFilter) params.append('status', statusFilter)
      if (nameSearch) params.append('name', nameSearch)
      if (keySearch.trim()) params.append('key', keySearch.trim())
      if (groupFilter) params.append('group', groupFilter)
      if (riskFilter) params.append('risk', riskFilter)

      const response = await fetch(`${apiUrl}/api/tokens?${params.toString()}`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) {
        const result: PaginatedResponse = data.data
        const items = result.items || []
        setTokens(items)
        setTotal(result.total)
        setTotalPages(result.total_pages)
        // 拉取当前页令牌的 24h 来源 IP 数（泄漏信号）
        if (items.length > 0) {
          try {
            const idsParam = items.map(i => i.id).join(',')
            const ipRes = await fetch(`${apiUrl}/api/tokens/ip-stats?hours=24&ids=${idsParam}`, { headers: getAuthHeaders() })
            const ipData = await ipRes.json()
            if (ipData.success) {
              setIpStats(new Map((ipData.data || []).map((r: { token_id: number; ip_count: number }) => [Number(r.token_id), Number(r.ip_count)])))
            }
          } catch { setIpStats(new Map()) }
        } else {
          setIpStats(new Map())
        }
      } else {
        showToast('error', data.message || '获取令牌列表失败')
      }
    } catch (error) {
      showToast('error', '网络错误，请重试')
      console.error('Failed to fetch tokens:', error)
    } finally { setLoading(false) }
  }, [apiUrl, getAuthHeaders, page, pageSize, statusFilter, nameSearch, keySearch, groupFilter, riskFilter, showToast])

  useEffect(() => { fetchTokens() }, [fetchTokens])
  useEffect(() => { fetchStatistics() }, [fetchStatistics])
  useEffect(() => { fetchGroups() }, [fetchGroups])
  useEffect(() => { setPage(1) }, [statusFilter, nameSearch, keySearch, groupFilter, riskFilter])

  // 批量禁用/启用
  const batchOperate = async (op: 'disable' | 'enable', ids: number[]) => {
    if (ids.length === 0) return
    setOpLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/tokens/batch-${op}`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ids }),
      })
      const data = await response.json()
      if (data.success) {
        const n = op === 'disable' ? data.data.disabled : data.data.enabled
        showToast('success', op === 'disable' ? `已禁用 ${n} 个令牌` : `已启用 ${n} 个令牌`)
        await Promise.all([fetchTokens(), fetchStatistics()])
      } else {
        showToast('error', data.message || '操作失败')
      }
    } catch (error) {
      showToast('error', '网络错误，请重试')
      console.error('Failed to batch operate tokens:', error)
    } finally {
      setOpLoading(false)
      setBulkConfirm(false)
    }
  }

  const toggleSelect = (id: number) => {
    setBulkConfirm(false)
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setBulkConfirm(false)
    setSelected(prev => (prev.size >= tokens.length ? new Set() : new Set(tokens.map(t => t.id))))
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchTokens(), fetchStatistics(), fetchGroups()])
    setRefreshing(false)
    showToast('success', '数据已刷新')
  }

  const formatTimestamp = (ts: number) => {
    if (!ts || ts <= 0) return '-'
    return new Date(ts * 1000).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const formatQuota = (quota: number) => `$${(quota / 500000).toFixed(2)}`

  const isTokenExpired = (expiredTime: number) => {
    if (!expiredTime || expiredTime <= 0) return false
    return expiredTime * 1000 < Date.now()
  }

  const getStatusBadge = (record: TokenRecord) => {
    if (isTokenExpired(record.expired_time)) {
      return <Badge variant="destructive">已过期</Badge>
    }
    if (record.status === 1) {
      return <Badge variant="success">启用</Badge>
    }
    return <Badge variant="secondary">禁用</Badge>
  }

  const ipCountOf = (t: TokenRecord) => t.ip_count ?? ipStats.get(t.id) ?? 0

  // 安全风险角标：裸奔（无 IP 白名单）/ 无限额度 / 永不过期
  const getRiskBadges = (t: TokenRecord) => {
    const badges = []
    if (!t.subnet) {
      badges.push(
        <span key="noip" className="inline-flex items-center gap-1 text-[10px] leading-none px-1.5 py-1 rounded bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400 whitespace-nowrap" title="未设置 IP 白名单">
          <Globe className="w-2.5 h-2.5 shrink-0" />无IP限制
        </span>
      )
    }
    if (t.unlimited_quota) {
      badges.push(
        <span key="unlim" className="inline-flex items-center gap-1 text-[10px] leading-none px-1.5 py-1 rounded bg-orange-50 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400 whitespace-nowrap" title="无限额度">
          <InfinityIcon className="w-2.5 h-2.5 shrink-0" />无限
        </span>
      )
    }
    if (!t.expired_time || t.expired_time <= 0) {
      badges.push(
        <span key="noexp" className="inline-flex items-center gap-1 text-[10px] leading-none px-1.5 py-1 rounded bg-yellow-50 text-yellow-700 dark:bg-yellow-950/60 dark:text-yellow-500 whitespace-nowrap" title="永不过期">
          <CalendarOff className="w-2.5 h-2.5 shrink-0" />永久
        </span>
      )
    }
    return badges
  }

  const getIPCountCell = (t: TokenRecord) => {
    const n = ipCountOf(t)
    if (!n) return <span className="text-xs text-muted-foreground">-</span>
    return (
      <span
        className={cn('text-xs font-mono font-medium', n >= 5 ? 'text-red-600' : n >= 2 ? 'text-yellow-600' : 'text-muted-foreground')}
        title={t.ips ? `来源 IP：${t.ips}` : `24 小时内 ${n} 个来源 IP`}
      >
        {n}{n >= 5 && ' ⚠'}
      </span>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">令牌管理</h2>
          <p className="text-muted-foreground mt-1">查看所有令牌的状态与使用情况</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setBatchDisableOpen(true)} className="h-9 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:hover:bg-red-950">
            <ShieldBan className="h-4 w-4 mr-2" />
            批量禁用
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading} className="h-9">
            <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
            刷新
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="总令牌"
          value={statsLoading ? '-' : `${statistics?.total || 0}`}
          icon={Key}
          color="blue"
          className="border-l-4 border-l-blue-500"
          onClick={() => setStatusFilter('')}
        />
        <StatCard
          title="活跃令牌"
          value={statsLoading ? '-' : `${statistics?.active || 0}`}
          icon={CheckCircle2}
          color="green"
          className="border-l-4 border-l-green-500"
          onClick={() => setStatusFilter('active')}
        />
        <StatCard
          title="禁用令牌"
          value={statsLoading ? '-' : `${statistics?.disabled || 0}`}
          icon={XCircle}
          color="red"
          className="border-l-4 border-l-red-500"
          onClick={() => setStatusFilter('disabled')}
        />
        <StatCard
          title="已过期"
          value={statsLoading ? '-' : `${statistics?.expired || 0}`}
          icon={Clock}
          color="yellow"
          className="border-l-4 border-l-yellow-500"
          onClick={() => setStatusFilter('expired')}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Filter className="w-4 h-4" />
            筛选条件
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* 令牌 Key 精确查找：粘贴完整 key（含或不含 sk- 前缀）即可定位所属用户 */}
          <div className="mb-4 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">令牌 Key 精确查找</label>
            <div className="relative">
              <Key className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                value={keySearch}
                onChange={(e) => setKeySearch(e.target.value)}
                placeholder="粘贴完整令牌 Key（如 sk-xxxx）精确查找所属用户..."
                className="pl-9 pr-9 font-mono"
                spellCheck={false}
                autoComplete="off"
              />
              {keySearch && (
                <button
                  type="button"
                  onClick={() => setKeySearch('')}
                  className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                  title="清除"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">名称搜索</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  value={nameSearch}
                  onChange={(e) => setNameSearch(e.target.value)}
                  placeholder="搜索令牌名称..."
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">状态</label>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="">全部状态</option>
                <option value="active">启用</option>
                <option value="disabled">禁用</option>
                <option value="expired">已过期</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">令牌分组</label>
              <Select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
                <option value="">全部分组</option>
                {availableGroups.map((g) => (
                  <option key={g.group_name} value={g.group_name}>
                    {g.group_name} ({g.token_count})
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">安全风险</label>
              <Select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value as RiskFilter)}>
                <option value="">全部令牌</option>
                <option value="leak">疑似泄漏 (24h 多IP)</option>
                <option value="no_ip_limit">无 IP 白名单</option>
                <option value="unlimited">无限额度</option>
                <option value="never_expire">永不过期</option>
              </Select>
            </div>
            <div className="flex items-end justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setStatusFilter(''); setNameSearch(''); setKeySearch(''); setGroupFilter(''); setRiskFilter('') }} className="text-muted-foreground hover:text-foreground">
                重置筛选
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex items-center gap-3 px-4 py-2.5 rounded-lg border bg-background/95 backdrop-blur shadow-md animate-in fade-in slide-in-from-top-2">
          <span className="text-sm">已选 <span className="font-semibold">{selected.size}</span> 个令牌</span>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            disabled={opLoading}
            onClick={() => batchOperate('enable', Array.from(selected))}
            className="h-8 text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700 dark:border-green-900 dark:hover:bg-green-950"
          >
            <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
            启用所选
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={opLoading}
            onClick={() => {
              if (!bulkConfirm) { setBulkConfirm(true); return }
              batchOperate('disable', Array.from(selected))
            }}
            className={cn('h-8', bulkConfirm && 'animate-pulse')}
          >
            {opLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ShieldBan className="h-3.5 w-3.5 mr-1.5" />}
            {bulkConfirm ? `确认禁用 ${selected.size} 个?` : '禁用所选'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setSelected(new Set()); setBulkConfirm(false) }} className="h-8 text-muted-foreground">
            取消
          </Button>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center items-center py-20">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          ) : tokens.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="bg-muted/50 p-4 rounded-full mb-4">
                <Key className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium">暂无令牌</h3>
              <p className="text-muted-foreground mt-1 max-w-sm">
                没有找到符合条件的令牌。请尝试调整筛选条件。
              </p>
            </div>
          ) : (
            <>
            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-border/60 border-t border-b">
              {tokens.map((t) => (
                <div key={t.id} className="px-3 py-3 space-y-2 hover:bg-muted/30">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggleSelect(t.id)}
                        className="mt-1 h-4 w-4 rounded border-input accent-primary cursor-pointer shrink-0"
                      />
                      <div className="min-w-0" onClick={() => { setSelectedToken({ id: t.id, name: t.name }); setTokenAnalysisOpen(true) }}>
                        <div className="text-sm font-medium truncate" title={t.name}>{t.name || '-'} <span className="text-[11px] text-muted-foreground font-mono">#{t.id}</span></div>
                        <code className="block mt-1 text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded truncate">{t.key}</code>
                      </div>
                    </div>
                    {getStatusBadge(t)}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {getRiskBadges(t)}
                    {ipCountOf(t) > 0 && (
                      <span className="text-[11px] text-muted-foreground">24h IP: {getIPCountCell(t)}</span>
                    )}
                    <div className="flex-1" />
                    {t.status === 1 ? (
                      <button onClick={() => batchOperate('disable', [t.id])} disabled={opLoading} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-red-600 bg-red-50 dark:bg-red-950/50 disabled:opacity-50">
                        <ShieldBan className="w-3 h-3" />禁用
                      </button>
                    ) : t.status === 2 ? (
                      <button onClick={() => batchOperate('enable', [t.id])} disabled={opLoading} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-green-600 bg-green-50 dark:bg-green-950/50 disabled:opacity-50">
                        <ShieldCheck className="w-3 h-3" />启用
                      </button>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div className="text-muted-foreground">所属：
                      {t.user_id > 0 ? (
                        <button
                          onClick={() => { setSelectedUser({ id: t.user_id, username: t.username || `用户 #${t.user_id}` }); setAnalysisDialogOpen(true) }}
                          className="ml-1 text-primary hover:underline"
                        >
                          {t.username || `#${t.user_id}`}
                        </button>
                      ) : '-'}
                    </div>
                    <div className="text-muted-foreground">分组：{t.group || 'default'}</div>
                    <div className="col-span-2 text-muted-foreground">
                      额度：{t.unlimited_quota ? <span className="text-blue-600">无限</span> : <>总 {formatQuota(t.quota)} · 用 <span className="text-green-600">{formatQuota(t.used_quota)}</span></>}
                    </div>
                    {t.models && <div className="col-span-2 text-muted-foreground truncate" title={t.models}>模型：{t.models}</div>}
                    <div className="text-muted-foreground">创建：{formatTimestamp(t.created_time)}</div>
                    <div className="text-muted-foreground">最后：{formatTimestamp(t.accessed_time)}</div>
                    {t.expired_time > 0 && (
                      <div className={cn("col-span-2 text-muted-foreground flex items-center gap-1", isTokenExpired(t.expired_time) && "text-red-500")}>
                        {isTokenExpired(t.expired_time) && <AlertCircle className="w-3 h-3" />}
                        过期：{formatTimestamp(t.expired_time)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block border-t border-b sm:border-0 overflow-x-auto custom-scrollbar">
              <Table className="min-w-[1000px]">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-[36px]">
                      <input
                        type="checkbox"
                        checked={tokens.length > 0 && selected.size >= tokens.length}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                        title="全选本页"
                      />
                    </TableHead>
                    <TableHead className="w-[48px]">ID</TableHead>
                    <TableHead className="min-w-[210px]">令牌</TableHead>
                    <TableHead>所属用户</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>风险</TableHead>
                    <TableHead className="text-center whitespace-nowrap" title="24 小时内去重来源 IP 数，≥5 疑似泄漏">IP数</TableHead>
                    <TableHead>额度</TableHead>
                    <TableHead className="whitespace-nowrap">时间</TableHead>
                    <TableHead className="w-[72px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tokens.map((t) => (
                    <TableRow key={t.id} className={cn('hover:bg-muted/50', selected.has(t.id) && 'bg-primary/5')}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selected.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                          className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{t.id}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span
                            className="font-medium text-sm truncate max-w-[150px] cursor-pointer text-foreground hover:text-primary hover:underline transition-colors"
                            title={`点击分析令牌 ${t.name}`}
                            onClick={() => { setSelectedToken({ id: t.id, name: t.name }); setTokenAnalysisOpen(true) }}
                          >
                            {t.name || '-'}
                          </span>
                          {t.group && (
                            <span
                              className="inline-flex items-center gap-0.5 text-[10px] leading-none px-1.5 py-0.5 rounded-full bg-primary/10 text-primary cursor-pointer hover:bg-primary/20 transition-colors whitespace-nowrap"
                              onClick={() => setGroupFilter(t.group)}
                              title={`筛选分组: ${t.group}`}
                            >
                              <Tag className="w-2.5 h-2.5" />{t.group}
                            </span>
                          )}
                        </div>
                        <code
                          className="text-[11px] font-mono text-muted-foreground cursor-pointer hover:text-primary transition-colors"
                          onClick={() => { setSelectedToken({ id: t.id, name: t.name }); setTokenAnalysisOpen(true) }}
                        >
                          {t.key}
                        </code>
                      </TableCell>
                      <TableCell>
                        {t.user_id > 0 ? (
                          <div
                            className="flex items-center gap-2 px-2 py-1 rounded-full bg-muted/50 hover:bg-primary/10 hover:text-primary transition-all cursor-pointer border border-transparent hover:border-primary/20 w-fit"
                            onClick={() => {
                              setSelectedUser({ id: t.user_id, username: t.username || `用户 #${t.user_id}` })
                              setAnalysisDialogOpen(true)
                            }}
                            title="查看用户分析"
                          >
                            <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 text-[10px] text-primary font-bold">
                              {(t.username || '#')[0]?.toUpperCase()}
                            </div>
                            <span className="font-medium text-sm whitespace-nowrap">
                              {t.username || `#${t.user_id}`}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(t)}</TableCell>
                      <TableCell>
                        {getRiskBadges(t).length > 0 ? (
                          <div className="flex flex-col items-start gap-1">{getRiskBadges(t)}</div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">{getIPCountCell(t)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col text-xs">
                          {t.unlimited_quota ? (
                            <span className="font-medium text-blue-600">无限额度</span>
                          ) : (
                            <>
                              <span className="text-muted-foreground">总: {formatQuota(t.quota)}</span>
                              <span className="font-medium text-green-600">已用: {formatQuota(t.used_quota)}</span>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                        <div className="space-y-0.5">
                          <div><span className="opacity-60 mr-1">创建</span>{formatTimestamp(t.created_time)}</div>
                          <div><span className="opacity-60 mr-1">使用</span>{formatTimestamp(t.accessed_time)}</div>
                          {t.expired_time > 0 && (
                            <div className={cn('flex items-center gap-1', isTokenExpired(t.expired_time) && 'text-red-500')}>
                              <span className={cn('opacity-60 mr-0.5', isTokenExpired(t.expired_time) && 'opacity-100')}>过期</span>
                              {formatTimestamp(t.expired_time)}
                              {isTokenExpired(t.expired_time) && <AlertCircle className="w-3 h-3" />}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {t.status === 1 ? (
                          <button
                            onClick={() => batchOperate('disable', [t.id])}
                            disabled={opLoading}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors disabled:opacity-50 whitespace-nowrap"
                            title="禁用该令牌"
                          >
                            <ShieldBan className="w-3.5 h-3.5 shrink-0" />禁用
                          </button>
                        ) : t.status === 2 ? (
                          <button
                            onClick={() => batchOperate('enable', [t.id])}
                            disabled={opLoading}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-green-600 hover:bg-green-50 dark:hover:bg-green-950 transition-colors disabled:opacity-50 whitespace-nowrap"
                            title="重新启用该令牌"
                          >
                            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />启用
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
          )}

          {/* Pagination */}
          {total > 0 && (
            <div className="px-4 py-4 border-t flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                显示 {tokens.length} 条，共 {total} 条
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>上一页</Button>
                <div className="flex items-center px-2 text-sm font-medium">
                  {page} / {totalPages}
                </div>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Batch Disable Dialog */}
      <TokenBatchDisableDialog
        open={batchDisableOpen}
        onOpenChange={setBatchDisableOpen}
        onSuccess={() => { fetchTokens(); fetchStatistics() }}
        onOpenToken={(tokenId, tokenName) => {
          setSelectedToken({ id: tokenId, name: tokenName })
          setTokenAnalysisOpen(true)
        }}
        onOpenUser={(userId, username) => {
          setSelectedUser({ id: userId, username })
          setAnalysisDialogOpen(true)
        }}
      />

      {/* Token Analysis Dialog */}
      {selectedToken && (
        <TokenAnalysisDialog
          open={tokenAnalysisOpen}
          onOpenChange={setTokenAnalysisOpen}
          tokenId={selectedToken.id}
          tokenName={selectedToken.name}
          onOpenUser={(userId, username) => {
            setSelectedUser({ id: userId, username })
            setAnalysisDialogOpen(true)
          }}
          onChanged={() => { fetchTokens(); fetchStatistics() }}
        />
      )}

      {/* User Analysis Dialog */}
      {selectedUser && (
        <UserAnalysisDialog
          open={analysisDialogOpen}
          onOpenChange={setAnalysisDialogOpen}
          userId={selectedUser.id}
          username={selectedUser.username}
          source="user_management"
        />
      )}
    </div>
  )
}

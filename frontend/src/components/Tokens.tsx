import { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import { Key, Loader2, RefreshCw, Filter, Search, CheckCircle2, XCircle, AlertCircle, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Select } from './ui/select'
import { Input } from './ui/input'
import { StatCard } from './StatCard'
import { UserAnalysisDialog } from './UserAnalysisDialog'
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
  const [refreshing, setRefreshing] = useState(false)
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false)
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

  const fetchTokens = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: page.toString(), page_size: pageSize.toString() })
      if (statusFilter) params.append('status', statusFilter)
      if (nameSearch) params.append('name', nameSearch)

      const response = await fetch(`${apiUrl}/api/tokens?${params.toString()}`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) {
        const result: PaginatedResponse = data.data
        setTokens(result.items || [])
        setTotal(result.total)
        setTotalPages(result.total_pages)
      } else {
        showToast('error', data.message || '获取令牌列表失败')
      }
    } catch (error) {
      showToast('error', '网络错误，请重试')
      console.error('Failed to fetch tokens:', error)
    } finally { setLoading(false) }
  }, [apiUrl, getAuthHeaders, page, pageSize, statusFilter, nameSearch, showToast])

  useEffect(() => { fetchTokens() }, [fetchTokens])
  useEffect(() => { fetchStatistics() }, [fetchStatistics])
  useEffect(() => { setPage(1) }, [statusFilter, nameSearch])

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchTokens(), fetchStatistics()])
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

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">令牌管理</h2>
          <p className="text-muted-foreground mt-1">查看所有令牌的状态与使用情况</p>
        </div>
        <div className="flex items-center gap-3">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
            <div className="flex items-end lg:col-span-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setStatusFilter(''); setNameSearch('') }} className="text-muted-foreground hover:text-foreground">
                重置筛选
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

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
            <div className="rounded-md border-t border-b sm:border-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-[60px]">ID</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead>所属用户</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>额度</TableHead>
                    <TableHead>模型限制</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>最后使用</TableHead>
                    <TableHead>过期时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tokens.map((t) => (
                    <TableRow key={t.id} className="hover:bg-muted/50">
                      <TableCell className="font-mono text-xs text-muted-foreground">{t.id}</TableCell>
                      <TableCell>
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{t.key}</code>
                      </TableCell>
                      <TableCell className="font-medium text-sm max-w-[150px] truncate" title={t.name}>{t.name || '-'}</TableCell>
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
                      <TableCell className="max-w-[120px]">
                        {t.models ? (
                          <span className="text-xs text-muted-foreground truncate block" title={t.models}>
                            {t.models.split(',').length > 2
                              ? `${t.models.split(',').slice(0, 2).join(', ')}...`
                              : t.models}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">全部模型</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatTimestamp(t.created_time)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatTimestamp(t.accessed_time)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {t.expired_time > 0 ? (
                          <div className="flex items-center gap-1">
                            {isTokenExpired(t.expired_time) && <AlertCircle className="w-3 h-3 text-red-500" />}
                            {formatTimestamp(t.expired_time)}
                          </div>
                        ) : '永不过期'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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

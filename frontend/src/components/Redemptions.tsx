import { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import { Trash2, Copy, Ticket, Loader2, RefreshCw, Filter, Search, Calendar, Tag, AlertCircle, CheckCircle2, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Select } from './ui/select'
import { Input } from './ui/input'
import { StatCard } from './StatCard'
import { UserAnalysisDialog } from './UserAnalysisDialog'
import { cn } from '../lib/utils'

interface RedemptionCode {
  id: number
  key: string
  name: string
  quota: number
  created_time: number
  redeemed_time: number
  used_user_id: number
  used_username: string
  expired_time: number
  status: 'unused' | 'used' | 'expired'
}

interface RedemptionStatistics {
  total_count: number
  unused_count: number
  used_count: number
  expired_count: number
  total_quota: number
  unused_quota: number
  used_quota: number
  expired_quota: number
}

interface PaginatedResponse {
  items: RedemptionCode[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

type StatusFilter = '' | 'unused' | 'used' | 'expired'

export function Redemptions() {
  const { showToast } = useToast()
  const { token } = useAuth()

  const [codes, setCodes] = useState<RedemptionCode[]>([])
  const [statistics, setStatistics] = useState<RedemptionStatistics | null>(null)
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [nameFilter, setNameFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; type: 'single' | 'batch'; id?: number }>({ open: false, type: 'single' })
  const [deleting, setDeleting] = useState(false)
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
      const params = new URLSearchParams()
      if (startDate) params.append('start_date', startDate)
      if (endDate) params.append('end_date', endDate)
      const response = await fetch(`${apiUrl}/api/redemptions/statistics?${params.toString()}`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) setStatistics(data.data)
    } catch (error) {
      console.error('Failed to fetch statistics:', error)
    } finally { setStatsLoading(false) }
  }, [apiUrl, getAuthHeaders, startDate, endDate])

  const fetchCodes = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: page.toString(), page_size: pageSize.toString() })
      if (nameFilter) params.append('name', nameFilter)
      if (statusFilter) params.append('status', statusFilter)
      if (startDate) params.append('start_date', startDate)
      if (endDate) params.append('end_date', endDate)

      const response = await fetch(`${apiUrl}/api/redemptions?${params.toString()}`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) {
        const result: PaginatedResponse = data.data
        setCodes(result.items)
        setTotal(result.total)
        setTotalPages(result.total_pages)
      } else {
        showToast('error', data.error?.message || '获取兑换码失败')
      }
    } catch (error) {
      showToast('error', '网络错误，请重试')
      console.error('Failed to fetch codes:', error)
    } finally {
      setLoading(false)
    }
  }, [apiUrl, getAuthHeaders, page, pageSize, nameFilter, statusFilter, startDate, endDate, showToast])

  useEffect(() => { fetchCodes() }, [fetchCodes])
  useEffect(() => { fetchStatistics() }, [fetchStatistics])
  useEffect(() => { setPage(1) }, [nameFilter, statusFilter, startDate, endDate])

  const formatTimestamp = (ts: number) => {
    if (!ts || ts <= 0) return '-'
    return new Date(ts * 1000).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const formatQuota = (quota: number) => `$${(quota / 500000).toFixed(2)}`

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(codes.map(c => c.id)) : new Set())
  }

  const handleSelectOne = (id: number, checked: boolean) => {
    const newSelected = new Set(selectedIds)
    checked ? newSelected.add(id) : newSelected.delete(id)
    setSelectedIds(newSelected)
  }

  const confirmDelete = async () => {
    if (deleting) return // 防止重复点击
    setDeleting(true)
    try {
      if (deleteDialog.type === 'single' && deleteDialog.id) {
        const response = await fetch(`${apiUrl}/api/redemptions/${deleteDialog.id}`, { method: 'DELETE', headers: getAuthHeaders() })
        const data = await response.json()
        if (data.success) { showToast('success', '删除成功'); fetchCodes(); fetchStatistics(); }
        else showToast('error', data.error?.message || '删除失败')
      } else if (deleteDialog.type === 'batch') {
        const response = await fetch(`${apiUrl}/api/redemptions/batch`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
          body: JSON.stringify({ ids: Array.from(selectedIds) }),
        })
        const data = await response.json()
        if (data.success) { showToast('success', `成功删除 ${selectedIds.size} 个兑换码`); setSelectedIds(new Set()); fetchCodes(); fetchStatistics(); }
        else showToast('error', data.error?.message || '删除失败')
      }
    } catch (error) {
      showToast('error', '网络错误，请重试')
      console.error('Delete error:', error)
    } finally {
      setDeleting(false)
      setDeleteDialog({ open: false, type: 'single' })
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchCodes(), fetchStatistics()])
    setRefreshing(false)
    showToast('success', '数据已刷新')
  }

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        showToast('success', '兑换码已复制')
        return
      }
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      showToast('success', '兑换码已复制')
    } catch { showToast('error', '复制失败') }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">兑换码管理</h2>
          <p className="text-muted-foreground mt-1">查询、管理或批量删除兑换码</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading} className="h-9">
            <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
            刷新
          </Button>
          {selectedIds.size > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setDeleteDialog({ open: true, type: 'batch' })} className="h-9">
              <Trash2 className="h-4 w-4 mr-2" />
              删除选中 ({selectedIds.size})
            </Button>
          )}
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard 
          title="未使用" 
          value={statsLoading ? '-' : `${statistics?.unused_count || 0} 个`}
          subValue={statsLoading ? '-' : `${formatQuota(statistics?.unused_quota || 0)}`}
          icon={CheckCircle2} 
          color="green" 
          className="border-l-4 border-l-green-500"
          onClick={() => setStatusFilter('unused')}
        />
        <StatCard 
          title="已使用" 
          value={statsLoading ? '-' : `${statistics?.used_count || 0} 个`}
          subValue={statsLoading ? '-' : `${formatQuota(statistics?.used_quota || 0)}`}
          icon={Ticket} 
          color="blue" 
          className="border-l-4 border-l-blue-500"
          onClick={() => setStatusFilter('used')}
        />
        <StatCard 
          title="已过期" 
          value={statsLoading ? '-' : `${statistics?.expired_count || 0} 个`}
          subValue={statsLoading ? '-' : `${formatQuota(statistics?.expired_quota || 0)}`}
          icon={XCircle} 
          color="red" 
          className="border-l-4 border-l-red-500"
          onClick={() => setStatusFilter('expired')}
        />
      </div>

      {/* Total Stats Summary */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">总兑换码:</span>
            <span className="font-semibold">{statsLoading ? '-' : statistics?.total_count || 0} 个</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">总额度价值:</span>
            <span className="font-semibold text-primary">{statsLoading ? '-' : formatQuota(statistics?.total_quota || 0)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Filter className="w-4 h-4" />
            筛选条件
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">名称搜索</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  type="text" 
                  value={nameFilter} 
                  onChange={(e) => setNameFilter(e.target.value)} 
                  placeholder="搜索兑换码名称..." 
                  className="pl-9" 
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">状态</label>
              <div className="relative">
                <Tag className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground z-10" />
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="pl-9">
                  <option value="">全部状态</option>
                  <option value="unused">未使用</option>
                  <option value="used">已使用</option>
                  <option value="expired">已过期</option>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">开始日期</label>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="pl-9" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">结束日期</label>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="pl-9" />
              </div>
            </div>
            <div className="flex items-end">
              <Button variant="ghost" className="w-full text-muted-foreground hover:text-foreground" onClick={() => { setNameFilter(''); setStatusFilter(''); setStartDate(''); setEndDate('') }}>
                清除筛选
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
          ) : codes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="bg-muted/50 p-4 rounded-full mb-4">
                <Ticket className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium">暂无兑换码</h3>
              <p className="text-muted-foreground mt-1 max-w-sm">
                当前没有找到任何兑换码。请尝试调整筛选条件或前往生成器创建新的兑换码。
              </p>
            </div>
          ) : (
            <div className="rounded-md border-t border-b sm:border-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-12 text-center">
                      <input 
                        type="checkbox" 
                        checked={selectedIds.size === codes.length && codes.length > 0} 
                        onChange={(e) => handleSelectAll(e.target.checked)} 
                        className="rounded border-input w-4 h-4 align-middle" 
                      />
                    </TableHead>
                    <TableHead>兑换码</TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead>额度 (USD)</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>使用用户</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>过期时间</TableHead>
                    <TableHead className="w-16 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codes.map((code) => (
                    <TableRow key={code.id} className="hover:bg-muted/50">
                      <TableCell className="text-center">
                        <input 
                          type="checkbox" 
                          checked={selectedIds.has(code.id)} 
                          onChange={(e) => handleSelectOne(code.id, e.target.checked)} 
                          className="rounded border-input w-4 h-4 align-middle" 
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 group">
                          <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{code.key}</code>
                          <button 
                            onClick={() => copyToClipboard(code.key)} 
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-opacity"
                            title="复制"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-sm">{code.name}</TableCell>
                      <TableCell className="font-medium text-green-600">{formatQuota(code.quota)}</TableCell>
                      <TableCell>
                        <Badge variant={code.status === 'unused' ? 'success' : code.status === 'used' ? 'secondary' : 'destructive'}>
                          {code.status === 'unused' ? '未使用' : code.status === 'used' ? '已使用' : '已过期'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {code.used_user_id > 0 ? (
                          <div
                            className="flex items-center gap-2 px-2 py-1 rounded-full bg-muted/50 hover:bg-primary/10 hover:text-primary transition-all cursor-pointer border border-transparent hover:border-primary/20 w-fit"
                            onClick={() => {
                              setSelectedUser({ id: code.used_user_id, username: code.used_username || `用户 #${code.used_user_id}` })
                              setAnalysisDialogOpen(true)
                            }}
                            title="查看用户分析"
                          >
                            <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 text-[10px] text-primary font-bold">
                              {(code.used_username || '#')[0]?.toUpperCase()}
                            </div>
                            <span className="font-medium text-sm whitespace-nowrap">
                              {code.used_username || `用户 #${code.used_user_id}`}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatTimestamp(code.created_time)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {code.expired_time > 0 ? (
                           <div className="flex items-center gap-1">
                             {code.expired_time * 1000 < Date.now() && <AlertCircle className="w-3 h-3 text-red-500" />}
                             {formatTimestamp(code.expired_time)}
                           </div>
                        ) : '永不过期'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => setDeleteDialog({ open: true, type: 'single', id: code.id })} 
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
                显示 {codes.length} 条，共 {total} 条
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

      {/* Delete Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open: boolean) => setDeleteDialog(prev => ({ ...prev, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              {deleteDialog.type === 'single' ? '确定要删除这个兑换码吗？此操作不可恢复。' : `确定要删除选中的 ${selectedIds.size} 个兑换码吗？此操作不可恢复。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, type: 'single' })} disabled={deleting}>取消</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />删除中...</> : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

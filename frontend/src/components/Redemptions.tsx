import { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import { Trash2, Copy, Ticket, Loader2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Select } from './ui/select'

interface RedemptionCode {
  id: number
  key: string
  name: string
  quota: number
  created_time: number
  redeemed_time: number
  used_user_id: number
  expired_time: number
  status: 'unused' | 'used' | 'expired'
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
  const [loading, setLoading] = useState(true)
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

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

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
        if (data.success) { showToast('success', '删除成功'); fetchCodes() }
        else showToast('error', data.error?.message || '删除失败')
      } else if (deleteDialog.type === 'batch') {
        const response = await fetch(`${apiUrl}/api/redemptions/batch`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
          body: JSON.stringify({ ids: Array.from(selectedIds) }),
        })
        const data = await response.json()
        if (data.success) { showToast('success', `成功删除 ${selectedIds.size} 个兑换码`); setSelectedIds(new Set()); fetchCodes() }
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
    await fetchCodes()
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

  const inputClass = "w-full px-3 py-2 border rounded-lg bg-background border-input focus:ring-2 focus:ring-primary focus:border-primary text-sm"

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">名称</label>
              <input type="text" value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} placeholder="搜索名称..." className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">状态</label>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="">全部</option>
                <option value="unused">未使用</option>
                <option value="used">已使用</option>
                <option value="expired">已过期</option>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">开始日期</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">结束日期</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
            </div>
            <div className="flex items-end">
              <Button variant="secondary" className="w-full" onClick={() => { setNameFilter(''); setStatusFilter(''); setStartDate(''); setEndDate('') }}>
                清除筛选
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg">兑换码管理 ({total})</CardTitle>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading}>
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
          {selectedIds.size > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setDeleteDialog({ open: true, type: 'batch' })}>
              <Trash2 className="h-4 w-4 mr-1" />
              删除选中 ({selectedIds.size})
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : codes.length === 0 ? (
            <div className="text-center py-12">
              <Ticket className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-2 text-sm font-medium">暂无兑换码</h3>
              <p className="mt-1 text-sm text-muted-foreground">去生成器页面添加兑换码</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <input type="checkbox" checked={selectedIds.size === codes.length && codes.length > 0} onChange={(e) => handleSelectAll(e.target.checked)} className="rounded border-input" />
                    </TableHead>
                    <TableHead>兑换码</TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead>额度</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>过期时间</TableHead>
                    <TableHead className="w-16">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codes.map((code) => (
                    <TableRow key={code.id}>
                      <TableCell>
                        <input type="checkbox" checked={selectedIds.has(code.id)} onChange={(e) => handleSelectOne(code.id, e.target.checked)} className="rounded border-input" />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-mono">{code.key}</code>
                          <button onClick={() => copyToClipboard(code.key)} className="text-muted-foreground hover:text-primary p-1">
                            <Copy className="h-4 w-4" />
                          </button>
                        </div>
                      </TableCell>
                      <TableCell>{code.name}</TableCell>
                      <TableCell className="font-medium text-green-600">{formatQuota(code.quota)}</TableCell>
                      <TableCell>
                        <Badge variant={code.status === 'unused' ? 'success' : code.status === 'used' ? 'default' : 'secondary'}>
                          {code.status === 'unused' ? '未使用' : code.status === 'used' ? '已使用' : '已过期'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatTimestamp(code.created_time)}</TableCell>
                      <TableCell className="text-muted-foreground">{code.expired_time > 0 ? formatTimestamp(code.expired_time) : '永不过期'}</TableCell>
                      <TableCell>
                        <button onClick={() => setDeleteDialog({ open: true, type: 'single', id: code.id })} className="text-destructive hover:text-destructive/80 p-1">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="px-4 py-3 border-t flex items-center justify-between">
                <div className="text-sm text-muted-foreground">共 {total} 条记录，第 {page} / {totalPages} 页</div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>上一页</Button>
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>下一页</Button>
                </div>
              </div>
            </>
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
    </div>
  )
}

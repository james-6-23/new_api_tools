import { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import { CreditCard, Loader2, RefreshCw, Copy, ExternalLink, CheckCircle2, Clock, XCircle, Search, Calendar, Filter, Undo2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Select } from './ui/select'
import { Input } from './ui/input'
import { StatCard } from './StatCard'
import { cn } from '../lib/utils'

interface TopUpRecord {
  id: number
  user_id: number
  username: string | null
  amount: number
  money: number
  trade_no: string
  payment_method: string
  create_time: number
  complete_time: number
  status: string
}

interface TopUpStatistics {
  total_count: number
  total_amount: number
  total_money: number
  success_count: number
  success_amount: number
  success_money: number
  pending_count: number
  pending_amount: number
  pending_money: number
  failed_count: number
  failed_amount: number
  failed_money: number
  refunded_count: number
  refunded_amount: number
  refunded_money: number
}

interface PaginatedResponse {
  items: TopUpRecord[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

type StatusFilter = '' | 'pending' | 'success' | 'failed' | 'refunded'

export function TopUps() {
  const { showToast } = useToast()
  const { token } = useAuth()

  const [records, setRecords] = useState<TopUpRecord[]>([])
  const [statistics, setStatistics] = useState<TopUpStatistics | null>(null)
  const [paymentMethods, setPaymentMethods] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('')
  const [tradeNoSearch, setTradeNoSearch] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refundingId, setRefundingId] = useState<number | null>(null)
  const [showRefundModal, setShowRefundModal] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<TopUpRecord | null>(null)

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  // Fetch payment methods
  useEffect(() => {
    const fetchPaymentMethods = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/top-ups/payment-methods`, { headers: getAuthHeaders() })
        const data = await response.json()
        if (data.success) setPaymentMethods(data.data)
      } catch (error) { console.error('Failed to fetch payment methods:', error) }
    }
    fetchPaymentMethods()
  }, [apiUrl, getAuthHeaders])

  const fetchStatistics = useCallback(async () => {
    setStatsLoading(true)
    try {
      const params = new URLSearchParams()
      if (startDate) params.append('start_date', startDate)
      if (endDate) params.append('end_date', endDate)
      const response = await fetch(`${apiUrl}/api/top-ups/statistics?${params.toString()}`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) setStatistics(data.data)
    } catch (error) {
      console.error('Failed to fetch statistics:', error)
    } finally { setStatsLoading(false) }
  }, [apiUrl, getAuthHeaders, startDate, endDate])

  const fetchRecords = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: page.toString(), page_size: pageSize.toString() })
      if (statusFilter) params.append('status', statusFilter)
      if (paymentMethodFilter) params.append('payment_method', paymentMethodFilter)
      if (tradeNoSearch) params.append('trade_no', tradeNoSearch)
      if (startDate) params.append('start_date', startDate)
      if (endDate) params.append('end_date', endDate)

      const response = await fetch(`${apiUrl}/api/top-ups?${params.toString()}`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) {
        const result: PaginatedResponse = data.data
        setRecords(result.items)
        setTotal(result.total)
        setTotalPages(result.total_pages)
      } else { showToast('error', data.error?.message || '获取充值记录失败') }
    } catch (error) {
      showToast('error', '网络错误，请重试')
      console.error('Failed to fetch records:', error)
    } finally { setLoading(false) }
  }, [apiUrl, getAuthHeaders, page, pageSize, statusFilter, paymentMethodFilter, tradeNoSearch, startDate, endDate, showToast])

  useEffect(() => { fetchRecords() }, [fetchRecords])
  useEffect(() => { fetchStatistics() }, [fetchStatistics])
  useEffect(() => { setPage(1) }, [statusFilter, paymentMethodFilter, tradeNoSearch, startDate, endDate])

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchRecords(), fetchStatistics()])
    setRefreshing(false)
    showToast('success', '数据已刷新')
  }

  const openRefundModal = (record: TopUpRecord) => {
    setSelectedRecord(record)
    setShowRefundModal(true)
  }

  const handleRefund = async () => {
    if (!selectedRecord) return

    setRefundingId(selectedRecord.id)
    try {
      const response = await fetch(`${apiUrl}/api/top-ups/${selectedRecord.id}/refund`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (response.ok && data.success) {
        showToast('success', '退款成功')
        setShowRefundModal(false)
        fetchRecords()
        fetchStatistics()
      } else {
        showToast('error', data.error?.message || '退款失败')
      }
    } catch {
      showToast('error', '网络错误，请重试')
    } finally {
      setRefundingId(null)
    }
  }

  const formatTimestamp = (ts: number) => ts ? new Date(ts * 1000).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'
  const formatAmount = (amount: number) => amount.toFixed(2)
  const formatMoney = (money: number) => `¥${money.toFixed(2)}`

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">充值记录</h2>
          <p className="text-muted-foreground mt-1">查看所有用户的充值历史与状态</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading} className="h-9">
            <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.open('https://credit.linux.do/home', '_blank')} className="h-9">
            <ExternalLink className="h-4 w-4 mr-2" />
            LINUX DO Credit
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="成功充值"
          value={statsLoading ? '-' : `${statistics?.success_count || 0} 笔`}
          subValue={statsLoading ? '-' : `${formatMoney(statistics?.success_money || 0)}`}
          icon={CheckCircle2}
          color="green"
          className="border-l-4 border-l-green-500"
          onClick={() => setStatusFilter('success')}
        />
        <StatCard
          title="待处理"
          value={statsLoading ? '-' : `${statistics?.pending_count || 0} 笔`}
          subValue={statsLoading ? '-' : `${formatMoney(statistics?.pending_money || 0)}`}
          icon={Clock}
          color="yellow"
          className="border-l-4 border-l-yellow-500"
          onClick={() => setStatusFilter('pending')}
        />
        <StatCard
          title="充值失败"
          value={statsLoading ? '-' : `${statistics?.failed_count || 0} 笔`}
          subValue={statsLoading ? '-' : `${formatMoney(statistics?.failed_money || 0)}`}
          icon={XCircle}
          color="red"
          className="border-l-4 border-l-red-500"
          onClick={() => setStatusFilter('failed')}
        />
        <StatCard
          title="已退款"
          value={statsLoading ? '-' : `${statistics?.refunded_count || 0} 笔`}
          subValue={statsLoading ? '-' : `${formatMoney(statistics?.refunded_money || 0)}`}
          icon={Undo2}
          color="gray"
          className="border-l-4 border-l-gray-500"
          onClick={() => setStatusFilter('refunded')}
        />
      </div>

      {/* Total Stats Summary */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">总充值:</span>
            <span className="font-semibold">{statsLoading ? '-' : statistics?.total_count || 0} 笔</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">总金额:</span>
            <span className="font-semibold text-primary">{statsLoading ? '-' : formatMoney(statistics?.total_money || 0)}</span>
          </div>
          <div className="flex items-center gap-2">
             <span className="text-muted-foreground">总额度:</span>
             <span className="font-semibold">{statsLoading ? '-' : formatAmount(statistics?.total_amount || 0)} USD</span>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">状态</label>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="">全部状态</option>
                <option value="success">成功</option>
                <option value="pending">待处理</option>
                <option value="failed">失败</option>
                <option value="refunded">已退款</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">支付方式</label>
              <Select value={paymentMethodFilter} onChange={(e) => setPaymentMethodFilter(e.target.value)}>
                <option value="">全部方式</option>
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>{method}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1 lg:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">交易号搜索</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  type="text" 
                  value={tradeNoSearch} 
                  onChange={(e) => setTradeNoSearch(e.target.value)} 
                  placeholder="输入交易号..." 
                  className="pl-9" 
                />
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
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setStatusFilter(''); setPaymentMethodFilter(''); setTradeNoSearch(''); setStartDate(''); setEndDate('') }} className="text-muted-foreground hover:text-foreground">
              重置筛选
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Records Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center items-center py-20">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="bg-muted/50 p-4 rounded-full mb-4">
                <CreditCard className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium">暂无记录</h3>
              <p className="text-muted-foreground mt-1 max-w-sm">
                没有找到符合条件的充值记录。请尝试调整筛选条件或等待用户充值。
              </p>
            </div>
          ) : (
            <div className="rounded-md border-t border-b sm:border-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-[80px]">ID</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead>额度 (USD)</TableHead>
                    <TableHead>金额 (CNY)</TableHead>
                    <TableHead>交易号</TableHead>
                    <TableHead>支付方式</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>时间</TableHead>
                    <TableHead className="w-[80px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record) => (
                    <TableRow key={record.id} className="hover:bg-muted/50">
                      <TableCell className="font-mono text-xs text-muted-foreground">{record.id}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{record.username || '未知用户'}</span>
                          <span className="text-xs text-muted-foreground">ID: {record.user_id}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-green-600">{formatAmount(record.amount)}</TableCell>
                      <TableCell className="font-medium">{formatMoney(record.money)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 max-w-[200px]">
                          <span className="font-mono text-xs text-muted-foreground truncate" title={record.trade_no}>
                            {record.trade_no}
                          </span>
                          {record.trade_no && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 ml-1 flex-shrink-0"
                              onClick={async () => {
                                try {
                                  if (navigator.clipboard && window.isSecureContext) {
                                    await navigator.clipboard.writeText(record.trade_no)
                                  } else {
                                    const textArea = document.createElement('textarea')
                                    textArea.value = record.trade_no
                                    textArea.style.position = 'fixed'
                                    textArea.style.left = '-9999px'
                                    document.body.appendChild(textArea)
                                    textArea.select()
                                    document.execCommand('copy')
                                    document.body.removeChild(textArea)
                                  }
                                  showToast('success', '已复制')
                                } catch { showToast('error', '复制失败') }
                              }}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal">{record.payment_method}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={record.status === 'success' ? 'success' : record.status === 'pending' ? 'warning' : record.status === 'refunded' ? 'secondary' : 'destructive'}>
                          {record.status === 'success' ? '成功' : record.status === 'pending' ? '待处理' : record.status === 'refunded' ? '已退款' : '失败'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div className="flex flex-col">
                          <span>创建: {formatTimestamp(record.create_time)}</span>
                          {record.complete_time > 0 && <span>完成: {formatTimestamp(record.complete_time)}</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {record.status === 'success' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-muted-foreground hover:text-destructive"
                            onClick={() => openRefundModal(record)}
                            disabled={refundingId === record.id}
                          >
                            {refundingId === record.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3 mr-1" />}
                            退款
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          
          {/* Pagination */}
          {records.length > 0 && (
            <div className="px-4 py-4 border-t flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                显示 {records.length} 条，共 {total} 条
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  上一页
                </Button>
                <div className="flex items-center px-2 text-sm font-medium">
                  {page} / {totalPages}
                </div>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Refund Modal */}
      {showRefundModal && selectedRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowRefundModal(false)}>
          <Card className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle className="text-lg">确认退款</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted/50 p-3 rounded-md space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">用户</span>
                  <span className="font-medium">{selectedRecord.username || '未知用户'} (ID: {selectedRecord.user_id})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">充值额度</span>
                  <span className="font-medium text-green-600">{formatAmount(selectedRecord.amount)} USD</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">支付金额</span>
                  <span className="font-medium">{formatMoney(selectedRecord.money)}</span>
                </div>
              </div>

              <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
                退款后将自动扣减用户对应额度，此操作不可撤销。
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowRefundModal(false)}>取消</Button>
                <Button
                  variant="destructive"
                  onClick={handleRefund}
                  disabled={refundingId !== null}
                >
                  {refundingId !== null ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  确认退款
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

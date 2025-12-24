import { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import { CreditCard, Loader2, RefreshCw, Copy, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Select } from './ui/select'

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
}

interface PaginatedResponse {
  items: TopUpRecord[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

type StatusFilter = '' | 'pending' | 'success' | 'failed'

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

  const formatTimestamp = (ts: number) => ts ? new Date(ts * 1000).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'
  const formatAmount = (amount: number) => amount.toFixed(2)
  const formatMoney = (money: number) => `¥${money.toFixed(2)}`

  const inputClass = "w-full px-3 py-2 border rounded-lg bg-background border-input focus:ring-2 focus:ring-primary focus:border-primary text-sm"

  return (
    <div className="space-y-6">
      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 成功统计 */}
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">成功充值</p>
                <p className="text-2xl font-bold text-green-600">{statsLoading ? '-' : `${statistics?.success_count || 0} 笔`}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">额度</p>
                <p className="text-lg font-semibold">{statsLoading ? '-' : formatAmount(statistics?.success_amount || 0)}</p>
                <p className="text-sm text-green-600">{statsLoading ? '-' : formatMoney(statistics?.success_money || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 待处理统计 */}
        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">待处理</p>
                <p className="text-2xl font-bold text-yellow-600">{statsLoading ? '-' : `${statistics?.pending_count || 0} 笔`}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">额度</p>
                <p className="text-lg font-semibold">{statsLoading ? '-' : formatAmount(statistics?.pending_amount || 0)}</p>
                <p className="text-sm text-yellow-600">{statsLoading ? '-' : formatMoney(statistics?.pending_money || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 失败统计 */}
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">失败</p>
                <p className="text-2xl font-bold text-red-600">{statsLoading ? '-' : `${statistics?.failed_count || 0} 笔`}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">额度</p>
                <p className="text-lg font-semibold">{statsLoading ? '-' : formatAmount(statistics?.failed_amount || 0)}</p>
                <p className="text-sm text-red-600">{statsLoading ? '-' : formatMoney(statistics?.failed_money || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 总计统计 */}
      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <div>
                <p className="text-sm text-muted-foreground">总充值次数</p>
                <p className="text-xl font-bold">{statsLoading ? '-' : `${statistics?.total_count || 0} 笔`}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">总充值额度</p>
                <p className="text-xl font-bold">{statsLoading ? '-' : formatAmount(statistics?.total_amount || 0)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">总充值金额</p>
                <p className="text-xl font-bold text-primary">{statsLoading ? '-' : formatMoney(statistics?.total_money || 0)}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">状态</label>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="">全部</option>
                <option value="success">成功</option>
                <option value="pending">待处理</option>
                <option value="failed">失败</option>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">支付方式</label>
              <Select value={paymentMethodFilter} onChange={(e) => setPaymentMethodFilter(e.target.value)}>
                <option value="">全部</option>
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>{method}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">交易号</label>
              <input type="text" value={tradeNoSearch} onChange={(e) => setTradeNoSearch(e.target.value)} placeholder="搜索交易号..." className={inputClass} />
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
              <Button variant="secondary" className="w-full" onClick={() => { setStatusFilter(''); setPaymentMethodFilter(''); setTradeNoSearch(''); setStartDate(''); setEndDate('') }}>
                清除筛选
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Records Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg">充值记录 ({total})</CardTitle>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading}>
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.open('https://credit.linux.do/home', '_blank')}>
              <ExternalLink className="h-4 w-4 mr-1" />
              LINUX DO Credit
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-12">
              <CreditCard className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-2 text-sm font-medium">暂无记录</h3>
              <p className="mt-1 text-sm text-muted-foreground">没有找到充值记录</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead>额度</TableHead>
                    <TableHead>金额</TableHead>
                    <TableHead>交易号</TableHead>
                    <TableHead>支付方式</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>完成时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell>{record.id}</TableCell>
                      <TableCell>
                        <span>{record.username || `用户${record.user_id}`}</span>
                        <span className="text-xs text-muted-foreground ml-1">#{record.user_id}</span>
                      </TableCell>
                      <TableCell className="font-medium text-green-600">{formatAmount(record.amount)}</TableCell>
                      <TableCell className="font-medium">{formatMoney(record.money)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-muted-foreground">{record.trade_no}</span>
                          {record.trade_no && (
                            <button
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
                                  showToast('success', '已复制交易号')
                                } catch {
                                  showToast('error', '复制失败')
                                }
                              }}
                              className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
                              title="复制交易号"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{record.payment_method}</TableCell>
                      <TableCell>
                        <Badge variant={record.status === 'success' ? 'success' : record.status === 'pending' ? 'warning' : 'destructive'}>
                          {record.status === 'success' ? '成功' : record.status === 'pending' ? '待处理' : '失败'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatTimestamp(record.create_time)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatTimestamp(record.complete_time)}</TableCell>
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
    </div>
  )
}

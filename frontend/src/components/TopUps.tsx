import { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import { CreditCard, Loader2, RefreshCw, Copy, ExternalLink, CheckCircle2, Clock, XCircle, Search, Calendar, Filter, Download, BarChart3, ListOrdered, ShieldCheck, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Select } from './ui/select'
import { Input } from './ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { StatCard } from './StatCard'
import { TopUpAnalytics } from './TopUpAnalytics'
import { TopUpAudit } from './TopUpAudit'
import { cn } from '../lib/utils'

interface TopUpRecord {
  id: number
  user_id: number
  username: string | null
  amount: number
  money: number
  trade_no: string
  payment_method: string
  payment_provider: string
  create_time: number
  complete_time: number
  status: string
  status_bucket: string
  completion_seconds: number
  anomaly_reasons?: string[]
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
  expired_count: number
  expired_amount: number
  expired_money: number
  unknown_count: number
  unknown_amount: number
  unknown_money: number
}

interface PaginatedResponse {
  items: TopUpRecord[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

type StatusFilter = '' | 'pending' | 'success' | 'failed' | 'expired' | 'unknown'

function getStatusLabel(status: string) {
  if (status === 'success') return '成功'
  if (status === 'pending') return '待处理'
  if (status === 'failed') return '失败'
  if (status === 'expired') return '已过期'
  if (status === 'unknown') return '未知'
  return status || '-'
}

function getStatusVariant(status: string): 'success' | 'warning' | 'destructive' | 'outline' {
  if (status === 'success') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'failed') return 'destructive'
  return 'outline'
}

export function TopUps() {
  const { showToast } = useToast()
  const { token } = useAuth()

  const [activeTab, setActiveTab] = useState<'records' | 'analytics' | 'audit'>('records')
  const [records, setRecords] = useState<TopUpRecord[]>([])
  const [statistics, setStatistics] = useState<TopUpStatistics | null>(null)
  const [paymentMethods, setPaymentMethods] = useState<string[]>([])
  const [paymentProviders, setPaymentProviders] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('')
  const [paymentProviderFilter, setPaymentProviderFilter] = useState('')
  const [tradeNoSearch, setTradeNoSearch] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  // Fetch payment methods/providers
  useEffect(() => {
    const fetchPaymentFilters = async () => {
      try {
        const [methodsRes, providersRes] = await Promise.all([
          fetch(`${apiUrl}/api/top-ups/payment-methods`, { headers: getAuthHeaders() }),
          fetch(`${apiUrl}/api/top-ups/payment-providers`, { headers: getAuthHeaders() }),
        ])
        const methodsData = await methodsRes.json()
        const providersData = await providersRes.json()
        setPaymentMethods(methodsData.success && Array.isArray(methodsData.data) ? methodsData.data : [])
        setPaymentProviders(providersData.success && Array.isArray(providersData.data) ? providersData.data : [])
      } catch (error) { console.error('Failed to fetch payment methods:', error) }
    }
    fetchPaymentFilters()
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
      if (paymentProviderFilter) params.append('payment_provider', paymentProviderFilter)
      if (tradeNoSearch) params.append('trade_no', tradeNoSearch)
      if (startDate) params.append('start_date', startDate)
      if (endDate) params.append('end_date', endDate)

      const response = await fetch(`${apiUrl}/api/top-ups?${params.toString()}`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) {
        const result: PaginatedResponse = data.data
        setRecords(Array.isArray(result?.items) ? result.items : [])
        setTotal(typeof result?.total === 'number' ? result.total : 0)
        setTotalPages(typeof result?.total_pages === 'number' ? result.total_pages : 1)
      } else { showToast('error', data.error?.message || '获取充值记录失败') }
    } catch (error) {
      showToast('error', '网络错误，请重试')
      console.error('Failed to fetch records:', error)
    } finally { setLoading(false) }
  }, [apiUrl, getAuthHeaders, page, pageSize, statusFilter, paymentMethodFilter, paymentProviderFilter, tradeNoSearch, startDate, endDate, showToast])

  useEffect(() => { fetchRecords() }, [fetchRecords])
  useEffect(() => { fetchStatistics() }, [fetchStatistics])
  useEffect(() => { setPage(1) }, [statusFilter, paymentMethodFilter, paymentProviderFilter, tradeNoSearch, startDate, endDate])

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchRecords(), fetchStatistics()])
    setRefreshing(false)
    showToast('success', '数据已刷新')
  }

  // 复用记录 tab 的过滤条件导出 CSV。fetch + blob 走 Authorization；
  // 后端 400 EXPORT_TOO_LARGE 时响应是 JSON，需要按 content-type 分支处理。
  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.append('status', statusFilter)
      if (paymentMethodFilter) params.append('payment_method', paymentMethodFilter)
      if (paymentProviderFilter) params.append('payment_provider', paymentProviderFilter)
      if (tradeNoSearch) params.append('trade_no', tradeNoSearch)
      if (startDate) params.append('start_date', startDate)
      if (endDate) params.append('end_date', endDate)

      const response = await fetch(`${apiUrl}/api/top-ups/export?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const contentType = response.headers.get('Content-Type') || ''
      if (!response.ok || contentType.includes('application/json')) {
        let msg = '导出失败'
        try {
          const errBody = await response.json()
          msg = errBody?.error?.message || errBody?.message || msg
        } catch { /* not JSON */ }
        showToast('error', msg)
        return
      }

      const blob = await response.blob()
      // 文件名优先取响应头里的，落空再用本地时间
      let filename = `top_ups_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`
      const cd = response.headers.get('Content-Disposition') || ''
      const match = cd.match(/filename="?([^"]+)"?/)
      if (match) filename = match[1]

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast('success', '导出已开始下载')
    } catch (error) {
      console.error('Export failed:', error)
      showToast('error', '网络错误，导出失败')
    } finally {
      setExporting(false)
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
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading} className="h-9">
            <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting} className="h-9" title="按当前筛选导出 CSV">
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            {exporting ? '导出中...' : '导出 CSV'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.open('https://credit.linux.do/home', '_blank')} className="h-9">
            <ExternalLink className="h-4 w-4 mr-2" />
            LINUX DO Credit
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'records' | 'analytics' | 'audit')} className="w-full">
        <TabsList className="grid w-full max-w-xl grid-cols-3">
          <TabsTrigger value="records" className="gap-2">
            <ListOrdered className="h-4 w-4" />
            记录
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            分析
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2">
            <ShieldCheck className="h-4 w-4" />
            审计
          </TabsTrigger>
        </TabsList>

        {/* forceMount + data-state hide：让"记录"tab 的状态/分页/筛选在切换 tab 时不丢，
            重新切回不会触发重新 fetch（fetchRecords 依赖未变）。 */}
        <TabsContent value="records" forceMount className="data-[state=inactive]:hidden mt-6 space-y-6">
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
              title="已过期"
              value={statsLoading ? '-' : `${statistics?.expired_count || 0} 笔`}
              subValue={statsLoading ? '-' : `${formatMoney(statistics?.expired_money || 0)}`}
              icon={AlertTriangle}
              color="gray"
              className="border-l-4 border-l-slate-500"
              onClick={() => setStatusFilter('expired')}
            />
          </div>

          {/* Total Stats Summary —— 仅统计成功充值（不含待处理 / 失败） */}
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="p-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">成功充值:</span>
                <span className="font-semibold">{statsLoading ? '-' : statistics?.success_count || 0} 笔</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">实收金额:</span>
                <span className="font-semibold text-primary">{statsLoading ? '-' : formatMoney(statistics?.success_money || 0)}</span>
              </div>
              <div className="flex items-center gap-2">
                 <span className="text-muted-foreground">入账额度:</span>
                 <span className="font-semibold">{statsLoading ? '-' : formatAmount(statistics?.success_amount || 0)} USD</span>
              </div>
              {(statistics?.unknown_count || 0) > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">未知状态:</span>
                  <button className="font-semibold text-amber-600 hover:underline" onClick={() => setStatusFilter('unknown')}>
                    {statistics?.unknown_count || 0} 笔
                  </button>
                </div>
              )}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">状态</label>
                  <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                    <option value="">全部状态</option>
                    <option value="success">成功</option>
                    <option value="pending">待处理</option>
                    <option value="failed">失败</option>
                    <option value="expired">已过期</option>
                    <option value="unknown">未知</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">支付渠道</label>
                  <Select value={paymentProviderFilter} onChange={(e) => setPaymentProviderFilter(e.target.value)}>
                    <option value="">全部渠道</option>
                    {paymentProviders.map((provider) => (
                      <option key={provider} value={provider}>{provider}</option>
                    ))}
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
                <Button variant="ghost" size="sm" onClick={() => { setStatusFilter(''); setPaymentMethodFilter(''); setPaymentProviderFilter(''); setTradeNoSearch(''); setStartDate(''); setEndDate('') }} className="text-muted-foreground hover:text-foreground">
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
                        <TableHead>支付渠道</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>异常</TableHead>
                        <TableHead>时间</TableHead>
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
                            <div className="flex flex-col gap-1">
                              <Badge variant="outline" className="font-normal w-fit">{record.payment_provider || '未知'}</Badge>
                              <span className="text-xs text-muted-foreground">{record.payment_method || '未知方式'}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={getStatusVariant(record.status_bucket || record.status)}>
                              {getStatusLabel(record.status_bucket || record.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {record.anomaly_reasons && record.anomaly_reasons.length > 0 ? (
                              <div className="flex flex-wrap gap-1 max-w-[180px]">
                                {record.anomaly_reasons.slice(0, 2).map(reason => (
                                  <Badge key={reason} variant="outline" className="font-normal">{reason}</Badge>
                                ))}
                                {record.anomaly_reasons.length > 2 && <span className="text-xs text-muted-foreground">+{record.anomaly_reasons.length - 2}</span>}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <div className="flex flex-col">
                              <span>创建: {formatTimestamp(record.create_time)}</span>
                              {record.complete_time > 0 && <span>完成: {formatTimestamp(record.complete_time)}</span>}
                            </div>
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
        </TabsContent>

        {/* 分析 tab：首次进入时挂载并 fetch；后续切换由 forceMount 保活避免重 fetch。 */}
        <TabsContent value="analytics" forceMount className="data-[state=inactive]:hidden mt-6">
          <TopUpAnalytics active={activeTab === 'analytics'} />
        </TabsContent>

        <TabsContent value="audit" forceMount className="data-[state=inactive]:hidden mt-6">
          <TopUpAudit active={activeTab === 'audit'} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

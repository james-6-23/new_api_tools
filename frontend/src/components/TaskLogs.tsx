import { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'
import {
  ListChecks, Loader2, RefreshCw, Filter, Search, CheckCircle2, XCircle, Clock,
  ChevronDown, ChevronRight, Link2, Coins,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Select } from './ui/select'
import { Input } from './ui/input'
import { StatCard } from './StatCard'
import { cn } from '../lib/utils'

interface TaskRecord {
  id: number
  task_id: string
  platform: string
  user_id: number
  username: string
  channel_id: number
  task_group: string
  quota: number
  action: string
  status: string
  progress: string
  fail_reason: string
  submit_time: number
  start_time: number
  finish_time: number
}

interface RelatedLog {
  id: number
  created_at: number
  type: number
  model_name: string
  quota: number
  token_name: string
  content: string
  ip: string
  match_type: 'exact' | 'heuristic'
}

interface StatusStat { status: string; count: number; quota: number }
interface PlatformStat { platform: string; count: number }

const STATUS_META: Record<string, { label: string; variant: 'success' | 'destructive' | 'warning' | 'secondary' }> = {
  SUCCESS: { label: '成功', variant: 'success' },
  FAILURE: { label: '失败', variant: 'destructive' },
  IN_PROGRESS: { label: '进行中', variant: 'warning' },
  QUEUED: { label: '排队中', variant: 'warning' },
  SUBMITTED: { label: '已提交', variant: 'warning' },
  NOT_START: { label: '未开始', variant: 'secondary' },
  UNKNOWN: { label: '未知', variant: 'secondary' },
}

export function TaskLogs() {
  const { showToast } = useToast()
  const { token } = useAuth()

  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [byStatus, setByStatus] = useState<StatusStat[]>([])
  const [byPlatform, setByPlatform] = useState<PlatformStat[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [usernameSearch, setUsernameSearch] = useState('')
  const [taskIdSearch, setTaskIdSearch] = useState('')
  const [platformFilter, setPlatformFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  // 展开行：task db id → 关联日志（null = 加载中）
  const [expanded, setExpanded] = useState<Map<number, { logs: RelatedLog[]; exact: number; heuristic: number } | null>>(new Map())

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  const fetchStatistics = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/task-logs/statistics`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) {
        setByStatus(data.data.by_status || [])
        setByPlatform(data.data.by_platform || [])
      }
    } catch (error) { console.error('Failed to fetch task statistics:', error) }
  }, [apiUrl, getAuthHeaders])

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    setExpanded(new Map())
    try {
      const params = new URLSearchParams({ page: page.toString(), page_size: '20' })
      if (usernameSearch) params.append('username', usernameSearch)
      if (taskIdSearch.trim()) params.append('task_id', taskIdSearch.trim())
      if (platformFilter) params.append('platform', platformFilter)
      if (statusFilter) params.append('status', statusFilter)

      const response = await fetch(`${apiUrl}/api/task-logs?${params.toString()}`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) {
        setTasks(data.data.items || [])
        setTotal(data.data.total)
        setTotalPages(data.data.total_pages)
      } else {
        showToast('error', data.message || '获取任务日志失败')
      }
    } catch (error) {
      showToast('error', '网络错误，请重试')
      console.error('Failed to fetch tasks:', error)
    } finally { setLoading(false) }
  }, [apiUrl, getAuthHeaders, page, usernameSearch, taskIdSearch, platformFilter, statusFilter, showToast])

  useEffect(() => { fetchTasks() }, [fetchTasks])
  useEffect(() => { fetchStatistics() }, [fetchStatistics])
  useEffect(() => { setPage(1) }, [usernameSearch, taskIdSearch, platformFilter, statusFilter])

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchTasks(), fetchStatistics()])
    setRefreshing(false)
  }

  const toggleExpand = async (task: TaskRecord) => {
    setExpanded(prev => {
      const next = new Map(prev)
      if (next.has(task.id)) {
        next.delete(task.id)
        return next
      }
      next.set(task.id, null) // 加载中
      return next
    })
    if (expanded.has(task.id)) return
    try {
      const response = await fetch(`${apiUrl}/api/task-logs/${task.id}/related-logs`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) {
        setExpanded(prev => {
          if (!prev.has(task.id)) return prev // 已被折叠
          const next = new Map(prev)
          next.set(task.id, { logs: data.data.logs || [], exact: data.data.exact_count, heuristic: data.data.heuristic_count })
          return next
        })
      }
    } catch (error) { console.error('Failed to fetch related logs:', error) }
  }

  const formatQuota = (q: number) => `$${((Number(q) || 0) / 500000).toFixed(4)}`
  const formatTs = (ts: number) => {
    if (!ts || ts <= 0) return '-'
    return new Date(ts * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
  const duration = (t: TaskRecord) => {
    if (t.finish_time > 0 && t.submit_time > 0) {
      const d = t.finish_time - t.submit_time
      return d >= 60 ? `${Math.floor(d / 60)}m${d % 60}s` : `${d}s`
    }
    return '-'
  }

  const statusBadge = (status: string) => {
    const meta = STATUS_META[status] || { label: status || '-', variant: 'secondary' as const }
    return <Badge variant={meta.variant}>{meta.label}</Badge>
  }

  const statCount = (statuses: string[]) =>
    byStatus.filter(s => statuses.includes(s.status)).reduce((sum, s) => sum + Number(s.count), 0)
  const totalTasks = byStatus.reduce((sum, s) => sum + Number(s.count), 0)
  const totalQuota = byStatus.reduce((sum, s) => sum + Number(s.quota), 0)

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">任务日志</h2>
          <p className="text-muted-foreground mt-1">异步任务（生图/视频/音乐）记录，点击任务行查看关联的使用日志</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading} className="h-9">
          <RefreshCw className={cn('h-4 w-4 mr-2', refreshing && 'animate-spin')} />
          刷新
        </Button>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="任务总数" value={`${totalTasks}`} icon={ListChecks} color="blue" className="border-l-4 border-l-blue-500" onClick={() => setStatusFilter('')} />
        <StatCard title="成功" value={`${statCount(['SUCCESS'])}`} icon={CheckCircle2} color="green" className="border-l-4 border-l-green-500" onClick={() => setStatusFilter('SUCCESS')} />
        <StatCard title="失败" value={`${statCount(['FAILURE'])}`} icon={XCircle} color="red" className="border-l-4 border-l-red-500" onClick={() => setStatusFilter('FAILURE')} />
        <StatCard title="消耗额度" value={formatQuota(totalQuota)} icon={Coins} color="yellow" className="border-l-4 border-l-yellow-500" />
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">用户搜索</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="text" value={usernameSearch} onChange={(e) => setUsernameSearch(e.target.value)} placeholder="搜索用户名..." className="pl-9" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">任务 ID</label>
              <Input type="text" value={taskIdSearch} onChange={(e) => setTaskIdSearch(e.target.value)} placeholder="精确查找任务 ID..." className="font-mono" spellCheck={false} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">平台</label>
              <Select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
                <option value="">全部平台</option>
                {byPlatform.map(p => (
                  <option key={p.platform} value={p.platform}>{p.platform || '(空)'} ({p.count})</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">状态</label>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">全部状态</option>
                {Object.entries(STATUS_META).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </Select>
            </div>
            <div className="flex items-end justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setUsernameSearch(''); setTaskIdSearch(''); setPlatformFilter(''); setStatusFilter('') }} className="text-muted-foreground hover:text-foreground">
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
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="bg-muted/50 p-4 rounded-full mb-4">
                <ListChecks className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium">暂无任务</h3>
              <p className="text-muted-foreground mt-1 max-w-sm">
                没有找到符合条件的任务记录。NewAPI 产生异步任务（生图/视频/音乐）后会出现在这里。
              </p>
            </div>
          ) : (
            <div className="border-t border-b overflow-x-auto custom-scrollbar">
              <Table className="min-w-[960px]">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-[32px]"></TableHead>
                    <TableHead>任务 ID</TableHead>
                    <TableHead>平台 / 操作</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>额度</TableHead>
                    <TableHead>提交时间</TableHead>
                    <TableHead>耗时</TableHead>
                    <TableHead>失败原因</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((t) => {
                    const exp = expanded.get(t.id)
                    const isOpen = expanded.has(t.id)
                    return (
                      <>
                        <TableRow key={t.id} className="hover:bg-muted/50 cursor-pointer" onClick={() => toggleExpand(t)}>
                          <TableCell className="pr-0">
                            {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                          </TableCell>
                          <TableCell>
                            <code className="text-xs font-mono" title={t.task_id}>{t.task_id.length > 24 ? t.task_id.slice(0, 24) + '…' : t.task_id}</code>
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            <span className="font-medium">{t.platform || '-'}</span>
                            {t.action && <span className="text-muted-foreground"> / {t.action}</span>}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{t.username || `#${t.user_id}`}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {statusBadge(t.status)}
                              {t.progress && t.progress !== '100%' && t.status !== 'SUCCESS' && t.status !== 'FAILURE' && (
                                <span className="text-[10px] text-muted-foreground">{t.progress}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs font-mono">{formatQuota(t.quota)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatTs(t.submit_time)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">{duration(t)}</TableCell>
                          <TableCell className="text-xs text-red-500 max-w-[180px] truncate" title={t.fail_reason}>{t.fail_reason || '-'}</TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow key={`${t.id}-expand`} className="bg-muted/20 hover:bg-muted/20">
                            <TableCell colSpan={9} className="py-3 px-6">
                              {exp === null || exp === undefined ? (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />正在查找关联的使用日志...
                                </div>
                              ) : exp.logs.length === 0 ? (
                                <div className="text-xs text-muted-foreground py-2">
                                  未找到关联的使用日志（精确匹配需日志 other 字段含 task_id；推测匹配需额度/渠道/时间吻合）
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Link2 className="w-3.5 h-3.5" />
                                    关联使用日志 {exp.logs.length} 条
                                    {exp.exact > 0 && <Badge variant="success" className="text-[10px] px-1.5 py-0">精确 {exp.exact}</Badge>}
                                    {exp.heuristic > 0 && <Badge variant="warning" className="text-[10px] px-1.5 py-0">推测 {exp.heuristic}</Badge>}
                                  </div>
                                  <div className="rounded-md border bg-background overflow-x-auto">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead className="h-8 text-xs">日志 ID</TableHead>
                                          <TableHead className="h-8 text-xs">时间</TableHead>
                                          <TableHead className="h-8 text-xs">类型</TableHead>
                                          <TableHead className="h-8 text-xs">模型</TableHead>
                                          <TableHead className="h-8 text-xs text-right">额度</TableHead>
                                          <TableHead className="h-8 text-xs">令牌</TableHead>
                                          <TableHead className="h-8 text-xs">IP</TableHead>
                                          <TableHead className="h-8 text-xs">匹配</TableHead>
                                          <TableHead className="h-8 text-xs">内容</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {exp.logs.map(log => (
                                          <TableRow key={log.id}>
                                            <TableCell className="py-1.5 text-xs font-mono text-muted-foreground">{log.id}</TableCell>
                                            <TableCell className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">{formatTs(log.created_at)}</TableCell>
                                            <TableCell className="py-1.5">
                                              {log.type === 2 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">消费</span>}
                                              {log.type === 4 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">退款</span>}
                                              {log.type !== 2 && log.type !== 4 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400">类型{log.type}</span>}
                                            </TableCell>
                                            <TableCell className="py-1.5 font-mono text-xs">{log.model_name || '-'}</TableCell>
                                            <TableCell className="py-1.5 text-xs font-mono text-right">{formatQuota(log.quota)}</TableCell>
                                            <TableCell className="py-1.5 text-xs">{log.token_name || '-'}</TableCell>
                                            <TableCell className="py-1.5 font-mono text-xs text-muted-foreground">{log.ip || '-'}</TableCell>
                                            <TableCell className="py-1.5">
                                              {log.match_type === 'exact'
                                                ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 whitespace-nowrap">精确</span>
                                                : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400 whitespace-nowrap" title="按 用户+渠道+额度+时间窗 推测，非上游写入的关联">推测</span>}
                                            </TableCell>
                                            <TableCell className="py-1.5 text-xs text-muted-foreground max-w-[220px] truncate" title={log.content}>{log.content || '-'}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {total > 0 && (
            <div className="px-4 py-4 border-t flex items-center justify-between">
              <div className="text-sm text-muted-foreground">显示 {tasks.length} 条，共 {total} 条</div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>上一页</Button>
                <div className="flex items-center px-2 text-sm font-medium">{page} / {totalPages}</div>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 说明 */}
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" />
        关联说明：「精确」= 日志 other 字段带 task_id（结算/退款日志）；「推测」= 提交消费日志按 用户+渠道+额度+±2分钟时间窗 匹配（上游提交日志暂未写入 task_id）。
      </p>
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import {
  Users,
  UserCheck,
  UserX,
  Clock,
  Search,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table'
import { Select } from './ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { StatCard } from './StatCard'
import { cn } from '../lib/utils'

interface ActivityStats {
  total_users: number
  active_users: number
  inactive_users: number
  very_inactive_users: number
  never_requested: number
}

interface UserInfo {
  id: number
  username: string
  display_name: string | null
  email: string | null
  role: number
  status: number
  quota: number
  used_quota: number
  request_count: number
  group: string | null
  last_request_time: number | null
  activity_level: string
}

export function UserManagement() {
  const { token } = useAuth()
  const { showToast } = useToast()

  const [stats, setStats] = useState<ActivityStats | null>(null)
  const [users, setUsers] = useState<UserInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [activityFilter, setActivityFilter] = useState<string>('all')
  const [deleting, setDeleting] = useState(false)
  const [deletingVeryInactive, setDeletingVeryInactive] = useState(false)
  const [deletingNever, setDeletingNever] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean
    title: string
    message: string
    type: 'warning' | 'danger'
    onConfirm: () => void
    details?: { count: number; users: string[] }
    loading?: boolean
    activityLevel?: string
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'warning',
    onConfirm: () => {},
  })

  const apiUrl = import.meta.env.VITE_API_URL || ''

  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/users/stats`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) {
        setStats(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    }
  }, [apiUrl, getAuthHeaders])

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      })
      if (search) params.append('search', search)
      if (activityFilter && activityFilter !== 'all') params.append('activity', activityFilter)

      const response = await fetch(`${apiUrl}/api/users?${params}`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) {
        setUsers(data.data.items)
        setTotal(data.data.total)
        setTotalPages(data.data.total_pages)
      }
    } catch (error) {
      console.error('Failed to fetch users:', error)
      showToast('error', '加载用户列表失败')
    } finally {
      setLoading(false)
    }
  }, [apiUrl, getAuthHeaders, page, pageSize, search, activityFilter, showToast])

  const deleteUser = async (userId: number, username: string) => {
    const userToDelete = users.find(u => u.id === userId)
    setConfirmDialog({
      isOpen: true,
      title: '删除用户',
      message: `确定要删除用户 "${username}" 吗？此操作会同时删除该用户的所有 Token。`,
      type: 'danger',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }))
        setDeleting(true)
        try {
          const response = await fetch(`${apiUrl}/api/users/${userId}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
          })
          const data = await response.json()
          if (data.success) {
            showToast('success', data.message)
            // 直接从本地状态移除用户，避免重新加载
            setUsers(prev => prev.filter(u => u.id !== userId))
            setTotal(prev => prev - 1)
            // 更新统计数据（本地计算）
            if (stats && userToDelete) {
              const level = userToDelete.activity_level
              setStats(prev => prev ? {
                ...prev,
                total_users: prev.total_users - 1,
                active_users: level === 'active' ? prev.active_users - 1 : prev.active_users,
                inactive_users: level === 'inactive' ? prev.inactive_users - 1 : prev.inactive_users,
                very_inactive_users: level === 'very_inactive' ? prev.very_inactive_users - 1 : prev.very_inactive_users,
                never_requested: level === 'never' ? prev.never_requested - 1 : prev.never_requested,
              } : null)
            }
          } else {
            showToast('error', data.message || '删除失败')
          }
        } catch (error) {
          console.error('Failed to delete user:', error)
          showToast('error', '删除用户失败')
        } finally {
          setDeleting(false)
        }
      },
    })
  }

  const previewBatchDelete = async (level: string) => {
    // 先立即显示弹窗，带加载状态
    setConfirmDialog({
      isOpen: true,
      title: '批量删除用户',
      message: `正在查询${level === 'never' ? '从未请求' : '非常不活跃'}的用户...`,
      type: 'danger',
      loading: true,
      activityLevel: level,
      onConfirm: () => executeBatchDelete(level),
    })

    try {
      const response = await fetch(`${apiUrl}/api/users/batch-delete`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ activity_level: level, dry_run: true }),
      })
      const data = await response.json()
      if (data.success && data.data) {
        const count = data.data.count
        const usernames = data.data.users || []
        if (count === 0) {
          setConfirmDialog(prev => ({ ...prev, isOpen: false }))
          showToast('info', '没有符合条件的用户')
          return
        }
        // 更新弹窗内容
        setConfirmDialog(prev => ({
          ...prev,
          message: `确定要删除 ${count} 个${level === 'never' ? '从未请求' : '非常不活跃'}的用户吗？此操作不可恢复。`,
          details: { count, users: usernames },
          loading: false,
        }))
      } else {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }))
        showToast('error', data.message || '预览失败')
      }
    } catch (error) {
      console.error('Failed to preview batch delete:', error)
      setConfirmDialog(prev => ({ ...prev, isOpen: false }))
      showToast('error', '预览失败')
    }
  }

  const executeBatchDelete = async (level: string) => {
    setConfirmDialog(prev => ({ ...prev, isOpen: false }))
    const setLoading = level === 'very_inactive' ? setDeletingVeryInactive : setDeletingNever
    setLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/users/batch-delete`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ activity_level: level, dry_run: false }),
      })
      const data = await response.json()
      if (data.success) {
        showToast('success', data.message)
        // 并行刷新数据
        setPage(1)
        Promise.all([fetchUsers(), fetchStats()])
      } else {
        showToast('error', data.message || '批量删除失败')
      }
    } catch (error) {
      console.error('Failed to batch delete:', error)
      showToast('error', '批量删除失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    setPage(1)
    setSearch(searchInput)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchUsers(), fetchStats()])
    setRefreshing(false)
    showToast('success', '数据已刷新')
  }

  const formatQuota = (quota: number) => `$${(quota / 500000).toFixed(2)}`

  // 格式化最后请求时间
  // 快速模式下 last_request_time 为 null，根据 request_count 判断
  const formatLastRequest = (user: UserInfo) => {
    if (user.last_request_time) {
      return new Date(user.last_request_time * 1000).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    }
    // 快速模式：无精确时间
    if (user.request_count > 0) {
      return <span className="text-muted-foreground">有请求记录</span>
    }
    return <span className="text-muted-foreground">从未</span>
  }

  const getActivityBadge = (level: string) => {
    switch (level) {
      case 'active':
        return <Badge variant="success">活跃</Badge>
      case 'inactive':
        return <Badge variant="warning">不活跃</Badge>
      case 'very_inactive':
        return <Badge variant="destructive">非常不活跃</Badge>
      case 'never':
        return <Badge variant="secondary">从未请求</Badge>
      default:
        return <Badge variant="outline">{level}</Badge>
    }
  }

  const getRoleName = (role: number) => {
    switch (role) {
      case 1: return '普通用户'
      case 10: return '管理员'
      case 100: return '超级管理员'
      default: return `角色${role}`
    }
  }

  const getStatusBadge = (status: number) => {
    switch (status) {
      case 1:
        return <Badge variant="success">正常</Badge>
      case 2:
        return <Badge variant="destructive">禁用</Badge>
      default:
        return <Badge variant="outline">未知</Badge>
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">用户管理</h2>
          <p className="text-muted-foreground mt-1">查看和管理所有用户及其状态</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading} className="h-9">
          <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
          刷新
        </Button>
      </div>

      {/* Activity Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="活跃用户"
          value={stats?.active_users || 0}
          subValue="7天内有请求"
          icon={UserCheck}
          color="green"
          onClick={() => { setActivityFilter('active'); setPage(1) }}
          className={cn(activityFilter === 'active' && "ring-2 ring-primary ring-offset-2")}
        />
        <StatCard
          title="不活跃用户"
          value={stats?.inactive_users || 0}
          subValue="7-30天内有请求"
          icon={Clock}
          color="yellow"
          onClick={() => { setActivityFilter('inactive'); setPage(1) }}
          className={cn(activityFilter === 'inactive' && "ring-2 ring-primary ring-offset-2")}
        />
        <StatCard
          title="非常不活跃"
          value={stats?.very_inactive_users || 0}
          subValue="超过30天无请求"
          icon={UserX}
          color="red"
          onClick={() => { setActivityFilter('very_inactive'); setPage(1) }}
          className={cn(activityFilter === 'very_inactive' && "ring-2 ring-primary ring-offset-2")}
        />
        <StatCard
          title="从未请求"
          value={stats?.never_requested || 0}
          subValue="注册后未使用"
          icon={Users}
          color="gray"
          onClick={() => { setActivityFilter('never'); setPage(1) }}
          className={cn(activityFilter === 'never' && "ring-2 ring-primary ring-offset-2")}
        />
      </div>

      {/* Batch Delete Actions */}
      <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-900">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <h3 className="font-medium text-orange-800 dark:text-orange-200">批量清理不活跃用户</h3>
                <p className="text-sm text-orange-600 dark:text-orange-400">删除后不可恢复，请谨慎操作</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="border-orange-300 text-orange-700 hover:bg-orange-100 hover:text-orange-800 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-900"
                onClick={() => previewBatchDelete('very_inactive')}
                disabled={deletingVeryInactive || !stats?.very_inactive_users}
              >
                {deletingVeryInactive ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                清理非常不活跃 ({stats?.very_inactive_users || 0})
              </Button>
              <Button
                variant="outline"
                className="border-gray-300 text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                onClick={() => previewBatchDelete('never')}
                disabled={deletingNever || !stats?.never_requested}
              >
                {deletingNever ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                清理从未请求 ({stats?.never_requested || 0})
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search and Filter */}
      <Card>
        <CardHeader className="pb-3">
           <CardTitle className="text-base font-medium flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4" />
                用户列表
                <span className="ml-2 text-sm font-normal text-muted-foreground">共 {total} 个</span>
              </div>
              {activityFilter !== 'all' && (
                <Button variant="ghost" size="sm" onClick={() => { setActivityFilter('all'); setPage(1) }} className="h-8 text-xs">
                  清除筛选: {activityFilter === 'active' ? '活跃' : activityFilter === 'inactive' ? '不活跃' : activityFilter === 'very_inactive' ? '非常不活跃' : '从未请求'}
                </Button>
              )}
           </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <div className="flex-1 flex gap-2">
              <div className="relative flex-1 max-w-sm">
                 <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                 <Input
                   placeholder="搜索用户名或邮箱..."
                   value={searchInput}
                   onChange={(e) => setSearchInput(e.target.value)}
                   onKeyPress={handleKeyPress}
                   className="pl-9"
                 />
              </div>
              <Button onClick={handleSearch}>搜索</Button>
            </div>
            <div className="w-full sm:w-48">
              <Select value={activityFilter} onChange={(e) => { setActivityFilter(e.target.value); setPage(1) }}>
                <option value="all">所有状态</option>
                <option value="active">活跃用户</option>
                <option value="inactive">不活跃用户</option>
                <option value="very_inactive">非常不活跃</option>
                <option value="never">从未请求</option>
              </Select>
            </div>
          </div>

          {/* Users Table */}
          {loading && !users.length ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : users.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead className="hidden md:table-cell">邮箱</TableHead>
                    <TableHead className="hidden sm:table-cell">角色</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">额度 (USD)</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">已用</TableHead>
                    <TableHead className="text-right hidden md:table-cell">请求数</TableHead>
                    <TableHead className="hidden lg:table-cell">最后请求</TableHead>
                    <TableHead>活跃度</TableHead>
                    <TableHead className="w-20">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="font-mono text-[10px] text-muted-foreground tabular-nums">{user.id}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold text-sm">{user.username}</span>
                          {user.display_name && <span className="text-[10px] text-muted-foreground">{user.display_name}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{user.email || '-'}</TableCell>
                      <TableCell className="hidden sm:table-cell text-[11px] font-medium text-muted-foreground/80">{getRoleName(user.role)}</TableCell>
                      <TableCell>{getStatusBadge(user.status)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-bold text-primary tabular-nums tracking-tight">
                        {formatQuota(user.quota)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground hidden sm:table-cell tabular-nums">
                        {formatQuota(user.used_quota)}
                      </TableCell>
                      <TableCell className="text-right hidden md:table-cell tabular-nums font-medium text-sm">
                        {user.request_count.toLocaleString()}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-[10px] whitespace-nowrap tabular-nums">{formatLastRequest(user)}</TableCell>
                      <TableCell>{getActivityBadge(user.activity_level)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
                          onClick={() => deleteUser(user.id, user.username)}
                          disabled={deleting}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="py-20 text-center text-muted-foreground bg-muted/10 rounded-lg border border-dashed">
              <Users className="mx-auto h-10 w-10 mb-3 opacity-20" />
              <p>{search || activityFilter !== 'all' ? '没有找到符合条件的用户' : '暂无用户数据'}</p>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 px-2">
              <p className="text-sm text-muted-foreground">
                第 {page} / {totalPages} 页
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  下一页
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirm Dialog */}
      <Dialog open={confirmDialog.isOpen} onOpenChange={(open: boolean) => setConfirmDialog(prev => ({ ...prev, isOpen: open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmDialog.title}</DialogTitle>
            <DialogDescription>{confirmDialog.message}</DialogDescription>
          </DialogHeader>
          {confirmDialog.loading ? (
            <div className="py-8 flex flex-col items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
              <p className="text-sm text-muted-foreground">正在查询用户数据，您也可以直接删除...</p>
            </div>
          ) : confirmDialog.details && (
            <div className="py-4">
              <p className="text-sm text-muted-foreground mb-2">将删除以下用户（显示前20个）：</p>
              <div className="max-h-40 overflow-y-auto bg-muted rounded-md p-3">
                <div className="flex flex-wrap gap-2">
                  {confirmDialog.details.users.map((username, i) => (
                    <Badge key={i} variant="outline">{username}</Badge>
                  ))}
                  {confirmDialog.details.count > 20 && (
                    <Badge variant="secondary">+{confirmDialog.details.count - 20} 更多</Badge>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}>
              取消
            </Button>
            <Button
              variant={confirmDialog.type === 'danger' ? 'destructive' : 'default'}
              onClick={confirmDialog.onConfirm}
            >
              确定删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

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
    const setLoading = level === 'very_inactive' ? setDeletingVeryInactive : setDeletingNever
    setLoading(true)
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
          showToast('info', '没有符合条件的用户')
          setLoading(false)
          return
        }
        setConfirmDialog({
          isOpen: true,
          title: '批量删除用户',
          message: `确定要删除 ${count} 个${level === 'never' ? '从未请求' : '非常不活跃'}的用户吗？此操作不可恢复。`,
          type: 'danger',
          details: { count, users: usernames },
          onConfirm: () => executeBatchDelete(level),
        })
      } else {
        showToast('error', data.message || '预览失败')
      }
    } catch (error) {
      console.error('Failed to preview batch delete:', error)
      showToast('error', '预览失败')
    } finally {
      setLoading(false)
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

  if (loading && !users.length) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Activity Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="cursor-pointer hover:border-green-500 transition-colors" onClick={() => { setActivityFilter('active'); setPage(1) }}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <UserCheck className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">活跃用户</p>
                <p className="text-2xl font-bold text-green-600">{stats?.active_users || 0}</p>
                <p className="text-xs text-muted-foreground">7天内有请求</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-yellow-500 transition-colors" onClick={() => { setActivityFilter('inactive'); setPage(1) }}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">不活跃用户</p>
                <p className="text-2xl font-bold text-yellow-600">{stats?.inactive_users || 0}</p>
                <p className="text-xs text-muted-foreground">7-30天内有请求</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-red-500 transition-colors" onClick={() => { setActivityFilter('very_inactive'); setPage(1) }}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-lg">
                <UserX className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">非常不活跃</p>
                <p className="text-2xl font-bold text-red-600">{stats?.very_inactive_users || 0}</p>
                <p className="text-xs text-muted-foreground">超过30天无请求</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-gray-500 transition-colors" onClick={() => { setActivityFilter('never'); setPage(1) }}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <Users className="h-5 w-5 text-gray-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">从未请求</p>
                <p className="text-2xl font-bold text-gray-600">{stats?.never_requested || 0}</p>
                <p className="text-xs text-muted-foreground">注册后未使用</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Batch Delete Actions */}
      <Card className="border-orange-200 bg-orange-50">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              <div>
                <h3 className="font-medium text-orange-800">批量清理不活跃用户</h3>
                <p className="text-sm text-orange-600">删除后不可恢复，请谨慎操作</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="border-orange-300 text-orange-700 hover:bg-orange-100"
                onClick={() => previewBatchDelete('very_inactive')}
                disabled={deletingVeryInactive || !stats?.very_inactive_users}
              >
                {deletingVeryInactive ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                清理非常不活跃 ({stats?.very_inactive_users || 0})
              </Button>
              <Button
                variant="outline"
                className="border-gray-300 text-gray-700 hover:bg-gray-100"
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
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span>用户列表 <span className="text-sm font-normal text-muted-foreground">共 {total} 个用户</span></span>
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading}>
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
            {activityFilter !== 'all' && (
              <Button variant="ghost" size="sm" onClick={() => { setActivityFilter('all'); setPage(1) }}>
                清除筛选
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <div className="flex-1 flex gap-2">
              <Input
                placeholder="搜索用户名或邮箱..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyPress={handleKeyPress}
                className="max-w-sm"
              />
              <Button onClick={handleSearch}>
                <Search className="h-4 w-4 mr-2" />
                搜索
              </Button>
            </div>
            <Select value={activityFilter} onChange={(e) => { setActivityFilter(e.target.value); setPage(1) }}>
              <option value="all">全部</option>
              <option value="active">活跃</option>
              <option value="inactive">不活跃</option>
              <option value="very_inactive">非常不活跃</option>
              <option value="never">从未请求</option>
            </Select>
          </div>

          {/* Users Table */}
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : users.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead>用户名</TableHead>
                    <TableHead>邮箱</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">额度</TableHead>
                    <TableHead className="text-right">已用</TableHead>
                    <TableHead className="text-right">请求次数</TableHead>
                    <TableHead>最后请求时间</TableHead>
                    <TableHead>活跃度</TableHead>
                    <TableHead className="w-20">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-mono text-sm">{user.id}</TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{user.username}</div>
                          {user.display_name && <div className="text-xs text-muted-foreground">{user.display_name}</div>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{user.email || '-'}</TableCell>
                      <TableCell className="text-sm">{getRoleName(user.role)}</TableCell>
                      <TableCell>{getStatusBadge(user.status)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatQuota(user.quota)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatQuota(user.used_quota)}</TableCell>
                      <TableCell className="text-right">{user.request_count.toLocaleString()}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{formatLastRequest(user)}</TableCell>
                      <TableCell>{getActivityBadge(user.activity_level)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
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
            <div className="py-12 text-center text-muted-foreground">
              {search || activityFilter !== 'all' ? '没有找到符合条件的用户' : '暂无用户数据'}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                第 {page} 页，共 {totalPages} 页
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
          {confirmDialog.details && (
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
            <Button variant="outline" onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}>取消</Button>
            <Button variant={confirmDialog.type === 'danger' ? 'destructive' : 'default'} onClick={confirmDialog.onConfirm}>
              确定删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

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
  Eye,
  ShieldCheck,
  Github,
  MessageCircle,
  Send,
  Key,
  Shield,
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
import { UserAnalysisDialog } from './UserAnalysisDialog'



interface ActivityStats {
  total_users: number
  active_users: number
  inactive_users: number
  very_inactive_users: number
  never_requested: number
}

// 分组信息
interface GroupInfo {
  group_name: string
  user_count: number
}

// 注册来源标签
const SOURCE_LABELS: Record<string, { label: string; icon: typeof Github }> = {
  github: { label: 'GitHub', icon: Github },
  wechat: { label: '微信', icon: MessageCircle },
  telegram: { label: 'Telegram', icon: Send },
  discord: { label: 'Discord', icon: MessageCircle },
  oidc: { label: 'OIDC', icon: Shield },
  linux_do: { label: 'LinuxDO', icon: Users },
  password: { label: '密码注册', icon: Key },
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
  linux_do_id: string | null
  source?: string
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

  // 软删除用户清理
  const [softDeletedCount, setSoftDeletedCount] = useState(0)
  const [purgingSoftDeleted, setPurgingSoftDeleted] = useState(false)

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean
    title: string
    message: string
    type: 'warning' | 'danger'
    onConfirm: () => void
    details?: { count: number; users: string[] }
    loading?: boolean
    activityLevel?: string
    hardDelete?: boolean
    requireConfirmText?: boolean
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'warning',
    onConfirm: () => { },
  })

  // 彻底删除确认输入
  const [hardDeleteConfirmText, setHardDeleteConfirmText] = useState('')

  // 用户分析弹窗状态
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<{ id: number; username: string } | null>(null)

  // 邀请用户列表状态
  const [invitedUsers, setInvitedUsers] = useState<{
    inviter: { user_id: number; username: string; display_name: string; aff_code: string; aff_count: number; aff_quota: number; aff_history: number } | null
    items: Array<{ user_id: number; username: string; display_name: string; email: string; status: number; quota: number; used_quota: number; request_count: number; group: string; role: number }>
    total: number
    stats: { total_invited: number; active_count: number; banned_count: number; total_used_quota: number; total_requests: number }
  } | null>(null)
  const [invitedLoading, setInvitedLoading] = useState(false)
  const [invitedPage, setInvitedPage] = useState(1)

  // 批量分组管理状态
  const [groups, setGroups] = useState<GroupInfo[]>([])
  const [groupFilter, setGroupFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set())
  const [batchTargetGroup, setBatchTargetGroup] = useState('')
  const [batchMoving, setBatchMoving] = useState(false)

  // Linux.do 用户名查询状态
  const [linuxDoLookupLoading, setLinuxDoLookupLoading] = useState<string | null>(null)

  const allSelectedOnPage = users.length > 0 && users.every((u) => selectedUserIds.has(u.id))

  const toggleSelectAllOnPage = () => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      const allSelected = users.length > 0 && users.every((u) => next.has(u.id))
      if (allSelected) {
        users.forEach((u) => next.delete(u.id))
      } else {
        users.forEach((u) => next.add(u.id))
      }
      return next
    })
  }

  const toggleSelectUser = (userId: number) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const apiUrl = import.meta.env.VITE_API_URL || ''

  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  const fetchStats = useCallback(async (quick = false) => {
    try {
      const params = quick ? '?quick=true' : ''
      const response = await fetch(`${apiUrl}/api/users/stats${params}`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) {
        setStats(data.data)
        // 如果是快速模式且活跃度数据为0，异步加载完整数据
        if (quick && data.data.active_users === 0 && data.data.inactive_users === 0 && data.data.very_inactive_users === 0) {
          // 延迟加载完整统计，不阻塞用户列表
          setTimeout(() => fetchStats(false), 100)
        }
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    }
  }, [apiUrl, getAuthHeaders])

  // 获取软删除用户数量
  const fetchSoftDeletedCount = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/users/soft-deleted/count`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) {
        setSoftDeletedCount(data.data?.count || 0)
      }
    } catch (error) {
      console.error('Failed to fetch soft deleted count:', error)
    }
  }, [apiUrl, getAuthHeaders])

  // 获取可用分组列表
  const fetchGroups = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/auto-group/groups`, { headers: getAuthHeaders() })
      const data = await response.json()
      if (data.success) {
        setGroups(data.data.items)
      }
    } catch (error) {
      console.error('Failed to fetch groups:', error)
    }
  }, [apiUrl, getAuthHeaders])

  // 批量移动用户到指定分组
  const batchMoveUsers = async () => {
    if (selectedUserIds.size === 0) {
      showToast('error', '请选择用户')
      return
    }
    if (!batchTargetGroup) {
      showToast('error', '请选择目标分组')
      return
    }
    setBatchMoving(true)
    try {
      const response = await fetch(`${apiUrl}/api/auto-group/batch-move`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          user_ids: Array.from(selectedUserIds),
          target_group: batchTargetGroup,
        }),
      })
      const data = await response.json()
      if (data.success || data.data?.success_count > 0) {
        showToast('success', data.data?.message || `成功移动 ${data.data?.success_count || 0} 个用户`)
        setSelectedUserIds(new Set())
        setBatchTargetGroup('')
        fetchUsers()
      } else {
        showToast('error', data.message || '移动失败')
      }
    } catch (error) {
      console.error('Failed to batch move users:', error)
      showToast('error', '网络错误')
    } finally {
      setBatchMoving(false)
    }
  }

  // 预览清理软删除用户
  const previewPurgeSoftDeleted = async () => {
    setHardDeleteConfirmText('')
    setConfirmDialog({
      isOpen: true,
      title: '清理已软删除用户',
      message: '正在查询已软删除的用户...',
      type: 'danger',
      loading: true,
      hardDelete: true,
      requireConfirmText: true,
      onConfirm: () => executePurgeSoftDeleted(),
    })

    try {
      const response = await fetch(`${apiUrl}/api/users/soft-deleted/purge`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ dry_run: true }),
      })
      const data = await response.json()
      if (data.success && data.data) {
        const count = data.data.count
        const usernames = data.data.users || []
        if (count === 0) {
          setConfirmDialog(prev => ({ ...prev, isOpen: false }))
          showToast('info', '没有需要清理的软删除用户')
          return
        }
        setConfirmDialog(prev => ({
          ...prev,
          message: `确定要彻底清理 ${count} 个已软删除的用户吗？\n\n⚠️ 这些用户之前已被软删除，此操作将永久移除他们及所有关联数据，不可恢复！`,
          details: { count, users: usernames },
          loading: false,
        }))
      } else {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }))
        showToast('error', data.message || '预览失败')
      }
    } catch (error) {
      console.error('Failed to preview purge:', error)
      setConfirmDialog(prev => ({ ...prev, isOpen: false }))
      showToast('error', '预览失败')
    }
  }

  // 执行清理软删除用户
  const executePurgeSoftDeleted = async () => {
    setConfirmDialog(prev => ({ ...prev, isOpen: false }))
    setPurgingSoftDeleted(true)
    try {
      const response = await fetch(`${apiUrl}/api/users/soft-deleted/purge`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ dry_run: false }),
      })
      const data = await response.json()
      if (data.success) {
        showToast('success', data.message)
        setSoftDeletedCount(0)
        // 刷新统计
        fetchStats()
      } else {
        showToast('error', data.message || '清理失败')
      }
    } catch (error) {
      console.error('Failed to purge soft deleted:', error)
      showToast('error', '清理失败')
    } finally {
      setPurgingSoftDeleted(false)
    }
  }

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      })
      if (search) params.append('search', search)
      if (activityFilter && activityFilter !== 'all') params.append('activity', activityFilter)
      if (groupFilter) params.append('group', groupFilter)
      if (sourceFilter) params.append('source', sourceFilter)

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
  }, [apiUrl, getAuthHeaders, page, pageSize, search, activityFilter, groupFilter, sourceFilter, showToast])

  // 添加用户到 AI 封禁白名单
  const addToWhitelist = useCallback(async (userId: number, username: string) => {
    try {
      const response = await fetch(`${apiUrl}/api/ai-ban/whitelist/add`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ user_id: userId }),
      })
      const data = await response.json()
      if (data.success) {
        showToast('success', `已将 ${username} 添加到 AI 封禁白名单`)
      } else {
        showToast('error', data.message || '添加失败')
      }
    } catch (error) {
      console.error('Failed to add to whitelist:', error)
      showToast('error', '添加到白名单失败')
    }
  }, [apiUrl, getAuthHeaders, showToast])

  // 单个用户删除状态
  const [deleteUserTarget, setDeleteUserTarget] = useState<{ userId: number; username: string; activityLevel: string } | null>(null)
  const [deleteMode, setDeleteMode] = useState<'soft' | 'hard'>('soft')

  const deleteUser = async (userId: number, username: string) => {
    const userToDelete = users.find(u => u.id === userId)
    setDeleteUserTarget({ userId, username, activityLevel: userToDelete?.activity_level || '' })
    setDeleteMode('soft')
    setHardDeleteConfirmText('')
    setConfirmDialog({
      isOpen: true,
      title: '删除用户',
      message: `请选择删除方式：`,
      type: 'danger',
      onConfirm: () => { }, // 占位，实际执行在按钮的 onClick 中处理
    })
  }

  const executeDeleteUser = async () => {
    if (!deleteUserTarget) return

    const { userId, activityLevel } = deleteUserTarget
    const hardDelete = deleteMode === 'hard'

    setConfirmDialog(prev => ({ ...prev, isOpen: false }))
    setDeleting(true)
    try {
      const response = await fetch(`${apiUrl}/api/users/${userId}?hard_delete=${hardDelete}`, {
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
        if (stats) {
          setStats(prev => prev ? {
            ...prev,
            total_users: prev.total_users - 1,
            active_users: activityLevel === 'active' ? prev.active_users - 1 : prev.active_users,
            inactive_users: activityLevel === 'inactive' ? prev.inactive_users - 1 : prev.inactive_users,
            very_inactive_users: activityLevel === 'very_inactive' ? prev.very_inactive_users - 1 : prev.very_inactive_users,
            never_requested: activityLevel === 'never' ? prev.never_requested - 1 : prev.never_requested,
          } : null)
        }
        // 如果是软删除，更新软删除计数
        if (!hardDelete) {
          fetchSoftDeletedCount()
        }
      } else {
        showToast('error', data.message || '删除失败')
      }
    } catch (error) {
      console.error('Failed to delete user:', error)
      showToast('error', '删除用户失败')
    } finally {
      setDeleting(false)
      setDeleteUserTarget(null)
    }
  }

  const previewBatchDelete = async (level: string, hardDelete: boolean = false) => {
    // 重置确认输入
    setHardDeleteConfirmText('')

    const levelLabel = level === 'never' ? '从未请求' : level === 'inactive' ? '不活跃' : '非常不活跃'
    const actionLabel = hardDelete ? '彻底删除' : '删除'

    // 先立即显示弹窗，带加载状态
    setConfirmDialog({
      isOpen: true,
      title: `批量${actionLabel}用户`,
      message: `正在查询${levelLabel}的用户...`,
      type: 'danger',
      loading: true,
      activityLevel: level,
      hardDelete,
      requireConfirmText: hardDelete,
      onConfirm: () => executeBatchDelete(level, hardDelete),
    })

    try {
      const response = await fetch(`${apiUrl}/api/users/batch-delete`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ activity_level: level, dry_run: true, hard_delete: hardDelete }),
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
        const warningText = hardDelete
          ? `⚠️ 彻底删除将永久移除用户及所有关联数据（令牌、配额、任务等），此操作不可恢复！`
          : `此操作为软删除，数据可通过数据库恢复。`
        setConfirmDialog(prev => ({
          ...prev,
          message: `确定要${actionLabel} ${count} 个${levelLabel}的用户吗？\n\n${warningText}`,
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

  const executeBatchDelete = async (level: string, hardDelete: boolean = false) => {
    setConfirmDialog(prev => ({ ...prev, isOpen: false }))
    const setLoading = level === 'very_inactive' ? setDeletingVeryInactive : setDeletingNever
    setLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/users/batch-delete`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ activity_level: level, dry_run: false, hard_delete: hardDelete }),
      })
      const data = await response.json()
      if (data.success) {
        showToast('success', data.message)
        // 并行刷新数据
        setPage(1)
        Promise.all([fetchUsers(), fetchStats()])
        // 如果是软删除，刷新软删除计数
        if (!hardDelete) {
          fetchSoftDeletedCount()
        }
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
    fetchStats(true)  // 首次加载使用快速模式
    fetchSoftDeletedCount()  // 获取软删除用户数量
    fetchGroups()  // 获取分组列表
  }, [fetchStats, fetchSoftDeletedCount, fetchGroups])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchUsers(), fetchStats()])
    setRefreshing(false)
    showToast('success', '数据已刷新')
  }

  // 打开用户分析弹窗
  const openUserAnalysis = (userId: number, username: string) => {
    setSelectedUser({ id: userId, username })
    setAnalysisDialogOpen(true)
    setInvitedUsers(null)
    setInvitedPage(1)
  }

  // 获取邀请用户列表
  const fetchInvitedUsers = useCallback(async () => {
    if (!selectedUser || !analysisDialogOpen) return
    setInvitedLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/users/${selectedUser.id}/invited?page=${invitedPage}&page_size=10`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        setInvitedUsers(res.data)
      }
    } catch (e) {
      console.error('Failed to fetch invited users:', e)
    } finally {
      setInvitedLoading(false)
    }
  }, [apiUrl, getAuthHeaders, selectedUser, analysisDialogOpen, invitedPage])

  useEffect(() => {
    if (analysisDialogOpen && selectedUser) {
      fetchInvitedUsers()
    }
  }, [analysisDialogOpen, selectedUser, invitedPage, fetchInvitedUsers])

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
    const baseClass = "w-[92px] justify-center"
    switch (level) {
      case 'active':
        return <Badge variant="success" className={baseClass}>活跃</Badge>
      case 'inactive':
        return <Badge variant="warning" className={baseClass}>不活跃</Badge>
      case 'very_inactive':
        return <Badge variant="destructive" className={baseClass}>非常不活跃</Badge>
      case 'never':
        return <Badge variant="secondary" className={baseClass}>从未请求</Badge>
      default:
        return <Badge variant="outline" className={baseClass}>{level}</Badge>
    }
  }

  const getRoleBadge = (role: number) => {
    const baseClass = "w-[92px] justify-center whitespace-nowrap"
    switch (role) {
      case 1:
        return <Badge variant="outline" className={cn(baseClass, "text-muted-foreground font-normal border-muted-foreground/20")}>普通用户</Badge>
      case 10:
        return <Badge className={cn(baseClass, "bg-blue-500 hover:bg-blue-600 border-none")}>管理员</Badge>
      case 100:
        return (
          <Badge className={cn(baseClass, "bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white border-none shadow-sm")}>
            <ShieldCheck className="w-3 h-3 mr-1 shrink-0" />
            超级管理员
          </Badge>
        )
      default:
        return <Badge variant="secondary" className={baseClass}>角色{role}</Badge>
    }
  }

  const getStatusBadge = (status: number) => {
    const baseClass = "w-[64px] justify-center"
    switch (status) {
      case 1:
        return <Badge variant="success" className={baseClass}>正常</Badge>
      case 2:
        return <Badge variant="destructive" className={baseClass}>禁用</Badge>
      default:
        return <Badge variant="outline" className={baseClass}>未知</Badge>
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
          subValue={stats?.active_users === 0 && stats?.inactive_users === 0 && stats?.very_inactive_users === 0 && (stats?.never_requested || 0) > 0 ? "计算中..." : "7天内有请求"}
          icon={UserCheck}
          color="green"
          onClick={() => { setActivityFilter('active'); setPage(1) }}
          className={cn(activityFilter === 'active' && "ring-2 ring-primary ring-offset-2")}
        />
        <StatCard
          title="不活跃用户"
          value={stats?.inactive_users || 0}
          subValue={stats?.active_users === 0 && stats?.inactive_users === 0 && stats?.very_inactive_users === 0 && (stats?.never_requested || 0) > 0 ? "计算中..." : "7-30天内有请求"}
          icon={Clock}
          color="yellow"
          onClick={() => { setActivityFilter('inactive'); setPage(1) }}
          className={cn(activityFilter === 'inactive' && "ring-2 ring-primary ring-offset-2")}
        />
        <StatCard
          title="非常不活跃"
          value={stats?.very_inactive_users || 0}
          subValue={stats?.active_users === 0 && stats?.inactive_users === 0 && stats?.very_inactive_users === 0 && (stats?.never_requested || 0) > 0 ? "计算中..." : "超过30天无请求"}
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
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <h3 className="font-medium text-orange-800 dark:text-orange-200">批量注销不活跃用户</h3>
                  <p className="text-sm text-orange-600 dark:text-orange-400">注销：数据保留可恢复 | 彻底删除：永久移除不可恢复</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-orange-300 text-orange-700 hover:bg-orange-100 hover:text-orange-800 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-900"
                  onClick={() => previewBatchDelete('very_inactive', false)}
                  disabled={deletingVeryInactive || !stats?.very_inactive_users}
                >
                  {deletingVeryInactive ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                  注销非常不活跃 ({stats?.very_inactive_users || 0})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-gray-300 text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  onClick={() => previewBatchDelete('never', false)}
                  disabled={deletingNever || !stats?.never_requested}
                >
                  {deletingNever ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                  注销从未请求 ({stats?.never_requested || 0})
                </Button>
              </div>
            </div>
            {/* 彻底删除区域 */}
            <div className="border-t border-orange-200 dark:border-orange-800 pt-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-100 dark:bg-red-900 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-red-800 dark:text-red-200">彻底删除（危险操作）</h3>
                    <p className="text-sm text-red-600 dark:text-red-400">永久删除用户及所有关联数据，包括令牌、配额、任务等</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-300 text-red-700 hover:bg-red-100 hover:text-red-800 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900"
                    onClick={() => previewBatchDelete('very_inactive', true)}
                    disabled={deletingVeryInactive || !stats?.very_inactive_users}
                  >
                    {deletingVeryInactive ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                    彻底删除非常不活跃
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-300 text-red-700 hover:bg-red-100 hover:text-red-800 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900"
                    onClick={() => previewBatchDelete('never', true)}
                    disabled={deletingNever || !stats?.never_requested}
                  >
                    {deletingNever ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                    彻底删除从未请求
                  </Button>
                </div>
              </div>
            </div>
            {/* 清理已注销用户 */}
            {softDeletedCount > 0 && (
              <div className="border-t border-orange-200 dark:border-orange-800 pt-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                      <Trash2 className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <h3 className="font-medium text-purple-800 dark:text-purple-200">清理已注销用户</h3>
                      <p className="text-sm text-purple-600 dark:text-purple-400">这些用户已被删除（注销），彻底清理可释放数据库空间</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-purple-300 text-purple-700 hover:bg-purple-100 hover:text-purple-800 dark:border-purple-800 dark:text-purple-300 dark:hover:bg-purple-900"
                    onClick={previewPurgeSoftDeleted}
                    disabled={purgingSoftDeleted}
                  >
                    {purgingSoftDeleted ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                    彻底清理注销用户 ({softDeletedCount})
                  </Button>
                </div>
              </div>
            )}
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
                  placeholder="搜索用户名/邮箱/LinuxDoID/邀请码..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="pl-9"
                />
              </div>
              <Button onClick={handleSearch}>搜索</Button>
            </div>
            <div className="w-full sm:w-40">
              <Select value={activityFilter} onChange={(e) => { setActivityFilter(e.target.value); setPage(1) }}>
                <option value="all">所有状态</option>
                <option value="active">活跃用户</option>
                <option value="inactive">不活跃用户</option>
                <option value="very_inactive">非常不活跃</option>
                <option value="never">从未请求</option>
              </Select>
            </div>
            <div className="w-full sm:w-36">
              <Select value={groupFilter} onChange={(e) => { setGroupFilter(e.target.value); setPage(1) }}>
                <option value="">所有分组</option>
                {groups.map((g) => (
                  <option key={g.group_name} value={g.group_name}>
                    {g.group_name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-full sm:w-36">
              <Select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1) }}>
                <option value="">所有来源</option>
                {Object.entries(SOURCE_LABELS).map(([key, info]) => (
                  <option key={key} value={key}>{info.label}</option>
                ))}
              </Select>
            </div>
          </div>

          {/* Batch Move */}
          {users.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4 p-3 rounded-lg border bg-muted/20">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  已选择 <span className="font-medium text-foreground">{selectedUserIds.size}</span> 个
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={toggleSelectAllOnPage}
                >
                  {allSelectedOnPage ? '取消全选本页' : '全选本页'}
                </Button>
                {selectedUserIds.size > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => setSelectedUserIds(new Set())}
                  >
                    清空
                  </Button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:ml-auto">
                <div className="w-full sm:w-48">
                  <Select
                    value={batchTargetGroup}
                    onChange={(e) => setBatchTargetGroup(e.target.value)}
                    disabled={batchMoving || selectedUserIds.size === 0}
                  >
                    <option value="">选择目标分组</option>
                    {groups.map((g) => (
                      <option key={g.group_name} value={g.group_name}>
                        {g.group_name}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  size="sm"
                  onClick={batchMoveUsers}
                  disabled={batchMoving || selectedUserIds.size === 0 || !batchTargetGroup}
                >
                  {batchMoving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  批量移动
                </Button>
              </div>
            </div>
          )}

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
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        role="checkbox"
                        aria-label="全选本页用户"
                        checked={allSelectedOnPage}
                        onChange={toggleSelectAllOnPage}
                        className="h-4 w-4 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </TableHead>
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead className="hidden sm:table-cell">角色</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="hidden lg:table-cell">Linux.do</TableHead>
                    <TableHead className="text-right">额度 (USD)</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">已用</TableHead>
                    <TableHead className="text-right hidden md:table-cell">请求数</TableHead>
                    <TableHead className="hidden md:table-cell">最后请求</TableHead>
                    <TableHead>活跃度</TableHead>
                    <TableHead className="w-20">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id} className="hover:bg-muted/50 transition-colors group">
                      <TableCell className="w-10">
                        <input
                          type="checkbox"
                          role="checkbox"
                          aria-label={`选择用户 ${user.username}`}
                          checked={selectedUserIds.has(user.id)}
                          onChange={() => toggleSelectUser(user.id)}
                          className="h-4 w-4 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">{user.id}</TableCell>
                      <TableCell>
                        <div
                          className="flex items-center gap-3 px-3 py-2 rounded-xl bg-muted/30 hover:bg-primary/5 transition-all cursor-pointer border border-transparent hover:border-primary/20 w-max min-w-[180px]"
                          onClick={() => openUserAnalysis(user.id, user.username)}
                          title="查看用户分析"
                        >
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 text-sm text-primary font-bold shrink-0">
                            {user.username[0]?.toUpperCase()}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-bold text-sm tracking-tight">{user.username}</span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {user.display_name && (
                                <span className="text-[10px] text-muted-foreground">{user.display_name}</span>
                              )}
                              <Badge variant="outline" className="px-1.5 py-0 h-4 text-[9px] font-medium leading-none shrink-0 border-muted-foreground/20">
                                {user.group || 'default'}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {getRoleBadge(user.role)}
                      </TableCell>
                      <TableCell>{getStatusBadge(user.status)}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {user.linux_do_id ? (
                          <button
                            onClick={async () => {
                              const lid = user.linux_do_id
                              if (!lid || linuxDoLookupLoading) return
                              setLinuxDoLookupLoading(lid)
                              try {
                                const res = await fetch(`${apiUrl}/api/linuxdo/lookup/${encodeURIComponent(lid)}`, { headers: getAuthHeaders() })
                                const data = await res.json()
                                if (data.success && data.data?.profile_url) {
                                  window.open(data.data.profile_url, '_blank')
                                } else if (data.error_type === 'rate_limit') {
                                  showToast('error', data.message || `请求被限速，请等待 ${data.wait_seconds || '?'} 秒后重试`)
                                } else if (data.fallback_url) {
                                  window.open(data.fallback_url, '_blank')
                                  showToast('info', '服务器查询失败，已在新标签页打开 Linux.do 证书页面')
                                } else {
                                  showToast('error', data.message || '查询 Linux.do 用户名失败')
                                }
                              } catch { showToast('error', '查询 Linux.do 用户名失败') }
                              finally { setLinuxDoLookupLoading(null) }
                            }}
                            disabled={linuxDoLookupLoading === user.linux_do_id}
                            className="text-xs font-mono text-blue-500 hover:text-blue-600 hover:underline disabled:opacity-50 cursor-pointer"
                            title="点击查看 Linux.do 用户主页"
                          >
                            {linuxDoLookupLoading === user.linux_do_id ? '查询中...' : user.linux_do_id}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-bold text-primary tabular-nums tracking-tight">
                        {formatQuota(user.quota)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground hidden sm:table-cell tabular-nums">
                        {formatQuota(user.used_quota)}
                      </TableCell>
                      <TableCell className="text-right hidden md:table-cell tabular-nums font-bold text-sm">
                        {user.request_count.toLocaleString()}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs whitespace-nowrap tabular-nums text-muted-foreground">{formatLastRequest(user)}</TableCell>
                      <TableCell>{getActivityBadge(user.activity_level)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-blue-500 hover:text-blue-600 hover:bg-blue-500/10 h-7 w-7 p-0"
                            onClick={() => openUserAnalysis(user.id, user.username)}
                            title="用户分析"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-green-500 hover:text-green-600 hover:bg-green-500/10 h-7 w-7 p-0"
                            onClick={() => addToWhitelist(user.id, user.username)}
                            title="加入 AI 封禁白名单"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-7 w-7 p-0"
                            onClick={() => deleteUser(user.id, user.username)}
                            disabled={deleting}
                            title="删除用户"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
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
      <Dialog open={confirmDialog.isOpen} onOpenChange={(open: boolean) => { setConfirmDialog(prev => ({ ...prev, isOpen: open })); if (!open) { setHardDeleteConfirmText(''); setDeleteUserTarget(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className={confirmDialog.hardDelete || deleteMode === 'hard' ? "text-red-600 dark:text-red-400" : ""}>{confirmDialog.title}</DialogTitle>
            <DialogDescription className="whitespace-pre-line">{confirmDialog.message}</DialogDescription>
          </DialogHeader>
          {confirmDialog.loading ? (
            <div className="py-8 flex flex-col items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
              <p className="text-sm text-muted-foreground">正在查询用户数据，您也可以直接删除...</p>
            </div>
          ) : deleteUserTarget ? (
            /* 单个用户删除 - 显示模式选择 */
            <div className="py-4 space-y-4">
              <div className="text-sm text-muted-foreground">
                用户: <span className="font-medium text-foreground">{deleteUserTarget.username}</span>
              </div>
              <div className="space-y-3">
                <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${deleteMode === 'soft' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                  <input
                    type="radio"
                    name="deleteMode"
                    checked={deleteMode === 'soft'}
                    onChange={() => setDeleteMode('soft')}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">注销用户</div>
                    <div className="text-sm text-muted-foreground">数据保留，可通过数据库恢复。用户名仍被占用。</div>
                  </div>
                </label>
                <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${deleteMode === 'hard' ? 'border-red-500 bg-red-50 dark:bg-red-950/20' : 'border-border hover:border-red-300'}`}>
                  <input
                    type="radio"
                    name="deleteMode"
                    checked={deleteMode === 'hard'}
                    onChange={() => setDeleteMode('hard')}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-red-600 dark:text-red-400">彻底删除</div>
                    <div className="text-sm text-muted-foreground">永久删除用户及所有关联数据（令牌、配额等），不可恢复！</div>
                  </div>
                </label>
              </div>
              {/* 彻底删除需要输入确认 */}
              {deleteMode === 'hard' && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">
                    请输入 <span className="font-mono bg-red-100 dark:bg-red-900 px-2 py-0.5 rounded">彻底删除</span> 以确认操作：
                  </p>
                  <Input
                    value={hardDeleteConfirmText}
                    onChange={(e) => setHardDeleteConfirmText(e.target.value)}
                    placeholder="请输入 彻底删除"
                    className="border-red-300 focus:border-red-500 focus:ring-red-500"
                  />
                </div>
              )}
            </div>
          ) : confirmDialog.details && (
            /* 批量删除 - 显示用户列表 */
            <div className="py-4 space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">将{confirmDialog.hardDelete ? '彻底' : ''}删除以下用户（显示前20个）：</p>
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
              {/* 彻底删除需要输入确认 */}
              {confirmDialog.requireConfirmText && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">
                    请输入 <span className="font-mono bg-red-100 dark:bg-red-900 px-2 py-0.5 rounded">彻底删除</span> 以确认操作：
                  </p>
                  <Input
                    value={hardDeleteConfirmText}
                    onChange={(e) => setHardDeleteConfirmText(e.target.value)}
                    placeholder="请输入 彻底删除"
                    className="border-red-300 focus:border-red-500 focus:ring-red-500"
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmDialog(prev => ({ ...prev, isOpen: false })); setHardDeleteConfirmText(''); setDeleteUserTarget(null) }}>
              取消
            </Button>
            <Button
              variant={confirmDialog.type === 'danger' || deleteMode === 'hard' ? 'destructive' : 'default'}
              onClick={() => {
                if (deleteUserTarget) {
                  executeDeleteUser()
                } else {
                  confirmDialog.onConfirm()
                }
              }}
              disabled={((confirmDialog.requireConfirmText ?? false) || (deleteUserTarget !== null && deleteMode === 'hard')) && hardDeleteConfirmText !== '彻底删除'}
            >
              {deleteUserTarget ? (deleteMode === 'hard' ? '确认彻底删除' : '确认注销') : (confirmDialog.hardDelete ? '确认彻底删除' : '确定删除')}
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
          onBanned={() => fetchUsers()}
          onUnbanned={() => fetchUsers()}
          onWhitelistChanged={() => fetchUsers()}
          renderExtra={() => (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <Users className="w-4 h-4" />
                邀请用户
                {invitedUsers?.inviter?.aff_code && (
                  <Badge variant="outline" className="text-xs px-1.5 py-0 font-mono">
                    邀请码: {invitedUsers.inviter.aff_code}
                  </Badge>
                )}
                {invitedUsers?.stats && invitedUsers.stats.total_invited > 0 && (
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    共 {invitedUsers.stats.total_invited} 人
                  </Badge>
                )}
              </h4>

              {invitedLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : invitedUsers?.items && invitedUsers.items.length > 0 ? (
                <>
                  {/* 邀请统计 */}
                  <div className="grid grid-cols-4 gap-2">
                    <div className="rounded-lg border bg-muted/30 p-2 text-center">
                      <div className="text-sm font-bold">{invitedUsers.stats.total_invited}</div>
                      <div className="text-xs text-muted-foreground">邀请总数</div>
                    </div>
                    <div className="rounded-lg border bg-green-50 dark:bg-green-900/20 p-2 text-center">
                      <div className="text-sm font-bold text-green-600">{invitedUsers.stats.active_count}</div>
                      <div className="text-xs text-muted-foreground">活跃用户</div>
                    </div>
                    <div className={cn(
                      "rounded-lg border p-2 text-center",
                      invitedUsers.stats.banned_count > 0 ? "bg-red-50 dark:bg-red-900/20" : "bg-muted/30"
                    )}>
                      <div className={cn("text-sm font-bold", invitedUsers.stats.banned_count > 0 && "text-red-600")}>{invitedUsers.stats.banned_count}</div>
                      <div className="text-xs text-muted-foreground">已封禁</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2 text-center">
                      <div className="text-sm font-bold">{(invitedUsers.stats.total_used_quota / 500000).toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">总消耗 $</div>
                    </div>
                  </div>

                  {/* 邀请用户列表 */}
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="h-8 bg-muted/50 hover:bg-muted/50">
                          <TableHead className="h-8 text-xs w-[60px]">ID</TableHead>
                          <TableHead className="h-8 text-xs">用户名</TableHead>
                          <TableHead className="h-8 text-xs w-[60px]">状态</TableHead>
                          <TableHead className="h-8 text-xs text-right">请求数</TableHead>
                          <TableHead className="h-8 text-xs text-right">消耗 $</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invitedUsers.items.map((u) => (
                          <TableRow key={u.user_id} className="h-8 hover:bg-muted/30">
                            <TableCell className="py-1.5 text-xs text-muted-foreground font-mono">{u.user_id}</TableCell>
                            <TableCell className="py-1.5 text-xs">
                              <span className="font-medium">{u.username}</span>
                              {u.display_name && <span className="text-muted-foreground ml-1">({u.display_name})</span>}
                            </TableCell>
                            <TableCell className="py-1.5 text-xs">
                              {u.status === 2 ? (
                                <Badge variant="destructive" className="text-xs px-1 py-0">禁用</Badge>
                              ) : (
                                <Badge variant="success" className="text-xs px-1 py-0">正常</Badge>
                              )}
                            </TableCell>
                            <TableCell className="py-1.5 text-xs text-right tabular-nums">{u.request_count.toLocaleString()}</TableCell>
                            <TableCell className="py-1.5 text-xs text-right tabular-nums font-mono">{(u.used_quota / 500000).toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* 分页 */}
                  {invitedUsers.total > 10 && (
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-xs text-muted-foreground">
                        第 {invitedPage} 页，共 {Math.ceil(invitedUsers.total / 10)} 页
                      </span>
                      <div className="flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setInvitedPage(p => Math.max(1, p - 1))}
                          disabled={invitedPage === 1}
                        >
                          <ChevronLeft className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setInvitedPage(p => p + 1)}
                          disabled={invitedPage >= Math.ceil(invitedUsers.total / 10)}
                        >
                          <ChevronRight className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-muted-foreground italic py-4 text-center border rounded-lg bg-muted/10">
                  该用户暂无邀请记录
                </div>
              )}
            </div>
          )}
        />
      )}
    </div>
  )
}

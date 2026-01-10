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
  Globe,
  Activity,
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
import { Progress } from './ui/progress'
import { StatCard } from './StatCard'
import { cn } from '../lib/utils'

// IP切换分析类型
interface IPSwitchDetail {
  from_ip: string
  to_ip: string
  interval: number
  time: number
  is_dual_stack?: boolean
  from_version?: string
  to_version?: string
}

interface IPSwitchAnalysis {
  switch_count: number
  real_switch_count?: number
  rapid_switch_count: number
  dual_stack_switches?: number
  avg_ip_duration: number
  min_switch_interval: number
  switch_details: IPSwitchDetail[]
}

// 用户分析相关类型
interface UserAnalysis {
  range: { start_time: number; end_time: number; window_seconds: number }
  user: { id: number; username: string; display_name?: string | null; email?: string | null; status: number; group?: string | null; remark?: string | null }
  summary: {
    total_requests: number
    success_requests: number
    failure_requests: number
    quota_used: number
    prompt_tokens: number
    completion_tokens: number
    avg_use_time: number
    unique_ips: number
    unique_tokens: number
    unique_models: number
    unique_channels: number
    empty_count: number
    failure_rate: number
    empty_rate: number
  }
  risk: { requests_per_minute: number; avg_quota_per_request: number; risk_flags: string[]; ip_switch_analysis?: IPSwitchAnalysis }
  top_models: Array<{ model_name: string; requests: number; quota_used: number; success_requests: number; failure_requests: number; empty_count: number }>
  top_channels: Array<{ channel_id: number; channel_name: string; requests: number; quota_used: number }>
  top_ips: Array<{ ip: string; requests: number }>
  recent_logs: Array<{ id: number; created_at: number; type: number; model_name: string; quota: number; prompt_tokens: number; completion_tokens: number; use_time: number; ip: string; channel_name: string; token_name: string }>
}

const WINDOW_LABELS: Record<string, string> = { '1h': '1小时内', '3h': '3小时内', '6h': '6小时内', '12h': '12小时内', '24h': '24小时内', '3d': '3天内', '7d': '7天内' }

// 风险标签中文映射
const RISK_FLAG_LABELS: Record<string, string> = {
  'HIGH_RPM': '请求频率过高',
  'MANY_IPS': '多IP访问',
  'HIGH_FAILURE_RATE': '失败率过高',
  'HIGH_EMPTY_RATE': '空回复率过高',
  'IP_RAPID_SWITCH': 'IP快速切换',
  'IP_HOPPING': 'IP跳动异常',
}

function formatAnalysisTime(ts: number) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatAnalysisNumber(n: number) {
  return n.toLocaleString('zh-CN')
}

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
  linux_do_id: string | null
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
  const [analysisWindow, setAnalysisWindow] = useState<string>('24h')
  const [analysis, setAnalysis] = useState<UserAnalysis | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)

  // 邀请用户列表状态
  const [invitedUsers, setInvitedUsers] = useState<{
    inviter: { user_id: number; username: string; display_name: string; aff_code: string; aff_count: number; aff_quota: number; aff_history: number } | null
    items: Array<{ user_id: number; username: string; display_name: string; email: string; status: number; quota: number; used_quota: number; request_count: number; group: string; role: number }>
    total: number
    stats: { total_invited: number; active_count: number; banned_count: number; total_used_quota: number; total_requests: number }
  } | null>(null)
  const [invitedLoading, setInvitedLoading] = useState(false)
  const [invitedPage, setInvitedPage] = useState(1)

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

  // 打开用户分析弹窗
  const openUserAnalysis = (userId: number, username: string) => {
    setSelectedUser({ id: userId, username })
    setAnalysisDialogOpen(true)
    setAnalysis(null)
    setInvitedUsers(null)
    setInvitedPage(1)
  }

  // 获取用户分析数据
  const fetchUserAnalysis = useCallback(async () => {
    if (!selectedUser || !analysisDialogOpen) return
    setAnalysisLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/risk/users/${selectedUser.id}/analysis?window=${analysisWindow}`, { headers: getAuthHeaders() })
      const res = await response.json()
      if (res.success) {
        setAnalysis(res.data)
      } else {
        showToast('error', res.message || '加载分析失败')
      }
    } catch (e) {
      console.error('Failed to fetch user analysis:', e)
      showToast('error', '加载分析失败')
    } finally {
      setAnalysisLoading(false)
    }
  }, [apiUrl, getAuthHeaders, selectedUser, analysisWindow, analysisDialogOpen, showToast])

  useEffect(() => {
    if (analysisDialogOpen && selectedUser) {
      fetchUserAnalysis()
    }
  }, [analysisDialogOpen, selectedUser, analysisWindow, fetchUserAnalysis])

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

  const getRoleBadge = (role: number) => {
    switch (role) {
      case 1:
        return <Badge variant="outline" className="text-muted-foreground font-normal border-muted-foreground/20">普通用户</Badge>
      case 10:
        return <Badge className="bg-blue-500 hover:bg-blue-600 border-none">管理员</Badge>
      case 100:
        return (
          <Badge className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white border-none shadow-sm">
            <ShieldCheck className="w-3 h-3 mr-1" />
            超级管理员
          </Badge>
        )
      default:
        return <Badge variant="secondary">角色{role}</Badge>
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
                  <h3 className="font-medium text-orange-800 dark:text-orange-200">批量清理不活跃用户</h3>
                  <p className="text-sm text-orange-600 dark:text-orange-400">软删除：数据保留可恢复 | 彻底删除：永久移除不可恢复</p>
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
                  清理非常不活跃 ({stats?.very_inactive_users || 0})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-gray-300 text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  onClick={() => previewBatchDelete('never', false)}
                  disabled={deletingNever || !stats?.never_requested}
                >
                  {deletingNever ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                  清理从未请求 ({stats?.never_requested || 0})
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
                      <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">{user.id}</TableCell>
                      <TableCell>
                        <div
                          className="flex items-center gap-2 px-2 py-1 rounded-full bg-muted/50 hover:bg-primary/10 hover:text-primary transition-all cursor-pointer border border-transparent hover:border-primary/20 w-fit"
                          onClick={() => openUserAnalysis(user.id, user.username)}
                          title="查看用户分析"
                        >
                          <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 text-[10px] text-primary font-bold">
                            {user.username[0]?.toUpperCase()}
                          </div>
                          <div className="flex flex-col leading-tight">
                            <span className="font-bold text-sm whitespace-nowrap">{user.username}</span>
                            {user.display_name && <span className="text-[10px] text-muted-foreground opacity-70">{user.display_name}</span>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {getRoleBadge(user.role)}
                      </TableCell>
                      <TableCell>{getStatusBadge(user.status)}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {user.linux_do_id ? (
                          <a
                            href={`https://linux.do/discobot/certificate.svg?date=Jan+29+2024&type=advanced&user_id=${user.linux_do_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-mono text-blue-500 hover:text-blue-600 hover:underline"
                            title="查看 Linux.do 证书"
                          >
                            {user.linux_do_id}
                          </a>
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
      <Dialog open={confirmDialog.isOpen} onOpenChange={(open: boolean) => { setConfirmDialog(prev => ({ ...prev, isOpen: open })); if (!open) setHardDeleteConfirmText('') }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className={confirmDialog.hardDelete ? "text-red-600 dark:text-red-400" : ""}>{confirmDialog.title}</DialogTitle>
            <DialogDescription className="whitespace-pre-line">{confirmDialog.message}</DialogDescription>
          </DialogHeader>
          {confirmDialog.loading ? (
            <div className="py-8 flex flex-col items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
              <p className="text-sm text-muted-foreground">正在查询用户数据，您也可以直接删除...</p>
            </div>
          ) : confirmDialog.details && (
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
            <Button variant="outline" onClick={() => { setConfirmDialog(prev => ({ ...prev, isOpen: false })); setHardDeleteConfirmText('') }}>
              取消
            </Button>
            <Button
              variant={confirmDialog.type === 'danger' ? 'destructive' : 'default'}
              onClick={confirmDialog.onConfirm}
              disabled={confirmDialog.requireConfirmText && hardDeleteConfirmText !== '彻底删除'}
            >
              {confirmDialog.hardDelete ? '确认彻底删除' : '确定删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User Analysis Dialog */}
      <Dialog open={analysisDialogOpen} onOpenChange={setAnalysisDialogOpen}>
        <DialogContent className="max-w-2xl w-full max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden rounded-xl border-border/50 shadow-2xl">
          <DialogHeader className="p-5 border-b bg-muted/10 flex-shrink-0">
            <div className="flex justify-between items-start pr-6">
              <div>
                <DialogTitle className="text-xl flex items-center gap-2">
                  <Eye className="h-5 w-5 text-primary" />
                  用户行为分析
                </DialogTitle>
                <DialogDescription className="mt-1.5 flex items-center gap-2">
                  <span>用户: <span className="font-mono text-foreground font-medium">{selectedUser?.username}</span></span>
                  <span className="text-muted-foreground">ID: {selectedUser?.id}</span>
                </DialogDescription>
              </div>
              <Select
                value={analysisWindow}
                onChange={(e) => setAnalysisWindow(e.target.value)}
                className="w-28 h-8 text-sm"
              >
                {Object.entries(WINDOW_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </Select>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-5 min-h-0 bg-background">
            {analysisLoading ? (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                <Loader2 className="h-8 w-8 mb-4 animate-spin text-primary/50" />
                <p>正在分析用户行为数据...</p>
              </div>
            ) : analysis ? (
              <div className="space-y-6">
                {/* Risk Flags */}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="px-3 py-1 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    RPM: {analysis.risk.requests_per_minute.toFixed(1)}
                  </Badge>
                  <Badge variant="secondary" className="px-3 py-1 bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                    均额: ${((analysis.risk.avg_quota_per_request || 0) / 500000).toFixed(4)}
                  </Badge>
                  {analysis.risk.risk_flags.length > 0 ? (
                    analysis.risk.risk_flags.map((f) => (
                      <Badge key={f} variant="destructive" className="px-3 py-1 animate-pulse">
                        <AlertTriangle className="w-3 h-3 mr-1" /> {RISK_FLAG_LABELS[f] || f}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="success" className="px-3 py-1 bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300">
                      <ShieldCheck className="w-3 h-3 mr-1" /> 无明显异常
                    </Badge>
                  )}
                </div>

                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="bg-muted/20 border-none shadow-sm">
                    <CardContent className="p-4 text-center">
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">请求总数</div>
                      <div className="text-2xl font-bold tabular-nums">{formatAnalysisNumber(analysis.summary.total_requests)}</div>
                    </CardContent>
                  </Card>
                  <Card className={cn("border-none shadow-sm", analysis.summary.failure_rate > 0.5 ? "bg-red-50 dark:bg-red-950/20" : "bg-muted/20")}>
                    <CardContent className="p-4 text-center">
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">失败率</div>
                      <div className={cn("text-2xl font-bold tabular-nums", analysis.summary.failure_rate > 0.5 && "text-red-600")}>
                        {(analysis.summary.failure_rate * 100).toFixed(1)}%
                      </div>
                    </CardContent>
                  </Card>
                  <Card className={cn("border-none shadow-sm", analysis.summary.empty_rate > 0.5 ? "bg-yellow-50 dark:bg-yellow-950/20" : "bg-muted/20")}>
                    <CardContent className="p-4 text-center">
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">空回复率</div>
                      <div className={cn("text-2xl font-bold tabular-nums", analysis.summary.empty_rate > 0.5 && "text-yellow-600")}>
                        {(analysis.summary.empty_rate * 100).toFixed(1)}%
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-muted/20 border-none shadow-sm">
                    <CardContent className="p-4 text-center">
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">IP 来源</div>
                      <div className="text-2xl font-bold tabular-nums">{formatAnalysisNumber(analysis.summary.unique_ips)}</div>
                    </CardContent>
                  </Card>
                </div>

                {/* Models and IPs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                      <Activity className="w-4 h-4" />
                      模型偏好 (Top 5)
                    </h4>
                    {analysis.top_models.slice(0, 5).length ? (
                      analysis.top_models.slice(0, 5).map((m) => {
                        const pct = analysis.summary.total_requests ? (m.requests / analysis.summary.total_requests) * 100 : 0
                        return (
                          <div key={m.model_name} className="space-y-1.5">
                            <div className="flex justify-between text-xs">
                              <span className="font-medium truncate max-w-[180px]">{m.model_name}</span>
                              <span className="text-muted-foreground tabular-nums">{formatAnalysisNumber(m.requests)} ({pct.toFixed(0)}%)</span>
                            </div>
                            <Progress value={pct} className="h-1.5" />
                          </div>
                        )
                      })
                    ) : <div className="text-xs text-muted-foreground italic">无数据</div>}
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                      <Globe className="w-4 h-4" />
                      来源 IP (Top 5)
                    </h4>
                    {analysis.top_ips.slice(0, 5).length ? (
                      analysis.top_ips.slice(0, 5).map((ip) => {
                        const pct = analysis.summary.total_requests ? (ip.requests / analysis.summary.total_requests) * 100 : 0
                        return (
                          <div key={ip.ip} className="space-y-1.5">
                            <div className="flex justify-between text-xs">
                              <span className="font-medium font-mono truncate">{ip.ip}</span>
                              <span className="text-muted-foreground tabular-nums">{formatAnalysisNumber(ip.requests)} ({pct.toFixed(0)}%)</span>
                            </div>
                            <Progress value={pct} className="h-1.5" />
                          </div>
                        )
                      })
                    ) : <div className="text-xs text-muted-foreground italic">无数据</div>}
                  </div>
                </div>

                {/* IP 切换分析 */}
                {analysis.risk.ip_switch_analysis && analysis.risk.ip_switch_analysis.switch_count > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                      IP 切换分析
                      {(analysis.risk.ip_switch_analysis.rapid_switch_count >= 3 || 
                        (analysis.risk.ip_switch_analysis.avg_ip_duration < 30 && (analysis.risk.ip_switch_analysis.real_switch_count ?? analysis.risk.ip_switch_analysis.switch_count) >= 3)) && (
                        <Badge variant="destructive" className="text-xs px-1.5 py-0">异常</Badge>
                      )}
                      {(analysis.risk.ip_switch_analysis.dual_stack_switches ?? 0) > 0 && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400">
                          双栈用户
                        </Badge>
                      )}
                    </h4>
                    
                    {/* 统计卡片 */}
                    <div className="grid grid-cols-4 gap-2">
                      <div className="rounded-lg border bg-muted/30 p-2.5 text-center">
                        <div className="text-lg font-bold">{analysis.risk.ip_switch_analysis.real_switch_count ?? analysis.risk.ip_switch_analysis.switch_count}</div>
                        <div className="text-xs text-muted-foreground">真实切换</div>
                      </div>
                      <div className={cn(
                        "rounded-lg border p-2.5 text-center",
                        (analysis.risk.ip_switch_analysis.dual_stack_switches ?? 0) > 0
                          ? "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800"
                          : "bg-muted/30"
                      )}>
                        <div className={cn(
                          "text-lg font-bold",
                          (analysis.risk.ip_switch_analysis.dual_stack_switches ?? 0) > 0 && "text-blue-600 dark:text-blue-400"
                        )}>
                          {analysis.risk.ip_switch_analysis.dual_stack_switches ?? 0}
                        </div>
                        <div className="text-xs text-muted-foreground">双栈切换</div>
                      </div>
                      <div className={cn(
                        "rounded-lg border p-2.5 text-center",
                        analysis.risk.ip_switch_analysis.rapid_switch_count >= 3 
                          ? "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800" 
                          : "bg-muted/30"
                      )}>
                        <div className={cn(
                          "text-lg font-bold",
                          analysis.risk.ip_switch_analysis.rapid_switch_count >= 3 && "text-red-600 dark:text-red-400"
                        )}>
                          {analysis.risk.ip_switch_analysis.rapid_switch_count}
                        </div>
                        <div className="text-xs text-muted-foreground">快速切换</div>
                      </div>
                      <div className={cn(
                        "rounded-lg border p-2.5 text-center",
                        analysis.risk.ip_switch_analysis.avg_ip_duration < 30 && (analysis.risk.ip_switch_analysis.real_switch_count ?? analysis.risk.ip_switch_analysis.switch_count) >= 3
                          ? "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800" 
                          : "bg-muted/30"
                      )}>
                        <div className={cn(
                          "text-lg font-bold",
                          analysis.risk.ip_switch_analysis.avg_ip_duration < 30 && (analysis.risk.ip_switch_analysis.real_switch_count ?? analysis.risk.ip_switch_analysis.switch_count) >= 3 && "text-red-600 dark:text-red-400"
                        )}>
                          {analysis.risk.ip_switch_analysis.avg_ip_duration}s
                        </div>
                        <div className="text-xs text-muted-foreground">平均停留</div>
                      </div>
                    </div>

                    {/* 切换记录 */}
                    {analysis.risk.ip_switch_analysis.switch_details.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-muted-foreground">最近切换记录:</div>
                          <div className="text-xs text-muted-foreground italic flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> 蓝色为双栈切换（正常），红色为异常切换
                          </div>
                        </div>
                        <div className="rounded-lg border overflow-hidden shadow-sm">
                          <div className="bg-muted/30 px-3 py-2 flex text-xs uppercase tracking-wider font-bold text-muted-foreground border-b border-border/60">
                            <div className="w-[120px]">切换时间</div>
                            <div className="flex-1 px-2 text-center">源 IP 地址</div>
                            <div className="w-8"></div>
                            <div className="flex-1 px-2 text-center">目标 IP 地址</div>
                            <div className="w-28 text-right">切换间隔</div>
                          </div>
                          <div className="max-h-[220px] overflow-y-auto overflow-x-hidden bg-background">
                            {analysis.risk.ip_switch_analysis.switch_details.slice(-12).reverse().map((detail, idx) => (
                              <div
                                key={idx}
                                className={cn(
                                  "flex items-center px-3 py-2.5 text-xs border-b last:border-b-0 hover:bg-muted/5 transition-colors group",
                                  detail.is_dual_stack 
                                    ? "bg-blue-50/40 dark:bg-blue-900/10" 
                                    : detail.interval <= 60 
                                      ? "bg-red-50/40 dark:bg-red-900/10" 
                                      : "bg-background"
                                )}
                              >
                                <div className="w-[120px] text-muted-foreground font-mono tabular-nums">
                                  {formatAnalysisTime(detail.time)}
                                </div>
                                <div className="flex-1 px-2 flex justify-center items-center gap-1">
                                  <code className="px-1.5 py-0.5 rounded bg-muted/50 border border-border/80 font-mono text-xs text-foreground inline-block whitespace-nowrap">
                                    {detail.from_ip}
                                  </code>
                                  {detail.from_version && (
                                    <span className={cn(
                                      "text-[10px] px-1 py-0.5 rounded",
                                      detail.from_version === 'v6' ? "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                                    )}>
                                      {detail.from_version}
                                    </span>
                                  )}
                                </div>
                                <div className="w-8 flex justify-center">
                                  <span className={cn(
                                    "transition-colors",
                                    detail.is_dual_stack ? "text-blue-400" : "text-muted-foreground/50 group-hover:text-primary"
                                  )}>→</span>
                                </div>
                                <div className="flex-1 px-2 flex justify-center items-center gap-1">
                                  <code className="px-1.5 py-0.5 rounded bg-muted/50 border border-border/80 font-mono text-xs text-foreground inline-block whitespace-nowrap">
                                    {detail.to_ip}
                                  </code>
                                  {detail.to_version && (
                                    <span className={cn(
                                      "text-[10px] px-1 py-0.5 rounded",
                                      detail.to_version === 'v6' ? "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                                    )}>
                                      {detail.to_version}
                                    </span>
                                  )}
                                </div>
                                <div className="w-28 text-right">
                                  {detail.is_dual_stack ? (
                                    <Badge
                                      variant="outline"
                                      className="px-2 py-0.5 h-6 text-xs font-mono bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400"
                                    >
                                      <span className="mr-1">⇄</span>
                                      双栈
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant={detail.interval <= 60 ? "destructive" : "outline"}
                                      className={cn(
                                        "px-2 py-0.5 h-6 text-xs font-mono",
                                        detail.interval > 60 && "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400"
                                      )}
                                    >
                                      {detail.interval <= 60 ? <AlertTriangle className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
                                      {detail.interval}s
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Recent Logs */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-muted-foreground">最近轨迹 (Latest 10)</h4>
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="h-8 bg-muted/50 hover:bg-muted/50">
                          <TableHead className="h-8 text-xs w-[140px]">时间</TableHead>
                          <TableHead className="h-8 text-xs w-[60px]">状态</TableHead>
                          <TableHead className="h-8 text-xs">模型</TableHead>
                          <TableHead className="h-8 text-xs text-right">耗时</TableHead>
                          <TableHead className="h-8 text-xs text-right w-[120px]">IP</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {analysis.recent_logs.slice(0, 10).map((l) => (
                          <TableRow key={l.id} className="h-8 hover:bg-muted/30">
                            <TableCell className="py-1.5 text-xs text-muted-foreground whitespace-nowrap tabular-nums">{formatAnalysisTime(l.created_at)}</TableCell>
                            <TableCell className="py-1.5 text-xs">
                              {l.type === 5 ? <span className="text-red-500 font-medium">失败</span> : <span className="text-green-500">成功</span>}
                            </TableCell>
                            <TableCell className="py-1.5 text-xs font-medium truncate max-w-[150px]" title={l.model_name}>{l.model_name}</TableCell>
                            <TableCell className="py-1.5 text-xs text-right text-muted-foreground tabular-nums">{l.use_time}ms</TableCell>
                            <TableCell className="py-1.5 text-xs text-right text-muted-foreground font-mono">{l.ip}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Invited Users */}
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
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                暂无分析数据
              </div>
            )}
          </div>

          <DialogFooter className="p-4 border-t bg-muted/10 flex-shrink-0">
            <Button variant="outline" onClick={() => setAnalysisDialogOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

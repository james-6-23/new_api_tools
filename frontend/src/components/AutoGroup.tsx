import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import {
  Users,
  UserPlus,
  Settings,
  Clock,
  Loader2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Play,
  RotateCcw,
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
import { StatCard } from './StatCard'
import { cn } from '../lib/utils'

// Types
interface GroupInfo {
  group_name: string
  user_count: number
}

interface UserInfo {
  id: number
  username: string
  display_name: string
  email: string
  group: string
  source: string
  status: number
  created_time: number
}

interface LogEntry {
  id: number
  user_id: number
  username: string
  old_group: string
  new_group: string
  action: string
  source: string
  operator: string
  created_at: number
}

interface Config {
  enabled: boolean
  mode: string
  target_group: string
  source_rules: Record<string, string>
  scan_interval_minutes: number
  auto_scan_enabled: boolean
  whitelist_ids: number[]
  last_scan_time: number
}

interface Stats {
  pending_count: number
  total_assigned: number
  last_scan_time: number
  next_scan_time: number
  enabled: boolean
  auto_scan_enabled: boolean
}

// Source labels
const SOURCE_LABELS: Record<string, { label: string; icon: typeof Github }> = {
  github: { label: 'GitHub', icon: Github },
  wechat: { label: '微信', icon: MessageCircle },
  telegram: { label: 'Telegram', icon: Send },
  discord: { label: 'Discord', icon: MessageCircle },
  oidc: { label: 'OIDC', icon: Shield },
  linux_do: { label: 'LinuxDO', icon: Users },
  password: { label: '密码注册', icon: Key },
}

function formatTime(ts: number) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AutoGroup() {
  const { token } = useAuth()
  const { showToast } = useToast()

  // Tab state
  const [activeTab, setActiveTab] = useState<'config' | 'preview' | 'logs'>('config')

  // Config state
  const [config, setConfig] = useState<Config | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Groups state
  const [groups, setGroups] = useState<GroupInfo[]>([])

  // Stats state
  const [stats, setStats] = useState<Stats | null>(null)

  // Preview state
  const [previewUsers, setPreviewUsers] = useState<UserInfo[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewPage, setPreviewPage] = useState(1)
  const [previewTotal, setPreviewTotal] = useState(0)
  const [previewTotalPages, setPreviewTotalPages] = useState(0)

  // Logs state
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsPage, setLogsPage] = useState(1)
  const [logsTotal, setLogsTotal] = useState(0)
  const [logsTotalPages, setLogsTotalPages] = useState(0)

  // Scan state
  const [scanning, setScanning] = useState(false)
  const [reverting, setReverting] = useState<number | null>(null)

  // Local input state (for delayed save on Enter/blur)
  const [localScanInterval, setLocalScanInterval] = useState<string>('')
  const [localWhitelist, setLocalWhitelist] = useState<string>('')

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const getAuthHeaders = useCallback(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    }),
    [token]
  )

  // Fetch config
  const fetchConfig = useCallback(async () => {
    setConfigLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/auto-group/config`, {
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        setConfig(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch config:', error)
    } finally {
      setConfigLoading(false)
    }
  }, [apiUrl, getAuthHeaders])

  // Fetch groups
  const fetchGroups = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/auto-group/groups`, {
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        setGroups(data.data.items)
      }
    } catch (error) {
      console.error('Failed to fetch groups:', error)
    }
  }, [apiUrl, getAuthHeaders])

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/auto-group/stats`, {
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        setStats(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    }
  }, [apiUrl, getAuthHeaders])

  // Fetch preview users
  const fetchPreviewUsers = useCallback(async () => {
    setPreviewLoading(true)
    try {
      const params = new URLSearchParams({
        page: previewPage.toString(),
        page_size: '20',
      })
      const response = await fetch(`${apiUrl}/api/auto-group/preview?${params}`, {
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        setPreviewUsers(data.data.items)
        setPreviewTotal(data.data.total)
        setPreviewTotalPages(data.data.total_pages)
      }
    } catch (error) {
      console.error('Failed to fetch preview users:', error)
    } finally {
      setPreviewLoading(false)
    }
  }, [apiUrl, getAuthHeaders, previewPage])

  // Fetch logs
  const fetchLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const params = new URLSearchParams({
        page: logsPage.toString(),
        page_size: '20',
      })
      const response = await fetch(`${apiUrl}/api/auto-group/logs?${params}`, {
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        setLogs(data.data.items)
        setLogsTotal(data.data.total)
        setLogsTotalPages(data.data.total_pages)
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error)
    } finally {
      setLogsLoading(false)
    }
  }, [apiUrl, getAuthHeaders, logsPage])

  // Save config
  const saveConfig = async (updates: Partial<Config>) => {
    setSaving(true)
    try {
      const response = await fetch(`${apiUrl}/api/auto-group/config`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(updates),
      })
      const data = await response.json()
      if (data.success) {
        setConfig(data.data)
        showToast('success', '配置已保存')
      } else {
        showToast('error', data.message || '保存失败')
      }
    } catch (error) {
      showToast('error', '网络错误')
    } finally {
      setSaving(false)
    }
  }

  // Run scan
  const runScan = async (dryRun: boolean) => {
    setScanning(true)
    try {
      const response = await fetch(`${apiUrl}/api/auto-group/scan?dry_run=${dryRun}`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        const stats = data.data.stats
        if (dryRun) {
          showToast('success', `试运行完成: ${stats.total} 个用户, ${stats.assigned} 个将被分配`)
        } else {
          showToast('success', `扫描完成: ${stats.assigned} 个用户已分配`)
        }
        fetchStats()
        fetchPreviewUsers()
        fetchLogs()
      } else {
        showToast('error', data.data?.message || '扫描失败')
      }
    } catch (error) {
      showToast('error', '网络错误')
    } finally {
      setScanning(false)
    }
  }

  // Revert user
  const revertUser = async (logId: number) => {
    setReverting(logId)
    try {
      const response = await fetch(`${apiUrl}/api/auto-group/revert`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ log_id: logId }),
      })
      const data = await response.json()
      if (data.success) {
        showToast('success', data.message)
        fetchLogs()
        fetchStats()
      } else {
        showToast('error', data.message || '恢复失败')
      }
    } catch (error) {
      showToast('error', '网络错误')
    } finally {
      setReverting(null)
    }
  }

  // Initial load
  useEffect(() => {
    fetchConfig()
    fetchGroups()
    fetchStats()
  }, [fetchConfig, fetchGroups, fetchStats])

  // Sync config to local input state
  useEffect(() => {
    if (config) {
      setLocalScanInterval(String(config.scan_interval_minutes || 60))
      setLocalWhitelist((config.whitelist_ids || []).join(', '))
    }
  }, [config])

  // Load tab data
  useEffect(() => {
    if (activeTab === 'preview') fetchPreviewUsers()
    if (activeTab === 'logs') fetchLogs()
  }, [activeTab, fetchPreviewUsers, fetchLogs])

  const renderSourceBadge = (source: string) => {
    const info = SOURCE_LABELS[source] || { label: source, icon: Users }
    const Icon = info.icon
    return (
      <Badge variant="outline" className="gap-1">
        <Icon className="h-3 w-3" />
        {info.label}
      </Badge>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">自动分组</h2>
          <p className="text-muted-foreground mt-1">
            将 default 组的新用户自动分配到目标用户组
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            fetchConfig()
            fetchGroups()
            fetchStats()
          }}
          disabled={configLoading}
        >
          <RefreshCw className={cn('h-4 w-4 mr-2', configLoading && 'animate-spin')} />
          刷新
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="待分配用户"
          value={stats?.pending_count ?? 0}
          icon={Users}
          color="blue"
        />
        <StatCard
          title="累计已分配"
          value={stats?.total_assigned ?? 0}
          icon={UserPlus}
          color="green"
        />
        <StatCard
          title="上次扫描"
          value={stats?.last_scan_time ? formatTime(stats.last_scan_time) : '-'}
          icon={Clock}
          color="purple"
        />
        <StatCard
          title="功能状态"
          value={stats?.enabled ? '已启用' : '未启用'}
          icon={Settings}
          color={stats?.enabled ? 'green' : 'gray'}
          className={stats?.enabled ? 'border-green-500/20' : ''}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {[
          { id: 'config', label: '配置设置', icon: Settings },
          { id: 'preview', label: '待分配预览', icon: Users },
          { id: 'logs', label: '分配日志', icon: Clock },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Config Tab */}
      {activeTab === 'config' && (
        <Card>
          <CardHeader>
            <CardTitle>配置设置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {configLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : config ? (
              <>
                {/* Enable/Disable */}
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">启用自动分组</h4>
                    <p className="text-sm text-muted-foreground">
                      启用后将根据配置自动分配新用户
                    </p>
                  </div>
                  <Button
                    variant={config.enabled ? 'default' : 'outline'}
                    onClick={() => saveConfig({ enabled: !config.enabled })}
                    disabled={saving}
                  >
                    {config.enabled ? '已启用' : '未启用'}
                  </Button>
                </div>

                {/* Mode Selection */}
                <div className="space-y-2">
                  <h4 className="font-medium">分组模式</h4>
                  <Select
                    value={config.mode}
                    onChange={(e) => saveConfig({ mode: e.target.value })}
                    disabled={saving}
                  >
                    <option value="simple">简单模式 - 所有用户分配到同一分组</option>
                    <option value="by_source">按来源分组 - 根据注册来源分配到不同分组</option>
                  </Select>
                </div>

                {/* Simple Mode: Target Group */}
                {config.mode === 'simple' && (
                  <div className="space-y-2">
                    <h4 className="font-medium">目标分组</h4>
                    <Select
                      value={config.target_group}
                      onChange={(e) => saveConfig({ target_group: e.target.value })}
                      disabled={saving}
                    >
                      <option value="">-- 请选择目标分组 --</option>
                      {groups
                        .filter((g) => g.group_name !== 'default')
                        .map((g) => (
                          <option key={g.group_name} value={g.group_name}>
                            {g.group_name}
                          </option>
                        ))}
                    </Select>
                    <p className="text-sm text-muted-foreground">
                      所有 default 组的新用户将被分配到此分组
                    </p>
                  </div>
                )}

                {/* By Source Mode: Source Rules */}
                {config.mode === 'by_source' && (
                  <div className="space-y-4">
                    <h4 className="font-medium">按来源分组规则</h4>
                    <p className="text-sm text-muted-foreground">
                      为每种注册来源配置目标分组，留空表示不处理该来源的用户
                    </p>
                    <div className="grid gap-3">
                      {Object.entries(SOURCE_LABELS).map(([source, info]) => (
                        <div key={source} className="flex items-center gap-4">
                          <div className="w-32 flex items-center gap-2">
                            <info.icon className="h-4 w-4" />
                            <span className="text-sm">{info.label}</span>
                          </div>
                          <Select
                            value={config.source_rules[source] || ''}
                            onChange={(e) =>
                              saveConfig({
                                source_rules: {
                                  ...config.source_rules,
                                  [source]: e.target.value,
                                },
                              })
                            }
                            disabled={saving}
                            className="flex-1"
                          >
                            <option value="">-- 不处理 --</option>
                            {groups
                              .filter((g) => g.group_name !== 'default')
                              .map((g) => (
                                <option key={g.group_name} value={g.group_name}>
                                  {g.group_name}
                                </option>
                              ))}
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Auto Scan */}
                <div className="space-y-4 pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium">自动扫描</h4>
                      <p className="text-sm text-muted-foreground">
                        启用后将定时自动执行分组分配
                      </p>
                    </div>
                    <Button
                      variant={config.auto_scan_enabled ? 'default' : 'outline'}
                      onClick={() => saveConfig({ auto_scan_enabled: !config.auto_scan_enabled })}
                      disabled={saving}
                    >
                      {config.auto_scan_enabled ? '已启用' : '未启用'}
                    </Button>
                  </div>

                  {config.auto_scan_enabled && (
                    <div className="space-y-2">
                      <h4 className="font-medium">扫描间隔（分钟）</h4>
                      <Input
                        type="number"
                        min={1}
                        max={1440}
                        value={localScanInterval}
                        onChange={(e) => setLocalScanInterval(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            saveConfig({ scan_interval_minutes: parseInt(localScanInterval) || 60 })
                          }
                        }}
                        onBlur={() => {
                          saveConfig({ scan_interval_minutes: parseInt(localScanInterval) || 60 })
                        }}
                        disabled={saving}
                        className="w-32"
                      />
                    </div>
                  )}
                </div>

                {/* Whitelist */}
                <div className="space-y-2 pt-4 border-t">
                  <h4 className="font-medium">白名单用户ID</h4>
                  <p className="text-sm text-muted-foreground">
                    白名单中的用户不会被自动分组，多个ID用逗号分隔
                  </p>
                  <Input
                    value={localWhitelist}
                    onChange={(e) => setLocalWhitelist(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const ids = localWhitelist
                          .split(',')
                          .map((s) => parseInt(s.trim()))
                          .filter((n) => !isNaN(n))
                        saveConfig({ whitelist_ids: ids })
                      }
                    }}
                    onBlur={() => {
                      const ids = localWhitelist
                        .split(',')
                        .map((s) => parseInt(s.trim()))
                        .filter((n) => !isNaN(n))
                      saveConfig({ whitelist_ids: ids })
                    }}
                    placeholder="例如: 1, 2, 3"
                    disabled={saving}
                  />
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">加载配置失败</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Preview Tab */}
      {activeTab === 'preview' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>待分配用户预览</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => runScan(true)}
                disabled={scanning || !config?.enabled}
              >
                {scanning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                试运行
              </Button>
              <Button
                size="sm"
                onClick={() => runScan(false)}
                disabled={scanning || !config?.enabled}
              >
                {scanning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                执行分配
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {!config?.enabled && (
              <div className="text-center py-4 text-muted-foreground">
                请先启用自动分组功能
              </div>
            )}
            {config?.enabled && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>用户名</TableHead>
                      <TableHead>当前分组</TableHead>
                      <TableHead>注册来源</TableHead>
                      <TableHead>注册时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                        </TableCell>
                      </TableRow>
                    ) : previewUsers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          没有待分配的用户
                        </TableCell>
                      </TableRow>
                    ) : (
                      previewUsers.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell>{user.id}</TableCell>
                          <TableCell>{user.username}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{user.group || 'default'}</Badge>
                          </TableCell>
                          <TableCell>{renderSourceBadge(user.source)}</TableCell>
                          <TableCell>{formatTime(user.created_time)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>

                {/* Pagination */}
                {previewTotalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      共 {previewTotal} 条记录
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                        disabled={previewPage === 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm">
                        {previewPage} / {previewTotalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPreviewPage((p) => Math.min(previewTotalPages, p + 1))}
                        disabled={previewPage === previewTotalPages}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Logs Tab */}
      {activeTab === 'logs' && (
        <Card>
          <CardHeader>
            <CardTitle>分配日志</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead>原分组</TableHead>
                  <TableHead>新分组</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>操作</TableHead>
                  <TableHead>操作者</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      暂无日志记录
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>{formatTime(log.created_at)}</TableCell>
                      <TableCell>
                        {log.username}
                        <span className="text-muted-foreground ml-1">#{log.user_id}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{log.old_group}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{log.new_group}</Badge>
                      </TableCell>
                      <TableCell>{renderSourceBadge(log.source)}</TableCell>
                      <TableCell>
                        <Badge variant={log.action === 'assign' ? 'default' : 'secondary'}>
                          {log.action === 'assign' ? '分配' : '恢复'}
                        </Badge>
                      </TableCell>
                      <TableCell>{log.operator}</TableCell>
                      <TableCell>
                        {log.action === 'assign' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => revertUser(log.id)}
                            disabled={reverting === log.id}
                          >
                            {reverting === log.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            {/* Pagination */}
            {logsTotalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">共 {logsTotal} 条记录</p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
                    disabled={logsPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">
                    {logsPage} / {logsTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLogsPage((p) => Math.min(logsTotalPages, p + 1))}
                    disabled={logsPage === logsTotalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

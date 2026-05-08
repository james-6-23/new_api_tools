import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Database,
  Eye,
  Inbox,
  Loader2,
  RadioTower,
  RefreshCw,
  Send,
  ShieldAlert,
  UserSearch,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { apiFetch, createAuthHeaders } from '../lib/api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { useToast } from './Toast'
import { UserAnalysisDialog } from './UserAnalysisDialog'

type BroadcastStatus = {
  enabled: boolean
  configured: boolean
  hub_url: string
  node_id: string
  has_secret: boolean
  pull_interval_seconds: number
  store_path: string
  cursor: number
  last_sync_at: number
  last_error?: string
  reports: number
  identities: number
  unread_reports: number
  outgoing_reports: number
}

type BroadcastIdentity = {
  type: string
  value?: string
  hash: string
  confidence: number
}

type BroadcastReport = {
  report_id: string
  reporter_node_id: string
  reason: string
  severity: string
  status: string
  description?: string
  evidence_summary?: string
  created_at: number
  updated_at: number
  synced_at: number
  read_at: number
  matched_at: number
  identities?: BroadcastIdentity[]
}

type OutgoingReport = {
  local_report_id: string
  hub_report_id: string
  local_user_id: number
  username: string
  display_name?: string
  reason: string
  severity: string
  status: string
  last_error?: string
  created_at: number
  submitted_at: number
  updated_at: number
}

type MatchedUser = {
  user_id: number
  username: string
  display_name?: string
  status: number
  linux_do_id?: string
  match_types: string[]
  matched_ips?: string[]
  request_count: number
  first_seen: number
  last_seen: number
}

type MatchResult = {
  report_id: string
  matched_at: number
  users: MatchedUser[]
  identities: BroadcastIdentity[]
}

type BroadcastSettings = {
  enabled: boolean
  hub_url: string
  node_id: string
  has_secret: boolean
  pull_interval_seconds: number
  updated_at: number
}

type SettingsForm = {
  enabled: boolean
  hub_url: string
  node_id: string
  secret: string
  pull_interval_seconds: number
}

type ApiEnvelope<T> = {
  success: boolean
  data?: T
  message?: string
  error?: string | { message?: string }
}

type BroadcastView = 'inbox' | 'outgoing' | 'status'

const emptySettingsForm: SettingsForm = {
  enabled: false,
  hub_url: '',
  node_id: '',
  secret: '',
  pull_interval_seconds: 300,
}

export function AbuseBroadcast() {
  const { token } = useAuth()
  const { showToast } = useToast()
  const apiUrl = import.meta.env.VITE_API_URL || ''
  const [activeView, setActiveView] = useState<BroadcastView>(() => initialView())
  const [status, setStatus] = useState<BroadcastStatus | null>(null)
  const [reports, setReports] = useState<BroadcastReport[]>([])
  const [outgoingReports, setOutgoingReports] = useState<OutgoingReport[]>([])
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [selectedReport, setSelectedReport] = useState<BroadcastReport | null>(null)
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)
  const [matchLoading, setMatchLoading] = useState(false)
  const [matchError, setMatchError] = useState('')
  const [analysisUser, setAnalysisUser] = useState<{ userId: number; username: string } | null>(null)
  const [settings, setSettings] = useState<BroadcastSettings | null>(null)
  const [settingsForm, setSettingsForm] = useState<SettingsForm>(emptySettingsForm)
  const [savingSettings, setSavingSettings] = useState(false)

  const readAPI = useCallback(async <T,>(path: string, options: RequestInit = {}) => {
    const response = await apiFetch(`${apiUrl}${path}`, {
      ...options,
      headers: {
        ...createAuthHeaders(token),
        ...(options.headers || {}),
      },
    })
    const payload = (await response.json()) as ApiEnvelope<T>
    if (!response.ok || !payload.success) {
      const message = typeof payload.error === 'string' ? payload.error : payload.error?.message
      throw new Error(message || '请求失败')
    }
    return payload.data as T
  }, [apiUrl, token])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextStatus, nextReports, nextOutgoing, nextSettings] = await Promise.all([
        readAPI<BroadcastStatus>('/api/abuse-broadcast/status'),
        readAPI<BroadcastReport[]>('/api/abuse-broadcast/reports?limit=100'),
        readAPI<OutgoingReport[]>('/api/abuse-broadcast/outgoing-reports?limit=100'),
        readAPI<BroadcastSettings>('/api/abuse-broadcast/settings'),
      ])
      setStatus(nextStatus)
      setReports(nextReports || [])
      setOutgoingReports(nextOutgoing || [])
      setSettings(nextSettings)
      setSettingsForm({
        enabled: nextSettings.enabled,
        hub_url: nextSettings.hub_url || '',
        node_id: nextSettings.node_id || '',
        secret: '',
        pull_interval_seconds: nextSettings.pull_interval_seconds || 300,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [readAPI])

  const saveSettings = async () => {
    setSavingSettings(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        enabled: settingsForm.enabled,
        hub_url: settingsForm.hub_url.trim(),
        node_id: settingsForm.node_id.trim(),
        pull_interval_seconds: Number(settingsForm.pull_interval_seconds) || 300,
      }
      if (settingsForm.secret !== '') {
        payload.secret = settingsForm.secret
      }
      await readAPI<BroadcastSettings>('/api/abuse-broadcast/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      showToast('success', '配置已保存')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSavingSettings(false)
    }
  }

  const clearSecret = async () => {
    if (!confirm('确定清空已保存的 Secret？清空后需重新填写才能继续连接 Hub。')) return
    setSavingSettings(true)
    setError('')
    try {
      await readAPI<BroadcastSettings>('/api/abuse-broadcast/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: '' }),
      })
      showToast('success', '已清空密钥')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '清空失败')
    } finally {
      setSavingSettings(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const listener = () => setActiveView('inbox')
    window.addEventListener('abuse-broadcast-open-inbox', listener)
    return () => window.removeEventListener('abuse-broadcast-open-inbox', listener)
  }, [])

  const syncNow = async () => {
    setSyncing(true)
    setError('')
    try {
      await readAPI('/api/abuse-broadcast/sync', { method: 'POST' })
      showToast('success', '同步完成')
      await refresh()
      window.dispatchEvent(new CustomEvent('abuse-broadcast-unread-changed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步失败')
    } finally {
      setSyncing(false)
    }
  }

  const connectHub = async () => {
    setConnecting(true)
    setError('')
    try {
      await readAPI('/api/abuse-broadcast/connect', { method: 'POST' })
      showToast('success', 'Hub 连接成功，节点已在广播站激活')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败')
    } finally {
      setConnecting(false)
    }
  }

  const openReportDetail = async (report: BroadcastReport) => {
    const nextReport = { ...report, read_at: report.read_at || Math.floor(Date.now() / 1000) }
    setSelectedReport(nextReport)
    setMatchResult(null)
    setMatchError('')
    setMatchLoading(true)
    try {
      if (!report.read_at) {
        await readAPI(`/api/abuse-broadcast/reports/${encodeURIComponent(report.report_id)}/read`, { method: 'POST' })
        setReports(prev => prev.map(item => item.report_id === report.report_id ? nextReport : item))
        window.dispatchEvent(new CustomEvent('abuse-broadcast-unread-changed'))
      }
      const matches = await readAPI<MatchResult>(`/api/abuse-broadcast/reports/${encodeURIComponent(report.report_id)}/matches`)
      setMatchResult(matches)
    } catch (err) {
      setMatchError(err instanceof Error ? err.message : '匹配失败')
    } finally {
      setMatchLoading(false)
    }
  }

  const unreadCount = useMemo(() => reports.filter(report => !report.read_at).length, [reports])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <RadioTower className="h-6 w-6 text-primary" />
            联合违规广播
          </h2>
          <p className="text-sm text-muted-foreground mt-1">接收跨站通报、查看自己的通报记录，并按 LinuxDo ID / IP 匹配本地用户。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void refresh()} disabled={loading || syncing || connecting}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button variant="outline" onClick={() => void connectHub()} disabled={connecting || !status?.configured}>
            <RadioTower className={`h-4 w-4 mr-2 ${connecting ? 'animate-pulse' : ''}`} />
            连接 Hub
          </Button>
          <Button onClick={() => void syncNow()} disabled={syncing || connecting || !status?.enabled || !status?.configured}>
            <RadioTower className={`h-4 w-4 mr-2 ${syncing ? 'animate-pulse' : ''}`} />
            立即同步
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {status && (!status.enabled || !status.configured) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          尚未启用拉取或缺少接入信息。请在下方「接入状态」页填写 Hub URL、节点名称、密钥后保存即可。
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="未读通报" value={String(unreadCount)} icon={<Inbox className="h-5 w-5" />} />
        <MetricCard title="同步 Cursor" value={String(status?.cursor || 0)} icon={<Database className="h-5 w-5" />} />
        <MetricCard title="收到通报" value={String(status?.reports || 0)} icon={<AlertTriangle className="h-5 w-5" />} />
        <MetricCard title="我的通报" value={String(status?.outgoing_reports || outgoingReports.length)} icon={<Send className="h-5 w-5" />} />
      </div>

      <Tabs value={activeView} onValueChange={(value) => setActiveView(value as BroadcastView)}>
        <TabsList className="grid w-full grid-cols-3 md:w-auto">
          <TabsTrigger value="inbox">收件箱</TabsTrigger>
          <TabsTrigger value="outgoing">我的通报</TabsTrigger>
          <TabsTrigger value="status">接入状态</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Inbox className="h-4 w-4" />
                收到的通报
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveTable
                empty="暂无通报"
                columns={['状态', 'Report ID', '原因', '等级', '身份', '来源', '同步时间', '操作']}
                rows={reports.map((report) => [
                  report.read_at ? <Badge variant="secondary">已读</Badge> : <Badge variant="destructive">未读</Badge>,
                  <code className="text-xs">{report.report_id}</code>,
                  report.reason || '-',
                  <SeverityBadge value={report.severity} />,
                  identitySummary(report.identities),
                  <code className="text-xs">{report.reporter_node_id || '-'}</code>,
                  formatTime(report.synced_at || report.created_at),
                  <Button size="sm" variant="outline" onClick={() => void openReportDetail(report)}>
                    <Eye className="h-3.5 w-3.5 mr-1" />
                    查看
                  </Button>,
                ])}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="outgoing" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="h-4 w-4" />
                我的通报记录
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveTable
                empty="暂无通报记录"
                columns={['状态', 'Hub Report ID', '用户', '原因', '等级', '提交时间', '错误']}
                rows={outgoingReports.map((report) => [
                  <OutgoingStatus value={report.status} />,
                  report.hub_report_id ? <code className="text-xs">{report.hub_report_id}</code> : <code className="text-xs">{report.local_report_id}</code>,
                  <span>{report.display_name || report.username || `用户#${report.local_user_id}`}</span>,
                  report.reason || '-',
                  <SeverityBadge value={report.severity} />,
                  formatTime(report.submitted_at || report.created_at),
                  report.last_error || '-',
                ])}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="status" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Hub 接入配置</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={settingsForm.enabled}
                  onChange={(e) => setSettingsForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                />
                启用拉取（关闭时仅暂停后台同步，已缓存的通报仍可查询）
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Hub URL</label>
                  <Input
                    placeholder="http://hub.example.com:8888/v1/live"
                    value={settingsForm.hub_url}
                    onChange={(e) => setSettingsForm((prev) => ({ ...prev, hub_url: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">密钥名称 / 节点</label>
                  <Input
                    placeholder="site-a"
                    value={settingsForm.node_id}
                    onChange={(e) => setSettingsForm((prev) => ({ ...prev, node_id: e.target.value }))}
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs text-muted-foreground">
                    Secret {settings?.has_secret ? <span className="text-emerald-600">（已配置，留空则保持不变）</span> : <span className="text-amber-600">（未配置）</span>}
                  </label>
                  <Input
                    type="password"
                    placeholder={settings?.has_secret ? '••••••••（留空保持不变）' : 'sk_live_xxx'}
                    value={settingsForm.secret}
                    onChange={(e) => setSettingsForm((prev) => ({ ...prev, secret: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">拉取间隔（秒）</label>
                  <Input
                    type="number"
                    min={30}
                    value={settingsForm.pull_interval_seconds}
                    onChange={(e) => setSettingsForm((prev) => ({ ...prev, pull_interval_seconds: Number(e.target.value) || 0 }))}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void saveSettings()} disabled={savingSettings}>
                  {savingSettings ? '保存中...' : '保存配置'}
                </Button>
                {settings?.has_secret && (
                  <Button variant="outline" onClick={() => void clearSecret()} disabled={savingSettings}>
                    清空 Secret
                  </Button>
                )}
                {settings?.updated_at ? (
                  <span className="text-xs text-muted-foreground">最近更新：{formatTime(settings.updated_at)}</span>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">运行状态</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm md:grid-cols-2">
              <InfoRow label="接入状态" value={status?.enabled && status?.configured ? '已接入' : '未接入'} />
              <InfoRow label="Hub" value={status?.hub_url || '-'} />
              <InfoRow label="密钥名称 / 节点" value={status?.node_id || '-'} />
              <InfoRow label="Secret" value={status?.has_secret ? '已配置' : '未配置'} />
              <InfoRow label="拉取间隔" value={`${status?.pull_interval_seconds || 300}s`} />
              <InfoRow label="本地缓存" value={status?.store_path || '-'} />
              <InfoRow label="上次同步" value={formatTime(status?.last_sync_at)} />
              {status?.last_error && <InfoRow label="同步错误" value={status.last_error} danger />}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ReportDetailDialog
        report={selectedReport}
        matchResult={matchResult}
        loading={matchLoading}
        error={matchError}
        onClose={() => setSelectedReport(null)}
        onOpenUser={(user) => setAnalysisUser({ userId: user.user_id, username: user.username || `用户#${user.user_id}` })}
      />

      {analysisUser && (
        <UserAnalysisDialog
          open={!!analysisUser}
          onOpenChange={(open) => { if (!open) setAnalysisUser(null) }}
          userId={analysisUser.userId}
          username={analysisUser.username}
          source="risk_center"
          contextData={{ source: 'abuse_broadcast_match' }}
        />
      )}
    </div>
  )
}

function MetricCard({ title, value, icon }: { title: string; value: string; icon: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary grid place-items-center">{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground">{title}</div>
          <div className="text-lg font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function InfoRow({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 break-all font-medium ${danger ? 'text-destructive' : 'text-foreground'}`}>{value}</div>
    </div>
  )
}

function ResponsiveTable({ columns, rows, empty }: { columns: string[]; rows: ReactNode[][]; empty: string }) {
  return (
    <>
      {/* Mobile: stacked card list */}
      <div className="md:hidden divide-y divide-border/60">
        {rows.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground text-sm">{empty}</div>
        ) : rows.map((row, rowIndex) => (
          <div key={rowIndex} className="py-3 space-y-1.5 text-sm">
            {row.map((cell, cellIndex) => (
              <div key={cellIndex} className="flex gap-2">
                <span className="shrink-0 w-20 text-xs text-muted-foreground">{columns[cellIndex]}</span>
                <span className="flex-1 min-w-0 break-words">{cell}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Desktop: table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              {columns.map((column) => (
                <th key={column} className="py-2 pr-4 font-medium whitespace-nowrap">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-10 text-center text-muted-foreground">{empty}</td>
              </tr>
            ) : rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b last:border-0">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="py-3 pr-4 align-middle whitespace-nowrap">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ReportDetailDialog({
  report,
  matchResult,
  loading,
  error,
  onClose,
  onOpenUser,
}: {
  report: BroadcastReport | null
  matchResult: MatchResult | null
  loading: boolean
  error: string
  onClose: () => void
  onOpenUser: (user: MatchedUser) => void
}) {
  return (
    <Dialog open={!!report} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-5xl w-full">
        {report && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-600" />
                通报详情
              </DialogTitle>
              <DialogDescription>
                {report.report_id} · 来源节点 {report.reporter_node_id || '-'}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-5">
              <div className="grid gap-3 md:grid-cols-4">
                <InfoRow label="原因" value={report.reason || '-'} />
                <InfoRow label="等级" value={report.severity || 'medium'} />
                <InfoRow label="状态" value={report.status || '-'} />
                <InfoRow label="通报时间" value={formatTime(report.created_at)} />
              </div>

              {report.description && (
                <div className="rounded-md border bg-muted/20 p-3 text-sm leading-6 whitespace-pre-wrap">
                  {report.description}
                </div>
              )}

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">身份信息</h3>
                <div className="flex flex-wrap gap-2">
                  {(report.identities || []).length === 0 ? (
                    <span className="text-sm text-muted-foreground">暂无身份信息</span>
                  ) : report.identities?.map((identity, index) => (
                    <Badge key={`${identity.type}-${identity.value || identity.hash}-${index}`} variant={identity.type === 'ip' ? 'secondary' : 'warning'} className="font-mono">
                      {identity.type}: {identity.value || identity.hash?.slice(0, 16) || '-'}
                    </Badge>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <UserSearch className="h-4 w-4" />
                  本地匹配结果
                </h3>
                {loading ? (
                  <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    正在匹配 LinuxDo ID 和 IP...
                  </div>
                ) : error ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
                ) : (
                  <ResponsiveTable
                    empty="未匹配到本地用户"
                    columns={['用户', '状态', '命中', 'LinuxDo ID', '命中 IP', '请求数', '最近出现', '操作']}
                    rows={(matchResult?.users || []).map((user) => [
                      <span>{user.display_name || user.username || `用户#${user.user_id}`} <code className="text-xs">#{user.user_id}</code></span>,
                      user.status === 2 ? <Badge variant="destructive">已禁用</Badge> : <Badge variant="success">正常</Badge>,
                      user.match_types.join(', '),
                      user.linux_do_id || '-',
                      (user.matched_ips || []).join(', ') || '-',
                      String(user.request_count || 0),
                      formatTime(user.last_seen),
                      <Button size="sm" variant="outline" onClick={() => onOpenUser(user)}>
                        <Eye className="h-3.5 w-3.5 mr-1" />
                        分析
                      </Button>,
                    ])}
                  />
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">证据摘要</h3>
                <pre className="max-h-72 overflow-auto rounded-md border bg-slate-950 p-3 text-xs leading-5 text-slate-100">{prettyEvidence(report.evidence_summary)}</pre>
              </section>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SeverityBadge({ value }: { value: string }) {
  const variant = value === 'critical' || value === 'high' ? 'destructive' : value === 'medium' ? 'warning' : 'secondary'
  return <Badge variant={variant}>{value || 'medium'}</Badge>
}

function OutgoingStatus({ value }: { value: string }) {
  if (value === 'submitted') return <Badge variant="success">已提交</Badge>
  if (value === 'failed') return <Badge variant="destructive">失败</Badge>
  return <Badge variant="secondary">待提交</Badge>
}

function identitySummary(identities?: BroadcastIdentity[]) {
  if (!identities || identities.length === 0) return '-'
  return identities.map((identity) => `${identity.type}:${identity.value || identity.hash.slice(0, 12)}`).join(', ')
}

function formatTime(timestamp?: number) {
  if (!timestamp) return '-'
  return new Date(timestamp * 1000).toLocaleString('zh-CN')
}

function prettyEvidence(value?: string) {
  if (!value) return '{}'
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function initialView(): BroadcastView {
  const view = new URLSearchParams(window.location.search).get('view')
  if (view === 'outgoing' || view === 'status') return view
  return 'inbox'
}

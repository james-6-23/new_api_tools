import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../Toast'
import { Eye, Loader2, AlertTriangle, ShieldCheck, Activity, Globe, Users } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Select } from '../ui/select'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Card, CardContent } from '../ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { Progress } from '../ui/progress'
import { cn } from '../../lib/utils'
import type { UserAnalysis } from '../../types/user'

// 导入常量
const WINDOW_LABELS_MAP: Record<string, string> = {
  '1h': '1小时内',
  '3h': '3小时内',
  '6h': '6小时内',
  '12h': '12小时内',
  '24h': '24小时内',
  '3d': '3天内',
  '7d': '7天内',
}

const RISK_FLAG_LABELS_MAP: Record<string, string> = {
  'HIGH_RPM': '请求频率过高',
  'MANY_IPS': '多IP访问',
  'HIGH_FAILURE_RATE': '失败率过高',
  'HIGH_EMPTY_RATE': '空回复率过高',
  'RAPID_IP_SWITCH': '频繁切换IP',
}

// 额度换算常量: 1 USD = 500000 quota units
const QUOTA_PER_USD = 500000

const formatAnalysisNumber = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString()

const formatQuota = (quota: number) => `$${(quota / QUOTA_PER_USD).toFixed(2)}`

const formatTimestamp = (ts: number) => {
  const date = new Date(ts * 1000)
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface UserAnalysisDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId?: number
  username?: string
  defaultWindow?: string
}

export function UserAnalysisDialog({
  open,
  onOpenChange,
  userId,
  username,
  defaultWindow = '24h'
}: UserAnalysisDialogProps) {
  const { token } = useAuth()
  const { showToast } = useToast()
  const [analysisWindow, setAnalysisWindow] = useState<string>(defaultWindow)
  const [analysis, setAnalysis] = useState<UserAnalysis | null>(null)
  const [loading, setLoading] = useState(false)

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  // 获取用户分析数据
  const fetchUserAnalysis = useCallback(async () => {
    if (!userId || !open) return
    setLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/risk/users/${userId}/analysis?window=${analysisWindow}`, { headers: getAuthHeaders() })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: '请求失败' }))
        throw new Error(errorData.message || `HTTP ${response.status}`)
      }
      const data = await response.json()
      if (data.success) {
        setAnalysis(data.data)
      } else {
        throw new Error(data.message || '获取用户分析失败')
      }
    } catch (error) {
      console.error('Failed to fetch user analysis:', error)
      showToast('error', '获取用户分析失败: ' + (error instanceof Error ? error.message : '未知错误'))
      setAnalysis(null)
    } finally {
      setLoading(false)
    }
  }, [apiUrl, getAuthHeaders, userId, analysisWindow, open, showToast])

  useEffect(() => {
    if (open && userId) {
      fetchUserAnalysis()
    }
  }, [open, userId, analysisWindow, fetchUserAnalysis])

  // 重置状态当对话框关闭时
  useEffect(() => {
    if (!open) {
      setAnalysis(null)
      setAnalysisWindow(defaultWindow)
    }
  }, [open, defaultWindow])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-full max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden rounded-xl border-border/50 shadow-2xl">
        <DialogHeader className="p-5 border-b bg-muted/10 flex-shrink-0">
          <div className="flex justify-between items-start pr-6">
            <div>
              <DialogTitle className="text-xl flex items-center gap-2">
                <Eye className="h-5 w-5 text-primary" />
                用户行为分析
              </DialogTitle>
              <DialogDescription className="mt-1.5 flex items-center gap-2">
                <span>用户: <span className="font-mono text-foreground font-medium">{username}</span></span>
                <span className="text-muted-foreground">ID: {userId}</span>
              </DialogDescription>
            </div>
            <Select
              value={analysisWindow}
              onChange={(e) => setAnalysisWindow(e.target.value)}
              className="w-28 h-8 text-sm"
            >
              {Object.entries(WINDOW_LABELS_MAP).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 min-h-0 bg-background">
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
              <Loader2 className="h-8 w-8 mb-4 animate-spin text-primary/50" />
              <p>正在分析用户行为数据...</p>
            </div>
          ) : analysis ? (
            <div className="space-y-6">
              {/* Quota Info */}
              {(analysis.user.quota !== undefined || analysis.user.used_quota !== undefined) && (
                <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-muted/30 border">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">账户额度:</span>
                  <span className="font-semibold text-primary">{formatQuota((analysis.user.quota || 0) + (analysis.user.used_quota || 0))}</span>
                  <span className="text-muted-foreground">|</span>
                  <span className="text-sm text-muted-foreground">已使用:</span>
                  <span className="font-semibold">{formatQuota(analysis.user.used_quota || 0)}</span>
                  <span className="text-muted-foreground">|</span>
                  <span className="text-sm text-muted-foreground">剩余:</span>
                  <span className="font-semibold text-green-600">{formatQuota(analysis.user.quota || 0)}</span>
                </div>
              )}

              {/* Risk Flags */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="px-3 py-1 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  RPM: {analysis.risk.requests_per_minute.toFixed(1)}
                </Badge>
                <Badge variant="secondary" className="px-3 py-1 bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                  均额: ${((analysis.risk.avg_quota_per_request || 0) / QUOTA_PER_USD).toFixed(4)}
                </Badge>
                {analysis.risk.risk_flags.length > 0 ? (
                  analysis.risk.risk_flags.map((f) => (
                    <Badge key={f} variant="destructive" className="px-3 py-1 animate-pulse">
                      <AlertTriangle className="w-3 h-3 mr-1" /> {RISK_FLAG_LABELS_MAP[f] || f}
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

              {/* Recent Logs */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground">最近轨迹 (Latest 10)</h4>
                {analysis.recent_logs.length ? (
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader className="bg-muted/30">
                        <TableRow>
                          <TableHead className="text-xs">时间</TableHead>
                          <TableHead className="text-xs">状态</TableHead>
                          <TableHead className="text-xs">模型</TableHead>
                          <TableHead className="text-xs text-right">耗时</TableHead>
                          <TableHead className="text-xs text-right">IP</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {analysis.recent_logs.slice(0, 10).map((log) => (
                          <TableRow key={log.id} className="text-xs">
                            <TableCell className="py-2">{formatTimestamp(log.created_at)}</TableCell>
                            <TableCell className="py-2">
                              <Badge variant={log.type === 2 ? 'success' : 'destructive'} className="text-xs px-1.5 py-0">
                                {log.type === 2 ? '成功' : '失败'}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-2 font-mono truncate max-w-[200px]">{log.model_name}</TableCell>
                            <TableCell className="py-2 text-right tabular-nums">{log.use_time}ms</TableCell>
                            <TableCell className="py-2 text-right font-mono text-muted-foreground">{log.ip?.split(',')[0] || '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : <div className="text-xs text-muted-foreground italic">无数据</div>}
              </div>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-muted-foreground">
              暂无数据
            </div>
          )}
        </div>

        <DialogFooter className="p-4 border-t bg-muted/10">
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

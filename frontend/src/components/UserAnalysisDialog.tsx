import { useState, useCallback, useEffect, type ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import {
    Eye, Loader2, AlertTriangle, ShieldCheck, ShieldBan, ShieldX,
    Activity, Globe, Clock, ExternalLink,
} from 'lucide-react'
import { Card, CardContent } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Progress } from './ui/progress'
import { Select } from './ui/select'
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from './ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { cn, isCloudflareIp } from '../lib/utils'

// ── 类型定义 ──────────────────────────────────────────

interface IPSwitchAnalysis {
    switch_count: number
    rapid_switch_count: number
    avg_ip_duration: number
    real_switch_count?: number
    dual_stack_switches?: number
    switch_details: Array<{
        time: number
        from_ip: string
        to_ip: string
        interval: number
        is_dual_stack?: boolean
        from_version?: string
        to_version?: string
    }>
}

export interface UserAnalysis {
    range: { start_time: number; end_time: number; window_seconds: number }
    user: {
        id: number; username: string; display_name?: string | null; email?: string | null
        status: number; group?: string | null; remark?: string | null
        in_whitelist?: boolean; linux_do_id?: string | null
    }
    summary: {
        total_requests: number; success_requests: number; failure_requests: number
        quota_used: number; prompt_tokens: number; completion_tokens: number
        avg_use_time: number; unique_ips: number; unique_tokens: number
        unique_models: number; unique_channels: number; empty_count: number
        failure_rate: number; empty_rate: number
    }
    risk: {
        requests_per_minute: number; avg_quota_per_request?: number
        risk_flags: string[]; ip_switch_analysis?: IPSwitchAnalysis
        checkin_analysis?: {
            checkin_count: number
            total_quota_awarded: number
            requests_per_checkin: number
        }
    }
    top_models: Array<{ model_name: string; requests: number }>
    top_channels?: Array<{ channel_id: number; channel_name: string; requests: number; quota_used: number }>
    top_ips: Array<{ ip: string; requests: number }>
    recent_logs?: Array<{
        id: number; created_at: number; type: number; model_name: string
        quota: number; prompt_tokens: number; completion_tokens: number
        use_time: number; ip: string; channel_name: string; token_name: string
    }>
}

// ── 常量 ──────────────────────────────────────────────

export const RISK_FLAG_LABELS: Record<string, string> = {
    'HIGH_RPM': '请求频率过高',
    'MANY_IPS': '多IP访问',
    'HIGH_FAILURE_RATE': '失败率过高',
    'HIGH_EMPTY_RATE': '空回复率过高',
    'IP_RAPID_SWITCH': 'IP快速切换',
    'IP_HOPPING': 'IP跳动异常',
    'CHECKIN_ANOMALY': '签到刷额度异常',
}

export const BAN_REASONS = [
    { value: '', label: '请选择封禁原因' },
    { value: '请求频率过高 (HIGH_RPM)', label: '请求频率过高 (HIGH_RPM)' },
    { value: '多 IP 访问异常 (MANY_IPS)', label: '多 IP 访问异常 (MANY_IPS)' },
    { value: '失败率过高 (HIGH_FAILURE_RATE)', label: '失败率过高 (HIGH_FAILURE_RATE)' },
    { value: '空回复率过高 (HIGH_EMPTY_RATE)', label: '空回复率过高 (HIGH_EMPTY_RATE)' },
    { value: 'IP快速切换 (IP_RAPID_SWITCH)', label: 'IP快速切换 (IP_RAPID_SWITCH)' },
    { value: 'IP跳动异常 (IP_HOPPING)', label: 'IP跳动异常 (IP_HOPPING)' },
    { value: '签到刷额度异常 (CHECKIN_ANOMALY)', label: '签到刷额度异常 (CHECKIN_ANOMALY)' },
    { value: '账号共享嫌疑', label: '账号共享嫌疑' },
    { value: '令牌泄露风险', label: '令牌泄露风险' },
    { value: '滥用 API 资源', label: '滥用 API 资源' },
    { value: '违反使用条款', label: '违反使用条款' },
]

export const UNBAN_REASONS = [
    { value: '', label: '请选择解封原因' },
    { value: '误封解除', label: '误封解除' },
    { value: '用户申诉通过', label: '用户申诉通过' },
    { value: '风险已排除', label: '风险已排除' },
    { value: '账号核实完成', label: '账号核实完成' },
    { value: '临时解封观察', label: '临时解封观察' },
]

const WINDOW_LABELS: Record<string, string> = {
    '1h': '1小时', '3h': '3小时', '6h': '6小时', '12h': '12小时',
    '24h': '24小时', '3d': '3天', '7d': '7天',
}

// ── 工具函数 ──────────────────────────────────────────

function formatAnalysisNumber(n: number) {
    return n?.toLocaleString('zh-CN') ?? '0'
}

function formatTime(ts: number): string {
    if (!ts) return '-'
    const d = new Date(ts * 1000)
    return d.toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
}

// ── Props ─────────────────────────────────────────────

export interface UserAnalysisDialogProps {
    /** 弹窗开关 */
    open: boolean
    onOpenChange: (open: boolean) => void
    /** 用户基本信息 */
    userId: number
    username: string
    /** 来源标识用于 ban context */
    source: 'ip_lookup' | 'user_management' | 'risk_center'
    /** 额外 context 信息，会合并到 ban/unban 请求的 context 中 */
    contextData?: Record<string, unknown>
    /** 是否显示最近轨迹表格（默认 true） */
    showRecentLogs?: boolean
    /** 是否显示 IP 切换分析（默认 true） */
    showIPSwitchAnalysis?: boolean
    /** Header 区域额外内容 */
    headerExtra?: ReactNode
    /** 封禁/解封后回调 */
    onBanned?: () => void
    onUnbanned?: () => void
    /** 白名单变更后回调 */
    onWhitelistChanged?: () => void
    /** body 区域底部额外内容（例如 UserManagement 的邀请用户） */
    renderExtra?: (analysis: UserAnalysis) => ReactNode
    /** 查询截止时间戳（秒），用于查看某一时间点前的分析数据 */
    endTime?: number
    /** 初始时间窗口，默认 '24h' */
    initialWindow?: string
    /** 隐藏时间窗口选择器 */
    hideWindowSelector?: boolean
}

export function UserAnalysisDialog({
    open, onOpenChange,
    userId, username,
    source, contextData,
    showRecentLogs = true,
    showIPSwitchAnalysis = true,
    headerExtra,
    onBanned, onUnbanned, onWhitelistChanged,
    renderExtra,
    endTime,
    initialWindow,
    hideWindowSelector,
}: UserAnalysisDialogProps) {
    const { token } = useAuth()
    const { showToast } = useToast()

    const apiUrl = import.meta.env.VITE_API_URL || ''
    const getAuthHeaders = useCallback(() => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    }), [token])

    // ── State ──
    const [analysisWindow, setAnalysisWindow] = useState<string>(initialWindow || '24h')
    const [analysis, setAnalysis] = useState<UserAnalysis | null>(null)
    const [analysisLoading, setAnalysisLoading] = useState(false)
    const [linuxDoLookupLoading, setLinuxDoLookupLoading] = useState<string | null>(null)
    const [mutating, setMutating] = useState(false)
    const [banConfirmDialog, setBanConfirmDialog] = useState<{
        open: boolean
        type: 'ban' | 'unban'
        userId: number
        username: string
        displayName?: string
        reason: string
        disableTokens: boolean
        enableTokens: boolean
    }>({ open: false, type: 'ban', userId: 0, username: '', reason: '', disableTokens: true, enableTokens: false })

    // ── 获取分析数据 ──
    const fetchUserAnalysis = useCallback(async () => {
        if (!userId || !open) return
        setAnalysisLoading(true)
        try {
            const endTimeParam = endTime ? `&end_time=${endTime}` : ''
            const response = await fetch(
                `${apiUrl}/api/risk/users/${userId}/analysis?window=${analysisWindow}${endTimeParam}`,
                { headers: getAuthHeaders() }
            )
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
    }, [apiUrl, getAuthHeaders, userId, analysisWindow, open, showToast, endTime])

    // Reset window when dialog opens with a new initialWindow
    useEffect(() => {
        if (open && initialWindow) {
            setAnalysisWindow(initialWindow)
        }
    }, [open, userId, initialWindow])

    useEffect(() => {
        if (open && userId) {
            setAnalysis(null)
            fetchUserAnalysis()
        }
    }, [open, userId, analysisWindow, fetchUserAnalysis])

    // ── 白名单操作 ──
    const addToWhitelist = async (uid: number) => {
        try {
            const response = await fetch(`${apiUrl}/api/ai-ban/whitelist/add`, {
                method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ user_id: uid }),
            })
            const res = await response.json()
            if (res.success) {
                showToast('success', '已添加到白名单')
                setAnalysis(prev => prev && prev.user.id === uid ? { ...prev, user: { ...prev.user, in_whitelist: true } } : prev)
                onWhitelistChanged?.()
            } else {
                showToast('error', res.message || '添加失败')
            }
        } catch (e) {
            console.error('Failed to add to whitelist:', e)
            showToast('error', '添加失败')
        }
    }

    const removeFromWhitelist = async (uid: number) => {
        try {
            const response = await fetch(`${apiUrl}/api/ai-ban/whitelist/remove`, {
                method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ user_id: uid }),
            })
            const res = await response.json()
            if (res.success) {
                showToast('success', '已从白名单移除')
                setAnalysis(prev => prev && prev.user.id === uid ? { ...prev, user: { ...prev.user, in_whitelist: false } } : prev)
                onWhitelistChanged?.()
            } else {
                showToast('error', res.message || '移除失败')
            }
        } catch (e) {
            console.error('Failed to remove from whitelist:', e)
            showToast('error', '移除失败')
        }
    }

    // ── Linux.do 查询 ──
    const handleLinuxDoLookup = async (lid: string) => {
        if (!lid || linuxDoLookupLoading) return
        setLinuxDoLookupLoading(lid)
        try {
            const res = await fetch(`${apiUrl}/api/linuxdo/lookup/${encodeURIComponent(lid)}`, { headers: getAuthHeaders() })
            const data = await res.json()
            if (data.success && data.data?.profile_url) {
                globalThis.open(data.data.profile_url, '_blank')
            } else if (data.error_type === 'rate_limit') {
                showToast('error', data.message || `请求被限速，请等待 ${data.wait_seconds || '?'} 秒后重试`)
            } else if (data.fallback_url) {
                globalThis.open(data.fallback_url, '_blank')
                showToast('info', '服务器查询失败，已在新标签页打开 Linux.do 证书页面')
            } else {
                showToast('error', data.message || '查询 Linux.do 用户名失败')
            }
        } catch {
            showToast('error', '查询 Linux.do 用户名失败')
        }
        finally { setLinuxDoLookupLoading(null) }
    }

    // ── 封禁/解封 API ──
    const handleBanConfirm = async () => {
        setMutating(true)
        const isBan = banConfirmDialog.type === 'ban'
        const endpoint = isBan ? 'ban' : 'unban'
        try {
            const response = await fetch(`${apiUrl}/api/users/${banConfirmDialog.userId}/${endpoint}`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    reason: banConfirmDialog.reason || null,
                    ...(isBan
                        ? { disable_tokens: banConfirmDialog.disableTokens }
                        : { enable_tokens: banConfirmDialog.enableTokens }),
                    context: { source, ...contextData },
                }),
            })
            const res = await response.json()
            if (res.success) {
                showToast('success', res.message || (isBan ? '已封禁' : '已解封'))
                setBanConfirmDialog(prev => ({ ...prev, open: false }))
                onOpenChange(false)
                if (isBan) onBanned?.()
                else onUnbanned?.()
            } else {
                showToast('error', res.message || (isBan ? '封禁失败' : '解封失败'))
            }
        } catch (e) {
            console.error(`Failed to ${endpoint} user:`, e)
            showToast('error', isBan ? '封禁失败' : '解封失败')
        } finally {
            setMutating(false)
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-2xl w-full max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden rounded-xl border-border/50 shadow-2xl">
                    {/* ── Header ── */}
                    <DialogHeader className="p-5 border-b bg-muted/10 flex-shrink-0">
                        <div className="flex justify-between items-start pr-6">
                            <div>
                                <DialogTitle className="text-xl flex items-center gap-2">
                                    <Eye className="h-5 w-5 text-primary" />
                                    用户行为分析
                                </DialogTitle>
                                <DialogDescription className="mt-1.5 flex items-center gap-2 flex-wrap">
                                    <span>用户: <span className="font-mono text-foreground font-medium">{username}</span></span>
                                    <span className="text-muted-foreground">ID: {userId}</span>
                                    {headerExtra}
                                    {analysis?.user?.linux_do_id && (
                                        <button
                                            onClick={() => handleLinuxDoLookup(analysis.user.linux_do_id!)}
                                            disabled={linuxDoLookupLoading === analysis.user.linux_do_id}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 hover:border-orange-300 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800 dark:hover:bg-orange-900/30 transition-colors disabled:opacity-50 cursor-pointer"
                                            title="点击查看 Linux.do 用户主页"
                                        >
                                            <img src="https://linux.do/uploads/default/optimized/3X/9/d/9dd49731091ce8656e94433a26a3ef36062b3994_2_32x32.png" alt="L" className="w-3.5 h-3.5 rounded-sm" />
                                            {linuxDoLookupLoading === analysis.user.linux_do_id ? 'Linux.do: 查询中...' : `Linux.do: ${analysis.user.linux_do_id}`}
                                            <ExternalLink className="w-3 h-3" />
                                        </button>
                                    )}
                                </DialogDescription>
                            </div>
                            {!hideWindowSelector && (
                                <Select
                                    value={analysisWindow}
                                    onChange={(e) => setAnalysisWindow(e.target.value)}
                                    className="w-28 h-8 text-sm"
                                >
                                    {Object.entries(WINDOW_LABELS).map(([key, label]) => (
                                        <option key={key} value={key}>{label}</option>
                                    ))}
                                </Select>
                            )}
                        </div>
                    </DialogHeader>

                    {/* ── Body ── */}
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
                                            analysis.top_ips.slice(0, 5).map((ipItem) => {
                                                const pct = analysis.summary.total_requests ? (ipItem.requests / analysis.summary.total_requests) * 100 : 0
                                                return (
                                                    <div key={ipItem.ip} className="space-y-1.5">
                                                        <div className="flex justify-between text-xs">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="font-medium font-mono truncate">{ipItem.ip}</span>
                                                                {isCloudflareIp(ipItem.ip) && (
                                                                    <span className="bg-orange-100 text-orange-700 border border-orange-200 px-1 py-0 text-[9px] font-bold rounded shrink-0">CF</span>
                                                                )}
                                                            </div>
                                                            <span className="text-muted-foreground tabular-nums">{formatAnalysisNumber(ipItem.requests)} ({pct.toFixed(0)}%)</span>
                                                        </div>
                                                        <Progress value={pct} className="h-1.5" />
                                                    </div>
                                                )
                                            })
                                        ) : <div className="text-xs text-muted-foreground italic">无数据</div>}
                                    </div>
                                </div>

                                {/* IP 切换分析 */}
                                {showIPSwitchAnalysis && analysis.risk.ip_switch_analysis && analysis.risk.ip_switch_analysis.switch_count > 0 && (
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
                                                                    {formatTime(detail.time)}
                                                                </div>
                                                                <div className="flex-1 px-2 flex justify-center items-center gap-1">
                                                                    <code className="px-1.5 py-0.5 rounded bg-muted/50 border border-border/80 font-mono text-xs text-foreground inline-block whitespace-nowrap">
                                                                        {detail.from_ip}
                                                                    </code>
                                                                    {isCloudflareIp(detail.from_ip) && (
                                                                        <span className="bg-orange-100 text-orange-700 border border-orange-200 px-1 py-0 text-[9px] font-bold rounded">CF</span>
                                                                    )}
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
                                                                    {isCloudflareIp(detail.to_ip) && (
                                                                        <span className="bg-orange-100 text-orange-700 border border-orange-200 px-1 py-0 text-[9px] font-bold rounded">CF</span>
                                                                    )}
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

                                {/* 签到行为分析 */}
                                {analysis.risk.checkin_analysis && analysis.risk.checkin_analysis.checkin_count > 0 && (
                                    <div className="space-y-3">
                                        <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                                            签到行为分析
                                            {analysis.risk.risk_flags.includes('CHECKIN_ANOMALY') && (
                                                <Badge variant="destructive" className="text-xs px-1.5 py-0">异常</Badge>
                                            )}
                                        </h4>
                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="rounded-lg border bg-muted/30 p-2.5 text-center">
                                                <div className="text-lg font-bold">{analysis.risk.checkin_analysis.checkin_count}</div>
                                                <div className="text-xs text-muted-foreground">签到次数</div>
                                            </div>
                                            <div className="rounded-lg border bg-muted/30 p-2.5 text-center">
                                                <div className="text-lg font-bold">${(analysis.risk.checkin_analysis.total_quota_awarded / 500000).toFixed(2)}</div>
                                                <div className="text-xs text-muted-foreground">签到获得额度</div>
                                            </div>
                                            <div className={cn(
                                                "rounded-lg border p-2.5 text-center",
                                                analysis.risk.risk_flags.includes('CHECKIN_ANOMALY')
                                                    ? "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
                                                    : "bg-muted/30"
                                            )}>
                                                <div className={cn(
                                                    "text-lg font-bold",
                                                    analysis.risk.risk_flags.includes('CHECKIN_ANOMALY') && "text-red-600 dark:text-red-400"
                                                )}>
                                                    {analysis.risk.checkin_analysis.requests_per_checkin.toFixed(1)}
                                                </div>
                                                <div className="text-xs text-muted-foreground">次请求/签到</div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Recent Logs */}
                                {showRecentLogs && analysis.recent_logs && analysis.recent_logs.length > 0 && (
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
                                                            <TableCell className="py-1.5 text-xs text-muted-foreground whitespace-nowrap tabular-nums">{formatTime(l.created_at)}</TableCell>
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
                                )}

                                {/* Extra content (e.g. invited users in UserManagement) */}
                                {renderExtra?.(analysis)}
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-muted-foreground">
                                暂无分析数据
                            </div>
                        )}
                    </div>

                    {/* ── Footer: Status + Actions ── */}
                    <div className="p-5 border-t bg-muted/10 flex-shrink-0">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm">
                                <span>当前状态:</span>
                                {analysis ? (
                                    analysis.user.status === 2 ? (
                                        <Badge variant="destructive">已禁用</Badge>
                                    ) : (
                                        <Badge variant="success">正常</Badge>
                                    )
                                ) : (
                                    <span className="text-muted-foreground">-</span>
                                )}
                            </div>
                            <div className="flex gap-3">
                                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutating}>取消</Button>
                                {analysis?.user.in_whitelist ? (
                                    <Button
                                        variant="outline"
                                        onClick={() => { if (!analysis) return; removeFromWhitelist(analysis.user.id) }}
                                        disabled={mutating || analysisLoading}
                                        className="bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200"
                                    >
                                        <ShieldX className="h-4 w-4 mr-2" />
                                        移除白名单
                                    </Button>
                                ) : (
                                    <Button
                                        variant="outline"
                                        onClick={() => { if (!analysis) return; addToWhitelist(analysis.user.id) }}
                                        disabled={mutating || analysisLoading}
                                        className="bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200"
                                    >
                                        <ShieldCheck className="h-4 w-4 mr-2" />
                                        加入白名单
                                    </Button>
                                )}
                                {analysis?.user.status === 2 ? (
                                    <Button
                                        onClick={() => {
                                            if (!analysis) return
                                            setBanConfirmDialog({
                                                open: true, type: 'unban', userId: analysis.user.id,
                                                username: analysis.user.username, displayName: analysis.user.display_name || undefined,
                                                reason: '', disableTokens: false, enableTokens: true,
                                            })
                                        }}
                                        disabled={mutating || analysisLoading}
                                        className="min-w-28 bg-green-600 hover:bg-green-700"
                                    >
                                        <ShieldCheck className="h-4 w-4 mr-2" />
                                        解除封禁
                                    </Button>
                                ) : (
                                    <Button
                                        variant="destructive"
                                        onClick={() => {
                                            if (!analysis) return
                                            setBanConfirmDialog({
                                                open: true, type: 'ban', userId: analysis.user.id,
                                                username: analysis.user.username, displayName: analysis.user.display_name || undefined,
                                                reason: '', disableTokens: true, enableTokens: false,
                                            })
                                        }}
                                        disabled={mutating || analysisLoading}
                                        className="min-w-28"
                                    >
                                        <ShieldBan className="h-4 w-4 mr-2" />
                                        立即封禁
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ── Ban Confirm Dialog ── */}
            <Dialog open={banConfirmDialog.open} onOpenChange={(o) => setBanConfirmDialog(prev => ({ ...prev, open: o }))}>
                <DialogContent className="max-w-[600px] w-full rounded-xl gap-6 p-6 overflow-visible">
                    <DialogHeader className="space-y-2">
                        <DialogTitle className="flex items-center gap-2 text-lg">
                            {banConfirmDialog.type === 'ban' ? (
                                <><ShieldBan className="h-5 w-5 text-destructive" />确认封禁用户</>
                            ) : (
                                <><ShieldCheck className="h-5 w-5 text-green-600" />确认解封用户</>
                            )}
                        </DialogTitle>
                        <DialogDescription className="text-sm">
                            {banConfirmDialog.type === 'ban'
                                ? <span className="block break-words">即将封禁用户 <span className="font-medium text-foreground">{banConfirmDialog.displayName || banConfirmDialog.username}</span>{banConfirmDialog.displayName && banConfirmDialog.displayName !== banConfirmDialog.username && <span className="text-muted-foreground"> (@{banConfirmDialog.username})</span>}</span>
                                : <span className="block break-words">即将解封用户 <span className="font-medium text-foreground">{banConfirmDialog.displayName || banConfirmDialog.username}</span>{banConfirmDialog.displayName && banConfirmDialog.displayName !== banConfirmDialog.username && <span className="text-muted-foreground"> (@{banConfirmDialog.username})</span>}</span>}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">
                                {banConfirmDialog.type === 'ban' ? '请选择封禁原因' : '请选择解封原因'}
                            </label>
                            <Select
                                value={banConfirmDialog.reason}
                                onChange={(e) => setBanConfirmDialog(prev => ({ ...prev, reason: e.target.value }))}
                                className="w-full"
                            >
                                {(banConfirmDialog.type === 'ban' ? BAN_REASONS : UNBAN_REASONS).map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </Select>
                        </div>

                        <label className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none bg-muted/30 p-2 rounded-md border border-transparent hover:border-border">
                            <input
                                type="checkbox"
                                checked={banConfirmDialog.type === 'ban' ? banConfirmDialog.disableTokens : banConfirmDialog.enableTokens}
                                onChange={(e) => banConfirmDialog.type === 'ban'
                                    ? setBanConfirmDialog(prev => ({ ...prev, disableTokens: e.target.checked }))
                                    : setBanConfirmDialog(prev => ({ ...prev, enableTokens: e.target.checked }))
                                }
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                            />
                            {banConfirmDialog.type === 'ban' ? '同时禁用该用户所有令牌' : '同时启用该用户所有令牌'}
                        </label>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0 mt-2">
                        <Button
                            variant="ghost"
                            onClick={() => setBanConfirmDialog(prev => ({ ...prev, open: false }))}
                            disabled={mutating}
                            className="flex-1 sm:flex-none"
                        >
                            取消
                        </Button>
                        {banConfirmDialog.type === 'ban' ? (
                            <Button
                                variant="destructive"
                                disabled={mutating}
                                className="flex-1 sm:flex-none min-w-[100px]"
                                onClick={handleBanConfirm}
                            >
                                {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldBan className="h-4 w-4 mr-2" />}
                                确认封禁
                            </Button>
                        ) : (
                            <Button
                                className="bg-green-600 hover:bg-green-700 flex-1 sm:flex-none min-w-[100px]"
                                disabled={mutating}
                                onClick={handleBanConfirm}
                            >
                                {mutating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                                确认解封
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}

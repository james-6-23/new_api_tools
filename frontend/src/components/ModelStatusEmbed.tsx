import { useState, useEffect, useCallback } from 'react'
import { cn } from '../lib/utils'
import { Loader2, Timer, Activity, Server, AlertTriangle, ShieldCheck, XCircle } from 'lucide-react'

interface SlotStatus {
  slot: number
  start_time: number
  end_time: number
  total_requests: number
  success_count: number
  success_rate: number
  status: 'green' | 'yellow' | 'red'
}

interface ModelStatus {
  model_name: string
  display_name: string
  time_window: string
  total_requests: number
  success_count: number
  success_rate: number
  current_status: 'green' | 'yellow' | 'red'
  slot_data: SlotStatus[]
}

const STATUS_COLORS = {
  green: 'bg-emerald-500 hover:bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]',
  yellow: 'bg-amber-500 hover:bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]',
  red: 'bg-rose-500 hover:bg-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.3)]',
}

const STATUS_ICONS = {
  green: ShieldCheck,
  yellow: AlertTriangle,
  red: XCircle,
}

const STATUS_LABELS = {
  green: '正常运转',
  yellow: '性能波动',
  red: '服务异常',
}

const STATUS_STYLES = {
  green: {
    badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    text: 'text-emerald-400',
    icon: 'text-emerald-500'
  },
  yellow: {
    badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    text: 'text-amber-400',
    icon: 'text-amber-500'
  },
  red: {
    badge: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    text: 'text-rose-400',
    icon: 'text-rose-500'
  }
}



function formatDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`
}

// Time window options
const TIME_WINDOWS = [
  { value: '1h', label: '1小时', slots: 60 },
  { value: '6h', label: '6小时', slots: 24 },
  { value: '12h', label: '12小时', slots: 24 },
  { value: '24h', label: '24小时', slots: 24 },
]

interface ModelStatusEmbedProps {
  refreshInterval?: number  // in seconds, default 60
}

export function ModelStatusEmbed({
  refreshInterval = 60,
}: ModelStatusEmbedProps) {
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [modelStatuses, setModelStatuses] = useState<ModelStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [countdown, setCountdown] = useState(refreshInterval)
  const [timeWindow, setTimeWindow] = useState('24h')

  const apiUrl = import.meta.env.VITE_API_URL || ''

  // Load config from backend
  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/model-status/embed/config/selected`)
      const data = await response.json()
      if (data.success) {
        if (data.data.length > 0) {
          setSelectedModels(data.data)
        }
        if (data.time_window) {
          setTimeWindow(data.time_window)
        }
        return data.data || []
      }
    } catch (error) {
      console.error('Failed to load config from backend:', error)
    }
    return []
  }, [apiUrl])

  // Initial load
  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // Fetch model statuses
  const fetchModelStatuses = useCallback(async () => {
    if (selectedModels.length === 0) {
      setModelStatuses([])
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`${apiUrl}/api/model-status/embed/status/batch?window=${timeWindow}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedModels),
      })
      const data = await response.json()
      if (data.success) {
        setModelStatuses(data.data)
        setLastUpdate(new Date())
      }
    } catch (error) {
      console.error('Failed to fetch model statuses:', error)
    } finally {
      setLoading(false)
    }
  }, [apiUrl, selectedModels, timeWindow])

  // Fetch on selection change
  useEffect(() => {
    if (selectedModels.length > 0) {
      fetchModelStatuses()
    }
  }, [fetchModelStatuses, selectedModels])

  // Auto refresh
  useEffect(() => {
    if (refreshInterval <= 0) return

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          fetchModelStatuses()
          return refreshInterval
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [refreshInterval, fetchModelStatuses])

  if (loading && modelStatuses.length === 0) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-zinc-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 p-6 font-sans selection:bg-indigo-500/30">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/10 via-[#09090b] to-[#09090b] pointer-events-none" />

      <div className="relative max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-indigo-400 ring-1 ring-white/5">
                <Activity className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-zinc-200 to-zinc-400">
                模型状态监控
              </h1>
            </div>
            <div className="flex items-center gap-3 text-sm text-zinc-500">
              <span className="px-2 py-0.5 rounded-full bg-zinc-800/50 border border-zinc-800 text-zinc-400 text-xs font-mono">
                {TIME_WINDOWS.find(w => w.value === timeWindow)?.label || '24小时'}
              </span>
              <span className="w-1 h-1 rounded-full bg-zinc-700" />
              <span>监控 {selectedModels.length} 个模型</span>
              {lastUpdate && (
                <>
                  <span className="w-1 h-1 rounded-full bg-zinc-700" />
                  <span className="text-zinc-500">
                    更新于 {lastUpdate.toLocaleTimeString('zh-CN')}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Countdown */}
          {refreshInterval > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 text-sm bg-zinc-900/40 backdrop-blur-md border border-white/5 rounded-full shadow-lg">
              <Timer className="h-4 w-4 text-zinc-500" />
              <div className="flex items-baseline gap-1.5">
                <span className="text-indigo-400 font-mono font-bold w-6 text-center">
                  {formatCountdown(countdown)}
                </span>
                <span className="text-zinc-600 text-xs">后刷新</span>
              </div>
            </div>
          )}
        </div>

        {/* Model Status Cards */}
        {modelStatuses.length > 0 ? (
          <div className="grid gap-4">
            {modelStatuses.map(model => (
              <EmbedModelCard key={model.model_name} model={model} />
            ))}
          </div>
        ) : (
          <div className="text-center py-32 rounded-2xl border border-dashed border-zinc-800/50 bg-zinc-900/20">
            <Server className="h-12 w-12 text-zinc-800 mx-auto mb-4" />
            <p className="text-zinc-500 font-medium">
              {selectedModels.length === 0 ? '暂无监控模型' : '暂无数据'}
            </p>
          </div>
        )}

        {/* Legend */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-8 py-4 opacity-50 hover:opacity-100 transition-opacity duration-300">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
            <span className="text-xs text-zinc-500">健康 (≥95%)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]" />
            <span className="text-xs text-zinc-500">波动 (80-95%)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]" />
            <span className="text-xs text-zinc-500">异常 (&lt;80%)</span>
          </div>
        </div>
      </div>
    </div>
  )
}

interface EmbedModelCardProps {
  model: ModelStatus
}

function EmbedModelCard({ model }: EmbedModelCardProps) {
  const [hoveredSlot, setHoveredSlot] = useState<SlotStatus | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })

  const handleMouseEnter = (slot: SlotStatus, event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setTooltipPosition({
      x: rect.left + rect.width / 2,
      y: rect.top - 12,
    })
    setHoveredSlot(slot)
  }

  const getTimeLabels = () => {
    switch (model.time_window) {
      case '1h': return ['1小时前', '30分钟前', '现在']
      case '6h': return ['6小时前', '3小时前', '现在']
      case '12h': return ['12小时前', '6小时前', '现在']
      default: return ['24小时前', '12小时前', '现在']
    }
  }

  const timeLabels = getTimeLabels()
  const StatusIcon = STATUS_ICONS[model.current_status]
  const styles = STATUS_STYLES[model.current_status]

  return (
    <div className="group relative overflow-hidden bg-zinc-900/40 backdrop-blur-md border border-zinc-800/50 rounded-xl p-5 hover:border-zinc-700/60 transition-all duration-300 hover:shadow-xl hover:shadow-black/20 hover:bg-zinc-900/60">
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-[2px] transition-all duration-300 opacity-0 group-hover:opacity-100",
        model.current_status === 'green' ? "bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]" :
          model.current_status === 'yellow' ? "bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)]" :
            "bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.5)]"
      )} />

      <div className="flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className={cn(
              "flex items-center justify-center w-10 h-10 rounded-xl shrink-0 transition-colors duration-300 shadow-inner",
              styles.badge
            )}>
              <StatusIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-zinc-200 truncate hover:text-white transition-colors" title={model.model_name}>
                  {model.model_name}
                </h3>
                <span className={cn(
                  "px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold rounded-full border border-current/20",
                  styles.badge
                )}>
                  {STATUS_LABELS[model.current_status]}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono">
                <Activity className="h-3 w-3" />
                ID: {model.display_name}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-8 pl-14 sm:pl-0">
            <div className="flex flex-col items-end">
              <span className={cn(
                "text-2xl font-bold font-mono tabular-nums leading-none",
                styles.text
              )}>
                {model.success_rate}%
              </span>
              <span className="text-[10px] text-zinc-500 font-medium mt-1">成功率</span>
            </div>
            <div className="w-px h-8 bg-zinc-800" />
            <div className="flex flex-col items-end">
              <span className="text-2xl font-bold font-mono text-zinc-300 tabular-nums leading-none">
                {model.total_requests > 1000 ? `${(model.total_requests / 1000).toFixed(1)}k` : model.total_requests}
              </span>
              <span className="text-[10px] text-zinc-500 font-medium mt-1">总请求</span>
            </div>
          </div>
        </div>

        <div className="relative pl-14 sm:pl-0 pt-2">
          <div className="h-12 flex items-end gap-[3px]">
            {model.slot_data.map((slot, index) => (
              <div
                key={index}
                className={cn(
                  "relative flex-1 min-w-[2px] rounded-sm transition-all duration-300 hover:scale-y-110 origin-bottom hover:brightness-125",
                  STATUS_COLORS[slot.status],
                  slot.total_requests === 0
                    ? "h-[2px] bg-zinc-800/50 hover:bg-zinc-700/80 cursor-default"
                    : "opacity-80 hover:opacity-100 cursor-help"
                )}
                style={{
                  height: slot.total_requests === 0 ? '4px' : `${Math.max(15, Math.min(100, (slot.total_requests / (Math.max(...model.slot_data.map(s => s.total_requests)) || 1)) * 100))}%`
                }}
                onMouseEnter={(e) => slot.total_requests > 0 && handleMouseEnter(slot, e)}
                onMouseLeave={() => setHoveredSlot(null)}
              />
            ))}
          </div>

          <div className="flex justify-between mt-3 border-t border-zinc-800/50 pt-2">
            <span className="text-[10px] text-zinc-600 font-mono">{timeLabels[0]}</span>
            <span className="text-[10px] text-zinc-600 font-mono">{timeLabels[1]}</span>
            <span className="text-[10px] text-zinc-600 font-mono">{timeLabels[2]}</span>
          </div>

          {hoveredSlot && (
            <div
              className="fixed z-[9999] pointer-events-none transform transition-all duration-200"
              style={{
                left: tooltipPosition.x,
                top: tooltipPosition.y,
                transform: 'translate(-50%, -100%)',
              }}
            >
              <div className="bg-zinc-900/95 backdrop-blur-xl border border-white/10 p-3 rounded-xl shadow-2xl ring-1 ring-white/5 min-w-[160px]">
                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/5">
                  <div className={cn("w-1.5 h-1.5 rounded-full shadow-[0_0_8px_currentColor]",
                    hoveredSlot.status === 'green' ? "bg-emerald-500 text-emerald-500" :
                      hoveredSlot.status === 'yellow' ? "bg-amber-500 text-amber-500" :
                        "bg-rose-500 text-rose-500"
                  )} />
                  <span className="font-medium text-zinc-300 text-xs font-mono">
                    {formatDateTime(hoveredSlot.start_time)}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-500">请求</span>
                    <span className="font-mono text-zinc-200">{hoveredSlot.total_requests}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-500">成功</span>
                    <span className="font-mono text-emerald-400">{hoveredSlot.success_count}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs pt-1 border-t border-white/5 mt-1">
                    <span className="text-zinc-500">率</span>
                    <span className={cn(
                      "font-mono font-bold",
                      hoveredSlot.status === 'green' ? 'text-emerald-400' :
                        hoveredSlot.status === 'yellow' ? 'text-amber-400' : 'text-rose-400'
                    )}>
                      {hoveredSlot.success_rate}%
                    </span>
                  </div>
                </div>
              </div>
              <div className="w-2 h-2 bg-zinc-900/95 border-r border-b border-white/10 transform rotate-45 absolute left-1/2 -bottom-1 -translate-x-1/2 shadow-lg" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ModelStatusEmbed

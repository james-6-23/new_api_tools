import { useState, useEffect, useCallback } from 'react'
import { cn } from '../lib/utils'
import { Loader2, Timer, Activity, Server, AlertCircle, CheckCircle2 } from 'lucide-react'

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
  green: 'bg-emerald-500 hover:bg-emerald-400',
  yellow: 'bg-amber-500 hover:bg-amber-400',
  red: 'bg-rose-500 hover:bg-rose-400',
}

const STATUS_LABELS = {
  green: '正常',
  yellow: '警告',
  red: '异常',
}

const STATUS_BADGE_STYLES = {
  green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 ring-emerald-500/20',
  yellow: 'bg-amber-500/10 text-amber-400 border-amber-500/20 ring-amber-500/20',
  red: 'bg-rose-500/10 text-rose-400 border-rose-500/20 ring-rose-500/20',
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
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

// 与管理界面共享配置，从后端获取

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

  // 从后端获取管理员配置的模型列表和时间窗口
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

  // Initial load of config
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

  // Fetch statuses when selected models change
  useEffect(() => {
    if (selectedModels.length > 0) {
      fetchModelStatuses()
    }
  }, [fetchModelStatuses, selectedModels])

  // Auto refresh with countdown
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
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 p-4 font-sans selection:bg-zinc-800">
      {/* Background Gradient */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-800/20 via-[#09090b] to-[#09090b] pointer-events-none" />
      
      <div className="relative max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-5 w-5 text-indigo-400" />
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
                模型状态监控
              </h1>
            </div>
            <p className="text-sm text-zinc-500 flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-zinc-800/50 border border-zinc-800 text-zinc-400 text-xs">
                {TIME_WINDOWS.find(w => w.value === timeWindow)?.label || '24小时'}
              </span>
              <span>·</span>
              <span>监控 {selectedModels.length} 个模型</span>
              {lastUpdate && (
                <>
                  <span>·</span>
                  <span className="text-zinc-500">
                    更新于 {lastUpdate.toLocaleTimeString('zh-CN')}
                  </span>
                </>
              )}
            </p>
          </div>

          {/* Countdown */}
          {refreshInterval > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-sm bg-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-full shadow-lg">
              <Timer className="h-3.5 w-3.5 text-zinc-500" />
              <div className="flex items-baseline gap-1">
                <span className="text-indigo-400 font-mono font-medium min-w-[20px] text-center">
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
          <div className="text-center py-20 px-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20">
            <Server className="h-10 w-10 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500">
              {selectedModels.length === 0 ? '请在管理界面选择要监控的模型' : '暂无模型状态数据'}
            </p>
          </div>
        )}

        {/* Legend */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
            <span>成功率 ≥ 95%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]" />
            <span>成功率 80-95%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]" />
            <span>成功率 &lt; 80%</span>
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

  // Get time labels based on time window
  const getTimeLabels = () => {
    switch (model.time_window) {
      case '1h': return ['1小时前', '30分钟前', '现在']
      case '6h': return ['6小时前', '3小时前', '现在']
      case '12h': return ['12小时前', '6小时前', '现在']
      default: return ['24小时前', '12小时前', '现在']
    }
  }

  const timeLabels = getTimeLabels()

  // Status Icon
  const StatusIcon = model.current_status === 'green' ? CheckCircle2 : AlertCircle

  return (
    <div className="group relative bg-zinc-900/40 backdrop-blur-md border border-zinc-800/50 rounded-xl p-5 hover:border-zinc-700/50 transition-all duration-300 hover:shadow-lg hover:shadow-zinc-900/20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            "flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-colors duration-300",
            model.current_status === 'green' ? "bg-emerald-500/10 text-emerald-500" :
            model.current_status === 'yellow' ? "bg-amber-500/10 text-amber-500" :
            "bg-rose-500/10 text-rose-500"
          )}>
            <StatusIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-zinc-200 truncate" title={model.model_name}>
                {model.model_name}
              </h3>
              <span className={cn(
                "px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold rounded-full border shadow-sm backdrop-blur-sm",
                STATUS_BADGE_STYLES[model.current_status]
              )}>
                {STATUS_LABELS[model.current_status]}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4 text-sm text-zinc-500 pl-11 sm:pl-0">
          <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
            <div className="flex items-baseline gap-1.5">
              <span className={cn(
                "text-lg font-bold font-mono",
                model.current_status === 'green' ? "text-emerald-400" :
                model.current_status === 'yellow' ? "text-amber-400" : "text-rose-400"
              )}>
                {model.success_rate}%
              </span>
              <span className="text-xs text-zinc-600">成功率</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold font-mono text-zinc-300">
                {model.total_requests.toLocaleString()}
              </span>
              <span className="text-xs text-zinc-600">请求</span>
            </div>
          </div>
        </div>
      </div>

      {/* Status grid */}
      <div className="relative pl-11 sm:pl-0">
        <div className="flex gap-[2px] h-8 sm:h-6 items-end">
          {model.slot_data.map((slot, index) => (
            <div
              key={index}
              className={cn(
                "flex-1 rounded-[1px] cursor-pointer transition-all duration-200 hover:opacity-100",
                "first:rounded-l-sm last:rounded-r-sm",
                STATUS_COLORS[slot.status],
                slot.total_requests === 0 ? "h-1/3 opacity-30 bg-zinc-700 hover:bg-zinc-600" : "h-full opacity-80"
              )}
              onMouseEnter={(e) => handleMouseEnter(slot, e)}
              onMouseLeave={() => setHoveredSlot(null)}
            />
          ))}
        </div>

        {/* Time labels */}
        <div className="flex justify-between mt-2 text-[10px] text-zinc-600 font-medium uppercase tracking-wider">
          <span>{timeLabels[0]}</span>
          <span>{timeLabels[1]}</span>
          <span>{timeLabels[2]}</span>
        </div>

        {/* Tooltip */}
        {hoveredSlot && (
          <div
            className="fixed z-50 min-w-[200px] bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-xl shadow-2xl p-3 text-sm pointer-events-none transform transition-all duration-200"
            style={{
              left: tooltipPosition.x,
              top: tooltipPosition.y,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="flex items-center gap-2 mb-2 pb-2 border-b border-zinc-800/50">
              <div className={cn("w-1.5 h-1.5 rounded-full", 
                hoveredSlot.status === 'green' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" :
                hoveredSlot.status === 'yellow' ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" :
                "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"
              )} />
              <span className="font-medium text-zinc-200 text-xs">
                {formatDateTime(hoveredSlot.start_time)} - {formatTime(hoveredSlot.end_time)}
              </span>
            </div>
            
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-500">总请求</span>
                <span className="font-mono text-zinc-300">{hoveredSlot.total_requests}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-500">成功数</span>
                <span className="font-mono text-emerald-400">{hoveredSlot.success_count}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-500">成功率</span>
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
        )}
      </div>
    </div>
  )
}

export default ModelStatusEmbed

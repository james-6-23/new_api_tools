import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { cn } from '../lib/utils'
import { RefreshCw, Loader2, Timer, ChevronDown, Settings2, Check, Clock, Activity, AlertTriangle, ShieldCheck, XCircle } from 'lucide-react'
import { Card, CardContent } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'

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

interface ModelStatusMonitorProps {
  isEmbed?: boolean
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

// Time window options
const TIME_WINDOWS = [
  { value: '1h', label: '1小时', slots: 60 },
  { value: '6h', label: '6小时', slots: 24 },
  { value: '12h', label: '12小时', slots: 24 },
  { value: '24h', label: '24小时', slots: 24 },
]

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}



function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`
}

const REFRESH_INTERVALS = [
  { value: 0, label: '关闭' },
  { value: 30, label: '30秒' },
  { value: 60, label: '1分钟' },
  { value: 120, label: '2分钟' },
  { value: 300, label: '5分钟' },
]

// Storage keys
const SELECTED_MODELS_KEY = 'model_status_selected_models'
const REFRESH_INTERVAL_KEY = 'model_status_refresh_interval'
const TIME_WINDOW_KEY = 'model_status_time_window'

export function ModelStatusMonitor({ isEmbed = false }: ModelStatusMonitorProps) {
  const { token } = useAuth()
  const { showToast } = useToast()

  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [modelStatuses, setModelStatuses] = useState<ModelStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [timeWindow, setTimeWindow] = useState(() => {
    const saved = localStorage.getItem(TIME_WINDOW_KEY)
    return saved || '24h'
  })

  const [refreshInterval, setRefreshInterval] = useState(() => {
    const saved = localStorage.getItem(REFRESH_INTERVAL_KEY)
    return saved ? parseInt(saved, 10) : 60
  })
  const [countdown, setCountdown] = useState(refreshInterval)
  const refreshIntervalRef = useRef(refreshInterval)

  const [showModelSelector, setShowModelSelector] = useState(false)
  const [showIntervalDropdown, setShowIntervalDropdown] = useState(false)
  const [showWindowDropdown, setShowWindowDropdown] = useState(false)
  const modelSelectorRef = useRef<HTMLDivElement>(null)
  const intervalDropdownRef = useRef<HTMLDivElement>(null)
  const windowDropdownRef = useRef<HTMLDivElement>(null)

  const apiUrl = import.meta.env.VITE_API_URL || ''

  const getAuthHeaders = useCallback((): Record<string, string> => {
    if (isEmbed) {
      return { 'Content-Type': 'application/json' }
    }
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    }
  }, [token, isEmbed])

  const getApiPrefix = useCallback(() => {
    return isEmbed ? '/api/model-status/embed' : '/api/model-status'
  }, [isEmbed])

  // Click outside handlers
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(event.target as Node)) {
        setShowModelSelector(false)
      }
      if (intervalDropdownRef.current && !intervalDropdownRef.current.contains(event.target as Node)) {
        setShowIntervalDropdown(false)
      }
      if (windowDropdownRef.current && !windowDropdownRef.current.contains(event.target as Node)) {
        setShowWindowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Save time window to backend cache
  const saveTimeWindowToBackend = useCallback(async (window: string) => {
    try {
      await fetch(`${apiUrl}/api/model-status/config/window`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ time_window: window }),
      })
      localStorage.setItem(TIME_WINDOW_KEY, window)
    } catch (error) {
      console.error('Failed to save time window:', error)
    }
  }, [apiUrl, getAuthHeaders])

  // Save selected models to backend cache
  const saveSelectedModelsToBackend = useCallback(async (models: string[]) => {
    try {
      await fetch(`${apiUrl}/api/model-status/config/selected`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ models }),
      })
      localStorage.setItem(SELECTED_MODELS_KEY, JSON.stringify(models))
      // Refresh statuses immediately after selection change
    } catch (error) {
      console.error('Failed to save selected models:', error)
    }
  }, [apiUrl, getAuthHeaders])

  // Load config from backend on mount
  const loadConfigFromBackend = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/model-status/config/selected`, {
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        if (data.data.length > 0) {
          setSelectedModels(data.data)
          localStorage.setItem(SELECTED_MODELS_KEY, JSON.stringify(data.data))
        }
        if (data.time_window) {
          setTimeWindow(data.time_window)
          localStorage.setItem(TIME_WINDOW_KEY, data.time_window)
        }
        return data.data || []
      }
    } catch (error) {
      console.error('Failed to load config from backend:', error)
    }
    // Fallback to localStorage
    const saved = localStorage.getItem(SELECTED_MODELS_KEY)
    if (saved) {
      const models = JSON.parse(saved)
      setSelectedModels(models)
      return models
    }
    return []
  }, [apiUrl, getAuthHeaders])

  // Update refresh interval ref
  useEffect(() => {
    refreshIntervalRef.current = refreshInterval
    localStorage.setItem(REFRESH_INTERVAL_KEY, refreshInterval.toString())
  }, [refreshInterval])

  // Fetch available models and load config
  const fetchAvailableModels = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}${getApiPrefix()}/models`, {
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        setAvailableModels(data.data)
        // Load config from backend
        const savedModels = await loadConfigFromBackend()
        // Auto-select first 5 models if none selected
        if (savedModels.length === 0 && data.data.length > 0) {
          const defaultModels = data.data.slice(0, 5)
          setSelectedModels(defaultModels)
          saveSelectedModelsToBackend(defaultModels)
        }
      }
    } catch (error) {
      console.error('Failed to fetch available models:', error)
    }
  }, [apiUrl, getApiPrefix, getAuthHeaders, loadConfigFromBackend, saveSelectedModelsToBackend])

  // Fetch model statuses
  const fetchModelStatuses = useCallback(async (showLoadingToast = false) => {
    if (selectedModels.length === 0) {
      setModelStatuses([])
      setLoading(false)
      return
    }

    if (showLoadingToast) {
      setRefreshing(true)
    }

    try {
      const response = await fetch(`${apiUrl}${getApiPrefix()}/status/batch?window=${timeWindow}`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(selectedModels),
      })
      const data = await response.json()
      if (data.success) {
        setModelStatuses(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch model statuses:', error)
      if (!isEmbed) {
        showToast('error', '获取模型状态失败')
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [apiUrl, getApiPrefix, getAuthHeaders, selectedModels, timeWindow, isEmbed, showToast])

  // Initial load
  useEffect(() => {
    fetchAvailableModels()
  }, [fetchAvailableModels])

  // Fetch statuses when selected models or time window change
  useEffect(() => {
    fetchModelStatuses()
  }, [fetchModelStatuses])

  // Auto refresh countdown
  useEffect(() => {
    if (refreshInterval === 0) return

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          fetchModelStatuses()
          return refreshIntervalRef.current
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [refreshInterval, fetchModelStatuses])

  // Reset countdown when interval changes
  useEffect(() => {
    setCountdown(refreshInterval)
  }, [refreshInterval])

  const handleRefresh = () => {
    setCountdown(refreshIntervalRef.current)
    fetchModelStatuses(true)
  }

  const toggleModelSelection = (model: string) => {
    const newModels = selectedModels.includes(model)
      ? selectedModels.filter(m => m !== model)
      : [...selectedModels, model]
    setSelectedModels(newModels)
    saveSelectedModelsToBackend(newModels)
  }

  const selectAllModels = () => {
    setSelectedModels(availableModels)
    saveSelectedModelsToBackend(availableModels)
  }

  const clearAllModels = () => {
    setSelectedModels([])
    saveSelectedModelsToBackend([])
  }

  if (loading && modelStatuses.length === 0) {
    return (
      <div className="flex justify-center items-center py-24">
        <div className="relative">
          <div className="w-16 h-16 rounded-full border-4 border-zinc-700/30 border-t-indigo-500 animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className={cn("space-y-6 animate-in fade-in duration-500", isEmbed && "p-4")}>
      {/* Header Section */}
      <Card className="border-zinc-800/60 bg-zinc-900/60 backdrop-blur-md shadow-2xl">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-indigo-400 shadow-inner ring-1 ring-white/10">
                  <Activity className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-indigo-200 to-indigo-400">
                    模型状态监控
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="border-zinc-700/50 bg-zinc-800/30 text-zinc-400 text-[10px] px-2 h-5">
                      {TIME_WINDOWS.find(w => w.value === timeWindow)?.label || '24小时'}
                    </Badge>
                    <span className="text-xs text-zinc-500">
                      监控 <span className="font-semibold text-zinc-300">{selectedModels.length}</span> 个模型
                    </span>
                  </div>
                </div>
              </div>

              {modelStatuses.length > 0 && (
                <div className="flex items-center gap-4 text-xs text-zinc-500 pl-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]"></div>
                    <span>总请求: <span className="text-zinc-300 font-mono">{modelStatuses.reduce((sum, m) => sum + m.total_requests, 0).toLocaleString()}</span></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                    <span>平均成功率: <span className="text-emerald-400 font-mono">{
                      Math.round(modelStatuses.reduce((sum, m) => sum + m.success_rate, 0) / (modelStatuses.length || 1) * 10) / 10
                    }%</span></span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Controls Group */}
              <div className="flex items-center gap-2 bg-zinc-900/40 p-1.5 rounded-lg border border-zinc-800/50">
                {/* Time Window Selector */}
                <div className="relative" ref={windowDropdownRef}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowWindowDropdown(!showWindowDropdown)}
                    className="h-8 text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/80"
                  >
                    <Clock className="h-3.5 w-3.5 mr-2" />
                    {TIME_WINDOWS.find(w => w.value === timeWindow)?.label}
                    <ChevronDown className="h-3 w-3 ml-1 opacity-50" />
                  </Button>

                  {showWindowDropdown && (
                    <div className="absolute top-full mt-2 w-40 right-0 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-[100] animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
                      <div className="px-3 py-2 bg-zinc-800/30 border-b border-white/5">
                        <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">时间窗口</span>
                      </div>
                      <div className="p-1">
                        {TIME_WINDOWS.map(({ value, label }) => (
                          <button
                            key={value}
                            onClick={() => {
                              setTimeWindow(value)
                              saveTimeWindowToBackend(value)
                              setShowWindowDropdown(false)
                            }}
                            className={cn(
                              "w-full text-left px-3 py-2 text-xs rounded-lg transition-all",
                              timeWindow === value
                                ? "bg-indigo-500/10 text-indigo-400 font-medium"
                                : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="w-px h-4 bg-zinc-800"></div>

                {/* Refresh Interval */}
                <div className="relative" ref={intervalDropdownRef}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowIntervalDropdown(!showIntervalDropdown)}
                    className="h-8 text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/80 min-w-[90px]"
                  >
                    <Timer className="h-3.5 w-3.5 mr-2" />
                    {refreshInterval > 0 && countdown > 0 ? (
                      <span className="text-indigo-400 tabular-nums">{formatCountdown(countdown)}</span>
                    ) : (
                      '自动刷新'
                    )}
                    <ChevronDown className="h-3 w-3 ml-1 opacity-50" />
                  </Button>

                  {showIntervalDropdown && (
                    <div className="absolute top-full mt-2 w-40 right-0 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-[100] animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
                      <div className="px-3 py-2 bg-zinc-800/30 border-b border-white/5">
                        <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">自动刷新</span>
                      </div>
                      <div className="p-1">
                        {REFRESH_INTERVALS.map(({ value, label }) => (
                          <button
                            key={value}
                            onClick={() => {
                              setRefreshInterval(value)
                              setShowIntervalDropdown(false)
                            }}
                            className={cn(
                              "w-full text-left px-3 py-2 text-xs rounded-lg transition-all",
                              refreshInterval === value
                                ? "bg-indigo-500/10 text-indigo-400 font-medium"
                                : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Model Selector & Manual Refresh */}
              <div className="flex items-center gap-2">
                <div className="relative" ref={modelSelectorRef}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowModelSelector(!showModelSelector)}
                    className="h-9 border-zinc-700 bg-zinc-900/50 text-zinc-300 hover:bg-zinc-800 hover:text-white hover:border-zinc-600 transition-all"
                  >
                    <Settings2 className="h-4 w-4 mr-2" />
                    配置
                    <Badge className="ml-2 h-5 min-w-[1.25rem] px-1 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 pointer-events-none">
                      {selectedModels.length}
                    </Badge>
                  </Button>

                  {showModelSelector && (
                    <div className="absolute right-0 mt-2 w-80 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-[100] animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
                      <div className="p-3 border-b border-white/5 bg-zinc-800/30 flex justify-between items-center">
                        <span className="text-xs font-semibold text-zinc-300">选择模型</span>
                        <div className="flex gap-2">
                          <button
                            onClick={selectAllModels}
                            className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
                          >
                            全选
                          </button>
                          <span className="text-zinc-700">|</span>
                          <button
                            onClick={clearAllModels}
                            className="text-[10px] text-zinc-500 hover:text-zinc-400 transition-colors"
                          >
                            清空
                          </button>
                        </div>
                      </div>
                      <div className="p-1 max-h-[400px] overflow-y-auto custom-scrollbar">
                        {availableModels.map(model => (
                          <button
                            key={model}
                            onClick={() => toggleModelSelection(model)}
                            className={cn(
                              "w-full text-left px-3 py-2.5 text-sm rounded-lg transition-all flex items-center justify-between group border border-transparent",
                              selectedModels.includes(model)
                                ? "bg-indigo-500/10 text-indigo-300 border-indigo-500/10"
                                : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                            )}
                          >
                            <span className="truncate mr-4 font-mono text-xs">{model}</span>
                            {selectedModels.includes(model) && (
                              <Check className="h-3.5 w-3.5 text-indigo-400 flex-shrink-0" />
                            )}
                          </button>
                        ))}
                        {availableModels.length === 0 && (
                          <div className="py-8 text-center">
                            <p className="text-xs text-zinc-500">暂无可用模型</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <Button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  size="sm"
                  className={cn(
                    "h-9 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20 transition-all active:scale-95",
                    refreshing && "opacity-80"
                  )}
                >
                  {refreshing ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-1.5" />
                  )}
                  刷新
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Models Grid */}
      {modelStatuses.length > 0 ? (
        <div className="grid gap-4">
          {modelStatuses.map(model => (
            <ModelStatusCard key={model.model_name} model={model} />
          ))}
        </div>
      ) : (
        <Card className="border-dashed border-zinc-800 bg-zinc-900/20">
          <CardContent className="py-32 text-center text-zinc-500">
            {selectedModels.length === 0 ? (
              <div className="space-y-4">
                <Settings2 className="h-12 w-12 mx-auto text-zinc-700" />
                <p>请配置需要监控的模型</p>
                <Button variant="outline" onClick={() => setShowModelSelector(true)}>选择模型</Button>
              </div>
            ) : (
              <div className="space-y-4">
                <Loader2 className="h-12 w-12 mx-auto text-zinc-700 animate-spin" />
                <p>正在获取数据...</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Legend Footer */}
      <div className="flex flex-wrap items-center justify-center gap-8 py-4 opacity-60 hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            <span className="w-1.5 h-3 bg-emerald-500 rounded-l-[1px] opacity-80" />
            <span className="w-1.5 h-3 bg-emerald-500 rounded-r-[1px] opacity-80" />
          </div>
          <span className="text-xs text-zinc-500">健康 (≥95%)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            <span className="w-1.5 h-3 bg-amber-500 rounded-l-[1px] opacity-80" />
            <span className="w-1.5 h-3 bg-amber-500 rounded-r-[1px] opacity-80" />
          </div>
          <span className="text-xs text-zinc-500">波动 (80-95%)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            <span className="w-1.5 h-3 bg-rose-500 rounded-l-[1px] opacity-80" />
            <span className="w-1.5 h-3 bg-rose-500 rounded-r-[1px] opacity-80" />
          </div>
          <span className="text-xs text-zinc-500">异常 (&lt;80%)</span>
        </div>
      </div>
    </div>
  )
}

interface ModelStatusCardProps {
  model: ModelStatus
}

function ModelStatusCard({ model }: ModelStatusCardProps) {
  const [hoveredSlot, setHoveredSlot] = useState<SlotStatus | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })

  const handleMouseEnter = (slot: SlotStatus, event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect()
    // Center horizontally, position above
    setTooltipPosition({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    })
    setHoveredSlot(slot)
  }

  const getTimeLabels = () => {
    switch (model.time_window) {
      case '1h': return ['60分钟前', '30分钟前', '现在']
      case '6h': return ['6小时前', '3小时前', '现在']
      case '12h': return ['12小时前', '6小时前', '现在']
      default: return ['24小时前', '12小时前', '现在']
    }
  }

  const timeLabels = getTimeLabels()
  const StatusIcon = STATUS_ICONS[model.current_status]
  const styles = STATUS_STYLES[model.current_status]

  return (
    <Card className="group relative overflow-hidden border-zinc-800/60 bg-zinc-900/40 backdrop-blur-sm hover:bg-zinc-900/60 transition-all duration-300 hover:shadow-xl hover:border-zinc-700/80 hover:shadow-black/20">
      {/* Decorative gradient glow on left edge */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-[2px] transition-all duration-300",
        model.current_status === 'green' ? "bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]" :
          model.current_status === 'yellow' ? "bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)]" :
            "bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.5)]"
      )} />

      <CardContent className="p-6">
        <div className="flex flex-col gap-6">
          {/* Top Row: Info & Stats */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">

            {/* Left: Identity */}
            <div className="flex items-start gap-4 min-w-0">
              <div className={cn(
                "flex items-center justify-center w-10 h-10 rounded-xl shrink-0 transition-all duration-300 shadow-lg",
                styles.badge
              )}>
                <StatusIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-zinc-100 text-lg tracking-tight truncate hover:text-white transition-colors cursor-default" title={model.model_name}>
                    {model.model_name}
                  </h3>
                  <span className={cn(
                    "px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold rounded-full border shadow-sm backdrop-blur-sm bg-opacity-10",
                    styles.badge
                  )}>
                    {STATUS_LABELS[model.current_status]}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-zinc-500 font-mono">
                  <span className="flex items-center gap-1.5">
                    <Activity className="h-3 w-3" />
                    ID: {model.display_name || 'DEFAULT'}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Big Stats */}
            <div className="flex items-center gap-8 pl-14 sm:pl-0">
              <div className="flex flex-col items-end">
                <span className={cn("text-2xl font-bold font-mono tabular-nums leading-none tracking-tight", styles.text)}>
                  {model.success_rate}%
                </span>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mt-1">成功率</span>
              </div>
              <div className="w-px h-8 bg-zinc-800" />
              <div className="flex flex-col items-end">
                <span className="text-2xl font-bold font-mono text-zinc-300 tabular-nums leading-none tracking-tight">
                  {model.total_requests > 9999 ? `${(model.total_requests / 1000).toFixed(1)}k` : model.total_requests}
                </span>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mt-1">总请求</span>
              </div>
            </div>
          </div>

          {/* Bottom Row: Timeline Visualization */}
          <div className="relative pl-14 sm:pl-0 pt-2">

            {/* Bars */}
            <div className="h-10 sm:h-12 flex items-end gap-[3px] group/chart">
              {model.slot_data.map((slot, index) => (
                <div
                  key={index}
                  className={cn(
                    "relative flex-1 min-w-[2px] rounded-sm transition-all duration-300 ease-out hover:scale-y-110 origin-bottom hover:brightness-125",
                    STATUS_COLORS[slot.status],
                    slot.total_requests === 0
                      ? "h-[2px] bg-zinc-800/50 hover:bg-zinc-700/80 cursor-default"
                      : "opacity-80 hover:opacity-100 cursor-help shadow-sm"
                  )}
                  style={{
                    // Dynamic height with minimum visibility
                    height: slot.total_requests === 0 ? '4px' : `${Math.max(15, Math.min(100, (slot.total_requests / (Math.max(...model.slot_data.map(s => s.total_requests)) || 1)) * 100))}%`
                  }}
                  onMouseEnter={(e) => slot.total_requests > 0 && handleMouseEnter(slot, e)}
                  onMouseLeave={() => setHoveredSlot(null)}
                />
              ))}
            </div>

            {/* Axis Labels */}
            <div className="flex justify-between mt-3 border-t border-zinc-800/50 pt-2">
              <span className="text-[10px] font-medium text-zinc-600 font-mono tracking-wide">{timeLabels[0]}</span>
              <span className="text-[10px] font-medium text-zinc-600 font-mono tracking-wide">{timeLabels[1]}</span>
              <span className="text-[10px] font-medium text-zinc-600 font-mono tracking-wide">{timeLabels[2]}</span>
            </div>

            {/* Floating Tooltip */}
            {hoveredSlot && (
              <div
                className="fixed z-[9999] pointer-events-none transform transition-all duration-200"
                style={{
                  left: tooltipPosition.x,
                  top: tooltipPosition.y,
                  transform: 'translate(-50%, -100%)',
                }}
              >
                <div className="bg-zinc-900/95 backdrop-blur-xl border border-white/10 p-3 rounded-xl shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] ring-1 ring-white/10 min-w-[180px]">
                  {/* Header of Tooltip */}
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/5">
                    <div className={cn("w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]",
                      hoveredSlot.status === 'green' ? "bg-emerald-500 text-emerald-500" :
                        hoveredSlot.status === 'yellow' ? "bg-amber-500 text-amber-500" : "bg-rose-500 text-rose-500"
                    )} />
                    <span className="text-xs font-medium text-zinc-300 font-mono">
                      {formatTime(hoveredSlot.start_time)} - {formatTime(hoveredSlot.end_time)}
                    </span>
                  </div>

                  {/* Stats in Tooltip */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div>
                      <div className="text-zinc-500 mb-0.5">请求数</div>
                      <div className="font-mono text-zinc-200 font-medium">{hoveredSlot.total_requests}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500 mb-0.5">成功数</div>
                      <div className="font-mono text-zinc-200 font-medium">{hoveredSlot.success_count}</div>
                    </div>
                    <div className="col-span-2 mt-1 pt-2 border-t border-white/5">
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-500">成功率</span>
                        <span className={cn(
                          "font-mono font-bold text-sm",
                          hoveredSlot.status === 'green' ? "text-emerald-400" :
                            hoveredSlot.status === 'yellow' ? "text-amber-400" : "text-rose-400"
                        )}>
                          {hoveredSlot.success_rate}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Arrow */}
                <div className="w-3 h-3 bg-zinc-900/95 border-r border-b border-white/10 transform rotate-45 absolute left-1/2 -bottom-1.5 -translate-x-1/2 shadow-lg" />
              </div>
            )}

          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default ModelStatusMonitor

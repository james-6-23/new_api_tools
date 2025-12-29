import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { cn } from '../lib/utils'
import { RefreshCw, Loader2, Timer, ChevronDown, Settings2, Check, Clock, Activity, CheckCircle2, AlertCircle } from 'lucide-react'
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
  green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  yellow: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  red: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
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
      // Also save to localStorage for quick access
      localStorage.setItem(SELECTED_MODELS_KEY, JSON.stringify(models))
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
      <div className="flex justify-center items-center py-20">
        <Loader2 className="h-12 w-12 animate-spin text-zinc-400" />
      </div>
    )
  }

  return (
    <div className={cn("space-y-6", isEmbed && "p-4")}>
      {/* Header */}
      <Card className="border-zinc-800 bg-zinc-900/40 backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
                  <Activity className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
                  模型状态监控
                </h2>
                <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                  {TIME_WINDOWS.find(w => w.value === timeWindow)?.label || '24小时'}
                </Badge>
              </div>
              <p className="text-sm text-zinc-500 mt-1 ml-1">
                监控 <span className="font-medium text-zinc-300">{selectedModels.length}</span> 个模型
                {modelStatuses.length > 0 && (
                  <span className="ml-2">
                    · 总请求: {modelStatuses.reduce((sum, m) => sum + m.total_requests, 0).toLocaleString()}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Time Window Selector */}
              <div className="relative" ref={windowDropdownRef}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowWindowDropdown(!showWindowDropdown)}
                  className="h-9 border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 hover:text-white"
                >
                  <Clock className="h-4 w-4 mr-2 text-zinc-400" />
                  {TIME_WINDOWS.find(w => w.value === timeWindow)?.label || '24小时'}
                  <ChevronDown className="h-3 w-3 ml-1 opacity-50" />
                </Button>

                {showWindowDropdown && (
                  <div className="absolute right-0 mt-1 w-36 bg-zinc-900 border border-zinc-700 rounded-md shadow-xl z-50 animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-2 border-b border-zinc-800">
                      <p className="text-xs text-zinc-500 font-medium">时间窗口</p>
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
                            "w-full text-left px-3 py-2 text-sm rounded hover:bg-zinc-800 transition-colors text-zinc-300",
                            timeWindow === value && "bg-zinc-800 text-white font-medium"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Model Selector */}
              <div className="relative" ref={modelSelectorRef}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowModelSelector(!showModelSelector)}
                  className="h-9 border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 hover:text-white"
                >
                  <Settings2 className="h-4 w-4 mr-2 text-zinc-400" />
                  选择模型
                  <ChevronDown className="h-3 w-3 ml-1 opacity-50" />
                </Button>

                {showModelSelector && (
                  <div className="absolute right-0 mt-1 w-72 bg-zinc-900 border border-zinc-700 rounded-md shadow-xl z-50 max-h-96 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-2 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                      <p className="text-xs text-zinc-500 font-medium">选择要监控的模型</p>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-6 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800" onClick={selectAllModels}>
                          全选
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800" onClick={clearAllModels}>
                          清空
                        </Button>
                      </div>
                    </div>
                    <div className="p-1 max-h-72 overflow-y-auto">
                      {availableModels.map(model => (
                        <button
                          key={model}
                          onClick={() => toggleModelSelection(model)}
                          className={cn(
                            "w-full text-left px-3 py-2 text-sm rounded hover:bg-zinc-800 transition-colors flex items-center justify-between group",
                            selectedModels.includes(model) ? "bg-zinc-800/50 text-white" : "text-zinc-400"
                          )}
                        >
                          <span className="truncate group-hover:text-zinc-200">{model}</span>
                          {selectedModels.includes(model) && (
                            <Check className="h-4 w-4 text-indigo-400 flex-shrink-0" />
                          )}
                        </button>
                      ))}
                      {availableModels.length === 0 && (
                        <p className="text-sm text-zinc-500 text-center py-4">
                          暂无可用模型
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Refresh Interval */}
              <div className="relative" ref={intervalDropdownRef}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowIntervalDropdown(!showIntervalDropdown)}
                  className="h-9 min-w-[100px] border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 hover:text-white"
                >
                  <Timer className="h-4 w-4 mr-2 text-zinc-400" />
                  {refreshInterval > 0 && countdown > 0 ? (
                    <span className="text-indigo-400 font-medium tabular-nums">{formatCountdown(countdown)}</span>
                  ) : (
                    '自动刷新'
                  )}
                  <ChevronDown className="h-3 w-3 ml-1 opacity-50" />
                </Button>

                {showIntervalDropdown && (
                  <div className="absolute right-0 mt-1 w-36 bg-zinc-900 border border-zinc-700 rounded-md shadow-xl z-50 animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-2 border-b border-zinc-800">
                      <p className="text-xs text-zinc-500 font-medium">刷新间隔</p>
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
                            "w-full text-left px-3 py-2 text-sm rounded hover:bg-zinc-800 transition-colors text-zinc-300",
                            refreshInterval === value && "bg-zinc-800 text-white font-medium"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Manual Refresh */}
              <Button 
                onClick={handleRefresh} 
                disabled={refreshing}
                variant="outline"
                className="h-9 border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 hover:text-white"
              >
                {refreshing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin text-zinc-400" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2 text-zinc-400" />
                )}
                刷新
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Model Status Cards */}
      {modelStatuses.length > 0 ? (
        <div className="grid gap-4">
          {modelStatuses.map(model => (
            <ModelStatusCard key={model.model_name} model={model} />
          ))}
        </div>
      ) : (
        <Card className="border-dashed border-zinc-800 bg-zinc-900/20">
          <CardContent className="py-20 text-center text-zinc-500">
            {selectedModels.length === 0 ? (
              <p>请选择要监控的模型</p>
            ) : (
              <p>暂无模型状态数据</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <Card className="border-zinc-800 bg-zinc-900/40 backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-zinc-500">
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
        </CardContent>
      </Card>
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
  const StatusIcon = model.current_status === 'green' ? CheckCircle2 : AlertCircle

  return (
    <Card className="group border-zinc-800 bg-zinc-900/40 backdrop-blur-md hover:border-zinc-700 transition-all duration-300 hover:shadow-lg hover:shadow-zinc-900/20">
      <CardContent className="p-5">
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
      </CardContent>
    </Card>
  )
}

export default ModelStatusMonitor

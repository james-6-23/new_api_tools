import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { cn } from '../lib/utils'
import { RefreshCw, Loader2, Timer, ChevronDown, Settings2, Check, Clock, Palette, Moon, Sun, Minimize2, Zap } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
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
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
}

const STATUS_LABELS = {
  green: '正常',
  yellow: '警告',
  red: '异常',
}

// Time window options
const TIME_WINDOWS = [
  { value: '1h', label: '1小时', slots: 60 },
  { value: '6h', label: '6小时', slots: 24 },
  { value: '12h', label: '12小时', slots: 24 },
  { value: '24h', label: '24小时', slots: 24 },
]

// Theme options
const THEMES = [
  { id: 'daylight', name: '日光', nameEn: 'Daylight', icon: Sun, description: '明亮清新的浅色', preview: 'bg-slate-100' },
  { id: 'obsidian', name: '黑曜石', nameEn: 'Obsidian', icon: Moon, description: '经典深色，专业稳重', preview: 'bg-[#0d1117]' },
  { id: 'minimal', name: '极简', nameEn: 'Minimal', icon: Minimize2, description: '极度精简，适合嵌入', preview: 'bg-white' },
  { id: 'neon', name: '霓虹', nameEn: 'Neon', icon: Zap, description: '赛博朋克，科技感', preview: 'bg-black' },
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
const THEME_KEY = 'model_status_theme'

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

  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY)
    return saved || 'daylight'
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
  const [showThemeDropdown, setShowThemeDropdown] = useState(false)
  const modelSelectorRef = useRef<HTMLDivElement>(null)
  const intervalDropdownRef = useRef<HTMLDivElement>(null)
  const windowDropdownRef = useRef<HTMLDivElement>(null)
  const themeDropdownRef = useRef<HTMLDivElement>(null)

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
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(event.target as Node)) {
        setShowThemeDropdown(false)
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

  // Save theme to backend cache
  const saveThemeToBackend = useCallback(async (newTheme: string) => {
    try {
      await fetch(`${apiUrl}/api/model-status/config/theme`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ theme: newTheme }),
      })
      localStorage.setItem(THEME_KEY, newTheme)
      showToast('success', `主题已切换为 ${THEMES.find(t => t.id === newTheme)?.name || newTheme}`)
    } catch (error) {
      console.error('Failed to save theme:', error)
    }
  }, [apiUrl, getAuthHeaders, showToast])

  // Save refresh interval to backend cache
  const saveRefreshIntervalToBackend = useCallback(async (interval: number) => {
    try {
      await fetch(`${apiUrl}/api/model-status/config/refresh`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ refresh_interval: interval }),
      })
      localStorage.setItem(REFRESH_INTERVAL_KEY, interval.toString())
    } catch (error) {
      console.error('Failed to save refresh interval:', error)
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
        if (data.theme) {
          setTheme(data.theme)
          localStorage.setItem(THEME_KEY, data.theme)
        }
        if (data.refresh_interval !== undefined && data.refresh_interval !== null) {
          setRefreshInterval(data.refresh_interval)
          setCountdown(data.refresh_interval)
          localStorage.setItem(REFRESH_INTERVAL_KEY, data.refresh_interval.toString())
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
  // forceRefresh: bypass cache to get fresh data (used for manual refresh)
  const fetchModelStatuses = useCallback(async (forceRefresh = false) => {
    if (selectedModels.length === 0) {
      setModelStatuses([])
      setLoading(false)
      return
    }

    if (forceRefresh) {
      setRefreshing(true)
    }

    try {
      // Add no_cache=true when force refreshing to bypass backend cache
      const cacheParam = forceRefresh ? '&no_cache=true' : ''
      const response = await fetch(`${apiUrl}${getApiPrefix()}/status/batch?window=${timeWindow}${cacheParam}`, {
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
          // Auto refresh should also get fresh data
          fetchModelStatuses(true)
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
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className={cn("space-y-6", isEmbed && "p-4")}>
      {/* Header */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-medium">模型状态监控</h2>
                <Badge variant="outline">{TIME_WINDOWS.find(w => w.value === timeWindow)?.label || '24小时'}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                监控 <span className="font-medium text-primary">{selectedModels.length}</span> 个模型
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
                  className="h-9"
                >
                  <Clock className="h-4 w-4 mr-2" />
                  {TIME_WINDOWS.find(w => w.value === timeWindow)?.label}
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>

                {showWindowDropdown && (
                  <div className="absolute right-0 mt-1 w-36 bg-popover border rounded-md shadow-lg z-50">
                    <div className="p-2 border-b">
                      <p className="text-xs text-muted-foreground">时间窗口</p>
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
                            "w-full text-left px-3 py-2 text-sm rounded hover:bg-accent transition-colors",
                            timeWindow === value && "bg-accent text-accent-foreground"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Theme Selector */}
              <div className="relative" ref={themeDropdownRef}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowThemeDropdown(!showThemeDropdown)}
                  className="h-9"
                >
                  <Palette className="h-4 w-4 mr-2" />
                  {THEMES.find(t => t.id === theme)?.name || '主题'}
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>

                {showThemeDropdown && (
                  <div className="absolute right-0 mt-1 w-56 bg-popover border rounded-md shadow-lg z-50">
                    <div className="p-2 border-b">
                      <p className="text-xs text-muted-foreground">嵌入页面主题</p>
                    </div>
                    <div className="p-1">
                      {THEMES.map((t) => {
                        const ThemeIcon = t.icon
                        return (
                          <button
                            key={t.id}
                            onClick={() => {
                              setTheme(t.id)
                              saveThemeToBackend(t.id)
                              setShowThemeDropdown(false)
                            }}
                            className={cn(
                              "w-full text-left px-3 py-2 text-sm rounded hover:bg-accent transition-colors flex items-center gap-3",
                              theme === t.id && "bg-accent text-accent-foreground"
                            )}
                          >
                            <div className={cn("w-6 h-6 rounded flex items-center justify-center", t.preview)}>
                              <ThemeIcon className="h-3.5 w-3.5 text-white mix-blend-difference" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium">{t.name}</div>
                              <div className="text-xs text-muted-foreground truncate">{t.description}</div>
                            </div>
                            {theme === t.id && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
                          </button>
                        )
                      })}
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
                  className="h-9"
                >
                  <Settings2 className="h-4 w-4 mr-2" />
                  选择模型
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>

                {showModelSelector && (
                  <div className="absolute right-0 mt-1 w-72 bg-popover border rounded-md shadow-lg z-50 max-h-96 overflow-hidden">
                    <div className="p-2 border-b flex justify-between items-center">
                      <p className="text-xs text-muted-foreground">选择要监控的模型</p>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={selectAllModels}>
                          全选
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearAllModels}>
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
                            "w-full text-left px-3 py-2 text-sm rounded hover:bg-accent transition-colors flex items-center justify-between",
                            selectedModels.includes(model) && "bg-accent"
                          )}
                        >
                          <span className="truncate">{model}</span>
                          {selectedModels.includes(model) && (
                            <Check className="h-4 w-4 text-primary flex-shrink-0" />
                          )}
                        </button>
                      ))}
                      {availableModels.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">
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
                  className="h-9 w-[120px] justify-between"
                >
                  <div className="flex items-center">
                    <Timer className="h-4 w-4 mr-2 flex-shrink-0" />
                    {refreshInterval > 0 && countdown > 0 ? (
                      <span className="text-primary font-medium tabular-nums">{formatCountdown(countdown)}</span>
                    ) : (
                      <span>自动刷新</span>
                    )}
                  </div>
                  <ChevronDown className="h-3 w-3 flex-shrink-0" />
                </Button>

                {showIntervalDropdown && (
                  <div className="absolute right-0 mt-1 w-36 bg-popover border rounded-md shadow-lg z-50">
                    <div className="p-2 border-b">
                      <p className="text-xs text-muted-foreground">刷新间隔</p>
                    </div>
                    <div className="p-1">
                      {REFRESH_INTERVALS.map(({ value, label }) => (
                        <button
                          key={value}
                          onClick={() => {
                            setRefreshInterval(value)
                            saveRefreshIntervalToBackend(value)
                            setShowIntervalDropdown(false)
                          }}
                          className={cn(
                            "w-full text-left px-3 py-2 text-sm rounded hover:bg-accent transition-colors",
                            refreshInterval === value && "bg-accent text-accent-foreground"
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
              <Button onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
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
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {selectedModels.length === 0 ? (
              <p>请选择要监控的模型</p>
            ) : (
              <p>暂无模型状态数据</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-green-500" />
              <span>成功率 ≥ 95%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-yellow-500" />
              <span>成功率 80-95%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-red-500" />
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

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base font-medium truncate max-w-md" title={model.model_name}>
              {model.model_name}
            </CardTitle>
            <Badge
              variant={model.current_status === 'green' ? 'success' : model.current_status === 'yellow' ? 'warning' : 'destructive'}
            >
              {STATUS_LABELS[model.current_status]}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{model.success_rate}%</span> 成功率
            <span className="mx-2">·</span>
            <span>{model.total_requests.toLocaleString()}</span> 请求
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Status grid */}
        <div className="relative">
          <div className="flex gap-1">
            {model.slot_data.map((slot, index) => (
              <div
                key={index}
                className={cn(
                  "flex-1 h-8 rounded cursor-pointer transition-all hover:ring-2 hover:ring-primary hover:ring-offset-1",
                  STATUS_COLORS[slot.status],
                  slot.total_requests === 0 && "opacity-30"
                )}
                onMouseEnter={(e) => handleMouseEnter(slot, e)}
                onMouseLeave={() => setHoveredSlot(null)}
              />
            ))}
          </div>

          {/* Time labels */}
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>{timeLabels[0]}</span>
            <span>{timeLabels[1]}</span>
            <span>{timeLabels[2]}</span>
          </div>

          {/* Tooltip */}
          {hoveredSlot && (
            <div
              className="fixed z-50 bg-popover border rounded-lg shadow-lg p-3 text-sm pointer-events-none"
              style={{
                left: tooltipPosition.x,
                top: tooltipPosition.y,
                transform: 'translate(-50%, -100%)',
              }}
            >
              <div className="font-medium mb-2">
                {formatDateTime(hoveredSlot.start_time)} - {formatTime(hoveredSlot.end_time)}
              </div>
              <div className="space-y-1 text-muted-foreground">
                <div className="flex justify-between gap-4">
                  <span>总请求:</span>
                  <span className="font-medium text-foreground">{hoveredSlot.total_requests}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>成功数:</span>
                  <span className="font-medium text-green-600">{hoveredSlot.success_count}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>成功率:</span>
                  <span className={cn(
                    "font-medium",
                    hoveredSlot.status === 'green' ? 'text-green-600' :
                      hoveredSlot.status === 'yellow' ? 'text-yellow-600' : 'text-red-600'
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

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { cn } from '../lib/utils'
import { RefreshCw, Loader2, Timer, ChevronDown, Settings2, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'

interface HourlyStatus {
  hour: number
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
  total_requests_24h: number
  success_count_24h: number
  success_rate_24h: number
  current_status: 'green' | 'yellow' | 'red'
  hourly_data: HourlyStatus[]
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

export function ModelStatusMonitor({ isEmbed = false }: ModelStatusMonitorProps) {
  const { token } = useAuth()
  const { showToast } = useToast()

  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>(() => {
    const saved = localStorage.getItem(SELECTED_MODELS_KEY)
    return saved ? JSON.parse(saved) : []
  })
  const [modelStatuses, setModelStatuses] = useState<ModelStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  
  const [refreshInterval, setRefreshInterval] = useState(() => {
    const saved = localStorage.getItem(REFRESH_INTERVAL_KEY)
    return saved ? parseInt(saved, 10) : 60
  })
  const [countdown, setCountdown] = useState(refreshInterval)
  const refreshIntervalRef = useRef(refreshInterval)
  
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [showIntervalDropdown, setShowIntervalDropdown] = useState(false)
  const modelSelectorRef = useRef<HTMLDivElement>(null)
  const intervalDropdownRef = useRef<HTMLDivElement>(null)

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
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Save selected models to localStorage
  useEffect(() => {
    localStorage.setItem(SELECTED_MODELS_KEY, JSON.stringify(selectedModels))
  }, [selectedModels])

  // Update refresh interval ref
  useEffect(() => {
    refreshIntervalRef.current = refreshInterval
    localStorage.setItem(REFRESH_INTERVAL_KEY, refreshInterval.toString())
  }, [refreshInterval])

  // Fetch available models
  const fetchAvailableModels = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}${getApiPrefix()}/models`, {
        headers: getAuthHeaders(),
      })
      const data = await response.json()
      if (data.success) {
        setAvailableModels(data.data)
        // Auto-select first 5 models if none selected
        if (selectedModels.length === 0 && data.data.length > 0) {
          setSelectedModels(data.data.slice(0, 5))
        }
      }
    } catch (error) {
      console.error('Failed to fetch available models:', error)
    }
  }, [apiUrl, getApiPrefix, getAuthHeaders, selectedModels.length])

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
      const response = await fetch(`${apiUrl}${getApiPrefix()}/status/batch`, {
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
  }, [apiUrl, getApiPrefix, getAuthHeaders, selectedModels, isEmbed, showToast])

  // Initial load
  useEffect(() => {
    fetchAvailableModels()
  }, [fetchAvailableModels])

  // Fetch statuses when selected models change
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
    setSelectedModels(prev => {
      if (prev.includes(model)) {
        return prev.filter(m => m !== model)
      } else {
        return [...prev, model]
      }
    })
  }

  const selectAllModels = () => {
    setSelectedModels(availableModels)
  }

  const clearAllModels = () => {
    setSelectedModels([])
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
                <Badge variant="outline">24小时</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                监控 <span className="font-medium text-primary">{selectedModels.length}</span> 个模型
                {modelStatuses.length > 0 && (
                  <span className="ml-2">
                    · 总请求: {modelStatuses.reduce((sum, m) => sum + m.total_requests_24h, 0).toLocaleString()}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
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
                  className="h-9 min-w-[100px]"
                >
                  <Timer className="h-4 w-4 mr-2" />
                  {refreshInterval > 0 && countdown > 0 ? (
                    <span className="text-primary font-medium">{formatCountdown(countdown)}</span>
                  ) : (
                    '自动刷新'
                  )}
                  <ChevronDown className="h-3 w-3 ml-1" />
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
  const [hoveredHour, setHoveredHour] = useState<HourlyStatus | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })

  const handleMouseEnter = (hour: HourlyStatus, event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setTooltipPosition({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    })
    setHoveredHour(hour)
  }

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
            <span className="font-medium text-foreground">{model.success_rate_24h}%</span> 成功率
            <span className="mx-2">·</span>
            <span>{model.total_requests_24h.toLocaleString()}</span> 请求
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* 24-hour status grid */}
        <div className="relative">
          <div className="flex gap-1">
            {model.hourly_data.map((hour, index) => (
              <div
                key={index}
                className={cn(
                  "flex-1 h-8 rounded cursor-pointer transition-all hover:ring-2 hover:ring-primary hover:ring-offset-1",
                  STATUS_COLORS[hour.status]
                )}
                onMouseEnter={(e) => handleMouseEnter(hour, e)}
                onMouseLeave={() => setHoveredHour(null)}
              />
            ))}
          </div>
          
          {/* Time labels */}
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>24小时前</span>
            <span>12小时前</span>
            <span>现在</span>
          </div>

          {/* Tooltip */}
          {hoveredHour && (
            <div
              className="fixed z-50 bg-popover border rounded-lg shadow-lg p-3 text-sm pointer-events-none"
              style={{
                left: tooltipPosition.x,
                top: tooltipPosition.y,
                transform: 'translate(-50%, -100%)',
              }}
            >
              <div className="font-medium mb-2">
                {formatDateTime(hoveredHour.start_time)} - {formatTime(hoveredHour.end_time)}
              </div>
              <div className="space-y-1 text-muted-foreground">
                <div className="flex justify-between gap-4">
                  <span>总请求:</span>
                  <span className="font-medium text-foreground">{hoveredHour.total_requests}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>成功数:</span>
                  <span className="font-medium text-green-600">{hoveredHour.success_count}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>成功率:</span>
                  <span className={cn(
                    "font-medium",
                    hoveredHour.status === 'green' ? 'text-green-600' :
                    hoveredHour.status === 'yellow' ? 'text-yellow-600' : 'text-red-600'
                  )}>
                    {hoveredHour.success_rate}%
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

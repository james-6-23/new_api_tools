import { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '../lib/utils'
import { RefreshCw, Loader2, Settings2, Check, ChevronDown } from 'lucide-react'

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

const STATUS_BADGE_COLORS = {
  green: 'bg-green-500/20 text-green-400 border-green-500/30',
  yellow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  red: 'bg-red-500/20 text-red-400 border-red-500/30',
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

// Storage keys
const SELECTED_MODELS_KEY = 'model_status_embed_selected_models'

interface ModelStatusEmbedProps {
  refreshInterval?: number  // in seconds, default 60
  defaultModels?: string[]  // pre-selected models from URL params
}

export function ModelStatusEmbed({ 
  refreshInterval = 60,
  defaultModels = []
}: ModelStatusEmbedProps) {
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>(() => {
    if (defaultModels.length > 0) return defaultModels
    const saved = localStorage.getItem(SELECTED_MODELS_KEY)
    return saved ? JSON.parse(saved) : []
  })
  const [modelStatuses, setModelStatuses] = useState<ModelStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  
  const [showModelSelector, setShowModelSelector] = useState(false)
  const modelSelectorRef = useRef<HTMLDivElement>(null)

  const apiUrl = import.meta.env.VITE_API_URL || ''

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(event.target as Node)) {
        setShowModelSelector(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Save selected models
  useEffect(() => {
    localStorage.setItem(SELECTED_MODELS_KEY, JSON.stringify(selectedModels))
  }, [selectedModels])

  // Fetch available models
  const fetchAvailableModels = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/model-status/embed/models`)
      const data = await response.json()
      if (data.success) {
        setAvailableModels(data.data)
        if (selectedModels.length === 0 && data.data.length > 0) {
          setSelectedModels(data.data.slice(0, 5))
        }
      }
    } catch (error) {
      console.error('Failed to fetch available models:', error)
    }
  }, [apiUrl, selectedModels.length])

  // Fetch model statuses
  const fetchModelStatuses = useCallback(async () => {
    if (selectedModels.length === 0) {
      setModelStatuses([])
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`${apiUrl}/api/model-status/embed/status/batch`, {
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
      setRefreshing(false)
    }
  }, [apiUrl, selectedModels])

  // Initial load
  useEffect(() => {
    fetchAvailableModels()
  }, [fetchAvailableModels])

  // Fetch statuses when selected models change
  useEffect(() => {
    fetchModelStatuses()
  }, [fetchModelStatuses])

  // Auto refresh
  useEffect(() => {
    if (refreshInterval <= 0) return

    const timer = setInterval(() => {
      fetchModelStatuses()
    }, refreshInterval * 1000)

    return () => clearInterval(timer)
  }, [refreshInterval, fetchModelStatuses])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchModelStatuses()
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

  if (loading && modelStatuses.length === 0) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-100 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">模型状态监控</h1>
          <p className="text-sm text-gray-500 mt-1">
            24小时滑动窗口 · {selectedModels.length} 个模型
            {lastUpdate && (
              <span className="ml-2">
                · 更新于 {lastUpdate.toLocaleTimeString('zh-CN')}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Model Selector */}
          <div className="relative" ref={modelSelectorRef}>
            <button
              onClick={() => setShowModelSelector(!showModelSelector)}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-[#161b22] border border-gray-700 rounded-lg hover:border-gray-600 transition-colors"
            >
              <Settings2 className="h-4 w-4" />
              选择模型
              <ChevronDown className="h-3 w-3" />
            </button>

            {showModelSelector && (
              <div className="absolute right-0 mt-1 w-72 bg-[#161b22] border border-gray-700 rounded-lg shadow-xl z-50 max-h-80 overflow-hidden">
                <div className="p-2 border-b border-gray-700 flex justify-between items-center">
                  <span className="text-xs text-gray-500">选择要监控的模型</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setSelectedModels(availableModels)}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      全选
                    </button>
                    <span className="text-gray-600">|</span>
                    <button
                      onClick={() => setSelectedModels([])}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      清空
                    </button>
                  </div>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {availableModels.map(model => (
                    <button
                      key={model}
                      onClick={() => toggleModelSelection(model)}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm hover:bg-gray-800 transition-colors flex items-center justify-between",
                        selectedModels.includes(model) && "bg-gray-800/50"
                      )}
                    >
                      <span className="truncate">{model}</span>
                      {selectedModels.includes(model) && (
                        <Check className="h-4 w-4 text-green-400 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-[#161b22] border border-gray-700 rounded-lg hover:border-gray-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            刷新
          </button>
        </div>
      </div>

      {/* Model Status Cards */}
      {modelStatuses.length > 0 ? (
        <div className="space-y-4">
          {modelStatuses.map(model => (
            <EmbedModelCard key={model.model_name} model={model} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">
          {selectedModels.length === 0 ? '请选择要监控的模型' : '暂无模型状态数据'}
        </div>
      )}

      {/* Legend */}
      <div className="mt-6 flex items-center justify-center gap-6 text-xs text-gray-500">
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
    </div>
  )
}

interface EmbedModelCardProps {
  model: ModelStatus
}

function EmbedModelCard({ model }: EmbedModelCardProps) {
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
    <div className="bg-[#161b22] border border-gray-800 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h3 className="font-medium text-white truncate max-w-md" title={model.model_name}>
            {model.model_name}
          </h3>
          <span className={cn(
            "px-2 py-0.5 text-xs rounded border",
            STATUS_BADGE_COLORS[model.current_status]
          )}>
            {STATUS_LABELS[model.current_status]}
          </span>
        </div>
        <div className="text-sm text-gray-400">
          <span className="text-white font-medium">{model.success_rate_24h}%</span> 成功率
          <span className="mx-2 text-gray-600">·</span>
          <span>{model.total_requests_24h.toLocaleString()}</span> 请求
        </div>
      </div>

      {/* 24-hour status grid */}
      <div className="relative">
        <div className="flex gap-0.5">
          {model.hourly_data.map((hour, index) => (
            <div
              key={index}
              className={cn(
                "flex-1 h-6 rounded-sm cursor-pointer transition-all hover:ring-1 hover:ring-white/50",
                STATUS_COLORS[hour.status]
              )}
              onMouseEnter={(e) => handleMouseEnter(hour, e)}
              onMouseLeave={() => setHoveredHour(null)}
            />
          ))}
        </div>

        {/* Time labels */}
        <div className="flex justify-between mt-2 text-xs text-gray-600">
          <span>24小时前</span>
          <span>12小时前</span>
          <span>现在</span>
        </div>

        {/* Tooltip */}
        {hoveredHour && (
          <div
            className="fixed z-50 bg-[#1c2128] border border-gray-700 rounded-lg shadow-xl p-3 text-sm pointer-events-none"
            style={{
              left: tooltipPosition.x,
              top: tooltipPosition.y,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="font-medium text-white mb-2">
              {formatDateTime(hoveredHour.start_time)} - {formatTime(hoveredHour.end_time)}
            </div>
            <div className="space-y-1 text-gray-400">
              <div className="flex justify-between gap-4">
                <span>总请求:</span>
                <span className="text-white">{hoveredHour.total_requests}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>成功数:</span>
                <span className="text-green-400">{hoveredHour.success_count}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>成功率:</span>
                <span className={cn(
                  hoveredHour.status === 'green' ? 'text-green-400' :
                  hoveredHour.status === 'yellow' ? 'text-yellow-400' : 'text-red-400'
                )}>
                  {hoveredHour.success_rate}%
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

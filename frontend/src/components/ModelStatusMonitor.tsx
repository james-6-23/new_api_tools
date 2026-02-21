import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { cn } from '../lib/utils'
import { RefreshCw, Loader2, Timer, ChevronDown, Settings2, Check, Clock, Palette, Moon, Sun, Minimize2, Maximize2, Zap, Terminal, Leaf, Droplets, HelpCircle, Copy, X, Command, LayoutGrid, Bot, MessageSquareQuote, Triangle, Sparkles, CreditCard, GitBranch, Gamepad2, Rocket, Brain, ArrowUpDown, GripVertical, Search, Filter } from 'lucide-react'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card, CardContent } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { useClickOutside } from '../hooks/useClickOutside'
import {
  OpenAI, Gemini, DeepSeek, SiliconCloud, Groq, Ollama, Claude, Mistral,
  Minimax, Baichuan, Moonshot, Spark, Qwen, Yi, Hunyuan, Stepfun, ZeroOne,
  Zhipu, ChatGLM, Cohere, Perplexity, Together, OpenRouter, Fireworks,
  Ai360, Doubao, Wenxin, Meta, Coze, Cerebras, Kimi, NewAPI, ZAI, ModelScope
} from '@lobehub/icons'

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
  empty: 'bg-gray-200 dark:bg-gray-700',  // No requests - neutral gray
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconComponent = React.ComponentType<any>

// Model logo mapping - maps model name patterns to logo components
const MODEL_LOGO_MAP: Record<string, IconComponent> = {
  // OpenAI models
  'gpt': OpenAI,
  'openai': OpenAI,
  'o1': OpenAI,
  'o3': OpenAI,
  'chatgpt': OpenAI,
  'dall-e': OpenAI,
  'whisper': OpenAI,
  'tts': OpenAI,

  // Google models
  'gemini': Gemini,
  'gemma': Gemini,
  'palm': Gemini,
  'bard': Gemini,

  // Anthropic models
  'claude': Claude,
  'anthropic': Claude,

  // DeepSeek models
  'deepseek': DeepSeek,

  // Meta models
  'llama': Meta,
  'meta': Meta,

  // Mistral models
  'mistral': Mistral,
  'mixtral': Mistral,
  'codestral': Mistral,
  'pixtral': Mistral,

  // Chinese models
  'qwen': Qwen,
  'tongyi': Qwen,
  'yi': Yi,
  '01-ai': Yi,
  'baichuan': Baichuan,
  'glm': ChatGLM,
  'chatglm': ChatGLM,
  'zhipu': Zhipu,
  'moonshot': Moonshot,
  'kimi': Kimi,
  'spark': Spark,
  'xunfei': Spark,
  'hunyuan': Hunyuan,
  'tencent': Hunyuan,
  'doubao': Doubao,
  'bytedance': Doubao,
  'wenxin': Wenxin,
  'ernie': Wenxin,
  'baidu': Wenxin,
  'minimax': Minimax,
  'abab': Minimax,
  'stepfun': Stepfun,
  'step': Stepfun,
  'zeroone': ZeroOne,
  '01': ZeroOne,
  '360': Ai360,
  'modelscope': ModelScope,

  // Other providers
  'groq': Groq,
  'ollama': Ollama,
  'cohere': Cohere,
  'command': Cohere,
  'perplexity': Perplexity,
  'pplx': Perplexity,
  'together': Together,
  'openrouter': OpenRouter,
  'fireworks': Fireworks,
  'siliconcloud': SiliconCloud,
  'silicon': SiliconCloud,
  'cerebras': Cerebras,
  'coze': Coze,
  'newapi': NewAPI,
  'zai': ZAI,
}

// Get model logo component based on model name
function getModelLogo(modelName: string): IconComponent | null {
  const lowerName = modelName.toLowerCase()

  // Check each pattern in order of specificity
  for (const [pattern, Logo] of Object.entries(MODEL_LOGO_MAP)) {
    if (lowerName.includes(pattern)) {
      return Logo
    }
  }

  return null
}

// Model Logo component with fallback
interface ModelLogoProps {
  modelName: string
  size?: number
  className?: string
}

function ModelLogo({ modelName, size = 20, className }: ModelLogoProps) {
  const Logo = useMemo(() => getModelLogo(modelName), [modelName])

  if (Logo) {
    return <Logo size={size} className={className} />
  }

  // Fallback to generic AI icon
  return <Brain size={size} className={cn("text-muted-foreground", className)} />
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
  { id: 'forest', name: '森林', nameEn: 'Forest', icon: Leaf, description: '深邃自然的森林色调', preview: 'bg-[#022c22]' },
  { id: 'ocean', name: '海洋', nameEn: 'Ocean', icon: Droplets, description: '宁静深邃的海洋蓝', preview: 'bg-[#0b1121]' },
  { id: 'terminal', name: '终端', nameEn: 'Terminal', icon: Terminal, description: '复古极客风格', preview: 'bg-black border border-green-500' },
  { id: 'cupertino', name: 'Apple', nameEn: 'Apple', icon: Command, description: '致敬 Apple 设计风格', preview: 'bg-[#f5f5f7]' },
  { id: 'material', name: 'Google', nameEn: 'Google', icon: LayoutGrid, description: '致敬 Google Material', preview: 'bg-[#f0f4f8]' },
  { id: 'openai', name: 'OpenAI', nameEn: 'OpenAI', icon: Bot, description: '致敬 OpenAI 设计风格', preview: 'bg-[#343541]' },
  { id: 'anthropic', name: 'Claude', nameEn: 'Claude', icon: MessageSquareQuote, description: '致敬 Claude 设计风格', preview: 'bg-[#f4f1ea]' },
  { id: 'vercel', name: 'Vercel', nameEn: 'Vercel', icon: Triangle, description: 'Geist 风格，极致黑白', preview: 'bg-black radial-gradient(#333 1px, transparent 1px)' },
  { id: 'linear', name: 'Linear', nameEn: 'Linear', icon: Sparkles, description: '流光风格，深色质感', preview: 'bg-[#0f1015]' },
  { id: 'stripe', name: 'Stripe', nameEn: 'Stripe', icon: CreditCard, description: '现代支付美学', preview: 'bg-white' },
  { id: 'github', name: 'GitHub', nameEn: 'GitHub', icon: GitBranch, description: '开发者之魂', preview: 'bg-[#0d1117]' },
  { id: 'discord', name: 'Discord', nameEn: 'Discord', icon: Gamepad2, description: '游戏社区风格', preview: 'bg-[#313338]' },
  { id: 'tesla', name: 'Tesla', nameEn: 'Tesla', icon: Rocket, description: '工业未来风', preview: 'bg-black' },
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

// Model with stats interface
interface ModelWithStats {
  model_name: string
  request_count_24h: number
}

// Storage keys
const SELECTED_MODELS_KEY = 'model_status_selected_models'
const REFRESH_INTERVAL_KEY = 'model_status_refresh_interval'
const TIME_WINDOW_KEY = 'model_status_time_window'
const THEME_KEY = 'model_status_theme'
const SORT_MODE_KEY = 'model_status_sort_mode'
const CUSTOM_ORDER_KEY = 'model_status_custom_order'

// Sort mode type
type SortMode = 'default' | 'availability' | 'custom'

// Status filter type
type StatusFilter = 'all' | 'green' | 'yellow' | 'red'

export function ModelStatusMonitor({ isEmbed = false }: ModelStatusMonitorProps) {
  const { token } = useAuth()
  const { showToast } = useToast()

  const [availableModels, setAvailableModels] = useState<ModelWithStats[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [modelStatuses, setModelStatuses] = useState<ModelStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [timeWindow, setTimeWindow] = useState(() => {
    const saved = localStorage.getItem(TIME_WINDOW_KEY)
    return saved || '24h'
  })

  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY)
    // Validate saved theme exists, fallback for legacy values (light/dark/system)
    if (saved && THEMES.find(t => t.id === saved)) return saved
    return 'daylight'
  })

  const [refreshInterval, setRefreshInterval] = useState(() => {
    const saved = localStorage.getItem(REFRESH_INTERVAL_KEY)
    return saved ? parseInt(saved, 10) : 60
  })
  const [countdown, setCountdown] = useState(refreshInterval)
  const refreshIntervalRef = useRef(refreshInterval)

  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const saved = localStorage.getItem(SORT_MODE_KEY)
    return (saved as SortMode) || 'default'
  })
  const [customOrder, setCustomOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem(CUSTOM_ORDER_KEY)
    return saved ? JSON.parse(saved) : []
  })

  const [showModelSelector, setShowModelSelector] = useState(false)
  const [showIntervalDropdown, setShowIntervalDropdown] = useState(false)
  const [showWindowDropdown, setShowWindowDropdown] = useState(false)
  const [showThemeDropdown, setShowThemeDropdown] = useState(false)
  const [showEmbedHelp, setShowEmbedHelp] = useState(false)
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [isFullscreen, setIsFullscreen] = useState(false)
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
  useClickOutside(modelSelectorRef, () => setShowModelSelector(false), showModelSelector)
  useClickOutside(intervalDropdownRef, () => setShowIntervalDropdown(false), showIntervalDropdown)
  useClickOutside(windowDropdownRef, () => setShowWindowDropdown(false), showWindowDropdown)
  useClickOutside(themeDropdownRef, () => setShowThemeDropdown(false), showThemeDropdown)

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  // Toggle fullscreen mode
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(console.error)
    } else {
      document.exitFullscreen().catch(console.error)
    }
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

  // Save sort config to backend cache
  const saveSortConfigToBackend = useCallback(async (mode: SortMode, order?: string[]) => {
    try {
      await fetch(`${apiUrl}/api/model-status/config/sort`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ sort_mode: mode, custom_order: order }),
      })
      localStorage.setItem(SORT_MODE_KEY, mode)
      if (order) {
        localStorage.setItem(CUSTOM_ORDER_KEY, JSON.stringify(order))
      }
    } catch (error) {
      console.error('Failed to save sort config:', error)
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
          // Validate theme exists, fallback to daylight for legacy values (light/dark/system)
          const validTheme = THEMES.find(t => t.id === data.theme) ? data.theme : 'daylight'
          setTheme(validTheme)
          localStorage.setItem(THEME_KEY, validTheme)
        }
        if (data.refresh_interval !== undefined && data.refresh_interval !== null) {
          setRefreshInterval(data.refresh_interval)
          setCountdown(data.refresh_interval)
          localStorage.setItem(REFRESH_INTERVAL_KEY, data.refresh_interval.toString())
        }
        if (data.sort_mode) {
          setSortMode(data.sort_mode as SortMode)
          localStorage.setItem(SORT_MODE_KEY, data.sort_mode)
        }
        if (data.custom_order && data.custom_order.length > 0) {
          setCustomOrder(data.custom_order)
          localStorage.setItem(CUSTOM_ORDER_KEY, JSON.stringify(data.custom_order))
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
        // data.data is now an array of { model_name, request_count_24h }
        setAvailableModels(data.data)
        // Load config from backend
        const savedModels = await loadConfigFromBackend()
        // Auto-select models with requests in last 24h if none selected
        if (savedModels.length === 0 && data.data.length > 0) {
          // Filter models that have requests in the last 24 hours
          const activeModels = data.data
            .filter((m: ModelWithStats) => m.request_count_24h > 0)
            .map((m: ModelWithStats) => m.model_name)
          // If no active models, fall back to first 5
          const defaultModels = activeModels.length > 0
            ? activeModels
            : data.data.slice(0, 5).map((m: ModelWithStats) => m.model_name)
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
      // Only clear initialLoading when we know models have been loaded
      if (availableModels.length > 0) {
        setInitialLoading(false)
      }
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
        setInitialLoading(false)
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

  // Track if models/window changed (not initial load)
  const isInitialMount = useRef(true)
  const prevSelectedModels = useRef<string[]>([])
  const prevTimeWindow = useRef<string>(timeWindow)

  // Handle model selection and time window changes
  useEffect(() => {
    if (isInitialMount.current) {
      // Initial load - use cache for fast loading
      isInitialMount.current = false
      prevSelectedModels.current = selectedModels
      prevTimeWindow.current = timeWindow
      fetchModelStatuses(false)  // Use cache on initial load
      return
    }

    // Check what changed
    const modelsChanged =
      selectedModels.length !== prevSelectedModels.current.length ||
      selectedModels.some(m => !prevSelectedModels.current.includes(m))
    const windowChanged = timeWindow !== prevTimeWindow.current

    // Update refs
    prevSelectedModels.current = selectedModels
    prevTimeWindow.current = timeWindow

    if (modelsChanged) {
      // Models selection changed - fetch fresh data for new models
      fetchModelStatuses(true)
    } else if (windowChanged) {
      // Only time window changed - can use cache (pre-warmed)
      fetchModelStatuses(false)
    }
  }, [selectedModels, timeWindow, fetchModelStatuses])

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

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Status counts for overview
  const statusCounts = useMemo(() => {
    const counts = { green: 0, yellow: 0, red: 0 }
    modelStatuses.forEach(m => {
      counts[m.current_status]++
    })
    return counts
  }, [modelStatuses])

  // Sorted model statuses based on sort mode
  const sortedModelStatuses = useMemo(() => {
    if (modelStatuses.length === 0) return []

    let result: ModelStatus[]
    switch (sortMode) {
      case 'availability':
        // Sort by success rate descending
        result = [...modelStatuses].sort((a, b) => b.success_rate - a.success_rate)
        break
      case 'custom':
        if (customOrder.length === 0) {
          result = modelStatuses
        } else {
          // Sort by custom order
          result = [...modelStatuses].sort((a, b) => {
            const indexA = customOrder.indexOf(a.model_name)
            const indexB = customOrder.indexOf(b.model_name)
            // Models not in customOrder go to the end
            if (indexA === -1 && indexB === -1) return 0
            if (indexA === -1) return 1
            if (indexB === -1) return -1
            return indexA - indexB
          })
        }
        break
      default:
        result = modelStatuses
    }

    // Hide models with 0 requests
    result = result.filter(m => m.total_requests > 0)

    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter(m => m.current_status === statusFilter)
    }

    return result
  }, [modelStatuses, sortMode, customOrder, statusFilter])

  // Handle drag end for reordering
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = sortedModelStatuses.findIndex(m => m.model_name === active.id)
      const newIndex = sortedModelStatuses.findIndex(m => m.model_name === over.id)

      if (oldIndex !== -1 && newIndex !== -1) {
        // Create new order
        const newOrder = sortedModelStatuses.map(m => m.model_name)
        const [movedItem] = newOrder.splice(oldIndex, 1)
        newOrder.splice(newIndex, 0, movedItem)

        // Update state and save
        setCustomOrder(newOrder)
        setSortMode('custom')
        saveSortConfigToBackend('custom', newOrder)
        showToast('success', '已切换为自定义排序')
      }
    }
  }

  // Handle availability sort button click
  const handleAvailabilitySort = () => {
    setSortMode('availability')
    saveSortConfigToBackend('availability')
    showToast('success', '已按成功率排序')
  }

  const toggleModelSelection = (model: string) => {
    const newModels = selectedModels.includes(model)
      ? selectedModels.filter(m => m !== model)
      : [...selectedModels, model]
    setSelectedModels(newModels)
    saveSelectedModelsToBackend(newModels)
  }

  const selectAllModels = () => {
    const allModelNames = availableModels.map(m => m.model_name)
    setSelectedModels(allModelNames)
    saveSelectedModelsToBackend(allModelNames)
  }

  const clearAllModels = () => {
    setSelectedModels([])
    saveSelectedModelsToBackend([])
  }

  if (loading && modelStatuses.length === 0) {
    return (
      <div className={cn("space-y-6", isEmbed && "p-4")}>
        {/* Skeleton Header */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <div className="h-6 w-32 bg-muted animate-pulse rounded-md" />
                  <div className="h-5 w-14 bg-muted animate-pulse rounded-full" />
                </div>
                <div className="h-4 w-48 bg-muted animate-pulse rounded-md mt-2" />
              </div>
              <div className="flex items-center gap-3">
                {[80, 64, 80, 96, 80, 72].map((w, i) => (
                  <div key={i} className="h-9 bg-muted animate-pulse rounded-md" style={{ width: w, animationDelay: `${i * 100}ms` }} />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Skeleton Cards Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[0, 1, 2, 3].map(i => (
            <Card key={i} className="overflow-hidden" style={{ animationDelay: `${i * 150}ms` }}>
              <div className="px-4 pt-3 pb-3 animate-in fade-in-0 duration-500" style={{ animationDelay: `${i * 150}ms` }}>
                {/* Skeleton header row */}
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-6 h-6 rounded-md bg-muted animate-pulse" />
                  <div className="h-4 bg-muted animate-pulse rounded-md" style={{ width: `${120 + i * 30}px` }} />
                  <div className="h-5 w-12 bg-muted animate-pulse rounded-full" />
                  <div className="ml-auto flex items-center gap-1">
                    <div className="h-4 w-10 bg-muted animate-pulse rounded-md" />
                    <div className="h-4 w-14 bg-muted animate-pulse rounded-md" />
                  </div>
                </div>
                {/* Skeleton status bar */}
                <div className="flex gap-[3px]">
                  {Array.from({ length: 24 }).map((_, j) => (
                    <div
                      key={j}
                      className={cn(
                        "flex-1 h-5 bg-muted animate-pulse",
                        j === 0 ? "rounded-l-md rounded-r-sm" :
                          j === 23 ? "rounded-r-md rounded-l-sm" : "rounded-sm"
                      )}
                      style={{ animationDelay: `${(i * 150) + (j * 20)}ms` }}
                    />
                  ))}
                </div>
                {/* Skeleton time labels */}
                <div className="flex justify-between mt-1.5">
                  <div className="h-3 w-10 bg-muted animate-pulse rounded" />
                  <div className="h-3 w-10 bg-muted animate-pulse rounded" />
                  <div className="h-3 w-8 bg-muted animate-pulse rounded" />
                </div>
              </div>
            </Card>
          ))}
        </div>
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
              <p className="text-sm text-muted-foreground mt-1 flex items-center flex-wrap gap-x-2 gap-y-1">
                监控 <span className="font-medium text-primary">{selectedModels.length}</span> 个模型
                {modelStatuses.length > 0 && (
                  <>
                    <span>· 总请求: {modelStatuses.reduce((sum, m) => sum + m.total_requests, 0).toLocaleString()}</span>
                    <span className="flex items-center gap-1">
                      · <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-green-600 font-medium">{statusCounts.green}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-yellow-500" />
                      <span className="text-yellow-600 font-medium">{statusCounts.yellow}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-red-600 font-medium">{statusCounts.red}</span>
                    </span>
                  </>
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
                  <div className="absolute right-0 mt-1 w-36 bg-popover border rounded-md shadow-lg z-40">
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
                  <div className="absolute right-0 mt-1 w-56 bg-popover border rounded-md shadow-lg z-40">
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
                  <div className="absolute right-0 mt-1 w-72 bg-popover border rounded-md shadow-lg z-40 max-h-96 overflow-hidden">
                    <div className="p-2 border-b flex justify-between items-center">
                      <p className="text-xs text-muted-foreground">选择要监控的模型</p>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={selectAllModels}>
                          全选
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => {
                          const activeModels = availableModels
                            .filter(m => m.request_count_24h > 0)
                            .map(m => m.model_name)
                          setSelectedModels(activeModels)
                          saveSelectedModelsToBackend(activeModels)
                        }}>
                          有记录
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearAllModels}>
                          清空
                        </Button>
                      </div>
                    </div>
                    {/* Search input */}
                    <div className="px-2 py-1.5 border-b">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <input
                          type="text"
                          placeholder="搜索模型..."
                          value={modelSearchQuery}
                          onChange={(e) => setModelSearchQuery(e.target.value)}
                          className="w-full h-8 pl-8 pr-3 text-sm bg-muted/50 border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="p-1 max-h-64 overflow-y-auto">
                      {availableModels
                        .filter(model => !modelSearchQuery || model.model_name.toLowerCase().includes(modelSearchQuery.toLowerCase()))
                        .map(model => (
                          <button
                            key={model.model_name}
                            onClick={() => toggleModelSelection(model.model_name)}
                            className={cn(
                              "w-full text-left px-3 py-2 text-sm rounded hover:bg-accent transition-colors flex items-center justify-between",
                              selectedModels.includes(model.model_name) && "bg-accent"
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                                <ModelLogo modelName={model.model_name} size={16} />
                              </div>
                              <span className={cn(
                                "truncate",
                                model.request_count_24h === 0 && "text-muted-foreground"
                              )}>
                                {model.model_name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {model.request_count_24h > 0 ? (
                                <span className="text-xs text-muted-foreground">
                                  {model.request_count_24h.toLocaleString()}
                                </span>
                              ) : (
                                <span className="text-xs text-orange-400">无请求</span>
                              )}
                              {selectedModels.includes(model.model_name) && (
                                <Check className="h-4 w-4 text-primary" />
                              )}
                            </div>
                          </button>
                        ))}
                      {availableModels.filter(m => !modelSearchQuery || m.model_name.toLowerCase().includes(modelSearchQuery.toLowerCase())).length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          {modelSearchQuery ? '未找到匹配的模型' : '暂无可用模型'}
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
                  <div className="absolute right-0 mt-1 w-36 bg-popover border rounded-md shadow-lg z-40">
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

              {/* Availability Sort Button */}
              <Button
                variant={sortMode === 'availability' ? 'default' : 'outline'}
                size="sm"
                onClick={handleAvailabilitySort}
                className="h-9"
                title="按成功率从高到低排序"
              >
                <ArrowUpDown className="h-4 w-4 mr-2" />
                高可用排序
              </Button>

              {/* Manual Refresh */}
              <Button onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                刷新
              </Button>

              {/* Fullscreen Button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleFullscreen}
                title={isFullscreen ? '退出全屏' : '全屏模式'}
                className="h-9 w-9"
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </Button>

              {/* Embed Help Button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowEmbedHelp(true)}
                title="嵌入说明"
                className="h-9 w-9"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Embed Help Modal */}
      {showEmbedHelp && (
        <EmbedHelpModal onClose={() => setShowEmbedHelp(false)} />
      )}

      {/* Status Filter Tabs */}
      {modelStatuses.length > 0 && (
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {[
            { value: 'all' as StatusFilter, label: '全部', count: modelStatuses.length },
            { value: 'green' as StatusFilter, label: '正常', count: statusCounts.green, color: 'text-green-600' },
            { value: 'yellow' as StatusFilter, label: '警告', count: statusCounts.yellow, color: 'text-yellow-600' },
            { value: 'red' as StatusFilter, label: '异常', count: statusCounts.red, color: 'text-red-600' },
          ].map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={cn(
                "px-3 py-1.5 text-sm rounded-md transition-all",
                statusFilter === tab.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
              <span className={cn(
                "ml-1.5 text-xs tabular-nums",
                statusFilter === tab.value ? "opacity-80" : (tab.color || "")
              )}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Model Status Cards */}
      {sortedModelStatuses.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortedModelStatuses.map(m => m.model_name)}
            strategy={rectSortingStrategy}
          >
            <div key={statusFilter} className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {sortedModelStatuses.map(model => (
                <SortableModelCard key={model.model_name} model={model} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : initialLoading ? (
        /* Skeleton cards during initial loading transition */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[0, 1, 2, 3].map(i => (
            <Card key={i} className="overflow-hidden">
              <div className="px-4 pt-3 pb-3 animate-in fade-in-0 duration-500" style={{ animationDelay: `${i * 150}ms` }}>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-6 h-6 rounded-md bg-muted animate-pulse" />
                  <div className="h-4 bg-muted animate-pulse rounded-md" style={{ width: `${120 + i * 30}px` }} />
                  <div className="h-5 w-12 bg-muted animate-pulse rounded-full" />
                  <div className="ml-auto flex items-center gap-1">
                    <div className="h-4 w-10 bg-muted animate-pulse rounded-md" />
                    <div className="h-4 w-14 bg-muted animate-pulse rounded-md" />
                  </div>
                </div>
                <div className="flex gap-[3px]">
                  {Array.from({ length: 24 }).map((_, j) => (
                    <div
                      key={j}
                      className={cn(
                        "flex-1 h-5 bg-muted animate-pulse",
                        j === 0 ? "rounded-l-md rounded-r-sm" :
                          j === 23 ? "rounded-r-md rounded-l-sm" : "rounded-sm"
                      )}
                      style={{ animationDelay: `${(i * 150) + (j * 20)}ms` }}
                    />
                  ))}
                </div>
                <div className="flex justify-between mt-1.5">
                  <div className="h-3 w-10 bg-muted animate-pulse rounded" />
                  <div className="h-3 w-10 bg-muted animate-pulse rounded" />
                  <div className="h-3 w-8 bg-muted animate-pulse rounded" />
                </div>
              </div>
            </Card>
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
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-gray-200 dark:bg-gray-700" />
              <span>无请求</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

interface ModelStatusCardProps {
  model: ModelStatus
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
}

// Sortable wrapper for ModelStatusCard
function SortableModelCard({ model }: { model: ModelStatus }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: model.model_name })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 'auto',
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <ModelStatusCard
        model={model}
        dragHandleProps={listeners}
      />
    </div>
  )
}

// Embed Help Modal Component
function EmbedHelpModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null)

  // Get current origin for embed URL
  const currentOrigin = window.location.origin
  const embedPath = '/embed.html'
  const embedUrl = `${currentOrigin}${embedPath}`

  // Check if using IP address (recommend using domain with HTTPS)
  const isIpAddress = /^https?:\/\/(\d{1,3}\.){3}\d{1,3}/.test(currentOrigin)
  const isHttps = currentOrigin.startsWith('https://')

  const codeExamples = {
    basic: `<iframe 
  src="${embedUrl}" 
  width="100%" 
  height="600" 
  frameborder="0"
  style="border-radius: 8px;"
></iframe>`,
    responsive: `<div style="position: relative; width: 100%; padding-bottom: 56.25%;">
  <iframe 
    src="${embedUrl}" 
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; border-radius: 8px;"
  ></iframe>
</div>`,
    fullpage: `<!DOCTYPE html>
<html>
<head>
  <title>模型状态监控</title>
  <style>
    body { margin: 0; padding: 0; }
    iframe { width: 100vw; height: 100vh; border: none; }
  </style>
</head>
<body>
  <iframe src="${embedUrl}"></iframe>
</body>
</html>`,
  }

  const copyToClipboard = async (code: string, key: string) => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code)
      } else {
        // Fallback for HTTP or older browsers
        const textArea = document.createElement('textarea')
        textArea.value = code
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        textArea.style.top = '-999999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background border rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">使用 iframe 嵌入模型状态监控</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6 overflow-y-auto max-h-[calc(90vh-120px)]">
          {/* Security Warning for IP/HTTP */}
          {(isIpAddress || !isHttps) && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <h3 className="text-sm font-medium text-amber-600 dark:text-amber-400 mb-2">⚠️ 安全建议</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                {isIpAddress && (
                  <li>• 当前使用 IP 地址访问，建议配置域名以获得更好的兼容性</li>
                )}
                {!isHttps && (
                  <li>• 当前使用 HTTP 协议，<strong>强烈建议</strong>使用 HTTPS 以确保数据安全</li>
                )}
                <li>• 示例：<code className="bg-muted px-1 rounded">https://your-domain.com{embedPath}</code></li>
              </ul>
            </div>
          )}

          {/* Embed URL */}
          <div>
            <h3 className="text-sm font-medium mb-2">嵌入地址</h3>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted px-3 py-2 rounded text-sm break-all">
                {embedUrl}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(embedUrl, 'url')}
              >
                {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Features */}
          <div>
            <h3 className="text-sm font-medium mb-2">功能特点</h3>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>无需登录即可访问（公开嵌入模式）</li>
              <li>支持多种主题风格（在主界面选择后自动同步）</li>
              <li>自动刷新数据，实时监控模型状态</li>
              <li>响应式设计，适配各种屏幕尺寸</li>
            </ul>
          </div>

          {/* Basic Example */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">基础嵌入</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(codeExamples.basic, 'basic')}
              >
                {copied === 'basic' ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                复制
              </Button>
            </div>
            <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
              <code>{codeExamples.basic}</code>
            </pre>
          </div>

          {/* Responsive Example */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">响应式嵌入（16:9 比例）</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(codeExamples.responsive, 'responsive')}
              >
                {copied === 'responsive' ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                复制
              </Button>
            </div>
            <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
              <code>{codeExamples.responsive}</code>
            </pre>
          </div>

          {/* Full Page Example */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">全屏页面</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(codeExamples.fullpage, 'fullpage')}
              >
                {copied === 'fullpage' ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                复制
              </Button>
            </div>
            <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
              <code>{codeExamples.fullpage}</code>
            </pre>
          </div>

          {/* Tips */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
            <h3 className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-2">💡 提示</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• 在主界面选择的模型、主题、刷新间隔会自动同步到嵌入页面</li>
              <li>• 嵌入页面使用独立的公开 API，不需要认证</li>
              <li>• <strong>推荐使用域名 + HTTPS</strong> 方式部署，确保安全性和兼容性</li>
              <li>• 部分浏览器可能阻止 HTTP iframe 嵌入到 HTTPS 页面</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t">
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button onClick={() => window.open(`${currentOrigin}${embedPath}`, '_blank')}>
            预览嵌入页面
          </Button>
        </div>
      </div>
    </div>
  )
}

function ModelStatusCard({ model, dragHandleProps }: ModelStatusCardProps) {
  const [hoveredSlot, setHoveredSlot] = useState<SlotStatus | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })
  const [tooltipFlipped, setTooltipFlipped] = useState(false)

  const handleMouseEnter = (slot: SlotStatus, event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    // Boundary detection: flip tooltip below if too close to top
    const shouldFlip = rect.top < 100
    // Clamp X to prevent overflow at edges
    const clampedX = Math.max(120, Math.min(rect.left + rect.width / 2, viewportWidth - 120))
    setTooltipPosition({
      x: clampedX,
      y: shouldFlip ? rect.bottom + 10 : rect.top - 10,
    })
    setTooltipFlipped(shouldFlip)
    setHoveredSlot(slot)
  }

  const getTimeLabels = () => {
    switch (model.time_window) {
      case '1h': return ['60m前', '30m前', '现在']
      case '6h': return ['6h前', '3h前', '现在']
      case '12h': return ['12h前', '6h前', '现在']
      default: return ['24h前', '12h前', '现在']
    }
  }

  const timeLabels = getTimeLabels()

  // Success rate color based on status
  const rateColorClass = model.current_status === 'green' ? 'text-green-600 dark:text-green-400'
    : model.current_status === 'yellow' ? 'text-yellow-600 dark:text-yellow-400'
      : 'text-red-600 dark:text-red-400'

  // Card border/bg classes based on status
  const cardStatusClass = model.current_status === 'red'
    ? 'border-l-[3px] border-l-red-500 bg-red-500/[0.03]'
    : model.current_status === 'yellow'
      ? 'border-l-[3px] border-l-yellow-500 bg-yellow-500/[0.03]'
      : ''

  return (
    <Card className={cn(
      "overflow-hidden transition-all duration-200 hover:shadow-lg hover:border-primary/20",
      cardStatusClass
    )}>
      <div className="px-4 pt-3 pb-3">
        {/* Header row: drag handle + logo + name + badge + stats */}
        <div className="flex items-center gap-2 mb-2.5">
          {dragHandleProps && (
            <div
              {...dragHandleProps}
              className="flex items-center justify-center w-5 h-5 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground transition-colors flex-shrink-0"
              title="拖拽排序"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </div>
          )}
          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-muted/50 flex-shrink-0">
            <ModelLogo modelName={model.model_name} size={16} />
          </div>
          <span className="text-sm font-medium truncate" title={model.model_name}>
            {model.model_name}
          </span>
          <Badge
            variant={model.current_status === 'green' ? 'success' : model.current_status === 'yellow' ? 'warning' : 'destructive'}
            className="text-[10px] px-1.5 py-0 h-5 flex-shrink-0"
          >
            {STATUS_LABELS[model.current_status]}
          </Badge>
          <div className="ml-auto text-xs text-muted-foreground flex-shrink-0 tabular-nums">
            <span className={cn("font-semibold", rateColorClass)}>{model.success_rate}%</span>
            <span className="mx-1 text-muted-foreground/40">·</span>
            <span>{model.total_requests.toLocaleString()}</span>
          </div>
        </div>

        {/* Status grid - compact with rounded ends and staggered animation */}
        <div className="relative">
          <div className="flex gap-[3px]">
            {model.slot_data.map((slot, index) => (
              <div
                key={index}
                className={cn(
                  "flex-1 h-5 cursor-pointer transition-all hover:ring-1.5 hover:ring-primary hover:ring-offset-1 hover:scale-y-110",
                  // Rounded ends for pill shape
                  index === 0 ? "rounded-l-md rounded-r-sm" :
                    index === model.slot_data.length - 1 ? "rounded-r-md rounded-l-sm" :
                      "rounded-sm",
                  slot.total_requests === 0 ? STATUS_COLORS.empty : STATUS_COLORS[slot.status],
                  "animate-in fade-in-0 duration-300"
                )}
                style={{ animationDelay: `${index * 15}ms` }}
                onMouseEnter={(e) => handleMouseEnter(slot, e)}
                onMouseLeave={() => setHoveredSlot(null)}
              />
            ))}
          </div>

          {/* Time labels */}
          <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground/60">
            <span>{timeLabels[0]}</span>
            <span>{timeLabels[1]}</span>
            <span>{timeLabels[2]}</span>
          </div>

          {/* Tooltip with boundary detection and entrance animation */}
          {hoveredSlot && (
            <div
              className="fixed z-[9999] bg-popover border rounded-lg shadow-xl p-2.5 text-xs pointer-events-none animate-in fade-in-0 zoom-in-95 duration-150"
              style={{
                left: tooltipPosition.x,
                top: tooltipPosition.y,
                transform: tooltipFlipped ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
              }}
            >
              {/* Arrow indicator */}
              <div
                className={cn(
                  "absolute left-1/2 -translate-x-1/2 w-2 h-2 bg-popover border rotate-45",
                  tooltipFlipped
                    ? "-top-1 border-b-0 border-r-0"
                    : "-bottom-1 border-t-0 border-l-0"
                )}
              />
              <div className="font-medium mb-1.5">
                {formatDateTime(hoveredSlot.start_time)} - {formatTime(hoveredSlot.end_time)}
              </div>
              <div className="space-y-0.5 text-muted-foreground">
                <div className="flex justify-between gap-4">
                  <span>请求:</span>
                  <span className="font-medium text-foreground">{hoveredSlot.total_requests}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>成功:</span>
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
      </div>
    </Card>
  )
}

export default ModelStatusMonitor

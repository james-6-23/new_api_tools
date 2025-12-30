import { useState, useEffect, useCallback } from 'react'
import { cn } from '../lib/utils'
import { Loader2, Timer, Activity, Zap, Sun, Moon, Minimize2, Terminal, Leaf, Droplets } from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

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

type ThemeId = 'obsidian' | 'daylight' | 'minimal' | 'neon' | 'forest' | 'ocean' | 'terminal'

interface ThemeConfig {
  id: ThemeId
  name: string
  nameEn: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}

// ============================================================================
// Theme Definitions
// ============================================================================

export const THEMES: ThemeConfig[] = [
  { id: 'daylight', name: '日光', nameEn: 'Daylight', icon: Sun, description: '明亮清新的浅色主题' },
  { id: 'obsidian', name: '黑曜石', nameEn: 'Obsidian', icon: Moon, description: '经典深色主题，专业稳重' },
  { id: 'minimal', name: '极简', nameEn: 'Minimal', icon: Minimize2, description: '极度精简，适合嵌入' },
  { id: 'neon', name: '霓虹', nameEn: 'Neon', icon: Zap, description: '赛博朋克，科技感十足' },
  { id: 'forest', name: '森林', nameEn: 'Forest', icon: Leaf, description: '深邃自然的森林色调' },
  { id: 'ocean', name: '海洋', nameEn: 'Ocean', icon: Droplets, description: '宁静深邃的海洋蓝' },
  { id: 'terminal', name: '终端', nameEn: 'Terminal', icon: Terminal, description: '复古极客风格' },
]

// Theme-specific styles
const themeStyles: Record<ThemeId, {
  // Container
  container: string
  background?: string
  // Header
  headerTitle: string
  headerSubtitle: string
  countdownBox: string
  countdownText: string
  countdownLabel: string
  // Card
  card: string
  cardHover: string
  modelName: string
  statsText: string
  statsValue: string
  // Status colors
  statusGreen: string
  statusYellow: string
  statusRed: string
  statusEmpty: string  // No requests - neutral color
  statusHover: string
  // Badge
  badgeGreen: string
  badgeYellow: string
  badgeRed: string
  // Timeline
  timeLabel: string
  // Tooltip
  tooltip: string
  tooltipTitle: string
  tooltipLabel: string
  tooltipValue: string
  // Legend
  legendText: string
  legendDot: string
  // Empty state
  emptyText: string
  // Loader
  loader: string
}> = {
  // ========== OBSIDIAN (Default Dark Theme) ==========
  obsidian: {
    container: 'min-h-screen bg-[#0d1117] text-gray-100 p-6',
    headerTitle: 'text-2xl font-bold text-white tracking-tight',
    headerSubtitle: 'text-sm text-gray-500 mt-1.5',
    countdownBox: 'flex items-center gap-2 px-4 py-2.5 text-sm bg-[#161b22] border border-gray-800 rounded-xl',
    countdownText: 'text-blue-400 font-mono font-semibold',
    countdownLabel: 'text-gray-500',
    card: 'bg-[#161b22] border border-gray-800/80 rounded-xl p-5 transition-all duration-300',
    cardHover: 'hover:border-gray-700 hover:bg-[#1c2129]',
    modelName: 'font-semibold text-white truncate max-w-md',
    statsText: 'text-sm text-gray-400',
    statsValue: 'text-white font-semibold',
    statusGreen: 'bg-emerald-500',
    statusYellow: 'bg-amber-500',
    statusRed: 'bg-rose-500',
    statusEmpty: 'bg-gray-700',  // No requests
    statusHover: 'hover:ring-2 hover:ring-white/30 hover:scale-y-110 origin-bottom',
    badgeGreen: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    badgeYellow: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    badgeRed: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
    timeLabel: 'text-xs text-gray-600 font-mono',
    tooltip: 'bg-[#1c2128] border border-gray-700 rounded-xl shadow-2xl p-4 z-[9999]',
    tooltipTitle: 'font-semibold text-white mb-3 pb-2 border-b border-gray-700/50',
    tooltipLabel: 'text-gray-400',
    tooltipValue: 'text-white font-medium',
    legendText: 'text-xs text-gray-500',
    legendDot: 'w-3 h-3 rounded',
    emptyText: 'text-gray-500',
    loader: 'text-gray-500',
  },

  // ========== DAYLIGHT (Light Theme) ==========
  daylight: {
    container: 'min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900 p-6',
    headerTitle: 'text-2xl font-bold text-slate-800 tracking-tight',
    headerSubtitle: 'text-sm text-slate-500 mt-1.5',
    countdownBox: 'flex items-center gap-2 px-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl shadow-sm',
    countdownText: 'text-blue-600 font-mono font-semibold',
    countdownLabel: 'text-slate-400',
    card: 'bg-white border border-slate-200 rounded-xl p-5 shadow-sm transition-all duration-300',
    cardHover: 'hover:shadow-md hover:border-slate-300',
    modelName: 'font-semibold text-slate-800 truncate max-w-md',
    statsText: 'text-sm text-slate-500',
    statsValue: 'text-slate-800 font-semibold',
    statusGreen: 'bg-emerald-500',
    statusYellow: 'bg-amber-500',
    statusRed: 'bg-rose-500',
    statusEmpty: 'bg-slate-300',  // No requests
    statusHover: 'hover:ring-2 hover:ring-slate-400/50 hover:scale-y-110 origin-bottom',
    badgeGreen: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    badgeYellow: 'bg-amber-100 text-amber-700 border border-amber-200',
    badgeRed: 'bg-rose-100 text-rose-700 border border-rose-200',
    timeLabel: 'text-xs text-slate-400 font-mono',
    tooltip: 'bg-white border border-slate-200 rounded-xl shadow-xl p-4 z-[9999]',
    tooltipTitle: 'font-semibold text-slate-800 mb-3 pb-2 border-b border-slate-100',
    tooltipLabel: 'text-slate-500',
    tooltipValue: 'text-slate-800 font-medium',
    legendText: 'text-xs text-slate-500',
    legendDot: 'w-3 h-3 rounded shadow-sm',
    emptyText: 'text-slate-400',
    loader: 'text-slate-400',
  },

  // ========== MINIMAL (Ultra Simple Theme) ==========
  minimal: {
    container: 'min-h-screen bg-white text-gray-900 p-4',
    headerTitle: 'text-lg font-medium text-gray-900',
    headerSubtitle: 'text-xs text-gray-400 mt-0.5',
    countdownBox: 'flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400',
    countdownText: 'text-gray-600 font-mono',
    countdownLabel: 'text-gray-400',
    card: 'border-b border-gray-100 py-3 transition-colors',
    cardHover: 'hover:bg-gray-50',
    modelName: 'font-medium text-gray-800 truncate max-w-md text-sm',
    statsText: 'text-xs text-gray-400',
    statsValue: 'text-gray-700 font-medium',
    statusGreen: 'bg-gray-900',
    statusYellow: 'bg-gray-400',
    statusRed: 'bg-gray-200',
    statusEmpty: 'bg-gray-100',  // No requests
    statusHover: 'hover:opacity-70',
    badgeGreen: 'text-[10px] text-gray-500 font-normal',
    badgeYellow: 'text-[10px] text-gray-400 font-normal',
    badgeRed: 'text-[10px] text-gray-300 font-normal',
    timeLabel: 'text-[10px] text-gray-300',
    tooltip: 'bg-gray-900 text-white rounded-lg shadow-lg p-3 z-[9999]',
    tooltipTitle: 'font-medium text-white text-xs mb-2',
    tooltipLabel: 'text-gray-400 text-xs',
    tooltipValue: 'text-white text-xs',
    legendText: 'text-[10px] text-gray-400',
    legendDot: 'w-2 h-2 rounded-sm',
    emptyText: 'text-gray-300 text-sm',
    loader: 'text-gray-300',
  },

  // ========== NEON (Cyberpunk Theme) ==========
  neon: {
    container: 'min-h-screen bg-black text-white p-6 relative',
    background: `
      background:
        radial-gradient(ellipse at 20% 80%, rgba(236, 72, 153, 0.15) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 20%, rgba(34, 211, 238, 0.15) 0%, transparent 50%),
        radial-gradient(ellipse at 50% 50%, rgba(168, 85, 247, 0.1) 0%, transparent 70%),
        linear-gradient(180deg, #0a0a0a 0%, #000 100%);
    `,
    headerTitle: 'text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 tracking-tight uppercase',
    headerSubtitle: 'text-sm text-gray-500 mt-1.5 font-mono',
    countdownBox: 'flex items-center gap-2 px-4 py-2.5 text-sm bg-black/50 border border-cyan-500/50 rounded-lg shadow-[0_0_15px_rgba(34,211,238,0.3)]',
    countdownText: 'text-cyan-400 font-mono font-bold animate-pulse',
    countdownLabel: 'text-gray-500 font-mono',
    card: 'bg-black/40 border border-purple-500/30 rounded-lg p-5 transition-all duration-300 relative overflow-hidden',
    cardHover: 'hover:border-pink-500/50 hover:shadow-[0_0_30px_rgba(236,72,153,0.2)]',
    modelName: 'font-bold text-white truncate max-w-md tracking-wide',
    statsText: 'text-sm text-gray-500 font-mono',
    statsValue: 'text-cyan-400 font-bold font-mono',
    statusGreen: 'bg-gradient-to-t from-emerald-600 to-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.5)]',
    statusYellow: 'bg-gradient-to-t from-yellow-600 to-yellow-400 shadow-[0_0_10px_rgba(234,179,8,0.5)]',
    statusRed: 'bg-gradient-to-t from-pink-600 to-pink-400 shadow-[0_0_10px_rgba(236,72,153,0.5)]',
    statusEmpty: 'bg-gray-800',  // No requests
    statusHover: 'hover:shadow-[0_0_20px_currentColor] hover:scale-y-150 origin-bottom',
    badgeGreen: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.3)]',
    badgeYellow: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.3)]',
    badgeRed: 'bg-pink-500/20 text-pink-400 border border-pink-500/50 shadow-[0_0_10px_rgba(236,72,153,0.3)]',
    timeLabel: 'text-xs text-gray-600 font-mono uppercase tracking-wider',
    tooltip: 'bg-black/90 border border-purple-500/50 rounded-lg shadow-[0_0_30px_rgba(168,85,247,0.3)] p-4 backdrop-blur z-[9999]',
    tooltipTitle: 'font-bold text-cyan-400 mb-3 pb-2 border-b border-purple-500/30 font-mono',
    tooltipLabel: 'text-gray-500 font-mono text-xs uppercase',
    tooltipValue: 'text-white font-mono',
    legendText: 'text-xs text-gray-600 font-mono uppercase tracking-wider',
    legendDot: 'w-3 h-3 rounded shadow-[0_0_8px_currentColor]',
    emptyText: 'text-gray-600 font-mono',
    loader: 'text-purple-500',
  },

  // ========== FOREST (Nature Theme) ==========
  forest: {
    container: 'min-h-screen bg-[#022c22] text-emerald-50 p-6',
    headerTitle: 'text-2xl font-bold text-emerald-100 tracking-tight',
    headerSubtitle: 'text-sm text-emerald-400/60 mt-1.5',
    countdownBox: 'flex items-center gap-2 px-4 py-2.5 text-sm bg-[#064e3b]/30 border border-[#065f46] rounded-xl',
    countdownText: 'text-emerald-300 font-mono font-semibold',
    countdownLabel: 'text-emerald-400/60',
    card: 'bg-[#064e3b]/20 border border-[#065f46]/50 rounded-xl p-5 transition-all duration-300',
    cardHover: 'hover:border-[#10b981]/30 hover:bg-[#064e3b]/30',
    modelName: 'font-semibold text-emerald-50 truncate max-w-md',
    statsText: 'text-sm text-emerald-400/60',
    statsValue: 'text-emerald-100 font-semibold',
    statusGreen: 'bg-emerald-500',
    statusYellow: 'bg-yellow-500',
    statusRed: 'bg-red-500',
    statusEmpty: 'bg-emerald-900/30',
    statusHover: 'hover:shadow-[0_0_15px_rgba(16,185,129,0.4)] hover:scale-y-125 origin-bottom',
    badgeGreen: 'bg-emerald-900/50 text-emerald-300 border border-emerald-700/50',
    badgeYellow: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50',
    badgeRed: 'bg-red-900/50 text-red-300 border border-red-700/50',
    timeLabel: 'text-xs text-emerald-400/40 font-mono',
    tooltip: 'bg-[#022c22]/95 backdrop-blur-xl border border-[#065f46] rounded-xl shadow-[0_0_30px_rgba(6,95,70,0.6)] p-4 z-[9999]',
    tooltipTitle: 'font-semibold text-emerald-100 mb-3 pb-2 border-b border-[#065f46]',
    tooltipLabel: 'text-emerald-400/60',
    tooltipValue: 'text-emerald-100 font-medium',
    legendText: 'text-xs text-emerald-400/60',
    legendDot: 'w-3 h-3 rounded',
    emptyText: 'text-emerald-400/40',
    loader: 'text-emerald-500',
  },

  // ========== OCEAN (Blue Theme) ==========
  ocean: {
    container: 'min-h-screen bg-[#0b1121] text-blue-50 p-6',
    headerTitle: 'text-2xl font-bold text-blue-100 tracking-tight',
    headerSubtitle: 'text-sm text-blue-400/60 mt-1.5',
    countdownBox: 'flex items-center gap-2 px-4 py-2.5 text-sm bg-blue-900/20 border border-blue-800/50 rounded-xl',
    countdownText: 'text-cyan-300 font-mono font-semibold',
    countdownLabel: 'text-blue-400/60',
    card: 'bg-blue-900/10 border border-blue-700/30 rounded-xl p-5 transition-all duration-300',
    cardHover: 'hover:border-blue-500/30 hover:bg-blue-900/20',
    modelName: 'font-semibold text-blue-50 truncate max-w-md',
    statsText: 'text-sm text-blue-400/60',
    statsValue: 'text-blue-100 font-semibold',
    statusGreen: 'bg-cyan-500',
    statusYellow: 'bg-amber-500',
    statusRed: 'bg-rose-500',
    statusEmpty: 'bg-blue-900/30',
    statusHover: 'hover:shadow-[0_0_15px_rgba(6,182,212,0.4)] hover:scale-y-125 origin-bottom',
    badgeGreen: 'bg-cyan-900/30 text-cyan-300 border border-cyan-700/30',
    badgeYellow: 'bg-amber-900/30 text-amber-300 border border-amber-700/30',
    badgeRed: 'bg-rose-900/30 text-rose-300 border border-rose-700/30',
    timeLabel: 'text-xs text-blue-400/40 font-mono',
    tooltip: 'bg-[#0b1121]/95 backdrop-blur-xl border border-blue-700/50 rounded-xl shadow-[0_0_30px_rgba(30,58,138,0.6)] p-4 z-[9999]',
    tooltipTitle: 'font-semibold text-blue-100 mb-3 pb-2 border-b border-blue-800/50',
    tooltipLabel: 'text-blue-400/60',
    tooltipValue: 'text-blue-100 font-medium',
    legendText: 'text-xs text-blue-400/60',
    legendDot: 'w-3 h-3 rounded',
    emptyText: 'text-blue-400/40',
    loader: 'text-cyan-500',
  },

  // ========== TERMINAL (Retro Theme) ==========
  terminal: {
    container: 'min-h-screen bg-black text-green-500 p-6 font-mono',
    headerTitle: 'text-2xl font-bold text-green-500 tracking-tight uppercase border-b-2 border-green-500/50 pb-2 inline-block',
    headerSubtitle: 'text-sm text-green-500/60 mt-2',
    countdownBox: 'flex items-center gap-2 px-4 py-2 text-sm bg-black border border-green-500/50 rounded-none',
    countdownText: 'text-green-400 font-bold',
    countdownLabel: 'text-green-500/60',
    card: 'bg-black border border-green-900 p-5 transition-all duration-300 hover:border-green-500',
    cardHover: 'hover:shadow-[0_0_10px_rgba(34,197,94,0.2)]',
    modelName: 'font-bold text-green-500 truncate max-w-md',
    statsText: 'text-sm text-green-500/60',
    statsValue: 'text-green-500 font-bold',
    statusGreen: 'bg-green-600',
    statusYellow: 'bg-yellow-600',
    statusRed: 'bg-red-600',
    statusEmpty: 'bg-green-900/30',
    statusHover: 'hover:shadow-[0_0_15px_rgba(34,197,94,0.6)] hover:scale-y-125 origin-bottom',
    badgeGreen: 'bg-black text-green-500 border border-green-500 text-xs px-2 py-0.5',
    badgeYellow: 'bg-black text-yellow-500 border border-yellow-500 text-xs px-2 py-0.5',
    badgeRed: 'bg-black text-red-500 border border-red-500 text-xs px-2 py-0.5',
    timeLabel: 'text-xs text-green-500/40',
    tooltip: 'bg-black border border-green-500 shadow-[0_0_20px_rgba(34,197,94,0.4)] p-3 max-w-xs z-[9999]',
    tooltipTitle: 'font-bold text-green-500 mb-2 border-b border-green-900 pb-1',
    tooltipLabel: 'text-green-500/60',
    tooltipValue: 'text-green-500',
    legendText: 'text-xs text-green-500/60',
    legendDot: 'w-2 h-2 rounded-none',
    emptyText: 'text-green-500/40',
    loader: 'text-green-500',
  },
}

// Status labels
const STATUS_LABELS = {
  green: '正常',
  yellow: '警告',
  red: '异常',
}

// Time window options
const TIME_WINDOWS = [
  { value: '1h', label: '1小时' },
  { value: '6h', label: '6小时' },
  { value: '12h', label: '12小时' },
  { value: '24h', label: '24小时' },
]

// ============================================================================
// Utility Functions
// ============================================================================

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

function getStatusColor(status: 'green' | 'yellow' | 'red', styles: typeof themeStyles.obsidian) {
  return status === 'green' ? styles.statusGreen :
         status === 'yellow' ? styles.statusYellow : styles.statusRed
}

function getBadgeColor(status: 'green' | 'yellow' | 'red', styles: typeof themeStyles.obsidian) {
  return status === 'green' ? styles.badgeGreen :
         status === 'yellow' ? styles.badgeYellow : styles.badgeRed
}

// ============================================================================
// Main Component
// ============================================================================

interface ModelStatusEmbedProps {
  refreshInterval?: number
  defaultTheme?: ThemeId
}

export function ModelStatusEmbed({
  refreshInterval: defaultRefreshInterval = 60,
  defaultTheme,
}: ModelStatusEmbedProps) {
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [modelStatuses, setModelStatuses] = useState<ModelStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [refreshInterval, setRefreshInterval] = useState(defaultRefreshInterval)
  const [countdown, setCountdown] = useState(defaultRefreshInterval)
  const [timeWindow, setTimeWindow] = useState('24h')
  const [theme, setTheme] = useState<ThemeId>(defaultTheme || 'daylight')

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const styles = themeStyles[theme]

  // Parse URL params for theme override
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const urlTheme = urlParams.get('theme') as ThemeId
    if (urlTheme && THEMES.find(t => t.id === urlTheme)) {
      setTheme(urlTheme)
    }
  }, [])

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
        // Load refresh interval from backend
        if (data.refresh_interval !== undefined && data.refresh_interval !== null) {
          setRefreshInterval(data.refresh_interval)
          setCountdown(data.refresh_interval)
        }
        // Load theme from backend if not overridden by URL
        const urlParams = new URLSearchParams(window.location.search)
        if (!urlParams.get('theme') && data.theme) {
          setTheme(data.theme)
        }
        return data.data || []
      }
    } catch (error) {
      console.error('Failed to load config from backend:', error)
    }
    return []
  }, [apiUrl])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // Fetch model statuses
  // Embed page always uses cache to reduce database load
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

  useEffect(() => {
    if (selectedModels.length > 0) {
      fetchModelStatuses()
    }
  }, [fetchModelStatuses, selectedModels])

  // Auto refresh with visibility change handling
  // When page is in background, browser throttles setInterval
  // So we refresh immediately when page becomes visible again
  useEffect(() => {
    if (refreshInterval <= 0) return

    let lastRefreshTime = Date.now()

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          fetchModelStatuses()
          lastRefreshTime = Date.now()
          return refreshInterval
        }
        return prev - 1
      })
    }, 1000)

    // Handle page visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Math.floor((Date.now() - lastRefreshTime) / 1000)
        if (elapsed >= refreshInterval) {
          // Enough time has passed, refresh immediately
          fetchModelStatuses()
          lastRefreshTime = Date.now()
          setCountdown(refreshInterval)
        } else {
          // Update countdown to reflect actual remaining time
          setCountdown(Math.max(1, refreshInterval - elapsed))
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshInterval, fetchModelStatuses])

  // Loading state
  if (loading && modelStatuses.length === 0) {
    return (
      <div
        className={cn("min-h-screen flex items-center justify-center", styles.container)}
        style={styles.background ? { background: styles.background.replace(/\s+/g, ' ') } : undefined}
      >
        <Loader2 className={cn("h-8 w-8 animate-spin", styles.loader)} />
      </div>
    )
  }

  return (
    <div
      className={styles.container}
      style={styles.background ? { background: styles.background.replace(/\s+/g, ' ') } : undefined}
    >
      {/* Neon theme scan line effect */}
      {theme === 'neon' && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px]" />
        </div>
      )}

      <div className="relative max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              {theme !== 'minimal' && <Activity className="h-5 w-5 opacity-60" />}
              <h1 className={styles.headerTitle}>
                {theme === 'minimal' ? 'Status' : '模型状态监控'}
              </h1>
            </div>
            <p className={styles.headerSubtitle}>
              {TIME_WINDOWS.find(w => w.value === timeWindow)?.label || '24小时'}
              {theme !== 'minimal' && ' 滑动窗口'} · {selectedModels.length} {theme === 'minimal' ? 'models' : '个模型'}
              {lastUpdate && theme !== 'minimal' && (
                <span className="ml-2">· 更新于 {lastUpdate.toLocaleTimeString('zh-CN')}</span>
              )}
            </p>
          </div>

          {/* Countdown */}
          {refreshInterval > 0 && (
            <div className={styles.countdownBox}>
              <Timer className="h-4 w-4 opacity-60" />
              <span className={styles.countdownText}>{formatCountdown(countdown)}</span>
              {theme !== 'minimal' && <span className={styles.countdownLabel}>后刷新</span>}
            </div>
          )}
        </div>

        {/* Model Status Cards */}
        {modelStatuses.length > 0 ? (
          <div className={theme === 'minimal' ? 'divide-y divide-gray-100' : 'space-y-4'}>
            {modelStatuses.map(model => (
              <EmbedModelCard
                key={model.model_name}
                model={model}
                theme={theme}
                styles={styles}
              />
            ))}
          </div>
        ) : (
          <div className={cn("text-center py-16", styles.emptyText)}>
            {selectedModels.length === 0 ? '请在管理界面选择要监控的模型' : '暂无模型状态数据'}
          </div>
        )}

        {/* Legend */}
        <div className={cn(
          "mt-8 flex items-center justify-center gap-6",
          theme === 'minimal' && 'mt-4 gap-4'
        )}>
          {['green', 'yellow', 'red'].map((status) => (
            <div key={status} className="flex items-center gap-2">
              <span className={cn(
                styles.legendDot,
                status === 'green' ? styles.statusGreen :
                status === 'yellow' ? styles.statusYellow : styles.statusRed
              )} />
              <span className={styles.legendText}>
                {theme === 'minimal'
                  ? (status === 'green' ? '≥95%' : status === 'yellow' ? '80-95%' : '<80%')
                  : (status === 'green' ? '成功率 ≥ 95%' : status === 'yellow' ? '成功率 80-95%' : '成功率 < 80%')
                }
              </span>
            </div>
          ))}
          {/* No requests indicator */}
          <div className="flex items-center gap-2">
            <span className={cn(styles.legendDot, styles.statusEmpty)} />
            <span className={styles.legendText}>
              {theme === 'minimal' ? 'No req' : '无请求'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Model Card Component
// ============================================================================

interface EmbedModelCardProps {
  model: ModelStatus
  theme: ThemeId
  styles: typeof themeStyles.obsidian
}

function EmbedModelCard({ model, theme, styles }: EmbedModelCardProps) {
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
  const isMinimal = theme === 'minimal'

  return (
    <div className={cn(styles.card, styles.cardHover)}>
      {/* Neon theme glow line */}
      {theme === 'neon' && (
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-purple-500 to-transparent" />
      )}

      {/* Header */}
      <div className={cn(
        "flex items-center justify-between",
        isMinimal ? 'mb-2' : 'mb-4'
      )}>
        <div className="flex items-center gap-3 min-w-0">
          <h3 className={styles.modelName} title={model.model_name}>
            {model.model_name}
          </h3>
          {!isMinimal && (
            <span className={cn(
              "px-2 py-0.5 text-xs rounded-full font-medium",
              getBadgeColor(model.current_status, styles)
            )}>
              {STATUS_LABELS[model.current_status]}
            </span>
          )}
          {isMinimal && (
            <span className={getBadgeColor(model.current_status, styles)}>
              {model.current_status === 'green' ? '●' : model.current_status === 'yellow' ? '◐' : '○'}
            </span>
          )}
        </div>
        <div className={styles.statsText}>
          <span className={styles.statsValue}>{model.success_rate}%</span>
          {!isMinimal && ' 成功率'}
          <span className={isMinimal ? 'mx-1' : 'mx-2 opacity-30'}>·</span>
          <span>{model.total_requests.toLocaleString()}</span>
          {!isMinimal && ' 请求'}
        </div>
      </div>

      {/* Status Timeline */}
      <div className="relative">
        <div className={cn(
          "flex",
          isMinimal ? 'gap-px h-4' : 'gap-0.5 h-7'
        )}>
          {model.slot_data.map((slot, index) => (
            <div
              key={index}
              className={cn(
                "flex-1 rounded-sm cursor-pointer transition-all duration-200",
                slot.total_requests === 0 ? styles.statusEmpty : getStatusColor(slot.status, styles),
                styles.statusHover
              )}
              onMouseEnter={(e) => handleMouseEnter(slot, e)}
              onMouseLeave={() => setHoveredSlot(null)}
            />
          ))}
        </div>

        {/* Time labels */}
        <div className={cn(
          "flex justify-between mt-2",
          styles.timeLabel
        )}>
          <span>{isMinimal ? timeLabels[0].replace('分钟前', 'm').replace('小时前', 'h') : timeLabels[0]}</span>
          <span>{isMinimal ? timeLabels[1].replace('分钟前', 'm').replace('小时前', 'h') : timeLabels[1]}</span>
          <span>{isMinimal ? 'now' : timeLabels[2]}</span>
        </div>

        {/* Tooltip */}
        {hoveredSlot && (
          <div
            className={cn("fixed z-50 pointer-events-none text-sm", styles.tooltip)}
            style={{
              left: tooltipPosition.x,
              top: tooltipPosition.y,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className={styles.tooltipTitle}>
              {formatDateTime(hoveredSlot.start_time)} - {formatTime(hoveredSlot.end_time)}
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between gap-6">
                <span className={styles.tooltipLabel}>总请求</span>
                <span className={styles.tooltipValue}>{hoveredSlot.total_requests}</span>
              </div>
              <div className="flex justify-between gap-6">
                <span className={styles.tooltipLabel}>成功数</span>
                <span className={cn(styles.tooltipValue, 'text-emerald-400')}>{hoveredSlot.success_count}</span>
              </div>
              <div className="flex justify-between gap-6">
                <span className={styles.tooltipLabel}>成功率</span>
                <span className={cn(
                  styles.tooltipValue,
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

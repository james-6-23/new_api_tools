import { useState, useEffect, useCallback, useMemo } from 'react'
import { cn } from '../lib/utils'
import { Loader2, Timer, Activity, Zap, Sun, Moon, Minimize2, Terminal, Leaf, Droplets, Command, LayoutGrid, Bot, MessageSquareQuote, Triangle, Sparkles, CreditCard, GitBranch, Gamepad2, Rocket, Brain } from 'lucide-react'
import {
  OpenAI, Gemini, DeepSeek, SiliconCloud, Groq, Ollama, Claude, Mistral,
  Minimax, Baichuan, Moonshot, Spark, Qwen, Yi, Hunyuan, Stepfun, ZeroOne,
  Zhipu, ChatGLM, Cohere, Perplexity, Together, OpenRouter, Fireworks,
  Ai360, Doubao, Wenxin, Meta, Coze, Cerebras, Kimi, NewAPI, ZAI, ModelScope
} from '@lobehub/icons'

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

type ThemeId = 'obsidian' | 'daylight' | 'minimal' | 'neon' | 'forest' | 'ocean' | 'terminal' | 'cupertino' | 'material' | 'openai' | 'anthropic' | 'vercel' | 'linear' | 'stripe' | 'github' | 'discord' | 'tesla'

interface ThemeConfig {
  id: ThemeId
  name: string
  nameEn: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}

// ============================================================================
// Model Logo Mapping
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconComponent = React.ComponentType<any>

const MODEL_LOGO_MAP: Record<string, IconComponent> = {
  // OpenAI models
  'gpt': OpenAI, 'openai': OpenAI, 'o1': OpenAI, 'o3': OpenAI, 'chatgpt': OpenAI,
  'dall-e': OpenAI, 'whisper': OpenAI, 'tts': OpenAI,
  // Google models
  'gemini': Gemini, 'gemma': Gemini, 'palm': Gemini, 'bard': Gemini,
  // Anthropic models
  'claude': Claude, 'anthropic': Claude,
  // DeepSeek models
  'deepseek': DeepSeek,
  // Meta models
  'llama': Meta, 'meta': Meta,
  // Mistral models
  'mistral': Mistral, 'mixtral': Mistral, 'codestral': Mistral, 'pixtral': Mistral,
  // Chinese models
  'qwen': Qwen, 'tongyi': Qwen, 'yi': Yi, '01-ai': Yi, 'baichuan': Baichuan,
  'glm': ChatGLM, 'chatglm': ChatGLM, 'zhipu': Zhipu, 'moonshot': Moonshot, 'kimi': Kimi,
  'spark': Spark, 'xunfei': Spark, 'hunyuan': Hunyuan, 'tencent': Hunyuan,
  'doubao': Doubao, 'bytedance': Doubao, 'wenxin': Wenxin, 'ernie': Wenxin, 'baidu': Wenxin,
  'minimax': Minimax, 'abab': Minimax, 'stepfun': Stepfun, 'step': Stepfun,
  'zeroone': ZeroOne, '01': ZeroOne, '360': Ai360, 'modelscope': ModelScope,
  // Other providers
  'groq': Groq, 'ollama': Ollama, 'cohere': Cohere, 'command': Cohere,
  'perplexity': Perplexity, 'pplx': Perplexity, 'together': Together,
  'openrouter': OpenRouter, 'fireworks': Fireworks, 'siliconcloud': SiliconCloud,
  'silicon': SiliconCloud, 'cerebras': Cerebras, 'coze': Coze, 'newapi': NewAPI, 'zai': ZAI,
}

function getModelLogo(modelName: string): IconComponent | null {
  const lowerName = modelName.toLowerCase()
  for (const [pattern, Logo] of Object.entries(MODEL_LOGO_MAP)) {
    if (lowerName.includes(pattern)) return Logo
  }
  return null
}

interface ModelLogoProps {
  modelName: string
  size?: number
  className?: string
}

function ModelLogo({ modelName, size = 20, className }: ModelLogoProps) {
  const Logo = useMemo(() => getModelLogo(modelName), [modelName])
  if (Logo) return <Logo size={size} className={className} />
  return <Brain size={size} className={cn("text-current opacity-50", className)} />
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
  { id: 'cupertino', name: 'Apple', nameEn: 'Apple', icon: Command, description: '致敬 Apple 设计风格，通透精致' },
  { id: 'material', name: 'Google', nameEn: 'Google', icon: LayoutGrid, description: '致敬 Google Material Design' },
  { id: 'openai', name: 'OpenAI', nameEn: 'OpenAI', icon: Bot, description: '致敬 OpenAI 设计风格，理性极简' },
  { id: 'anthropic', name: 'Claude', nameEn: 'Claude', icon: MessageSquareQuote, description: '致敬 Claude 设计风格，温暖衬线' },
  { id: 'vercel', name: 'Vercel', nameEn: 'Vercel', icon: Triangle, description: 'Geist 风格，极致黑白与高对比度' },
  { id: 'linear', name: 'Linear', nameEn: 'Linear', icon: Sparkles, description: '流光风格，深色质感与细腻渐变' },
  { id: 'stripe', name: 'Stripe', nameEn: 'Stripe', icon: CreditCard, description: '现代支付美学，精致渐变与投影' },
  { id: 'github', name: 'GitHub', nameEn: 'GitHub', icon: GitBranch, description: '开发者之魂，熟悉的深色代码风格' },
  { id: 'discord', name: 'Discord', nameEn: 'Discord', icon: Gamepad2, description: '游戏社区风格，Blurple 品牌色' },
  { id: 'tesla', name: 'Tesla', nameEn: 'Tesla', icon: Rocket, description: '工业未来风，极简黑红配色' },
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

  // ========== CUPERTINO (Apple Style) ==========
  cupertino: {
    container: 'min-h-screen bg-[#f5f5f7] text-gray-900 p-6 font-sans',
    headerTitle: 'text-2xl font-semibold text-gray-900 tracking-tight',
    headerSubtitle: 'text-sm text-gray-500 mt-1.5',
    countdownBox: 'flex items-center gap-2 px-3 py-1.5 text-sm bg-white/50 backdrop-blur-md border border-gray-200/50 rounded-full shadow-sm',
    countdownText: 'text-blue-500 font-medium',
    countdownLabel: 'text-gray-400',
    card: 'bg-white rounded-2xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-all duration-300',
    cardHover: 'hover:shadow-[0_4px_20px_rgba(0,0,0,0.08)] hover:-translate-y-0.5',
    modelName: 'font-semibold text-gray-900 truncate max-w-md tracking-tight',
    statsText: 'text-sm text-gray-400',
    statsValue: 'text-gray-900 font-medium',
    statusGreen: 'bg-[#34c759]',
    statusYellow: 'bg-[#ffcc00]',
    statusRed: 'bg-[#ff3b30]',
    statusEmpty: 'bg-gray-100',
    statusHover: 'hover:opacity-80 hover:scale-y-110 origin-bottom',
    badgeGreen: 'bg-[#34c759]/10 text-[#34c759] px-2.5 py-0.5 text-xs font-medium rounded-full',
    badgeYellow: 'bg-[#ffcc00]/10 text-[#ffcc00] px-2.5 py-0.5 text-xs font-medium rounded-full',
    badgeRed: 'bg-[#ff3b30]/10 text-[#ff3b30] px-2.5 py-0.5 text-xs font-medium rounded-full',
    timeLabel: 'text-[11px] text-gray-400 font-medium uppercase tracking-wide mt-3',
    tooltip: 'bg-white/90 backdrop-blur-xl border border-gray-100 rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] p-4 z-[9999]',
    tooltipTitle: 'font-semibold text-gray-900 mb-2 pb-2 border-b border-gray-100',
    tooltipLabel: 'text-gray-500 text-xs',
    tooltipValue: 'text-gray-900 font-medium',
    legendText: 'text-xs text-gray-400 font-medium',
    legendDot: 'w-2.5 h-2.5 rounded-full',
    emptyText: 'text-gray-400',
    loader: 'text-gray-400',
  },

  // ========== MATERIAL (Google Style) ==========
  material: {
    container: 'min-h-screen bg-[#f0f4f8] text-[#1f1f1f] p-6 font-sans',
    headerTitle: 'text-3xl font-normal text-[#1f1f1f] tracking-tight',
    headerSubtitle: 'text-sm text-[#444746] mt-1.5',
    countdownBox: 'flex items-center gap-2 px-4 py-2 text-sm bg-[#e0e2ec] text-[#1f1f1f] rounded-2xl',
    countdownText: 'text-[#005cbb] font-medium',
    countdownLabel: 'text-[#444746]',
    card: 'bg-[#fdfcff] rounded-[20px] p-5 shadow-sm transition-all duration-300',
    cardHover: 'hover:shadow-md hover:bg-[#f8faff]',
    modelName: 'font-medium text-[#1f1f1f] truncate max-w-md text-lg',
    statsText: 'text-sm text-[#444746]',
    statsValue: 'text-[#1f1f1f] font-medium',
    statusGreen: 'bg-[#1e8e3e]',
    statusYellow: 'bg-[#f9ab00]',
    statusRed: 'bg-[#d93025]',
    statusEmpty: 'bg-[#e0e2ec]',
    statusHover: 'hover:ring-4 hover:ring-[#d3e3fd] hover:z-10 relative rounded-sm',
    badgeGreen: 'bg-[#c4eed0] text-[#072711] px-3 py-1 rounded-lg text-sm font-medium',
    badgeYellow: 'bg-[#ffe082] text-[#261900] px-3 py-1 rounded-lg text-sm font-medium',
    badgeRed: 'bg-[#f9d7e5] text-[#3e001d] px-3 py-1 rounded-lg text-sm font-medium',
    timeLabel: 'text-xs text-[#444746]',
    tooltip: 'bg-[#2f3033] text-[#f2f2f2] rounded-lg shadow-lg p-3 z-[9999]',
    tooltipTitle: 'font-medium text-[#f2f2f2] mb-2',
    tooltipLabel: 'text-[#c4c7c5] text-xs',
    tooltipValue: 'text-[#f2f2f2] font-medium',
    legendText: 'text-xs text-[#444746]',
    legendDot: 'w-3 h-3 rounded-full',
    emptyText: 'text-[#444746]',
    loader: 'text-[#005cbb]',
  },

  // ========== OPENAI (Origin Style) ==========
  openai: {
    container: 'min-h-screen bg-[#343541] text-gray-100 p-6 font-sans',
    headerTitle: 'text-2xl font-bold text-white tracking-tight',
    headerSubtitle: 'text-sm text-gray-400 mt-1.5',
    countdownBox: 'flex items-center gap-2 px-3 py-1.5 text-sm bg-[#40414f] rounded text-gray-300',
    countdownText: 'text-[#10a37f] font-medium',
    countdownLabel: 'text-gray-500',
    card: 'bg-[#444654] rounded-md p-5 transition-all duration-200 border border-transparent',
    cardHover: 'hover:border-gray-500/50',
    modelName: 'font-medium text-white truncate max-w-md',
    statsText: 'text-sm text-gray-400',
    statsValue: 'text-gray-200 font-medium',
    statusGreen: 'bg-[#10a37f]',
    statusYellow: 'bg-[#f7d070]',
    statusRed: 'bg-[#ef4444]',
    statusEmpty: 'bg-[#565869]',
    statusHover: 'hover:opacity-80',
    badgeGreen: 'text-[#10a37f] text-xs font-medium uppercase tracking-wide',
    badgeYellow: 'text-[#f7d070] text-xs font-medium uppercase tracking-wide',
    badgeRed: 'text-[#ef4444] text-xs font-medium uppercase tracking-wide',
    timeLabel: 'text-xs text-gray-500 font-medium',
    tooltip: 'bg-[#202123] border border-gray-600 rounded shadow-xl p-3 z-[9999]',
    tooltipTitle: 'font-medium text-white mb-2 text-sm',
    tooltipLabel: 'text-gray-400 text-xs',
    tooltipValue: 'text-white text-sm',
    legendText: 'text-xs text-gray-400',
    legendDot: 'w-2.5 h-2.5 rounded-sm',
    emptyText: 'text-gray-500',
    loader: 'text-gray-400',
  },

  // ========== ANTHROPIC (Human Style) ==========
  anthropic: {
    container: 'min-h-screen bg-[#f4f1ea] text-[#191919] p-6 font-sans',
    headerTitle: 'text-3xl font-serif font-medium text-[#191919] tracking-tight',
    headerSubtitle: 'text-sm text-[#6b665c] mt-1.5 font-serif',
    countdownBox: 'flex items-center gap-2 px-0 py-0 text-sm bg-transparent text-[#6b665c]',
    countdownText: 'text-[#d97757] font-serif italic',
    countdownLabel: 'text-[#6b665c] font-serif italic',
    card: 'bg-white border border-[#e6e1d6] rounded-xl p-6 shadow-sm transition-all duration-300',
    cardHover: 'hover:border-[#d97757]/30 hover:shadow-md',
    modelName: 'font-serif font-medium text-[#191919] truncate max-w-md text-xl',
    statsText: 'text-sm text-[#6b665c] font-serif',
    statsValue: 'text-[#191919] font-medium font-sans',
    statusGreen: 'bg-[#2d4f43]', // Dark Green used by Anthropic
    statusYellow: 'bg-[#e3b26c]',
    statusRed: 'bg-[#d97757]', // Terracotta
    statusEmpty: 'bg-[#e6e1d6]',
    statusHover: 'hover:scale-y-110 origin-bottom transition-transform',
    badgeGreen: 'bg-[#eef3f1] text-[#2d4f43] border border-[#d6e3de] px-2 py-0.5 text-xs font-serif rounded',
    badgeYellow: 'bg-[#fff9ed] text-[#b38641] border border-[#faecd1] px-2 py-0.5 text-xs font-serif rounded',
    badgeRed: 'bg-[#fdf3f0] text-[#d97757] border border-[#f5dcd6] px-2 py-0.5 text-xs font-serif rounded',
    timeLabel: 'text-xs text-[#9c9485] font-serif italic',
    tooltip: 'bg-white border border-[#e6e1d6] rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.08)] p-4 z-[9999]',
    tooltipTitle: 'font-serif font-medium text-[#191919] mb-2 pb-2 border-b border-[#f4f1ea]',
    tooltipLabel: 'text-[#6b665c] font-serif text-xs',
    tooltipValue: 'text-[#191919] font-sans',
    legendText: 'text-xs text-[#6b665c] font-serif',
    legendDot: 'w-2.5 h-2.5 rounded-full',
    emptyText: 'text-[#6b665c] font-serif italic',
    loader: 'text-[#d97757]',
  },

  // ========== VERCEL (Geist Style) ==========
  vercel: {
    container: 'min-h-screen bg-black text-white p-6 font-sans tracking-tight',
    background: `
      background-color: #000;
      background-image: radial-gradient(#333 1px, transparent 1px);
      background-size: 32px 32px;
    `,
    headerTitle: 'text-2xl font-bold text-white tracking-tight',
    headerSubtitle: 'text-sm text-[#888] mt-1.5 font-medium',
    countdownBox: 'flex items-center gap-2 px-3 py-1.5 text-sm bg-[#111] border border-[#333] rounded-md transition-colors hover:border-[#444]',
    countdownText: 'text-white font-mono font-medium',
    countdownLabel: 'text-[#666]',
    card: 'bg-black border border-[#333] rounded-lg p-5 transition-all duration-200 group',
    cardHover: 'hover:border-white', // Iconic Vercel hover effect
    modelName: 'font-bold text-white truncate max-w-md tracking-tight group-hover:text-white transition-colors',
    statsText: 'text-sm text-[#888] font-medium',
    statsValue: 'text-white font-bold',
    statusGreen: 'bg-[#0070f3]', // Vercel Blue
    statusYellow: 'bg-[#f5a623]',
    statusRed: 'bg-[#ff0000]',
    statusEmpty: 'bg-[#1a1a1a]',
    statusHover: 'hover:opacity-80 transition-opacity',
    badgeGreen: 'bg-[#0070f3]/10 text-[#0070f3] border border-[#0070f3]/20 px-2 py-0.5 text-xs font-semibold rounded',
    badgeYellow: 'bg-[#f5a623]/10 text-[#f5a623] border border-[#f5a623]/20 px-2 py-0.5 text-xs font-semibold rounded',
    badgeRed: 'bg-[#ff0000]/10 text-[#ff0000] border border-[#ff0000]/20 px-2 py-0.5 text-xs font-semibold rounded',
    timeLabel: 'text-[10px] text-[#666] font-mono font-medium uppercase tracking-wider',
    tooltip: 'bg-black border border-[#333] rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.1)] p-4 z-[9999]',
    tooltipTitle: 'font-bold text-white mb-2 pb-2 border-b border-[#333]',
    tooltipLabel: 'text-[#888] text-xs font-medium uppercase tracking-wider',
    tooltipValue: 'text-white font-mono',
    legendText: 'text-xs text-[#666] font-medium uppercase tracking-wider',
    legendDot: 'w-2 h-2 rounded-full',
    emptyText: 'text-[#666] font-medium',
    loader: 'text-white',
  },

  // ========== LINEAR (Streamlined Style) ==========
  linear: {
    container: 'min-h-screen bg-[#0f1015] text-[#ededee] p-6 font-sans',
    // Subtle top highlight
    background: 'background: radial-gradient(circle at 50% 0%, rgba(94,106,210,0.15), transparent 60%), #0f1015',
    headerTitle: 'text-2xl font-medium text-[#ededee] tracking-tight',
    headerSubtitle: 'text-sm text-[#8a8f98] mt-1.5',
    countdownBox: 'flex items-center gap-2 px-3 py-1.5 text-sm bg-[#1a1b21] border border-[#2e2f36] rounded-[6px] shadow-sm',
    countdownText: 'text-[#5e6ad2] font-medium',
    countdownLabel: 'text-[#8a8f98]',
    card: 'bg-[#16171d] border border-[#282930] rounded-xl p-5 transition-all duration-300 shadow-[0_2px_4px_rgba(0,0,0,0.2)]',
    cardHover: 'hover:border-[#3a3b42] hover:shadow-[0_4px_12px_rgba(0,0,0,0.3)] hover:bg-[#1a1b21]',
    modelName: 'font-medium text-[#ededee] truncate max-w-md',
    statsText: 'text-sm text-[#8a8f98]',
    statsValue: 'text-[#ededee] font-medium',
    statusGreen: 'bg-[#5e6ad2]', // Linear Purple/Blue
    statusYellow: 'bg-[#d29922]',
    statusRed: 'bg-[#df4a4a]',
    statusEmpty: 'bg-[#25262e]',
    statusHover: 'hover:brightness-125 transition-all duration-200 hover:scale-y-110 origin-bottom',
    badgeGreen: 'bg-[#5e6ad2]/10 text-[#7c86e0] border border-[#5e6ad2]/20 px-2.5 py-0.5 text-xs font-medium rounded',
    badgeYellow: 'bg-[#d29922]/10 text-[#e6b955] border border-[#d29922]/20 px-2.5 py-0.5 text-xs font-medium rounded',
    badgeRed: 'bg-[#df4a4a]/10 text-[#f57171] border border-[#df4a4a]/20 px-2.5 py-0.5 text-xs font-medium rounded',
    timeLabel: 'text-xs text-[#636873] font-medium',
    tooltip: 'bg-[#16171d] border border-[#2e2f36] rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.4)] p-3 z-[9999]',
    tooltipTitle: 'font-medium text-[#ededee] mb-2 pb-2 border-b border-[#2e2f36]',
    tooltipLabel: 'text-[#8a8f98] text-xs',
    tooltipValue: 'text-[#ededee]',
    legendText: 'text-xs text-[#8a8f98] font-medium',
    legendDot: 'w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(94,106,210,0.4)]',
    emptyText: 'text-[#8a8f98]',
    loader: 'text-[#5e6ad2]',
  },

  // ========== STRIPE (Fintech Style) ==========
  stripe: {
    container: 'min-h-screen bg-white text-[#3c4257] p-6 font-sans',
    // Mesh gradient emulation
    background: 'background-image: radial-gradient(at 0% 0%, rgba(99, 91, 255, 0.15) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(0, 212, 255, 0.15) 0px, transparent 50%); background-color: #f7f9fc;',
    headerTitle: 'text-2xl font-bold text-[#3c4257] tracking-tight',
    headerSubtitle: 'text-sm text-[#697386] mt-1.5 font-medium',
    countdownBox: 'flex items-center gap-2 px-3 py-1.5 text-sm bg-white rounded-full shadow-sm border border-[#e3e8ee]',
    countdownText: 'text-[#635bff] font-semibold',
    countdownLabel: 'text-[#697386]',
    card: 'bg-white rounded-lg p-5 shadow-[0_2px_5px_-1px_rgba(50,50,93,0.25),0_1px_3px_-1px_rgba(0,0,0,0.3)] transition-all duration-300',
    cardHover: 'hover:shadow-[0_6px_12px_-2px_rgba(50,50,93,0.25),0_3px_7px_-3px_rgba(0,0,0,0.3)] hover:-translate-y-0.5',
    modelName: 'font-bold text-[#3c4257] truncate max-w-md',
    statsText: 'text-sm text-[#697386] font-medium',
    statsValue: 'text-[#3c4257] font-bold',
    statusGreen: 'bg-[#635bff]', // Stripe Blurple
    statusYellow: 'bg-[#f5a623]',
    statusRed: 'bg-[#e22525]',
    statusEmpty: 'bg-[#e3e8ee]',
    statusHover: 'hover:opacity-80 transition-opacity',
    badgeGreen: 'bg-[#635bff]/10 text-[#635bff] px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider rounded',
    badgeYellow: 'bg-[#f5a623]/10 text-[#f5a623] px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider rounded',
    badgeRed: 'bg-[#e22525]/10 text-[#e22525] px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider rounded',
    timeLabel: 'text-xs text-[#697386] font-semibold uppercase tracking-wide',
    tooltip: 'bg-white rounded-lg shadow-[0_13px_27px_-5px_rgba(50,50,93,0.25),0_8px_16px_-8px_rgba(0,0,0,0.3)] p-4 z-[9999]',
    tooltipTitle: 'font-bold text-[#3c4257] mb-2 pb-2 border-b border-[#e3e8ee]',
    tooltipLabel: 'text-[#697386] text-xs font-semibold uppercase',
    tooltipValue: 'text-[#3c4257] font-semibold',
    legendText: 'text-xs text-[#697386] font-semibold uppercase tracking-wide',
    legendDot: 'w-2.5 h-2.5 rounded-full',
    emptyText: 'text-[#697386] font-medium',
    loader: 'text-[#635bff]',
  },

  // ========== GITHUB (Primer Dark Style) ==========
  github: {
    container: 'min-h-screen bg-[#0d1117] text-[#c9d1d9] p-6 font-sans',
    headerTitle: 'text-2xl font-semibold text-[#c9d1d9] tracking-tight',
    headerSubtitle: 'text-sm text-[#8b949e] mt-1.5',
    countdownBox: 'flex items-center gap-2 px-3 py-1.5 text-sm bg-[#161b22] border border-[#30363d] rounded-md',
    countdownText: 'text-[#58a6ff] font-semibold',
    countdownLabel: 'text-[#8b949e]',
    card: 'bg-[#161b22] border border-[#30363d] rounded-md p-5 transition-all duration-200',
    cardHover: 'hover:border-[#8b949e]',
    modelName: 'font-semibold text-[#c9d1d9] truncate max-w-md hover:text-[#58a6ff] transition-colors',
    statsText: 'text-sm text-[#8b949e]',
    statsValue: 'text-[#c9d1d9] font-semibold',
    statusGreen: 'bg-[#238636]', // Primer Green
    statusYellow: 'bg-[#9e6a03]', // Primer Yellow
    statusRed: 'bg-[#da3633]', // Primer Red
    statusEmpty: 'bg-[#21262d]',
    statusHover: 'hover:brightness-110 transition-all',
    badgeGreen: 'bg-[#238636]/15 text-[#3fb950] border border-[#238636]/40 px-2 py-0.5 text-xs font-medium rounded-2xl',
    badgeYellow: 'bg-[#9e6a03]/15 text-[#d29922] border border-[#9e6a03]/40 px-2 py-0.5 text-xs font-medium rounded-2xl',
    badgeRed: 'bg-[#da3633]/15 text-[#f85149] border border-[#da3633]/40 px-2 py-0.5 text-xs font-medium rounded-2xl',
    timeLabel: 'text-xs text-[#8b949e]',
    tooltip: 'bg-[#161b22] border border-[#30363d] rounded-md shadow-xl p-3 z-[9999]',
    tooltipTitle: 'font-semibold text-[#c9d1d9] mb-2 pb-2 border-b border-[#30363d]',
    tooltipLabel: 'text-[#8b949e] text-xs',
    tooltipValue: 'text-[#c9d1d9] font-mono text-sm',
    legendText: 'text-xs text-[#8b949e]',
    legendDot: 'w-2.5 h-2.5 rounded-sm', // GitHub contribution cells are slightly rounded squares
    emptyText: 'text-[#8b949e]',
    loader: 'text-[#58a6ff]',
  },

  // ========== DISCORD (Gaming Style) ==========
  discord: {
    container: 'min-h-screen bg-[#313338] text-[#dbdee1] p-6 font-sans',
    headerTitle: 'text-2xl font-black text-[#f2f3f5] tracking-tight uppercase',
    headerSubtitle: 'text-sm text-[#949ba4] mt-1.5 font-medium',
    countdownBox: 'flex items-center gap-2 px-3 py-1.5 text-sm bg-[#1e1f22] rounded-[4px] shadow-sm',
    countdownText: 'text-[#5865F2] font-bold', // Blurple
    countdownLabel: 'text-[#949ba4]',
    card: 'bg-[#2b2d31] rounded-[4px] p-5 transition-all duration-200 group',
    cardHover: 'hover:bg-[#404249] hover:shadow-md',
    modelName: 'font-bold text-[#f2f3f5] truncate max-w-md group-hover:text-white transition-colors',
    statsText: 'text-sm text-[#949ba4] font-medium',
    statsValue: 'text-[#f2f3f5] font-bold',
    statusGreen: 'bg-[#23a559]',
    statusYellow: 'bg-[#f0b232]',
    statusRed: 'bg-[#da373c]',
    statusEmpty: 'bg-[#1e1f22]',
    statusHover: 'hover:scale-110 transition-transform origin-center',
    badgeGreen: 'bg-[#23a559]/20 text-[#23a559] px-2 py-0.5 text-xs font-bold rounded-[4px]',
    badgeYellow: 'bg-[#f0b232]/20 text-[#f0b232] px-2 py-0.5 text-xs font-bold rounded-[4px]',
    badgeRed: 'bg-[#da373c]/20 text-[#da373c] px-2 py-0.5 text-xs font-bold rounded-[4px]',
    timeLabel: 'text-[10px] text-[#949ba4] font-bold uppercase tracking-wide',
    tooltip: 'bg-[#111214] rounded-[4px] shadow-xl p-3 z-[9999]',
    tooltipTitle: 'font-bold text-[#f2f3f5] mb-2',
    tooltipLabel: 'text-[#b5bac1] text-xs font-bold uppercase',
    tooltipValue: 'text-[#f2f3f5] font-bold',
    legendText: 'text-xs text-[#949ba4] font-bold',
    legendDot: 'w-3 h-3 rounded-full',
    emptyText: 'text-[#949ba4] font-medium',
    loader: 'text-[#5865F2]',
  },

  // ========== TESLA (Industrial Future Style) ==========
  tesla: {
    container: 'min-h-screen bg-black text-white p-6 font-sans',
    headerTitle: 'text-2xl font-medium tracking-[0.15em] uppercase text-white',
    headerSubtitle: 'text-sm text-[#666] mt-2 tracking-wide uppercase',
    countdownBox: 'flex items-center gap-2 px-4 py-1.5 text-sm border border-[#333] rounded-none',
    countdownText: 'text-[#e82127] font-medium tracking-wider', // Tesla Red
    countdownLabel: 'text-[#666] uppercase text-xs tracking-wider',
    card: 'bg-[#111] border-t-2 border-[#333] p-5 transition-all duration-300 hover:bg-[#181818]',
    cardHover: 'hover:border-[#e82127] hover:shadow-[0_-4px_10px_rgba(232,33,39,0.2)]',
    modelName: 'font-medium text-white truncate max-w-md tracking-wider uppercase',
    statsText: 'text-sm text-[#666] tracking-wide uppercase',
    statsValue: 'text-white font-medium',
    statusGreen: 'bg-white', // Minimalist white for good status in dark mode
    statusYellow: 'bg-[#e82127]', // Use red for warning/error to keep palette strict
    statusRed: 'bg-[#e82127]',
    statusEmpty: 'bg-[#222]',
    statusHover: 'hover:bg-[#e82127] transition-colors',
    badgeGreen: 'border border-white text-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em]',
    badgeYellow: 'border border-[#e82127] text-[#e82127] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em]',
    badgeRed: 'bg-[#e82127] text-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em]',
    timeLabel: 'text-[10px] text-[#444] tracking-[0.2em] uppercase',
    tooltip: 'bg-black border border-[#333] shadow-[0_0_30px_rgba(0,0,0,0.8)] p-4 z-[9999]',
    tooltipTitle: 'font-medium text-white mb-3 pb-2 border-b border-[#333] tracking-widest uppercase text-xs',
    tooltipLabel: 'text-[#666] text-[10px] uppercase tracking-wider',
    tooltipValue: 'text-white font-medium tracking-wide',
    legendText: 'text-[10px] text-[#666] tracking-[0.1em] uppercase',
    legendDot: 'w-2 h-2 rounded-none',
    emptyText: 'text-[#444] uppercase tracking-wider',
    loader: 'text-[#e82127]',
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

  // Tooltip state - lifted to parent to avoid z-index/transform issues
  const [hoveredSlot, setHoveredSlot] = useState<SlotStatus | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const styles = themeStyles[theme] || themeStyles.daylight

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
          // Validate theme exists in themeStyles, fallback to daylight for legacy values
          const validTheme = THEMES.find(t => t.id === data.theme) ? data.theme : 'daylight'
          setTheme(validTheme as ThemeId)
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

  // Handler for hover
  const handleSlotHover = (slot: SlotStatus, rect: DOMRect) => {
    setTooltipPosition({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    })
    setHoveredSlot(slot)
  }

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
                {theme !== 'minimal' && (
                  <span className="ml-3 text-sm font-normal opacity-60">
                    {THEMES.find(t => t.id === theme)?.name}
                  </span>
                )}
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
                onHover={handleSlotHover}
                onLeave={() => setHoveredSlot(null)}
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

      {/* Global Tooltip */}
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
  )
}

// ============================================================================
// Model Card Component
// ============================================================================

interface EmbedModelCardProps {
  model: ModelStatus
  theme: ThemeId
  styles: typeof themeStyles.obsidian
  onHover: (slot: SlotStatus, rect: DOMRect) => void
  onLeave: () => void
}

function EmbedModelCard({ model, theme, styles, onHover, onLeave }: EmbedModelCardProps) {
  
  const handleMouseEnter = (slot: SlotStatus, event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect()
    onHover(slot, rect)
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
          {!isMinimal && (
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-current/5 flex-shrink-0">
              <ModelLogo modelName={model.model_name} size={18} />
            </div>
          )}
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
              onMouseLeave={onLeave}
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
      </div>
    </div>
  )
}

export default ModelStatusEmbed
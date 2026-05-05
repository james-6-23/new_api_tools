import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card'
import { BarChart3, TrendingUp, Calendar } from 'lucide-react'
import { cn } from '../lib/utils'

interface DailyTrend {
  date?: string
  hour?: string
  timestamp?: number
  request_count: number
  quota_used: number
  unique_users?: number
}

interface TrendChartProps {
  data: DailyTrend[]
  period: string
  loading?: boolean
  totalRequests?: number
}

export function TrendChart({ data, period, loading, totalRequests }: TrendChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  // 浮层用 portal 渲染到 body，避开 Card 的 overflow-hidden 裁切
  const barTopsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const [tipRect, setTipRect] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (hoveredIndex === null) {
      setTipRect(null)
      return
    }
    const el = barTopsRef.current.get(hoveredIndex)
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      // 锚点：柱子顶端中点
      setTipRect({ top: r.top, left: r.left + r.width / 2 })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [hoveredIndex])

  // Use period to determine hourly vs daily mode
  const isHourlyMode = period === '24h'

  // 1. Data Processing
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return []
    const maxRequests = Math.max(...data.map(d => d.request_count), 1)
    return data.map((d, i) => {
      let displayDate = ''
      if (d.timestamp) {
        const date = new Date(d.timestamp * 1000)
        if (isHourlyMode) {
          displayDate = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
        } else {
          displayDate = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
        }
      } else {
        // Fallback to server string with proper formatting
        if (isHourlyMode && d.hour) {
          // Extract "HH:00" from "2026-02-17 16:00"
          const timePart = d.hour.split(' ')[1]
          displayDate = timePart || d.hour.slice(-5)
        } else if (d.date) {
          // Extract "MM-DD" from "2026-02-17"
          displayDate = d.date.slice(5)
        } else if (d.hour) {
          // Fallback for hourly data in daily mode (shouldn't happen normally)
          const timePart = d.hour.split(' ')[1]
          displayDate = timePart || d.hour.slice(-5)
        } else {
          displayDate = ''
        }
      }

      return {
        ...d,
        height: (d.request_count / maxRequests) * 100,
        displayDate,
        x: i
      }
    })
  }, [data, isHourlyMode])

  const maxVal = useMemo(() => Math.max(...data.map(d => d.request_count), 5), [data])

  // Helper to generate grid lines
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(p => Math.round(maxVal * p))

  if (loading) {
    return (
      <Card className="col-span-1 shadow-sm h-[350px] flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-4 w-32 bg-muted rounded mb-4"></div>
          <div className="h-40 w-full bg-muted/20 rounded-lg"></div>
        </div>
      </Card>
    )
  }

  return (
    <Card className="glass-card shadow-sm hover:shadow-lg transition-all duration-300 border-border/50 flex flex-col h-full relative overflow-hidden">
      <div className="absolute -left-20 -top-20 w-64 h-64 rounded-full opacity-10 bg-primary blur-3xl pointer-events-none" />
      <CardHeader className="pb-0 shrink-0 relative z-10">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-lg text-primary">
                <TrendingUp className="w-5 h-5" />
              </div>
              {isHourlyMode ? '每小时请求趋势' : '每日请求趋势'}
            </CardTitle>
            <CardDescription>
              {period === '24h' ? '24小时' : period === '3d' ? '近3天' : period === '7d' ? '近7天' : '近14天'}数据概览
            </CardDescription>
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-2xl font-bold text-primary">
              {(totalRequests ?? data.reduce((acc, curr) => acc + Number(curr.request_count), 0)).toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground font-medium">请求总数</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-end pb-16 min-h-[350px]">
        {processedData.length > 0 ? (
          <div className="relative h-[240px] w-full select-none pl-8 border-b border-border/50 shrink-0">
            {/* Background Grid */}
            <div className="absolute inset-0 flex flex-col justify-between text-xs text-muted-foreground/30 pointer-events-none">
              {gridLines.reverse().map((val, i) => (
                <div key={i} className="flex items-center w-full relative">
                  <span className="absolute -left-8 w-7 text-right text-[10px]">{val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}</span>
                  <div className="w-full h-[1px] bg-border/40 border-dashed border-t border-muted-foreground/20"></div>
                </div>
              ))}
            </div>

            {/* Chart Area */}
            <div className="absolute inset-0 ml-0 flex items-end justify-between gap-1.5 sm:gap-2 pl-2 z-10">
              {processedData.map((item, index) => {
                const total = processedData.length;
                // Label visibility: show fewer labels when there are many bars
                let showLabel: boolean
                if (isHourlyMode) {
                  // Hourly: show every 3rd label to avoid overlap (24 bars)
                  showLabel = index % 3 === 0 || index === total - 1
                } else if (total <= 7) {
                  showLabel = true
                } else if (total <= 14) {
                  showLabel = index % 2 === 0 || index === total - 1
                } else {
                  showLabel = index % 3 === 0 || index === total - 1
                }

                return (
                  <div
                    key={index}
                    className="relative flex-1 h-full flex items-end justify-center group"
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    {/* Ghost Background Bar */}
                    <div className="absolute inset-x-0 bottom-0 top-0 bg-muted/20 rounded-t-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                    {/* Active Bar */}
                    <div
                      className="relative w-full flex items-end transition-all duration-500 ease-out z-10"
                      style={{ height: '100%' }}
                    >
                      <div
                        ref={(el) => {
                          // 把每根柱子顶端 DOM 引用存起来，tooltip 用 getBoundingClientRect 跟它对齐
                          if (el) barTopsRef.current.set(index, el)
                          else barTopsRef.current.delete(index)
                        }}
                        className={cn(
                          "w-full rounded-t-sm transition-all duration-300 relative border-t border-x border-white/10",
                          "bg-gradient-to-b from-primary to-primary/80 dark:from-primary/90 dark:to-primary/60",
                          hoveredIndex === index
                            ? "opacity-100 shadow-[0_0_15px_rgba(var(--primary),0.3)] brightness-110"
                            : "opacity-85 hover:opacity-100"
                        )}
                        style={{
                          height: `${Math.max(item.height, 1.5)}%`,
                        }}
                      >
                      </div>
                    </div>

                    {/* X-Axis Label */}
                    <div className={cn(
                      "absolute top-full mt-2 left-1/2 text-[9px] text-muted-foreground font-medium transition-all duration-200 -translate-x-1/2 whitespace-nowrap",
                      showLabel ? "opacity-70" : "opacity-0"
                    )}>
                      {item.displayDate}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="h-[250px] flex flex-col items-center justify-center text-muted-foreground bg-muted/5 rounded-xl border border-dashed border-muted">
            <BarChart3 className="w-10 h-10 mb-2 opacity-20" />
            <p className="text-sm">暂无趋势数据</p>
          </div>
        )}
      </CardContent>

      {/* Floating tooltip — portaled to body, anchored to bar top */}
      {hoveredIndex !== null && tipRect && processedData[hoveredIndex] && createPortal(
        <FloatingBarTooltip
          item={processedData[hoveredIndex]}
          isHourlyMode={isHourlyMode}
          anchorTop={tipRect.top}
          anchorLeft={tipRect.left}
        />,
        document.body
      )}
    </Card>
  )
}

interface FloatingBarTooltipProps {
  item: {
    timestamp?: number
    hour?: string
    date?: string
    request_count: number
    unique_users?: number
    quota_used: number
  }
  isHourlyMode: boolean
  anchorTop: number    // 柱子顶端在视口的 top
  anchorLeft: number   // 柱子顶端在视口的 left（中心）
}

function FloatingBarTooltip({ item, isHourlyMode, anchorTop, anchorLeft }: FloatingBarTooltipProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [adjusted, setAdjusted] = useState<{ top: number; left: number } | null>(null)

  // 浮层挂载后量自身大小，再做边界纠正：宽超左/右、高超上时翻到柱子下方
  useEffect(() => {
    if (!ref.current) return
    const tip = ref.current.getBoundingClientRect()
    const GAP = 8
    let top = anchorTop - tip.height - GAP   // 默认在柱子上方
    let left = anchorLeft - tip.width / 2

    if (top < 8) {
      // 上方空间不够 → 翻到柱子下方（柱子顶 + 一些偏移）
      top = anchorTop + GAP
    }
    if (left < 8) left = 8
    if (left + tip.width > window.innerWidth - 8) left = window.innerWidth - tip.width - 8

    setAdjusted({ top, left })
  }, [anchorTop, anchorLeft])

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: adjusted?.top ?? anchorTop,
        left: adjusted?.left ?? anchorLeft,
        opacity: adjusted ? 1 : 0,
        pointerEvents: 'none',
        zIndex: 50,
      }}
      className="bg-popover text-popover-foreground text-xs rounded-lg shadow-xl border border-border/60 p-3 min-w-[180px] whitespace-nowrap"
    >
      <div className="font-semibold mb-1 flex items-center gap-2 border-b border-border/50 pb-1.5">
        <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="truncate">
          {item.timestamp ? (
            isHourlyMode
              ? new Date(item.timestamp * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
              : new Date(item.timestamp * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
          ) : (isHourlyMode ? (item.hour || '') : (item.date || ''))}
        </span>
      </div>
      <div className="space-y-1.5 mt-2">
        <div className="flex justify-between items-center gap-6">
          <span className="text-muted-foreground">请求数</span>
          <span className="font-mono font-bold tabular-nums">{Number(item.request_count).toLocaleString()}</span>
        </div>
        {item.unique_users !== undefined && (
          <div className="flex justify-between items-center gap-6">
            <span className="text-muted-foreground">用户数</span>
            <span className="font-mono tabular-nums">{item.unique_users}</span>
          </div>
        )}
        <div className="flex justify-between items-center gap-6">
          <span className="text-muted-foreground">消耗</span>
          <span className="font-mono tabular-nums">${(Number(item.quota_used) / 500000).toFixed(4)}</span>
        </div>
      </div>
    </div>
  )
}

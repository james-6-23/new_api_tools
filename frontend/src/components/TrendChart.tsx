import { useState, useMemo } from 'react'
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

                    {/* Tooltip */}
                    <div
                      className={cn(
                        "absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50",
                        "transition-all duration-200 ease-out transform",
                        hoveredIndex === index
                          ? "opacity-100 translate-y-0 scale-100"
                          : "opacity-0 translate-y-2 scale-95 pointer-events-none"
                      )}
                    >
                      <div className="bg-popover/80 backdrop-blur-xl supports-[backdrop-filter]:bg-popover/60 text-popover-foreground text-xs rounded-lg shadow-xl border border-border/50 p-3 min-w-[140px]">
                        <div className="font-semibold mb-1 flex items-center gap-2 border-b border-border/50 pb-1">
                          <Calendar className="w-3 h-3 text-muted-foreground" />
                          {item.timestamp ? (
                            isHourlyMode
                              ? new Date(item.timestamp * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                              : new Date(item.timestamp * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
                          ) : (isHourlyMode ? (item.hour || '') : (item.date || ''))}
                        </div>
                        <div className="space-y-1 mt-2">
                          <div className="flex justify-between items-center gap-4">
                            <span className="text-muted-foreground">请求数:</span>
                            <span className="font-mono font-bold">{Number(item.request_count).toLocaleString()}</span>
                          </div>
                          {item.unique_users !== undefined && (
                            <div className="flex justify-between items-center gap-4">
                              <span className="text-muted-foreground">用户数:</span>
                              <span className="font-mono">{item.unique_users}</span>
                            </div>
                          )}
                          <div className="flex justify-between items-center gap-4">
                            <span className="text-muted-foreground">消耗:</span>
                            <span className="font-mono">${(Number(item.quota_used) / 500000).toFixed(4)}</span>
                          </div>
                        </div>
                      </div>
                      {/* Arrow */}
                      <div className="w-2 h-2 bg-popover border-r border-b border-border rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2"></div>
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
    </Card>
  )
}

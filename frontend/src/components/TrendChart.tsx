import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card'
import { BarChart3, TrendingUp, Calendar } from 'lucide-react'
import { cn } from '../lib/utils'

interface DailyTrend {
  date?: string
  hour?: string
  request_count: number
  quota_used: number
  unique_users?: number
}

interface TrendChartProps {
  data: DailyTrend[]
  period: string
  loading?: boolean
}

export function TrendChart({ data, period, loading }: TrendChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  // 1. Data Processing
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return []
    const maxRequests = Math.max(...data.map(d => d.request_count), 1)
    return data.map((d, i) => ({
      ...d,
      // Calculate normalized height (0-100)
      height: (d.request_count / maxRequests) * 100,
      // Format date/hour for display
      displayDate: d.hour || (d.date ? d.date.slice(5) : ''), // "HH:MM" or "MM-DD"
      x: i // original index
    }))
  }, [data])

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
    <Card className="shadow-sm hover:shadow-md transition-all duration-300 border-border/50 flex flex-col h-full relative">
      <CardHeader className="pb-0 shrink-0">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-lg text-primary">
                <TrendingUp className="w-5 h-5" />
              </div>
              每日请求趋势
            </CardTitle>
            <CardDescription>
              {period === '24h' ? '24小时' : period === '3d' ? '近3天' : period === '7d' ? '近7天' : '近14天'}数据概览
            </CardDescription>
          </div>
          <div className="text-right hidden sm:block">
             <div className="text-2xl font-bold text-primary">
               {data.reduce((acc, curr) => acc + curr.request_count, 0).toLocaleString()}
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
                  <span className="absolute -left-8 w-7 text-right text-[10px]">{val >= 1000 ? `${(val/1000).toFixed(1)}k` : val}</span>
                  <div className="w-full h-[1px] bg-border/40 border-dashed border-t border-muted-foreground/20"></div>
                </div>
              ))}
            </div>

            {/* Chart Area */}
            <div className="absolute inset-0 ml-0 flex items-end justify-between gap-0.5 sm:gap-1 pl-2 z-10">
              {processedData.map((item, index) => {
                 // Determine if we should show the label
                 const total = processedData.length;
                 const isHourly = !!item.hour;
                 // Always show if hourly, otherwise use adaptive logic
                 const showLabel = isHourly || (total <= 12) || (index % 2 === 0) || (index === total - 1);

                 return (
                  <div
                    key={index}
                    className="relative flex-1 h-full flex items-end justify-center group"
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    {/* Hover Line */}
                    <div 
                      className={cn(
                        "absolute bottom-0 w-[1px] bg-primary/20 transition-all duration-300 pointer-events-none",
                        hoveredIndex === index ? "h-full opacity-100" : "h-0 opacity-0"
                      )} 
                    />

                    {/* Bar */}
                    <div 
                      className="relative w-full flex items-end transition-all duration-500 ease-out"
                      style={{ height: '100%' }}
                    >
                       <div 
                          className={cn(
                            "w-full rounded-t-[1px] transition-all duration-300 relative",
                            "bg-gradient-to-t from-primary/70 to-primary",
                            hoveredIndex === index ? "opacity-100 scale-x-110 shadow-[0_0_10px_rgba(var(--primary),0.2)]" : "opacity-80"
                          )}
                          style={{ 
                            height: `${Math.max(item.height, 2)}%`,
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
                      <div className="bg-popover/95 backdrop-blur-sm text-popover-foreground text-xs rounded-lg shadow-xl border border-border p-3 min-w-[140px]">
                         <div className="font-semibold mb-1 flex items-center gap-2 border-b border-border/50 pb-1">
                            <Calendar className="w-3 h-3 text-muted-foreground" />
                            {item.hour || item.date}
                         </div>
                         <div className="space-y-1 mt-2">
                            <div className="flex justify-between items-center gap-4">
                               <span className="text-muted-foreground">请求数:</span>
                               <span className="font-mono font-bold">{item.request_count}</span>
                            </div>
                            <div className="flex justify-between items-center gap-4">
                               <span className="text-muted-foreground">用户数:</span>
                               <span className="font-mono">{item.unique_users}</span>
                            </div>
                            <div className="flex justify-between items-center gap-4">
                               <span className="text-muted-foreground">消耗:</span>
                               <span className="font-mono">${(item.quota_used / 500000).toFixed(4)}</span>
                            </div>
                         </div>
                      </div>
                      {/* Arrow */}
                      <div className="w-2 h-2 bg-popover border-r border-b border-border rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2"></div>
                    </div>

                    {/* X-Axis Label */}
                    <div className={cn(
                      "absolute top-full mt-2 left-1/2 text-[9px] text-muted-foreground font-medium transition-all duration-200",
                      isHourly ? "rotate-[45deg] origin-top-left ml-1 whitespace-nowrap" : "-translate-x-1/2",
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

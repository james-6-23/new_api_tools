import { ReactNode, useEffect, useState, useRef } from 'react'
import { LayoutDashboard, Plus, Ticket, Clock, DollarSign, BarChart3, Users, LogOut, Activity, Globe, Monitor, UserPlus } from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { cn } from '../lib/utils'

export type TabType = 'dashboard' | 'risk' | 'ip-analysis' | 'generator' | 'redemptions' | 'history' | 'topups' | 'analytics' | 'model-status' | 'users' | 'auto-group'

interface DbStatus {
  connected: boolean
  engine: string
  host: string
  database: string
}

interface LayoutProps {
  children: ReactNode
  activeTab: TabType
  onTabChange: (tab: TabType) => void
  onLogout: () => void
}

const tabs: { id: TabType; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: '仪表板', icon: LayoutDashboard },
  { id: 'topups', label: '充值记录', icon: DollarSign },
  { id: 'risk', label: '风控中心', icon: Activity },
  { id: 'ip-analysis', label: 'IP分析', icon: Globe },
  { id: 'analytics', label: '日志分析', icon: BarChart3 },
  { id: 'model-status', label: '模型监控', icon: Monitor },
  { id: 'users', label: '用户管理', icon: Users },
  { id: 'auto-group', label: '自动分组', icon: UserPlus },
  { id: 'generator', label: '生成器', icon: Plus },
  { id: 'redemptions', label: '兑换码', icon: Ticket },
  { id: 'history', label: '生成记录', icon: Clock },
]

export function Layout({ children, activeTab, onTabChange, onLogout }: LayoutProps) {
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0, opacity: 0 })
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const fetchDbStatus = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || ''
        const response = await fetch(`${apiUrl}/api/health/db`)
        const data = await response.json()
        if (data.success) {
          setDbStatus({
            connected: true,
            engine: data.engine,
            host: data.host,
            database: data.database,
          })
        } else {
          setDbStatus({ connected: false, engine: '', host: '', database: '' })
        }
      } catch {
        setDbStatus({ connected: false, engine: '', host: '', database: '' })
      }
    }
    fetchDbStatus()
  }, [])

  useEffect(() => {
    const activeTabIndex = tabs.findIndex(tab => tab.id === activeTab)
    const activeTabElement = tabsRef.current[activeTabIndex]

    if (activeTabElement) {
      setIndicatorStyle({
        left: activeTabElement.offsetLeft,
        width: activeTabElement.offsetWidth,
        opacity: 1
      })
    }
  }, [activeTab])

  // Handle window resize to recalculate positions
  useEffect(() => {
    const handleResize = () => {
      const activeTabIndex = tabs.findIndex(tab => tab.id === activeTab)
      const activeTabElement = tabsRef.current[activeTabIndex]
      if (activeTabElement) {
        setIndicatorStyle({
          left: activeTabElement.offsetLeft,
          width: activeTabElement.offsetWidth,
          opacity: 1
        })
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [activeTab])

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Sticky Header Wrapper */}
      <div className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
        <header className="w-full">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-3">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <LayoutDashboard className="w-5 h-5" />
                  </div>
                  <h1 className="text-lg sm:text-xl font-bold tracking-tight">
                    NewAPI-Tool
                  </h1>
                </div>
                {dbStatus && (
                  <Badge 
                    variant={dbStatus.connected ? 'success' : 'destructive'} 
                    className="hidden md:flex items-center gap-1.5 px-2 py-0.5 h-6"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${dbStatus.connected ? 'bg-white animate-pulse' : 'bg-white/50'}`} />
                    {dbStatus.connected
                      ? <span className="text-[10px] font-medium opacity-90">{dbStatus.engine.toUpperCase()}</span>
                      : '离线'}
                  </Badge>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={onLogout} className="text-muted-foreground hover:text-foreground">
                <LogOut className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">退出</span>
              </Button>
            </div>
          </div>
        </header>

        {/* Modern Navigation Tabs */}
        <div className="w-full border-t border-border/40">
          <div className="max-w-7xl mx-auto">
            <nav className="relative flex items-center w-full overflow-x-auto no-scrollbar px-4 sm:px-6 lg:px-8 h-14" aria-label="Tabs">
              {/* Sliding Background Indicator */}
              <div
                className="absolute inset-y-2.5 bg-secondary rounded-md transition-all duration-300 ease-out"
                style={{
                  left: indicatorStyle.left,
                  width: indicatorStyle.width,
                  opacity: indicatorStyle.opacity,
                }}
              />

              {tabs.map(({ id, label, icon: Icon }, index) => (
                <button
                  key={id}
                  ref={el => { tabsRef.current[index] = el }}
                  onClick={() => onTabChange(id)}
                  className={cn(
                    "relative h-9 flex items-center justify-center gap-2 px-3 sm:px-4 text-sm font-medium rounded-md whitespace-nowrap transition-colors duration-200 z-10 select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    activeTab === id
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground/80"
                  )}
                >
                  <Icon className={cn("h-4 w-4 transition-transform duration-300", activeTab === id ? "scale-110" : "scale-100")} />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>
      </div>

      {/* Main Content with Fade In */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 animate-in fade-in duration-500 slide-in-from-bottom-2">
        {children}
      </main>
    </div>
  )
}

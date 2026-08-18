import { ReactNode, useCallback, useEffect, useLayoutEffect, useState, useRef } from 'react'
import { LayoutDashboard, Ticket, DollarSign, BarChart3, Users, LogOut, Activity, Globe, Monitor, UserPlus, Key, RadioTower, Bell, Menu, X, Server, CalendarCheck, Settings, ListChecks } from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from './ui/dialog'
import { cn } from '../lib/utils'
import { useAuth } from '../contexts/AuthContext'
import { apiFetch, createAuthHeaders } from '../lib/api'

export type TabType = 'dashboard' | 'risk' | 'abuse-broadcast' | 'ip-analysis' | 'redemptions' | 'topups' | 'analytics' | 'model-status' | 'users' | 'auto-group' | 'tokens' | 'channels' | 'checkins' | 'task-logs'

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
  { id: 'abuse-broadcast', label: '联合广播', icon: RadioTower },
  { id: 'ip-analysis', label: 'IP分析', icon: Globe },
  { id: 'analytics', label: '日志分析', icon: BarChart3 },
  { id: 'task-logs', label: '任务日志', icon: ListChecks },
  { id: 'model-status', label: '模型监控', icon: Monitor },
  { id: 'channels', label: '渠道监控', icon: Server },
  { id: 'checkins', label: '签到分析', icon: CalendarCheck },
  { id: 'users', label: '用户管理', icon: Users },
  { id: 'tokens', label: '令牌管理', icon: Key },
  { id: 'auto-group', label: '自动分组', icon: UserPlus },
  { id: 'redemptions', label: '兑换码管理', icon: Ticket },
]

// 功能项显隐配置（仪表板不可隐藏，作为兜底页）
const HIDDEN_TABS_KEY = 'newapi_tools_hidden_tabs'

// 用户从未保存过配置时默认关闭的功能页（用户改过一次后完全以其配置为准）
const DEFAULT_HIDDEN_TABS: TabType[] = ['abuse-broadcast', 'checkins', 'auto-group']

function loadHiddenTabs(): Set<TabType> {
  const raw = localStorage.getItem(HIDDEN_TABS_KEY)
  if (raw === null) return new Set(DEFAULT_HIDDEN_TABS)
  try {
    const saved = JSON.parse(raw)
    if (Array.isArray(saved)) return new Set(saved.filter((id) => id !== 'dashboard'))
  } catch { /* ignore corrupted value */ }
  return new Set(DEFAULT_HIDDEN_TABS)
}

export function Layout({ children, activeTab, onTabChange, onLogout }: LayoutProps) {
  const { token } = useAuth()
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null)
  const [unreadBroadcasts, setUnreadBroadcasts] = useState(0)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0, opacity: 0 })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hiddenTabs, setHiddenTabs] = useState<Set<TabType>>(loadHiddenTabs)
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([])
  const navRef = useRef<HTMLElement | null>(null)
  const activeTabLabel = tabs.find(tab => tab.id === activeTab)?.label ?? ''

  const visibleTabs = tabs.filter(tab => tab.id === 'dashboard' || !hiddenTabs.has(tab.id))
  const broadcastVisible = !hiddenTabs.has('abuse-broadcast')

  const toggleTabHidden = (id: TabType) => {
    setHiddenTabs(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(HIDDEN_TABS_KEY, JSON.stringify(Array.from(next)))
      return next
    })
  }

  // 总开关：有隐藏项 → 全部恢复显示；全显示中 → 全部关闭（仅留仪表板）
  const toggleAllTabs = () => {
    setHiddenTabs(prev => {
      const next: Set<TabType> = prev.size > 0
        ? new Set()
        : new Set(tabs.filter(t => t.id !== 'dashboard').map(t => t.id))
      localStorage.setItem(HIDDEN_TABS_KEY, JSON.stringify(Array.from(next)))
      return next
    })
  }

  // 当前页被隐藏时回退到仪表板
  useEffect(() => {
    if (activeTab !== 'dashboard' && hiddenTabs.has(activeTab)) {
      onTabChange('dashboard')
    }
  }, [hiddenTabs, activeTab, onTabChange])

  useEffect(() => {
    if (!mobileNavOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [mobileNavOpen])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [activeTab])

  const fetchUnreadBroadcasts = useCallback(async () => {
    if (!token) return
    try {
      const apiUrl = import.meta.env.VITE_API_URL || ''
      const response = await apiFetch(`${apiUrl}/api/abuse-broadcast/unread-count`, {
        headers: createAuthHeaders(token),
      })
      const data = await response.json()
      if (data.success) {
        setUnreadBroadcasts(Number(data.data?.unread || 0))
      }
    } catch {
      setUnreadBroadcasts(0)
    }
  }, [token])

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
    // 联合广播被隐藏时不轮询未读数
    if (!broadcastVisible) {
      setUnreadBroadcasts(0)
      return
    }
    void fetchUnreadBroadcasts()
    const timer = window.setInterval(() => void fetchUnreadBroadcasts(), 60000)
    const listener = () => void fetchUnreadBroadcasts()
    window.addEventListener('abuse-broadcast-unread-changed', listener)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('abuse-broadcast-unread-changed', listener)
    }
  }, [fetchUnreadBroadcasts, broadcastVisible])

  // 页签装不下时逐级缩小字号/间距（通过 CSS 变量），尽量避免横向滚动条；
  // 调整完再按最终布局重算滑动指示条位置。
  useLayoutEffect(() => {
    const nav = navRef.current
    const fit = () => {
      if (nav) {
        const steps: [string, string, string][] = [
          ['0.875rem', '0.75rem', '0.375rem'], // 默认 text-sm / px-3 / gap-1.5
          ['0.8125rem', '0.55rem', '0.3rem'],
          ['0.75rem', '0.45rem', '0.25rem'],
          ['0.6875rem', '0.35rem', '0.2rem'],
        ]
        for (const [fs, px, gap] of steps) {
          nav.style.setProperty('--tab-fs', fs)
          nav.style.setProperty('--tab-px', px)
          nav.style.setProperty('--tab-gap', gap)
          if (nav.scrollWidth <= nav.clientWidth) break
        }
      }
      const activeTabIndex = visibleTabs.findIndex(tab => tab.id === activeTab)
      const activeTabElement = tabsRef.current[activeTabIndex]
      if (activeTabElement) {
        setIndicatorStyle({
          left: activeTabElement.offsetLeft,
          width: activeTabElement.offsetWidth,
          opacity: 1
        })
      }
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, hiddenTabs])

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Sticky Header Wrapper */}
      <div className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/60 backdrop-blur-xl supports-[backdrop-filter]:bg-background/40 shadow-sm dark:shadow-none transition-colors duration-300">
        <header className="w-full">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-3">
              <div className="flex items-center gap-3 min-w-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMobileNavOpen(true)}
                  className="md:hidden -ml-2 h-9 w-9 px-0"
                  aria-label="打开导航"
                >
                  <Menu className="h-5 w-5" />
                </Button>
                <div className="flex items-center gap-2 min-w-0">
                  <img src="/tool.svg" alt="NewAPI-Tool" className="h-8 w-8 shrink-0" />
                  <h1 className="text-lg sm:text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70 truncate">
                    <span className="md:hidden">{activeTabLabel || 'NewAPI-Tool'}</span>
                    <span className="hidden md:inline">NewAPI-Tool</span>
                  </h1>
                </div>
                {dbStatus && (
                  <Badge
                    variant={dbStatus.connected ? 'success' : 'destructive'}
                    className={cn(
                      "hidden md:flex items-center gap-1.5 px-2 py-0.5 h-6 transition-all duration-300",
                      dbStatus.connected ? "shadow-sm shadow-emerald-500/20" : ""
                    )}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${dbStatus.connected ? 'bg-white animate-pulse' : 'bg-white/50'}`} />
                    {dbStatus.connected
                      ? <span className="text-[10px] font-medium opacity-90">{dbStatus.engine.toUpperCase()}</span>
                      : '离线'}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {broadcastVisible && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      window.history.pushState(null, '', '/abuse-broadcast?view=inbox')
                      window.dispatchEvent(new CustomEvent('abuse-broadcast-open-inbox'))
                      onTabChange('abuse-broadcast')
                    }}
                    className="relative text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    title="联合广播收件箱"
                  >
                    <Bell className="h-4 w-4" />
                    {unreadBroadcasts > 0 && (
                      <span className="absolute -right-1 -top-1 min-w-4 h-4 rounded-full bg-red-500 px-1 text-[10px] leading-4 text-white font-bold text-center">
                        {unreadBroadcasts > 99 ? '99+' : unreadBroadcasts}
                      </span>
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSettingsOpen(true)}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  title="功能设置"
                >
                  <Settings className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={onLogout} className="text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                  <LogOut className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">退出</span>
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* Modern Navigation Tabs (desktop only) */}
        <div className="hidden md:block w-full border-t border-border/40 bg-gradient-to-b from-transparent to-muted/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav ref={navRef} className="relative flex items-center w-full overflow-x-auto custom-scrollbar h-12" aria-label="Tabs">
              {/* Sliding Background Indicator */}
              <div
                className="absolute inset-y-2 bg-secondary rounded-md shadow-sm border border-border/50 transition-all duration-300 ease-out"
                style={{
                  left: indicatorStyle.left,
                  width: indicatorStyle.width,
                  opacity: indicatorStyle.opacity,
                }}
              />

              {visibleTabs.map(({ id, label, icon: Icon }, index) => (
                <button
                  key={id}
                  ref={el => { tabsRef.current[index] = el }}
                  onClick={() => onTabChange(id)}
                  className={cn(
                    // flex-1：页签少时均分整行宽度；字号/间距走 CSS 变量，由 fit 逻辑在放不下时逐级缩小
                    "relative h-8 flex-1 flex items-center justify-center gap-[var(--tab-gap,0.375rem)] px-[var(--tab-px,0.75rem)] text-[length:var(--tab-fs,0.875rem)] font-medium rounded-md whitespace-nowrap transition-colors duration-200 z-10 select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    activeTab === id
                      ? "text-foreground drop-shadow-sm"
                      : "text-muted-foreground hover:text-foreground/80"
                  )}
                >
                  <Icon className={cn("h-[1.15em] w-[1.15em] transition-transform duration-300 shrink-0", activeTab === id ? "scale-110 text-primary" : "scale-100")} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in-up"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[78%] max-w-xs bg-background border-r border-border shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 border-b border-border/60">
              <div className="flex items-center gap-2">
                <img src="/tool.svg" alt="" className="h-6 w-6" />
                <span className="font-semibold">NewAPI-Tool</span>
              </div>
              <Button variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={() => setMobileNavOpen(false)} aria-label="关闭导航">
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav className="flex-1 overflow-y-auto py-2">
              {visibleTabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => onTabChange(id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors",
                    activeTab === id
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  <Icon className={cn("h-5 w-5 shrink-0", activeTab === id ? "text-primary" : "")} />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </nav>
            {dbStatus && (
              <div className="px-4 py-3 border-t border-border/60 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span className={cn("inline-block h-2 w-2 rounded-full", dbStatus.connected ? "bg-emerald-500" : "bg-red-500")} />
                  {dbStatus.connected ? `${dbStatus.engine.toUpperCase()} · 已连接` : '数据库离线'}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* 功能设置弹窗 */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              功能设置
            </DialogTitle>
            <DialogDescription>
              关闭暂时用不到的功能页，导航栏不再显示（配置保存在本浏览器）。
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-2 border-b border-border pb-1 mb-1">
            <button
              type="button"
              onClick={toggleAllTabs}
              className="w-full flex items-center gap-3 px-2 py-2.5 text-sm font-semibold hover:bg-muted/40 transition-colors rounded-md"
            >
              <LayoutDashboard className={cn('h-4 w-4 shrink-0', hiddenTabs.size === 0 ? 'text-primary' : 'text-muted-foreground/50')} />
              <span className="flex-1 text-left">显示全部</span>
              <span
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
                  hiddenTabs.size === 0 ? 'bg-primary' : 'bg-muted-foreground/30'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                    hiddenTabs.size === 0 ? 'left-[18px]' : 'left-0.5'
                  )}
                />
              </span>
            </button>
          </div>
          <div className="divide-y divide-border/60 -mx-2">
            {tabs.filter(t => t.id !== 'dashboard').map(({ id, label, icon: Icon }) => {
              const enabled = !hiddenTabs.has(id)
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleTabHidden(id)}
                  className="w-full flex items-center gap-3 px-2 py-2.5 text-sm hover:bg-muted/40 transition-colors rounded-md"
                >
                  <Icon className={cn('h-4 w-4 shrink-0', enabled ? 'text-primary' : 'text-muted-foreground/50')} />
                  <span className={cn('flex-1 text-left', !enabled && 'text-muted-foreground line-through')}>{label}</span>
                  {/* 开关 */}
                  <span
                    className={cn(
                      'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
                      enabled ? 'bg-primary' : 'bg-muted-foreground/30'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                        enabled ? 'left-[18px]' : 'left-0.5'
                      )}
                    />
                  </span>
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">仪表板为默认页，不可关闭。</p>
        </DialogContent>
      </Dialog>

      {/* Main Content with Fade In */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 animate-fade-in-up">
        {children}
      </main>
    </div>
  )
}

import { ReactNode, useEffect, useState } from 'react'
import { LayoutDashboard, Plus, Ticket, Clock, DollarSign, BarChart3, LogOut } from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'

export type TabType = 'dashboard' | 'generator' | 'redemptions' | 'history' | 'topups' | 'analytics'

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
  { id: 'generator', label: '生成器', icon: Plus },
  { id: 'redemptions', label: '兑换码', icon: Ticket },
  { id: 'history', label: '历史记录', icon: Clock },
  { id: 'topups', label: '充值记录', icon: DollarSign },
  { id: 'analytics', label: '日志分析', icon: BarChart3 },
]

export function Layout({ children, activeTab, onTabChange, onLogout }: LayoutProps) {
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null)

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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-4">
              <h1 className="text-xl sm:text-2xl font-bold">
                NewAPI Middleware Tool
              </h1>
              {dbStatus && (
                <Badge 
                  variant={dbStatus.connected ? 'success' : 'destructive'} 
                  className="hidden sm:flex items-center gap-1.5"
                >
                  <span className={`w-2 h-2 rounded-full ${dbStatus.connected ? 'bg-green-300' : 'bg-red-300'}`} />
                  {dbStatus.connected
                    ? `${dbStatus.engine.toUpperCase()} · ${dbStatus.database}`
                    : '数据库未连接'}
                </Badge>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={onLogout}>
              <LogOut className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">退出登录</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-card border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => onTabChange(id)}
                className={`py-4 px-3 sm:px-4 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
                  activeTab === id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        {children}
      </main>
    </div>
  )
}

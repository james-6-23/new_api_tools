import { useState, useEffect, lazy, Suspense } from 'react'
import { Login, Layout, TabType, Dashboard } from './components'
import { useAuth } from './contexts/AuthContext'
import { WarmupScreen } from './components/WarmupScreen'

// 懒加载非首屏 tab — 显著降低初始包体积
const TopUps = lazy(() => import('./components/TopUps').then(m => ({ default: m.TopUps })))
const RedemptionCenter = lazy(() => import('./components/RedemptionCenter').then(m => ({ default: m.RedemptionCenter })))
const Analytics = lazy(() => import('./components/Analytics').then(m => ({ default: m.Analytics })))
const UserManagement = lazy(() => import('./components/UserManagement').then(m => ({ default: m.UserManagement })))
const RealtimeRanking = lazy(() => import('./components/RealtimeRanking').then(m => ({ default: m.RealtimeRanking })))
const IPAnalysis = lazy(() => import('./components/IPAnalysis').then(m => ({ default: m.IPAnalysis })))
const ModelStatusMonitor = lazy(() => import('./components/ModelStatusMonitor').then(m => ({ default: m.ModelStatusMonitor })))
const AutoGroup = lazy(() => import('./components/AutoGroup').then(m => ({ default: m.AutoGroup })))
const Tokens = lazy(() => import('./components/Tokens').then(m => ({ default: m.Tokens })))
const AbuseBroadcast = lazy(() => import('./components/AbuseBroadcast').then(m => ({ default: m.AbuseBroadcast })))

// Valid tabs
const validTabs: TabType[] = ['dashboard', 'topups', 'risk', 'abuse-broadcast', 'ip-analysis', 'analytics', 'model-status', 'users', 'tokens', 'auto-group', 'redemptions']

// 旧路径迁移：generator / history 现合并到 redemptions 内部 tab
const legacyRedirects: Record<string, string> = {
  generator: '/redemptions?view=generator',
  history: '/redemptions?view=history',
}

// Get initial tab from URL pathname (supports sub-routes like /risk/ip)
const getInitialTab = (): TabType => {
  const pathname = window.location.pathname.slice(1) // Remove leading /
  const mainPath = pathname.split('/')[0] // Get first segment for main tab

  if (legacyRedirects[mainPath]) {
    window.history.replaceState(null, '', legacyRedirects[mainPath])
    return 'redemptions'
  }

  if (validTabs.includes(mainPath as TabType)) {
    return mainPath as TabType
  }
  // 兼容旧的 hash 路由，自动迁移
  const hash = window.location.hash.slice(1)
  // 处理 #risk/ip 等格式
  const hashMain = hash.split('/')[0].replace('risk-', 'risk/')
  if (legacyRedirects[hashMain]) {
    window.history.replaceState(null, '', legacyRedirects[hashMain])
    return 'redemptions'
  }
  if (validTabs.includes(hashMain as TabType)) {
    // 重定向到新路由
    const subPath = hash.includes('/') ? hash.split('/').slice(1).join('/') : ''
    const newPath = subPath ? `/${hashMain}/${subPath}` : `/${hashMain}`
    window.history.replaceState(null, '', newPath)
    return hashMain as TabType
  }
  return 'dashboard'
}

function App() {
  const { isAuthenticated, token, login, logout } = useAuth()
  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab)
  const [warmupState, setWarmupState] = useState<'checking' | 'warming' | 'ready'>('checking')

  const apiUrl = import.meta.env.VITE_API_URL || ''

  // 检查后端预热状态
  useEffect(() => {
    if (!isAuthenticated || !token) return

    const checkWarmupStatus = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/system/warmup-status`, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        })

        // 处理 401 未授权错误 - token 失效，需要重新登录
        if (response.status === 401) {
          console.warn('Token invalid or expired, logging out...')
          logout()
          return
        }

        const data = await response.json()

        if (data.success && data.data.status === 'ready') {
          // 后端已预热完成，直接进入
          setWarmupState('ready')
        } else {
          // 后端还在预热中，显示预热界面
          setWarmupState('warming')
        }
      } catch {
        // 网络错误，显示预热界面让它处理
        setWarmupState('warming')
      }
    }

    checkWarmupStatus()
  }, [isAuthenticated, token, apiUrl, logout])

  // Sync tab with URL pathname (History API)
  // Only update if main path segment changes, preserve sub-routes
  useEffect(() => {
    const pathname = window.location.pathname.slice(1)
    const currentMainPath = pathname.split('/')[0]
    if (currentMainPath !== activeTab) {
      window.history.pushState(null, '', `/${activeTab}`)
    }
  }, [activeTab])

  // Listen for popstate (browser back/forward)
  useEffect(() => {
    const handlePopState = () => {
      const pathname = window.location.pathname.slice(1)
      const mainPath = pathname.split('/')[0] // Extract main tab from path
      if (validTabs.includes(mainPath as TabType)) {
        setActiveTab(mainPath as TabType)
      } else {
        setActiveTab('dashboard')
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const handleWarmupReady = () => {
    setWarmupState('ready')
  }

  if (!isAuthenticated) {
    return <Login onLogin={login} />
  }

  // 正在检查预热状态
  if (warmupState === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
          </div>
          <p className="text-sm text-muted-foreground animate-pulse">正在连接服务器...</p>
        </div>
      </div>
    )
  }

  // 显示预热界面（后端还在预热中）
  if (warmupState === 'warming') {
    return <WarmupScreen onReady={handleWarmupReady} />
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />
      case 'redemptions':
        return <RedemptionCenter />
      case 'topups':
        return <TopUps />
      case 'risk':
        return <RealtimeRanking />
      case 'abuse-broadcast':
        return <AbuseBroadcast />
      case 'ip-analysis':
        return <IPAnalysis />
      case 'analytics':
        return <Analytics />
      case 'model-status':
        return <ModelStatusMonitor />
      case 'users':
        return <UserManagement />
      case 'tokens':
        return <Tokens />
      case 'auto-group':
        return <AutoGroup />
      default:
        return <Dashboard />
    }
  }

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab} onLogout={logout}>
      <Suspense
        fallback={
          <div className="min-h-[400px] flex items-center justify-center">
            <div className="w-8 h-8 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
          </div>
        }
      >
        {renderContent()}
      </Suspense>
    </Layout>
  )
}

export default App

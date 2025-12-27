import { useState, useEffect } from 'react'
import { Login, Layout, TabType, Generator, History, TopUps, Dashboard, Redemptions, Analytics, UserManagement, RealtimeRanking } from './components'
import { useAuth } from './contexts/AuthContext'
import { WarmupScreen } from './components/WarmupScreen'

// Valid tabs
const validTabs: TabType[] = ['dashboard', 'topups', 'risk', 'analytics', 'users', 'generator', 'redemptions', 'history']

// Get initial tab from URL pathname (supports sub-routes like /risk/ip)
const getInitialTab = (): TabType => {
  const pathname = window.location.pathname.slice(1) // Remove leading /
  const mainPath = pathname.split('/')[0] // Get first segment for main tab

  if (validTabs.includes(mainPath as TabType)) {
    return mainPath as TabType
  }
  // 兼容旧的 hash 路由，自动迁移
  const hash = window.location.hash.slice(1)
  // 处理 #risk/ip 等格式
  const hashMain = hash.split('/')[0].replace('risk-', 'risk/')
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
  }, [isAuthenticated, token, apiUrl])

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
        <div className="animate-pulse text-muted-foreground">正在连接服务器...</div>
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
      case 'generator':
        return <Generator />
      case 'redemptions':
        return <Redemptions />
      case 'history':
        return <History />
      case 'topups':
        return <TopUps />
      case 'risk':
        return <RealtimeRanking />
      case 'analytics':
        return <Analytics />
      case 'users':
        return <UserManagement />
      default:
        return <Dashboard />
    }
  }

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab} onLogout={logout}>
      {renderContent()}
    </Layout>
  )
}

export default App

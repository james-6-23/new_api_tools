import { useState, useEffect } from 'react'
import { Login, Layout, TabType, Generator, History, TopUps, Dashboard, Redemptions, Analytics, UserManagement, RealtimeRanking } from './components'
import { useAuth } from './contexts/AuthContext'

// Valid tabs
const validTabs: TabType[] = ['dashboard', 'topups', 'risk', 'analytics', 'users', 'generator', 'redemptions', 'history']

// Get initial tab from URL hash
const getInitialTab = (): TabType => {
  const hash = window.location.hash.slice(1) // Remove #
  if (validTabs.includes(hash as TabType)) {
    return hash as TabType
  }
  return 'dashboard'
}

function App() {
  const { isAuthenticated, login, logout } = useAuth()
  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab)

  // Sync tab with URL hash
  useEffect(() => {
    window.location.hash = activeTab
  }, [activeTab])

  // Listen for hash changes (browser back/forward)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1)
      if (validTabs.includes(hash as TabType)) {
        setActiveTab(hash as TabType)
      }
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  if (!isAuthenticated) {
    return <Login onLogin={login} />
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

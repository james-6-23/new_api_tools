import { useState } from 'react'
import { Login, Layout, TabType, Generator, History, TopUps, Dashboard, Redemptions } from './components'
import { useAuth } from './contexts/AuthContext'

function App() {
  const { isAuthenticated, login, logout } = useAuth()
  const [activeTab, setActiveTab] = useState<TabType>('dashboard')

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

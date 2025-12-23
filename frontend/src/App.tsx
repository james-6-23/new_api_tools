import { useState } from 'react'
import { Login, Layout, TabType, Generator, History, TopUps } from './components'
import { useAuth } from './contexts/AuthContext'

function App() {
  const { isAuthenticated, login, logout } = useAuth()
  const [activeTab, setActiveTab] = useState<TabType>('generator')

  if (!isAuthenticated) {
    return <Login onLogin={login} />
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'generator':
        return <Generator />
      case 'history':
        return <History />
      case 'topups':
        return <TopUps />
      default:
        return <Generator />
    }
  }

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab} onLogout={logout}>
      {renderContent()}
    </Layout>
  )
}

export default App

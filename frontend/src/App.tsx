import { useState } from 'react'
import { Login, Layout, TabType, Generator, History } from './components'
import { useAuth } from './contexts/AuthContext'

function App() {
  const { isAuthenticated, login, logout } = useAuth()
  const [activeTab, setActiveTab] = useState<TabType>('generator')

  if (!isAuthenticated) {
    return <Login onLogin={login} />
  }

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab} onLogout={logout}>
      {activeTab === 'generator' ? (
        <Generator />
      ) : (
        <History />
      )}
    </Layout>
  )
}

export default App

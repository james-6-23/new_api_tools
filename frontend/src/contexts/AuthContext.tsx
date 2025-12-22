import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react'

const TOKEN_KEY = 'newapi_tools_token'
const TOKEN_EXPIRY_KEY = 'newapi_tools_token_expiry'

interface AuthContextType {
  isAuthenticated: boolean
  token: string | null
  login: (password: string) => Promise<boolean>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [token, setToken] = useState<string | null>(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY)
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY)
    
    if (savedToken && expiry) {
      const expiryTime = parseInt(expiry, 10)
      if (Date.now() < expiryTime) {
        return savedToken
      }
      // Token expired, clear it
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(TOKEN_EXPIRY_KEY)
    }
    return null
  })

  const isAuthenticated = token !== null

  // Check token expiry periodically
  useEffect(() => {
    const checkExpiry = () => {
      const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY)
      if (expiry && Date.now() >= parseInt(expiry, 10)) {
        setToken(null)
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(TOKEN_EXPIRY_KEY)
      }
    }

    const interval = setInterval(checkExpiry, 60000) // Check every minute
    return () => clearInterval(interval)
  }, [])

  const login = useCallback(async (password: string): Promise<boolean> => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
      const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      })

      if (!response.ok) {
        return false
      }

      const data = await response.json()
      if (data.success && data.data?.token) {
        const newToken = data.data.token
        // Default 24 hours expiry
        const expiryTime = Date.now() + (data.data.expires_in || 86400) * 1000
        
        setToken(newToken)
        localStorage.setItem(TOKEN_KEY, newToken)
        localStorage.setItem(TOKEN_EXPIRY_KEY, expiryTime.toString())
        return true
      }
      return false
    } catch (error) {
      console.error('Login error:', error)
      return false
    }
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(TOKEN_EXPIRY_KEY)
  }, [])

  return (
    <AuthContext.Provider value={{ isAuthenticated, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

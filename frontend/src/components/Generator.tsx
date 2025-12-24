import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { GeneratorForm, GenerateFormData } from './GeneratorForm'
import { ResultModal, GenerateResult } from './ResultModal'
import { addHistoryItem, HistoryItem } from './History'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card'
import { Sparkles } from 'lucide-react'

interface ApiResponse {
  success: boolean
  message: string
  data?: {
    keys: string[]
    count: number
  }
  error?: {
    code: string
    message: string
  }
}

export function Generator() {
  const { token } = useAuth()
  const { showToast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [showModal, setShowModal] = useState(false)

  const handleSubmit = async (formData: GenerateFormData) => {
    setIsLoading(true)

    try {
      const apiUrl = import.meta.env.VITE_API_URL || ''
      const requestBody: Record<string, unknown> = {
        name: formData.name,
        count: formData.count,
        key_prefix: formData.key_prefix || '',
        quota_mode: formData.quota_mode,
        expire_mode: formData.expire_mode,
      }

      if (formData.quota_mode === 'fixed') {
        requestBody.fixed_amount = formData.fixed_amount
      } else {
        requestBody.min_amount = formData.min_amount
        requestBody.max_amount = formData.max_amount
      }

      if (formData.expire_mode === 'days') {
        requestBody.expire_days = formData.expire_days
      } else if (formData.expire_mode === 'date') {
        requestBody.expire_date = new Date(formData.expire_date).toISOString()
      }

      const response = await fetch(`${apiUrl}/api/redemptions/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
      })

      const data: ApiResponse = await response.json()

      if (!response.ok) {
        showToast('error', data.error?.message || data.message || '生成失败')
        return
      }

      if (data.success && data.data) {
        const generateResult: GenerateResult = {
          keys: data.data.keys,
          count: data.data.count,
          name: formData.name,
        }
        setResult(generateResult)
        setShowModal(true)
        await saveToHistory(formData, data.data)
      } else {
        showToast('error', data.message || '生成失败')
      }
    } catch (error) {
      console.error('Generate error:', error)
      showToast('error', '网络错误，请检查后端服务是否运行')
    } finally {
      setIsLoading(false)
    }
  }

  const saveToHistory = async (formData: GenerateFormData, resultData: { keys: string[]; count: number }) => {
    try {
      const historyItem: HistoryItem = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        name: formData.name,
        count: resultData.count,
        keys: resultData.keys,
        quota_mode: formData.quota_mode,
        expire_mode: formData.expire_mode,
      }
      await addHistoryItem(historyItem)
    } catch (error) {
      console.error('Failed to save history:', error)
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">生成器</h2>
        <p className="text-muted-foreground mt-1">批量生成新的额度兑换码</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            配置参数
          </CardTitle>
          <CardDescription>
            填写以下信息以生成兑换码，生成后的兑换码可以在"兑换码管理"中查看。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GeneratorForm onSubmit={handleSubmit} isLoading={isLoading} />
        </CardContent>
      </Card>

      {showModal && result && (
        <ResultModal result={result} onClose={() => { setShowModal(false); setResult(null) }} />
      )}
    </div>
  )
}

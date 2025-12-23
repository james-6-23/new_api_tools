import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { GeneratorForm, GenerateFormData } from './GeneratorForm'
import { GeneratorResult, GenerateResult } from './GeneratorResult'
import { addHistoryItem, HistoryItem } from './History'

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

  const handleSubmit = async (formData: GenerateFormData) => {
    setIsLoading(true)

    try {
      const apiUrl = import.meta.env.VITE_API_URL || ''
      
      // Build request body based on form data
      const requestBody: Record<string, unknown> = {
        name: formData.name,
        count: formData.count,
        key_prefix: formData.key_prefix || '',
        quota_mode: formData.quota_mode,
        expire_mode: formData.expire_mode,
      }

      // Add quota-related fields based on mode
      if (formData.quota_mode === 'fixed') {
        requestBody.fixed_amount = formData.fixed_amount
      } else {
        requestBody.min_amount = formData.min_amount
        requestBody.max_amount = formData.max_amount
      }

      // Add expiration-related fields based on mode
      if (formData.expire_mode === 'days') {
        requestBody.expire_days = formData.expire_days
      } else if (formData.expire_mode === 'date') {
        // Convert local datetime to ISO 8601 format
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
        const errorMessage = data.error?.message || data.message || '生成失败'
        showToast('error', errorMessage)
        return
      }

      if (data.success && data.data) {
        setResult({
          keys: data.data.keys,
          count: data.data.count,
        })
        showToast('success', `成功添加 ${data.data.count} 个兑换码`)
        
        // Save to history in localStorage
        saveToHistory(formData, data.data)
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

  const saveToHistory = (formData: GenerateFormData, resultData: GenerateResult) => {
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
      addHistoryItem(historyItem)
    } catch (error) {
      console.error('Failed to save history:', error)
    }
  }

  const handleReset = () => {
    setResult(null)
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-6">
        添加兑换码
      </h2>
      
      {result ? (
        <GeneratorResult result={result} onReset={handleReset} />
      ) : (
        <GeneratorForm onSubmit={handleSubmit} isLoading={isLoading} />
      )}
    </div>
  )
}

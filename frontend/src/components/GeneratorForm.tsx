import { useState } from 'react'

export type QuotaMode = 'fixed' | 'random'
export type ExpireMode = 'never' | 'days' | 'date'

export interface GenerateFormData {
  name: string
  count: number
  key_prefix: string
  quota_mode: QuotaMode
  fixed_amount: number
  min_amount: number
  max_amount: number
  expire_mode: ExpireMode
  expire_days: number
  expire_date: string
}

interface GeneratorFormProps {
  onSubmit: (data: GenerateFormData) => void
  isLoading: boolean
}

const defaultFormData: GenerateFormData = {
  name: '',
  count: 1,
  key_prefix: '',
  quota_mode: 'fixed',
  fixed_amount: 1,
  min_amount: 1,
  max_amount: 10,
  expire_mode: 'never',
  expire_days: 30,
  expire_date: '',
}

export function GeneratorForm({ onSubmit, isLoading }: GeneratorFormProps) {
  const [formData, setFormData] = useState<GenerateFormData>(defaultFormData)
  const [errors, setErrors] = useState<Partial<Record<keyof GenerateFormData, string>>>({})

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof GenerateFormData, string>> = {}

    if (!formData.name.trim()) {
      newErrors.name = '请输入兑换码名称'
    }

    if (formData.count < 1 || formData.count > 1000) {
      newErrors.count = '数量必须在 1-1000 之间'
    }

    if (formData.key_prefix.length > 20) {
      newErrors.key_prefix = '前缀最多 20 个字符'
    }

    if (formData.quota_mode === 'fixed') {
      if (formData.fixed_amount <= 0) {
        newErrors.fixed_amount = '固定额度必须大于 0'
      }
    } else {
      if (formData.min_amount <= 0) {
        newErrors.min_amount = '最小额度必须大于 0'
      }
      if (formData.max_amount <= 0) {
        newErrors.max_amount = '最大额度必须大于 0'
      }
      if (formData.min_amount > formData.max_amount) {
        newErrors.max_amount = '最大额度必须大于等于最小额度'
      }
    }

    if (formData.expire_mode === 'days') {
      if (formData.expire_days < 1) {
        newErrors.expire_days = '过期天数必须大于 0'
      }
    } else if (formData.expire_mode === 'date') {
      if (!formData.expire_date) {
        newErrors.expire_date = '请选择过期日期'
      } else {
        const selectedDate = new Date(formData.expire_date)
        if (selectedDate <= new Date()) {
          newErrors.expire_date = '过期日期必须在未来'
        }
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (validateForm()) {
      onSubmit(formData)
    }
  }

  const updateField = <K extends keyof GenerateFormData>(
    field: K,
    value: GenerateFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    // Clear error when field is updated
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 基本信息 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 名称 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            兑换码名称 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => updateField('name', e.target.value)}
            placeholder="例如: 新用户福利"
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
              errors.name ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {errors.name && (
            <p className="mt-1 text-sm text-red-500">{errors.name}</p>
          )}
        </div>

        {/* 数量 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            生成数量 <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min={1}
            max={1000}
            value={formData.count}
            onChange={(e) => updateField('count', parseInt(e.target.value) || 1)}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
              errors.count ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {errors.count && (
            <p className="mt-1 text-sm text-red-500">{errors.count}</p>
          )}
        </div>
      </div>

      {/* 前缀 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Key 前缀 (可选)
        </label>
        <input
          type="text"
          value={formData.key_prefix}
          onChange={(e) => updateField('key_prefix', e.target.value)}
          placeholder="例如: VIP"
          maxLength={20}
          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
            errors.key_prefix ? 'border-red-500' : 'border-gray-300'
          }`}
        />
        <p className="mt-1 text-xs text-gray-500">
          最多 20 个字符，将作为兑换码的前缀
        </p>
        {errors.key_prefix && (
          <p className="mt-1 text-sm text-red-500">{errors.key_prefix}</p>
        )}
      </div>

      {/* 额度模式 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          额度模式
        </label>
        <div className="flex space-x-4 mb-3">
          <label className="flex items-center">
            <input
              type="radio"
              name="quota_mode"
              value="fixed"
              checked={formData.quota_mode === 'fixed'}
              onChange={() => updateField('quota_mode', 'fixed')}
              className="mr-2 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">固定额度</span>
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              name="quota_mode"
              value="random"
              checked={formData.quota_mode === 'random'}
              onChange={() => updateField('quota_mode', 'random')}
              className="mr-2 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">随机额度</span>
          </label>
        </div>

        {formData.quota_mode === 'fixed' ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              固定额度 (USD)
            </label>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={formData.fixed_amount}
              onChange={(e) => updateField('fixed_amount', parseFloat(e.target.value) || 0)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors.fixed_amount ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            <p className="mt-1 text-xs text-gray-500">
              1 USD = 500,000 Token
            </p>
            {errors.fixed_amount && (
              <p className="mt-1 text-sm text-red-500">{errors.fixed_amount}</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                最小额度 (USD)
              </label>
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={formData.min_amount}
                onChange={(e) => updateField('min_amount', parseFloat(e.target.value) || 0)}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  errors.min_amount ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {errors.min_amount && (
                <p className="mt-1 text-sm text-red-500">{errors.min_amount}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                最大额度 (USD)
              </label>
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={formData.max_amount}
                onChange={(e) => updateField('max_amount', parseFloat(e.target.value) || 0)}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  errors.max_amount ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {errors.max_amount && (
                <p className="mt-1 text-sm text-red-500">{errors.max_amount}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 过期模式 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          过期模式
        </label>
        <div className="flex flex-wrap gap-4 mb-3">
          <label className="flex items-center">
            <input
              type="radio"
              name="expire_mode"
              value="never"
              checked={formData.expire_mode === 'never'}
              onChange={() => updateField('expire_mode', 'never')}
              className="mr-2 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">永不过期</span>
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              name="expire_mode"
              value="days"
              checked={formData.expire_mode === 'days'}
              onChange={() => updateField('expire_mode', 'days')}
              className="mr-2 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">指定天数</span>
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              name="expire_mode"
              value="date"
              checked={formData.expire_mode === 'date'}
              onChange={() => updateField('expire_mode', 'date')}
              className="mr-2 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">指定日期</span>
          </label>
        </div>

        {formData.expire_mode === 'days' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              过期天数
            </label>
            <input
              type="number"
              min={1}
              value={formData.expire_days}
              onChange={(e) => updateField('expire_days', parseInt(e.target.value) || 1)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors.expire_days ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {errors.expire_days && (
              <p className="mt-1 text-sm text-red-500">{errors.expire_days}</p>
            )}
          </div>
        )}

        {formData.expire_mode === 'date' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              过期日期
            </label>
            <input
              type="datetime-local"
              value={formData.expire_date}
              onChange={(e) => updateField('expire_date', e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors.expire_date ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {errors.expire_date && (
              <p className="mt-1 text-sm text-red-500">{errors.expire_date}</p>
            )}
          </div>
        )}
      </div>

      {/* 提交按钮 */}
      <div className="pt-4">
        <button
          type="submit"
          disabled={isLoading}
          className={`w-full py-3 px-4 rounded-lg font-medium text-white transition-colors ${
            isLoading
              ? 'bg-blue-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center">
              <svg
                className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              添加中...
            </span>
          ) : (
            '添加兑换码'
          )}
        </button>
      </div>
    </form>
  )
}

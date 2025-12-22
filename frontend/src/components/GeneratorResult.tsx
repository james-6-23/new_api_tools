import { useState } from 'react'
import { useToast } from './Toast'

export interface GenerateResult {
  keys: string[]
  count: number
  sql: string
}

interface GeneratorResultProps {
  result: GenerateResult
  onReset: () => void
}

export function GeneratorResult({ result, onReset }: GeneratorResultProps) {
  const { showToast } = useToast()
  const [showAllKeys, setShowAllKeys] = useState(false)

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('success', `${label}已复制到剪贴板`)
    } catch {
      showToast('error', '复制失败，请手动复制')
    }
  }

  const copySQL = () => {
    copyToClipboard(result.sql, 'SQL 语句')
  }

  const copyKeys = () => {
    copyToClipboard(result.keys.join('\n'), '兑换码')
  }

  const downloadKeys = () => {
    const content = result.keys.join('\n')
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `redemption_keys_${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    showToast('success', '兑换码已下载')
  }

  const displayedKeys = showAllKeys ? result.keys : result.keys.slice(0, 10)
  const hasMoreKeys = result.keys.length > 10

  return (
    <div className="space-y-6">
      {/* 成功提示 */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start">
        <svg
          className="w-5 h-5 text-green-500 mt-0.5 mr-3 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
        <div>
          <h3 className="text-sm font-medium text-green-800">生成成功</h3>
          <p className="mt-1 text-sm text-green-700">
            成功生成 {result.count} 个兑换码
          </p>
        </div>
      </div>

      {/* SQL 语句 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">
            SQL 语句
          </label>
          <button
            onClick={copySQL}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
          >
            <svg
              className="w-4 h-4 mr-1"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            复制 SQL
          </button>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
          <pre className="text-sm text-green-400 whitespace-pre-wrap break-all">
            {result.sql}
          </pre>
        </div>
      </div>

      {/* 兑换码列表 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">
            兑换码列表 ({result.count} 个)
          </label>
          <div className="flex space-x-3">
            <button
              onClick={copyKeys}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
            >
              <svg
                className="w-4 h-4 mr-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              复制全部
            </button>
            <button
              onClick={downloadKeys}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
            >
              <svg
                className="w-4 h-4 mr-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              下载
            </button>
          </div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-64 overflow-y-auto">
          <div className="space-y-1">
            {displayedKeys.map((key, index) => (
              <div
                key={index}
                className="flex items-center justify-between py-1 px-2 hover:bg-gray-100 rounded group"
              >
                <code className="text-sm text-gray-800 font-mono">{key}</code>
                <button
                  onClick={() => copyToClipboard(key, '兑换码')}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity"
                  title="复制"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          {hasMoreKeys && !showAllKeys && (
            <button
              onClick={() => setShowAllKeys(true)}
              className="mt-3 text-sm text-blue-600 hover:text-blue-800"
            >
              显示全部 {result.keys.length} 个兑换码
            </button>
          )}
          {hasMoreKeys && showAllKeys && (
            <button
              onClick={() => setShowAllKeys(false)}
              className="mt-3 text-sm text-blue-600 hover:text-blue-800"
            >
              收起
            </button>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex justify-end pt-4 border-t">
        <button
          onClick={onReset}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
        >
          继续生成
        </button>
      </div>
    </div>
  )
}

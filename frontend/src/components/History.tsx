import { useState, useEffect } from 'react'
import { useToast } from './Toast'

export interface HistoryItem {
  id: string
  timestamp: string
  name: string
  count: number
  keys: string[]
  sql: string
  quota_mode: 'fixed' | 'random'
  expire_mode: 'never' | 'days' | 'date'
}

const HISTORY_KEY = 'newapi_tools_history'
const MAX_HISTORY_ITEMS = 20

// localStorage management functions
export function getHistory(): HistoryItem[] {
  try {
    const data = localStorage.getItem(HISTORY_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

export function saveHistory(items: HistoryItem[]): void {
  try {
    const limitedItems = items.slice(0, MAX_HISTORY_ITEMS)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(limitedItems))
  } catch (error) {
    console.error('Failed to save history:', error)
  }
}

export function addHistoryItem(item: HistoryItem): void {
  const history = getHistory()
  const newHistory = [item, ...history].slice(0, MAX_HISTORY_ITEMS)
  saveHistory(newHistory)
}

export function deleteHistoryItem(id: string): HistoryItem[] {
  const history = getHistory()
  const newHistory = history.filter(item => item.id !== id)
  saveHistory(newHistory)
  return newHistory
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY)
}

export function History() {
  const { showToast } = useToast()
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    setHistoryItems(getHistory())
  }, [])


  const copyToClipboard = async (text: string, label: string) => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        showToast('success', `${label}已复制到剪贴板`)
        return
      }

      // Fallback for HTTP or older browsers
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      textArea.style.top = '-9999px'
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()

      const successful = document.execCommand('copy')
      document.body.removeChild(textArea)

      if (successful) {
        showToast('success', `${label}已复制到剪贴板`)
      } else {
        showToast('error', '复制失败，请手动复制')
      }
    } catch {
      showToast('error', '复制失败，请手动复制')
    }
  }

  const handleCopySQL = (sql: string) => {
    copyToClipboard(sql, 'SQL 语句')
  }

  const handleCopyKeys = (keys: string[]) => {
    copyToClipboard(keys.join('\n'), '兑换码')
  }

  const handleDownloadKeys = (item: HistoryItem) => {
    const content = item.keys.join('\n')
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${item.name}_keys_${item.timestamp.slice(0, 10)}.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    showToast('success', '兑换码已下载')
  }

  const handleDelete = (id: string) => {
    const newHistory = deleteHistoryItem(id)
    setHistoryItems(newHistory)
    showToast('success', '记录已删除')
  }

  const handleClearAll = () => {
    if (window.confirm('确定要清空所有历史记录吗？')) {
      clearHistory()
      setHistoryItems([])
      showToast('success', '历史记录已清空')
    }
  }

  const formatDate = (isoString: string) => {
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getQuotaModeLabel = (mode: string) => {
    return mode === 'fixed' ? '固定额度' : '随机额度'
  }

  const getExpireModeLabel = (mode: string) => {
    switch (mode) {
      case 'never': return '永不过期'
      case 'days': return '按天数'
      case 'date': return '指定日期'
      default: return mode
    }
  }

  if (historyItems.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">历史记录</h2>
        <div className="text-center py-12">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">暂无历史记录</h3>
          <p className="mt-1 text-sm text-gray-500">生成兑换码后会自动保存到这里</p>
        </div>
      </div>
    )
  }


  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-medium text-gray-900">
          历史记录 ({historyItems.length})
        </h2>
        <button
          onClick={handleClearAll}
          className="text-sm text-red-600 hover:text-red-800 flex items-center"
        >
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          清空全部
        </button>
      </div>

      <div className="space-y-4">
        {historyItems.map((item) => (
          <div
            key={item.id}
            className="border border-gray-200 rounded-lg overflow-hidden"
          >
            {/* Header */}
            <div
              className="flex items-center justify-between p-4 bg-gray-50 cursor-pointer hover:bg-gray-100"
              onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-3">
                  <h3 className="text-sm font-medium text-gray-900 truncate">
                    {item.name}
                  </h3>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                    {item.count} 个
                  </span>
                </div>
                <div className="mt-1 flex items-center space-x-4 text-xs text-gray-500">
                  <span>{formatDate(item.timestamp)}</span>
                  <span>{getQuotaModeLabel(item.quota_mode)}</span>
                  <span>{getExpireModeLabel(item.expire_mode)}</span>
                </div>
              </div>
              <div className="flex items-center space-x-2 ml-4">
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopySQL(item.sql) }}
                  className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-white"
                  title="复制 SQL"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDownloadKeys(item) }}
                  className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-white"
                  title="下载兑换码"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(item.id) }}
                  className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-white"
                  title="删除"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                <svg
                  className={`w-5 h-5 text-gray-400 transition-transform ${expandedId === item.id ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Expanded Content */}
            {expandedId === item.id && (
              <div className="p-4 border-t border-gray-200 space-y-4">
                {/* SQL */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">SQL 语句</label>
                    <button
                      onClick={() => handleCopySQL(item.sql)}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      复制
                    </button>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
                    <pre className="text-xs text-green-400 whitespace-pre-wrap break-all">
                      {item.sql}
                    </pre>
                  </div>
                </div>

                {/* Keys */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">
                      兑换码 ({item.keys.length} 个)
                    </label>
                    <div className="flex space-x-3">
                      <button
                        onClick={() => handleCopyKeys(item.keys)}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        复制全部
                      </button>
                      <button
                        onClick={() => handleDownloadKeys(item)}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        下载
                      </button>
                    </div>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                    <div className="space-y-1">
                      {item.keys.slice(0, 20).map((key, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between py-1 px-2 hover:bg-gray-100 rounded group"
                        >
                          <code className="text-xs text-gray-800 font-mono">{key}</code>
                          <button
                            onClick={() => copyToClipboard(key, '兑换码')}
                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity"
                            title="复制"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                        </div>
                      ))}
                      {item.keys.length > 20 && (
                        <p className="text-xs text-gray-500 text-center pt-2">
                          还有 {item.keys.length - 20} 个兑换码，请下载查看完整列表
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

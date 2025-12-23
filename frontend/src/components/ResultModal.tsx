import { useEffect, useRef } from 'react'
import { useToast } from './Toast'

export interface GenerateResult {
  keys: string[]
  count: number
  name?: string
}

interface ResultModalProps {
  result: GenerateResult
  onClose: () => void
}

export function ResultModal({ result, onClose }: ResultModalProps) {
  const { showToast } = useToast()
  const modalRef = useRef<HTMLDivElement>(null)

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === modalRef.current) {
      onClose()
    }
  }

  const copyToClipboard = async (text: string, label: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        showToast('success', `${label}已复制到剪贴板`)
        return
      }

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

  const copyAllKeys = () => {
    copyToClipboard(result.keys.join('\n'), '全部兑换码')
  }

  const downloadKeys = () => {
    const content = result.keys.join('\n')
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${result.name || 'redemption'}_keys_${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    showToast('success', '兑换码已下载')
  }

  return (
    <div
      ref={modalRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-500 to-emerald-600 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-white bg-opacity-20 rounded-full p-2">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">添加成功</h2>
                <p className="text-green-100 text-sm">
                  已生成 {result.count} 个兑换码
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Main Copy Button */}
        <div className="px-6 py-4 border-b bg-gray-50">
          <button
            onClick={copyAllKeys}
            className="w-full flex items-center justify-center space-x-3 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors shadow-lg hover:shadow-xl"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span>复制全部兑换码</span>
          </button>
        </div>

        {/* Keys List */}
        <div className="px-6 py-4 max-h-[40vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700">兑换码列表</span>
            <button
              onClick={downloadKeys}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>下载 TXT</span>
            </button>
          </div>

          <div className="space-y-2">
            {result.keys.map((key, index) => (
              <div
                key={index}
                className="flex items-center justify-between bg-gray-50 hover:bg-gray-100 rounded-lg px-4 py-2.5 group transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <span className="text-xs text-gray-400 w-6">{index + 1}.</span>
                  <code className="text-sm font-mono text-gray-800 select-all">{key}</code>
                </div>
                <button
                  onClick={() => copyToClipboard(key, '兑换码')}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 p-1.5 rounded transition-all hover:bg-blue-50"
                  title="复制此兑换码"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t flex justify-between items-center">
          <p className="text-sm text-gray-500">
            提示：兑换码已自动保存到历史记录
          </p>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-lg transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

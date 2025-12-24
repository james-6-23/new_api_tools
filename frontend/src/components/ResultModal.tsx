import { useEffect, useRef } from 'react'
import { useToast } from './Toast'
import { CheckCircle, X, Copy, Download, ExternalLink } from 'lucide-react'
import { Button } from './ui/button'

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

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === modalRef.current) onClose()
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
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      showToast('success', `${label}已复制到剪贴板`)
    } catch {
      showToast('error', '复制失败，请手动复制')
    }
  }

  const copyAllKeys = () => copyToClipboard(result.keys.join('\n'), '全部兑换码')

  const copyAndGoToLinuxDo = async () => {
    await copyToClipboard(result.keys.join('\n'), '全部兑换码')
    window.open('https://cdk.linux.do/dashboard', '_blank')
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
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    >
      <div className="bg-card rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-500 to-emerald-600 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 rounded-full p-2">
                <CheckCircle className="h-6 w-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">添加成功</h2>
                <p className="text-green-100 text-sm">已生成 {result.count} 个兑换码</p>
              </div>
            </div>
            <button onClick={onClose} className="text-white hover:bg-white/20 rounded-full p-2 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Main Copy Buttons */}
        <div className="px-6 py-4 border-b bg-muted/50 space-y-2">
          <Button onClick={copyAllKeys} className="w-full" size="lg">
            <Copy className="h-5 w-5 mr-2" />
            复制全部兑换码
          </Button>
          <Button onClick={copyAndGoToLinuxDo} variant="outline" className="w-full" size="lg">
            <ExternalLink className="h-5 w-5 mr-2" />
            复制兑换码并前往 LINUX DO 分发站
          </Button>
        </div>

        {/* Keys List */}
        <div className="px-6 py-4 max-h-[40vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">兑换码列表</span>
            <Button variant="ghost" size="sm" onClick={downloadKeys}>
              <Download className="h-4 w-4 mr-1" />
              下载 TXT
            </Button>
          </div>

          <div className="space-y-2">
            {result.keys.map((key, index) => (
              <div
                key={index}
                className="flex items-center justify-between bg-muted hover:bg-muted/80 rounded-lg px-4 py-2.5 group transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-6">{index + 1}.</span>
                  <code className="text-sm font-mono select-all">{key}</code>
                </div>
                <button
                  onClick={() => copyToClipboard(key, '兑换码')}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary p-1.5 rounded transition-all"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-muted/50 border-t flex justify-between items-center">
          <p className="text-sm text-muted-foreground">提示：兑换码已自动保存到历史记录</p>
          <Button variant="secondary" onClick={onClose}>关闭</Button>
        </div>
      </div>
    </div>
  )
}

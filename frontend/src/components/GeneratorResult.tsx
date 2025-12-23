import { useState } from 'react'
import { useToast } from './Toast'
import { CheckCircle, Copy, Download } from 'lucide-react'
import { Button } from './ui/button'

export interface GenerateResult {
  keys: string[]
  count: number
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
      if (successful) showToast('success', `${label}已复制到剪贴板`)
      else showToast('error', '复制失败，请手动复制')
    } catch {
      showToast('error', '复制失败，请手动复制')
    }
  }

  const copyKeys = () => copyToClipboard(result.keys.join('\n'), '兑换码')

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
      <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-start">
        <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 mr-3 flex-shrink-0" />
        <div>
          <h3 className="text-sm font-medium text-green-800 dark:text-green-200">添加成功</h3>
          <p className="mt-1 text-sm text-green-700 dark:text-green-300">
            成功添加 {result.count} 个兑换码到数据库
          </p>
        </div>
      </div>

      {/* 兑换码列表 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium">兑换码列表 ({result.count} 个)</label>
          <div className="flex space-x-3">
            <button onClick={copyKeys} className="text-sm text-primary hover:text-primary/80 flex items-center">
              <Copy className="w-4 h-4 mr-1" />
              复制全部
            </button>
            <button onClick={downloadKeys} className="text-sm text-primary hover:text-primary/80 flex items-center">
              <Download className="w-4 h-4 mr-1" />
              下载
            </button>
          </div>
        </div>
        <div className="bg-muted border rounded-lg p-4 max-h-64 overflow-y-auto">
          <div className="space-y-1">
            {displayedKeys.map((key, index) => (
              <div key={index} className="flex items-center justify-between py-1 px-2 hover:bg-background rounded group">
                <code className="text-sm font-mono">{key}</code>
                <button
                  onClick={() => copyToClipboard(key, '兑换码')}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                  title="复制"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          {hasMoreKeys && !showAllKeys && (
            <button onClick={() => setShowAllKeys(true)} className="mt-3 text-sm text-primary hover:text-primary/80">
              显示全部 {result.keys.length} 个兑换码
            </button>
          )}
          {hasMoreKeys && showAllKeys && (
            <button onClick={() => setShowAllKeys(false)} className="mt-3 text-sm text-primary hover:text-primary/80">
              收起
            </button>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex justify-end pt-4 border-t">
        <Button variant="secondary" onClick={onReset}>继续添加</Button>
      </div>
    </div>
  )
}

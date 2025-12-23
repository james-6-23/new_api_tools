import { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'
import * as db from '../services/indexedDB'
import { Clock, Copy, Download, Trash2, ChevronDown, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

export interface HistoryItem {
  id: string
  timestamp: string
  name: string
  count: number
  keys: string[]
  quota_mode: 'fixed' | 'random'
  expire_mode: 'never' | 'days' | 'date'
}

const MAX_HISTORY_ITEMS = 100

export async function addHistoryItem(item: HistoryItem): Promise<void> {
  try {
    await db.addHistoryRecord({ name: item.name, quota: 0, count: item.count, keys: item.keys })
  } catch (error) {
    console.error('Failed to add history item:', error)
  }
}

export async function clearHistory(): Promise<void> {
  await db.clearHistory()
}

export function History() {
  const { showToast } = useToast()
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [clearDialog, setClearDialog] = useState(false)

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true)
      await db.initializeStorage()
      const records = await db.getHistoryRecords(MAX_HISTORY_ITEMS)
      const items: HistoryItem[] = records.map(record => ({
        id: record.id,
        timestamp: new Date(record.timestamp).toISOString(),
        name: record.name,
        count: record.count,
        keys: record.keys,
        quota_mode: 'fixed' as const,
        expire_mode: 'never' as const,
      }))
      setHistoryItems(items)
    } catch (error) {
      console.error('Failed to load history:', error)
      showToast('error', '加载历史记录失败')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { loadHistory() }, [loadHistory])

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
    } catch { showToast('error', '复制失败，请手动复制') }
  }

  const handleCopyKeys = (keys: string[]) => copyToClipboard(keys.join('\n'), '兑换码')

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

  const handleDelete = async (id: string) => {
    try {
      await db.deleteHistoryRecord(id)
      setHistoryItems(prev => prev.filter(item => item.id !== id))
      showToast('success', '记录已删除')
    } catch (error) {
      console.error('Failed to delete history item:', error)
      showToast('error', '删除失败')
    }
  }

  const handleClearAll = async () => {
    try {
      await db.clearHistory()
      setHistoryItems([])
      showToast('success', '历史记录已清空')
    } catch (error) {
      console.error('Failed to clear history:', error)
      showToast('error', '清空失败')
    } finally {
      setClearDialog(false)
    }
  }

  const formatDate = (isoString: string) => new Date(isoString).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  const getQuotaModeLabel = (mode: string) => mode === 'fixed' ? '固定额度' : '随机额度'
  const getExpireModeLabel = (mode: string) => mode === 'never' ? '永不过期' : mode === 'days' ? '按天数' : '指定日期'

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>历史记录</CardTitle></CardHeader>
        <CardContent>
          <div className="flex justify-center items-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (historyItems.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>历史记录</CardTitle></CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <Clock className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-2 text-sm font-medium">暂无历史记录</h3>
            <p className="mt-1 text-sm text-muted-foreground">添加兑换码后会自动保存到这里</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>历史记录 ({historyItems.length})</CardTitle>
        <Button variant="destructive" size="sm" onClick={() => setClearDialog(true)}>
          <Trash2 className="h-4 w-4 mr-1" />
          清空全部
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {historyItems.map((item) => (
          <div key={item.id} className="border rounded-lg overflow-hidden">
            <div
              className="flex items-center justify-between p-4 bg-muted/50 cursor-pointer hover:bg-muted"
              onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-medium truncate">{item.name}</h3>
                  <Badge variant="secondary">{item.count} 个</Badge>
                </div>
                <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{formatDate(item.timestamp)}</span>
                  <span>{getQuotaModeLabel(item.quota_mode)}</span>
                  <span>{getExpireModeLabel(item.expire_mode)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleCopyKeys(item.keys) }} title="复制兑换码">
                  <Copy className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDownloadKeys(item) }} title="下载兑换码">
                  <Download className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDelete(item.id) }} title="删除" className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
                <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${expandedId === item.id ? 'rotate-180' : ''}`} />
              </div>
            </div>

            {expandedId === item.id && (
              <div className="p-4 border-t space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium">兑换码 ({item.keys.length} 个)</label>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => handleCopyKeys(item.keys)}>复制全部</Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDownloadKeys(item)}>下载</Button>
                    </div>
                  </div>
                  <div className="bg-muted rounded-lg p-3 max-h-48 overflow-y-auto space-y-1">
                    {item.keys.slice(0, 20).map((key, index) => (
                      <div key={index} className="flex items-center justify-between py-1 px-2 hover:bg-background rounded group">
                        <code className="text-xs font-mono">{key}</code>
                        <button onClick={() => copyToClipboard(key, '兑换码')} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity">
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {item.keys.length > 20 && (
                      <p className="text-xs text-muted-foreground text-center pt-2">还有 {item.keys.length - 20} 个兑换码，请下载查看完整列表</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={clearDialog} onOpenChange={setClearDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认清空</DialogTitle>
            <DialogDescription>确定要清空所有历史记录吗？此操作不可恢复。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearDialog(false)}>取消</Button>
            <Button variant="destructive" onClick={handleClearAll}>确认清空</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

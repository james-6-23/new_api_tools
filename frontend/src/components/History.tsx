import { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'
import * as db from '../services/indexedDB'
import { Clock, Copy, Download, Trash2, ChevronDown, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { cn } from '../lib/utils'

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

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">生成记录</h2>
          <p className="text-muted-foreground mt-1">本地保存的兑换码生成历史</p>
        </div>
        {historyItems.length > 0 && (
          <Button variant="destructive" size="sm" onClick={() => setClearDialog(true)}>
            <Trash2 className="h-4 w-4 mr-2" />
            清空记录
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            历史列表
          </CardTitle>
          <CardDescription>
            这里显示最近生成的 {MAX_HISTORY_ITEMS} 条记录，数据仅保存在本地浏览器中。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : historyItems.length === 0 ? (
            <div className="text-center py-12 bg-muted/20 rounded-lg border border-dashed">
              <Clock className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
              <h3 className="mt-4 text-sm font-medium">暂无历史记录</h3>
              <p className="mt-1 text-sm text-muted-foreground">添加兑换码后会自动保存到这里</p>
            </div>
          ) : (
            <div className="space-y-3">
              {historyItems.map((item) => (
                <div key={item.id} className="border rounded-lg overflow-hidden transition-all duration-200 hover:shadow-md bg-card">
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-medium truncate">{item.name}</h3>
                        <Badge variant="secondary" className="text-xs font-normal">{item.count} 个</Badge>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(item.timestamp)}
                        </span>
                        <span className="hidden sm:inline">•</span>
                        <span>{getQuotaModeLabel(item.quota_mode)}</span>
                        <span className="hidden sm:inline">•</span>
                        <span>{getExpireModeLabel(item.expire_mode)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <div className="hidden sm:flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={(e) => { e.stopPropagation(); handleCopyKeys(item.keys) }} title="复制兑换码">
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={(e) => { e.stopPropagation(); handleDownloadKeys(item) }} title="下载兑换码">
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); handleDelete(item.id) }} title="删除">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform duration-200", expandedId === item.id && "rotate-180")} />
                    </div>
                  </div>

                  {expandedId === item.id && (
                    <div className="p-4 border-t bg-muted/30 space-y-4 animate-in slide-in-from-top-2 duration-200">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <label className="text-sm font-medium text-muted-foreground">兑换码列表</label>
                          <div className="flex gap-2 sm:hidden">
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleCopyKeys(item.keys)}>复制</Button>
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleDownloadKeys(item)}>下载</Button>
                          </div>
                        </div>
                        <div className="bg-background border rounded-lg p-3 max-h-48 overflow-y-auto space-y-1 custom-scrollbar">
                          {item.keys.slice(0, 20).map((key, index) => (
                            <div key={index} className="flex items-center justify-between py-1.5 px-2 hover:bg-muted rounded group transition-colors">
                              <code className="text-xs font-mono text-foreground/80">{key}</code>
                              <button 
                                onClick={() => copyToClipboard(key, '兑换码')} 
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-opacity p-1"
                                title="复制单个"
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                          {item.keys.length > 20 && (
                            <p className="text-xs text-muted-foreground text-center pt-2 pb-1">
                              ... 还有 {item.keys.length - 20} 个兑换码，请下载查看完整列表 ...
                            </p>
                          )}
                        </div>
                        
                        {/* Mobile Actions Footer in Expanded View */}
                        <div className="flex sm:hidden justify-end mt-4 pt-2 border-t">
                           <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8" onClick={() => handleDelete(item.id)}>
                              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> 删除记录
                           </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
    </div>
  )
}

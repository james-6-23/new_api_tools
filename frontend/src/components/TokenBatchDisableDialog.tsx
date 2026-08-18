import { useState, useCallback, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { Loader2, ShieldBan, Search, ArrowLeft, AlertTriangle } from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from './ui/dialog'
import { cn } from '../lib/utils'

interface LookupItem {
  input_key: string
  key_masked: string
  found: boolean
  id?: number
  name?: string
  user_id?: number
  username?: string
  status?: number
  expired_time?: number
  group?: string
  used_quota?: number
}

interface TokenBatchDisableDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  // 点击查询结果里的 Key / 用户名，弹出对应的分析弹窗
  onOpenToken?: (tokenId: number, tokenName: string) => void
  onOpenUser?: (userId: number, username: string) => void
}

export function TokenBatchDisableDialog({ open, onOpenChange, onSuccess, onOpenToken, onOpenUser }: TokenBatchDisableDialogProps) {
  const { token } = useAuth()
  const { showToast } = useToast()

  const [step, setStep] = useState<'input' | 'result'>('input')
  const [rawInput, setRawInput] = useState('')
  const [looking, setLooking] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [items, setItems] = useState<LookupItem[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  // 换行 / 逗号 / 分号 / 空白 分隔，去重
  const parsedKeys = useMemo(() => {
    const keys = rawInput.split(/[\n,;\s]+/).map((k) => k.trim()).filter(Boolean)
    return Array.from(new Set(keys))
  }, [rawInput])

  const isExpired = (t?: number) => !!t && t > 0 && t * 1000 < Date.now()

  // 可禁用 = 查到了且当前不是禁用状态
  const disableableIds = useMemo(
    () => items.filter((i) => i.found && i.status !== 2).map((i) => i.id!),
    [items]
  )

  const resetAll = () => {
    setStep('input')
    setItems([])
    setSelected(new Set())
    setConfirming(false)
  }

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      resetAll()
      setRawInput('')
    }
  }

  const handleLookup = async () => {
    if (parsedKeys.length === 0) return
    setLooking(true)
    try {
      const response = await fetch(`${apiUrl}/api/tokens/lookup`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ keys: parsedKeys }),
      })
      const data = await response.json()
      if (data.success) {
        const list: LookupItem[] = data.data.items || []
        setItems(list)
        // 默认全选所有可禁用的令牌
        setSelected(new Set(list.filter((i) => i.found && i.status !== 2).map((i) => i.id!)))
        setStep('result')
        if (data.data.found === 0) {
          showToast('error', '没有匹配到任何令牌，请确认 key 是否属于本站')
        }
      } else {
        showToast('error', data.message || '查询失败')
      }
    } catch (error) {
      showToast('error', '网络错误，请重试')
      console.error('Failed to lookup tokens:', error)
    } finally {
      setLooking(false)
    }
  }

  const handleDisable = async () => {
    if (selected.size === 0) return
    if (!confirming) {
      setConfirming(true)
      return
    }
    setDisabling(true)
    try {
      const response = await fetch(`${apiUrl}/api/tokens/batch-disable`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ids: Array.from(selected) }),
      })
      const data = await response.json()
      if (data.success) {
        showToast('success', `已禁用 ${data.data.disabled} 个令牌`)
        // 本地把已禁用的行置为禁用态，保留在列表中便于核对
        setItems((prev) => prev.map((i) => (i.id && selected.has(i.id) ? { ...i, status: 2 } : i)))
        setSelected(new Set())
        onSuccess()
      } else {
        showToast('error', data.message || '禁用失败')
      }
    } catch (error) {
      showToast('error', '网络错误，请重试')
      console.error('Failed to disable tokens:', error)
    } finally {
      setDisabling(false)
      setConfirming(false)
    }
  }

  const toggleOne = (id: number) => {
    setConfirming(false)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setConfirming(false)
    setSelected((prev) => (prev.size >= disableableIds.length ? new Set() : new Set(disableableIds)))
  }

  const getStatusBadge = (item: LookupItem) => {
    if (!item.found) return <Badge variant="secondary">未匹配</Badge>
    if (item.status === 2) return <Badge variant="secondary">已禁用</Badge>
    if (isExpired(item.expired_time)) return <Badge variant="destructive">已过期</Badge>
    if (item.status === 1) return <Badge variant="success">启用</Badge>
    return <Badge variant="secondary">不可用</Badge>
  }

  const formatQuota = (quota?: number) => `$${((quota || 0) / 500000).toFixed(2)}`

  const foundCount = items.filter((i) => i.found).length

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldBan className="w-5 h-5 text-red-500" />
            批量禁用令牌
          </DialogTitle>
          <DialogDescription>
            粘贴泄漏的令牌 Key（含或不含 sk- 前缀），用换行或逗号分隔。先查询数据库匹配所属令牌，确认后再批量禁用。
          </DialogDescription>
        </DialogHeader>

        {step === 'input' ? (
          <>
            <textarea
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder={'sk-...\nsk-...'}
              spellCheck={false}
              autoComplete="off"
              className="w-full h-64 rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/60 custom-scrollbar"
            />
            <div className="text-sm">
              <span className={cn('font-semibold', parsedKeys.length > 0 ? 'text-green-600' : 'text-muted-foreground')}>
                {parsedKeys.length}
              </span>
              <span className="text-muted-foreground"> 个可以查询</span>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>取消</Button>
              <Button onClick={handleLookup} disabled={parsedKeys.length === 0 || looking}>
                {looking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
                查询
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm">
              <div className="text-muted-foreground">
                共 {items.length} 个 key，匹配 <span className="font-semibold text-foreground">{foundCount}</span> 个令牌
                {items.length - foundCount > 0 && (
                  <span>，<span className="text-yellow-600 font-medium">{items.length - foundCount}</span> 个未匹配</span>
                )}
              </div>
              {disableableIds.length > 0 && (
                <button type="button" onClick={toggleAll} className="text-primary hover:underline text-sm">
                  {selected.size >= disableableIds.length ? '取消全选' : `全选 (${disableableIds.length})`}
                </button>
              )}
            </div>

            <div className="border rounded-lg overflow-y-auto max-h-[45vh] custom-scrollbar">
              <Table>
                <TableHeader className="bg-muted/50 sticky top-0">
                  <TableRow>
                    <TableHead className="w-[36px]"></TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead>所属用户</TableHead>
                    <TableHead>所属分组</TableHead>
                    <TableHead>已用额度</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const selectable = item.found && item.status !== 2
                    return (
                      <TableRow
                        key={item.input_key}
                        className={cn(
                          selectable && 'cursor-pointer hover:bg-muted/50',
                          !item.found && 'opacity-60'
                        )}
                        onClick={() => selectable && toggleOne(item.id!)}
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={!!item.id && selected.has(item.id)}
                            disabled={!selectable}
                            onChange={() => selectable && toggleOne(item.id!)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4 rounded border-input accent-red-500 cursor-pointer disabled:cursor-not-allowed"
                          />
                        </TableCell>
                        <TableCell>
                          {item.found && item.id && onOpenToken ? (
                            <code
                              className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors"
                              title={`${item.input_key}\n点击查看令牌分析`}
                              onClick={(e) => { e.stopPropagation(); onOpenToken(item.id!, item.name || '') }}
                            >
                              {item.key_masked}
                            </code>
                          ) : (
                            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded" title={item.input_key}>
                              {item.key_masked}
                            </code>
                          )}
                        </TableCell>
                        <TableCell className="text-sm max-w-[140px] truncate" title={item.name}>
                          {item.found ? item.name || '-' : '-'}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {item.found && item.user_id && item.user_id > 0 && onOpenUser ? (
                            <span
                              className="cursor-pointer text-primary hover:underline"
                              title="点击查看用户画像"
                              onClick={(e) => { e.stopPropagation(); onOpenUser(item.user_id!, item.username || `用户 #${item.user_id}`) }}
                            >
                              {item.username || `#${item.user_id}`}
                            </span>
                          ) : (
                            item.found ? item.username || `#${item.user_id}` : '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {item.found && item.group ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary whitespace-nowrap">{item.group}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">{item.found ? 'default' : '-'}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {item.found ? formatQuota(item.used_quota) : '-'}
                        </TableCell>
                        <TableCell>{getStatusBadge(item)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-yellow-500" />
              <span>
                禁用直接写入数据库（status=2）。若 NewAPI 启用了 Redis/内存缓存，已缓存的令牌可能需等待缓存过期后才完全失效。
              </span>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={resetAll} disabled={disabling}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                重新输入
              </Button>
              <Button
                variant="destructive"
                onClick={handleDisable}
                disabled={selected.size === 0 || disabling}
                className={cn(confirming && 'animate-pulse')}
              >
                {disabling ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <ShieldBan className="w-4 h-4 mr-2" />
                )}
                {confirming ? `再次点击确认禁用 ${selected.size} 个` : `禁用所选 (${selected.size})`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { Loader2, Plus, RefreshCw, Search, Shield, Trash2, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

interface WLUser {
  id: number
  username: string
  display_name?: string
  role?: number
  status?: number
  missing?: boolean
}

interface WLData {
  user_ids: number[]
  exclude_admins: boolean
  items: WLUser[]
  resolved_count: number
  resolved_ids: number[]
}

export function PanelWhitelist() {
  const { token } = useAuth()
  const { showToast } = useToast()
  const apiUrl = import.meta.env.VITE_API_URL || ''

  const [data, setData] = useState<WLData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<WLUser[]>([])
  const [manualId, setManualId] = useState('')

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiUrl}/api/panel-whitelist`, { headers: headers() })
      const json = await res.json()
      if (json.success) setData(json.data)
      else showToast('error', json.error?.message || '加载失败')
    } catch {
      showToast('error', '网络错误')
    } finally {
      setLoading(false)
    }
  }, [apiUrl, headers, showToast])

  useEffect(() => { fetchData() }, [fetchData])

  const toggleExcludeAdmins = async (checked: boolean) => {
    setSaving(true)
    try {
      const res = await fetch(`${apiUrl}/api/panel-whitelist`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({
          user_ids: data?.user_ids || [],
          exclude_admins: checked,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setData(json.data)
        showToast('success', '已更新：排除管理员')
      } else showToast('error', json.error?.message || '保存失败')
    } catch {
      showToast('error', '网络错误')
    } finally {
      setSaving(false)
    }
  }

  const addUser = async (userId: number) => {
    setSaving(true)
    try {
      const res = await fetch(`${apiUrl}/api/panel-whitelist/add`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ user_id: userId }),
      })
      const json = await res.json()
      if (json.success) {
        setData(json.data)
        showToast('success', `用户 #${userId} 已加入白名单`)
        setResults((prev) => prev.filter((u) => u.id !== userId))
      } else showToast('error', json.error?.message || '添加失败')
    } catch {
      showToast('error', '网络错误')
    } finally {
      setSaving(false)
    }
  }

  const removeUser = async (userId: number) => {
    setSaving(true)
    try {
      const res = await fetch(`${apiUrl}/api/panel-whitelist/remove`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ user_id: userId }),
      })
      const json = await res.json()
      if (json.success) {
        setData(json.data)
        showToast('success', `用户 #${userId} 已移除`)
      } else showToast('error', json.error?.message || '移除失败')
    } catch {
      showToast('error', '网络错误')
    } finally {
      setSaving(false)
    }
  }

  const doSearch = async () => {
    const q = searchQ.trim()
    if (!q) return
    setSearching(true)
    try {
      const res = await fetch(`${apiUrl}/api/panel-whitelist/search?q=${encodeURIComponent(q)}`, {
        headers: headers(),
      })
      const json = await res.json()
      if (json.success) setResults(Array.isArray(json.data) ? json.data : [])
      else showToast('error', json.error?.message || '搜索失败')
    } catch {
      showToast('error', '网络错误')
    } finally {
      setSearching(false)
    }
  }

  const addManual = async () => {
    const id = Number(manualId.trim())
    if (!Number.isFinite(id) || id <= 0) {
      showToast('error', '请输入有效的用户 ID')
      return
    }
    await addUser(id)
    setManualId('')
  }

  const inList = new Set(data?.user_ids || [])

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/15 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            全局面板白名单
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            白名单中的账号会从<strong className="text-foreground">充值记录、风控榜单、IP 分析、日志分析、令牌列表、用户列表、仪表盘排行</strong>等运营面板中过滤，
            避免管理员/测试号干扰统计。与 AI 封禁白名单相互独立。
          </p>
          <div className="flex flex-wrap gap-4 pt-1 text-foreground">
            <span>显式用户：<strong>{data?.user_ids?.length ?? 0}</strong></span>
            <span>实际过滤：<strong>{data?.resolved_count ?? 0}</strong>（含管理员展开）</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="font-medium">自动排除管理员</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              开启后，NewAPI 中 role ≥ 10 的账户自动从各面板隐藏（默认开启）
            </div>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={!!data?.exclude_admins}
              disabled={saving}
              onChange={(e) => toggleExcludeAdmins(e.target.checked)}
            />
            <span className="text-sm">{data?.exclude_admins ? '已开启' : '已关闭'}</span>
          </label>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Search className="h-4 w-4" />
              搜索添加
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="用户名或用户 ID"
                onKeyDown={(e) => e.key === 'Enter' && doSearch()}
              />
              <Button onClick={doSearch} disabled={searching || !searchQ.trim()}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : '搜索'}
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="直接输入用户 ID"
                className="font-mono"
              />
              <Button variant="outline" onClick={addManual} disabled={saving}>
                <Plus className="h-4 w-4 mr-1" />
                添加
              </Button>
            </div>
            {results.length > 0 && (
              <div className="rounded-md border divide-y max-h-56 overflow-y-auto">
                {results.map((u) => (
                  <div key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium">{u.username}</span>
                      <span className="text-xs text-muted-foreground ml-2">#{u.id}</span>
                      {(u.role ?? 0) >= 10 && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">管理员</Badge>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saving || inList.has(u.id)}
                      onClick={() => addUser(u.id)}
                    >
                      {inList.has(u.id) ? '已添加' : '加入'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              已加入白名单
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {(data?.items?.length ?? 0) === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                暂无显式白名单用户
                {data?.exclude_admins && (
                  <div className="mt-1 text-xs">管理员仍可能被「自动排除管理员」过滤</div>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>用户</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead className="w-16 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.items.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="font-medium">{u.username || `#${u.id}`}</div>
                        <div className="text-xs text-muted-foreground">ID: {u.id}</div>
                        {u.missing && (
                          <Badge variant="outline" className="text-[10px] mt-0.5">用户不存在</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {(u.role ?? 0) >= 100 ? 'Root' : (u.role ?? 0) >= 10 ? '管理员' : '用户'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          disabled={saving}
                          onClick={() => removeUser(u.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

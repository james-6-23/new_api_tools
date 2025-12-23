import { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'
import { useAuth } from '../contexts/AuthContext'

interface RedemptionCode {
  id: number
  key: string
  name: string
  quota: number
  created_time: number
  redeemed_time: number
  used_user_id: number
  expired_time: number
  status: 'unused' | 'used' | 'expired'
}

interface PaginatedResponse {
  items: RedemptionCode[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

type StatusFilter = '' | 'unused' | 'used' | 'expired'

export function Redemptions() {
  const { showToast } = useToast()
  const { token } = useAuth()

  const [codes, setCodes] = useState<RedemptionCode[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Pagination
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  // Filters
  const [nameFilter, setNameFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<'single' | 'batch' | null>(null)
  const [singleDeleteId, setSingleDeleteId] = useState<number | null>(null)

  const apiUrl = import.meta.env.VITE_API_URL || ''

  const getAuthHeaders = useCallback(() => {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    }
  }, [token])

  // Fetch redemption codes
  const fetchCodes = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      })

      if (nameFilter) params.append('name', nameFilter)
      if (statusFilter) params.append('status', statusFilter)
      if (startDate) params.append('start_date', startDate)
      if (endDate) params.append('end_date', endDate)

      const response = await fetch(
        `${apiUrl}/api/redemptions?${params.toString()}`,
        { headers: getAuthHeaders() }
      )
      const data = await response.json()

      if (data.success) {
        const result: PaginatedResponse = data.data
        setCodes(result.items)
        setTotal(result.total)
        setTotalPages(result.total_pages)
      } else {
        showToast('error', data.error?.message || '获取兑换码失败')
      }
    } catch (error) {
      showToast('error', '网络错误，请重试')
      console.error('Failed to fetch codes:', error)
    } finally {
      setLoading(false)
    }
  }, [apiUrl, getAuthHeaders, page, pageSize, nameFilter, statusFilter, startDate, endDate, showToast])

  useEffect(() => {
    fetchCodes()
  }, [fetchCodes])

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1)
  }, [nameFilter, statusFilter, startDate, endDate])

  const formatTimestamp = (ts: number) => {
    if (!ts || ts <= 0) return '-'
    const date = new Date(ts * 1000)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatQuota = (quota: number) => {
    return `$${(quota / 500000).toFixed(2)}`
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'unused':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            未使用
          </span>
        )
      case 'used':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            已使用
          </span>
        )
      case 'expired':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            已过期
          </span>
        )
      default:
        return null
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(codes.map(c => c.id)))
    } else {
      setSelectedIds(new Set())
    }
  }

  const handleSelectOne = (id: number, checked: boolean) => {
    const newSelected = new Set(selectedIds)
    if (checked) {
      newSelected.add(id)
    } else {
      newSelected.delete(id)
    }
    setSelectedIds(newSelected)
  }

  const handleDeleteSingle = (id: number) => {
    setSingleDeleteId(id)
    setDeleteTarget('single')
    setShowDeleteConfirm(true)
  }

  const handleDeleteBatch = () => {
    if (selectedIds.size === 0) {
      showToast('error', '请先选择要删除的兑换码')
      return
    }
    setDeleteTarget('batch')
    setShowDeleteConfirm(true)
  }

  const confirmDelete = async () => {
    try {
      if (deleteTarget === 'single' && singleDeleteId) {
        const response = await fetch(`${apiUrl}/api/redemptions/${singleDeleteId}`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        })
        const data = await response.json()
        if (data.success) {
          showToast('success', '删除成功')
          fetchCodes()
        } else {
          showToast('error', data.error?.message || '删除失败')
        }
      } else if (deleteTarget === 'batch') {
        const response = await fetch(`${apiUrl}/api/redemptions/batch`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
          body: JSON.stringify({ ids: Array.from(selectedIds) }),
        })
        const data = await response.json()
        if (data.success) {
          showToast('success', `成功删除 ${selectedIds.size} 个兑换码`)
          setSelectedIds(new Set())
          fetchCodes()
        } else {
          showToast('error', data.error?.message || '删除失败')
        }
      }
    } catch (error) {
      showToast('error', '网络错误，请重试')
      console.error('Delete error:', error)
    } finally {
      setShowDeleteConfirm(false)
      setDeleteTarget(null)
      setSingleDeleteId(null)
    }
  }

  const handleClearFilters = () => {
    setNameFilter('')
    setStatusFilter('')
    setStartDate('')
    setEndDate('')
  }

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        showToast('success', '兑换码已复制')
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
      showToast('success', '兑换码已复制')
    } catch {
      showToast('error', '复制失败')
    }
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
            <input
              type="text"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              placeholder="搜索名称..."
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
            >
              <option value="">全部</option>
              <option value="unused">未使用</option>
              <option value="used">已使用</option>
              <option value="expired">已过期</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">开始日期</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">结束日期</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={handleClearFilters}
              className="w-full px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
            >
              清除筛选
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">
            兑换码管理 ({total})
          </h2>
          {selectedIds.size > 0 && (
            <button
              onClick={handleDeleteBatch}
              className="px-4 py-2 text-sm text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors flex items-center space-x-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>删除选中 ({selectedIds.size})</span>
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : codes.length === 0 ? (
          <div className="text-center py-12">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">暂无兑换码</h3>
            <p className="mt-1 text-sm text-gray-500">去生成器页面添加兑换码</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === codes.length && codes.length > 0}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      兑换码
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      名称
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      额度
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      状态
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      创建时间
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      过期时间
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {codes.map((code) => (
                    <tr key={code.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(code.id)}
                          onChange={(e) => handleSelectOne(code.id, e.target.checked)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <code className="text-sm font-mono text-gray-800">{code.key}</code>
                          <button
                            onClick={() => copyToClipboard(code.key)}
                            className="text-gray-400 hover:text-blue-600 p-1"
                            title="复制"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {code.name}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-green-600">
                        {formatQuota(code.quota)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {getStatusBadge(code.status)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {formatTimestamp(code.created_time)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {code.expired_time > 0 ? formatTimestamp(code.expired_time) : '永不过期'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          onClick={() => handleDeleteSingle(code.id)}
                          className="text-red-600 hover:text-red-800 p-1"
                          title="删除"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                共 {total} 条记录，第 {page} / {totalPages} 页
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 text-sm border rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  上一页
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 text-sm border rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  下一页
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className="bg-red-100 rounded-full p-2">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900">确认删除</h3>
            </div>
            <p className="text-gray-600 mb-6">
              {deleteTarget === 'single'
                ? '确定要删除这个兑换码吗？此操作不可恢复。'
                : `确定要删除选中的 ${selectedIds.size} 个兑换码吗？此操作不可恢复。`}
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

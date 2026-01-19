// 用户分析接口定义
export interface UserAnalysis {
  range: {
    start_time: number
    end_time: number
    window_seconds: number
  }
  user: {
    id: number
    username: string
    display_name?: string | null
    email?: string | null
    status: number
    group?: string | null
    quota?: number
    used_quota?: number
    remark?: string | null
    in_whitelist?: boolean
    linux_do_id?: string | null
  }
  summary: {
    total_requests: number
    success_requests: number
    failure_requests: number
    failure_rate: number
    empty_rate: number
    unique_ips: number
    total_quota: number
    prompt_tokens: number
    completion_tokens: number
  }
  risk: {
    requests_per_minute: number
    avg_quota_per_request: number
    risk_flags: string[]
    risk_score: number
  }
  top_models: Array<{
    model_name: string
    requests: number
    quota: number
  }>
  top_channels: Array<{
    channel_id: number
    channel_name: string
    requests: number
  }>
  top_ips: Array<{
    ip: string
    requests: number
  }>
  recent_logs: Array<{
    id: number
    created_at: number
    type: number
    model_name: string
    use_time: number
    ip: string
  }>
}

// 时间窗口标签
export const WINDOW_LABELS: Record<string, string> = {
  '1h': '1小时内',
  '3h': '3小时内',
  '6h': '6小时内',
  '12h': '12小时内',
  '24h': '24小时内',
  '3d': '3天内',
  '7d': '7天内',
}

// 风险标志标签
export const RISK_FLAG_LABELS: Record<string, string> = {
  'HIGH_RPM': '请求频率过高',
  'MANY_IPS': '多IP访问',
  'HIGH_FAILURE_RATE': '失败率过高',
  'HIGH_EMPTY_RATE': '空回复率过高',
  'RAPID_IP_SWITCH': '频繁切换IP',
}

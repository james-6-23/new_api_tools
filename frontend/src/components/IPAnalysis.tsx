import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import ReactECharts from 'echarts-for-react'
import * as echarts from 'echarts'
import { 
  Globe, MapPin, RefreshCw, Loader2, TrendingUp, 
  AlertTriangle, Activity, ChevronRight
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card'
import { Button } from './ui/button'
import { cn } from '../lib/utils'

interface RegionStats {
  country: string
  country_code: string
  region?: string
  city?: string
  ip_count: number
  request_count: number
  user_count: number
  percentage: number
}

interface IPDistributionData {
  total_ips: number
  total_requests: number
  domestic_percentage: number
  overseas_percentage: number
  by_country: RegionStats[]
  by_province: RegionStats[]
  top_cities: RegionStats[]
  snapshot_time: number
}

type TimeWindow = '1h' | '6h' | '24h' | '7d'

// 国家代码到英文名称映射（ECharts 世界地图使用英文名）
const countryCodeToName: Record<string, string> = {
  'CN': 'China',
  'US': 'United States of America',
  'JP': 'Japan',
  'KR': 'South Korea',
  'DE': 'Germany',
  'FR': 'France',
  'GB': 'United Kingdom',
  'RU': 'Russia',
  'CA': 'Canada',
  'AU': 'Australia',
  'BR': 'Brazil',
  'IN': 'India',
  'SG': 'Singapore',
  'HK': 'Hong Kong',
  'TW': 'Taiwan',
  'NL': 'Netherlands',
  'SE': 'Sweden',
  'CH': 'Switzerland',
  'IT': 'Italy',
  'ES': 'Spain',
  'PL': 'Poland',
  'UA': 'Ukraine',
  'TH': 'Thailand',
  'VN': 'Vietnam',
  'MY': 'Malaysia',
  'ID': 'Indonesia',
  'PH': 'Philippines',
  'MX': 'Mexico',
  'AR': 'Argentina',
  'ZA': 'South Africa',
  'AE': 'United Arab Emirates',
  'SA': 'Saudi Arabia',
  'TR': 'Turkey',
  'IE': 'Ireland',
  'FI': 'Finland',
  'NO': 'Norway',
  'DK': 'Denmark',
  'AT': 'Austria',
  'BE': 'Belgium',
  'CZ': 'Czechia',
  'PT': 'Portugal',
  'NZ': 'New Zealand',
  'IL': 'Israel',
  'EG': 'Egypt',
  'CL': 'Chile',
  'CO': 'Colombia',
  'PE': 'Peru',
  'RO': 'Romania',
  'HU': 'Hungary',
  'GR': 'Greece',
  'BD': 'Bangladesh',
  'PK': 'Pakistan',
}

export function IPAnalysis() {
  const { token } = useAuth()
  const { showToast } = useToast()
  const [data, setData] = useState<IPDistributionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('24h')
  const [mapLoaded, setMapLoaded] = useState(false)
  const mapLoadedRef = useRef(false)

  const apiUrl = import.meta.env.VITE_API_URL || ''
  
  // 加载世界地图
  useEffect(() => {
    if (mapLoadedRef.current) return
    mapLoadedRef.current = true
    
    fetch('https://cdn.jsdelivr.net/npm/echarts@5/map/json/world.json')
      .then(res => res.json())
      .then(worldJson => {
        echarts.registerMap('world', worldJson)
        setMapLoaded(true)
      })
      .catch(err => {
        console.error('Failed to load world map:', err)
        // 尝试备用源
        fetch('https://unpkg.com/echarts@5/map/json/world.json')
          .then(res => res.json())
          .then(worldJson => {
            echarts.registerMap('world', worldJson)
            setMapLoaded(true)
          })
          .catch(() => {
            console.error('All map sources failed')
          })
      })
  }, [])

  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token])

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch(
        `${apiUrl}/api/dashboard/ip-distribution?window=${timeWindow}`,
        { headers: getAuthHeaders() }
      )
      const result = await response.json()
      if (result.success) {
        setData(result.data)
      }
    } catch (error) {
      console.error('Failed to fetch IP distribution:', error)
      showToast('error', '获取 IP 分布数据失败')
    }
  }, [apiUrl, getAuthHeaders, timeWindow, showToast])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      await fetchData()
      setLoading(false)
    }
    loadData()
  }, [fetchData])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
    showToast('success', '数据已刷新')
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  const getTimeWindowLabel = (window: TimeWindow) => {
    const labels: Record<TimeWindow, string> = {
      '1h': '1小时',
      '6h': '6小时',
      '24h': '24小时',
      '7d': '7天',
    }
    return labels[window]
  }

  // 世界地图配置
  const mapOption = useMemo(() => {
    if (!data || !mapLoaded) return {}
    
    const maxValue = data.by_country[0]?.request_count || 100
    
    // 转换数据为 ECharts 格式
    const mapData = data.by_country.map(item => ({
      name: countryCodeToName[item.country_code] || item.country,
      value: item.request_count,
    }))

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          if (params.value) {
            return `<strong>${params.name}</strong><br/>流量: ${formatNumber(params.value)}`
          }
          return params.name
        }
      },
      visualMap: {
        min: 0,
        max: maxValue,
        text: ['高', '低'],
        realtime: false,
        calculable: true,
        inRange: {
          color: ['#e3f2fd', '#90caf9', '#42a5f5', '#1e88e5', '#1565c0']
        },
        textStyle: {
          color: '#666'
        },
        left: 16,
        bottom: 16,
      },
      series: [
        {
          name: '流量分布',
          type: 'map',
          map: 'world',
          roam: true,
          scaleLimit: {
            min: 1,
            max: 8
          },
          zoom: 1.2,
          emphasis: {
            label: {
              show: true,
              color: '#333',
              fontSize: 12,
            },
            itemStyle: {
              areaColor: '#ffc107'
            }
          },
          select: {
            disabled: true
          },
          itemStyle: {
            areaColor: '#f5f5f5',
            borderColor: '#e0e0e0',
            borderWidth: 0.5
          },
          label: {
            show: false
          },
          data: mapData
        }
      ]
    }
  }, [data, mapLoaded])

  if (loading) {
    return (
      <div className="flex justify-center items-center py-40">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Globe className="w-8 h-8 text-primary" />
            IP 地区分析
          </h2>
          <p className="text-muted-foreground mt-1">
            访问来源地区分布与流量统计
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh} 
            disabled={refreshing}
            className="h-9"
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
            刷新
          </Button>
          <div className="inline-flex rounded-lg border bg-muted/50 p-1">
            {(['1h', '6h', '24h', '7d'] as TimeWindow[]).map((w) => (
              <Button
                key={w}
                variant={timeWindow === w ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setTimeWindow(w)}
                className="h-7 text-xs px-3"
              >
                {getTimeWindowLabel(w)}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="独立 IP 数"
          value={formatNumber(data?.total_ips || 0)}
          icon={MapPin}
          color="blue"
        />
        <StatCard
          title="总流量"
          value={formatNumber(data?.total_requests || 0)}
          icon={Activity}
          color="emerald"
        />
        <StatCard
          title="国内占比"
          value={`${(data?.domestic_percentage || 0).toFixed(1)}%`}
          icon={TrendingUp}
          color="purple"
        />
        <StatCard
          title="海外占比"
          value={`${(data?.overseas_percentage || 0).toFixed(1)}%`}
          icon={Globe}
          color="orange"
        />
      </div>

      {/* World Map */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Globe className="w-5 h-5 text-muted-foreground" />
                Web 流量请求（按国家/地区）
              </CardTitle>
              <CardDescription>过去 {getTimeWindowLabel(timeWindow)}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!mapLoaded ? (
            <div className="h-[400px] flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mr-2" />
              加载地图中...
            </div>
          ) : data && data.by_country.length > 0 ? (
            <ReactECharts
              option={mapOption}
              style={{ height: '400px', width: '100%' }}
              opts={{ renderer: 'canvas' }}
            />
          ) : (
            <div className="h-[400px] flex items-center justify-center text-muted-foreground bg-muted/20 rounded-lg">
              暂无数据
            </div>
          )}
        </CardContent>
      </Card>

      {/* Traffic Ranking Table */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">流量排名靠前的国家/地区</CardTitle>
          <CardDescription>过去 {getTimeWindowLabel(timeWindow)}</CardDescription>
        </CardHeader>
        <CardContent>
          {data && data.by_country.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">国家/地区</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">流量</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_country.slice(0, 10).map((item, index) => (
                    <tr key={index} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{item.country}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums font-medium">
                        {formatNumber(item.request_count)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground bg-muted/20 rounded-lg">
              暂无数据
            </div>
          )}
        </CardContent>
      </Card>

      {/* Province Ranking (China) */}
      {data && data.by_province.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">中国省份流量排名</CardTitle>
            <CardDescription>过去 {getTimeWindowLabel(timeWindow)}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">省份</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">IP数</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">流量</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">占比</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_province.slice(0, 10).map((item, index) => (
                    <tr key={index} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="py-3 px-4">{item.region}</td>
                      <td className="py-3 px-4 text-right tabular-nums text-muted-foreground">
                        {item.ip_count}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums font-medium">
                        {formatNumber(item.request_count)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-muted-foreground">
                        {item.percentage.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alerts Section */}
      {data && (data.overseas_percentage > 30 || data.by_country.length > 20) && (
        <Card className="border-yellow-200 bg-yellow-50/50 dark:border-yellow-900 dark:bg-yellow-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
              <AlertTriangle className="w-5 h-5" />
              异常提醒
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {data.overseas_percentage > 30 && (
                <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                  <ChevronRight className="w-4 h-4" />
                  <span>海外访问占比较高 ({data.overseas_percentage.toFixed(1)}%)，请关注是否有异常访问</span>
                </div>
              )}
              {data.by_country.length > 20 && (
                <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                  <ChevronRight className="w-4 h-4" />
                  <span>访问来源国家/地区较多 ({data.by_country.length} 个)，建议检查是否有代理滥用</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Stat Card Component
interface StatCardProps {
  title: string
  value: string
  icon: React.ElementType
  color: string
}

function StatCard({ title, value, icon: Icon, color }: StatCardProps) {
  const colorMap: Record<string, { bg: string }> = {
    blue: { bg: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
    emerald: { bg: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
    purple: { bg: 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300' },
    orange: { bg: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  }
  const theme = colorMap[color] || colorMap.blue

  return (
    <Card className="overflow-hidden hover:shadow-md transition-all duration-200">
      <CardContent className="p-5">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <div className="text-2xl font-bold tracking-tight">{value}</div>
          </div>
          <div className={cn("p-2.5 rounded-xl", theme.bg)}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

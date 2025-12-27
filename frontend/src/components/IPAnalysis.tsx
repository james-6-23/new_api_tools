import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import ReactECharts from 'echarts-for-react'
import * as echarts from 'echarts'
import { 
  Globe, MapPin, RefreshCw, Loader2, TrendingUp, 
  AlertTriangle, Activity, ChevronRight, ChevronDown
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
type MapType = 'world' | 'china'

// 省份名称映射（GeoIP 返回英文名，ECharts 中国地图使用中文名）
const provinceNameMap: Record<string, string> = {
  // 英文名 -> 中文名
  'Beijing': '北京',
  'Tianjin': '天津',
  'Hebei': '河北',
  'Shanxi': '山西',
  'Inner Mongolia': '内蒙古',
  'Nei Mongol': '内蒙古',
  'Liaoning': '辽宁',
  'Jilin': '吉林',
  'Heilongjiang': '黑龙江',
  'Shanghai': '上海',
  'Jiangsu': '江苏',
  'Zhejiang': '浙江',
  'Anhui': '安徽',
  'Fujian': '福建',
  'Jiangxi': '江西',
  'Shandong': '山东',
  'Henan': '河南',
  'Hubei': '湖北',
  'Hunan': '湖南',
  'Guangdong': '广东',
  'Guangxi': '广西',
  'Guangxi Zhuang': '广西',
  'Hainan': '海南',
  'Chongqing': '重庆',
  'Sichuan': '四川',
  'Guizhou': '贵州',
  'Yunnan': '云南',
  'Tibet': '西藏',
  'Xizang': '西藏',
  'Shaanxi': '陕西',
  'Gansu': '甘肃',
  'Qinghai': '青海',
  'Ningxia': '宁夏',
  'Ningxia Hui': '宁夏',
  'Xinjiang': '新疆',
  'Xinjiang Uyghur': '新疆',
  'Taiwan': '台湾',
  'Hong Kong': '香港',
  'Macau': '澳门',
  'Macao': '澳门',
  // 中文名保持不变（兼容）
  '北京': '北京',
  '天津': '天津',
  '河北': '河北',
  '山西': '山西',
  '内蒙古': '内蒙古',
  '辽宁': '辽宁',
  '吉林': '吉林',
  '黑龙江': '黑龙江',
  '上海': '上海',
  '江苏': '江苏',
  '浙江': '浙江',
  '安徽': '安徽',
  '福建': '福建',
  '江西': '江西',
  '山东': '山东',
  '河南': '河南',
  '湖北': '湖北',
  '湖南': '湖南',
  '广东': '广东',
  '广西': '广西',
  '海南': '海南',
  '重庆': '重庆',
  '四川': '四川',
  '贵州': '贵州',
  '云南': '云南',
  '西藏': '西藏',
  '陕西': '陕西',
  '甘肃': '甘肃',
  '青海': '青海',
  '宁夏': '宁夏',
  '新疆': '新疆',
  '台湾': '台湾',
  '香港': '香港',
  '澳门': '澳门',
}

// 国家代码到英文名称映射（ECharts 世界地图使用英文名）
const countryCodeToName: Record<string, string> = {
  'CN': 'China',
  'US': 'United States',
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
  const [chinaMapLoaded, setChinaMapLoaded] = useState(false)
  const [mapType, setMapType] = useState<MapType>('world')
  const [mapDropdownOpen, setMapDropdownOpen] = useState(false)
  const mapLoadedRef = useRef(false)
  const chinaMapLoadedRef = useRef(false)

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const [mapError, setMapError] = useState(false)
  
  // 加载世界地图 - 多源备用 + 超时处理
  useEffect(() => {
    if (mapLoadedRef.current) return
    mapLoadedRef.current = true
    
    const MAP_SOURCES = [
      '/world.json', // 本地文件优先
      'https://cdn.jsdelivr.net/gh/mouday/echarts-map@master/echarts-4.2.1-rc1-map/json/world.json',
      'https://fastly.jsdelivr.net/gh/mouday/echarts-map@master/echarts-4.2.1-rc1-map/json/world.json',
      'https://gcore.jsdelivr.net/gh/mouday/echarts-map@master/echarts-4.2.1-rc1-map/json/world.json',
    ]
    
    const fetchWithTimeout = (url: string, timeout = 8000): Promise<Response> => {
      return Promise.race([
        fetch(url),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), timeout)
        )
      ])
    }
    
    const tryLoadMap = async () => {
      for (const url of MAP_SOURCES) {
        try {
          console.log(`[Map] Trying: ${url}`)
          const res = await fetchWithTimeout(url)
          if (!res.ok) continue
          const worldJson = await res.json()
          echarts.registerMap('world', worldJson)
          setMapLoaded(true)
          console.log(`[Map] Loaded from: ${url}`)
          return
        } catch (err) {
          console.warn(`[Map] Failed: ${url}`, err)
        }
      }
      // 所有源都失败
      console.error('[Map] All sources failed')
      setMapError(true)
    }
    
    tryLoadMap()
  }, [])

  // 加载中国地图（按需加载）
  useEffect(() => {
    if (mapType !== 'china' || chinaMapLoadedRef.current) return
    chinaMapLoadedRef.current = true
    
    const CHINA_MAP_SOURCES = [
      '/china.json',
      'https://cdn.jsdelivr.net/gh/mouday/echarts-map@master/echarts-4.2.1-rc1-map/json/china.json',
      'https://fastly.jsdelivr.net/gh/mouday/echarts-map@master/echarts-4.2.1-rc1-map/json/china.json',
    ]
    
    const fetchWithTimeout = (url: string, timeout = 8000): Promise<Response> => {
      return Promise.race([
        fetch(url),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), timeout)
        )
      ])
    }
    
    const tryLoadChinaMap = async () => {
      for (const url of CHINA_MAP_SOURCES) {
        try {
          console.log(`[ChinaMap] Trying: ${url}`)
          const res = await fetchWithTimeout(url)
          if (!res.ok) continue
          const chinaJson = await res.json()
          echarts.registerMap('china', chinaJson)
          setChinaMapLoaded(true)
          console.log(`[ChinaMap] Loaded from: ${url}`)
          return
        } catch (err) {
          console.warn(`[ChinaMap] Failed: ${url}`, err)
        }
      }
      console.error('[ChinaMap] All sources failed')
    }
    
    tryLoadChinaMap()
  }, [mapType])

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
  const worldMapOption = useMemo(() => {
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

  // 中国地图配置
  const chinaMapOption = useMemo(() => {
    if (!data || !chinaMapLoaded) return {}
    
    const maxValue = data.by_province[0]?.request_count || 100
    
    // 转换数据为 ECharts 格式
    const mapData = data.by_province.map(item => ({
      name: provinceNameMap[item.region || ''] || item.region,
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
          color: ['#fce4ec', '#f48fb1', '#f06292', '#ec407a', '#e91e63']
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
          map: 'china',
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
  }, [data, chinaMapLoaded])

  const currentMapOption = mapType === 'world' ? worldMapOption : chinaMapOption
  const isCurrentMapLoaded = mapType === 'world' ? mapLoaded : chinaMapLoaded

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
                Web 流量请求（按{mapType === 'world' ? '国家/地区' : '省份'}）
              </CardTitle>
              <CardDescription>过去 {getTimeWindowLabel(timeWindow)}</CardDescription>
            </div>
            {/* 地图切换下拉框 */}
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 gap-1"
                onClick={() => setMapDropdownOpen(!mapDropdownOpen)}
              >
                {mapType === 'world' ? '🌍 世界地图' : '🇨🇳 中国地图'}
                <ChevronDown className={cn("h-4 w-4 transition-transform", mapDropdownOpen && "rotate-180")} />
              </Button>
              {mapDropdownOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-10" 
                    onClick={() => setMapDropdownOpen(false)} 
                  />
                  <div className="absolute right-0 top-full mt-1 z-20 bg-background border rounded-md shadow-lg py-1 min-w-[140px]">
                    <button
                      className={cn(
                        "w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2",
                        mapType === 'world' && "bg-muted font-medium"
                      )}
                      onClick={() => {
                        setMapType('world')
                        setMapDropdownOpen(false)
                      }}
                    >
                      🌍 世界地图
                    </button>
                    <button
                      className={cn(
                        "w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2",
                        mapType === 'china' && "bg-muted font-medium"
                      )}
                      onClick={() => {
                        setMapType('china')
                        setMapDropdownOpen(false)
                      }}
                    >
                      🇨🇳 中国地图
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {mapError && mapType === 'world' ? (
            <div className="h-[400px] flex flex-col items-center justify-center text-muted-foreground bg-muted/20 rounded-lg gap-3">
              <AlertTriangle className="h-10 w-10 text-yellow-500" />
              <span>地图加载失败，请刷新页面重试</span>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                刷新页面
              </Button>
            </div>
          ) : !isCurrentMapLoaded ? (
            <div className="h-[400px] flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mr-2" />
              加载地图中...
            </div>
          ) : data && (mapType === 'world' ? data.by_country.length > 0 : data.by_province.length > 0) ? (
            <ReactECharts
              key={mapType}
              option={currentMapOption}
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

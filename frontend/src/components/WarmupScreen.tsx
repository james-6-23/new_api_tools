import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Loader2, CheckCircle2, XCircle, Server, AlertCircle, RefreshCw } from 'lucide-react'
import { Progress } from './ui/progress'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card'
import { Button } from './ui/button'
import { cn } from '../lib/utils'

interface WarmupStep {
  name: string
  status: 'pending' | 'done' | 'error'
  error?: string
}

interface WarmupStatus {
  status: 'pending' | 'initializing' | 'ready'
  progress: number
  message: string
  steps: WarmupStep[]
  started_at: number | null
  completed_at: number | null
}

interface WarmupScreenProps {
  onReady: () => void
}

export function WarmupScreen({ onReady }: WarmupScreenProps) {
  const { token, logout } = useAuth()
  const [status, setStatus] = useState<WarmupStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isExiting, setIsExiting] = useState(false)

  const apiUrl = import.meta.env.VITE_API_URL || ''

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>
    let mounted = true

    const checkStatus = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/system/warmup-status`, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        })

        // 处理 401 未授权错误 - token 失效，需要重新登录
        if (response.status === 401) {
          console.warn('Token invalid or expired, logging out...')
          if (mounted) {
            logout()
          }
          return
        }

        const data = await response.json()

        if (!mounted) return

        if (data.success) {
          setStatus(data.data)

          if (data.data.status === 'ready') {
            setIsExiting(true)
            setTimeout(() => {
              if (mounted) onReady()
            }, 1000) // Delay to show completion
          }
        } else {
          setError(data.message || '获取预热状态失败')
        }
      } catch (e) {
        if (mounted) {
          setError('无法连接到服务器，请检查网络连接')
        }
      }
    }

    checkStatus()
    interval = setInterval(checkStatus, 1000) // 1s is enough and less taxing

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [apiUrl, token, onReady, logout])

  // Determine which step is currently "active"
  const activeStepIndex = useMemo(() => {
    if (!status?.steps) return -1;
    return status.steps.findIndex(s => s.status === 'pending');
  }, [status?.steps]);

  const getStepIcon = (step: WarmupStep, isActive: boolean) => {
    if (step.status === 'done') {
      return <CheckCircle2 className="w-5 h-5 text-green-500" />
    }
    if (step.status === 'error') {
      return <XCircle className="w-5 h-5 text-destructive" />
    }
    if (isActive) {
      return <Loader2 className="w-5 h-5 text-primary animate-spin" />
    }
    return <div className="w-5 h-5 rounded-full border-2 border-muted" />
  }

  return (
    <div className={cn(
      "min-h-screen flex items-center justify-center bg-background/30 backdrop-blur-md p-4 transition-all duration-500",
      isExiting ? "opacity-0 scale-95" : "opacity-100 scale-100"
    )}>
      <Card className="w-full max-w-lg border-border/40 shadow-2xl shadow-primary/5 bg-card/80 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/50 overflow-hidden animate-fade-in-up">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/20 via-primary to-primary/20" />

        <CardHeader className="text-center pb-6">
          <div className="mx-auto mb-4 p-4 rounded-full bg-primary/5 ring-1 ring-primary/10 w-fit transition-transform duration-700 ease-in-out hover:rotate-12">
            {error ? (
              <AlertCircle className="w-8 h-8 text-destructive" />
            ) : (
              <Server className={cn(
                "w-8 h-8 text-primary",
                status?.status === 'initializing' && "animate-pulse"
              )} />
            )}
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            {error ? '初始化异常' : '系统初始化'}
          </CardTitle>
          <CardDescription className="text-base mt-1.5 h-6 font-medium text-foreground/80">
            {error ? error : (status?.message || '正在建立安全连接...')}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-8 px-8 pb-10">
          {error ? (
            <div className="flex flex-col items-center gap-4">
              <p className="text-sm text-muted-foreground text-center">
                初始化过程中遇到问题，这可能是由于网络波动或服务器配置错误导致的。
              </p>
              <Button
                onClick={() => window.location.reload()}
                className="gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                重试连接
              </Button>
            </div>
          ) : (
            <>
              {/* Progress Section */}
              <div className="space-y-3">
                <div className="flex justify-between text-xs font-bold text-muted-foreground uppercase tracking-widest">
                  <span>Initialization Progress</span>
                  <span className="text-primary">{status?.progress || 0}%</span>
                </div>
                <Progress value={status?.progress || 0} className="h-2.5 w-full" />
              </div>

              {/* Steps List */}
              {status?.steps && status.steps.length > 0 && (
                <div className="space-y-3">
                  {status.steps.map((step, index) => {
                    const isDone = step.status === 'done';
                    const isError = step.status === 'error';
                    const isActive = index === activeStepIndex;
                    const isPending = !isDone && !isError && !isActive;

                    return (
                      <div
                        key={index}
                        className={cn(
                          "flex items-center gap-4 p-3.5 rounded-xl border transition-all duration-300",
                          isActive
                            ? "bg-primary/5 border-primary/20 shadow-sm translate-x-1"
                            : "bg-transparent border-transparent",
                          isPending && "opacity-40"
                        )}
                      >
                        <div className="flex-none">
                          {getStepIcon(step, isActive)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            "text-sm font-semibold truncate transition-colors",
                            isDone ? "text-muted-foreground" : "text-foreground"
                          )}>
                            {step.name}
                          </p>
                        </div>
                        {isError && (
                          <span className="text-[10px] font-bold uppercase tracking-tighter text-destructive bg-destructive/10 px-2 py-0.5 rounded-md">
                            Error
                          </span>
                        )}
                        {isDone && (
                          <span className="text-xs font-medium text-green-500/80 flex items-center gap-1">
                            Ready
                          </span>
                        )}
                        {isActive && (
                          <span className="text-[10px] font-bold uppercase tracking-tighter text-primary animate-pulse">
                            Processing
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
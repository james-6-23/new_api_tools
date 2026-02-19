import React from 'react'
import { Card, CardContent } from './ui/card'
import { cn } from '../lib/utils'

interface StatCardProps {
  title: string
  value: number | string
  subValue?: string
  icon: React.ElementType
  color: string
  variant?: 'default' | 'compact'
  customLabel?: string
  className?: string
  onClick?: () => void
}

export function StatCard({ title, value, subValue, icon: Icon, color, variant = 'default', customLabel, className, onClick }: StatCardProps) {
  // Map color names to Tailwind classes
  const colorMap: Record<string, { bg: string, text: string, border: string }> = {
    blue: { bg: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300', text: 'text-blue-600', border: 'border-l-blue-500' },
    green: { bg: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300', text: 'text-green-600', border: 'border-l-green-500' },
    emerald: { bg: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300', text: 'text-emerald-600', border: 'border-l-emerald-500' },
    purple: { bg: 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300', text: 'text-purple-600', border: 'border-l-purple-500' },
    orange: { bg: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300', text: 'text-orange-600', border: 'border-l-orange-500' },
    pink: { bg: 'bg-pink-50 text-pink-700 dark:bg-pink-950 dark:text-pink-300', text: 'text-pink-600', border: 'border-l-pink-500' },
    indigo: { bg: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300', text: 'text-indigo-600', border: 'border-l-indigo-500' },
    amber: { bg: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300', text: 'text-amber-600', border: 'border-l-amber-500' },
    cyan: { bg: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300', text: 'text-cyan-600', border: 'border-l-cyan-500' },
    teal: { bg: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300', text: 'text-teal-600', border: 'border-l-teal-500' },
    rose: { bg: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300', text: 'text-rose-600', border: 'border-l-rose-500' },
    red: { bg: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300', text: 'text-red-600', border: 'border-l-red-500' },
    yellow: { bg: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300', text: 'text-yellow-600', border: 'border-l-yellow-500' },
    gray: { bg: 'bg-gray-50 text-gray-700 dark:bg-gray-950 dark:text-gray-300', text: 'text-gray-600', border: 'border-l-gray-500' },
  }

  const theme = colorMap[color] || colorMap.blue

  // If onClick is provided, we want to treat this card as a button or interactive element
  const interactiveClass = onClick ? "cursor-pointer active:scale-95 transition-transform" : ""

  if (variant === 'compact') {
    return (
      <Card
        className={cn("glass-card overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 group border-l-4", theme.border, interactiveClass, className)}
        onClick={onClick}
      >
        <CardContent className="p-4 flex items-center justify-between relative overflow-hidden">
          <div className={cn("absolute -right-4 -top-4 w-16 h-16 rounded-full opacity-10 group-hover:opacity-20 transition-opacity duration-300 blur-xl", theme.bg.split(' ')[0])} />
          <div className="space-y-1 relative z-10">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{customLabel || title}</p>
            <div className="text-xl font-bold tracking-tight text-foreground/90">{value}</div>
          </div>
          <div className={cn("p-2 rounded-xl flex-shrink-0 transition-transform duration-300 group-hover:scale-110 shadow-sm relative z-10", theme.bg)}>
            <Icon className="w-4 h-4" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card
      className={cn("glass-card overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all duration-300 group", interactiveClass, className)}
      onClick={onClick}
    >
      <CardContent className="p-5 relative overflow-hidden">
        <div className={cn("absolute -right-6 -top-6 w-24 h-24 rounded-full opacity-10 group-hover:opacity-20 transition-opacity duration-300 blur-2xl", theme.bg.split(' ')[0])} />
        <div className="flex justify-between items-start relative z-10">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <div className="text-2xl font-bold tracking-tight text-foreground/90">{value}</div>
          </div>
          <div className={cn("p-3 rounded-2xl transition-all duration-300 group-hover:scale-110 shadow-sm", theme.bg)}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
        {subValue && (
          <div className="mt-4 flex items-center text-xs relative z-10">
            <span className={cn("font-medium px-2.5 py-1 rounded-full bg-secondary/80 backdrop-blur-sm border border-black/5 dark:border-white/5 shadow-sm", theme.text)}>
              {subValue}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

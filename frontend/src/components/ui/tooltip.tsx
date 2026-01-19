import * as React from 'react'
import { cn } from '../../lib/utils'

interface TooltipContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  tooltipId: string
}

const TooltipContext = React.createContext<TooltipContextValue | null>(null)

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export function Tooltip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const tooltipId = React.useId()
  return (
    <TooltipContext.Provider value={{ open, setOpen, tooltipId }}>
      <div className="relative inline-block">{children}</div>
    </TooltipContext.Provider>
  )
}

export function TooltipTrigger({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) {
  const context = React.useContext(TooltipContext)
  if (!context) throw new Error('TooltipTrigger must be used within Tooltip')

  const handleOpen = () => context.setOpen(true)
  const handleClose = () => context.setOpen(false)

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<React.HTMLAttributes<HTMLElement>>
    return React.cloneElement(child, {
      onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { child.props.onMouseEnter?.(e); handleOpen() },
      onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { child.props.onMouseLeave?.(e); handleClose() },
      onFocus: (e: React.FocusEvent<HTMLElement>) => { child.props.onFocus?.(e); handleOpen() },
      onBlur: (e: React.FocusEvent<HTMLElement>) => { child.props.onBlur?.(e); handleClose() },
      'aria-describedby': context.open ? context.tooltipId : undefined,
    })
  }

  return (
    <span
      onMouseEnter={handleOpen}
      onMouseLeave={handleClose}
      onFocus={handleOpen}
      onBlur={handleClose}
      aria-describedby={context.open ? context.tooltipId : undefined}
    >
      {children}
    </span>
  )
}

export function TooltipContent({ children, className }: { children: React.ReactNode; className?: string }) {
  const context = React.useContext(TooltipContext)
  if (!context) throw new Error('TooltipContent must be used within Tooltip')

  if (!context.open) return null

  return (
    <div
      id={context.tooltipId}
      role="tooltip"
      className={cn(
        'absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 text-xs rounded-md bg-popover text-popover-foreground border shadow-md animate-in fade-in-0 zoom-in-95',
        className
      )}
    >
      {children}
    </div>
  )
}

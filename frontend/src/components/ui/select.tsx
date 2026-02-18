import * as React from "react"
import { createPortal } from "react-dom"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "../../lib/utils"

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  onChange?: (e: { target: { value: string } } | React.ChangeEvent<HTMLSelectElement>) => void
  placeholder?: string
}

const Select = React.forwardRef<HTMLDivElement, SelectProps>(
  ({ className, children, value, onChange, placeholder = "Select...", disabled, ...props }, ref) => {
    const [isOpen, setIsOpen] = React.useState(false)
    const [dropdownStyle, setDropdownStyle] = React.useState<React.CSSProperties>({})
    const containerRef = React.useRef<HTMLDivElement>(null)
    const triggerRef = React.useRef<HTMLDivElement>(null)
    const dropdownRef = React.useRef<HTMLDivElement>(null)

    // Merge external ref with internal ref
    React.useImperativeHandle(ref, () => containerRef.current!)

    // Extract options from children
    const options = React.useMemo(() => {
      const opts: { value: string; label: string; disabled?: boolean }[] = []
      React.Children.forEach(children, (child) => {
        if (React.isValidElement(child) && child.type === 'option') {
          const props = child.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean }
          opts.push({
            value: props.value?.toString() || '',
            label: props.children?.toString() || props.value?.toString() || '',
            disabled: props.disabled
          })
        }
      })
      return opts
    }, [children])

    const selectedOption = options.find(opt => opt.value === value?.toString())

    // Calculate dropdown position
    const updateDropdownPosition = React.useCallback(() => {
      if (!triggerRef.current) return

      const rect = triggerRef.current.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      const spaceBelow = viewportHeight - rect.bottom
      const spaceAbove = rect.top
      const dropdownMaxHeight = 240 // max-h-60 = 15rem = 240px
      const openUpward = spaceBelow < dropdownMaxHeight && spaceAbove > spaceBelow

      setDropdownStyle({
        position: 'fixed',
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
        ...(openUpward
          ? { bottom: viewportHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
        maxHeight: Math.min(dropdownMaxHeight, openUpward ? spaceAbove - 8 : spaceBelow - 8),
      })
    }, [])

    // Handle clicking/touching outside to close
    React.useEffect(() => {
      if (!isOpen) return

      const handleOutside = (event: MouseEvent | TouchEvent) => {
        const target = event.target as Node
        if (
          containerRef.current && !containerRef.current.contains(target) &&
          dropdownRef.current && !dropdownRef.current.contains(target)
        ) {
          setIsOpen(false)
        }
      }
      document.addEventListener("mousedown", handleOutside)
      document.addEventListener("touchstart", handleOutside)
      return () => {
        document.removeEventListener("mousedown", handleOutside)
        document.removeEventListener("touchstart", handleOutside)
      }
    }, [isOpen])

    // Update position on scroll/resize when open
    React.useEffect(() => {
      if (!isOpen) return

      updateDropdownPosition()

      const handleUpdate = (e: Event) => {
        // Skip position update if the scroll originated from the dropdown itself
        if (dropdownRef.current && dropdownRef.current.contains(e.target as Node)) {
          return
        }
        updateDropdownPosition()
      }
      const handleResize = () => updateDropdownPosition()
      window.addEventListener("scroll", handleUpdate, true)
      window.addEventListener("resize", handleResize)
      return () => {
        window.removeEventListener("scroll", handleUpdate, true)
        window.removeEventListener("resize", handleResize)
      }
    }, [isOpen, updateDropdownPosition])

    const handleToggle = () => {
      if (disabled) return
      if (!isOpen) {
        updateDropdownPosition()
      }
      setIsOpen(!isOpen)
    }

    const handleSelect = (optionValue: string) => {
      if (onChange) {
        // Simulate a change event
        const event = {
          target: { value: optionValue },
          currentTarget: { value: optionValue },
          bubbles: true,
          cancelable: true,
          type: 'change'
        } as unknown as React.ChangeEvent<HTMLSelectElement>
        onChange(event)
      }
      setIsOpen(false)
    }

    const dropdown = isOpen ? createPortal(
      <div
        ref={dropdownRef}
        className="overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
        style={{
          ...dropdownStyle,
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          pointerEvents: 'auto',
        }}
        onWheel={(e) => {
          // Prevent wheel events from propagating to the dialog/body
          // This ensures the dropdown scrolls instead of the parent dialog
          const el = e.currentTarget
          const { scrollTop, scrollHeight, clientHeight } = el
          const atTop = scrollTop === 0 && e.deltaY < 0
          const atBottom = scrollTop + clientHeight >= scrollHeight && e.deltaY > 0
          // Only stop propagation if there's room to scroll or we're at boundary
          if (!atTop && !atBottom) {
            e.stopPropagation()
          }
        }}
      >
        <div className="p-1">
          {options.map((option) => (
            <div
              key={option.value}
              className={cn(
                "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-accent hover:text-accent-foreground cursor-pointer",
                option.value === value?.toString() && "bg-accent text-accent-foreground",
                option.disabled && "opacity-50 cursor-not-allowed pointer-events-none"
              )}
              onClick={() => !option.disabled && handleSelect(option.value)}
            >
              <span className="truncate">{option.label}</span>
              {option.value === value?.toString() && (
                <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
                  <Check className="h-4 w-4" />
                </span>
              )}
            </div>
          ))}
          {options.length === 0 && (
            <div className="py-2 px-2 text-sm text-muted-foreground text-center">No options</div>
          )}
        </div>
      </div>,
      document.body
    ) : null

    return (
      <div
        className={cn("relative inline-block w-full", className)}
        ref={containerRef}
      >
        {/* Hidden native select for form submission compatibility if needed */}
        <select
          className="sr-only"
          value={value}
          onChange={onChange as any}
          disabled={disabled}
          {...props}
        >
          {children}
        </select>

        {/* Custom Trigger */}
        <div
          ref={triggerRef}
          onClick={handleToggle}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            isOpen ? "ring-2 ring-ring ring-offset-2 border-primary" : "",
            className
          )}
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          tabIndex={0}
        >
          <span className={cn("block truncate", !selectedOption && "text-muted-foreground")}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0" />
        </div>

        {dropdown}
      </div>
    )
  }
)
Select.displayName = "Select"

export { Select }

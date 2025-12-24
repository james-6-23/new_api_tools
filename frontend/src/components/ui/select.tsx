import * as React from "react"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "../../lib/utils"

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  onChange?: (e: { target: { value: string } } | React.ChangeEvent<HTMLSelectElement>) => void
  placeholder?: string
}

const Select = React.forwardRef<HTMLDivElement, SelectProps>(
  ({ className, children, value, onChange, placeholder = "Select...", disabled, ...props }, ref) => {
    const [isOpen, setIsOpen] = React.useState(false)
    const containerRef = React.useRef<HTMLDivElement>(null)

    // Merge external ref with internal ref
    React.useImperativeHandle(ref, () => containerRef.current!)

    // Extract options from children
    const options = React.useMemo(() => {
      const opts: { value: string; label: string; disabled?: boolean }[] = []
      React.Children.forEach(children, (child) => {
        if (React.isValidElement(child) && child.type === 'option') {
          opts.push({
            value: child.props.value?.toString() || '',
            label: child.props.children?.toString() || child.props.value?.toString() || '',
            disabled: child.props.disabled
          })
        }
      })
      return opts
    }, [children])

    const selectedOption = options.find(opt => opt.value === value?.toString())

    // Handle clicking outside to close
    React.useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
          setIsOpen(false)
        }
      }
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

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
          onClick={() => !disabled && setIsOpen(!isOpen)}
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

        {/* Custom Dropdown */}
        {isOpen && (
          <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95">
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
          </div>
        )}
      </div>
    )
  }
)
Select.displayName = "Select"

export { Select }
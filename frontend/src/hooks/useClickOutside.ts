import { useEffect, RefObject } from 'react'

/**
 * Hook that detects clicks outside of the specified element.
 * When a click outside is detected, the callback function is called.
 */
export function useClickOutside(
    ref: RefObject<HTMLElement | null>,
    callback: () => void,
    enabled: boolean = true
) {
    useEffect(() => {
        if (!enabled) return

        const handleClickOutside = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                callback()
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [ref, callback, enabled])
}

import { useState, useEffect, useCallback } from 'react'
import * as db from '../services/indexedDB'

/**
 * React hook for managing user preferences stored in IndexedDB.
 * Provides type-safe get/set operations with automatic persistence.
 */
export function usePreference<T>(
  key: string,
  defaultValue: T
): [T, (value: T) => Promise<void>, boolean] {
  const [value, setValue] = useState<T>(defaultValue)
  const [loading, setLoading] = useState(true)

  // Load preference on mount
  useEffect(() => {
    const loadPreference = async () => {
      try {
        const stored = await db.getPreference<T>(key, defaultValue)
        setValue(stored)
      } catch (error) {
        console.error(`Failed to load preference ${key}:`, error)
      } finally {
        setLoading(false)
      }
    }
    loadPreference()
  }, [key, defaultValue])

  // Update preference
  const updateValue = useCallback(async (newValue: T) => {
    try {
      await db.setPreference(key, newValue)
      setValue(newValue)
    } catch (error) {
      console.error(`Failed to save preference ${key}:`, error)
      throw error
    }
  }, [key])

  return [value, updateValue, loading]
}

/**
 * Common preference keys with their default values.
 */
export const PREFERENCE_KEYS = {
  /** Default generator name prefix */
  DEFAULT_NAME_PREFIX: 'default_name_prefix',
  /** Default key prefix */
  DEFAULT_KEY_PREFIX: 'default_key_prefix',
  /** Default count for generation */
  DEFAULT_COUNT: 'default_count',
  /** Default quota mode */
  DEFAULT_QUOTA_MODE: 'default_quota_mode',
  /** Default expire mode */
  DEFAULT_EXPIRE_MODE: 'default_expire_mode',
  /** Dashboard default period */
  DASHBOARD_PERIOD: 'dashboard_period',
  /** Top-ups page size */
  TOPUPS_PAGE_SIZE: 'topups_page_size',
  /** Theme preference (for future use) */
  THEME: 'theme',
  /** Sidebar collapsed state */
  SIDEBAR_COLLAPSED: 'sidebar_collapsed',
} as const

/**
 * Default preference values.
 */
export const DEFAULT_PREFERENCES = {
  [PREFERENCE_KEYS.DEFAULT_NAME_PREFIX]: '',
  [PREFERENCE_KEYS.DEFAULT_KEY_PREFIX]: '',
  [PREFERENCE_KEYS.DEFAULT_COUNT]: 10,
  [PREFERENCE_KEYS.DEFAULT_QUOTA_MODE]: 'fixed' as const,
  [PREFERENCE_KEYS.DEFAULT_EXPIRE_MODE]: 'never' as const,
  [PREFERENCE_KEYS.DASHBOARD_PERIOD]: '7d' as const,
  [PREFERENCE_KEYS.TOPUPS_PAGE_SIZE]: 20,
  [PREFERENCE_KEYS.THEME]: 'light' as const,
  [PREFERENCE_KEYS.SIDEBAR_COLLAPSED]: false,
}

/**
 * Convenience hooks for common preferences.
 */
export function useDefaultCount() {
  return usePreference(
    PREFERENCE_KEYS.DEFAULT_COUNT,
    DEFAULT_PREFERENCES[PREFERENCE_KEYS.DEFAULT_COUNT]
  )
}

export function useDashboardPeriod() {
  return usePreference(
    PREFERENCE_KEYS.DASHBOARD_PERIOD,
    DEFAULT_PREFERENCES[PREFERENCE_KEYS.DASHBOARD_PERIOD]
  )
}

export function useTheme() {
  return usePreference(
    PREFERENCE_KEYS.THEME,
    DEFAULT_PREFERENCES[PREFERENCE_KEYS.THEME]
  )
}

export function useSidebarCollapsed() {
  return usePreference(
    PREFERENCE_KEYS.SIDEBAR_COLLAPSED,
    DEFAULT_PREFERENCES[PREFERENCE_KEYS.SIDEBAR_COLLAPSED]
  )
}

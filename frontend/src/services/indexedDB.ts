/**
 * IndexedDB Storage Service for NewAPI Middleware Tool.
 * Provides persistent browser storage for generation history, user preferences, and cached data.
 */

const DB_NAME = 'newapi_middleware'
const DB_VERSION = 1

// Store names
const STORES = {
  HISTORY: 'generation_history',
  PREFERENCES: 'user_preferences',
  CACHE: 'data_cache',
} as const

// Type definitions
export interface GenerationRecord {
  id: string
  timestamp: number
  name: string
  quota: number
  count: number
  keys: string[]
  expiresAt?: number
}

export interface UserPreferences {
  key: string
  value: unknown
  updatedAt: number
}

export interface CacheEntry {
  key: string
  value: unknown
  expiresAt: number
}

let db: IDBDatabase | null = null

/**
 * Open and initialize the IndexedDB database.
 */
async function openDatabase(): Promise<IDBDatabase> {
  if (db) return db

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      console.error('Failed to open IndexedDB:', request.error)
      reject(request.error)
    }

    request.onsuccess = () => {
      db = request.result
      resolve(db)
    }

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result

      // Generation history store
      if (!database.objectStoreNames.contains(STORES.HISTORY)) {
        const historyStore = database.createObjectStore(STORES.HISTORY, { keyPath: 'id' })
        historyStore.createIndex('timestamp', 'timestamp', { unique: false })
        historyStore.createIndex('name', 'name', { unique: false })
      }

      // User preferences store
      if (!database.objectStoreNames.contains(STORES.PREFERENCES)) {
        database.createObjectStore(STORES.PREFERENCES, { keyPath: 'key' })
      }

      // Data cache store
      if (!database.objectStoreNames.contains(STORES.CACHE)) {
        const cacheStore = database.createObjectStore(STORES.CACHE, { keyPath: 'key' })
        cacheStore.createIndex('expiresAt', 'expiresAt', { unique: false })
      }
    }
  })
}

/**
 * Ensure database is ready before operations.
 */
async function ensureDB(): Promise<IDBDatabase> {
  if (!db) {
    db = await openDatabase()
  }
  return db
}

// ============================================
// Generation History Operations
// ============================================

/**
 * Add a new generation record to history.
 */
export async function addHistoryRecord(record: Omit<GenerationRecord, 'id' | 'timestamp'>): Promise<string> {
  const database = await ensureDB()
  const id = `gen_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  const fullRecord: GenerationRecord = {
    ...record,
    id,
    timestamp: Date.now(),
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.HISTORY, 'readwrite')
    const store = transaction.objectStore(STORES.HISTORY)
    const request = store.add(fullRecord)

    request.onsuccess = () => resolve(id)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get all history records, sorted by timestamp descending.
 */
export async function getHistoryRecords(limit = 100): Promise<GenerationRecord[]> {
  const database = await ensureDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.HISTORY, 'readonly')
    const store = transaction.objectStore(STORES.HISTORY)
    const index = store.index('timestamp')
    const request = index.openCursor(null, 'prev')
    const records: GenerationRecord[] = []

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor && records.length < limit) {
        records.push(cursor.value)
        cursor.continue()
      } else {
        resolve(records)
      }
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get a single history record by ID.
 */
export async function getHistoryRecord(id: string): Promise<GenerationRecord | null> {
  const database = await ensureDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.HISTORY, 'readonly')
    const store = transaction.objectStore(STORES.HISTORY)
    const request = store.get(id)

    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Delete a history record by ID.
 */
export async function deleteHistoryRecord(id: string): Promise<void> {
  const database = await ensureDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.HISTORY, 'readwrite')
    const store = transaction.objectStore(STORES.HISTORY)
    const request = store.delete(id)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * Clear all history records.
 */
export async function clearHistory(): Promise<void> {
  const database = await ensureDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.HISTORY, 'readwrite')
    const store = transaction.objectStore(STORES.HISTORY)
    const request = store.clear()

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get history count.
 */
export async function getHistoryCount(): Promise<number> {
  const database = await ensureDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.HISTORY, 'readonly')
    const store = transaction.objectStore(STORES.HISTORY)
    const request = store.count()

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// ============================================
// User Preferences Operations
// ============================================

/**
 * Get a user preference value.
 */
export async function getPreference<T>(key: string, defaultValue: T): Promise<T> {
  const database = await ensureDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.PREFERENCES, 'readonly')
    const store = transaction.objectStore(STORES.PREFERENCES)
    const request = store.get(key)

    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.value as T)
      } else {
        resolve(defaultValue)
      }
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Set a user preference value.
 */
export async function setPreference<T>(key: string, value: T): Promise<void> {
  const database = await ensureDB()
  const entry: UserPreferences = {
    key,
    value,
    updatedAt: Date.now(),
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.PREFERENCES, 'readwrite')
    const store = transaction.objectStore(STORES.PREFERENCES)
    const request = store.put(entry)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * Delete a user preference.
 */
export async function deletePreference(key: string): Promise<void> {
  const database = await ensureDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.PREFERENCES, 'readwrite')
    const store = transaction.objectStore(STORES.PREFERENCES)
    const request = store.delete(key)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get all user preferences.
 */
export async function getAllPreferences(): Promise<Record<string, unknown>> {
  const database = await ensureDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.PREFERENCES, 'readonly')
    const store = transaction.objectStore(STORES.PREFERENCES)
    const request = store.getAll()

    request.onsuccess = () => {
      const result: Record<string, unknown> = {}
      for (const entry of request.result as UserPreferences[]) {
        result[entry.key] = entry.value
      }
      resolve(result)
    }
    request.onerror = () => reject(request.error)
  })
}

// ============================================
// Data Cache Operations
// ============================================

/**
 * Get cached data.
 */
export async function getCached<T>(key: string): Promise<T | null> {
  const database = await ensureDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.CACHE, 'readonly')
    const store = transaction.objectStore(STORES.CACHE)
    const request = store.get(key)

    request.onsuccess = () => {
      const entry = request.result as CacheEntry | undefined
      if (entry && entry.expiresAt > Date.now()) {
        resolve(entry.value as T)
      } else {
        // Entry expired or not found
        if (entry) {
          // Clean up expired entry
          deleteCache(key).catch(console.error)
        }
        resolve(null)
      }
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Set cached data with TTL.
 */
export async function setCache<T>(key: string, value: T, ttlSeconds = 300): Promise<void> {
  const database = await ensureDB()
  const entry: CacheEntry = {
    key,
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.CACHE, 'readwrite')
    const store = transaction.objectStore(STORES.CACHE)
    const request = store.put(entry)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * Delete cached data.
 */
export async function deleteCache(key: string): Promise<void> {
  const database = await ensureDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.CACHE, 'readwrite')
    const store = transaction.objectStore(STORES.CACHE)
    const request = store.delete(key)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * Clear all expired cache entries.
 */
export async function cleanupExpiredCache(): Promise<number> {
  const database = await ensureDB()
  const now = Date.now()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.CACHE, 'readwrite')
    const store = transaction.objectStore(STORES.CACHE)
    const index = store.index('expiresAt')
    const range = IDBKeyRange.upperBound(now)
    const request = index.openCursor(range)
    let deletedCount = 0

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        cursor.delete()
        deletedCount++
        cursor.continue()
      } else {
        resolve(deletedCount)
      }
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Clear all cache.
 */
export async function clearAllCache(): Promise<void> {
  const database = await ensureDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.CACHE, 'readwrite')
    const store = transaction.objectStore(STORES.CACHE)
    const request = store.clear()

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

// ============================================
// Migration from localStorage
// ============================================

interface LegacyHistoryEntry {
  id: string
  timestamp: number
  name: string
  quota: number
  count: number
  keys: string[]
}

/**
 * Migrate generation history from localStorage to IndexedDB.
 */
export async function migrateFromLocalStorage(): Promise<number> {
  const LEGACY_KEY = 'generation_history'
  const legacyData = localStorage.getItem(LEGACY_KEY)

  if (!legacyData) {
    return 0
  }

  try {
    const entries = JSON.parse(legacyData) as LegacyHistoryEntry[]
    const database = await ensureDB()
    let migratedCount = 0

    for (const entry of entries) {
      const record: GenerationRecord = {
        id: entry.id || `gen_${entry.timestamp}_${Math.random().toString(36).substring(2, 9)}`,
        timestamp: entry.timestamp,
        name: entry.name,
        quota: entry.quota,
        count: entry.count,
        keys: entry.keys,
      }

      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORES.HISTORY, 'readwrite')
        const store = transaction.objectStore(STORES.HISTORY)
        const request = store.put(record)

        request.onsuccess = () => {
          migratedCount++
          resolve()
        }
        request.onerror = () => reject(request.error)
      })
    }

    // Clear localStorage after successful migration
    localStorage.removeItem(LEGACY_KEY)
    console.log(`Migrated ${migratedCount} records from localStorage to IndexedDB`)

    return migratedCount
  } catch (error) {
    console.error('Failed to migrate from localStorage:', error)
    return 0
  }
}

// ============================================
// Initialization
// ============================================

/**
 * Initialize the IndexedDB service and run migrations.
 */
export async function initializeStorage(): Promise<void> {
  try {
    await openDatabase()
    await migrateFromLocalStorage()
    await cleanupExpiredCache()
    console.log('IndexedDB storage initialized')
  } catch (error) {
    console.error('Failed to initialize IndexedDB storage:', error)
    throw error
  }
}

/**
 * Check if IndexedDB is supported.
 */
export function isIndexedDBSupported(): boolean {
  return typeof indexedDB !== 'undefined'
}

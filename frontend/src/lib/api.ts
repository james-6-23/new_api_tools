/**
 * API utility functions with automatic 401 handling.
 * When a 401 response is received, the user is automatically logged out.
 */

type LogoutFn = () => void

let globalLogout: LogoutFn | null = null

/**
 * Set the global logout function. Should be called once in AuthProvider.
 */
export function setGlobalLogout(logout: LogoutFn) {
  globalLogout = logout
}

/**
 * Clear the global logout function.
 */
export function clearGlobalLogout() {
  globalLogout = null
}

/**
 * Wrapper around fetch that automatically handles 401 responses.
 * If a 401 is received, the user is logged out and redirected to login.
 */
export async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const response = await fetch(url, options)
  
  if (response.status === 401 && globalLogout) {
    console.warn('Received 401 response, logging out...')
    globalLogout()
    // Throw an error to prevent further processing
    throw new Error('Unauthorized - session expired')
  }
  
  return response
}

/**
 * Helper to create auth headers with Bearer token.
 */
export function createAuthHeaders(token: string | null): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  }
}

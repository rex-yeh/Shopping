let csrfToken = ''

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export const setCsrfToken = (token) => {
  csrfToken = token || ''
}

export async function initializeCsrf() {
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' })
  const data = await response.json()
  if (!response.ok) throw new ApiError(data.error || '無法初始化請求驗證。', response.status)
  setCsrfToken(data.csrfToken)
}

export async function apiRequest(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const headers = new Headers(options.headers || {})
  const isFormData = options.body instanceof FormData

  if (options.body !== undefined && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!csrfToken) await initializeCsrf()
    headers.set('X-CSRF-Token', csrfToken)
  }

  const response = await fetch(url, {
    ...options,
    method,
    headers,
    credentials: 'same-origin',
  })
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : null
  if (!response.ok) {
    throw new ApiError(data?.error || `API 請求失敗（${response.status}）。`, response.status)
  }
  if (data?.csrfToken) setCsrfToken(data.csrfToken)
  return data
}

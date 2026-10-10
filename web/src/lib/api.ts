import { mockRequest } from './mock'
import { clearToken, getToken } from './token'

// List endpoints add `meta` when paged: pass `nextCursor` back as `cursor`; null means the end.
export interface PageMeta {
  count: number
  nextCursor: string | null
}

export type Envelope<T> = { ok: true; data: T; meta?: PageMeta } | { ok: false; error: string; message: string }

export class ApiError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

const BASE = import.meta.env.VITE_API_URL ?? '/api'
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false'

// Fired when a signed-in request is refused because the account changed underneath it.
export const SESSION_STALE = 'everest:session-stale'

type Init = Omit<RequestInit, 'body'> & { body?: unknown }

export async function api<T>(path: string, init: Init = {}): Promise<T> {
  return (await apiPage<T>(path, init)).data
}

// Same call, keeping the paging meta for lists that page.
export async function apiPage<T>(path: string, init: Init = {}): Promise<{ data: T; meta?: PageMeta }> {
  if (USE_MOCKS) {
    try {
      return { data: await mockRequest<T>(path, init) }
    } catch (e) {
      const err = e as Error & { code?: string }
      throw new ApiError(err.code ?? 'MOCK_ERROR', err.message, 400)
    }
  }

  const { body, headers, ...rest } = init
  const token = getToken()
  const isForm = body instanceof FormData

  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: isForm ? (body as FormData) : body === undefined ? undefined : JSON.stringify(body),
  })

  let payload: Envelope<T>
  try {
    payload = await res.json()
  } catch {
    throw new ApiError('BAD_RESPONSE', 'The server sent a response we could not read.', res.status)
  }

  if (!payload.ok) {
    // The login was deactivated or expired, or the owner reset the password: let the session catch up.
    if (token && res.status === 401) clearToken()
    if (token && (res.status === 401 || payload.error === 'PASSWORD_CHANGE_REQUIRED')) window.dispatchEvent(new Event(SESSION_STALE))
    throw new ApiError(payload.error, payload.message, res.status)
  }
  return { data: payload.data, meta: payload.meta }
}

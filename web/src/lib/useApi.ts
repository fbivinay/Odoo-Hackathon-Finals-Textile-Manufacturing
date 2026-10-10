import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, apiPage, ApiError } from './api'

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (path === null) return
    let live = true
    setLoading(true)
    setError(null)
    api<T>(path)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Something went wrong.'))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [path, nonce])

  return { data, loading, error, reload }
}

// Fire a write, toast the outcome, return true on success.
export async function mutate(path: string, method: string, body: unknown, success: string) {
  try {
    await api(path, { method, body })
    toast.success(success)
    return true
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Something went wrong.')
    return false
  }
}

// A paged list: first page on load, `more()` appends the next one via meta.nextCursor.
export function usePaged<T>(path: string | null, limit = 50) {
  const [rows, setRows] = useState<T[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const url = useCallback(
    (after: string | null) => (path === null ? null : `${path}${path.includes('?') ? '&' : '?'}limit=${limit}${after ? `&cursor=${after}` : ''}`),
    [path, limit],
  )

  useEffect(() => {
    const first = url(null)
    if (first === null) return
    let live = true
    setLoading(true)
    setError(null)
    apiPage<T[]>(first)
      .then(({ data, meta }) => {
        if (!live) return
        setRows(data)
        setCursor(meta?.nextCursor ?? null)
      })
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Something went wrong.'))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [url, nonce])

  const more = useCallback(async () => {
    const next = cursor && url(cursor)
    if (!next) return
    const { data, meta } = await apiPage<T[]>(next)
    setRows((r) => [...r, ...data])
    setCursor(meta?.nextCursor ?? null)
  }, [cursor, url])

  return { rows, loading, error, more, hasMore: cursor !== null, reload: useCallback(() => setNonce((n) => n + 1), []) }
}

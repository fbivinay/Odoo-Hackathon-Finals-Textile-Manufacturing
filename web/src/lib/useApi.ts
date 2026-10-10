import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, apiPage, ApiError } from './api'
import { useDataVersion } from './changes'

// `refreshMs` re-fetches in the background on that interval (paused while the tab is hidden),
// keeping the current data on screen instead of flashing skeletons.
export function useApi<T>(path: string | null, { refreshMs }: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const version = useDataVersion()
  const seen = useRef(version)

  // Something was saved (here, in another section or another tab): refresh quietly in place.
  useEffect(() => {
    if (path === null || seen.current === version) return
    seen.current = version
    let live = true
    api<T>(path)
      .then((d) => {
        if (!live) return
        setData(d)
        setUpdatedAt(new Date())
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [path, version])

  useEffect(() => {
    if (path === null) return
    let live = true
    setLoading(true)
    setError(null)
    api<T>(path)
      .then((d) => {
        if (!live) return
        setData(d)
        setUpdatedAt(new Date())
      })
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Something went wrong.'))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [path, nonce])

  useEffect(() => {
    if (path === null || !refreshMs) return
    let live = true
    const tick = () => {
      if (document.hidden) return
      api<T>(path)
        .then((d) => {
          if (!live) return
          setData(d)
          setUpdatedAt(new Date())
        })
        .catch(() => {}) // a missed background refresh just waits for the next one
    }
    const id = window.setInterval(tick, refreshMs)
    const onVisible = () => !document.hidden && tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [path, refreshMs])

  return { data, loading, error, reload, updatedAt }
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

  // Something was saved elsewhere: re-read as many rows as are on screen, quietly.
  const version = useDataVersion()
  const seen = useRef(version)
  const shown = useRef(limit)
  useEffect(() => {
    shown.current = Math.max(limit, rows.length)
  })
  useEffect(() => {
    if (path === null || seen.current === version) return
    seen.current = version
    let live = true
    apiPage<T[]>(`${path}${path.includes('?') ? '&' : '?'}limit=${shown.current}`)
      .then(({ data, meta }) => {
        if (!live) return
        setRows(data)
        setCursor(meta?.nextCursor ?? null)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [path, version])

  const more = useCallback(async () => {
    const next = cursor && url(cursor)
    if (!next) return
    const { data, meta } = await apiPage<T[]>(next)
    setRows((r) => [...r, ...data])
    setCursor(meta?.nextCursor ?? null)
  }, [cursor, url])

  return { rows, loading, error, more, hasMore: cursor !== null, reload: useCallback(() => setNonce((n) => n + 1), []) }
}

// Every page of a paged list, 500 rows a request.
export async function fetchAll<T>(path: string): Promise<T[]> {
  const out: T[] = []
  let cursor: string | null = null
  do {
    const sep = path.includes('?') ? '&' : '?'
    const page: { data: T[]; meta?: { nextCursor: string | null } } = await apiPage<T[]>(`${path}${sep}limit=500${cursor ? `&cursor=${cursor}` : ''}`)
    out.push(...page.data)
    cursor = page.meta?.nextCursor ?? null
  } while (cursor)
  return out
}

// Every row of a paged list, refreshed quietly after any save. For screens that sum or search
// across the whole history (a few thousand rows).
export function useAll<T>(path: string | null) {
  const [rows, setRows] = useState<T[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const version = useDataVersion()

  useEffect(() => {
    if (path === null) return
    let live = true
    fetchAll<T>(path)
      .then((r) => live && setRows(r))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Something went wrong.'))
    return () => {
      live = false
    }
  }, [path, version])

  return { rows, error, loading: rows === null && !error }
}

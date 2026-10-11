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

// The rows per page of every numbered list.
export const PAGE_SIZE = 20

// A numbered list read from the server one page at a time (?page=&limit=). `path` carries the
// search and filters; changing it starts again at page 1. The rows on screen stay put while the
// next page loads, so the table never flashes empty.
export function usePages<T>(path: string | null, size = PAGE_SIZE) {
  const [rows, setRows] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState({ path, page: 1 })
  // The list whose rows are on screen. Until it matches `path`, a different list is still loading.
  const [loaded, setLoaded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  // A new search or filter is a new list: back to the first page, in the same render.
  const page = state.path === path ? state.page : 1
  const setPage = useCallback((n: number) => setState({ path, page: n }), [path])
  const version = useDataVersion()

  useEffect(() => {
    if (path === null) return
    let live = true
    apiPage<T[]>(`${path}${path.includes('?') ? '&' : '?'}limit=${size}&page=${page}`)
      .then(({ data, meta }) => {
        if (!live) return
        setRows(data)
        setTotal(meta?.total ?? data.length)
        setError(null)
      })
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Something went wrong.'))
      .finally(() => live && setLoaded(path))
    return () => {
      live = false
    }
    // `version`: something was saved elsewhere, so read this page again, quietly.
  }, [path, page, size, nonce, version])

  // Only a different list shows the skeleton; moving between pages keeps the rows in place.
  const loading = path !== null && loaded !== path

  const pages = Math.max(1, Math.ceil(total / size))
  return { rows, loading, error, page: Math.min(page, pages), setPage, total, pages, size, reload: useCallback(() => setNonce((n) => n + 1), []) }
}

// What <Pagination> needs from either hook.
export const pagerOf = (p: { page: number; pages: number; total: number; size: number; setPage: (n: number) => void }) => ({ page: p.page, pages: p.pages, total: p.total, size: p.size, onPage: p.setPage })

// The same pager for a list already in memory: slices it, and returns to page 1 when the list
// itself changes (a search or a filter).
export function useClientPages<T>(all: T[], size = PAGE_SIZE) {
  const [state, setState] = useState({ key: all.length, page: 1 })
  const pages = Math.max(1, Math.ceil(all.length / size))
  const page = Math.min(state.key === all.length ? state.page : 1, pages)
  return { rows: all.slice((page - 1) * size, page * size), page, setPage: (n: number) => setState({ key: all.length, page: n }), total: all.length, pages, size }
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

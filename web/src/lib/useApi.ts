import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, ApiError } from './api'

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

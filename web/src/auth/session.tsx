import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, SESSION_STALE } from '@/lib/api'
import { clearToken, decodeToken, getToken, setToken } from '@/lib/token'
import type { AuthResponse, User } from '@/types'

interface SessionValue {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<User>
  signOut: () => void
  changePassword: (newPassword: string) => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token || !decodeToken(token)) {
      setLoading(false)
      return
    }
    api<User>('/me')
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setLoading(false))
  }, [])

  // Keep the session in step with what the owner changes on the Employees screen (role, extra tabs,
  // password reset, deactivation): re-read it when the tab is looked at again or a request is refused.
  useEffect(() => {
    const sync = () => {
      if (!getToken()) return setUser(null)
      api<User>('/me')
        .then(setUser)
        .catch(() => !getToken() && setUser(null))
    }
    const onVisible = () => !document.hidden && sync()
    window.addEventListener(SESSION_STALE, sync)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener(SESSION_STALE, sync)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const value = useMemo<SessionValue>(
    () => ({
      user,
      loading,
      async signIn(email, password) {
        const { token, user } = await api<AuthResponse>('/auth/signin', { method: 'POST', body: { email, password } })
        setToken(token)
        setUser(user)
        return user
      },
      signOut() {
        clearToken()
        setUser(null)
      },
      async changePassword(newPassword) {
        await api('/auth/change-password', { method: 'POST', body: { newPassword } })
        setUser((u) => (u ? { ...u, mustChangePassword: false } : u))
      },
    }),
    [user, loading],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export { ApiError }

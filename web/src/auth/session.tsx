import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError } from '@/lib/api'
import { clearToken, decodeToken, getToken, setToken } from '@/lib/token'
import type { AuthResponse, User } from '@/types'

interface SessionValue {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<User>
  signOut: () => void
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
    }),
    [user, loading],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export { ApiError }

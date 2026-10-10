import { Navigate, Outlet } from 'react-router-dom'
import { canOpen, homeFor } from '@/components/AppShell'
import type { Role } from '@/types'
import { useSession } from './session'

// OWNER passes every role check, same as the backend's requireRole.
// `tab` is the sidebar path the route belongs to, so a tab granted to one employee opens too.
export function ProtectedRoute({ roles, tab = '' }: { roles?: Role[]; tab?: string }) {
  const { user, loading } = useSession()
  if (loading) return null
  if (!user) return <Navigate to="/sign-in" replace />
  if (user.mustChangePassword) return <Navigate to="/set-password" replace />
  if (roles && !canOpen(user, tab, roles)) return <Navigate to={homeFor(user)} replace />
  return <Outlet />
}

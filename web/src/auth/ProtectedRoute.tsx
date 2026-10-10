import { Navigate, Outlet } from 'react-router-dom'
import { homeFor } from '@/components/AppShell'
import type { Role } from '@/types'
import { useSession } from './session'

// OWNER passes every role check, same as the backend's requireRole.
export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { user, loading } = useSession()
  if (loading) return null
  if (!user) return <Navigate to="/sign-in" replace />
  if (roles && user.role !== 'OWNER' && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />
  return <Outlet />
}

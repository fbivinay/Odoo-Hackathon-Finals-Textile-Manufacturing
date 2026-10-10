import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { ProtectedRoute } from '@/auth/ProtectedRoute'
import { SessionProvider, useSession } from '@/auth/session'
import { AppShell, homeFor, NAV } from '@/components/AppShell'
import { SignIn } from '@/pages/SignIn'

const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })))

const Dashboard = page(() => import('@/pages/Dashboard'), 'Dashboard')
const Materials = page(() => import('@/pages/Materials'), 'Materials')
const Orders = page(() => import('@/pages/Orders'), 'Orders')
const Production = page(() => import('@/pages/Production'), 'Production')
const QC = page(() => import('@/pages/QC'), 'QC')
const Dispatch = page(() => import('@/pages/Dispatch'), 'Dispatch')
const Track = page(() => import('@/pages/Track'), 'Track')

const PAGES: Record<string, ReactNode> = {
  '/dashboard': <Dashboard />,
  '/materials': <Materials />,
  '/orders': <Orders />,
  '/production': <Production />,
  '/qc': <QC />,
  '/dispatch': <Dispatch />,
}

function RouteFallback() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

function Home() {
  const { user, loading } = useSession()
  if (loading) return null
  return <Navigate to={user ? homeFor(user.role) : '/sign-in'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/sign-in" element={<SignIn />} />
            <Route path="/track/:token" element={<Track />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                {NAV.map((n) => (
                  <Route key={n.to} element={<ProtectedRoute roles={n.roles} />}>
                    <Route path={n.to} element={PAGES[n.to]} />
                  </Route>
                ))}
              </Route>
            </Route>
            <Route path="*" element={<Home />} />
          </Routes>
        </Suspense>
      </SessionProvider>
      <Toaster position="top-right" />
    </BrowserRouter>
  )
}

import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { ProtectedRoute } from '@/auth/ProtectedRoute'
import { SessionProvider, useSession } from '@/auth/session'
import { AppShell, homeFor, NAV } from '@/components/AppShell'
import { SignIn } from '@/pages/SignIn'
import { Splash } from '@/components/Splash'
import { ScrollReveal } from '@/components/ScrollReveal'

const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })))

const Dashboard = page(() => import('@/pages/Dashboard'), 'Dashboard')
const Materials = page(() => import('@/pages/Materials'), 'Materials')
const Orders = page(() => import('@/pages/Orders'), 'Orders')
const Production = page(() => import('@/pages/Production'), 'Production')
const QC = page(() => import('@/pages/QC'), 'QC')
const Dispatch = page(() => import('@/pages/Dispatch'), 'Dispatch')
const Track = page(() => import('@/pages/Track'), 'Track')
const RawMaterials = page(() => import('@/pages/RawMaterials'), 'RawMaterials')
const RawMaterial = page(() => import('@/pages/RawMaterial'), 'RawMaterial')
const Waste = page(() => import('@/pages/Waste'), 'Waste')
const Customers = page(() => import('@/pages/Customers'), 'Customers')
const Employees = page(() => import('@/pages/Employees'), 'Employees')
const SetPassword = page(() => import('@/pages/SetPassword'), 'SetPassword')
const Customer = page(() => import('@/pages/Customer'), 'Customer')
const OrderDetail = page(() => import('@/pages/OrderDetail'), 'OrderDetail')
const Config = page(() => import('@/pages/Config'), 'Config')
const Accounts = page(() => import('@/pages/Accounts'), 'Accounts')
const Lab = page(() => import('@/pages/Lab'), 'Lab')
const InvoiceDoc = page(() => import('@/pages/accounts/Documents'), 'InvoiceDoc')
const BillDoc = page(() => import('@/pages/accounts/Documents'), 'BillDoc')
const ExpenseDoc = page(() => import('@/pages/accounts/Documents'), 'ExpenseDoc')
const PayslipDoc = page(() => import('@/pages/accounts/Documents'), 'PayslipDoc')

const PAGES: Record<string, ReactNode> = {
  '/dashboard': <Dashboard />,
  '/orders': <Orders />,
  '/clients': <Customers />,
  '/production': <Production />,
  '/materials': <Materials />,
  '/raw-materials': <RawMaterials />,
  '/waste': <Waste />,
  '/qc': <QC />,
  '/dispatch': <Dispatch />,
  '/employees': <Employees />,
  '/config': <Config />,
  '/accounts': <Accounts />,
  '/lab': <Lab />,
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
  return <Navigate to={user ? homeFor(user) : '/sign-in'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Splash />
      <ScrollReveal />
      <SessionProvider>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/sign-in" element={<SignIn />} />
            <Route path="/set-password" element={<SetPassword />} />
            <Route path="/track/:token" element={<Track />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                {/* Pages reached from inside another page rather than the sidebar. */}
                <Route element={<ProtectedRoute roles={['STORE', 'PRODUCTION']} tab="/raw-materials" />}>
                  <Route path="/raw-materials/:id" element={<RawMaterial />} />
                </Route>
                <Route element={<ProtectedRoute roles={['STORE', 'PRODUCTION', 'DISPATCH']} tab="/orders" />}>
                  <Route path="/orders/:id" element={<OrderDetail />} />
                </Route>
                <Route element={<ProtectedRoute roles={[]} tab="/accounts" />}>
                  <Route path="/accounts/invoices/:id" element={<InvoiceDoc />} />
                  <Route path="/accounts/bills/:id" element={<BillDoc />} />
                  <Route path="/accounts/expenses/:id" element={<ExpenseDoc />} />
                  <Route path="/accounts/payslip/:workerId/:month" element={<PayslipDoc />} />
                </Route>
                <Route element={<ProtectedRoute roles={[]} tab="/clients" />}>
                  <Route path="/clients/:id" element={<Customer />} />
                </Route>
                <Route path="/inventory" element={<Navigate to="/raw-materials" replace />} />
                <Route path="/new-order" element={<Navigate to="/orders" replace />} />
                {NAV.map((n) => (
                  <Route key={n.to} element={<ProtectedRoute roles={n.roles} tab={n.to} />}>
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

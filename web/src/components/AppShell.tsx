import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { ClipboardCheck, Factory, LayoutDashboard, LogOut, Package, ShoppingCart, Truck } from 'lucide-react'
import type { ComponentType } from 'react'
import { Logo } from '@/components/Logo'
import { useSession } from '@/auth/session'
import { Button } from '@/components/ui/button'
import type { Role } from '@/types'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  roles: Role[] // OWNER sees everything
}

export const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, roles: [] },
  { to: '/materials', label: 'Raw material', icon: Package, roles: ['STORE'] },
  { to: '/orders', label: 'Orders', icon: ShoppingCart, roles: ['STORE', 'PRODUCTION', 'DISPATCH'] },
  { to: '/production', label: 'Production', icon: Factory, roles: ['PRODUCTION'] },
  { to: '/qc', label: 'Quality check', icon: ClipboardCheck, roles: ['QC'] },
  { to: '/dispatch', label: 'Dispatch', icon: Truck, roles: ['DISPATCH'] },
]

export const navFor = (role: Role) => NAV.filter((n) => role === 'OWNER' || n.roles.includes(role))
export const homeFor = (role: Role) => navFor(role)[0].to

const ROLE_LABEL: Record<Role, string> = { OWNER: 'Owner', STORE: 'Store', PRODUCTION: 'Production', QC: 'Quality', DISPATCH: 'Dispatch' }

export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark__mark">
        <Logo className="size-5" />
      </span>
      <span className="wordmark__text">
        Everest
        <span className="wordmark__sub">Textile Mills</span>
      </span>
    </span>
  )
}

export function AppShell() {
  const { user, signOut } = useSession()
  const navigate = useNavigate()
  if (!user) return null

  return (
    <div className="flex min-h-screen flex-col">
      <header className="masthead print:hidden">
        <div className="shell masthead__inner">
          <Link to={homeFor(user.role)} aria-label="Everest home">
            <Wordmark />
          </Link>
          <nav className="nav" aria-label="Sections">
            {navFor(user.role).map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className="nav__link">
                <Icon className="size-3.5" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden text-right leading-tight lg:block">
              <p className="text-xs font-medium">{user.name}</p>
              <p className="text-[11px] text-ink-3">{ROLE_LABEL[user.role]}</p>
            </div>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Log out"
              title="Log out"
              onClick={() => {
                signOut()
                navigate('/sign-in', { replace: true })
              }}
            >
              <LogOut className="size-3.5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="shell flex-1 py-5">
        <Outlet />
      </main>

      <footer className="footer print:hidden">
        <div className="shell">
          <div className="footer__meta">
            <span>Everest Textile Mills · Surat, Gujarat · one system for yarn, looms, QC and dispatch</span>
            <span>Signed in as {user.email}</span>
          </div>
          <div className="footer__wordmark" aria-hidden="true">
            Everest
          </div>
        </div>
      </footer>
    </div>
  )
}

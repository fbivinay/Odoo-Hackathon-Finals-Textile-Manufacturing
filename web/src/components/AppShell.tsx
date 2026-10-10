import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { CalendarRange, ClipboardCheck, Factory, FlaskConical, Landmark, LayoutDashboard, Menu, Package, Recycle, ShoppingCart, SlidersHorizontal, Truck, UserCog, Users } from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { Assistant } from '@/components/Assistant'
import { Logo } from '@/components/Logo'
import { SettingsMenu } from '@/components/SettingsMenu'
import { useSession } from '@/auth/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { Role, User } from '@/types'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  roles: Role[] // OWNER sees everything
}

export const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, roles: [] },
  { to: '/orders', label: 'Orders', icon: ShoppingCart, roles: ['STORE', 'PRODUCTION', 'DISPATCH'] },
  { to: '/materials', label: 'Yarn Received', icon: Package, roles: ['STORE'] },
  { to: '/raw-materials', label: 'Raw Materials', icon: FlaskConical, roles: ['STORE', 'PRODUCTION'] },
  { to: '/clients', label: 'Clients', icon: Users, roles: [] },
  { to: '/accounts', label: 'Accounts', icon: Landmark, roles: [] },
  { to: '/production', label: 'Production', icon: Factory, roles: ['PRODUCTION'] },
  { to: '/planning', label: 'Order Forecast', icon: CalendarRange, roles: ['PRODUCTION', 'STORE'] },
  { to: '/qc', label: 'Quality check', icon: ClipboardCheck, roles: ['QC'] },
  { to: '/waste', label: 'Waste', icon: Recycle, roles: ['PRODUCTION', 'QC'] },
  { to: '/dispatch', label: 'Dispatch', icon: Truck, roles: ['DISPATCH'] },
  { to: '/employees', label: 'Employees', icon: UserCog, roles: [] },
  { to: '/config', label: 'Config', icon: SlidersHorizontal, roles: [] },
]

type Access = Pick<User, 'role' | 'extraTabs'>

// Overview and Employees stay with the owner; every other tab can be granted to one employee on top of their role.
export const GRANTABLE = NAV.filter((n) => n.to !== '/dashboard' && n.to !== '/employees')
// The role whose rights a granted tab carries, mirroring backend/src/lib/tabs.js.
const TAB_ROLE: Record<string, Role> = { '/materials': 'STORE', '/raw-materials': 'STORE', '/orders': 'STORE', '/production': 'PRODUCTION', '/qc': 'QC', '/dispatch': 'DISPATCH' }

export const canOpen = (u: Access, tab: string, roles: Role[]) => u.role === 'OWNER' || roles.includes(u.role) || (u.extraTabs ?? []).includes(tab)
export const navFor = (u: Access) => NAV.filter((n) => canOpen(u, n.to, n.roles))
export const homeFor = (u: Access) => navFor(u)[0].to
// True when the user acts as one of these roles, by their own role or through a granted tab.
export const actsAs = (u: Access | null, ...roles: Role[]) =>
  !!u && (u.role === 'OWNER' || roles.includes(u.role) || (u.extraTabs ?? []).some((t) => roles.includes(TAB_ROLE[t])))

export const ROLE_LABEL: Record<Role, string> = { OWNER: 'Owner', STORE: 'Store Manager', PRODUCTION: 'Production Supervisor', QC: 'Quality Inspector', DISPATCH: 'Dispatch Manager' }

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

function SidebarNav({ user, onNavigate, onSignOut }: { user: User; onNavigate?: () => void; onSignOut: () => void }) {
  return (
    <>
      <div className="flex h-14 items-center gap-2 border-b border-border px-5">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-brand text-white">
          <Logo className="size-3.5" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-medium">Everest</p>
          <p className="text-[11px] text-muted-foreground">Textile Mills</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 p-3" aria-label="Sections">
        {navFor(user).map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive ? 'bg-brand-tint font-medium text-brand' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <SettingsMenu user={user} onSignOut={onSignOut} />
      </div>
    </>
  )
}

export function AppShell() {
  const { user, signOut } = useSession()
  const navigate = useNavigate()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  if (!user) return null

  // Log out asks first, so a stray click doesn't end the session.
  function askSignOut() {
    setMobileNavOpen(false)
    setConfirmLogout(true)
  }

  function handleSignOut() {
    setConfirmLogout(false)
    signOut()
    navigate('/sign-in', { replace: true })
  }

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-border bg-white md:flex print:hidden">
        <SidebarNav user={user} onSignOut={askSignOut} />
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-60 md:hidden">
          <SidebarNav user={user} onNavigate={() => setMobileNavOpen(false)} onSignOut={askSignOut} />
        </SheetContent>
      </Sheet>

      <Dialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Log out?</DialogTitle>
            <DialogDescription>You'll need to sign in again to continue.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLogout(false)}>
              Cancel
            </Button>
            <Button onClick={handleSignOut}>Log out</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col md:pl-60 print:pl-0">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-white/80 px-4 backdrop-blur sm:px-6 print:hidden">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setMobileNavOpen(true)}>
              <Menu className="size-4.5" />
              <span className="sr-only">Open menu</span>
            </Button>
          </div>
          <div className="text-right leading-tight">
            <p className="text-xs font-medium">{user.name}</p>
            <p className="text-[11px] text-muted-foreground">{ROLE_LABEL[user.role]}</p>
          </div>
        </header>

        {/* Extra room at the bottom so the last row can scroll clear of the Ask Everest button. */}
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 pb-24 sm:p-6 sm:pb-24">
          <Outlet />
        </main>
      </div>

      {/* Hidden while a first-time password is still pending: nothing answers until it is set. */}
      {!user.mustChangePassword && <Assistant user={user} tabs={navFor(user).map((n) => n.to)} />}
    </div>
  )
}

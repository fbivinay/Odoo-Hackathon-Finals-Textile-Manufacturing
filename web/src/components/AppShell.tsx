import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { CalendarRange, ClipboardCheck, Factory, LayoutDashboard, LogOut, Menu, Package, Recycle, ShoppingCart, Truck } from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { Logo } from '@/components/Logo'
import { useSession } from '@/auth/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { Role } from '@/types'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  roles: Role[] // OWNER sees everything
}

export const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, roles: [] },
  { to: '/raw-materials', label: 'Raw materials', icon: Package, roles: ['STORE', 'PRODUCTION'] },
  { to: '/orders', label: 'Customer Orders', icon: ShoppingCart, roles: ['STORE', 'PRODUCTION', 'DISPATCH'] },
  { to: '/production', label: 'Production', icon: Factory, roles: ['PRODUCTION'] },
  { to: '/planning', label: 'Order Forecast', icon: CalendarRange, roles: ['PRODUCTION', 'STORE'] },
  { to: '/qc', label: 'Quality check', icon: ClipboardCheck, roles: ['QC'] },
  { to: '/waste', label: 'Waste', icon: Recycle, roles: ['PRODUCTION', 'QC'] },
  { to: '/dispatch', label: 'Dispatch', icon: Truck, roles: ['DISPATCH'] },
]

export const navFor = (role: Role) => NAV.filter((n) => role === 'OWNER' || n.roles.includes(role))
export const homeFor = (role: Role) => navFor(role)[0].to

export const ROLE_LABEL: Record<Role, string> = { OWNER: 'Owner', STORE: 'Store', PRODUCTION: 'Production', QC: 'Quality Control', DISPATCH: 'Dispatch' }

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

function SidebarNav({ role, onNavigate, onSignOut }: { role: Role; onNavigate?: () => void; onSignOut: () => void }) {
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
        {navFor(role).map(({ to, label, icon: Icon }) => (
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
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2.5 rounded-lg text-zinc-600 hover:scale-100"
          onClick={onSignOut}
        >
          <LogOut className="size-4" />
          Log out
        </Button>
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
        <SidebarNav role={user.role} onSignOut={askSignOut} />
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-60 md:hidden">
          <SidebarNav role={user.role} onNavigate={() => setMobileNavOpen(false)} onSignOut={askSignOut} />
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

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

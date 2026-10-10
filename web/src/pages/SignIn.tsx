import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AlertCircle, ClipboardCheck, Factory, Loader2, Package, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { Logo } from '@/components/Logo'
import { useSession } from '@/auth/session'
import { ApiError } from '@/lib/api'
import { homeFor } from '@/components/AppShell'
import type { Role } from '@/types'

const FEATURES = [
  { icon: Package, title: 'Yarn stock with low-stock warnings' },
  { icon: Factory, title: 'Every machine, every order, live' },
  { icon: ClipboardCheck, title: 'Each roll traced through QC' },
  { icon: Truck, title: 'Dispatch, invoice and buyer tracking' },
]

const DEMO_ROLES: Role[] = ['OWNER', 'STORE', 'PRODUCTION', 'QC', 'DISPATCH']

export function SignIn() {
  const { user, loading, signIn } = useSession()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to={homeFor(user.role)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const u = await signIn(email, password)
      navigate(homeFor(u.role), { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative m-4 hidden flex-col justify-between overflow-hidden rounded-[28px] bg-ink p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        <div
          className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #facc15, transparent 70%)' }}
        />

        <div className="relative flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white">
            <Logo className="size-4.5" />
          </div>
          <span className="text-base font-medium">Everest Textile Mills</span>
        </div>

        <div className="relative space-y-10">
          <div className="space-y-3">
            <h1 className="text-3xl leading-tight font-semibold tracking-tight">
              From yarn at the gate to rolls on the truck.
            </h1>
            <p className="max-w-sm text-sm text-white/60">
              One system replacing the mill's notebooks and phone calls.
            </p>
          </div>

          <div className="space-y-5">
            {FEATURES.map(({ icon: Icon, title }) => (
              <div key={title} className="flex items-center gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="size-4.5 text-[#facc15]" />
                </div>
                <p className="text-sm font-medium text-white">{title}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-white/40">© {new Date().getFullYear()} Everest Textile Mills</p>
      </div>

      <div className="flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-1.5 lg:hidden">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-ink text-white">
                <Logo className="size-3.5" />
              </div>
              <span className="text-sm font-medium">Everest Textile Mills</span>
            </div>
          </div>

          <div className="space-y-8 card p-10!">
            <div className="space-y-1.5">
              <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
              <p className="text-sm text-muted-foreground">Use your mill email and password.</p>
            </div>

            <form className="space-y-5" onSubmit={onSubmit} noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  disabled={busy}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="store@everest.dev"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  autoComplete="current-password"
                  disabled={busy}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="flex items-start gap-2 rounded-md border border-problem/30 bg-problem-bg px-3 py-2 text-xs text-problem"
                >
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="mt-1 w-full gap-2" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </div>

          <div className="space-y-2 text-center">
            <p className="text-xs text-muted-foreground">Demo logins (password Password123)</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {DEMO_ROLES.map((r) => (
                <Button
                  key={r}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    setEmail(`${r.toLowerCase()}@everest.dev`)
                    setPassword('Password123')
                  }}
                >
                  {r.charAt(0) + r.slice(1).toLowerCase()}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AlertCircle, ClipboardCheck, Factory, Loader2, Package, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { Logo } from '@/components/Logo'
import { useSession } from '@/auth/session'
import { ApiError } from '@/lib/api'
import { homeFor, ROLE_LABEL } from '@/components/AppShell'
import type { Role } from '@/types'

const FEATURES = [
  { icon: Package, title: 'Yarn stock' },
  { icon: Factory, title: 'Live production' },
  { icon: ClipboardCheck, title: 'Quality checks' },
  { icon: Truck, title: 'Dispatch & tracking' },
]

const DEMO_ROLES: Role[] = ['OWNER', 'STORE', 'PRODUCTION', 'QC', 'DISPATCH']
const DEMO_PASSWORD = 'Password123'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type FieldErrors = { email?: string; password?: string }

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {}
  if (!email) errors.email = 'Enter your email.'
  else if (!EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address.'
  if (!password) errors.password = 'Enter your password.'
  return errors
}

function messageFor(err: unknown): string {
  if (!(err instanceof ApiError)) return "Can't reach the server. Check your connection and try again."
  if (err.status === 429) return 'Too many attempts. Wait a few minutes and try again.'
  if (err.status >= 500) return 'Something went wrong on our side. Try again.'
  return err.message
}

export function SignIn() {
  const { user, loading, signIn } = useSession()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [capsLock, setCapsLock] = useState(false)
  const [busy, setBusy] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  if (!loading && user) return <Navigate to={homeFor(user.role)} replace />

  async function submit(emailValue: string, passwordValue: string) {
    const cleanEmail = emailValue.trim().toLowerCase()
    const problems = validate(cleanEmail, passwordValue)
    setFieldErrors(problems)
    setError(null)
    if (problems.email) return emailRef.current?.focus()
    if (problems.password) return passwordRef.current?.focus()

    setBusy(true)
    try {
      const u = await signIn(cleanEmail, passwordValue)
      navigate(homeFor(u.role), { replace: true })
    } catch (err) {
      setError(messageFor(err))
      setBusy(false)
      // Wrong credentials: put the cursor back where the retry happens.
      requestAnimationFrame(() => passwordRef.current?.select())
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void submit(email, password)
  }

  function onPasswordKey(e: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState('CapsLock'))
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-linear-to-br from-brand to-brand-deep p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        <div
          className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full opacity-15 blur-3xl"
          style={{ background: 'radial-gradient(circle, #facc15, transparent 70%)' }}
        />

        <div className="relative flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white ring-1 ring-white/20">
            <Logo className="size-4.5" />
          </div>
          <span className="text-base font-medium">Everest Textile Mills</span>
        </div>

        <div className="relative space-y-10">
          <div className="space-y-3">
            <h1 className="text-3xl leading-tight font-semibold tracking-tight">
              Every thread, accounted for.
            </h1>
            <p className="max-w-sm text-sm text-white/70">
              One system for the whole mill.
            </p>
          </div>

          <div className="space-y-5">
            {FEATURES.map(({ icon: Icon, title }) => (
              <div key={title} className="flex items-center gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="size-4.5 text-white" />
                </div>
                <p className="text-sm font-medium text-white">{title}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-white/50">© {new Date().getFullYear()} Everest Textile Mills</p>
      </div>

      <div className="flex items-center justify-center bg-zinc-50 px-4 py-16">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-1.5 lg:hidden">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-brand text-white">
                <Logo className="size-3.5" />
              </div>
              <span className="text-sm font-medium">Everest Textile Mills</span>
            </div>
          </div>

          <div className="space-y-8 rounded-xl border bg-white p-10 shadow-sm">
            <div className="space-y-1.5">
              <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
              <p className="text-sm text-muted-foreground">Use your mill email and password.</p>
            </div>

            <form className="space-y-5" onSubmit={onSubmit} noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  ref={emailRef}
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  disabled={busy}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }))
                  }}
                  placeholder="you@everest.dev"
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                  required
                />
                {fieldErrors.email && (
                  <p id="email-error" className="text-xs text-rose-600">
                    {fieldErrors.email}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  ref={passwordRef}
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  disabled={busy}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }))
                  }}
                  onKeyDown={onPasswordKey}
                  onKeyUp={onPasswordKey}
                  onBlur={() => setCapsLock(false)}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'password-error' : capsLock ? 'caps-warning' : undefined}
                  required
                />
                {fieldErrors.password ? (
                  <p id="password-error" className="text-xs text-rose-600">
                    {fieldErrors.password}
                  </p>
                ) : (
                  capsLock && (
                    <p id="caps-warning" className="text-xs text-amber-600">
                      Caps Lock is on.
                    </p>
                  )
                )}
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                >
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="mt-1 w-full gap-2 rounded-lg hover:scale-100" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Forgot your password? Ask the mill owner to reset it.
              </p>
            </form>
          </div>

          <div className="space-y-2 text-center">
            <p className="text-xs text-muted-foreground">Demo: sign in as</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {DEMO_ROLES.map((r) => (
                <Button
                  key={r}
                  type="button"
                  variant="outline"
                  size="xs"
                  className="rounded-md hover:scale-100"
                  disabled={busy}
                  onClick={() => {
                    const demoEmail = `${r.toLowerCase()}@everest.dev`
                    setEmail(demoEmail)
                    setPassword(DEMO_PASSWORD)
                    void submit(demoEmail, DEMO_PASSWORD)
                  }}
                >
                  {ROLE_LABEL[r]}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

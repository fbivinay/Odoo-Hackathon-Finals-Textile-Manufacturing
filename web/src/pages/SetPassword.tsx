import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Check, Circle, KeyRound, Loader2 } from 'lucide-react'
import { useSession } from '@/auth/session'
import { AppShell, homeFor } from '@/components/AppShell'
import { Field } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PasswordInput } from '@/components/ui/password-input'
import { ApiError } from '@/lib/api'
import { PASSWORD_PATTERN } from '@/lib/password'
import { cn } from '@/lib/utils'

const VALID = new RegExp(`^${PASSWORD_PATTERN}$`)

function Rule({ met, children }: { met: boolean; children: string }) {
  const Icon = met ? Check : Circle
  return (
    <li className={cn('flex items-center gap-1.5 text-xs', met ? 'text-good' : 'text-muted-foreground')}>
      <Icon className="size-3" />
      {children}
    </li>
  )
}

// First sign-in with an owner-issued password: the app sits blurred behind this popup,
// which can't be closed until the password is replaced.
export function SetPassword() {
  const { user, loading, changePassword, signOut } = useSession()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading) return null
  if (!user) return <Navigate to="/sign-in" replace />
  if (!user.mustChangePassword) return <Navigate to={homeFor(user)} replace />

  const valid = VALID.test(password)
  const matches = password !== '' && password === confirm

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await changePassword(password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message.replace(/^newPassword: /, '') : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <>
      <AppShell />
      <Dialog open>
        <DialogContent
          showCloseButton={false}
          className="gap-5 p-6 sm:max-w-sm"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-brand-tint text-brand">
              <KeyRound className="size-5" />
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-lg">Set your password</DialogTitle>
              <DialogDescription>Hi {user.name.split(' ')[0]}, choose your own password to get started.</DialogDescription>
            </div>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-4">
            <Field label="New password" htmlFor="new-password">
              <PasswordInput id="new-password" required autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Confirm password" htmlFor="confirm-password">
              <PasswordInput id="confirm-password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <ul className="space-y-1">
              <Rule met={valid}>At least 6 letters or digits</Rule>
              <Rule met={matches}>Both passwords match</Rule>
            </ul>
            {error && <p className="text-sm text-problem">{error}</p>}
            <Button type="submit" disabled={busy || !valid || !matches} className="gap-1.5">
              {busy && <Loader2 className="size-4 animate-spin" />}
              Save and continue
            </Button>
          </form>
          <button
            type="button"
            className="justify-self-center text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              signOut()
              navigate('/sign-in', { replace: true })
            }}
          >
            Sign in as someone else
          </button>
        </DialogContent>
      </Dialog>
    </>
  )
}

import { useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Check, Plus, Search, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from '@/auth/session'
import { GRANTABLE, ROLE_LABEL } from '@/components/AppShell'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Field, selectClass } from '@/components/Field'
import { PageHead } from '@/components/PageHead'
import { Pill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { api, ApiError } from '@/lib/api'
import { PASSWORD_HINT, PASSWORD_PATTERN } from '@/lib/password'
import { cn } from '@/lib/utils'
import { useApi } from '@/lib/useApi'
import type { Employee, Role, Shift } from '@/types'

const ROLES = Object.keys(ROLE_LABEL) as Role[]
const SHIFTS: Record<Shift, { name: string; hours: string }> = {
  MORNING: { name: 'Morning', hours: '6 AM – 2 PM' },
  EVENING: { name: 'Evening', hours: '2 PM – 10 PM' },
  NIGHT: { name: 'Night', hours: '10 PM – 6 AM' },
}

// Optional: leave on "No shift" for people who don't work one.
function ShiftField({ value, onChange }: { value: Shift | ''; onChange: (s: Shift | '') => void }) {
  return (
    <Field label="Shift (optional)" htmlFor="shift">
      <select id="shift" className={selectClass} value={value} onChange={(e) => onChange(e.target.value as Shift | '')}>
        <option value="">No shift</option>
        {(Object.keys(SHIFTS) as Shift[]).map((s) => (
          <option key={s} value={s}>
            {SHIFTS[s].name} · {SHIFTS[s].hours}
          </option>
        ))}
      </select>
    </Field>
  )
}

const tabLabel = (to: string) => GRANTABLE.find((n) => n.to === to)?.label ?? to
// Tabs the role doesn't already open. The owner has them all.
const extrasFor = (role: Role) => (role === 'OWNER' ? [] : GRANTABLE.filter((n) => !n.roles.includes(role)))
// A role change can make a granted tab redundant; keep only the ones still extra.
const keepExtras = (role: Role, tabs: string[]) => tabs.filter((t) => extrasFor(role).some((n) => n.to === t))

// Tick tabs to give this one person on top of their role.
function ExtraTabs({ role, value, onChange }: { role: Role; value: string[]; onChange: (tabs: string[]) => void }) {
  const options = extrasFor(role)
  if (!options.length) return null
  return (
    <Field label="Additional access" htmlFor="extra-tabs">
      <div id="extra-tabs" className="flex flex-wrap gap-1.5">
        {options.map((n) => {
          const on = value.includes(n.to)
          const Icon = on ? Check : Plus
          return (
            <button
              key={n.to}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((t) => t !== n.to) : [...value, n.to])}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                on ? 'border-brand bg-brand-tint font-medium text-brand' : 'border-input text-zinc-600 hover:bg-zinc-50',
              )}
            >
              <Icon className="size-3" />
              {n.label}
            </button>
          )
        })}
      </div>
    </Field>
  )
}

export function Employees() {
  const { user } = useSession()
  const employees = useApi<Employee[]>('/users')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<Role | 'ALL'>('ALL')
  const [shift, setShift] = useState<Shift | 'ALL' | 'NONE'>('ALL')

  // Matches name, email, role or an additional access, e.g. "store" or "waste".
  const q = search.trim().toLowerCase()
  const rows = (employees.data ?? []).filter(
    (e) =>
      (role === 'ALL' || e.role === role) &&
      (shift === 'ALL' || (shift === 'NONE' ? !e.shift : e.shift === shift)) &&
      (!q || [e.name, e.email, ROLE_LABEL[e.role], e.shift ? SHIFTS[e.shift].name : '', ...keepExtras(e.role, e.extraTabs ?? []).map(tabLabel)].some((v) => v.toLowerCase().includes(q))),
  )

  const filtered = !!q || role !== 'ALL' || shift !== 'ALL'

  // No column sorting: the list keeps its own order (latest on top, deactivated last).
  const cols: ColumnDef<Employee>[] = [
    {
      accessorKey: 'name',
      header: 'Employee',
      enableSorting: false,
      cell: ({ row: { original: e } }) => (
        <div className="leading-tight">
          <p className="font-medium">{e.name}</p>
          <p className="text-xs text-muted-foreground">{e.email}</p>
        </div>
      ),
    },
    { id: 'role', header: 'Role', enableSorting: false, accessorFn: (e) => ROLE_LABEL[e.role] },
    {
      id: 'shift',
      header: 'Shift',
      enableSorting: false,
      cell: ({ row: { original: e } }) =>
        e.shift ? (
          <div className="leading-tight">
            <p>{SHIFTS[e.shift].name}</p>
            <p className="text-xs whitespace-nowrap text-muted-foreground">{SHIFTS[e.shift].hours}</p>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'extra',
      header: 'Additional access',
      enableSorting: false,
      cell: ({ row: { original: e } }) => {
        const extras = keepExtras(e.role, e.extraTabs ?? [])
        if (!extras.length) return <span className="text-muted-foreground">—</span>
        return (
          // Two fit on a row; the rest fold into a count so every row stays one line tall.
          <div className="flex items-center gap-1" title={extras.map(tabLabel).join(', ')}>
            {extras.slice(0, 2).map((t) => (
              <span key={t} className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium whitespace-nowrap text-brand">
                {tabLabel(t)}
              </span>
            ))}
            {extras.length > 2 && <span className="text-xs text-muted-foreground">+{extras.length - 2}</span>}
          </div>
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row: { original: e } }) =>
        !e.isActive ? <Pill>Inactive</Pill> : e.mustChangePassword ? <Pill tone="watch">Password not set</Pill> : <Pill tone="good">Active</Pill>,
    },
    {
      id: 'action',
      header: '',
      enableSorting: false,
      cell: ({ row: { original: e } }) => (
        <div className="flex justify-end">
          <Button size="xs" variant="outline" onClick={() => setEditing(e)}>
            Edit
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHead
        eyebrow="Logins and roles"
        title="Employees"
        actions={
          <Button className="gap-1.5" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" />
            New employee
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="employee-search" type="search" aria-label="Search employees" placeholder="Search name, email or role" className="bg-white pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select id="role-filter" aria-label="Filter by role" className={cn(selectClass, 'bg-white sm:w-auto sm:min-w-44')} value={role} onChange={(e) => setRole(e.target.value as Role | 'ALL')}>
          <option value="ALL">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <select id="shift-filter" aria-label="Filter by shift" className={cn(selectClass, 'bg-white sm:w-auto sm:min-w-36')} value={shift} onChange={(e) => setShift(e.target.value as Shift | 'ALL' | 'NONE')}>
          <option value="ALL">All shifts</option>
          {(Object.keys(SHIFTS) as Shift[]).map((s) => (
            <option key={s} value={s}>
              {SHIFTS[s].name}
            </option>
          ))}
          <option value="NONE">No shift</option>
        </select>
      </div>

      {employees.error && <p className="text-sm text-problem">{employees.error}</p>}
      <DataTable
        columns={cols}
        data={rows}
        loading={employees.loading}
        empty={
          filtered ? (
            <EmptyState
              icon={Search}
              line={q ? `No employee matches "${search.trim()}".` : 'No employee matches these filters.'}
              actionLabel="Clear filters"
              onAction={() => {
                setSearch('')
                setRole('ALL')
                setShift('ALL')
              }}
            />
          ) : (
            <EmptyState icon={UserPlus} line="No employees yet." actionLabel="New employee" onAction={() => setAdding(true)} />
          )
        }
      />

      {adding && <NewEmployeeDialog onClose={() => setAdding(false)} onSaved={employees.reload} />}
      {editing && <EditEmployeeDialog e={editing} self={editing.id === user?.id} onClose={() => setEditing(null)} onSaved={employees.reload} />}
    </div>
  )
}

const failed = (err: unknown) => toast.error(err instanceof ApiError ? err.message : 'Something went wrong.')

function NewEmployeeDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'STORE' as Role })
  const [extraTabs, setExtraTabs] = useState<string[]>([])
  const [shift, setShift] = useState<Shift | ''>('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/users', { method: 'POST', body: { ...form, name: form.name.trim(), email: form.email.trim(), extraTabs: keepExtras(form.role, extraTabs), shift: shift || null } })
      toast.success(`${form.name.trim()} added. They set their own password at first sign-in.`)
      onSaved()
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') toast.error('That email already has a login.')
      else failed(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New employee</DialogTitle>
        </DialogHeader>
        <form id="new-employee" onSubmit={submit} className="grid gap-4">
          <Field label="Name" htmlFor="name">
            <Input id="name" required autoFocus value={form.name} onChange={set('name')} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" required autoComplete="off" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Temporary password" htmlFor="password">
            <PasswordInput id="password" required placeholder="6+ letters or digits" autoComplete="new-password" pattern={PASSWORD_PATTERN} title={PASSWORD_HINT} value={form.password} onChange={set('password')} />
          </Field>
          <Field label="Role" htmlFor="role">
            <select id="role" className={selectClass} value={form.role} onChange={set('role')}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
          <ShiftField value={shift} onChange={setShift} />
          <ExtraTabs role={form.role} value={keepExtras(form.role, extraTabs)} onChange={setExtraTabs} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-employee" disabled={busy}>
            Add employee
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// `self`: the owner editing their own login can't change role or deactivate it.
function EditEmployeeDialog({ e, self, onClose, onSaved }: { e: Employee; self: boolean; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState<Role>(e.role)
  const [password, setPassword] = useState('')
  const [shift, setShift] = useState<Shift | ''>(e.shift ?? '')
  const shiftChanged = shift !== (e.shift ?? '')
  const [busy, setBusy] = useState(false)
  const before = keepExtras(e.role, e.extraTabs ?? [])
  const [picked, setPicked] = useState(before)
  const extraTabs = keepExtras(role, picked)
  const tabsChanged = [...extraTabs].sort().join() !== [...before].sort().join() || extraTabs.length !== (e.extraTabs ?? []).length

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true)
    try {
      await api(`/users/${e.id}`, { method: 'PATCH', body })
      toast.success(done)
      onSaved()
      onClose()
    } catch (err) {
      failed(err)
    } finally {
      setBusy(false)
    }
  }

  function submit(ev: FormEvent) {
    ev.preventDefault()
    void save({ ...(role !== e.role ? { role } : {}), ...(tabsChanged ? { extraTabs } : {}), ...(shiftChanged ? { shift: shift || null } : {}), ...(password ? { password } : {}) }, password ? 'Saved. They set a new password at next sign-in.' : 'Saved')
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{e.name}</DialogTitle>
          <DialogDescription>{e.email}</DialogDescription>
        </DialogHeader>
        <form id="edit-employee" onSubmit={submit} className="grid gap-4">
          <Field label="Role" htmlFor="role" hint={self ? "You can't change your own role." : undefined}>
            <select id="role" className={cn(selectClass, 'disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-muted-foreground')} disabled={self} value={role} onChange={(ev) => setRole(ev.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
          <ShiftField value={shift} onChange={setShift} />
          <ExtraTabs role={role} value={extraTabs} onChange={setPicked} />
          {!self && (
            <Field label="Reset password" htmlFor="password">
              <PasswordInput id="password" placeholder="Leave empty to keep" autoComplete="new-password" pattern={PASSWORD_PATTERN} title={PASSWORD_HINT} value={password} onChange={(ev) => setPassword(ev.target.value)} />
            </Field>
          )}
        </form>
        <DialogFooter className="sm:justify-between">
          {self ? (
            <span />
          ) : (
            <Button variant="ghost" className={cn('-ml-2', e.isActive && 'text-problem hover:text-problem')} disabled={busy} onClick={() => save({ isActive: !e.isActive }, e.isActive ? `${e.name} can no longer sign in` : `${e.name} can sign in again`)}>
              {e.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="edit-employee" disabled={busy || (role === e.role && !password && !tabsChanged && !shiftChanged)}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

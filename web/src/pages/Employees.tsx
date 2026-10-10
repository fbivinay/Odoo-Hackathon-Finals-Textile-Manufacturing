import { useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Plus, Search, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from '@/auth/session'
import { GRANTABLE, ROLE_LABEL } from '@/components/AppShell'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Field, selectClass } from '@/components/Field'
import { PageHead } from '@/components/PageHead'
import { Pill } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Skeleton } from '@/components/ui/skeleton'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatMoney } from '@/lib/format'
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

// A floor worker with the machine they last ran and their mark on the latest register day.
interface Operator {
  id: string
  code: string
  name: string
  shift: Shift
  dailyWage: number | string
  isActive: boolean
  machine: { code: string; name: string; stage: string } | null
  status: 'PRESENT' | 'HALF_DAY' | 'ABSENT' | null
  daysWorked: number
}
interface Roster {
  date: string | null
  workers: Operator[]
}

// Staff with no login who report to a role. Only the production floor has a crew today.
const CREW: Partial<Record<Role, string>> = { PRODUCTION: 'machine operators' }
const slug = (r: Role) => r.toLowerCase()
const TEAMS = ROLES.filter((r) => r !== 'OWNER')
// Chart lines: dark and 2px so the flow reads at a glance.
const LINE = 'bg-zinc-600 dark:bg-zinc-300'

// Front page: the mill as a chart of roles. Open a role to see its people.
export function Employees() {
  const navigate = useNavigate()
  const employees = useApi<Employee[]>('/users')
  const roster = useApi<Roster>('/workers/roster')
  const [adding, setAdding] = useState(false)
  const loading = (employees.loading && !employees.data) || (roster.loading && !roster.data)
  // Centre of the first and last column: half a column, where columns share the row minus the 1rem gaps.
  const inset = `calc((100% - ${TEAMS.length - 1}rem) / ${TEAMS.length * 2})`

  const box = (r: Role) => {
    const logins = (employees.data ?? []).filter((e) => e.role === r && e.isActive).length
    const crew = CREW[r] ? (roster.data?.workers ?? []).filter((w) => w.isActive).length : 0
    return (
      <button
        type="button"
        onClick={() => navigate(`/employees/${slug(r)}`)}
        className="figure w-full cursor-pointer rounded-xl transition hover:ring-2 hover:ring-brand/30 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
      >
        {loading ? (
          <Skeleton className="mx-auto h-7 w-40" />
        ) : (
          <>
            <p className="text-xl font-bold text-brand">{ROLE_LABEL[r]}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {logins} {logins === 1 ? 'login' : 'logins'}
              {CREW[r] && ` · ${crew} ${CREW[r]}`}
            </p>
          </>
        )}
      </button>
    )
  }

  return (
    <div className="space-y-5">
      <PageHead
        eyebrow="Logins and roles"
        title="Employees"
        lede="Open a role to see everyone in it."
        actions={
          <Button className="gap-1.5" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" />
            New employee
          </Button>
        }
      />
      {(employees.error || roster.error) && <p className="text-sm text-problem">{employees.error || roster.error}</p>}

      <section className="figures-panel">
        <div className="mx-auto max-w-sm">{box('OWNER')}</div>
        <div className={cn('mx-auto h-8 w-0.5', LINE)} />
        <div className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Connector bar across the team row, with a stub down to each box (wide screens only). */}
          <div className={cn('absolute top-0 hidden h-0.5 lg:block', LINE)} style={{ left: inset, right: inset }} />
          {TEAMS.map((r) => (
            <div key={r} className="relative lg:pt-8">
              <div className={cn('absolute top-0 left-1/2 hidden h-8 w-0.5 -translate-x-1/2 lg:block', LINE)} />
              {box(r)}
            </div>
          ))}
        </div>
      </section>

      {adding && <NewEmployeeDialog onClose={() => setAdding(false)} onSaved={employees.reload} />}
    </div>
  )
}

const MARK = { PRESENT: ['Present', 'good'], HALF_DAY: ['Half day', 'watch'], ABSENT: ['Absent', 'problem'] } as const
const stageName = (s: string) => s.charAt(0) + s.slice(1).toLowerCase()

// Inside a role: its logins, and for production the machine operators shift by shift.
export function EmployeeRole() {
  const { role: param } = useParams()
  const role = ROLES.find((r) => slug(r) === param)
  const { user } = useSession()
  const employees = useApi<Employee[]>('/users')
  const roster = useApi<Roster>(role && CREW[role] ? '/workers/roster' : null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [search, setSearch] = useState('')
  const [shift, setShift] = useState<Shift | 'ALL'>('ALL')
  const [state, setState] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL')

  if (!role) return <EmptyState icon={Search} line="No such role." />

  const q = search.trim().toLowerCase()
  const keep = (active: boolean, s: Shift | null | undefined, words: string[]) =>
    (shift === 'ALL' || s === shift) && (state === 'ALL' || active === (state === 'ACTIVE')) && (!q || words.some((v) => v.toLowerCase().includes(q)))

  const logins = (employees.data ?? []).filter((e) => e.role === role && keep(e.isActive, e.shift, [e.name, e.email, ...keepExtras(e.role, e.extraTabs ?? []).map(tabLabel)]))
  const crew = roster.data?.workers ?? []
  const operators = crew.filter((w) => keep(w.isActive, w.shift, [w.name, w.code, w.machine?.code ?? '', w.machine?.name ?? '']))
  const active = crew.filter((w) => w.isActive)
  const on = roster.data?.date ? formatDate(roster.data.date) : null
  const marked = active.filter((w) => w.status)
  const present = marked.reduce((t, w) => t + (w.status === 'PRESENT' ? 1 : w.status === 'HALF_DAY' ? 0.5 : 0), 0)
  const crewLoading = roster.loading && !roster.data
  const filtered = !!q || shift !== 'ALL' || state !== 'ALL'
  const clear = () => {
    setSearch('')
    setShift('ALL')
    setState('ALL')
  }

  const loginCols: ColumnDef<Employee>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row: { original: e } }) => (
        <div className="leading-tight">
          <p className="font-medium">{e.name}</p>
          <p className="text-xs text-muted-foreground">{e.email}</p>
        </div>
      ),
    },
    { id: 'shift', header: 'Shift', accessorFn: (e) => (e.shift ? `${SHIFTS[e.shift].name} · ${SHIFTS[e.shift].hours}` : '—') },
    {
      id: 'extra',
      header: 'Additional access',
      enableSorting: false,
      cell: ({ row: { original: e } }) => {
        const extras = keepExtras(e.role, e.extraTabs ?? [])
        return extras.length ? (
          <div className="flex flex-wrap gap-1">
            {extras.map((t) => (
              <span key={t} className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium whitespace-nowrap text-brand">
                {tabLabel(t)}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
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
  ]

  const crewCols: ColumnDef<Operator>[] = [
    { accessorKey: 'code', header: 'Code' },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row: { original: w } }) => <span className={cn('font-medium', !w.isActive && 'text-muted-foreground')}>{w.name}</span>,
    },
    {
      id: 'machine',
      header: 'Last machine',
      accessorFn: (w) => w.machine?.code ?? '',
      cell: ({ row: { original: w } }) =>
        w.machine ? (
          <div className="leading-tight">
            <p>
              {w.machine.code} · {w.machine.name}
            </p>
            <p className="text-xs text-muted-foreground">{stageName(w.machine.stage)}</p>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'today',
      header: on ? `On ${on}` : 'Attendance',
      accessorFn: (w) => w.status ?? '',
      cell: ({ row: { original: w } }) =>
        w.status ? <Pill tone={MARK[w.status][1]}>{MARK[w.status][0]}</Pill> : <span className="text-muted-foreground">Not marked</span>,
    },
    { accessorKey: 'daysWorked', header: 'Days this month', cell: ({ row: { original: w } }) => <span className="tabular-nums">{w.daysWorked}</span> },
    { id: 'wage', header: 'Daily wage', accessorFn: (w) => Number(w.dailyWage), cell: ({ getValue }) => <span className="tabular-nums">{formatMoney(getValue() as number)}</span> },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (w) => w.isActive,
      cell: ({ row: { original: w } }) => (w.isActive ? <Pill tone="good">Working</Pill> : <Pill>Left</Pill>),
    },
  ]

  return (
    <div className="space-y-6">
      <Link to="/employees" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        <ArrowLeft className="size-3" />
        Employees
      </Link>
      <PageHead
        eyebrow="Role"
        title={ROLE_LABEL[role]}
        lede={CREW[role] ? `Their logins, and the ${CREW[role]} on each shift.` : 'Everyone with this login role.'}
        actions={
          <Button className="gap-1.5" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" />
            New employee
          </Button>
        }
      />

      {CREW[role] && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Machine operators" loading={crewLoading} value={String(active.length)} hint={`${crew.length - active.length} have left`} />
          <KpiCard
            label={on ? `Present on ${on}` : 'Present'}
            loading={crewLoading}
            value={marked.length ? `${present} of ${marked.length}` : '—'}
            hint={marked.length ? 'Of those marked that day' : 'No register yet'}
          />
          <KpiCard
            label="Average daily wage"
            loading={crewLoading}
            value={active.length ? formatMoney(Math.round(active.reduce((t, w) => t + Number(w.dailyWage), 0) / active.length)) : '—'}
            hint="Working operators"
          />
          <KpiCard
            label="Per shift"
            loading={crewLoading}
            value={(Object.keys(SHIFTS) as Shift[]).map((s) => active.filter((w) => w.shift === s).length).join(' / ')}
            hint="Morning / Evening / Night"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search people"
            placeholder={CREW[role] ? 'Search name, code or machine' : 'Search name or email'}
            className="bg-white pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select aria-label="Filter by shift" className={cn(selectClass, 'bg-white sm:w-auto sm:min-w-36')} value={shift} onChange={(e) => setShift(e.target.value as Shift | 'ALL')}>
          <option value="ALL">All shifts</option>
          {(Object.keys(SHIFTS) as Shift[]).map((s) => (
            <option key={s} value={s}>
              {SHIFTS[s].name}
            </option>
          ))}
        </select>
        <select aria-label="Filter by status" className={cn(selectClass, 'bg-white sm:w-auto sm:min-w-36')} value={state} onChange={(e) => setState(e.target.value as typeof state)}>
          <option value="ALL">Everyone</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive or left</option>
        </select>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Reset filters
          </Button>
        )}
      </div>

      {employees.error && <p className="text-sm text-problem">{employees.error}</p>}
      <section className="space-y-3">
        <h2 className="section-head">Logins ({logins.length})</h2>
        <DataTable
          columns={loginCols}
          data={logins}
          loading={employees.loading}
          onRowClick={setEditing}
          empty={
            filtered ? (
              <EmptyState icon={Search} line="No login matches these filters." actionLabel="Reset filters" onAction={clear} />
            ) : (
              <EmptyState icon={UserPlus} line="No one has this role yet." actionLabel="New employee" onAction={() => setAdding(true)} />
            )
          }
        />
      </section>

      {CREW[role] && roster.error && <p className="text-sm text-problem">{roster.error}</p>}
      {CREW[role] &&
        (Object.keys(SHIFTS) as Shift[])
          .filter((s) => shift === 'ALL' || s === shift)
          .map((s) => {
            const rows = operators.filter((w) => w.shift === s)
            return (
              <section key={s} className="space-y-3">
                <h2 className="section-head">
                  {SHIFTS[s].name} shift · {SHIFTS[s].hours}{' '}
                  <span className="font-normal text-muted-foreground">
                    ({rows.length} {CREW[role]})
                  </span>
                </h2>
                <DataTable columns={crewCols} data={rows} loading={roster.loading} empty={filtered ? 'No operator on this shift matches these filters.' : 'No operators on this shift.'} />
              </section>
            )
          })}

      {adding && <NewEmployeeDialog role={role} onClose={() => setAdding(false)} onSaved={employees.reload} />}
      {editing && <EditEmployeeDialog e={editing} self={editing.id === user?.id} onClose={() => setEditing(null)} onSaved={employees.reload} />}
    </div>
  )
}

const failed = (err: unknown) => toast.error(err instanceof ApiError ? err.message : 'Something went wrong.')

function NewEmployeeDialog({ role = 'STORE', onClose, onSaved }: { role?: Role; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role })
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

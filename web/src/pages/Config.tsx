import { useState, type FormEvent, type ReactNode } from 'react'
import { History, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/EmptyState'
import { Field, selectClass } from '@/components/Field'
import { PageHead } from '@/components/PageHead'
import { Pagination } from '@/components/Pagination'
import { Pill, label } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ApiError } from '@/lib/api'
import { formatDateTime, formatINR, formatQty, unitFor } from '@/lib/format'
import { pagerOf, useApi, useClientPages } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import type { Config as ConfigData, ConfigChange, Machine, Shift, Stage } from '@/types'

type Fabric = ConfigData['fabrics'][number]
type Material = ConfigData['materials'][number]
type Rule = ConfigData['rules'][number]

const cell = 'px-3 py-2.5'
const head = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground'
const numCell = cn(cell, 'tabular-nums')
const name = (m: { yarnType: string; colour: string }) => (m.colour ? `${m.yarnType} · ${m.colour}` : m.yarnType)
const pct = (n: number) => `${n > 0 ? '+' : ''}${n}%`

async function save(path: string, method: string, body: unknown, done: string) {
  try {
    await api(path, { method, body })
    toast.success(done)
    return true
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Something went wrong.')
    return false
  }
}

// The figures behind new orders, planning, costing and dispatch checks. The owner's, unless shared.
export function Config() {
  const config = useApi<ConfigData>('/config')
  const changes = useApi<ConfigChange[]>('/config/changes?limit=200')
  const c = config.data

  return (
    <div className="space-y-5">
      <PageHead eyebrow="Prices and rules" title="Mill Setup" />
      {config.error && <p className="text-sm text-problem">{config.error}</p>}
      {!c ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Tabs defaultValue="fabrics">
          <TabsList>
            <TabsTrigger value="fabrics">Fabrics</TabsTrigger>
            <TabsTrigger value="machines">Machines</TabsTrigger>
            <TabsTrigger value="rules">Order rules</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="fabrics">
            <Fabrics fabrics={c.fabrics} yarns={c.materials.filter((m) => m.category === 'YARN')} />
          </TabsContent>
          <TabsContent value="machines">
            <Machines />
          </TabsContent>
          <TabsContent value="rules">
            <Rules rules={c.rules} />
          </TabsContent>
          <TabsContent value="history">
            <Log rows={changes.data ?? []} loading={changes.loading} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

// One narrow popup for every edit on this page: stacked fields, Cancel and Save.
function Popup({ title, hint, saveLabel = 'Save', canSave = true, onClose, onSave, extra, children }: { title: string; hint?: string; saveLabel?: string; canSave?: boolean; onClose: () => void; onSave: () => Promise<boolean>; extra?: ReactNode; children: ReactNode }) {
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    if (await onSave()) onClose()
    else setBusy(false)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {hint && <DialogDescription>{hint}</DialogDescription>}
        </DialogHeader>
        <form id="setup-form" onSubmit={submit} className="grid gap-4">
          {children}
        </form>
        <DialogFooter className={extra ? 'sm:justify-between' : undefined}>
          {extra}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="setup-form" disabled={busy || !canSave}>
              {saveLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// A number box with its unit shown inside, on the right.
function Num({ id, unit, value, onChange, ...rest }: { id: string; unit?: string; value: string; onChange: (v: string) => void; min?: number | string; max?: number | string; step?: number | string; required?: boolean; autoFocus?: boolean; placeholder?: string }) {
  return (
    <div className="relative">
      <Input id={id} type="number" className={cn('tabular-nums', unit && 'pr-14')} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
      {unit && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">{unit}</span>}
    </div>
  )
}

const EditButton = ({ onClick, what }: { onClick: () => void; what: string }) => (
  <Button size="xs" variant="outline" aria-label={`Edit ${what}`} onClick={onClick}>
    Edit
  </Button>
)

// ---------------------------------------------------------------- fabrics --

function Fabrics({ fabrics, yarns }: { fabrics: Fabric[]; yarns: Material[] }) {
  const [editing, setEditing] = useState<Fabric | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const yarnName = (id: string | null) => {
    const y = yarns.find((m) => m.id === id)
    return y ? name(y) : '—'
  }
  const q = search.trim().toLowerCase()
  const rows = fabrics.filter((f) => !q || [f.fabricType, yarnName(f.materialId)].some((v) => v.toLowerCase().includes(q)))

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Search fabrics" placeholder="Search fabric or yarn" className="bg-white pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button size="sm" className="gap-1" onClick={() => setEditing('new')}>
          <Plus className="size-3.5" />
          New fabric
        </Button>
      </div>
      <div className="data-table-wrap overflow-x-auto">
        <table className="w-full min-w-[44rem] table-fixed text-sm">
          <thead>
            <tr>
              <th className={cn(head, 'w-[16%]')}>Fabric</th>
              <th className={cn(head, 'w-[34%]')}>Yarn</th>
              <th className={cn(head, 'w-[13%]')}>Yarn / m</th>
              <th className={cn(head, 'w-[12%]')}>Wastage</th>
              <th className={cn(head, 'w-[13%]')}>Price / m</th>
              <th className={cn(head, 'w-[12%]')} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  {q ? (
                    <EmptyState icon={Search} line={`No fabric matches "${search.trim()}".`} actionLabel="Clear search" onAction={() => setSearch('')} />
                  ) : (
                    <EmptyState icon={Plus} line="No fabrics yet." actionLabel="New fabric" onAction={() => setEditing('new')} />
                  )}
                </td>
              </tr>
            )}
            {rows.map((f) => (
              <tr key={f.fabricType} className="border-t border-border">
                <td className={cn(cell, 'font-medium')}>
                  {f.fabricType}
                </td>
                <td className={cn(cell, 'truncate text-ink-2')} title={yarnName(f.materialId)}>{yarnName(f.materialId)}</td>
                <td className={numCell}>{f.yarnPerMetre} kg</td>
                <td className={numCell}>{f.wastagePct}%</td>
                <td className={numCell}>{formatINR(f.pricePerMetre)}</td>
                <td className={cn(cell, 'text-right')}>
                  <EditButton what={f.fabricType} onClick={() => setEditing(f)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <FabricDialog fabric={editing === 'new' ? null : editing} taken={fabrics.map((f) => f.fabricType.toLowerCase())} yarns={yarns} onClose={() => setEditing(null)} />}
    </section>
  )
}

function FabricDialog({ fabric, taken, yarns, onClose }: { fabric: Fabric | null; taken: string[]; yarns: Material[]; onClose: () => void }) {
  const [form, setForm] = useState({
    fabricType: fabric?.fabricType ?? '',
    materialId: fabric?.materialId ?? '',
    yarnPerMetre: fabric ? String(fabric.yarnPerMetre) : '',
    wastagePct: fabric ? String(fabric.wastagePct) : '3',
    pricePerMetre: fabric ? String(fabric.pricePerMetre) : '',
  })
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const fabricType = form.fabricType.trim()
  const exists = !fabric && taken.includes(fabricType.toLowerCase())
  const [removing, setRemoving] = useState(false)

  async function remove() {
    setRemoving(true)
    if (await save(`/config/fabrics/${encodeURIComponent(fabricType)}`, 'DELETE', undefined, `${fabricType} removed`)) onClose()
    else setRemoving(false)
  }

  return (
    <Popup
      title={fabric ? fabric.fabricType : 'New fabric'}
      saveLabel={fabric ? 'Save' : 'Add fabric'}
      canSave={!exists && !removing}
      onClose={onClose}
      extra={
        fabric ? (
          <Button variant="ghost" className="-ml-2 text-problem hover:text-problem" disabled={removing} onClick={remove}>
            Remove
          </Button>
        ) : undefined
      }
      onSave={() =>
        save(
          `/config/fabrics/${encodeURIComponent(fabricType)}`,
          'PUT',
          { materialId: form.materialId || null, yarnPerMetre: Number(form.yarnPerMetre), wastagePct: Number(form.wastagePct), pricePerMetre: Number(form.pricePerMetre) },
          fabric ? `${fabricType} saved` : `${fabricType} added`,
        )
      }
    >
      {!fabric && (
        <Field label="Fabric name" htmlFor="fabric-name" hint={exists ? <span className="text-problem">That fabric is already in the list.</span> : undefined}>
          <Input id="fabric-name" required autoFocus maxLength={60} value={form.fabricType} onChange={(e) => set('fabricType')(e.target.value)} />
        </Field>
      )}
      <Field label="Usual yarn" htmlFor="fabric-yarn">
        <select id="fabric-yarn" className={selectClass} value={form.materialId} onChange={(e) => set('materialId')(e.target.value)}>
          <option value="">None</option>
          {yarns.map((m) => (
            <option key={m.id} value={m.id}>
              {name(m)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Yarn per metre (kg)" htmlFor="fabric-ypm">
        <Num id="fabric-ypm" unit="kg" required min="0.0001" max="5" step="0.0001" value={form.yarnPerMetre} onChange={set('yarnPerMetre')} />
      </Field>
      <Field label="Wastage (%)" htmlFor="fabric-waste">
        <Num id="fabric-waste" unit="%" required min="0" max="50" step="0.1" value={form.wastagePct} onChange={set('wastagePct')} />
      </Field>
      <Field label="Price per metre (₹)" htmlFor="fabric-price">
        <Num id="fabric-price" unit="₹" required min="0.01" step="0.01" value={form.pricePerMetre} onChange={set('pricePerMetre')} />
      </Field>
    </Popup>
  )
}

// --------------------------------------------------------------- machines --

const STAGES: Stage[] = ['SPINNING', 'WEAVING', 'DYEING']
const PREFIX: Record<Stage, string> = { SPINNING: 'SP', WEAVING: 'WV', DYEING: 'DY' }
const KIND: Record<Stage, string> = { SPINNING: 'Ring Frame', WEAVING: 'Loom', DYEING: 'Dyeing Machine' }

function Machines() {
  const machines = useApi<Machine[]>('/machines')
  const [editing, setEditing] = useState<Machine | 'new' | null>(null)
  const [search, setSearch] = useState('')
  // In the order fabric moves through the mill, then by code.
  const all = [...(machines.data ?? [])].sort((x, y) => STAGES.indexOf(x.type) - STAGES.indexOf(y.type) || x.code.localeCompare(y.code))
  const q = search.trim().toLowerCase()
  const rows = all.filter((m) => !q || [m.code, m.name, label(m.type)].some((v) => v.toLowerCase().includes(q)))

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Search machines" placeholder="Search machine or stage" className="bg-white pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button size="sm" className="gap-1" onClick={() => setEditing('new')}>
          <Plus className="size-3.5" />
          New machine
        </Button>
      </div>
      {machines.error && <p className="text-sm text-problem">{machines.error}</p>}
      {machines.loading && !machines.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="data-table-wrap overflow-x-auto">
          <table className="w-full min-w-[40rem] table-fixed text-sm">
            <thead>
              <tr>
                <th className={cn(head, 'w-[18%]')}>Machine</th>
                <th className={cn(head, 'w-[28%]')}>Name</th>
                <th className={cn(head, 'w-[20%]')}>Stage</th>
                <th className={cn(head, 'w-[22%]')}>Capacity / day</th>
                <th className={cn(head, 'w-[12%]')} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    {q ? (
                      <EmptyState icon={Search} line={`No machine matches "${search.trim()}".`} actionLabel="Clear search" onAction={() => setSearch('')} />
                    ) : (
                      <EmptyState icon={Plus} line="No machines yet." actionLabel="New machine" onAction={() => setEditing('new')} />
                    )}
                  </td>
                </tr>
              )}
              {rows.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className={cn(cell, 'font-medium')}>{m.code}</td>
                  <td className={cn(cell, 'text-ink-2')}>{m.name}</td>
                  <td className={cn(cell, 'text-ink-2')}>{label(m.type)}</td>
                  <td className={numCell}>{m.dailyCapacity != null ? formatQty(Number(m.dailyCapacity), unitFor(m.type)) : <span className="text-muted-foreground">Not set</span>}</td>
                  <td className={cn(cell, 'text-right')}>
                    <EditButton what={m.code} onClick={() => setEditing(m)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <MachineDialog machine={editing === 'new' ? null : editing} all={all} onClose={() => setEditing(null)} />}
    </section>
  )
}

function MachineDialog({ machine, all, onClose }: { machine: Machine | null; all: Machine[]; onClose: () => void }) {
  // The next free code for a stage, e.g. WV-10.
  const nextCode = (stage: Stage) => {
    const nums = all.filter((m) => m.code.startsWith(`${PREFIX[stage]}-`)).map((m) => Number(m.code.split('-')[1]) || 0)
    return `${PREFIX[stage]}-${String(Math.max(0, ...nums) + 1).padStart(2, '0')}`
  }
  const suggested = (stage: Stage) => ({ code: nextCode(stage), name: `${KIND[stage]} ${Number(nextCode(stage).split('-')[1])}` })
  const before = {
    type: machine?.type ?? ('WEAVING' as Stage),
    code: machine?.code ?? suggested('WEAVING').code,
    name: machine?.name ?? suggested('WEAVING').name,
    dailyCapacity: machine?.dailyCapacity != null ? String(Number(machine.dailyCapacity)) : '',
  }
  const [form, setForm] = useState(before)
  const [removing, setRemoving] = useState(false)
  const set = (k: 'code' | 'name' | 'dailyCapacity') => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const code = form.code.trim().toUpperCase()
  const taken = all.some((m) => m.id !== machine?.id && m.code.toUpperCase() === code)
  const body = { code, name: form.name.trim(), dailyCapacity: form.dailyCapacity === '' ? null : Number(form.dailyCapacity) }

  async function remove() {
    setRemoving(true)
    if (await save(`/machines/${machine!.id}`, 'DELETE', undefined, `${machine!.code} removed`)) onClose()
    else setRemoving(false)
  }

  return (
    <Popup
      title={machine ? machine.code : 'New machine'}
      hint={machine ? label(machine.type) : undefined}
      saveLabel={machine ? 'Save' : 'Add machine'}
      canSave={!taken && !removing && (!machine || JSON.stringify(form) !== JSON.stringify(before))}
      onClose={onClose}
      onSave={() => (machine ? save(`/machines/${machine.id}`, 'PATCH', body, `${code} saved`) : save('/machines', 'POST', { ...body, type: form.type }, `${code} added`))}
      extra={
        machine ? (
          <Button variant="ghost" className="-ml-2 text-problem hover:text-problem" disabled={removing} onClick={remove}>
            Remove
          </Button>
        ) : undefined
      }
    >
      {!machine && (
        <Field label="Stage" htmlFor="machine-stage">
          <select id="machine-stage" className={selectClass} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as Stage, ...suggested(e.target.value as Stage) }))}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Code" htmlFor="machine-code" hint={taken ? <span className="text-problem">That code is already used.</span> : undefined}>
        <Input id="machine-code" required maxLength={20} value={form.code} onChange={(e) => set('code')(e.target.value)} />
      </Field>
      <Field label="Name" htmlFor="machine-name">
        <Input id="machine-name" required maxLength={60} value={form.name} onChange={(e) => set('name')(e.target.value)} />
      </Field>
      <Field label={`Capacity per day (${unitFor(form.type)})`} htmlFor="machine-capacity">
        <Num id="machine-capacity" unit={unitFor(form.type)} required={!machine} min="1" step="1" value={form.dailyCapacity} onChange={set('dailyCapacity')} />
      </Field>
    </Popup>
  )
}

// ---------------------------------------------------------------- workers --

// The floor workers picked as operators on the Machines screen, and paid from attendance.
// Shown on the Employees page; kept here beside the Popup and Num helpers it shares.
interface Worker {
  id: string
  code: string
  name: string
  shift: Shift
  dailyWage: number | string
  isActive: boolean
  createdAt: string
}
const SHIFTS: Shift[] = ['MORNING', 'EVENING', 'NIGHT']
const SHIFT_HOURS: Record<Shift, string> = { MORNING: '6 AM – 2 PM', EVENING: '2 PM – 10 PM', NIGHT: '10 PM – 6 AM' }
// Wages are shown per month here; pay is still worked out per day attended, on 26 working days
// a month (Sundays off), so the stored figure is the daily rate.
const WORK_DAYS = 26
const monthlyOf = (w: { dailyWage: number | string }) => Math.round(Number(w.dailyWage) * WORK_DAYS)

export function Workers() {
  const workers = useApi<Worker[]>('/workers')
  const [editing, setEditing] = useState<Worker | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const [shift, setShift] = useState<Shift | 'ALL'>('ALL')
  const q = search.trim().toLowerCase()
  // Active first, newest on top.
  const all = [...(workers.data ?? [])].sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.createdAt.localeCompare(a.createdAt) || b.code.localeCompare(a.code))
  const matches = all.filter((w) => (shift === 'ALL' || w.shift === shift) && (!q || [w.name, w.code, label(w.shift)].some((v) => v.toLowerCase().includes(q))))
  const paged = useClientPages(matches)
  const rows = paged.rows
  const filtered = !!q || shift !== 'ALL'

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Search workers" placeholder="Search name or code" className="bg-white pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select aria-label="Filter by shift" className={cn(selectClass, 'bg-white sm:w-auto sm:min-w-36')} value={shift} onChange={(e) => setShift(e.target.value as Shift | 'ALL')}>
            <option value="ALL">All shifts</option>
            {SHIFTS.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" className="gap-1" onClick={() => setEditing('new')}>
          <Plus className="size-3.5" />
          New worker
        </Button>
      </div>
      {workers.error && <p className="text-sm text-problem">{workers.error}</p>}
      {workers.loading && !workers.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="data-table-wrap overflow-x-auto">
          <table className="w-full min-w-[40rem] table-fixed text-sm">
            <thead>
              <tr>
                <th className={cn(head, 'w-[30%]')}>Worker</th>
                <th className={cn(head, 'w-[22%]')}>Shift</th>
                <th className={cn(head, 'w-[18%]')}>Monthly wage</th>
                <th className={cn(head, 'w-[18%]')}>Status</th>
                <th className={cn(head, 'w-[12%]')} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    {filtered ? (
                      <EmptyState
                        icon={Search}
                        line="No worker matches."
                        actionLabel="Clear filters"
                        onAction={() => {
                          setSearch('')
                          setShift('ALL')
                        }}
                      />
                    ) : (
                      <EmptyState icon={Plus} line="No workers yet." actionLabel="New worker" onAction={() => setEditing('new')} />
                    )}
                  </td>
                </tr>
              )}
              {rows.map((w) => (
                <tr key={w.id} className="border-t border-border">
                  <td className={cell}>
                    <div className="leading-tight">
                      <p className="truncate font-medium">{w.name}</p>
                      <p className="text-xs text-muted-foreground">{w.code}</p>
                    </div>
                  </td>
                  <td className={cell}>
                    <div className="leading-tight">
                      <p>{label(w.shift)}</p>
                      <p className="text-xs whitespace-nowrap text-muted-foreground">{SHIFT_HOURS[w.shift]}</p>
                    </div>
                  </td>
                  <td className={numCell}>{formatINR(monthlyOf(w))}</td>
                  <td className={cell}>{w.isActive ? <Pill tone="good">Active</Pill> : <Pill>Inactive</Pill>}</td>
                  <td className={cn(cell, 'text-right')}>
                    <EditButton what={w.name} onClick={() => setEditing(w)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!(workers.loading && !workers.data) && <Pagination {...pagerOf(paged)} />}
      {editing && <WorkerDialog worker={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function WorkerDialog({ worker, onClose }: { worker: Worker | null; onClose: () => void }) {
  const before = {
    name: worker?.name ?? '',
    shift: worker?.shift ?? ('MORNING' as Shift),
    monthlyWage: worker ? String(monthlyOf(worker)) : '',
    status: worker && !worker.isActive ? 'INACTIVE' : 'ACTIVE',
  }
  const [form, setForm] = useState(before)
  const [removing, setRemoving] = useState(false)
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const name = form.name.trim()
  const body = { name, shift: form.shift, dailyWage: Math.round((Number(form.monthlyWage) / WORK_DAYS) * 100) / 100 }

  async function remove() {
    setRemoving(true)
    if (await save(`/workers/${worker!.id}`, 'DELETE', undefined, `${worker!.name} removed`)) onClose()
    else setRemoving(false)
  }

  return (
    <Popup
      title={worker ? worker.name : 'New worker'}
      hint={worker ? worker.code : undefined}
      saveLabel={worker ? 'Save' : 'Add worker'}
      canSave={!removing && (!worker || JSON.stringify(form) !== JSON.stringify(before))}
      onClose={onClose}
      onSave={() => (worker ? save(`/workers/${worker.id}`, 'PATCH', { ...body, isActive: form.status === 'ACTIVE' }, `${name} saved`) : save('/workers', 'POST', body, `${name} added`))}
      extra={
        worker ? (
          <Button variant="ghost" className="-ml-2 text-problem hover:text-problem" disabled={removing} onClick={remove}>
            Remove
          </Button>
        ) : undefined
      }
    >
      <Field label="Name" htmlFor="worker-name">
        <Input id="worker-name" required autoFocus={!worker} maxLength={60} value={form.name} onChange={(e) => set('name')(e.target.value)} />
      </Field>
      <Field label="Shift" htmlFor="worker-shift">
        <select id="worker-shift" className={selectClass} value={form.shift} onChange={(e) => set('shift')(e.target.value)}>
          {SHIFTS.map((s) => (
            <option key={s} value={s}>
              {label(s)} · {SHIFT_HOURS[s]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Monthly wage (₹)" htmlFor="worker-wage" hint={`For a full month of ${WORK_DAYS} working days.`}>
        <Num id="worker-wage" unit="₹" required min="1" step="1" value={form.monthlyWage} onChange={set('monthlyWage')} />
      </Field>
      {worker && (
        <Field label="Status" htmlFor="worker-status" hint={form.status === 'INACTIVE' ? 'Not offered as an operator and left off the attendance register.' : undefined}>
          <select id="worker-status" className={selectClass} value={form.status} onChange={(e) => set('status')(e.target.value)}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </Field>
      )}
    </Popup>
  )
}

// ------------------------------------------------------------------ rules --

const KINDS = [
  { kind: 'QUANTITY' as const, title: 'Small orders', unit: 'm', lead: 'Order under' },
  { kind: 'DEADLINE' as const, title: 'Rush orders', unit: 'days', lead: 'Deadline under' },
]
type Kind = (typeof KINDS)[number]

function Rules({ rules }: { rules: Rule[] }) {
  const [editing, setEditing] = useState<{ kind: Kind; rule: Rule | null } | null>(null)

  return (
    <section className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-2">
        {KINDS.map((k) => {
          const mine = rules.filter((r) => r.kind === k.kind)
          return (
            <div key={k.kind} className="data-table-wrap">
              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <h2 className="section-head">{k.title}</h2>
                <Button size="xs" variant="outline" className="gap-1" onClick={() => setEditing({ kind: k, rule: null })}>
                  <Plus className="size-3" />
                  Add rule
                </Button>
              </div>
              {mine.length === 0 ? (
                <p className="border-t border-border px-3 py-6 text-center text-sm text-muted-foreground">No rules yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-t border-border">
                      <th className={head}>When</th>
                      <th className={head}>Price</th>
                      <th className={head}>Wastage</th>
                      <th className={head} />
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className={cell}>
                          {k.lead} {r.below.toLocaleString('en-IN')} {k.unit}
                        </td>
                        <td className={numCell}>{pct(r.pricePct)}</td>
                        <td className={numCell}>{pct(r.wastagePct)}</td>
                        <td className={cn(cell, 'text-right')}>
                          <EditButton what={`${k.lead} ${r.below} ${k.unit}`} onClick={() => setEditing({ kind: k, rule: r })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
      </div>
      {editing && <RuleDialog {...editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function RuleDialog({ kind, rule, onClose }: { kind: Kind; rule: Rule | null; onClose: () => void }) {
  const before = { below: rule ? String(rule.below) : '', pricePct: rule ? String(rule.pricePct) : '', wastagePct: rule ? String(rule.wastagePct) : '' }
  const [form, setForm] = useState(before)
  const [removing, setRemoving] = useState(false)
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const body = { pricePct: Number(form.pricePct || 0), wastagePct: Number(form.wastagePct || 0) }
  const when = `${kind.lead} ${rule?.below.toLocaleString('en-IN')} ${kind.unit}`

  async function remove() {
    setRemoving(true)
    if (await save(`/config/rules/${rule!.id}`, 'DELETE', undefined, 'Rule removed')) onClose()
    else setRemoving(false)
  }

  return (
    <Popup
      title={rule ? when : `New rule · ${kind.title.toLowerCase()}`}
      saveLabel={rule ? 'Save' : 'Add rule'}
      canSave={!removing && JSON.stringify(form) !== JSON.stringify(before)}
      onClose={onClose}
      onSave={() => (rule ? save(`/config/rules/${rule.id}`, 'PATCH', body, 'Rule saved') : save('/config/rules', 'POST', { kind: kind.kind, below: Number(form.below), ...body }, 'Rule added'))}
      extra={
        rule ? (
          <Button variant="ghost" className="-ml-2 text-problem hover:text-problem" disabled={removing} onClick={remove}>
            Remove
          </Button>
        ) : undefined
      }
    >
      {!rule && (
        <Field label={`${kind.lead} (${kind.unit})`} htmlFor="rule-below">
          <Num id="rule-below" unit={kind.unit} required autoFocus min="1" step="1" value={form.below} onChange={set('below')} />
        </Field>
      )}
      <Field label="Price change (%)" htmlFor="rule-price" hint="Use a minus to give a discount.">
        <Num id="rule-price" unit="%" min="-50" max="100" step="0.5" placeholder="0" value={form.pricePct} onChange={set('pricePct')} />
      </Field>
      <Field label="Extra wastage (%)" htmlFor="rule-waste">
        <Num id="rule-waste" unit="%" min="-50" max="100" step="0.5" placeholder="0" value={form.wastagePct} onChange={set('wastagePct')} />
      </Field>
    </Popup>
  )
}

// ---------------------------------------------------------------- history --

const FIELD: Record<string, string> = {
  materialId: 'usual yarn',
  yarnPerMetre: 'yarn per metre',
  wastagePct: 'wastage %',
  pricePerMetre: 'price per metre',
  pricePct: 'price %',
  below: 'limit',
  reorderLevel: 'low-stock level',
  supplierId: 'usual supplier',
  leadDays: 'delivery days',
  rule: 'rule',
  machine: 'machine',
  worker: 'worker',
  shift: 'shift',
  dailyWage: 'wage per day',
  isActive: 'active',
  dailyCapacity: 'capacity per day',
  code: 'code',
  name: 'name',
  fabric: 'fabric',
  qcDays: 'quality check time',
  rollLength: 'roll length',
  shiftHours: 'hours in a shift',
  dispatchTolerancePct: 'dispatch tolerance',
  shelfWaitDays: 'finished fabric wait limit',
}

function Log({ rows: all, loading }: { rows: ConfigChange[]; loading: boolean }) {
  const paged = useClientPages(all)
  const rows = paged.rows
  if (loading) return <Skeleton className="h-64 w-full" />
  if (!all.length)
    return (
      <div className="data-table-wrap">
        <EmptyState icon={History} line="No changes yet. Every edit on this page is recorded here." />
      </div>
    )
  return (
    <div className="space-y-3">
    <div className="data-table-wrap overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {['When', 'Item', 'Field', 'From', 'To', 'By'].map((h) => (
              <th key={h} className={head}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className={cn(cell, 'whitespace-nowrap text-ink-2')}>{formatDateTime(r.changedAt)}</td>
              <td className={cell}>{r.what}</td>
              <td className={cell}>{FIELD[r.field] ?? label(r.field)}</td>
              <td className={cn(numCell, 'text-muted-foreground')}>{r.oldValue ?? '—'}</td>
              <td className={cn(numCell, 'font-medium')}>{r.newValue ?? '—'}</td>
              <td className={cell}>{r.changedBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <Pagination {...pagerOf(paged)} />
    </div>
  )
}

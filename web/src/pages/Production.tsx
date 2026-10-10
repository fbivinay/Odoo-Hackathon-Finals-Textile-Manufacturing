import { useState, type FormEvent, type ReactNode } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/DataTable'
import { Factory, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from '@/auth/session'
import { actsAs } from '@/components/AppShell'
import { api, ApiError } from '@/lib/api'
import { EmptyState } from '@/components/EmptyState'
import { PageHead } from '@/components/PageHead'
import { Field, selectClass } from '@/components/Field'
import { StatusPill, label } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatQty, unitFor } from '@/lib/format'
import { mutate, useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import type { Board, Shift, Stage } from '@/types'

type BoardMachine = Board['machines'][number]
// An order with work left in a stage (GET /production/queue).
interface QueueRow {
  id: string
  orderNo: string
  fabricType: string
  remaining: number
  available: number
  running: number
  priority?: boolean // a replacement for rejected fabric: listed first
  rework?: boolean // back from quality check
}
interface Worker {
  id: string
  code: string
  name: string
  shift: Shift
  isActive: boolean
}

const STAGES: Stage[] = ['SPINNING', 'WEAVING', 'DYEING']
const isDown = (m: BoardMachine) => m.status === 'BREAKDOWN' || m.status === 'MAINTENANCE'

// The floor's states, in the same colours as their pills.
const FILTERS = [
  { label: 'All', dot: '', match: () => true },
  { label: 'Running', dot: 'bg-good', match: (m: BoardMachine) => m.status === 'RUNNING' },
  { label: 'Idle', dot: 'bg-watch', match: (m: BoardMachine) => m.status === 'IDLE' },
  { label: 'Down', dot: 'bg-problem', match: isDown },
]

// A machine's capacity per day (Mill Setup); 0 when none is set.
const capacityOf = (m: BoardMachine) => Number(m.dailyCapacity ?? 0)
// How much more it can make today. Infinity when it has no capacity set.
const roomToday = (m: BoardMachine) => (capacityOf(m) > 0 ? Math.max(0, Math.round((capacityOf(m) - m.producedToday) * 100) / 100) : Infinity)

export function Production() {
  const { user } = useSession()
  // Only the owner adds machines (POST /machines is owner-only).
  const canAdd = actsAs(user)
  const [adding, setAdding] = useState(false)
  const board = useApi<Board>('/production/board')
  const [filter, setFilter] = useState(0)
  // Keep the id, not the row, so the popup shows fresh numbers after each action.
  const [openId, setOpenId] = useState<string | null>(null)
  const machines = board.data?.machines ?? []
  const selected = machines.find((m) => m.id === openId) ?? null

  // No column sorting: machines stay in code order.
  // Four things per machine: what it is, what is on it, how far along, and today's output.
  const columns: ColumnDef<BoardMachine>[] = [
    {
      accessorKey: 'code',
      header: 'Machine',
      meta: { width: '22%' },
      enableSorting: false,
      cell: ({ row: { original: m } }) => (
        <div className="flex items-center gap-2.5">
          <span className="w-12 font-medium">{m.code}</span>
          <StatusPill status={m.status} />
        </div>
      ),
    },
    {
      id: 'order',
      header: 'Order',
      meta: { width: '29%' },
      enableSorting: false,
      accessorFn: (m) => m.currentJob?.order.orderNo ?? '',
      cell: ({ row: { original: m } }) =>
        m.currentJob ? (
          <div className="leading-tight">
            <p>
              <span className="font-medium">{m.currentJob.order.orderNo}</span> <span className="text-ink-2">· {m.currentJob.order.fabricType}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {m.currentJob.worker?.name ?? 'No operator'} · {label(m.currentJob.shift)}
            </p>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'progress',
      header: 'Progress',
      meta: { width: '22%' },
      enableSorting: false,
      accessorFn: (m) => m.currentJob?.percent ?? -1,
      cell: ({ row: { original: m } }) =>
        m.currentJob ? <Progress m={m} /> : <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'producedToday',
      header: 'Today',
      meta: { width: '14%' },
      enableSorting: false,
      cell: ({ row: { original: m } }) => {
        const cap = capacityOf(m)
        if (!cap && !(m.producedToday > 0)) return <span className="text-muted-foreground">—</span>
        return (
          <div className="leading-tight tabular-nums">
            <p>{formatQty(m.producedToday, unitFor(m.type))}</p>
            {cap > 0 && (roomToday(m) <= 0 ? <p className="text-xs font-medium whitespace-nowrap text-watch">Capacity reached</p> : <p className="text-xs whitespace-nowrap text-muted-foreground">of {formatQty(cap, unitFor(m.type))}</p>)}
          </div>
        )
      },
    },
    {
      id: 'action',
      header: '',
      meta: { width: '13%' },
      enableSorting: false,
      cell: ({ row: { original: m } }) => (
        <div className="flex justify-end">
          <Button size="xs" variant={m.status === 'IDLE' ? 'default' : 'outline'} onClick={() => setOpenId(m.id)}>
            {m.status === 'RUNNING' ? 'Update' : m.status === 'IDLE' ? 'Assign order' : 'Back in service'}
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHead
        eyebrow="On the floor"
        title="Machines (Production floor)"
        actions={
          canAdd && (
            <Button className="gap-1.5" onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              Add machine
            </Button>
          )
        }
      />
      {board.error && <p className="text-sm text-problem">{board.error}</p>}

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f, i) => (
          <Button key={f.label} size="sm" variant={i === filter ? 'secondary' : 'ghost'} className="gap-1.5" onClick={() => setFilter(i)}>
            {f.dot && <span className={`size-2 rounded-full ${f.dot}`} />}
            {f.label}
            <span className="text-xs text-muted-foreground">{machines.filter(f.match).length}</span>
          </Button>
        ))}
      </div>

      {/* One block per stage, in the order the fabric moves through the mill. */}
      {STAGES.map((stage) => {
        const all = machines.filter((m) => m.type === stage)
        const rows = all.filter(FILTERS[filter].match)
        if (!board.loading && rows.length === 0) return null
        return (
          <section key={stage} className="space-y-2">
            <h2 className="flex items-baseline gap-2 text-sm font-semibold">
              {label(stage)}
              <span className="text-xs font-normal text-muted-foreground">
                {all.filter((m) => m.status === 'RUNNING').length} of {all.length} running · {formatQty(all.reduce((sum, m) => sum + m.producedToday, 0), unitFor(stage))} made today
              </span>
            </h2>
            <DataTable columns={columns} data={rows} loading={board.loading} />
          </section>
        )
      })}

      {!board.loading && machines.filter(FILTERS[filter].match).length === 0 && (
        <div className="data-table-wrap">
          <EmptyState icon={Factory} line={['No machines set up yet.', 'No machine is running.', 'No machine is idle. All are busy or down.', 'No machine is down.'][filter]} />
        </div>
      )}

      {selected && <MachineDialog m={selected} onClose={() => setOpenId(null)} onChange={board.reload} />}
      {adding && <AddMachineDialog machines={machines} onClose={() => setAdding(false)} />}
    </div>
  )
}

const PREFIX: Record<Stage, string> = { SPINNING: 'SP', WEAVING: 'WV', DYEING: 'DY' }
const KIND: Record<Stage, string> = { SPINNING: 'Ring Frame', WEAVING: 'Loom', DYEING: 'Dyeing Machine' }

// A new machine joins the floor idle; capacity and planning pick it up from its stage.
function AddMachineDialog({ machines, onClose }: { machines: BoardMachine[]; onClose: () => void }) {
  const nextCode = (stage: Stage) => {
    const nums = machines.filter((m) => m.code.startsWith(`${PREFIX[stage]}-`)).map((m) => Number(m.code.split('-')[1]) || 0)
    return `${PREFIX[stage]}-${String(Math.max(0, ...nums) + 1).padStart(2, '0')}`
  }
  const [type, setType] = useState<Stage>('WEAVING')
  const [code, setCode] = useState(nextCode('WEAVING'))
  const [name, setName] = useState(`${KIND.WEAVING} ${Number(nextCode('WEAVING').split('-')[1])}`)
  const [capacity, setCapacity] = useState('')
  const [busy, setBusy] = useState(false)

  function pickType(t: Stage) {
    setType(t)
    const c = nextCode(t)
    setCode(c)
    setName(`${KIND[t]} ${Number(c.split('-')[1])}`)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (machines.some((m) => m.code.toLowerCase() === code.trim().toLowerCase())) {
      toast.error(`${code} is already on the floor. Pick another code.`)
      return
    }
    setBusy(true)
    try {
      await api('/machines', { method: 'POST', body: { code: code.trim().toUpperCase(), name: name.trim(), type, dailyCapacity: Number(capacity) } })
      toast.success(`${code.trim().toUpperCase()} added, idle and ready for work`)
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add machine</DialogTitle>
        </DialogHeader>
        <form id="add-machine" onSubmit={submit} className="grid gap-4">
          <Field label="Stage" htmlFor="machineType">
            <select id="machineType" className={selectClass} value={type} onChange={(e) => pickType(e.target.value as Stage)}>
              <option value="SPINNING">Spinning</option>
              <option value="WEAVING">Weaving</option>
              <option value="DYEING">Dyeing</option>
            </select>
          </Field>
          <Field label="Code" htmlFor="machineCode">
            <Input id="machineCode" required value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Name" htmlFor="machineName">
            <Input id="machineName" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={`Capacity per day (${unitFor(type)})`} htmlFor="machineCapacity">
            <Input id="machineCapacity" type="number" required min="1" step="1" inputMode="numeric" className="tabular-nums" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-machine" disabled={busy}>
            Add machine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// `wide` fills its container (the popup); the table keeps the bar short.
function Progress({ m, wide = false }: { m: BoardMachine; wide?: boolean }) {
  const job = m.currentJob!
  const unit = unitFor(m.type)
  return (
    <div className={cn('space-y-1', !wide && 'w-40')}>
      <div className="h-1.5 overflow-hidden rounded-full bg-brand/10">
        <div className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out" style={{ width: `${job.percent}%` }} />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatQty(job.qtyProduced, unit)} of {formatQty(job.qtyPlanned, unit)} · {Math.round(job.percent)}%
      </p>
    </div>
  )
}

const NEXT_STAGE: Partial<Record<Stage, Stage>> = { SPINNING: 'WEAVING', WEAVING: 'DYEING' }

// One popup per machine; what it offers depends on what the machine is doing.
function MachineDialog({ m, onClose, onChange }: { m: BoardMachine; onClose: () => void; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const job = m.currentJob

  async function run(path: string, method: string, body: unknown, msg: string, close = false) {
    setBusy(true)
    const ok = await mutate(path, method, body, msg)
    setBusy(false)
    if (ok) {
      onChange()
      if (close) onClose()
    }
    return ok
  }
  const setStatus = (status: string, msg: string) => run(`/machines/${m.id}/status`, 'PATCH', { status }, msg, true)

  // Finishing closes the popup; the order then waits in the next stage's list.
  function finish() {
    if (!job) return
    const next = NEXT_STAGE[m.type]
    void run(
      `/production/jobs/${job.id}/complete`,
      'POST',
      undefined,
      next ? `${job.order.orderNo}: ${label(m.type).toLowerCase()} done, ready for ${label(next).toLowerCase()}` : `${job.order.orderNo}: dyeing done, sent to quality check`,
      true,
    )
  }

  const title = job ? `${m.code} · ${job.order.orderNo}` : m.code
  const about = job
    ? [job.order.fabricType, job.worker?.name].filter(Boolean).join(' · ')
    : m.status === 'IDLE'
      ? null
      : `${m.name} · ${m.status === 'BREAKDOWN' ? 'broken down' : 'under maintenance'}`

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {about && <DialogDescription>{about}</DialogDescription>}
        </DialogHeader>

        {job ? (
          <RunningJob m={m} busy={busy} run={run} onFinish={finish} onClose={onClose} stop={<StopMachine m={m} busy={busy} setStatus={setStatus} />} />
        ) : m.status === 'IDLE' ? (
          <AssignOrder m={m} busy={busy} run={run} onClose={onClose} stop={<StopMachine m={m} busy={busy} setStatus={setStatus} />} />
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => setStatus('IDLE', `${m.code} is back in service`)}>
              Back in service
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

type Run = (path: string, method: string, body: unknown, msg: string, close?: boolean) => Promise<boolean>

// The quiet way out for a machine that can't work: either one stops whatever is running on it.
function StopMachine({ m, busy, setStatus }: { m: BoardMachine; busy: boolean; setStatus: (status: string, msg: string) => void }) {
  const stops = m.currentJob ? ', job stopped' : ''
  const link = 'font-medium underline-offset-2 hover:underline disabled:opacity-50'
  return (
    <p className="text-xs text-muted-foreground">
      Machine stopped?{' '}
      <button type="button" className={cn(link, 'text-problem')} disabled={busy} onClick={() => setStatus('BREAKDOWN', `${m.code} broke down${stops}`)}>
        Breakdown
      </button>
      {' · '}
      <button type="button" className={cn(link, 'text-ink-2')} disabled={busy} onClick={() => setStatus('MAINTENANCE', `${m.code} on maintenance${stops}`)}>
        Maintenance
      </button>
    </p>
  )
}

function RunningJob({ m, busy, run, onFinish, onClose, stop }: { m: BoardMachine; busy: boolean; run: Run; onFinish: () => void; onClose: () => void; stop: ReactNode }) {
  const job = m.currentJob!
  const unit = unitFor(m.type)
  const next = NEXT_STAGE[m.type]
  const [output, setOutput] = useState('')
  // A job can't make more than its plan, nor a machine more in a day than its capacity.
  const left = Math.max(0, Math.round((job.qtyPlanned - job.qtyProduced) * 100) / 100)
  const room = roomToday(m)
  const canAdd = Math.min(left, room)
  const hint =
    room <= 0 ? (
      <span className="font-medium text-watch">Capacity reached for the day.</span>
    ) : left <= 0 ? (
      'Planned quantity reached.'
    ) : room < left ? (
      `${formatQty(room, unit)} of today's capacity left.`
    ) : undefined

  return (
    <>
      <div className="grid gap-4">
        <div className="rounded-lg bg-zinc-50 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold tabular-nums">{Math.round(job.percent)}%</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatQty(job.qtyProduced, unit)} of {formatQty(job.qtyPlanned, unit)}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand/10">
            <div className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out" style={{ width: `${job.percent}%` }} />
          </div>
        </div>

        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            void run(`/production/jobs/${job.id}/progress`, 'POST', { qty: Number(output) }, `${formatQty(Number(output), unit)} added on ${m.code}`, true)
          }}
        >
          <Field label={`Add output (${unit})`} htmlFor="output" hint={hint}>
            <div className="flex gap-2">
              <Input id="output" type="number" min="0.01" max={canAdd} step="0.01" inputMode="decimal" required autoFocus disabled={canAdd <= 0} placeholder={canAdd > 0 ? `Up to ${formatQty(canAdd, unit)}` : undefined} className="tabular-nums" value={output} onChange={(e) => setOutput(e.target.value)} />
              <Button type="submit" variant="outline" disabled={busy || canAdd <= 0}>
                Add
              </Button>
            </div>
          </Field>
        </form>
        {stop}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={onFinish} title={left > 0 ? `Marks the remaining ${formatQty(left, unit)} as made` : undefined}>
          Finish → {next ? label(next) : 'Quality check'}
        </Button>
      </DialogFooter>
    </>
  )
}

const SHIFTS: Shift[] = ['MORNING', 'EVENING', 'NIGHT']
const SHIFT_HOURS: Record<Shift, string> = { MORNING: '6 AM – 2 PM', EVENING: '2 PM – 10 PM', NIGHT: '10 PM – 6 AM' }

// The active workers from Mill Setup. Until a shift is picked the list shows everyone; picking a
// worker first fills in their shift.
function ShiftOperator({ shift, onShift, workerId, onWorker }: { shift: Shift | ''; onShift: (s: Shift | '') => void; workerId: string; onWorker: (id: string) => void }) {
  const workers = useApi<Worker[]>('/workers')
  const operators = (workers.data?.filter((w) => w.isActive && (!shift || w.shift === shift)) ?? []).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      <Field label="Shift" htmlFor="shift">
        <select
          id="shift"
          required
          className={selectClass}
          value={shift}
          onChange={(e) => {
            onShift(e.target.value as Shift | '')
            onWorker('')
          }}
        >
          <option value="">Select shift</option>
          {SHIFTS.map((s) => (
            <option key={s} value={s}>
              {label(s)} · {SHIFT_HOURS[s]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Operator" htmlFor="operator" hint={!workers.loading && !operators.length ? `No workers${shift ? ` on the ${label(shift).toLowerCase()} shift` : ''}. Add one in Mill Setup.` : undefined}>
        <select
          id="operator"
          required
          className={selectClass}
          value={workerId}
          onChange={(e) => {
            const picked = operators.find((w) => w.id === e.target.value)
            if (picked && !shift) onShift(picked.shift)
            onWorker(e.target.value)
          }}
        >
          <option value="">Select operator</option>
          {operators.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} · {shift ? w.code : label(w.shift)}
            </option>
          ))}
        </select>
      </Field>
    </>
  )
}

function AssignOrder({ m, busy, run, onClose, stop }: { m: BoardMachine; busy: boolean; run: Run; onClose: () => void; stop: ReactNode }) {
  // Orders ready for this machine's stage, earliest deadline first.
  const orders = useApi<QueueRow[]>(`/production/queue?stage=${m.type}`)
  const [orderId, setOrderId] = useState('')
  const [workerId, setWorkerId] = useState('')
  const [shift, setShift] = useState<Shift | ''>('')
  const eligible = orders.data ?? []
  const order = eligible.find((o) => o.id === orderId)
  const none = !orders.loading && !eligible.length

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!order) return
    void run('/production/jobs', 'POST', { orderId, machineId: m.id, shift, workerId, qtyPlanned: order.available }, `${order.orderNo} started on ${m.code}`, true)
  }

  return (
    <>
      <form id="assign-order" onSubmit={submit} className="grid gap-4">
        {none ? (
          <p className="text-sm text-muted-foreground">No order is waiting for {label(m.type).toLowerCase()}.</p>
        ) : (
          <>
            <Field label="Order" htmlFor="orderId" hint={order ? `${formatQty(order.available, unitFor(m.type))} to make` : 'Priority orders first, then earliest deadline'}>
              <select id="orderId" required className={selectClass} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                <option value="">Select order</option>
                {eligible.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNo} · {o.fabricType}
                    {o.rework ? ' · Rework · Priority' : o.priority ? ' · Priority' : ''}
                    {o.running > 0 ? ' (also running)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <ShiftOperator shift={shift} onShift={setShift} workerId={workerId} onWorker={setWorkerId} />
          </>
        )}
        {stop}
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {!none && (
          <Button type="submit" form="assign-order" disabled={busy}>
            Start {label(m.type).toLowerCase()}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}

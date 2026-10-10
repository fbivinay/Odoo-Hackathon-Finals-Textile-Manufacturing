import { useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/DataTable'
import { Factory } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PageHead } from '@/components/PageHead'
import { Field, selectClass } from '@/components/Field'
import { StatusPill, label } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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

// The shift running right now: 06:00, 14:00 and 22:00 starts.
function currentShift(): Shift {
  const hour = new Date().getHours()
  return hour >= 6 && hour < 14 ? 'MORNING' : hour >= 14 && hour < 22 ? 'EVENING' : 'NIGHT'
}

export function Production() {
  const board = useApi<Board>('/production/board')
  const [filter, setFilter] = useState(0)
  // Keep the id, not the row, so the popup shows fresh numbers after each action.
  const [openId, setOpenId] = useState<string | null>(null)
  const machines = board.data?.machines ?? []
  const selected = machines.find((m) => m.id === openId) ?? null

  const columns: ColumnDef<BoardMachine>[] = [
    {
      accessorKey: 'code',
      header: 'Machine',
      cell: ({ row: { original: m } }) => <span className="font-medium">{m.code}</span>,
    },
    { accessorKey: 'status', header: 'Status', cell: ({ row: { original: m } }) => <StatusPill status={m.status} /> },
    {
      id: 'order',
      header: 'Order',
      accessorFn: (m) => m.currentJob?.order.orderNo ?? '',
      cell: ({ row: { original: m } }) =>
        m.currentJob ? (
          <div className="leading-tight">
            <p className="font-medium">{m.currentJob.order.orderNo}</p>
            <p className="text-xs text-muted-foreground">{m.currentJob.order.fabricType}</p>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'progress',
      header: 'Progress',
      accessorFn: (m) => m.currentJob?.percent ?? -1,
      cell: ({ row: { original: m } }) =>
        m.currentJob ? <Progress m={m} /> : <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'action',
      header: '',
      enableSorting: false,
      cell: ({ row: { original: m } }) => (
        <Button size="xs" variant={m.status === 'IDLE' ? 'default' : 'outline'} onClick={() => setOpenId(m.id)}>
          {m.status === 'RUNNING' ? 'Update' : m.status === 'IDLE' ? 'Assign order' : 'Back in service'}
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHead eyebrow="On the floor" title="Production" />
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
                {all.filter((m) => m.status === 'RUNNING').length} of {all.length} running
              </span>
            </h2>
            <DataTable columns={columns} data={rows} loading={board.loading} initialSorting={[{ id: 'code', desc: false }]} />
          </section>
        )
      })}

      {!board.loading && machines.filter(FILTERS[filter].match).length === 0 && (
        <div className="data-table-wrap">
          <EmptyState icon={Factory} line={['No machines set up yet.', 'No machine is running.', 'No machine is idle. All are busy or down.', 'No machine is down.'][filter]} />
        </div>
      )}

      {selected && <MachineDialog m={selected} machines={machines} onClose={() => setOpenId(null)} onChange={board.reload} />}
    </div>
  )
}

function Progress({ m }: { m: BoardMachine }) {
  const job = m.currentJob!
  const unit = unitFor(m.type)
  return (
    <div className="min-w-36 space-y-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-brand/10">
        <div className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out" style={{ width: `${job.percent}%` }} />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatQty(job.qtyProduced, unit)} of {formatQty(job.qtyPlanned, unit)} · {Math.round(job.percent)}%
      </p>
    </div>
  )
}

const FLOW = ['SPINNING', 'WEAVING', 'DYEING', 'QC'] as const
const NEXT_STAGE: Partial<Record<Stage, Stage>> = { SPINNING: 'WEAVING', WEAVING: 'DYEING' }
type JobOrder = NonNullable<BoardMachine['currentJob']>['order']

// Where the order is on its way through the mill.
function StageSteps({ current, done = false }: { current: Stage; done?: boolean }) {
  const at = FLOW.indexOf(current) + (done ? 1 : 0)
  return (
    <ol className="flex items-center gap-1 text-[0.68rem]">
      {FLOW.map((stage, i) => (
        <li key={stage} className="flex items-center gap-1">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 font-medium',
              i < at && 'bg-brand-tint text-brand',
              i === at && 'bg-brand text-white',
              i > at && 'bg-zinc-100 text-muted-foreground',
            )}
          >
            {stage === 'QC' ? 'Quality check' : label(stage)}
          </span>
          {i < FLOW.length - 1 && <span className="text-muted-foreground">›</span>}
        </li>
      ))}
    </ol>
  )
}

// One popup per machine; what it offers depends on what the machine is doing.
function MachineDialog({ m, machines, onClose, onChange }: { m: BoardMachine; machines: BoardMachine[]; onClose: () => void; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  // Set when a stage has just been finished here, to offer the next machine straight away.
  const [finished, setFinished] = useState<{ order: JobOrder; stage: Stage; left: number } | null>(null)
  const [confirmShort, setConfirmShort] = useState(false)
  const job = m.currentJob
  const left = job ? Math.max(0, Math.round((job.qtyPlanned - job.qtyProduced) * 100) / 100) : 0
  const short = job ? left > job.qtyPlanned * 0.01 : false

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

  async function finish() {
    if (!job) return
    setConfirmShort(false)
    const next = NEXT_STAGE[m.type]
    const ok = await run(
      `/production/jobs/${job.id}/complete`,
      'POST',
      undefined,
      next ? `${label(m.type)} finished for ${job.order.orderNo}` : `${job.order.orderNo} dyed and sent to quality check`,
      !next,
    )
    if (ok && next) setFinished({ order: job.order, stage: m.type, left: short ? left : 0 })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{finished ? `${finished.order.orderNo} · next step` : m.currentJob ? `${m.code} · ${m.currentJob.order.orderNo}` : `${m.code} · ${m.name}`}</DialogTitle>
          <DialogDescription>
            {finished
              ? `${label(finished.stage)} done. Pick a ${label(NEXT_STAGE[finished.stage]!).toLowerCase()} machine.`
              : m.currentJob
                ? m.currentJob.order.fabricType
                : m.status === 'IDLE'
                  ? 'Free for an order'
                  : m.status === 'BREAKDOWN'
                    ? 'Broken down'
                    : 'Under maintenance'}
          </DialogDescription>
        </DialogHeader>

        {finished ? (
          <NextStage order={finished.order} from={finished.stage} left={finished.left} machines={machines} busy={busy} run={run} onLater={onClose} />
        ) : confirmShort && job ? (
          <div className="grid gap-4">
            <p className="text-sm">
              Only <b>{formatQty(job.qtyProduced, unitFor(m.type))}</b> of {formatQty(job.qtyPlanned, unitFor(m.type))} is made.{' '}
              <b>{formatQty(left, unitFor(m.type))}</b> is still left.
            </p>
            <p className="text-xs text-muted-foreground">
              If you finish now, the rest stays in the {label(m.type).toLowerCase()} list to run later.
              {m.type === 'DYEING' && ' What is made goes to quality check.'}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmShort(false)}>
                Keep running
              </Button>
              <Button disabled={busy} onClick={finish}>
                Finish short
              </Button>
            </div>
          </div>
        ) : m.currentJob ? (
          <RunningJob m={m} busy={busy} run={run} onFinish={() => (short ? setConfirmShort(true) : finish())} />
        ) : m.status === 'IDLE' ? (
          <AssignOrder m={m} busy={busy} run={run} />
        ) : (
          <Button disabled={busy} onClick={() => setStatus('IDLE', `${m.code} is back in service`)}>
            Back in service
          </Button>
        )}

        {!finished && !confirmShort && !isDown(m) && (
          <div className="flex gap-4 border-t border-border pt-3 text-xs">
            <button
              type="button"
              className="text-problem hover:underline disabled:opacity-50"
              disabled={busy}
              onClick={() => setStatus('BREAKDOWN', m.currentJob ? `${m.code} broke down, job stopped` : `${m.code} marked as broken down`)}
            >
              Report breakdown
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:underline disabled:opacity-50"
              disabled={busy}
              onClick={() => setStatus('MAINTENANCE', m.currentJob ? `${m.code} on maintenance, job stopped` : `${m.code} on maintenance`)}
            >
              Start maintenance
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

type Run = (path: string, method: string, body: unknown, msg: string, close?: boolean) => Promise<boolean>

function RunningJob({ m, busy, run, onFinish }: { m: BoardMachine; busy: boolean; run: Run; onFinish: () => void }) {
  const job = m.currentJob!
  const unit = unitFor(m.type)
  const next = NEXT_STAGE[m.type]
  const [output, setOutput] = useState('')
  // A job can't make more than its plan.
  const left = Math.max(0, Math.round((job.qtyPlanned - job.qtyProduced) * 100) / 100)

  return (
    <div className="grid gap-4">
      <StageSteps current={m.type} />
      <Progress m={m} />

      <form
        onSubmit={async (e: FormEvent) => {
          e.preventDefault()
          if (await run(`/production/jobs/${job.id}/progress`, 'POST', { qty: Number(output) }, `${formatQty(Number(output), unit)} added`)) setOutput('')
        }}
      >
        <Field label={`Output made (${unit})`} htmlFor="output" hint={left > 0 ? `${formatQty(left, unit)} left to make` : 'Planned quantity reached'}>
          <div className="flex gap-2">
            <Input id="output" type="number" min="0.01" max={left} step="0.01" inputMode="decimal" required disabled={left <= 0} value={output} onChange={(e) => setOutput(e.target.value)} />
            <Button type="submit" variant="outline" disabled={busy || left <= 0}>
              Add
            </Button>
          </div>
        </Field>
      </form>

      <Button disabled={busy} onClick={onFinish}>
        {next ? `Finish → send to ${label(next).toLowerCase()}` : 'Finish → send to QC'}
      </Button>
    </div>
  )
}

// Straight after a stage is finished: put the order on a free machine of the next stage.
function NextStage({ order, from, left, machines, busy, run, onLater }: { order: JobOrder; from: Stage; left: number; machines: BoardMachine[]; busy: boolean; run: Run; onLater: () => void }) {
  const stage = NEXT_STAGE[from]!
  const free = machines.filter((x) => x.type === stage && x.status === 'IDLE')
  const workers = useApi<Worker[]>('/workers')
  const queue = useApi<QueueRow[]>(`/production/queue?stage=${stage}`)
  const shift = currentShift()
  const operators = workers.data?.filter((w) => w.isActive && w.shift === shift) ?? []
  const [machineId, setMachineId] = useState('')
  const [workerId, setWorkerId] = useState('')
  const chosen = free.find((x) => x.id === machineId)
  // Only what the finished stage has handed over can start now.
  const ready = queue.data?.find((q) => q.id === order.id)?.available ?? 0

  function submit(e: FormEvent) {
    e.preventDefault()
    void run('/production/jobs', 'POST', { orderId: order.id, machineId, shift, workerId, qtyPlanned: ready }, `${order.orderNo} started ${label(stage).toLowerCase()} on ${chosen?.code}`, true)
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <StageSteps current={from} done />
      <p className="text-xs text-muted-foreground">
        {queue.loading ? 'Checking…' : `${formatQty(ready, unitFor(stage))} ready for ${label(stage).toLowerCase()}.`}
        {left > 0 && ` ${formatQty(left, unitFor(from))} of ${label(from).toLowerCase()} is still left and stays in that list.`}
      </p>
      {free.length === 0 || (!queue.loading && ready <= 0) ? (
        <p className="text-sm text-muted-foreground">
          {free.length === 0 ? `No ${label(stage).toLowerCase()} machine is free. Assign it later from an idle one.` : `Nothing to ${stage === 'WEAVING' ? 'weave' : 'dye'} yet.`}
        </p>
      ) : (
        <>
          <Field label={`${label(stage)} machine`} htmlFor="nextMachine">
            <select id="nextMachine" required className={selectClass} value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              <option value="">Select a free machine…</option>
              {free.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code} · {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Operator" htmlFor="nextWorker" hint={!workers.loading && !operators.length && `No operators on the ${label(shift).toLowerCase()} shift.`}>
            <select id="nextWorker" required className={selectClass} value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
              <option value="">Select operator…</option>
              {operators.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.code}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onLater}>
          {free.length === 0 || ready <= 0 ? 'Close' : 'Later'}
        </Button>
        {free.length > 0 && ready > 0 && (
          <Button type="submit" disabled={busy}>
            Start {label(stage).toLowerCase()}
          </Button>
        )}
      </div>
    </form>
  )
}

function AssignOrder({ m, busy, run }: { m: BoardMachine; busy: boolean; run: Run }) {
  // Orders with work left in this machine's stage, earliest deadline first.
  const orders = useApi<QueueRow[]>(`/production/queue?stage=${m.type}`)
  const workers = useApi<Worker[]>('/workers')
  const shift = currentShift()
  const [orderId, setOrderId] = useState('')
  const [workerId, setWorkerId] = useState('')
  const eligible = orders.data ?? []
  const operators = workers.data?.filter((w) => w.isActive && w.shift === shift) ?? []
  const order = eligible.find((o) => o.id === orderId)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!order) return
    void run('/production/jobs', 'POST', { orderId, machineId: m.id, shift, workerId, qtyPlanned: order.available }, `${order.orderNo} started on ${m.code}`, true)
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Order" htmlFor="orderId" hint={!orders.loading && !eligible.length && `No orders waiting for ${label(m.type).toLowerCase()}.`}>
        <select id="orderId" required className={selectClass} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">Select order…</option>
          {eligible.map((o) => (
            <option key={o.id} value={o.id}>
              {o.orderNo} · {o.fabricType} · {formatQty(o.available, unitFor(m.type))} left{o.running > 0 ? ' (also running)' : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Operator" htmlFor="workerId" hint={!workers.loading && !operators.length && `No operators on the ${label(shift).toLowerCase()} shift.`}>
        <select id="workerId" required className={selectClass} value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
          <option value="">Select operator…</option>
          {operators.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} · {w.code}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit" disabled={busy}>
        {busy ? 'Starting…' : `Start ${label(m.type).toLowerCase()}`}
      </Button>
    </form>
  )
}

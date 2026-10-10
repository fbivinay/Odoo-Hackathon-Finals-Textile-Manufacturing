import { useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/DataTable'
import { PageHead } from '@/components/PageHead'
import { Field, selectClass } from '@/components/Field'
import { StatusPill, label } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatQty, unitFor } from '@/lib/format'
import { mutate, useApi } from '@/lib/useApi'
import { recentOrdersPath } from '@/lib/queries'
import { cn } from '@/lib/utils'
import type { Board, Order, Shift, Stage } from '@/types'

type BoardMachine = Board['machines'][number]
interface Worker {
  id: string
  code: string
  name: string
  shift: Shift
  isActive: boolean
}

const STAGES: Stage[] = ['SPINNING', 'WEAVING', 'DYEING']
const SHIFTS: Shift[] = ['MORNING', 'EVENING', 'NIGHT']
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
        m.currentJob ? (
          <Progress m={m} today />
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">{m.producedToday > 0 ? `${formatQty(m.producedToday, unitFor(m.type))} today` : '—'}</span>
        ),
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

      {selected && <MachineDialog m={selected} machines={machines} onClose={() => setOpenId(null)} onChange={board.reload} />}
    </div>
  )
}

function Progress({ m, today = false }: { m: BoardMachine; today?: boolean }) {
  const job = m.currentJob!
  const unit = unitFor(m.type)
  return (
    <div className="min-w-36 space-y-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-brand/10">
        <div className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out" style={{ width: `${job.percent}%` }} />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatQty(job.qtyProduced, unit)} of {formatQty(job.qtyPlanned, unit)} · {Math.round(job.percent)}%
        {today && ` · ${formatQty(m.producedToday, unit)} today`}
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
  const [finished, setFinished] = useState<{ order: JobOrder; stage: Stage } | null>(null)

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
    const job = m.currentJob!
    const next = NEXT_STAGE[m.type]
    const ok = await run(
      `/production/jobs/${job.id}/complete`,
      'POST',
      undefined,
      next ? `${label(m.type)} finished for ${job.order.orderNo}` : `${job.order.orderNo} finished dyeing, rolls are with quality check`,
      !next,
    )
    if (ok && next) setFinished({ order: job.order, stage: m.type })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{finished ? `${finished.order.orderNo} · next step` : m.currentJob ? `${m.code} · ${m.currentJob.order.orderNo}` : `${m.code} · ${m.name}`}</DialogTitle>
          <DialogDescription>
            {finished
              ? `${label(finished.stage)} is done. Send it on to ${label(NEXT_STAGE[finished.stage]!).toLowerCase()}.`
              : m.currentJob
                ? `${m.currentJob.order.fabricType} · ${label(m.type).toLowerCase()} in progress`
                : m.status === 'IDLE'
                  ? 'Free. Pick an order to start.'
                  : m.status === 'BREAKDOWN'
                    ? 'Broken down, waiting for repair.'
                    : 'Under maintenance.'}
          </DialogDescription>
        </DialogHeader>

        {finished ? (
          <NextStage order={finished.order} from={finished.stage} machines={machines} busy={busy} run={run} onLater={onClose} />
        ) : m.currentJob ? (
          <RunningJob m={m} busy={busy} run={run} onFinish={finish} />
        ) : m.status === 'IDLE' ? (
          <AssignOrder m={m} busy={busy} run={run} />
        ) : (
          <Button disabled={busy} onClick={() => setStatus('IDLE', `${m.code} is back in service`)}>
            Back in service
          </Button>
        )}

        {!finished && !isDown(m) && (
          <DialogFooter className="items-center border-t border-border pt-3 sm:justify-start">
            <span className="text-xs text-muted-foreground">Machine problem?</span>
            <Button
              size="xs"
              variant="outline"
              className="text-problem"
              disabled={busy}
              onClick={() => setStatus('BREAKDOWN', m.currentJob ? `${m.code} broke down, job stopped` : `${m.code} marked as broken down`)}
            >
              Breakdown
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => setStatus('MAINTENANCE', m.currentJob ? `${m.code} on maintenance, job stopped` : `${m.code} on maintenance`)}
            >
              Maintenance
            </Button>
          </DialogFooter>
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
  const [roll, setRoll] = useState('')

  return (
    <div className="grid gap-4">
      <div className="space-y-3 rounded-lg border border-border bg-zinc-50 p-3">
        <StageSteps current={m.type} />
        <Progress m={m} />
      </div>

      <form
        onSubmit={async (e: FormEvent) => {
          e.preventDefault()
          if (await run(`/production/jobs/${job.id}/progress`, 'POST', { qty: Number(output) }, `${formatQty(Number(output), unit)} added`)) setOutput('')
        }}
      >
        <Field label={`1. Add output (${unit} made since last time)`} htmlFor="output">
          <div className="flex gap-2">
            <Input id="output" type="number" min="0.01" step="0.01" inputMode="decimal" required value={output} onChange={(e) => setOutput(e.target.value)} />
            <Button type="submit" variant="outline" disabled={busy}>
              Add
            </Button>
          </div>
        </Field>
      </form>

      {/* Finished fabric comes off the dyeing line as rolls, which go to quality check. */}
      {m.type === 'DYEING' && (
        <form
          onSubmit={async (e: FormEvent) => {
            e.preventDefault()
            if (await run('/production/rolls', 'POST', { jobId: job.id, qty: Number(roll) }, 'Roll sent to quality check')) setRoll('')
          }}
        >
          <Field label="2. Roll off the line (length in m)" htmlFor="roll">
            <div className="flex gap-2">
              <Input id="roll" type="number" min="0.01" step="0.01" inputMode="decimal" required value={roll} onChange={(e) => setRoll(e.target.value)} />
              <Button type="submit" variant="outline" disabled={busy}>
                Send to QC
              </Button>
            </div>
          </Field>
        </form>
      )}

      <div className="grid gap-1.5">
        <Button disabled={busy} onClick={onFinish}>
          {next ? `Finish ${label(m.type).toLowerCase()} → send to ${label(next).toLowerCase()}` : 'Finish dyeing'}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          {next ? `Frees ${m.code} and lets you pick a ${label(next).toLowerCase()} machine.` : `Frees ${m.code}. Send every roll to QC first.`}
        </p>
      </div>
    </div>
  )
}

// Straight after a stage is finished: put the order on a free machine of the next stage.
function NextStage({ order, from, machines, busy, run, onLater }: { order: JobOrder; from: Stage; machines: BoardMachine[]; busy: boolean; run: Run; onLater: () => void }) {
  const stage = NEXT_STAGE[from]!
  const free = machines.filter((x) => x.type === stage && x.status === 'IDLE')
  const workers = useApi<Worker[]>('/workers')
  const shift = currentShift()
  const operators = workers.data?.filter((w) => w.isActive && w.shift === shift) ?? []
  const [machineId, setMachineId] = useState('')
  const [workerId, setWorkerId] = useState('')
  const chosen = free.find((x) => x.id === machineId)

  function submit(e: FormEvent) {
    e.preventDefault()
    void run('/production/jobs', 'POST', { orderId: order.id, machineId, shift, workerId, qtyPlanned: order.qty }, `${order.orderNo} started ${label(stage).toLowerCase()} on ${chosen?.code}`, true)
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="rounded-lg border border-border bg-zinc-50 p-3">
        <StageSteps current={from} done />
      </div>
      {free.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No {label(stage).toLowerCase()} machine is free right now. The order waits; assign it from any idle {label(stage).toLowerCase()} machine later.
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
          <Field label={`Operator (${label(shift).toLowerCase()} shift)`} htmlFor="nextWorker">
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
          {free.length === 0 ? 'Close' : 'Later'}
        </Button>
        {free.length > 0 && (
          <Button type="submit" disabled={busy}>
            Start {label(stage).toLowerCase()}
          </Button>
        )}
      </div>
    </form>
  )
}

// Which order statuses can move into each stage.
const READY_FOR: Record<Stage, Order['status'][]> = {
  SPINNING: ['PENDING', 'SPINNING'],
  WEAVING: ['SPINNING', 'WEAVING'],
  DYEING: ['WEAVING', 'DYEING'],
}

function AssignOrder({ m, busy, run }: { m: BoardMachine; busy: boolean; run: Run }) {
  const orders = useApi<Order[]>(recentOrdersPath())
  const workers = useApi<Worker[]>('/workers')
  const [form, setForm] = useState({ orderId: '', shift: currentShift() as string, workerId: '', qtyPlanned: '' })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const eligible = orders.data?.filter((o) => READY_FOR[m.type].includes(o.status)) ?? []
  const operators = workers.data?.filter((w) => w.isActive && w.shift === form.shift) ?? []
  const unit = unitFor(m.type)

  function submit(e: FormEvent) {
    e.preventDefault()
    void run(
      '/production/jobs',
      'POST',
      { orderId: form.orderId, machineId: m.id, shift: form.shift, workerId: form.workerId || undefined, qtyPlanned: Number(form.qtyPlanned) },
      `Job started on ${m.code}`,
      true,
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Order" htmlFor="orderId" hint={!orders.loading && !eligible.length && `No orders waiting for ${label(m.type).toLowerCase()}.`}>
        <select
          id="orderId"
          required
          className={selectClass}
          value={form.orderId}
          onChange={(e) => {
            const o = eligible.find((x) => x.id === e.target.value)
            // Spinning is planned in kg of yarn, weaving and dyeing in metres of fabric.
            setForm((f) => ({ ...f, orderId: e.target.value, qtyPlanned: o ? String(m.type === 'SPINNING' ? o.yarnRequired : o.qty) : '' }))
          }}
        >
          <option value="">Select order…</option>
          {eligible.map((o) => (
            <option key={o.id} value={o.id}>
              {o.orderNo} · {o.fabricType} · {o.buyer.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Shift" htmlFor="shift">
        <select id="shift" className={selectClass} value={form.shift} onChange={(e) => setForm((f) => ({ ...f, shift: e.target.value, workerId: '' }))}>
          {SHIFTS.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Operator" htmlFor="workerId">
        <select id="workerId" required className={selectClass} value={form.workerId} onChange={set('workerId')}>
          <option value="">Select operator…</option>
          {operators.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} · {w.code}
            </option>
          ))}
        </select>
      </Field>
      <Field label={`Planned (${unit})`} htmlFor="qtyPlanned">
        <Input id="qtyPlanned" type="number" min="0.01" step="0.01" inputMode="decimal" required value={form.qtyPlanned} onChange={set('qtyPlanned')} />
      </Field>
      <Button type="submit" disabled={busy}>
        {busy ? 'Starting…' : 'Start job'}
      </Button>
    </form>
  )
}

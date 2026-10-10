import { useState, type FormEvent } from 'react'
import { PageHead } from '@/components/PageHead'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Field, selectClass } from '@/components/Field'
import { StatusPill, label } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatQty, unitFor } from '@/lib/format'
import { mutate, useApi } from '@/lib/useApi'
import { recentOrdersPath } from '@/lib/queries'
import { cn } from '@/lib/utils'
import type { Board, MachineStatus, Order, Shift, Stage } from '@/types'

type BoardMachine = Board['machines'][number]

const STAGES: Stage[] = ['SPINNING', 'WEAVING', 'DYEING']
const SHIFTS: Shift[] = ['MORNING', 'EVENING', 'NIGHT']
const SETTABLE: MachineStatus[] = ['IDLE', 'BREAKDOWN', 'MAINTENANCE']

export function Production() {
  const board = useApi<Board>('/production/board')
  const [assigning, setAssigning] = useState<BoardMachine | null>(null)
  const ms = board.data?.machines ?? []
  const sum = board.data?.summary

  return (
    <div className="space-y-6">
      <PageHead eyebrow="Production floor" title="What every machine is doing" lede="Spinning, weaving and dyeing, shift by shift. Amber is idle, red is down." />
      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard label="Running" tone="good" value={String(sum?.running ?? 0)} loading={board.loading} />
        <KpiCard label="Idle" tone="watch" value={String(sum?.idle ?? 0)} hint="Ready for an order" loading={board.loading} />
        <KpiCard label="Down" tone="problem" value={String((sum?.breakdown ?? 0) + (sum?.maintenance ?? 0))} hint="Breakdown or maintenance" loading={board.loading} />
        <KpiCard
          label="Woven + dyed today"
          value={formatQty(ms.filter((m) => m.type !== 'SPINNING').reduce((a, m) => a + m.producedToday, 0))}
          loading={board.loading}
        />
      </div>

      {board.error && <p className="text-sm text-problem">{board.error}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        {STAGES.map((stage) => (
          <section key={stage} className="space-y-3">
            <h2 className="text-sm font-medium">{label(stage)}</h2>
            {board.loading
              ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36 w-full" />)
              : ms.filter((m) => m.type === stage).map((m) => <MachineCard key={m.id} m={m} onChange={board.reload} onAssign={() => setAssigning(m)} />)}
          </section>
        ))}
      </div>

      <AssignDialog machine={assigning} onClose={() => setAssigning(null)} onSaved={board.reload} />
    </div>
  )
}

function MachineCard({ m, onChange, onAssign }: { m: BoardMachine; onChange: () => void; onAssign: () => void }) {
  const job = m.currentJob
  const unit = unitFor(m.type)
  const [output, setOutput] = useState('')
  const [roll, setRoll] = useState('')
  const pct = job?.percent ?? 0

  async function run(path: string, method: string, body: unknown, msg: string) {
    if (await mutate(path, method, body, msg)) onChange()
  }

  return (
    <div
      className={cn(
        'card space-y-3',
        m.status === 'IDLE' && 'border-watch/40!',
        m.status === 'BREAKDOWN' && 'border-problem/50! bg-problem-bg/60!',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{m.code}</p>
          <p className="text-xs text-muted-foreground">{m.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={m.status} />
          <select
            aria-label={`Set ${m.code} status`}
            className={cn(selectClass, 'h-6 w-auto text-xs')}
            value=""
            onChange={(e) => run(`/machines/${m.id}/status`, 'PATCH', { status: e.target.value }, job ? `${m.code} marked ${label(e.target.value)}, job stopped` : `${m.code} marked ${label(e.target.value)}`)}
          >
            <option value="" disabled>
              Change
            </option>
            {SETTABLE.filter((s) => s !== m.status).map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {job ? (
        <>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="font-medium">
                {job.order.orderNo} · {job.order.fabricType} {job.order.colour}
              </span>
              <span className="text-muted-foreground">{label(job.shift)} shift</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-brand/10">
              <div className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {formatQty(job.qtyProduced, unit)} of {formatQty(job.qtyPlanned, unit)} · {Math.round(pct)}% · today {formatQty(m.producedToday, unit)}
            </p>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              run(`/production/jobs/${job.id}/progress`, 'POST', { qty: Number(output) }, `${formatQty(Number(output), unit)} logged`).then(() => setOutput(''))
            }}
          >
            <Input type="number" min="0" step="0.01" required placeholder={`Produced since last report (${unit})`} value={output} onChange={(e) => setOutput(e.target.value)} aria-label="Produced since last report" />
            <Button type="submit" size="sm" variant="outline">
              Log output
            </Button>
          </form>
          {m.type === 'DYEING' && (
            <form
              className="flex gap-2"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                run('/production/rolls', 'POST', { jobId: job.id, qty: Number(roll) }, 'Roll sent to QC').then(() => setRoll(''))
              }}
            >
              <Input type="number" min="0.01" step="0.01" required placeholder="Roll length (m)" value={roll} onChange={(e) => setRoll(e.target.value)} aria-label="Roll length" />
              <Button type="submit" size="sm" variant="outline">
                Log roll
              </Button>
            </form>
          )}
          <Button size="sm" className="w-full" onClick={() => run(`/production/jobs/${job.id}/complete`, 'POST', undefined, `${job.order.orderNo} done on ${m.code}`)}>
            Complete {label(m.type).toLowerCase()}
          </Button>
        </>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{m.status === 'IDLE' ? 'Sitting idle' : 'Not available'}</p>
          {m.status === 'IDLE' && (
            <Button size="sm" variant="outline" onClick={onAssign}>
              Assign order
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// Which order statuses can move into each stage.
const READY_FOR: Record<Stage, Order['status'][]> = {
  SPINNING: ['PENDING', 'SPINNING'],
  WEAVING: ['SPINNING', 'WEAVING'],
  DYEING: ['WEAVING', 'DYEING'],
}

function AssignDialog({ machine, onClose, onSaved }: { machine: BoardMachine | null; onClose: () => void; onSaved: () => void }) {
  const orders = useApi<Order[]>(machine ? recentOrdersPath() : null)
  const [form, setForm] = useState({ orderId: '', shift: 'MORNING', qtyPlanned: '' })
  const [busy, setBusy] = useState(false)
  if (!machine) return null
  const eligible = orders.data?.filter((o) => READY_FOR[machine.type].includes(o.status)) ?? []
  const unit = unitFor(machine.type)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await mutate('/production/jobs', 'POST', { ...form, machineId: machine!.id, qtyPlanned: Number(form.qtyPlanned) }, `Job started on ${machine!.code}`)
    setBusy(false)
    if (ok) {
      onSaved()
      onClose()
      setForm({ orderId: '', shift: 'MORNING', qtyPlanned: '' })
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Assign {machine.code} · {label(machine.type)}
          </DialogTitle>
        </DialogHeader>
        <form id="assign" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Order" htmlFor="orderId" hint={!orders.loading && !eligible.length && `No orders waiting for ${label(machine.type).toLowerCase()}.`}>
              <select
                id="orderId"
                required
                className={selectClass}
                value={form.orderId}
                onChange={(e) => {
                  const o = eligible.find((x) => x.id === e.target.value)
                  setForm({ ...form, orderId: e.target.value, qtyPlanned: o ? String(machine.type === 'SPINNING' ? o.yarnRequired : o.qty) : '' })
                }}
              >
                <option value="">Select…</option>
                {eligible.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNo} · {o.fabricType} {o.colour} · {label(o.status)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Shift" htmlFor="shift">
            <select id="shift" className={selectClass} value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })}>
              {SHIFTS.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Planned (${unit})`} htmlFor="qtyPlanned">
            <Input id="qtyPlanned" type="number" min="0.01" step="0.01" required value={form.qtyPlanned} onChange={(e) => setForm({ ...form, qtyPlanned: e.target.value })} />
          </Field>
        </form>
        <DialogFooter>
          <Button type="submit" form="assign" disabled={busy}>
            {busy ? 'Starting…' : 'Start job'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

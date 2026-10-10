import { useState } from 'react'
import { StatusPill } from '@/components/StatusPill'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, formatQty } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import type { QCResult, RollStatus, Shift, Stage } from '@/types'

// GET /qc/rolls/:id: one roll with everything it can be traced back to.
interface RollDetail {
  id: string
  rollNo: string
  qty: number
  status: RollStatus
  createdAt: string
  order: { orderNo: string; fabricType: string; colour: string | null; buyer: { name: string } }
  machine: { code: string; name: string }
  job: { stage: Stage; shift: Shift; startedAt: string; completedAt: string | null; worker: { code: string; name: string } | null } | null
  dispatch: { dispatchNo: string; dispatchedAt: string } | null
  reworkStage?: Stage | null
  replacementOrder?: { id: string; orderNo: string } | null
  qcRecords: { id: string; result: QCResult; defectType: string | null; notes: string | null; checkedAt: string; inspector: { name: string } }[]
}

// A roll number that opens the roll's full trace: order, machine, shift and worker, every
// inspection in order (rework and re-checks included), and the truck it left on.
export function RollLink({ id, rollNo }: { id: string; rollNo: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="font-medium text-brand underline-offset-2 hover:underline" onClick={() => setOpen(true)}>
        {rollNo}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">{open && <Trace id={id} />}</SheetContent>
      </Sheet>
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase()
// How each result reads, and the colours it carries.
const VERDICT: Record<QCResult, { word: string; box: string; dot: string }> = {
  PASS: { word: 'Passed', box: 'bg-good-bg text-good', dot: 'bg-good' },
  REWORK: { word: 'Sent for rework', box: 'bg-watch-bg text-watch', dot: 'bg-watch' },
  REJECT: { word: 'Rejected', box: 'bg-problem-bg text-problem', dot: 'bg-problem' },
}

function Trace({ id }: { id: string }) {
  const { data: r, loading, error } = useApi<RollDetail>(`/qc/rolls/${id}`)
  if (loading) return <Skeleton className="m-6 h-64" />
  if (error || !r) return <p className="m-6 text-sm text-problem">{error ?? 'Roll not found.'}</p>
  const checks = [...r.qcRecords].sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))
  const last = checks[checks.length - 1]
  // What happened to the roll after its last check.
  const next =
    r.status === 'DISPATCHED' && r.dispatch
      ? `Shipped on ${r.dispatch.dispatchNo}, ${formatDateTime(r.dispatch.dispatchedAt)}.`
      : r.status === 'PASSED'
        ? 'In the store, ready for dispatch.'
        : r.status === 'REJECTED'
          ? `Written off as waste.${r.replacementOrder ? ` ${r.replacementOrder.orderNo} was raised to make it again.` : ''}`
          : r.status === 'REWORK'
            ? `Its fabric went back to ${r.reworkStage ? r.reworkStage.toLowerCase() : 'the floor'} to be made again.`
            : null

  return (
    <div className="space-y-5 p-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="section-head">{r.rollNo}</h2>
          <StatusPill status={r.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatQty(r.qty)} · made {formatDateTime(r.createdAt)}
        </p>
      </div>

      {/* The verdict first: what was decided, by whom, when and why. */}
      {last ? (
        <div className={cn('space-y-1 rounded-xl px-4 py-3', VERDICT[last.result].box)}>
          <p className="text-sm font-semibold">
            {VERDICT[last.result].word} by {last.inspector.name}
          </p>
          <p className="text-xs opacity-90">{formatDateTime(last.checkedAt)}</p>
          {last.defectType && <p className="pt-1 text-sm">Reason: {last.defectType}</p>}
          {last.notes && <p className="text-xs opacity-90">“{last.notes}”</p>}
        </div>
      ) : (
        <div className="rounded-xl bg-zinc-50 px-4 py-3 text-sm text-ink-2">Not checked yet. It is waiting in Quality check.</div>
      )}
      {next && <p className="-mt-2 text-sm text-ink-2">{next}</p>}

      <div>
        <h3 className="text-sm font-medium">Where it came from</h3>
        <dl className="mt-1 divide-y divide-border">
          <Row label="Order">{r.order.orderNo}</Row>
          <Row label="Buyer">{r.order.buyer.name}</Row>
          <Row label="Fabric">{[r.order.fabricType, r.order.colour].filter(Boolean).join(' · ')}</Row>
          <Row label="Machine">
            {r.machine.code} · {r.machine.name}
          </Row>
          {r.job && (
            <>
              <Row label="Operator">{r.job.worker ? `${r.job.worker.name} (${r.job.worker.code})` : '—'}</Row>
              <Row label="Shift">{title(r.job.shift)}</Row>
            </>
          )}
        </dl>
      </div>

      {checks.length > 1 && (
        <div>
          <h3 className="text-sm font-medium">Every check</h3>
          <ol className="mt-3">
            {checks.map((q, i) => (
              <li key={q.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={cn('mt-1.5 size-2.5 rounded-full', VERDICT[q.result].dot)} />
                  {i < checks.length - 1 && <span className="w-px flex-1 bg-line" />}
                </div>
                <div className="pb-4 text-sm leading-tight">
                  <p>
                    <span className="font-medium">{VERDICT[q.result].word}</span> by {q.inspector.name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDateTime(q.checkedAt)}
                    {q.defectType ? ` · ${q.defectType}` : ''}
                  </p>
                  {q.notes && <p className="mt-0.5 text-xs text-muted-foreground">“{q.notes}”</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

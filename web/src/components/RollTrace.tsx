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
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

function Trace({ id }: { id: string }) {
  const { data: r, loading, error } = useApi<RollDetail>(`/qc/rolls/${id}`)
  if (loading) return <Skeleton className="m-6 h-64" />
  if (error || !r) return <p className="m-6 text-sm text-problem">{error ?? 'Roll not found.'}</p>
  const checks = [...r.qcRecords].sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))

  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="eyebrow">Roll trace</p>
        <div className="mt-1 flex items-center gap-2">
          <h2 className="section-head">{r.rollNo}</h2>
          <StatusPill status={r.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatQty(r.qty)} · made {formatDateTime(r.createdAt)}
        </p>
      </div>

      <dl className="divide-y">
        <Row label="Order">
          {r.order.orderNo} · {r.order.buyer.name}
        </Row>
        <Row label="Fabric">{[r.order.fabricType, r.order.colour].filter(Boolean).join(' · ')}</Row>
        <Row label="Machine">
          {r.machine.code} · {r.machine.name}
        </Row>
        {r.job && (
          <>
            <Row label="Stage and shift">
              {r.job.stage.charAt(0) + r.job.stage.slice(1).toLowerCase()} · {r.job.shift.charAt(0) + r.job.shift.slice(1).toLowerCase()} shift
            </Row>
            <Row label="Operator">{r.job.worker ? `${r.job.worker.name} (${r.job.worker.code})` : '—'}</Row>
          </>
        )}
        <Row label="Dispatch">{r.dispatch ? `${r.dispatch.dispatchNo} · ${formatDateTime(r.dispatch.dispatchedAt)}` : 'Not shipped yet'}</Row>
      </dl>

      <div>
        <h3 className="text-sm font-medium">Inspections</h3>
        {checks.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Waiting for its first check.</p>
        ) : (
          <ol className="mt-3 space-y-0">
            {checks.map((q, i) => (
              <li key={q.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      'mt-1 size-2.5 rounded-full',
                      q.result === 'PASS' ? 'bg-good' : q.result === 'REWORK' ? 'bg-watch' : 'bg-problem',
                    )}
                  />
                  {i < checks.length - 1 && <span className="w-px flex-1 bg-line" />}
                </div>
                <div className="pb-4 text-sm">
                  <div className="flex items-center gap-2">
                    <StatusPill status={q.result} />
                    <span className="text-xs text-muted-foreground">{formatDateTime(q.checkedAt)}</span>
                  </div>
                  <p className="mt-1">
                    {q.defectType ?? 'No defect'} · by {q.inspector.name}
                  </p>
                  {q.notes && <p className="text-xs text-muted-foreground">{q.notes}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

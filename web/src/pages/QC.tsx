import { useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { ClipboardCheck } from 'lucide-react'
import { PageHead } from '@/components/PageHead'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Field, selectClass } from '@/components/Field'
import { StatusPill } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime, formatQty } from '@/lib/format'
import { mutate, useApi, usePaged } from '@/lib/useApi'
import { LoadMore } from '@/components/LoadMore'
import { RollLink } from '@/components/RollTrace'
import type { QCRecord, QCResult, QcSummary, Roll } from '@/types'

type LogRow = QCRecord & { roll: Roll }

const DEFECTS = ['Holes', 'Colour mismatch', 'Uneven weaving', 'Stains', 'Broken ends', 'Other']

const historyCols: ColumnDef<LogRow>[] = [
  { id: 'when', header: 'Checked', accessorKey: 'checkedAt', cell: ({ getValue }) => formatDateTime(getValue<string>()) },
  { id: 'roll', header: 'Roll', accessorFn: (q) => q.roll.rollNo, cell: ({ row: { original: q } }) => <RollLink id={q.roll.id} rollNo={q.roll.rollNo} /> },
  { id: 'order', header: 'Order', accessorFn: (q) => q.roll.order.orderNo },
  { id: 'machine', header: 'Machine', accessorFn: (q) => q.roll.machine.code },
  { accessorKey: 'result', header: 'Result', cell: ({ row: { original: q } }) => <StatusPill status={q.result} /> },
  { id: 'defect', header: 'Defect', accessorFn: (q) => q.defectType ?? '—' },
  { id: 'inspector', header: 'Inspector', accessorFn: (q) => q.inspector.name },
]

export function QC() {
  // The queue is two filtered calls; totals come from /qc/summary; the log pages through recent rolls.
  const pending = useApi<Roll[]>('/qc/rolls?status=PENDING_QC&limit=500')
  const rework = useApi<Roll[]>('/qc/rolls?status=REWORK&limit=500')
  const summary = useApi<QcSummary>('/qc/summary')
  const recent = usePaged<Roll>('/qc/rolls', 60)
  const waiting = [...(rework.data ?? []), ...(pending.data ?? [])]
  const history = recent.rows
    .flatMap((roll) => roll.qcRecords.map((q) => ({ ...q, roll })))
    .sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1))
  const [defectFor, setDefectFor] = useState<{ roll: Roll; result: QCResult } | null>(null)
  const reload = () => {
    pending.reload()
    rework.reload()
    summary.reload()
    recent.reload()
  }
  const counts = summary.data?.counts

  async function pass(roll: Roll) {
    if (await mutate(`/qc/rolls/${roll.id}/inspect`, 'POST', { result: 'PASS' }, `${roll.rollNo} passed`)) reload()
  }

  const waitingCols: ColumnDef<Roll>[] = [
    { accessorKey: 'rollNo', header: 'Roll', cell: ({ row: { original: r } }) => <RollLink id={r.id} rollNo={r.rollNo} /> },
    { id: 'order', header: 'Order', accessorFn: (r) => `${r.order.orderNo} · ${r.order.fabricType} ${r.order.colour}` },
    { id: 'machine', header: 'Machine', accessorFn: (r) => r.machine.code },
    { id: 'qty', header: 'Length', accessorFn: (r) => r.qty, cell: ({ row: { original: r } }) => formatQty(r.qty) },
    { accessorKey: 'status', header: 'Status', cell: ({ row: { original: r } }) => <StatusPill status={r.status} /> },
    {
      id: 'act',
      header: '',
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <div className="flex justify-end gap-1">
          <Button size="xs" className="bg-good text-white hover:bg-good/90" onClick={() => pass(r)}>
            Pass
          </Button>
          <Button size="xs" variant="outline" onClick={() => setDefectFor({ roll: r, result: 'REWORK' })}>
            Rework
          </Button>
          <Button size="xs" variant="destructive" onClick={() => setDefectFor({ roll: r, result: 'REJECT' })}>
            Reject
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHead eyebrow="Quality" title="Before it leaves the line" lede="Each roll is traced to its order and machine, so a defect leads back to its cause." />
      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard label="Waiting for check" tone="watch" value={String(waiting.length)} loading={pending.loading || rework.loading} />
        <KpiCard
          label="Pass rate"
          tone="good"
          value={summary.data?.passRate == null ? '—' : `${summary.data.passRate}%`}
          hint={counts && `${(counts.PASSED + counts.DISPATCHED).toLocaleString('en-IN')} rolls passed`}
          loading={summary.loading}
        />
        <KpiCard label="In rework" tone="watch" value={String(counts?.REWORK ?? 0)} loading={summary.loading} />
        <KpiCard
          label="Rejected"
          tone="problem"
          value={(counts?.REJECTED ?? 0).toLocaleString('en-IN')}
          hint={summary.data?.defectsByType.slice().sort((a, b) => b.count - a.count)[0] && `Most common: ${summary.data.defectsByType.slice().sort((a, b) => b.count - a.count)[0].defectType}`}
          loading={summary.loading}
        />
      </div>

      <section className="space-y-3">
        <h2 className="section-head">Waiting for check</h2>
        <DataTable
          columns={waitingCols}
          data={waiting}
          loading={pending.loading || rework.loading}
          empty={<EmptyState icon={ClipboardCheck} line="No rolls waiting. Nice." />}
        />
      </section>

      <section className="space-y-3">
        <h2 className="section-head">QC log</h2>
        <DataTable columns={historyCols} data={history} loading={recent.loading} />
        <LoadMore hasMore={recent.hasMore} more={recent.more} />
      </section>

      <DefectDialog target={defectFor} onClose={() => setDefectFor(null)} onSaved={reload} />
    </div>
  )
}

function DefectDialog({ target, onClose, onSaved }: { target: { roll: Roll; result: QCResult } | null; onClose: () => void; onSaved: () => void }) {
  const [defectType, setDefectType] = useState('')
  const [notes, setNotes] = useState('')
  if (!target) return null
  const verb = target.result === 'REWORK' ? 'Rework' : 'Reject'

  async function submit(e: FormEvent) {
    e.preventDefault()
    const ok = await mutate(`/qc/rolls/${target!.roll.id}/inspect`, 'POST', { result: target!.result, defectType, notes: notes || undefined }, `${target!.roll.rollNo}: ${verb.toLowerCase()}`)
    if (ok) {
      onSaved()
      onClose()
      setDefectType('')
      setNotes('')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {verb} {target.roll.rollNo}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {target.roll.order.orderNo} · made on {target.roll.machine.code}
        </p>
        <form id="defect" onSubmit={submit} className="space-y-4">
          <Field label="Defect" htmlFor="defectType">
            <select id="defectType" required className={selectClass} value={defectType} onChange={(e) => setDefectType(e.target.value)}>
              <option value="">Select…</option>
              {DEFECTS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
          <Field label="Notes" htmlFor="notes">
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </form>
        <DialogFooter>
          <Button type="submit" form="defect" variant={target.result === 'REJECT' ? 'destructive' : 'default'}>
            {verb} roll
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

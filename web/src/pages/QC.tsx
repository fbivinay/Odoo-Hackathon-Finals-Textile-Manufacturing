import { useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { ClipboardCheck } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Field, selectClass } from '@/components/Field'
import { StatusPill } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime, formatQty } from '@/lib/format'
import { mutate, useApi } from '@/lib/useApi'
import type { QCRecord, QCResult, Roll } from '@/types'

const DEFECTS = ['Holes', 'Colour mismatch', 'Uneven weaving', 'Stains', 'Broken ends', 'Other']

const historyCols: ColumnDef<QCRecord>[] = [
  { id: 'when', header: 'Checked', accessorKey: 'checkedAt', cell: ({ getValue }) => formatDateTime(getValue<string>()) },
  { id: 'roll', header: 'Roll', accessorFn: (q) => q.roll.rollNo },
  { id: 'order', header: 'Order', accessorFn: (q) => q.roll.order.orderNo },
  { id: 'machine', header: 'Machine', accessorFn: (q) => q.roll.machine.code },
  { accessorKey: 'result', header: 'Result', cell: ({ row: { original: q } }) => <StatusPill status={q.result} /> },
  { id: 'defect', header: 'Defect', accessorFn: (q) => q.defectType ?? '—' },
  { id: 'inspector', header: 'Inspector', accessorFn: (q) => q.inspector.name },
]

export function QC() {
  const waiting = useApi<Roll[]>('/rolls?status=PENDING_QC,REWORK')
  const history = useApi<QCRecord[]>('/qc')
  const [defectFor, setDefectFor] = useState<{ roll: Roll; result: QCResult } | null>(null)
  const reload = () => {
    waiting.reload()
    history.reload()
  }
  const count = (r: QCResult) => history.data?.filter((q) => q.result === r).length ?? 0

  async function pass(roll: Roll) {
    if (await mutate('/qc', 'POST', { rollId: roll.id, result: 'PASS' }, `${roll.rollNo} passed`)) reload()
  }

  const waitingCols: ColumnDef<Roll>[] = [
    { accessorKey: 'rollNo', header: 'Roll' },
    { id: 'order', header: 'Order', accessorFn: (r) => `${r.order.orderNo} · ${r.order.fabricType} ${r.order.colour}` },
    { id: 'machine', header: 'Machine', accessorFn: (r) => r.machine.code },
    { id: 'qty', header: 'Length', accessorFn: (r) => Number(r.qty), cell: ({ row: { original: r } }) => formatQty(r.qty) },
    { accessorKey: 'status', header: 'Status', cell: ({ row: { original: r } }) => <StatusPill status={r.status} /> },
    {
      id: 'act',
      header: '',
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <div className="flex justify-end gap-1">
          <Button size="xs" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => pass(r)}>
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
      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard label="Waiting for check" value={<span className="text-amber-600">{waiting.data?.length ?? 0}</span>} loading={waiting.loading} />
        <KpiCard label="Passed" value={<span className="text-emerald-600">{count('PASS')}</span>} loading={history.loading} />
        <KpiCard label="Rework" value={<span className="text-violet-600">{count('REWORK')}</span>} loading={history.loading} />
        <KpiCard label="Rejected" value={<span className="text-rose-600">{count('REJECT')}</span>} loading={history.loading} />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Waiting for check</h2>
        <DataTable
          columns={waitingCols}
          data={waiting.data ?? []}
          loading={waiting.loading}
          empty={<EmptyState icon={ClipboardCheck} line="No rolls waiting. Nice." />}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">QC log</h2>
        <DataTable columns={historyCols} data={history.data ?? []} loading={history.loading} />
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
    const ok = await mutate('/qc', 'POST', { rollId: target!.roll.id, result: target!.result, defectType, notes }, `${target!.roll.rollNo}: ${verb.toLowerCase()}`)
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

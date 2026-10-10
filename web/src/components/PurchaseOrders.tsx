import { useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PackageCheck } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Field } from '@/components/Field'
import { LoadMore } from '@/components/LoadMore'
import { Pill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatDateTime, formatINR, formatQty, toISODate } from '@/lib/format'
import type { PurchaseOrder } from '@/types'

// Expected when ordered + the supplier's delivery days (Config, per material).
function Due({ po }: { po: PurchaseOrder }) {
  const due = toISODate(new Date(Date.parse(po.orderedAt) + (po.material.leadDays ?? 7) * 86400000))
  const late = due < toISODate(new Date())
  return <span className={late ? 'text-xs font-medium text-problem' : 'text-xs text-muted-foreground'}>{late ? `Overdue since ${formatDate(due)}` : `Due ${formatDate(due)}`}</span>
}

const name = (m: PurchaseOrder['material']) => (m.colour ? `${m.yarnType} · ${m.colour}` : m.yarnType)
const STATUS = { PENDING: ['watch', 'Pending'], RECEIVED: ['good', 'Received'], CANCELLED: ['neutral', 'Cancelled'] } as const

// Orders placed with suppliers. Stock only goes up when the store presses Received.
export function PurchaseOrders({
  rows,
  loading,
  hasMore,
  more,
  canEdit,
  onChanged,
}: {
  rows: PurchaseOrder[]
  loading: boolean
  hasMore: boolean
  more: () => Promise<void>
  canEdit: boolean
  onChanged: () => void
}) {
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function cancel(po: PurchaseOrder) {
    setBusy(po.id)
    try {
      await api(`/materials/purchase-orders/${po.id}/cancel`, { method: 'POST' })
      toast.success(`${po.poNo} cancelled`)
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  const cols: ColumnDef<PurchaseOrder>[] = [
    { accessorKey: 'poNo', header: 'PO', cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
    { id: 'when', header: 'Ordered', accessorKey: 'orderedAt', cell: ({ getValue }) => formatDateTime(getValue<string>()) },
    { id: 'item', header: 'Item', accessorFn: (p) => name(p.material) },
    { id: 'supplier', header: 'Supplier', accessorFn: (p) => p.supplier.name },
    { id: 'qty', header: 'Qty', accessorFn: (p) => p.qty, cell: ({ row: { original: p } }) => <span className="tabular-nums">{formatQty(p.qty, p.material.unit)}</span> },
    { id: 'amount', header: 'Amount', accessorFn: (p) => p.qty * p.rate, cell: ({ getValue }) => <span className="tabular-nums">{formatINR(getValue<number>())}</span> },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      cell: ({ row: { original: p } }) => (
        <span className="inline-flex flex-col">
          <Pill tone={STATUS[p.status][0]}>{STATUS[p.status][1]}</Pill>
          {p.receivedAt && <span className="text-xs text-muted-foreground">{formatDateTime(p.receivedAt)}</span>}
          {p.status === 'PENDING' && <Due po={p} />}
        </span>
      ),
    },
    {
      id: 'action',
      header: '',
      enableSorting: false,
      cell: ({ row: { original: p } }) =>
        canEdit &&
        p.status === 'PENDING' && (
          <div className="flex justify-end gap-1">
            <Button size="xs" variant="ghost" disabled={busy === p.id} onClick={() => cancel(p)}>
              Cancel
            </Button>
            <Button size="xs" className="gap-1" onClick={() => setReceiving(p)}>
              <PackageCheck className="size-3.5" />
              Received
            </Button>
          </div>
        ),
    },
  ]

  // Pending first, then newest.
  const sorted = [...rows].sort((a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING'))

  return (
    <>
      <DataTable columns={cols} data={sorted} loading={loading} empty={<EmptyState icon={PackageCheck} line="No orders placed yet. Use Order all short to place one." />} />
      <LoadMore hasMore={hasMore} more={more} />
      {receiving && <ReceiveDialog po={receiving} onClose={() => setReceiving(null)} onSaved={onChanged} />}
    </>
  )
}

// What actually arrived can differ from what was ordered, so both are editable.
function ReceiveDialog({ po, onClose, onSaved }: { po: PurchaseOrder; onClose: () => void; onSaved: () => void }) {
  const [qty, setQty] = useState(String(po.qty))
  const [rate, setRate] = useState(String(po.rate))
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const saved = await api<{ issuedTo?: { orderNo: string }[] }>(`/materials/purchase-orders/${po.id}/receive`, { method: 'POST', body: { qty: Number(qty), rate: Number(rate) } })
      const waiting = saved.issuedTo?.length ?? 0
      toast.success(`${po.poNo} received, added to stock`, { description: waiting ? `Issued to ${waiting} waiting order${waiting > 1 ? 's' : ''}.` : undefined })
      onSaved()
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
          <DialogTitle>Receive {po.poNo}</DialogTitle>
          <DialogDescription>
            {name(po.material)} from {po.supplier.name}. Check what arrived before adding it to stock.
          </DialogDescription>
        </DialogHeader>
        <form id="receive-po" onSubmit={submit} className="grid gap-4">
          <Field label={`Quantity received (${po.material.unit})`} htmlFor="po-qty">
            <Input id="po-qty" type="number" min="0.01" step="0.01" required autoFocus value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label={`Rate (₹/${po.material.unit})`} htmlFor="po-rate">
            <Input id="po-rate" type="number" min="0.01" step="0.01" required value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
        </form>
        <DialogFooter className="items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Bill: {formatINR(Number(qty) * Number(rate) || 0)}</p>
          <Button type="submit" form="receive-po" disabled={busy}>
            {busy ? 'Saving…' : 'Add to stock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

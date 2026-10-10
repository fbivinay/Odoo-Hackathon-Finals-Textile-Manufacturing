import { useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PackageOpen, Printer, Truck } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Field, selectClass } from '@/components/Field'
import { StatusPill } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatDate, formatINR, formatQty } from '@/lib/format'
import { mutate, useApi } from '@/lib/useApi'
import type { Dispatch as DispatchRow, Invoice, Roll } from '@/types'

const paidOf = (inv: Invoice) => inv.payments.reduce((a, p) => a + Number(p.amount), 0)

export function Dispatch() {
  const shelf = useApi<Roll[]>('/rolls?status=PASSED')
  const dispatches = useApi<DispatchRow[]>('/dispatches')
  const [invoiceOf, setInvoiceOf] = useState<DispatchRow | null>(null)
  const [paying, setPaying] = useState<DispatchRow | null>(null)
  const reload = () => {
    shelf.reload()
    dispatches.reload()
  }

  // Passed rolls grouped by order — the finished-goods shelf.
  const byOrder = new Map<string, Roll[]>()
  for (const r of shelf.data ?? []) byOrder.set(r.orderId, [...(byOrder.get(r.orderId) ?? []), r])
  const outstanding = (dispatches.data ?? []).reduce((a, d) => a + (d.invoice ? Number(d.invoice.amount) - paidOf(d.invoice) : 0), 0)

  const columns: ColumnDef<DispatchRow>[] = [
    { accessorKey: 'dispatchNo', header: 'Dispatch' },
    { id: 'date', header: 'Date', accessorFn: (d) => d.dispatchedAt, cell: ({ row: { original: d } }) => formatDate(d.dispatchedAt) },
    { id: 'buyer', header: 'Buyer', accessorFn: (d) => d.buyer.name },
    { id: 'order', header: 'Order', accessorFn: (d) => d.order.orderNo },
    { id: 'rolls', header: 'Rolls', accessorFn: (d) => `${d.rolls.length} · ${formatQty(d.rolls.reduce((a, r) => a + Number(r.qty), 0))}` },
    { id: 'vehicle', header: 'Vehicle', accessorFn: (d) => d.vehicleNo ?? '—' },
    { id: 'amount', header: 'Invoice', accessorFn: (d) => Number(d.invoice?.amount ?? 0), cell: ({ row: { original: d } }) => (d.invoice ? formatINR(d.invoice.amount) : '—') },
    { id: 'status', header: 'Payment', cell: ({ row: { original: d } }) => d.invoice && <StatusPill status={d.invoice.status} /> },
    {
      id: 'act',
      header: '',
      enableSorting: false,
      cell: ({ row: { original: d } }) => (
        <div className="flex justify-end gap-1">
          <Button size="xs" variant="ghost" className="gap-1" onClick={() => setInvoiceOf(d)}>
            <Printer className="size-3" />
            Invoice
          </Button>
          {d.invoice && d.invoice.status !== 'PAID' && (
            <Button size="xs" variant="outline" onClick={() => setPaying(d)}>
              Record payment
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Finished fabric on shelf"
          value={formatQty((shelf.data ?? []).reduce((a, r) => a + Number(r.qty), 0))}
          hint={`${shelf.data?.length ?? 0} passed rolls`}
          loading={shelf.loading}
        />
        <KpiCard label="Dispatches" value={dispatches.data?.length ?? 0} loading={dispatches.loading} />
        <KpiCard label="Outstanding from buyers" value={formatINR(outstanding)} loading={dispatches.loading} />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Ready to load</h2>
        {!shelf.loading && byOrder.size === 0 ? (
          <div className="rounded-lg border bg-card">
            <EmptyState icon={PackageOpen} line="No passed rolls on the shelf." />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {[...byOrder.values()].map((rolls) => (
              <LoadCard key={rolls[0].orderId} rolls={rolls} onDone={reload} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Dispatched</h2>
        <DataTable columns={columns} data={dispatches.data ?? []} loading={dispatches.loading} />
      </section>

      {invoiceOf && <InvoiceDialog d={invoiceOf} onClose={() => setInvoiceOf(null)} />}
      {paying && <PaymentDialog d={paying} onClose={() => setPaying(null)} onSaved={dispatches.reload} />}
    </div>
  )
}

function LoadCard({ rolls, onDone }: { rolls: Roll[]; onDone: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rolls.map((r) => r.id)))
  const [vehicleNo, setVehicleNo] = useState('')
  const [busy, setBusy] = useState(false)
  const o = rolls[0].order
  const qty = rolls.filter((r) => picked.has(r.id)).reduce((a, r) => a + Number(r.qty), 0)

  function toggle(id: string) {
    const next = new Set(picked)
    if (!next.delete(id)) next.add(id)
    setPicked(next)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await mutate('/dispatches', 'POST', { orderId: rolls[0].orderId, rollIds: [...picked], vehicleNo }, `${o.orderNo} dispatched, invoice raised`)
    setBusy(false)
    if (ok) onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border bg-white p-4 shadow-sm">
      <div>
        <p className="text-sm font-medium">{o.orderNo}</p>
        <p className="text-xs text-muted-foreground">
          {o.fabricType} · {o.colour}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {rolls.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs has-checked:border-indigo-300 has-checked:bg-indigo-50">
            <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
            {r.rollNo} · {formatQty(r.qty)}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Input placeholder="Vehicle no." value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} aria-label="Vehicle number" />
        <Button type="submit" size="sm" className="shrink-0 gap-1.5" disabled={busy || picked.size === 0}>
          <Truck className="size-4" />
          Dispatch {formatQty(qty)}
        </Button>
      </div>
    </form>
  )
}

function InvoiceDialog({ d, onClose }: { d: DispatchRow; onClose: () => void }) {
  const inv = d.invoice
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="print-area sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tax invoice {inv?.invoiceNo}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">From</p>
            <p className="font-medium">Everest Textile Mills</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Bill to</p>
            <p className="font-medium">{d.buyer.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Dispatch</p>
            <p>
              {d.dispatchNo} · {formatDate(d.dispatchedAt)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Vehicle</p>
            <p>{d.vehicleNo ?? '—'}</p>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-medium">Roll</th>
              <th className="py-1 text-left font-medium">Item</th>
              <th className="py-1 text-right font-medium">Qty</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.rolls.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="py-1">{r.rollNo}</td>
                <td className="py-1">
                  {d.order.fabricType} {d.order.colour} @ {formatINR(d.order.pricePerUnit)}/m
                </td>
                <td className="py-1 text-right tabular-nums">{formatQty(r.qty)}</td>
                <td className="py-1 text-right tabular-nums">{formatINR(Number(r.qty) * Number(d.order.pricePerUnit))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {inv && (
          <div className="space-y-1 text-right text-sm">
            <p className="font-medium">Total {formatINR(inv.amount)}</p>
            <p className="text-muted-foreground">
              Paid {formatINR(paidOf(inv))} · <StatusPill status={inv.status} />
            </p>
          </div>
        )}
        <DialogFooter className="print:hidden">
          <Button className="gap-1.5" onClick={() => window.print()}>
            <Printer className="size-4" />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PaymentDialog({ d, onClose, onSaved }: { d: DispatchRow; onClose: () => void; onSaved: () => void }) {
  const inv = d.invoice!
  const due = Number(inv.amount) - paidOf(inv)
  const [amount, setAmount] = useState(String(due))
  const [method, setMethod] = useState('NEFT')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (await mutate(`/invoices/${inv.id}/payments`, 'POST', { amount: Number(amount), method }, 'Payment recorded')) {
      onSaved()
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Payment for {inv.invoiceNo}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {d.buyer.name} · due {formatINR(due)}
        </p>
        <form id="pay" onSubmit={submit} className="grid grid-cols-2 gap-4">
          <Field label="Amount (₹)" htmlFor="amount">
            <Input id="amount" type="number" min="1" max={due} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Method" htmlFor="method">
            <select id="method" className={selectClass} value={method} onChange={(e) => setMethod(e.target.value)}>
              {['NEFT', 'RTGS', 'UPI', 'Cheque', 'Cash'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
        </form>
        <DialogFooter>
          <Button type="submit" form="pay">
            Save payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

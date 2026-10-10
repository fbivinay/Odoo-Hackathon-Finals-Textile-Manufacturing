import { useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { ClipboardList, PackageOpen, Printer, Truck } from 'lucide-react'
import { PageHead } from '@/components/PageHead'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Field, selectClass } from '@/components/Field'
import { StatusPill } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatDate, formatINR, formatQty } from '@/lib/format'
import { mutate, useApi, usePaged } from '@/lib/useApi'
import { LoadMore } from '@/components/LoadMore'
import type { Dispatch as DispatchRow, ShelfStock } from '@/types'

type ShelfGroup = ShelfStock['orders'][number]

export function Dispatch() {
  const shelf = useApi<ShelfStock>('/dispatch/stock')
  const dispatches = usePaged<DispatchRow>('/dispatch')
  const open = useApi<{ balance: number }[]>('/invoices?status=UNPAID&limit=500')
  const partial = useApi<{ balance: number }[]>('/invoices?status=PARTIAL&limit=500')
  const [invoiceOf, setInvoiceOf] = useState<DispatchRow | null>(null)
  const [paying, setPaying] = useState<DispatchRow | null>(null)
  const reload = () => {
    shelf.reload()
    dispatches.reload()
    open.reload()
    partial.reload()
  }

  const groups = shelf.data?.orders ?? []
  const outstanding = [...(open.data ?? []), ...(partial.data ?? [])].reduce((a, i) => a + i.balance, 0)

  const columns: ColumnDef<DispatchRow>[] = [
    { accessorKey: 'dispatchNo', header: 'Dispatch' },
    { id: 'date', header: 'Date', accessorFn: (d) => d.dispatchedAt, cell: ({ row: { original: d } }) => formatDate(d.dispatchedAt) },
    { id: 'buyer', header: 'Buyer', accessorFn: (d) => d.buyer.name },
    { id: 'order', header: 'Order', accessorFn: (d) => d.order.orderNo },
    { id: 'rolls', header: 'Rolls', accessorFn: (d) => `${d.rolls.length} · ${formatQty(d.totalQty)}` },
    { id: 'vehicle', header: 'Vehicle', accessorFn: (d) => d.vehicleNo ?? '—' },
    { id: 'amount', header: 'Invoice', accessorFn: (d) => d.invoice?.amount ?? 0, cell: ({ row: { original: d } }) => (d.invoice ? formatINR(d.invoice.amount) : '—') },
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
      <PageHead eyebrow="Dispatch" title="Loading the truck" lede="Only passed rolls can go, each one once, with an invoice that matches what left." />
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Finished fabric on shelf"
          value={formatQty(shelf.data?.totalQty ?? 0)}
          hint={`${shelf.data?.totalRolls ?? 0} passed rolls`}
          loading={shelf.loading}
        />
        <KpiCard label="Invoices awaiting payment" tone="watch" value={String((open.data?.length ?? 0) + (partial.data?.length ?? 0))} loading={open.loading} />
        <KpiCard label="Outstanding from buyers" value={formatINR(outstanding)} loading={open.loading || partial.loading} />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Ready to load</h2>
        {!shelf.loading && groups.length === 0 ? (
          <div className="rounded-lg border bg-card">
            <EmptyState icon={PackageOpen} line="No passed rolls on the shelf." />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {groups.map((g) => (
              <LoadCard key={g.order.id} group={g} onDone={reload} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Dispatched</h2>
        <DataTable columns={columns} data={dispatches.rows} loading={dispatches.loading} />
        <LoadMore hasMore={dispatches.hasMore} more={dispatches.more} />
      </section>

      {invoiceOf && <InvoiceDialog d={invoiceOf} onClose={() => setInvoiceOf(null)} />}
      {paying && <PaymentDialog d={paying} onClose={() => setPaying(null)} onSaved={reload} />}
    </div>
  )
}

function LoadCard({ group, onDone }: { group: ShelfGroup; onDone: () => void }) {
  const { order: o, rolls } = group
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rolls.map((r) => r.id)))
  const [confirming, setConfirming] = useState(false)
  const qty = rolls.filter((r) => picked.has(r.id)).reduce((a, r) => a + r.qty, 0)

  function toggle(id: string) {
    const next = new Set(picked)
    if (!next.delete(id)) next.add(id)
    setPicked(next)
  }

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4 shadow-sm">
      <div>
        <p className="text-sm font-medium">
          {o.orderNo} · {o.buyer.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {[o.fabricType, o.colour].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {rolls.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs has-checked:border-brand has-checked:bg-brand has-checked:text-surface transition-colors">
            <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
            {r.rollNo} · {formatQty(r.qty)}
          </label>
        ))}
      </div>
      <Button size="sm" className="w-full gap-1.5" disabled={picked.size === 0} onClick={() => setConfirming(true)}>
        <ClipboardList className="size-4" />
        Review pick list · {picked.size} rolls, {formatQty(qty)}
      </Button>
      {confirming && (
        <ConfirmDispatch
          group={group}
          rollIds={[...picked]}
          onClose={() => setConfirming(false)}
          onDone={() => {
            setConfirming(false)
            onDone()
          }}
        />
      )}
    </div>
  )
}

// The order as GET /orders/:id returns it: enough to compare this truck with what was ordered.
interface OrderDetail {
  qty: number
  pricePerUnit: number
  rolls: { id: string; status: string; qty: number; machine?: { code: string } }[]
}

// Last check before the truck leaves: the pick list, the quantities against the order, the
// invoice it will raise, and the vehicle. Printable so the loader can tick rolls off on paper.
function ConfirmDispatch({ group, rollIds, onClose, onDone }: { group: ShelfGroup; rollIds: string[]; onClose: () => void; onDone: () => void }) {
  const { order: o } = group
  const detail = useApi<OrderDetail>(`/orders/${o.id}`)
  const [vehicleNo, setVehicleNo] = useState('')
  const [busy, setBusy] = useState(false)
  const picked = group.rolls.filter((r) => rollIds.includes(r.id))
  const truck = picked.reduce((a, r) => a + r.qty, 0)
  const machineOf = (id: string) => detail.data?.rolls.find((r) => r.id === id)?.machine?.code ?? '—'
  const shipped = (detail.data?.rolls ?? []).filter((r) => r.status === 'DISPATCHED').reduce((a, r) => a + r.qty, 0)
  const ordered = detail.data?.qty ?? o.qty
  const left = ordered - shipped - truck

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await mutate('/dispatch', 'POST', { orderId: o.id, rollIds, vehicleNo: vehicleNo.trim() }, `${o.orderNo} dispatched on ${vehicleNo.trim()}, invoice raised`)
    setBusy(false)
    if (ok) onDone()
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="print-area sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pick list · {o.orderNo}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {o.buyer.name} · {[o.fabricType, o.colour].filter(Boolean).join(' · ')}
        </p>

        <table className="w-full text-sm">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-medium">✓</th>
              <th className="py-1 text-left font-medium">Roll</th>
              <th className="py-1 text-left font-medium">Machine</th>
              <th className="py-1 text-right font-medium">Length</th>
            </tr>
          </thead>
          <tbody>
            {picked.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="py-1">
                  <span className="inline-block size-3.5 rounded-sm border border-ink-3" />
                </td>
                <td className="py-1">{r.rollNo}</td>
                <td className="py-1">{machineOf(r.id)}</td>
                <td className="py-1 text-right tabular-nums">{formatQty(r.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="grid grid-cols-4 gap-2 rounded-lg bg-brand-tint p-3 text-center text-xs">
          {[
            ['Ordered', formatQty(ordered)],
            ['Shipped before', formatQty(shipped)],
            ['This truck', formatQty(truck)],
            ['Left after', formatQty(Math.max(0, left))],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {left < 0 && <p className="text-xs text-watch">This truck carries {formatQty(-left)} more than the order still needs (within roll tolerance).</p>}
        {detail.data && <p className="text-sm">Invoice to raise: <span className="font-medium">{formatINR(truck * detail.data.pricePerUnit)}</span> ({formatQty(truck)} × {formatINR(detail.data.pricePerUnit)}/m)</p>}

        <form id="confirm-dispatch" onSubmit={submit} className="print:hidden">
          <Field label="Vehicle number" htmlFor="vehicleNo">
            <Input id="vehicleNo" required placeholder="GJ-05-AB-1234" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
          </Field>
        </form>
        <DialogFooter className="print:hidden">
          <Button type="button" variant="outline" className="gap-1.5" onClick={() => window.print()}>
            <Printer className="size-4" />
            Print pick list
          </Button>
          <Button type="submit" form="confirm-dispatch" className="gap-1.5" disabled={busy || !vehicleNo.trim() || detail.loading}>
            <Truck className="size-4" />
            {busy ? 'Dispatching…' : 'Confirm and dispatch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InvoiceDialog({ d, onClose }: { d: DispatchRow; onClose: () => void }) {
  const inv = d.invoice
  // The dispatch carries no price; the invoice amount over the shipped length gives the rate.
  const rate = inv && d.totalQty ? inv.amount / d.totalQty : 0
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
                  {d.order.fabricType} {d.order.colour} @ {formatINR(rate)}/m
                </td>
                <td className="py-1 text-right tabular-nums">{formatQty(r.qty)}</td>
                <td className="py-1 text-right tabular-nums">{formatINR(r.qty * rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {inv && (
          <div className="space-y-1 text-right text-sm">
            <p className="font-medium">Total {formatINR(inv.amount)}</p>
            <p className="text-muted-foreground">
              Paid {formatINR(inv.paid)} · <StatusPill status={inv.status} />
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
  const due = inv.balance
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

import { useMemo, useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, CheckCircle2, ClipboardList, PackageOpen, Printer, Search, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { PageHead } from '@/components/PageHead'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Field, selectClass } from '@/components/Field'
import { Pill, StatusPill } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/api'
import { byUrgency, checkLoad, shelfStatus, TOLERANCE, WAIT_LIMIT_DAYS, type ShelfFlag } from '@/lib/dispatch'
import { dayFromToday, formatDate, formatDateTime, formatINR, formatMoney, formatQty, toISODate } from '@/lib/format'
import { mutate, useApi, usePaged } from '@/lib/useApi'
import { LoadMore } from '@/components/LoadMore'
import type { Dispatch as DispatchRow, ShelfStock } from '@/types'

type ShelfGroup = ShelfStock['orders'][number]
type ShelfRow = ShelfGroup & ReturnType<typeof shelfStatus> & { shipped: number; deadline: string; flag: ShelfFlag }

const FLAG: Record<Exclude<ShelfFlag, null>, { tone: 'problem' | 'watch'; text: (r: ShelfRow) => string }> = {
  overdue: { tone: 'problem', text: (r) => `Overdue by ${-r.dueIn} day${r.dueIn === -1 ? '' : 's'}` },
  'due-soon': { tone: 'watch', text: (r) => (r.dueIn === 0 ? 'Due today' : `Due in ${r.dueIn} day${r.dueIn === 1 ? '' : 's'}`) },
  waiting: { tone: 'watch', text: (r) => `Waiting ${r.waitingDays} days` },
}

export function Dispatch() {
  const shelf = useApi<ShelfStock>('/dispatch/stock', { refreshMs: 30000 })
  // Recent trucks: what each order on the shelf has already received, and this month's totals.
  const recent = useApi<DispatchRow[]>(`/dispatch?from=${dayFromToday(-180)}&limit=500`)
  const dispatches = usePaged<DispatchRow>('/dispatch')
  const [invoiceOf, setInvoiceOf] = useState<DispatchRow | null>(null)
  const [paying, setPaying] = useState<DispatchRow | null>(null)
  const [q, setQ] = useState('')
  const reload = () => {
    shelf.reload()
    recent.reload()
    dispatches.reload()
  }

  const today = dayFromToday(0)
  const rows = useMemo<ShelfRow[]>(() => {
    const shipped = new Map<string, number>()
    for (const d of recent.data ?? []) shipped.set(d.order.id, (shipped.get(d.order.id) ?? 0) + d.totalQty)
    return (shelf.data?.orders ?? [])
      .map((g) => {
        const sent = shipped.get(g.order.id) ?? 0
        const finishedAt = g.rolls.reduce((m, r) => (r.createdAt && r.createdAt > m ? r.createdAt : m), '') || today
        const s = shelfStatus({ ordered: g.order.qty, shipped: sent, onShelf: g.totalQty, deadline: g.order.deadline, finishedAt, today })
        return { ...g, ...s, shipped: sent, deadline: g.order.deadline }
      })
      .sort(byUrgency)
  }, [shelf.data, recent.data, today])

  // Finished stock by fabric: what the shelf holds, whoever it is for.
  const byFabric = useMemo(() => {
    const m = new Map<string, { fabric: string; rolls: number; qty: number; orders: number }>()
    for (const g of shelf.data?.orders ?? []) {
      const k = [g.order.fabricType, g.order.colour].filter(Boolean).join(' · ')
      const e = m.get(k) ?? { fabric: k, rolls: 0, qty: 0, orders: 0 }
      e.rolls += g.rolls.length
      e.qty += g.totalQty
      e.orders += 1
      m.set(k, e)
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty)
  }, [shelf.data])

  const ready = rows.filter((r) => r.complete)
  const partReady = rows.filter((r) => !r.complete)
  const month = today.slice(0, 7)
  const thisMonth = (recent.data ?? []).filter((d) => d.dispatchedAt.slice(0, 7) === month)
  const attention = rows.filter((r) => r.flag).length
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? dispatches.rows.filter((d) => [d.dispatchNo, d.order.orderNo, d.buyer.name, d.invoice?.invoiceNo ?? '', d.vehicleNo ?? ''].some((x) => x.toLowerCase().includes(needle)))
    : dispatches.rows

  const columns: ColumnDef<DispatchRow>[] = [
    { accessorKey: 'dispatchNo', header: 'Dispatch' },
    { id: 'date', header: 'Date', accessorFn: (d) => d.dispatchedAt, cell: ({ row: { original: d } }) => formatDate(d.dispatchedAt) },
    { id: 'buyer', header: 'Buyer', accessorFn: (d) => d.buyer.name },
    { id: 'order', header: 'Order', accessorFn: (d) => d.order.orderNo },
    { id: 'rolls', header: 'Rolls', accessorFn: (d) => `${d.rolls.length} · ${formatQty(d.totalQty)}` },
    { id: 'vehicle', header: 'Vehicle', accessorFn: (d) => d.vehicleNo ?? '—' },
    { id: 'invoice', header: 'Invoice', accessorFn: (d) => d.invoice?.invoiceNo ?? '', cell: ({ row: { original: d } }) => (d.invoice ? `${d.invoice.invoiceNo} · ${formatINR(d.invoice.amount)}` : '—') },
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
      <PageHead eyebrow="Dispatch" title="Loading the truck" lede="Right rolls, right quantity, right buyer: only passed rolls go, each one once, with an invoice for exactly what left." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Finished fabric on shelf"
          value={formatQty(shelf.data?.totalQty ?? 0)}
          hint={`${shelf.data?.totalRolls ?? 0} passed rolls for ${rows.length} order${rows.length === 1 ? '' : 's'}`}
          loading={shelf.loading}
        />
        <KpiCard label="Ready to dispatch" tone={rows.some((r) => r.complete) ? 'good' : undefined} value={String(rows.filter((r) => r.complete).length)} hint="Orders whose full quantity is on the shelf" loading={shelf.loading || recent.loading} />
        <KpiCard
          label="Needs attention"
          tone={attention ? 'problem' : undefined}
          value={String(attention)}
          hint={attention ? `Overdue, due within 3 days, or waiting over ${WAIT_LIMIT_DAYS} days` : 'Nothing left waiting'}
          loading={shelf.loading || recent.loading}
        />
        <KpiCard label="Dispatched this month" value={formatQty(thisMonth.reduce((t, d) => t + d.totalQty, 0))} hint={`${thisMonth.length} trucks · ${formatMoney(thisMonth.reduce((t, d) => t + (d.invoice?.amount ?? 0), 0))} invoiced`} loading={recent.loading} />
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="section-head">Ready to dispatch</h2>
          <span className="text-xs text-ink-3">Full order on the shelf · most urgent first</span>
        </div>
        {!shelf.loading && ready.length === 0 ? (
          <div className="card">
            <EmptyState icon={PackageOpen} line={rows.length ? 'No order is complete yet. Part-ready orders are below.' : 'No passed rolls on the shelf. Everything finished has been dispatched.'} />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {ready.map((r) => (
              <LoadCard key={r.order.id} row={r} onDone={(d) => { reload(); setInvoiceOf(d) }} onStale={reload} />
            ))}
          </div>
        )}
      </section>

      {partReady.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="section-head">Part ready</h2>
            <span className="text-xs text-ink-3">Rest still in production · send now only as a part delivery</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {partReady.map((r) => (
              <LoadCard key={r.order.id} row={r} onDone={(d) => { reload(); setInvoiceOf(d) }} onStale={reload} />
            ))}
          </div>
        </section>
      )}

      {byFabric.length > 0 && (
        <section className="space-y-3">
          <h2 className="section-head">Finished stock by fabric</h2>
          <div className="card divide-y p-0">
            {byFabric.map((f) => (
              <div key={f.fabric} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="font-medium">{f.fabric}</span>
                <span className="tabular-nums text-ink-2">
                  {f.rolls} roll{f.rolls === 1 ? '' : 's'} · {formatQty(f.qty)} · {f.orders} order{f.orders === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-head">Dispatched</h2>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
            <Input aria-label="Search dispatches" className="pl-9" placeholder="Order, invoice, buyer or vehicle" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <DataTable columns={columns} data={shown} loading={dispatches.loading} empty={needle ? `Nothing loaded so far matches "${q.trim()}".` : 'Nothing dispatched yet.'} />
        <LoadMore hasMore={dispatches.hasMore} more={dispatches.more} />
      </section>

      {invoiceOf && <InvoiceDialog d={invoiceOf} onClose={() => setInvoiceOf(null)} />}
      {paying && <PaymentDialog d={paying} onClose={() => setPaying(null)} onSaved={reload} />}
    </div>
  )
}

function LoadCard({ row: r, onDone, onStale }: { row: ShelfRow; onDone: (d: DispatchRow) => void; onStale: () => void }) {
  const { order: o, rolls } = r
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rolls.map((x) => x.id)))
  const [confirming, setConfirming] = useState(false)
  const qty = rolls.filter((x) => picked.has(x.id)).reduce((a, x) => a + x.qty, 0)
  const inProduction = Math.max(0, o.qty - r.shipped - r.totalQty)
  const flag = r.flag && FLAG[r.flag]

  function toggle(id: string) {
    const next = new Set(picked)
    if (!next.delete(id)) next.add(id)
    setPicked(next)
  }

  return (
    <div className={`card space-y-3 ${r.flag === 'overdue' ? 'border-problem/40' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{o.buyer.name}</p>
          <p className="text-xs text-ink-2">
            {o.orderNo} · {[o.fabricType, o.colour].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {flag ? <Pill tone={flag.tone}>{flag.text(r)}</Pill> : <Pill tone={r.complete ? 'good' : 'neutral'}>{r.complete ? 'Ready' : 'Part ready'}</Pill>}
          <span className="text-xs text-ink-3">Due {formatDate(o.deadline)}</span>
        </div>
      </div>
      <dl className="grid grid-cols-4 gap-2 rounded-lg bg-ground/70 p-2 text-center text-xs">
        {[
          ['Ordered', o.qty],
          ['Sent', r.shipped],
          ['On shelf', r.totalQty],
          ['In production', inProduction],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-ink-3">{k}</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{formatQty(Number(v))}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        {rolls.map((x) => (
          <label key={x.id} className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors has-checked:border-brand has-checked:bg-brand has-checked:text-surface">
            <input type="checkbox" checked={picked.has(x.id)} onChange={() => toggle(x.id)} />
            {x.rollNo} · {formatQty(x.qty)}
          </label>
        ))}
      </div>
      <Button size="sm" className="w-full gap-1.5" disabled={picked.size === 0} onClick={() => setConfirming(true)}>
        <ClipboardList className="size-4" />
        Check and dispatch · {picked.size} roll{picked.size === 1 ? '' : 's'}, {formatQty(qty)}
      </Button>
      {confirming && (
        <ConfirmDispatch
          group={r}
          rollIds={[...picked]}
          onClose={() => setConfirming(false)}
          onStale={() => {
            setConfirming(false)
            onStale()
          }}
          onDone={(d) => {
            setConfirming(false)
            onDone(d)
          }}
        />
      )}
    </div>
  )
}

// The order as GET /orders/:id returns it: enough to check this truck against what was ordered.
interface OrderDetail {
  qty: number
  pricePerUnit: number
  buyer: { name: string; phone: string | null }
  rolls: { id: string; status: string; qty: number; machine?: { code: string } }[]
  dispatches: { id: string; dispatchNo: string; dispatchedAt: string; vehicleNo: string | null }[]
}

// Last check before the truck leaves: the pick list, the quantity against the order, the buyer,
// earlier trucks for the same order, and the invoice it will raise. Printable for the loader.
function ConfirmDispatch({ group, rollIds, onClose, onDone, onStale }: { group: ShelfGroup; rollIds: string[]; onClose: () => void; onDone: (d: DispatchRow) => void; onStale: () => void }) {
  const { order: o } = group
  const detail = useApi<OrderDetail>(`/orders/${o.id}`)
  const [vehicleNo, setVehicleNo] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const picked = group.rolls.filter((r) => rollIds.includes(r.id))
  const truck = picked.reduce((a, r) => a + r.qty, 0)
  const machineOf = (id: string) => detail.data?.rolls.find((r) => r.id === id)?.machine?.code ?? '—'
  const shipped = (detail.data?.rolls ?? []).filter((r) => r.status === 'DISPATCHED').reduce((a, r) => a + r.qty, 0)
  const ordered = detail.data?.qty ?? o.qty
  const load = checkLoad({ ordered, shippedBefore: shipped, truck })
  const earlier = detail.data?.dispatches ?? []
  const sameDay = earlier.find((d) => toISODate(new Date(d.dispatchedAt)) === dayFromToday(0))
  const vehicle = vehicleNo.trim().toUpperCase()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || !checked) return
    setBusy(true)
    try {
      const d = await api<DispatchRow>('/dispatch', { method: 'POST', body: { orderId: o.id, rollIds, vehicleNo: vehicle } })
      toast.success(`${d.dispatchNo} left on ${vehicle}`, { description: `Invoice ${d.invoice?.invoiceNo} raised for ${formatINR(d.invoice?.amount ?? 0)}` })
      onDone(d)
    } catch (err) {
      // Someone else loaded these rolls first: refresh rather than retry, so nothing goes twice.
      if (err instanceof ApiError && err.code === 'ROLLS_NOT_AVAILABLE') {
        toast.error('Some of these rolls were already dispatched. The shelf has been refreshed.')
        onStale()
      } else toast.error(err instanceof ApiError ? err.message : 'Could not dispatch.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="print-area max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pick list · {o.orderNo}</DialogTitle>
        </DialogHeader>

        <div className="rounded-lg border bg-surface p-3">
          <p className="text-xs text-ink-3">Deliver to</p>
          <p className="text-lg font-semibold">{o.buyer.name}</p>
          <p className="text-xs text-ink-2">
            {[o.fabricType, o.colour].filter(Boolean).join(' · ')}
            {detail.data?.buyer.phone && ` · ${detail.data.buyer.phone}`}
          </p>
        </div>

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
            ['Sent before', formatQty(shipped)],
            ['This truck', formatQty(truck)],
            ['Total after', formatQty(load.total)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {detail.data && (
          <p className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${load.kind === 'match' ? 'bg-good-bg text-good' : load.kind === 'part' ? 'bg-watch-bg text-watch' : 'bg-problem-bg text-problem'}`}>
            {load.kind === 'match' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
            {load.kind === 'match'
              ? `Quantity matches the order (${load.diffPct >= 0 ? '+' : ''}${load.diffPct}%, within ±${TOLERANCE * 100}%).`
              : load.kind === 'part'
                ? `Part delivery: ${formatQty(load.toFollow)} still to follow on a later truck.`
                : `${formatQty(load.overBy)} (${load.overPct}%) more than ordered, beyond the ±${TOLERANCE * 100}% buyers accept. Leave a roll off, or get the buyer's agreement first.`}
          </p>
        )}
        {earlier.length > 0 && (
          <p className={`rounded-lg px-3 py-2 text-xs ${sameDay ? 'bg-watch-bg text-watch' : 'bg-ground text-ink-2'}`}>
            {sameDay ? 'A truck already left for this order today: ' : 'Already sent for this order: '}
            {earlier.map((d) => `${d.dispatchNo} on ${formatDateTime(d.dispatchedAt)}${d.vehicleNo ? ` (${d.vehicleNo})` : ''}`).join(', ')}. These rolls are different and can only go once.
          </p>
        )}
        {detail.data && (
          <p className="text-sm">
            Invoice to raise: <span className="font-semibold">{formatINR(truck * detail.data.pricePerUnit)}</span> ({formatQty(truck)} × {formatINR(detail.data.pricePerUnit)}/m)
          </p>
        )}

        <form id="confirm-dispatch" onSubmit={submit} className="space-y-3 print:hidden">
          <Field label="Vehicle number" htmlFor="vehicleNo">
            <Input id="vehicleNo" required placeholder="GJ-05-AB-1234" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>
              I counted {picked.length} roll{picked.length === 1 ? '' : 's'} ({formatQty(truck)}) on the truck, matching this list, going to <b>{o.buyer.name}</b>
              {load.kind === 'over' && ', and the buyer agreed to the extra quantity'}.
            </span>
          </label>
        </form>
        <DialogFooter className="print:hidden">
          <Button type="button" variant="outline" className="gap-1.5" onClick={() => window.print()}>
            <Printer className="size-4" />
            Print pick list
          </Button>
          <Button type="submit" form="confirm-dispatch" className="gap-1.5" disabled={busy || !checked || !vehicle || detail.loading}>
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

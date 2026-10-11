import { useMemo, useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, MapPin, PackageOpen, Printer, Search, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { PageHead } from '@/components/PageHead'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Field, selectClass } from '@/components/Field'
import { Pill, StatusPill } from '@/components/StatusPill'
import { Figure } from '@/components/Figure'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/api'
import { byUrgency, checkLoad, shelfStatus, TOLERANCE, WAIT_LIMIT_DAYS, type ShelfFlag } from '@/lib/dispatch'
import type { Config } from '@/types'

// Tolerance and shelf-wait limit from the Config page, falling back to the defaults.
function useDispatchRules() {
  const config = useApi<Config>('/config')
  const value = (key: string) => config.data?.settings.find((s) => s.key === key)?.value
  return { tolerance: (value('dispatchTolerancePct') ?? TOLERANCE * 100) / 100, waitLimit: value('shelfWaitDays') ?? WAIT_LIMIT_DAYS }
}
import { dayFromToday, formatDate, formatINR, formatQty } from '@/lib/format'
import { mutate, pagerOf, useApi, usePages } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import { Pagination } from '@/components/Pagination'
import type { Dispatch as DispatchRow, ShelfStock } from '@/types'

type ShelfGroup = ShelfStock['orders'][number]
type ShelfRow = ShelfGroup & ReturnType<typeof shelfStatus> & { shipped: number; deadline: string; flag: ShelfFlag }

const FLAG: Record<Exclude<ShelfFlag, null>, { tone: 'problem' | 'watch'; text: (r: ShelfRow) => string }> = {
  overdue: { tone: 'problem', text: (r) => `Overdue by ${-r.dueIn} day${r.dueIn === -1 ? '' : 's'}` },
  'due-soon': { tone: 'watch', text: (r) => (r.dueIn === 0 ? 'Due today' : `Due in ${r.dueIn} day${r.dueIn === 1 ? '' : 's'}`) },
  waiting: { tone: 'watch', text: (r) => `Waiting ${r.waitingDays} days` },
}

// What the order has to deliver in all: its quantity less fabric rejected at quality check.
const owed = (g: ShelfGroup) => (g.order as { toShip?: number }).toShip ?? g.order.qty
// A client's one-line delivery address, when one is saved.
const addressOf = (b: unknown) => (b as { address?: string | null }).address || ''
const rollsOf = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'roll' : 'rolls'}`
const ordersOf = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'order' : 'orders'}`
const fabricOf = (o: { fabricType: string; colour?: string | null }) => [o.fabricType, o.colour].filter(Boolean).join(' · ')

// The shelf is always "right now"; what has gone out is counted over a period you pick.
const PERIODS = [
  { key: 'today', label: 'Today', days: 0, words: 'today' },
  { key: '7', label: 'Last 7 days', days: 7, words: 'in the last 7 days' },
  { key: '30', label: 'Last 30 days', days: 30, words: 'in the last 30 days' },
  { key: '90', label: 'Last 90 days', days: 90, words: 'in the last 90 days' },
] as const

// Three lists, opened from the boxes at the top.
const VIEWS = {
  shelf: 'On the shelf',
  ready: 'Ready to dispatch',
  sent: 'Dispatched',
} as const
type View = keyof typeof VIEWS

export function Dispatch() {
  const { tolerance, waitLimit } = useDispatchRules()
  const shelf = useApi<ShelfStock>('/dispatch/stock', { refreshMs: 30000 })
  // Recent trucks: what each order on the shelf has already received, and this month's totals.
  const recent = useApi<DispatchRow[]>(`/dispatch?from=${dayFromToday(-180)}&limit=500`)
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('today')
  const span = PERIODS.find((p) => p.key === period)!
  // From the mill's own midnight, not UTC's: a truck that left at 3 am today counts as today.
  const since = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - span.days)
    return d.toISOString()
  }, [span.days])
  const dispatches = usePages<DispatchRow>(`/dispatch?from=${encodeURIComponent(since)}`)
  const [view, setView] = useState<View>('shelf')
  const [loading, setLoading] = useState<ShelfRow | null>(null)
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
        const s = shelfStatus({ ordered: owed(g), shipped: sent, onShelf: g.totalQty, deadline: g.order.deadline, finishedAt, today, tolerance, waitLimit })
        return { ...g, ...s, shipped: sent, deadline: g.order.deadline }
      })
      .sort(byUrgency)
  }, [shelf.data, recent.data, today, tolerance, waitLimit])

  const ready = rows.filter((r) => r.complete)
  const count = (list: ShelfRow[]) => list.reduce((n, r) => n + r.rolls.length, 0)
  // The same period drives the Dispatched box and its list.
  const sent = (recent.data ?? []).filter((d) => d.dispatchedAt >= since)
  const sentRolls = sent.reduce((n, d) => n + d.rolls.length, 0)

  const needle = q.trim().toLowerCase()
  const has = (...v: (string | null | undefined)[]) => !needle || v.some((x) => x?.toLowerCase().includes(needle))
  const shelfRows = (view === 'ready' ? ready : rows).filter((r) => has(r.order.orderNo, r.order.buyer.name, r.order.fabricType, r.order.colour, ...r.rolls.map((x) => x.rollNo)))
  const sentRows = dispatches.rows.filter((d) => has(d.dispatchNo, d.order.orderNo, d.buyer.name, addressOf(d.buyer), d.invoice?.invoiceNo, d.vehicleNo))
  const unsold = shelf.data?.unsold.rolls ?? []

  // What is on the shelf, one order per row. No column sorting: the most urgent is on top.
  const shelfCols: ColumnDef<ShelfRow>[] = [
    {
      id: 'order',
      header: 'Order',
      meta: { width: '22%' },
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <div className="leading-tight">
          <p className="font-medium">{r.order.orderNo}</p>
          <p className="truncate text-xs text-muted-foreground">{fabricOf(r.order)}</p>
        </div>
      ),
    },
    {
      id: 'buyer',
      header: 'Client',
      meta: { width: '24%' },
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <div className="leading-tight">
          <p>{r.order.buyer.name}</p>
          <p className="truncate text-xs text-muted-foreground">{addressOf(r.order.buyer) || 'No address'}</p>
        </div>
      ),
    },
    {
      id: 'shelf',
      header: 'On the shelf',
      meta: { width: '18%' },
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <div className="leading-tight tabular-nums">
          <p>{rollsOf(r.rolls.length)}</p>
          <p className="text-xs text-muted-foreground">
            {formatQty(r.totalQty)} of {formatQty(owed(r))}
          </p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      meta: { width: '20%' },
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <div className="leading-tight">
          <Pill tone={r.complete ? 'good' : 'neutral'}>{r.complete ? 'Ready' : 'Partial ready'}</Pill>
          <p className={cn('mt-0.5 text-xs', r.flag === 'overdue' ? 'font-medium text-problem' : r.flag ? 'font-medium text-watch' : 'text-muted-foreground')}>{r.flag ? FLAG[r.flag].text(r) : `Due ${formatDate(r.order.deadline)}`}</p>
        </div>
      ),
    },
    {
      id: 'act',
      header: '',
      meta: { width: '16%' },
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        // An order goes out whole, so only a complete one can be dispatched.
        <div className="flex justify-end">
          {r.complete ? (
            <Button size="xs" onClick={() => setLoading(r)}>
              Dispatch
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Partial ready</span>
          )}
        </div>
      ),
    },
  ]

  // What has already gone out, newest first.
  const sentCols: ColumnDef<DispatchRow>[] = [
    {
      accessorKey: 'dispatchNo',
      header: 'Dispatch',
      meta: { width: '14%' },
      enableSorting: false,
      cell: ({ row: { original: d } }) => (
        <div className="leading-tight">
          <p className="font-medium">{d.dispatchNo}</p>
          <p className="text-xs text-muted-foreground">{formatDate(d.dispatchedAt)}</p>
        </div>
      ),
    },
    {
      id: 'client',
      header: 'Client',
      meta: { width: '24%' },
      enableSorting: false,
      cell: ({ row: { original: d } }) => (
        <div className="leading-tight">
          <p>{d.buyer.name}</p>
          <p className="truncate text-xs text-muted-foreground">{addressOf(d.buyer) || 'No address'}</p>
        </div>
      ),
    },
    {
      id: 'rolls',
      header: 'Sent',
      meta: { width: '20%' },
      enableSorting: false,
      cell: ({ row: { original: d } }) => (
        <div className="leading-tight tabular-nums">
          <p>
            {d.order.orderNo} · {rollsOf(d.rolls.length)}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {formatQty(d.totalQty)}
            {d.vehicleNo ? ` · ${d.vehicleNo}` : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'invoice',
      header: 'Invoice',
      meta: { width: '20%' },
      enableSorting: false,
      cell: ({ row: { original: d } }) =>
        d.invoice ? (
          <div className="leading-tight">
            <p className="tabular-nums">{formatINR(d.invoice.amount)}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {d.invoice.invoiceNo} <StatusPill status={d.invoice.status} />
            </p>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'act',
      header: '',
      meta: { width: '22%' },
      enableSorting: false,
      cell: ({ row: { original: d } }) => (
        <div className="flex justify-end gap-2">
          {d.invoice && d.invoice.status !== 'PAID' && (
            <Button size="xs" onClick={() => setPaying(d)}>
              Record payment
            </Button>
          )}
          <Button size="xs" variant="outline" onClick={() => setInvoiceOf(d)}>
            Invoice
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHead eyebrow="Loading the truck" title="Dispatch" />
      {(shelf.error || dispatches.error) && <p className="text-sm text-problem">{shelf.error || dispatches.error}</p>}

      <section className="figures-panel">
        <div className="grid gap-4 sm:grid-cols-3">
          <Figure
            label="On the shelf"
            onClick={() => setView('shelf')}
            active={view === 'shelf'}
            value={ordersOf(rows.length)}
            note={`${rollsOf(shelf.data?.totalRolls ?? 0)} in store right now`}
            loading={shelf.loading}
          />
          <Figure
            label="Ready to dispatch"
            onClick={() => setView('ready')}
            active={view === 'ready'}
            tone={ready.length ? 'good' : undefined}
            value={ordersOf(ready.length)}
            note={ready.length ? `${rollsOf(count(ready))} to dispatch right now` : 'No full order on the shelf yet'}
            loading={shelf.loading || recent.loading}
          />
          <Figure
            label="Dispatched"
            onClick={() => setView('sent')}
            active={view === 'sent'}
            value={ordersOf(new Set(sent.map((d) => d.order.id)).size)}
            note={`${rollsOf(sentRolls)} sent ${span.words}`}
            loading={recent.loading}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-head">{VIEWS[view]}</h2>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Search" placeholder={view === 'sent' ? 'Search order, buyer, invoice or vehicle' : 'Search order, buyer or roll'} className="bg-white pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {view === 'sent' && (
            <select aria-label="Period" className={cn(selectClass, 'bg-white sm:w-auto sm:min-w-36')} value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
              {PERIODS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {view === 'sent' ? (
        <>
          <DataTable
            key="sent"
            columns={sentCols}
            data={sentRows}
            loading={dispatches.loading}
            empty={needle ? <EmptyState icon={Search} line={`Nothing matches "${q.trim()}".`} actionLabel="Clear search" onAction={() => setQ('')} /> : <EmptyState icon={Truck} line={`Nothing was dispatched ${span.words}.`} actionLabel={period === '90' ? undefined : 'Show a longer period'} onAction={period === '90' ? undefined : () => setPeriod(period === 'today' ? '7' : period === '7' ? '30' : '90')} />}
          />
          <Pagination {...pagerOf(dispatches)} />
        </>
      ) : (
        <DataTable
          key="shelf"
          columns={shelfCols}
          data={shelfRows}
          loading={shelf.loading}
          empty={
            needle ? (
              <EmptyState icon={Search} line={`Nothing matches "${q.trim()}".`} actionLabel="Clear search" onAction={() => setQ('')} />
            ) : (
              <EmptyState icon={PackageOpen} line={view === 'ready' ? 'No full order is on the shelf yet.' : 'The shelf is empty. Everything finished has been dispatched.'} />
            )
          }
        />
      )}

      {view === 'shelf' && unsold.length > 0 && (
        <section className="space-y-3">
          <h2 className="section-head">
            Unsold stock <span className="ml-1 text-xs font-normal text-muted-foreground">{formatQty(shelf.data!.unsold.totalQty)} from cancelled orders</span>
          </h2>
          <div className="data-table-wrap divide-y divide-border">
            {unsold.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="leading-tight">
                  <span className="font-medium">{r.rollNo}</span> · {fabricOf(r.order)}
                  <span className="block text-xs text-muted-foreground">
                    {r.order.orderNo} for {r.order.buyer.name}
                    {r.order.note && ` · ${r.order.note}`}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-ink-2 tabular-nums">
                  {r.status !== 'PASSED' && <Pill tone="watch">Not checked</Pill>}
                  {formatQty(r.qty)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {loading && (
        <ConfirmDispatch
          group={loading}
          onClose={() => setLoading(null)}
          onStale={() => {
            setLoading(null)
            reload()
          }}
          onDone={(d) => {
            setLoading(null)
            reload()
            setInvoiceOf(d)
          }}
        />
      )}
      {invoiceOf && <InvoiceDialog d={invoiceOf} onClose={() => setInvoiceOf(null)} />}
      {paying && <PaymentDialog d={paying} onClose={() => setPaying(null)} onSaved={reload} />}
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

// The truck leaves: every roll of the order on the shelf goes, under one vehicle number.
function ConfirmDispatch({ group, onClose, onDone, onStale }: { group: ShelfGroup; onClose: () => void; onDone: (d: DispatchRow) => void; onStale: () => void }) {
  const { order: o, rolls } = group
  const detail = useApi<OrderDetail>(`/orders/${o.id}`)
  const { tolerance } = useDispatchRules()
  const [vehicleNo, setVehicleNo] = useState('')
  const [busy, setBusy] = useState(false)
  // The whole order goes on one truck: every roll on the shelf.
  const rollIds = rolls.map((r) => r.id)
  const truck = rolls.reduce((a, r) => a + r.qty, 0)
  const shipped = (detail.data?.rolls ?? []).filter((r) => r.status === 'DISPATCHED').reduce((a, r) => a + r.qty, 0)
  const ordered = owed(group)
  const load = checkLoad({ ordered, shippedBefore: shipped, truck, tolerance })
  const vehicle = vehicleNo.trim().toUpperCase()
  const count = `${rolls.length} roll${rolls.length === 1 ? '' : 's'}`

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
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
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Dispatch {o.orderNo}</DialogTitle>
          <DialogDescription>
            {fabricOf(o)} · {count} · {formatQty(truck)}
          </DialogDescription>
        </DialogHeader>

        {/* Who it is for and where the truck goes. */}
        <dl className="-mt-1 grid gap-2 rounded-lg bg-zinc-50 px-3 py-2.5 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Client</dt>
            <dd className="font-medium">{o.buyer.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Deliver to</dt>
            <dd className="flex items-start gap-1.5">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              {addressOf(o.buyer) || <span className="text-muted-foreground">No address saved. Add one on the Clients page.</span>}
            </dd>
          </div>
        </dl>

        <form id="confirm-dispatch" onSubmit={submit} className="grid gap-4">
          {/* Only said when something is wrong: more fabric than the buyer accepts. */}
          {load.kind === 'over' && (
            <p className="flex items-start gap-2 rounded-lg bg-problem-bg px-3 py-2 text-xs text-problem">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {formatQty(load.overBy)} more than the {formatQty(ordered)} ordered. Get the buyer's agreement first.
            </p>
          )}
          <Field label="Vehicle number" htmlFor="vehicleNo" hint={detail.data ? `Invoice for ${formatINR(truck * detail.data.pricePerUnit)} is raised on dispatch.` : undefined}>
            <Input id="vehicleNo" required autoFocus placeholder="GJ-05-AB-1234" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
          </Field>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="confirm-dispatch" disabled={busy || !vehicle || detail.loading}>
            Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// The invoice for one truck: on screen in a popup, and on paper as a clean A4 page (lib/print.ts).
function InvoiceDialog({ d, onClose }: { d: DispatchRow; onClose: () => void }) {
  const inv = d.invoice
  // The dispatch carries no price; the invoice amount over the shipped length gives the rate.
  const rate = inv && d.totalQty ? inv.amount / d.totalQty : 0
  // What the buyer owes in all: the fabric plus GST. Paid and balance are kept against this figure.
  const payable = inv ? inv.paid + inv.balance : 0
  const gst = inv ? Math.round((payable - inv.amount) * 100) / 100 : 0
  const paise = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const fact = (label: string, value: string) => (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="print-area max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {/* On paper the letterhead below takes the popup title's place. */}
        <DialogHeader className="print:hidden">
          <DialogTitle>Invoice {inv?.invoiceNo}</DialogTitle>
          <DialogDescription>{[d.order.orderNo, d.buyer.name].join(' · ')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 text-sm">
          {/* The letterhead only matters on paper; the popup already has a title. */}
          <div className="hidden items-start justify-between border-b-2 border-zinc-900 pb-3 print:flex">
            <div>
              <p className="text-lg font-semibold">Everest Textile Mills</p>
              <p className="text-xs text-zinc-600">Gujarat, India</p>
            </div>
            <div className="text-right">
              <p className="text-base font-semibold tracking-wide uppercase">Invoice</p>
              <p className="font-mono text-sm">{inv?.invoiceNo}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {fact('Bill to', d.buyer.name)}
            {addressOf(d.buyer) && <div className="col-span-2 -mt-2">{fact('Deliver to', addressOf(d.buyer))}</div>}
            {fact('Invoice date', inv ? formatDate(inv.issuedAt) : '—')}
            {fact('Order', d.order.orderNo)}
            {fact('Dispatch', `${d.dispatchNo} · ${formatDate(d.dispatchedAt)}`)}
            {fact('Fabric', fabricOf(d.order))}
            {fact('Vehicle', d.vehicleNo ?? '—')}
          </div>

          <table className="w-full text-sm">
            <thead className="border-y border-zinc-300 text-xs text-muted-foreground">
              <tr>
                <th className="py-1.5 text-left font-medium">Roll</th>
                <th className="py-1.5 text-right font-medium">Length</th>
                <th className="py-1.5 text-right font-medium">Rate</th>
                <th className="py-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {d.rolls.map((r) => (
                <tr key={r.id} className="border-b border-zinc-200">
                  <td className="py-1.5">{r.rollNo}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatQty(r.qty)}</td>
                  <td className="py-1.5 text-right tabular-nums">{paise(rate)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatINR(r.qty * rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {inv && (
            <div className="ml-auto w-64 space-y-1">
              <div className="flex justify-between text-ink-2">
                <span>{d.rolls.length === 1 ? '1 roll' : `${d.rolls.length} rolls`}</span>
                <span className="tabular-nums">{formatQty(d.totalQty)}</span>
              </div>
              <div className="flex justify-between text-ink-2">
                <span>Fabric</span>
                <span className="tabular-nums">{formatINR(inv.amount)}</span>
              </div>
              {gst > 0 && (
                <div className="flex justify-between text-ink-2">
                  <span>GST</span>
                  <span className="tabular-nums">{formatINR(gst)}</span>
                </div>
              )}
              <div className="flex justify-between border-t-2 border-zinc-900 pt-1 text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatINR(payable)}</span>
              </div>
              <div className="flex justify-between text-ink-2">
                <span>Paid</span>
                <span className="tabular-nums">{formatINR(inv.paid)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-2">Balance due</span>
                <span className="flex items-center gap-2 font-medium tabular-nums">
                  {formatINR(inv.balance)} <StatusPill status={inv.status} />
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="print:hidden">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
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
          <DialogDescription>
            {d.buyer.name} · {formatINR(due)} due
          </DialogDescription>
        </DialogHeader>
        <form id="pay" onSubmit={submit} className="grid gap-4">
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="pay">
            Save payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

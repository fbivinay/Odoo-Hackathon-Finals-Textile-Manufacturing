import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Search, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from '@/auth/session'
import { actsAs } from '@/components/AppShell'
import { PageHead } from '@/components/PageHead'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { DeliveryEstimate, type Delivery } from '@/components/DeliveryEstimate'
import { Field, selectClass } from '@/components/Field'
import { Figure } from '@/components/Figure'
import { Pill, StatusPill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { dayFromToday, formatDate, formatINR, formatQty, toISODate } from '@/lib/format'
import { quote } from '@/lib/pricing'
import { api, ApiError } from '@/lib/api'
import { LoadMore } from '@/components/LoadMore'
import { useApi, usePaged } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import type { Config, Order, Planning, RawMaterial, Ref } from '@/types'

// The list's status filter, as the API's ?group= takes it.
const GROUPS = [
  ['', 'All statuses'],
  ['open', 'Open'],
  ['pending', 'Not started'],
  ['production', 'In production'],
  ['qc', 'Quality check'],
  ['ready', 'Ready'],
  ['dispatched', 'Dispatched'],
  ['cancelled', 'Cancelled'],
] as const
type Group = (typeof GROUPS)[number][0]
const plural = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'order' : 'orders'}`

// GET /orders/summary: the boxes are counted on the server, so the page never loads every order.
interface Summary {
  total: number
  open: number
  notStarted: number
  inProduction: number
  ready: number
  late: number
}

export function Orders() {
  const { user } = useSession()
  const navigate = useNavigate()
  const canCreate = actsAs(user, 'STORE', 'DISPATCH')
  const [open, setOpen] = useState(false)

  const summary = useApi<Summary>('/orders/summary')
  const buyers = useApi<Ref[]>('/buyers')
  // Both load beside the list, not before it: which yarn each order uses, and which orders are short.
  const materials = useApi<RawMaterial[]>('/materials?category=YARN')
  const plan = useApi<Planning>('/planning/schedule')
  const yarnOf = (id: string | null) => materials.data?.find((m) => m.id === id)
  const shortOf = useMemo(() => new Map(plan.data?.orders.filter((o) => o.yarnShortBy > 0).map((o) => [o.id, o.yarnShortBy])), [plan.data])

  // The list is searched, filtered and paged on the server, 50 orders at a time.
  const [group, setGroup] = useState<Group>('')
  const [late, setLate] = useState(false)
  const [buyerId, setBuyerId] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => setQ(search.trim()), 250)
    return () => window.clearTimeout(t)
  }, [search])
  const query = [group && `group=${group}`, late && 'delayed=true', buyerId && `buyerId=${buyerId}`, q && `q=${encodeURIComponent(q)}`, 'sort=newest'].filter(Boolean).join('&')
  const orders = usePaged<Order>(`/orders?${query}`, 50)
  const filtered = !!group || late || !!buyerId || !!q
  const clear = () => {
    setGroup('')
    setLate(false)
    setBuyerId('')
    setSearch('')
  }
  // A box is one view of the list; clicking it again goes back to every order.
  const view = late ? 'late' : group === 'open' ? 'open' : group === 'ready' ? 'ready' : ''
  const pick = (v: 'open' | 'late' | 'ready') => {
    const on = view !== v
    setLate(on && v === 'late')
    setGroup(on && v !== 'late' ? v : '')
  }
  const s = summary.data

  // No column sorting: the newest orders are on top.
  const columns: ColumnDef<Order>[] = [
    {
      accessorKey: 'orderNo',
      header: 'Order',
      meta: { width: '24%' },
      enableSorting: false,
      cell: ({ row: { original: o } }) => (
        <div className="leading-tight">
          <p className="flex items-center gap-1.5 font-medium whitespace-nowrap">
            {o.orderNo}
            {(o.priority || o.reworkStage || o.replacesOrderNo) && <Pill tone="watch">Priority</Pill>}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {o.reworkStage ? `Back in ${o.reworkStage.toLowerCase()}` : o.replacesOrderNo ? `Replaces ${o.replacesOrderNo}` : o.status === 'CANCELLED' && o.note ? o.note : `Ordered ${formatDate(o.createdAt)}`}
          </p>
        </div>
      ),
    },
    { id: 'client', header: 'Client', meta: { width: '18%' }, enableSorting: false, accessorFn: (o) => o.buyer.name },
    {
      id: 'fabric',
      header: 'Fabric',
      meta: { width: '24%' },
      enableSorting: false,
      cell: ({ row: { original: o } }) => {
        const y = yarnOf(o.materialId)
        return (
          <div className="leading-tight">
            <p className="truncate">{[o.fabricType, o.colour].filter(Boolean).join(' · ')}</p>
            <p className="truncate text-xs text-muted-foreground">
              {formatQty(o.qty)}
              {y && ` · ${y.yarnType}`}
            </p>
          </div>
        )
      },
    },
    {
      id: 'deadline',
      header: 'Deadline',
      meta: { width: '14%' },
      enableSorting: false,
      cell: ({ row: { original: o } }) => (
        <div className="leading-tight">
          <p>{formatDate(o.deadline)}</p>
          {o.isDelayed && <p className="text-xs font-medium text-problem">Late</p>}
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      meta: { width: '20%' },
      enableSorting: false,
      cell: ({ row: { original: o } }) => (
        <div className="leading-tight">
          <StatusPill status={o.status} />
          {shortOf.has(o.id) && <p className="mt-0.5 text-xs font-medium whitespace-nowrap text-problem">Needs {formatQty(shortOf.get(o.id)!, 'kg')} yarn</p>}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHead
        eyebrow="From buyers"
        title="Orders"
        actions={
          canCreate && (
            <Button className="gap-1.5" onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              New order
            </Button>
          )
        }
      />
      {(summary.error || orders.error) && <p className="text-sm text-problem">{summary.error || orders.error}</p>}

      <section className="figures-panel">
        <div className="grid gap-4 sm:grid-cols-3">
          <Figure
            label="Open orders"
            onClick={() => pick('open')}
            active={view === 'open'}
            value={plural(s?.open ?? 0)}
            note={s ? `${s.inProduction} in production · ${s.notStarted} not started` : undefined}
            loading={summary.loading}
          />
          <Figure
            label="Late"
            onClick={() => pick('late')}
            active={view === 'late'}
            tone={s?.late ? 'problem' : undefined}
            value={plural(s?.late ?? 0)}
            note={s?.late ? 'Open and past their deadline' : 'Nothing is past its deadline'}
            loading={summary.loading}
          />
          <Figure
            label="Ready to ship"
            onClick={() => pick('ready')}
            active={view === 'ready'}
            tone={s?.ready ? 'good' : undefined}
            value={plural(s?.ready ?? 0)}
            note={s?.ready ? 'Finished and waiting for a truck' : 'No finished order is waiting'}
            loading={summary.loading}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="section-head">{view === 'late' ? 'Late orders' : view === 'open' ? 'Open orders' : view === 'ready' ? 'Ready to ship' : filtered ? 'Orders' : 'All orders'}</h2>
          {filtered && (
            <Button size="xs" variant="ghost" onClick={clear}>
              Remove filter
            </Button>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Search orders" placeholder="Search order, client or fabric" className="bg-white pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select
            aria-label="Status"
            className={cn(selectClass, 'bg-white sm:w-auto sm:min-w-36')}
            value={group}
            onChange={(e) => {
              setGroup(e.target.value as Group)
              setLate(false)
            }}
          >
            {GROUPS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select aria-label="Client" className={cn(selectClass, 'bg-white sm:w-auto sm:min-w-40')} value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
            <option value="">All clients</option>
            {[...(buyers.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <DataTable
        key={query}
        columns={columns}
        data={orders.rows}
        loading={orders.loading}
        onRowClick={(o) => navigate(`/orders/${o.id}`)}
        empty={
          filtered ? (
            <EmptyState icon={Search} line="No order matches these filters." actionLabel="Clear filters" onAction={clear} />
          ) : (
            <EmptyState icon={ShoppingCart} line="No orders yet." actionLabel={canCreate ? 'New order' : undefined} onAction={canCreate ? () => setOpen(true) : undefined} />
          )
        }
      />
      <LoadMore hasMore={orders.hasMore} more={orders.more} />

      {canCreate && <OrderDialog open={open} onOpenChange={setOpen} onSaved={() => {}} />}
    </div>
  )
}

const NEW = '__new__'
// Typical yarn use per metre of fabric (kg/m). Used when a fabric has no past orders to learn from.
const YARN_PER_METRE: Record<string, number> = {
  poplin: 0.11, cambric: 0.09, lawn: 0.07, twill: 0.2, denim: 0.45, canvas: 0.5, oxford: 0.17,
  chambray: 0.15, satin: 0.13, georgette: 0.08, 'linen suiting': 0.22, 'rayon print': 0.12,
}
const FABRIC_TYPES = ['Poplin', 'Cambric', 'Lawn', 'Twill', 'Denim', 'Canvas', 'Oxford', 'Chambray', 'Satin', 'Georgette', 'Linen Suiting', 'Rayon Print']
const EMPTY = { buyerId: '', buyerName: '', buyerAddress: '', materialId: '', fabricType: '', qty: '', pricePerUnit: '', deadline: '' }
// The smallest order the mill takes, in metres.
const MIN_QTY = 10
// One fabric of a client's order, ready to be saved.
interface Item {
  fabricType: string
  materialId: string
  qty: number
  yarnKg: number
  price: number
  deadline: string
}

function OrderDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const buyers = useApi<Ref[]>(open ? '/buyers' : null)
  const materials = useApi<RawMaterial[]>(open ? '/materials?category=YARN' : null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  // A client can order several fabrics at once. Items already added wait here; each one is saved
  // as its own order (it runs on its own machines and ships by its own date).
  const [items, setItems] = useState<Item[]>([])
  // Likewise the price follows the usual price for fabric × yarn until the user types one.
  const [priceEdited, setPriceEdited] = useState(false)
  // The owner's figures per fabric (Config page); past orders fill in a fabric with no figures.
  const config = useApi<Config>(open ? '/config' : null)
  const specOf = (fabric: string) => config.data?.fabrics.find((f) => f.fabricType.toLowerCase() === fabric.trim().toLowerCase())
  const fabricTypes = config.data?.fabrics.length ? config.data.fabrics.map((f) => f.fabricType) : FABRIC_TYPES
  const past = useApi<Order[]>(open ? `/orders?from=${dayFromToday(-365)}&limit=500` : null)
  const typicalPrice = (fabric: string, materialId: string) => {
    const f = fabric.trim().toLowerCase()
    const same = (past.data ?? []).filter((o) => o.fabricType.toLowerCase() === f && o.pricePerUnit > 0)
    const exact = same.filter((o) => o.materialId === materialId)
    const prices = (exact.length >= 3 ? exact : same).map((o) => o.pricePerUnit).sort((a, b) => a - b)
    if (prices.length) return prices[Math.floor(prices.length / 2)]
    // ponytail: no history for this fabric, so yarn cost × kg per metre with a 60% margin.
    const m = materials.data?.find((x) => x.id === materialId)
    const perMetre = YARN_PER_METRE[f]
    return m && perMetre ? Math.round(m.avgCost * perMetre * 1.6 * 100) / 100 : null
  }
  // The yarn and how much of it are not asked for: both follow from the fabric. Past orders say
  // which yarn a fabric is made from and how many kg a metre takes.
  const sameFabric = (fabric: string) => (past.data ?? []).filter((o) => o.fabricType.toLowerCase() === fabric.trim().toLowerCase())
  const usualYarn = (fabric: string) => {
    const configured = specOf(fabric)?.materialId
    if (configured) return configured
    const count = new Map<string, number>()
    for (const o of sameFabric(fabric)) if (o.materialId) count.set(o.materialId, (count.get(o.materialId) ?? 0) + 1)
    return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  }
  const kgPerMetre = (fabric: string) => {
    const ratios = sameFabric(fabric).filter((o) => o.qty > 0 && o.yarnRequired > 0).map((o) => o.yarnRequired / o.qty).sort((a, b) => a - b)
    return ratios.length ? ratios[Math.floor(ratios.length / 2)] : (YARN_PER_METRE[fabric.trim().toLowerCase()] ?? 0)
  }
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    if (k === 'pricePerUnit') setPriceEdited(true)
    setForm((f) => {
      const next = { ...f, [k]: e.target.value }
      // A new fabric clears a yarn picked by hand for the previous one.
      if (k === 'fabricType') next.materialId = ''
      const yarn = next.materialId || usualYarn(next.fabricType)
      if ((k === 'fabricType' || k === 'materialId') && !priceEdited && next.fabricType && yarn && !specOf(next.fabricType)) {
        const price = typicalPrice(next.fabricType, yarn)
        if (price) next.pricePerUnit = String(price)
      }
      return next
    })
  }
  // The deadline is worked out by the delivery panel, not typed: see components/DeliveryEstimate.
  const [delivery, setDelivery] = useState<Delivery>({ estimate: null, committed: '', reason: '', valid: false })
  const newBuyer = form.buyerId === NEW
  // Worked out on every render, so it is right even if the order history loads after the fabric was picked.
  // The yarn type is pre-filled with the one this fabric is usually made from; a hand pick wins.
  const usual = usualYarn(form.fabricType)
  const materialId = form.materialId || usual
  // With Config figures: yarn = metres x yarn per metre x (1 + wastage %), price from the fabric's
  // price plus any size or rush band. The delivery estimate gets the yarn before the rush band,
  // since the deadline it picks is what decides the rush band.
  const spec = specOf(form.fabricType)
  const daysToDeadline = delivery.committed ? Math.round((Date.parse(delivery.committed) - Date.parse(toISODate(new Date()))) / 86400000) : null
  const q = spec ? quote(spec, config.data!.rules, { qty: Number(form.qty), daysToDeadline }) : null
  const qBase = spec ? quote(spec, config.data!.rules, { qty: Number(form.qty), daysToDeadline: null }) : null
  const yarnKg = q ? q.yarnKg : Number(form.qty) > 0 ? Math.round(Number(form.qty) * kgPerMetre(form.fabricType)) : 0
  const estimateYarnKg = qBase ? qBase.yarnKg : yarnKg
  const price = priceEdited || !q ? form.pricePerUnit : String(q.price)
  const mat = materials.data?.find((m) => m.id === materialId)
  const ready = Boolean(form.fabricType) && Number(form.qty) >= MIN_QTY && Boolean(materialId) && yarnKg > 0
  const shortBy = mat ? Math.max(0, yarnKg - mat.qtyInStock) : 0

  // The item being typed, once it is complete and has a delivery date.
  const current: Item | null = ready && delivery.valid ? { fabricType: form.fabricType, materialId, qty: Number(form.qty), yarnKg, price: Number(price), deadline: delivery.committed } : null
  const blank = !form.fabricType && !form.qty
  // Enough to save: at least one item, and nothing left half-typed.
  const canSave = !!current || (items.length > 0 && blank)
  const total = [...items, ...(current ? [current] : [])].reduce((sum, it) => sum + it.qty * it.price, 0)
  // The latest delivery date among the items already added.
  const lastDelivery = items.reduce((latest, it) => (it.deadline > latest ? it.deadline : latest), '')

  // Keeps the client, clears the fabric fields for the next item.
  function addItem() {
    if (!current) return
    setItems((list) => [...list, current])
    setForm((f) => ({ ...EMPTY, buyerId: f.buyerId, buyerName: f.buyerName, buyerAddress: f.buyerAddress }))
    setPriceEdited(false)
    setDelivery({ estimate: null, committed: '', reason: '', valid: false })
  }

  // Puts an added item back into the fields to change it. Whatever was being typed is kept:
  // a finished item joins the list, a half-typed one is replaced.
  function editItem(n: number) {
    const it = items[n]
    setItems((list) => [...list.filter((_, k) => k !== n), ...(current ? [current] : [])])
    setForm((f) => ({ ...EMPTY, buyerId: f.buyerId, buyerName: f.buyerName, buyerAddress: f.buyerAddress, fabricType: it.fabricType, materialId: it.materialId, qty: String(it.qty), pricePerUnit: String(it.price) }))
    setPriceEdited(true)
    setDelivery({ estimate: null, committed: '', reason: '', valid: false })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    setBusy(true)
    // Saved one by one; anything already saved leaves the list, so a retry never saves it twice.
    let left = [...items, ...(current ? [current] : [])]
    const made: string[] = []
    try {
      // A new client is saved first and stays selected, so a retry never creates it twice.
      let { buyerId } = form
      if (newBuyer) {
        buyerId = (await api<Ref>('/buyers', { method: 'POST', body: { name: form.buyerName, address: form.buyerAddress.trim() || undefined } })).id
        setForm((f) => ({ ...f, buyerId }))
        buyers.reload()
      }
      for (const it of [...left]) {
        const order = await api<Order>('/orders', {
          method: 'POST',
          body: { buyerId, materialId: it.materialId, fabricType: it.fabricType, deadline: it.deadline, qty: it.qty, yarnRequired: it.yarnKg, pricePerUnit: it.price },
        })
        made.push(order.orderNo)
        left = left.slice(1)
      }
      toast.success(made.length === 1 ? `${made[0]} created` : `${made.length} orders created`, { description: made.length === 1 ? `Delivery by ${formatDate(current ? current.deadline : items[0].deadline)}.` : made.join(', ') })
      onSaved()
      onOpenChange(false)
      setForm(EMPTY)
      setItems([])
    } catch (err) {
      // Keep what is still unsaved on screen, with the form cleared so nothing is entered twice.
      if (made.length) {
        setItems(left)
        setForm((f) => ({ ...EMPTY, buyerId: f.buyerId, buyerName: f.buyerName, buyerAddress: f.buyerAddress }))
        toast.message(`${made.join(', ')} saved. The rest is still here.`)
      }
      const duplicate = err instanceof ApiError && err.code === 'CONFLICT'
      toast.error(duplicate ? 'That client already exists. Pick it from the list.' : err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New order</DialogTitle>
        </DialogHeader>
        <form id="order" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
          <Field label="Client" htmlFor="buyerId">
            <select id="buyerId" required className={selectClass} value={form.buyerId} onChange={set('buyerId')}>
              <option value="">Select client</option>
              {buyers.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              <option value={NEW}>+ Add new client</option>
            </select>
          </Field>
          </div>
          {newBuyer && (
            <div className="sm:col-span-2">
              <Field label="Client name" htmlFor="buyerName">
                <Input id="buyerName" required autoFocus placeholder="Arvind Garments" value={form.buyerName} onChange={set('buyerName')} />
              </Field>
            </div>
          )}
          {newBuyer && (
            <div className="sm:col-span-2">
              <Field label="Delivery address" htmlFor="buyerAddress" hint="Where this client's fabric is delivered.">
                <Input id="buyerAddress" required maxLength={300} placeholder="Plot 12, GIDC Estate, Surat, Gujarat 395003" value={form.buyerAddress} onChange={set('buyerAddress')} />
              </Field>
            </div>
          )}
          {items.length > 0 && (
            <div className="space-y-1.5 sm:col-span-2">
              <p className="text-sm font-medium">Items in this order</p>
              <ul className="divide-y divide-border rounded-lg bg-zinc-50 px-3 text-sm">
                {items.map((it, n) => (
                  <li key={n} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 leading-tight">
                      <span className="font-medium">{it.fabricType}</span> · {formatQty(it.qty)}
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatINR(it.qty * it.price)} · delivery by {formatDate(it.deadline)}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <Button type="button" size="xs" variant="ghost" onClick={() => editItem(n)}>
                        Edit
                      </Button>
                      <Button type="button" size="xs" variant="ghost" className="text-problem hover:text-problem" onClick={() => setItems((list) => list.filter((_, k) => k !== n))}>
                        Remove
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* One line per item: what, how much, at what price. */}
          <div className="grid items-start gap-4 sm:col-span-2 sm:grid-cols-3">
            <Field label={items.length ? `Item ${items.length + 1}` : 'Fabric'} htmlFor="fabricType">
              <select id="fabricType" required={items.length === 0} className={selectClass} value={form.fabricType} onChange={set('fabricType')}>
                <option value="">Select fabric</option>
                {fabricTypes.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Field>
          <Field label="Quantity (m)" htmlFor="qty" hint={form.qty && Number(form.qty) < MIN_QTY ? <span className="text-problem">Minimum {MIN_QTY} m.</span> : undefined}>
            <Input id="qty" type="number" min={MIN_QTY} step="1" inputMode="numeric" required={items.length === 0 || !!form.fabricType} value={form.qty} onChange={set('qty')} />
          </Field>
          <Field
            label="Price (₹/m)"
            htmlFor="pricePerUnit"
            hint={
              priceEdited
                ? undefined
                : q
                  ? q.applied.length
                    ? `List price ${q.pricePct > 0 ? '+' : ''}${q.pricePct}% (${q.applied.map((r) => (r.kind === 'QUANTITY' ? `under ${r.below.toLocaleString('en-IN')} m` : `deadline under ${r.below} days`)).join(', ')})`
                    : 'List price for this fabric'
                  : form.pricePerUnit
                    ? 'Usual price'
                    : undefined
            }
          >
            <Input id="pricePerUnit" type="number" min="0.01" step="0.01" inputMode="decimal" required={items.length === 0 || !!form.fabricType} value={price} onChange={set('pricePerUnit')} />
          </Field>
          </div>
          {/* Always right under the item line; it fills in by itself once a fabric is picked. */}
          <div className="sm:col-span-2">
              <Field
                label="Yarn type"
                htmlFor="materialId"
                hint={
                  !form.fabricType
                    ? 'Filled in from the fabric.'
                    : past.loading
                    ? 'Finding the usual yarn…'
                    : !usual
                      ? 'This fabric has not been ordered before, so pick the yarn it is made from.'
                      : materialId === usual
                        ? `Usual yarn for ${form.fabricType}, change it if needed`
                        : `Changed from the usual yarn for ${form.fabricType}`
                }
              >
                <select id="materialId" required={!!form.fabricType} disabled={!form.fabricType} className={cn(selectClass, 'disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-muted-foreground')} value={form.fabricType ? materialId : ''} onChange={set('materialId')}>
                  <option value="">{form.fabricType ? 'Select yarn' : 'Pick a fabric first'}</option>
                  {materials.data?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.yarnType} · {m.colour}
                    </option>
                  ))}
                </select>
              </Field>
          </div>
          <div className="sm:col-span-2">
            {/* A full-width row, the way order forms usually offer the next line. */}
            <button
              type="button"
              disabled={!current}
              onClick={addItem}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 text-sm font-medium text-ink-2 transition-colors outline-none hover:border-brand hover:bg-brand-tint hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-zinc-300 disabled:hover:bg-transparent disabled:hover:text-ink-2"
            >
              <Plus className="size-4" />
              Add another item
            </button>
          </div>
          {mat && yarnKg > 0 && (
            <p className="text-xs sm:col-span-2">
              <span className="text-muted-foreground">
                Uses {formatQty(yarnKg, 'kg')} of {mat.yarnType}.{' '}
              </span>
              {shortBy > 0 ? (
                <span className="font-medium text-problem">Short {formatQty(shortBy, 'kg')}.</span>
              ) : (
                <span className="font-medium text-good">In stock.</span>
              )}
            </p>
          )}
          <div className="sm:col-span-2">
            {ready ? (
              <DeliveryEstimate key={`${items.length}-${form.fabricType}`} qty={Number(form.qty)} yarnKg={estimateYarnKg} materialId={materialId} onChange={setDelivery} />
            ) : (
              <div className="rounded-xl bg-zinc-50 p-3 leading-tight">
                <p className="text-xs text-muted-foreground">Delivery by</p>
                {items.length > 0 ? (
                  // Nothing new typed yet: show when the items already added will be delivered.
                  <>
                    <p className="text-lg font-semibold tracking-tight text-brand">{formatDate(lastDelivery)}</p>
                    <p className="text-xs text-muted-foreground">{items.length === 1 ? 'For the item above' : `When the last of the ${items.length} items above is ready`}</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Pick a fabric and quantity to see the date.</p>
                )}
              </div>
            )}
          </div>
        </form>
        <DialogFooter className="items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Order value:{' '}
            <span className="font-semibold text-ink tabular-nums">
              {total > 0 ? formatINR(total) : '—'}
            </span>
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form="order" disabled={busy || !canSave}>
              {items.length + (current ? 1 : 0) > 1 ? `Create ${items.length + (current ? 1 : 0)} orders` : 'Create order'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

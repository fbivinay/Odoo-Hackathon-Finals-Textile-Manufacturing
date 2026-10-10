import { useMemo, useState, type FormEvent } from 'react'
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
import { dayFromToday, formatDate, formatINR, formatMoney, formatQty, toISODate } from '@/lib/format'
import { orderBoxes } from '@/lib/orderStats'
import { api, ApiError } from '@/lib/api'
import { useAll, useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import type { Dispatch, Order, OrderStatus, Planning, RawMaterial, Ref } from '@/types'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const THIS_MONTH = new Date().toISOString().slice(0, 7)
const YEARS = Array.from({ length: +THIS_MONTH.slice(0, 4) - 2022 }, (_, i) => String(+THIS_MONTH.slice(0, 4) - i))
const STATUS_GROUPS: { label: string; match: (s: OrderStatus) => boolean }[] = [
  { label: 'All statuses', match: () => true },
  { label: 'Open', match: (s) => !['DISPATCHED', 'CANCELLED'].includes(s) },
  { label: 'Not started', match: (s) => s === 'PENDING' },
  { label: 'In production', match: (s) => ['SPINNING', 'WEAVING', 'DYEING'].includes(s) },
  { label: 'Quality check', match: (s) => s === 'QC' },
  { label: 'Ready', match: (s) => s === 'READY' },
  { label: 'Dispatched', match: (s) => s === 'DISPATCHED' },
  { label: 'Cancelled', match: (s) => s === 'CANCELLED' },
]
const PAGE = 50
const plural = (n: number, word: string) => `${n.toLocaleString('en-IN')} ${word}${n === 1 ? '' : 's'}`

export function Orders() {
  const { user } = useSession()
  const navigate = useNavigate()
  const canCreate = actsAs(user, 'STORE', 'DISPATCH')
  const [open, setOpen] = useState(false)

  // Period for the boxes: a month, or the whole year.
  const [year, setYear] = useState(THIS_MONTH.slice(0, 4))
  const [mm, setMm] = useState(THIS_MONTH.slice(5, 7))
  const whole = mm === 'all'
  const from = whole ? `${year}-01-01` : `${year}-${mm}-01`
  const to = whole ? `${year}-12-31` : new Date(Date.UTC(+year, +mm, 0)).toISOString().slice(0, 10)
  const periodLabel = whole ? year : `${MONTHS[+mm - 1]} ${year}`

  const orders = useAll<Order>('/orders')
  const dispatches = useAll<Dispatch>(`/dispatch?from=${from}`)
  const plan = useApi<Planning>('/planning/schedule')
  const materials = useApi<RawMaterial[]>('/materials?category=YARN')
  const yarnOf = (id: string | null) => materials.data?.find((m) => m.id === id)
  const shortOf = useMemo(() => new Map(plan.data?.orders.filter((o) => o.yarnShortBy > 0).map((o) => [o.id, o.yarnShortBy])), [plan.data])

  const today = toISODate(new Date())
  const boxes = useMemo(
    () =>
      orders.rows &&
      dispatches.rows &&
      orderBoxes(
        orders.rows,
        dispatches.rows.map((d) => ({ ...d, orderId: d.order.id })),
        { from, to, today, waitingForYarn: plan.data?.orders.filter((o) => o.status === 'PENDING' && o.yarnShortBy > 0).length ?? 0 },
      ),
    [orders.rows, dispatches.rows, plan.data, from, to, today],
  )
  const loadingBoxes = !boxes

  // The list: every order, searchable and filterable.
  const [q, setQ] = useState('')
  const [group, setGroup] = useState(0)
  const [buyer, setBuyer] = useState('')
  const [fabric, setFabric] = useState('')
  const [lateOnly, setLateOnly] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const all = useMemo(() => orders.rows ?? [], [orders.rows])
  const buyers = useMemo(() => [...new Map(all.map((o) => [o.buyer.id, o.buyer.name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [all])
  const fabrics = useMemo(() => [...new Set(all.map((o) => o.fabricType))].sort(), [all])
  const needle = q.trim().toLowerCase()
  const rows = all
    .filter(
    (o) =>
      STATUS_GROUPS[group].match(o.status) &&
      (!buyer || o.buyer.id === buyer) &&
      (!fabric || o.fabricType === fabric) &&
      (!lateOnly || o.isDelayed) &&
      (!needle || [o.orderNo, o.buyer.name, o.fabricType, o.colour].some((x) => x.toLowerCase().includes(needle))),
    )
    .sort((a, b) => b.orderNo.localeCompare(a.orderNo))
  const filtersOn = Boolean(needle || group || buyer || fabric || lateOnly)
  const resetPaging = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setShown(PAGE)
  }

  const columns: ColumnDef<Order>[] = [
    {
      accessorKey: 'orderNo',
      header: 'Order',
      cell: ({ row: { original: o } }) => (
        <div className="leading-tight">
          <p className="font-medium">{o.orderNo}</p>
          <p className="text-xs text-muted-foreground">Ordered {formatDate(o.createdAt)}</p>
        </div>
      ),
    },
    { id: 'client', header: 'Client', accessorFn: (o) => o.buyer.name },
    {
      id: 'fabric',
      header: 'Fabric',
      accessorFn: (o) => `${o.fabricType} ${o.colour}`,
      cell: ({ row: { original: o } }) => {
        const y = yarnOf(o.materialId)
        return (
          <div className="leading-tight">
            <p>{[o.fabricType, o.colour].filter(Boolean).join(' · ')}</p>
            <p className="text-xs text-muted-foreground">
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
      accessorFn: (o) => o.deadline,
      cell: ({ row: { original: o } }) =>
        o.isDelayed ? <span className="font-medium text-problem">{formatDate(o.deadline)} · late</span> : formatDate(o.deadline),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row: { original: o } }) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <StatusPill status={o.status} />
          {shortOf.has(o.id) && <Pill tone="problem">Needs {formatQty(shortOf.get(o.id)!, 'kg')} yarn</Pill>}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
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

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Orders at a glance</p>
          <h2 className="section-head mt-1">{periodLabel}</h2>
        </div>
        <div className="flex gap-2">
          <select aria-label="Month" className={cn(selectClass, 'w-36 bg-surface')} value={mm} onChange={(e) => setMm(e.target.value)}>
            <option value="all">Whole year</option>
            {MONTHS.map((name, i) => {
              const v = String(i + 1).padStart(2, '0')
              return (
                <option key={v} value={v} disabled={`${year}-${v}` > THIS_MONTH}>
                  {name}
                </option>
              )
            })}
          </select>
          <select
            aria-label="Year"
            className={cn(selectClass, 'w-24 bg-surface')}
            value={year}
            onChange={(e) => {
              setYear(e.target.value)
              if (!whole && `${e.target.value}-${mm}` > THIS_MONTH) setMm(THIS_MONTH.slice(5, 7))
            }}
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>
      {(orders.error || dispatches.error) && <p className="text-sm text-problem">{orders.error || dispatches.error}</p>}

      <section className="figures-panel">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Figure
            label="Orders received"
            value={plural(boxes?.received.count ?? 0, 'order')}
            note={`${formatQty(boxes?.received.metres ?? 0)} · ${formatMoney(boxes?.received.value ?? 0)}`}
            loading={loadingBoxes}
          />
          <Figure
            label="Open orders"
            value={plural(boxes?.open.count ?? 0, 'order')}
            note={`Today: ${boxes?.open.inProduction ?? 0} in production · ${boxes?.open.ready ?? 0} ready · ${boxes?.open.notStarted ?? 0} not started`}
            loading={loadingBoxes}
          />
          <Figure
            label="Waiting to start"
            tone={boxes?.waiting.forYarn ? 'watch' : undefined}
            value={plural(boxes?.waiting.count ?? 0, 'order')}
            note={boxes?.waiting.forYarn ? `${boxes.waiting.forYarn} held up waiting for yarn` : 'None held up for yarn'}
            loading={loadingBoxes}
          />
          <Figure
            label="Dispatched"
            tone="good"
            value={plural(boxes?.dispatched.count ?? 0, 'order')}
            note={`Fully sent · ${formatQty(boxes?.dispatched.metres ?? 0)} shipped · ${formatMoney(boxes?.dispatched.invoiced ?? 0)} invoiced`}
            loading={loadingBoxes}
          />
          <Figure
            label="Late / at risk"
            tone={boxes?.late.count ? 'problem' : undefined}
            value={plural(boxes?.late.count ?? 0, 'order')}
            note={`Past deadline today · ${boxes?.late.dueSoon ?? 0} more due in 7 days`}
            loading={loadingBoxes}
          />
          <Figure
            label="On-time delivery"
            tone={boxes?.onTime.pct == null ? undefined : boxes.onTime.pct >= 90 ? 'good' : boxes.onTime.pct >= 75 ? 'watch' : 'problem'}
            value={boxes?.onTime.pct == null ? '—' : `${boxes.onTime.pct}%`}
            note={boxes?.onTime.avgDays == null ? 'Nothing dispatched in this period' : `Average ${boxes.onTime.avgDays} days from order to dispatch`}
            loading={loadingBoxes}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-head">All orders</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search orders" placeholder="Search order no., client or fabric" className="pl-8" value={q} onChange={(e) => resetPaging(setQ)(e.target.value)} />
          </div>
          <select aria-label="Status" className={cn(selectClass, 'w-40 bg-surface')} value={group} onChange={(e) => resetPaging(setGroup)(+e.target.value)}>
            {STATUS_GROUPS.map((g, i) => (
              <option key={g.label} value={i}>
                {g.label}
              </option>
            ))}
          </select>
          <select aria-label="Client" className={cn(selectClass, 'w-44 bg-surface')} value={buyer} onChange={(e) => resetPaging(setBuyer)(e.target.value)}>
            <option value="">All clients</option>
            {buyers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select aria-label="Fabric" className={cn(selectClass, 'w-36 bg-surface')} value={fabric} onChange={(e) => resetPaging(setFabric)(e.target.value)}>
            <option value="">All fabrics</option>
            {fabrics.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="size-4 accent-[#714b67]" checked={lateOnly} onChange={(e) => resetPaging(setLateOnly)(e.target.checked)} />
            Late only
          </label>
          {filtersOn && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setQ('')
                setGroup(0)
                setBuyer('')
                setFabric('')
                setLateOnly(false)
                setShown(PAGE)
              }}
            >
              Clear
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {plural(rows.length, 'order')}
          {filtersOn && ` of ${all.length.toLocaleString('en-IN')}`} · click an order for its full details
        </p>
        <DataTable
          columns={columns}
          data={rows.slice(0, shown)}
          loading={orders.loading}
          onRowClick={(o) => navigate(`/orders/${o.id}`)}
          empty={
            <EmptyState
              icon={ShoppingCart}
              line={filtersOn ? 'No orders match these filters.' : 'No orders yet.'}
              actionLabel={canCreate && !filtersOn ? 'New order' : undefined}
              onAction={canCreate && !filtersOn ? () => setOpen(true) : undefined}
            />
          }
        />
        {rows.length > shown && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({(rows.length - shown).toLocaleString('en-IN')} left)
            </Button>
          </div>
        )}
      </section>
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
const EMPTY = { buyerId: '', buyerName: '', materialId: '', fabricType: '', qty: '', pricePerUnit: '', deadline: '' }

function OrderDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const buyers = useApi<Ref[]>(open ? '/buyers' : null)
  const materials = useApi<RawMaterial[]>(open ? '/materials?category=YARN' : null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  // Likewise the price follows the usual price for fabric × yarn until the user types one.
  const [priceEdited, setPriceEdited] = useState(false)
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
      if ((k === 'fabricType' || k === 'materialId') && !priceEdited && next.fabricType && yarn) {
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
  const yarnKg = Number(form.qty) > 0 ? Math.round(Number(form.qty) * kgPerMetre(form.fabricType)) : 0
  const mat = materials.data?.find((m) => m.id === materialId)
  const ready = Boolean(form.fabricType) && Number(form.qty) > 0 && Boolean(materialId) && yarnKg > 0
  const shortBy = mat ? Math.max(0, yarnKg - mat.qtyInStock) : 0

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!delivery.valid) return
    setBusy(true)
    try {
      // A new buyer is saved first and stays selected, so a retry never creates it twice.
      let { buyerId } = form
      if (newBuyer) {
        buyerId = (await api<Ref>('/buyers', { method: 'POST', body: { name: form.buyerName } })).id
        setForm((f) => ({ ...f, buyerId }))
        buyers.reload()
      }
      const order = await api<Order>('/orders', {
        method: 'POST',
        body: {
          buyerId,
          materialId,
          fabricType: form.fabricType,
          deadline: delivery.committed,
          qty: Number(form.qty),
          yarnRequired: yarnKg,
          pricePerUnit: Number(form.pricePerUnit),
        },
      })
      toast.success(`${order.orderNo} created`, { description: `Delivery by ${formatDate(delivery.committed)}.` })
      onSaved()
      onOpenChange(false)
      setForm(EMPTY)
    } catch (err) {
      const duplicate = err instanceof ApiError && err.code === 'CONFLICT'
      toast.error(duplicate ? 'That buyer already exists. Pick it from the list.' : err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New customer order</DialogTitle>
        </DialogHeader>
        <form id="order" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
          <Field label="Buyer" htmlFor="buyerId">
            <select id="buyerId" required className={selectClass} value={form.buyerId} onChange={set('buyerId')}>
              <option value="">Select buyer…</option>
              {buyers.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              <option value={NEW}>+ Add new buyer</option>
            </select>
          </Field>
          </div>
          {newBuyer && (
            <div className="sm:col-span-2">
              <Field label="Buyer name" htmlFor="buyerName">
                <Input id="buyerName" required autoFocus placeholder="Arvind Garments" value={form.buyerName} onChange={set('buyerName')} />
              </Field>
            </div>
          )}
          <div className="sm:col-span-2">
            <Field label="Fabric type" htmlFor="fabricType">
              <select id="fabricType" required className={selectClass} value={form.fabricType} onChange={set('fabricType')}>
                <option value="">Select fabric…</option>
                {FABRIC_TYPES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Quantity (m)" htmlFor="qty">
            <Input id="qty" type="number" min="1" step="1" inputMode="numeric" required value={form.qty} onChange={set('qty')} />
          </Field>
          <Field label="Price (₹/m)" htmlFor="pricePerUnit" hint={form.pricePerUnit && !priceEdited ? 'Usual price' : undefined}>
            <Input id="pricePerUnit" type="number" min="0.01" step="0.01" inputMode="decimal" required value={form.pricePerUnit} onChange={set('pricePerUnit')} />
          </Field>
          {form.fabricType && (
            <div className="sm:col-span-2">
              <Field
                label="Yarn type"
                htmlFor="materialId"
                hint={
                  past.loading
                    ? 'Finding the usual yarn…'
                    : !usual
                      ? 'This fabric has not been ordered before, so pick the yarn it is made from.'
                      : materialId === usual
                        ? `Usual yarn for ${form.fabricType}, change it if needed`
                        : `Changed from the usual yarn for ${form.fabricType}`
                }
              >
                <select id="materialId" required className={selectClass} value={materialId} onChange={set('materialId')}>
                  <option value="">Select yarn…</option>
                  {materials.data?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.yarnType} · {m.colour}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
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
              <DeliveryEstimate qty={Number(form.qty)} yarnKg={yarnKg} materialId={materialId} onChange={setDelivery} />
            ) : (
              <div className="rounded-xl border bg-ground/60 p-4">
                <p className="text-sm font-medium">Delivery date</p>
                <p className="mt-1 text-sm text-muted-foreground">Choose a fabric and quantity to see the estimate.</p>
              </div>
            )}
          </div>
        </form>
        <DialogFooter className="items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Order value:{' '}
            <span className="font-semibold text-ink tabular-nums">
              {Number(form.qty) * Number(form.pricePerUnit) > 0 ? formatINR(Number(form.qty) * Number(form.pricePerUnit)) : '—'}
            </span>
          </p>
          <Button type="submit" form="order" disabled={busy || !ready || !delivery.valid}>
            {busy ? 'Saving…' : 'Create order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

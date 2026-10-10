import { useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PackageSearch, Plus, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from '@/auth/session'
import { PageHead } from '@/components/PageHead'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { DeliveryEstimate, type Delivery } from '@/components/DeliveryEstimate'
import { Field, selectClass } from '@/components/Field'
import { Pill, StatusPill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatDate, formatINR, formatQty } from '@/lib/format'
import { yarnNeed } from '@/lib/textile'
import { api, ApiError } from '@/lib/api'
import { useApi, usePaged } from '@/lib/useApi'
import { LoadMore } from '@/components/LoadMore'
import { dayFromToday } from '@/lib/format'
import type { MaterialIssue, Order, OrderStatus, RawMaterial, Ref } from '@/types'

const trackingUrl = (token: string) => `${location.origin}/track/${token}`

// Yarn is issued by the system when an order is taken or a delivery arrives, so the only
// thing worth showing is an order still waiting for yarn the store doesn't have.
function YarnCheck({ o, material, issued }: { o: Order; material?: RawMaterial; issued: number }) {
  if (!material || !o.yarnRequired || ['DISPATCHED', 'CANCELLED'].includes(o.status)) return null
  const { remaining } = yarnNeed(o.yarnRequired, issued, 0)
  return remaining > 0 ? <Pill tone="problem">Short {formatQty(remaining, material.unit)}</Pill> : null
}

const OPEN = (s: OrderStatus) => !['DISPATCHED', 'CANCELLED'].includes(s)
const FILTERS = ['All Orders', 'Open', 'Short of yarn', 'Ready for dispatch'] as const

export function Orders() {
  const { user } = useSession()
  // "Recent" is the working order book (due from 90 days ago on); a year shows everything placed that year.
  const [period, setPeriod] = useState('recent')
  const orders = usePaged<Order>(
    period === 'recent' ? `/orders?dueFrom=${dayFromToday(-90)}` : `/orders?from=${period}-01-01&to=${period}-12-31`,
    period === 'recent' ? 500 : 250,
  )
  const materials = useApi<RawMaterial[]>('/materials')
  const issues = useApi<MaterialIssue[]>(`/materials/issues?from=${dayFromToday(-180)}&limit=500`)
  const [filter, setFilter] = useState(0)
  const [open, setOpen] = useState(false)
  const canCreate = ['OWNER', 'STORE', 'DISPATCH'].includes(user?.role ?? '')
  const issuedTo = (oid: string) => (issues.data ?? []).filter((i) => i.orderId === oid).reduce((a, i) => a + i.qty, 0)

  // Yarn still to be issued for an open order.
  const needsYarn = (o: Order) => OPEN(o.status) && o.yarnRequired > 0 && yarnNeed(o.yarnRequired, issuedTo(o.id), 0).remaining > 0
  const matches = [() => true, (o: Order) => OPEN(o.status), needsYarn, (o: Order) => o.status === 'READY']

  const columns: ColumnDef<Order>[] = [
    {
      accessorKey: 'orderNo',
      header: 'Order',
      cell: ({ row: { original: o } }) => (
        <div className="leading-tight">
          <p className="font-medium">{o.orderNo}</p>
          <p className="text-xs text-muted-foreground">{o.buyer.name}</p>
        </div>
      ),
    },
    { id: 'fabric', header: 'Fabric', accessorFn: (o) => [o.fabricType, o.colour].filter(Boolean).join(' · ') },
    { id: 'qty', header: 'Qty', accessorFn: (o) => o.qty, cell: ({ row: { original: o } }) => formatQty(o.qty) },
    {
      id: 'deadline',
      header: 'Deadline',
      accessorFn: (o) => o.deadline,
      cell: ({ row: { original: o } }) =>
        o.isDelayed ? <span className="font-medium text-problem">{formatDate(o.deadline)} · late</span> : formatDate(o.deadline),
    },
    { accessorKey: 'status', header: 'Status', cell: ({ row: { original: o } }) => <StatusPill status={o.status} /> },
    { id: 'yarn', header: 'Yarn', enableSorting: false, cell: ({ row: { original: o } }) => (
        <YarnCheck o={o} material={materials.data?.find((m) => m.id === o.materialId)} issued={issuedTo(o.id)} />
      ),
    },
    {
      id: 'track',
      header: 'Track',
      enableSorting: false,
      cell: ({ row: { original: o } }) => (
        <Button variant="ghost" size="icon-xs" title="Open tracking page" aria-label={`Open tracking page for ${o.orderNo}`} asChild>
          <a href={trackingUrl(o.trackingToken)} target="_blank" rel="noreferrer">
            <PackageSearch className="size-3.5" />
          </a>
        </Button>
      ),
    },
  ]

  const rows = orders.rows.filter(matches[filter])

  return (
    <div className="space-y-4">
      <PageHead
        eyebrow="From buyers"
        title="Customer Orders"
        actions={
          canCreate && (
            <Button className="gap-1.5" onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              New customer order
            </Button>
          )
        }
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((label, i) => (
            <Button key={label} size="sm" variant={i === filter ? 'secondary' : 'ghost'} onClick={() => setFilter(i)}>
              {label}
              <span className="ml-1 text-xs text-muted-foreground">{orders.rows.filter(matches[i]).length}</span>
            </Button>
          ))}
        </div>
        <select aria-label="Period" className={`${selectClass} w-28! shrink-0 bg-surface`} value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="recent">Current</option>
          {Array.from({ length: new Date().getFullYear() - 2022 }, (_, i) => String(new Date().getFullYear() - i)).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      {orders.error && <p className="text-sm text-problem">{orders.error}</p>}
      <DataTable
        columns={columns}
        data={rows}
        loading={orders.loading}
        // All Orders lists the newest first; the working filters list the most urgent deadline first.
        key={filter === 0 ? 'newest' : 'urgent'}
        initialSorting={filter === 0 ? [{ id: 'orderNo', desc: true }] : [{ id: 'deadline', desc: false }]}
        empty={
          <EmptyState
            icon={ShoppingCart}
            line={['No orders in this period.', 'No open orders.', 'No order is short of yarn.', 'No orders are ready for dispatch.'][filter]}
            actionLabel={canCreate && filter < 2 ? 'New customer order' : undefined}
            onAction={canCreate && filter < 2 ? () => setOpen(true) : undefined}
          />
        }
      />
      <LoadMore hasMore={orders.hasMore} more={orders.more} />
      {canCreate && <OrderDialog open={open} onOpenChange={setOpen} onSaved={orders.reload} />}
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
      const yarn = usualYarn(next.fabricType) || next.materialId
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
  const materialId = usualYarn(form.fabricType) || form.materialId
  const yarnKg = Number(form.qty) > 0 ? Math.round(Number(form.qty) * kgPerMetre(form.fabricType)) : 0
  const mat = materials.data?.find((m) => m.id === materialId)
  // Only a fabric nobody has ordered before needs its yarn picked by hand.
  const askYarn = Boolean(form.fabricType) && !past.loading && !usualYarn(form.fabricType)
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
          {askYarn && (
            <div className="sm:col-span-2">
              <Field label="Yarn" htmlFor="materialId" hint="This fabric has not been ordered before, so pick the yarn it is made from.">
                <select id="materialId" required className={selectClass} value={form.materialId} onChange={set('materialId')}>
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

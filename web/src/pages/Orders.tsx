import { useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PackageSearch, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from '@/auth/session'
import { PageHead } from '@/components/PageHead'
import { DataTable } from '@/components/DataTable'
import { DeliveryEstimate, type Delivery } from '@/components/DeliveryEstimate'
import { Field, selectClass } from '@/components/Field'
import { Pill, StatusPill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatDate, formatINR, formatQty } from '@/lib/format'
import { yarnNeed } from '@/lib/textile'
import { api, ApiError } from '@/lib/api'
import { mutate, useApi, usePaged } from '@/lib/useApi'
import { LoadMore } from '@/components/LoadMore'
import { dayFromToday } from '@/lib/format'
import type { MaterialIssue, Order, OrderStatus, RawMaterial, Ref } from '@/types'

const trackingUrl = (token: string) => `${location.origin}/track/${token}`

// ponytail: each order is checked against current stock on its own; orders competing for
// the same yarn aren't netted against each other.
function YarnCheck({ o, material, issued, canIssue, onIssued }: { o: Order; material?: RawMaterial; issued: number; canIssue: boolean; onIssued: () => void }) {
  if (!material || !o.yarnRequired) return <span className="text-muted-foreground">—</span>
  const { remaining, shortBy } = yarnNeed(o.yarnRequired, issued, material.qtyInStock)
  if (remaining === 0) return <span className="text-muted-foreground">Issued</span>
  if (shortBy > 0) return <Pill tone="problem">Short {formatQty(shortBy, material.unit)}</Pill>
  if (!canIssue || ['DISPATCHED', 'CANCELLED'].includes(o.status)) return <Pill tone="good">Enough yarn</Pill>
  return (
    <Button
      size="xs"
      variant="outline"
      title={`${material.yarnType} · ${material.colour}`}
      onClick={async () => {
        if (await mutate('/materials/issues', 'POST', { materialId: material.id, orderId: o.id, qty: remaining }, `${formatQty(remaining, material.unit)} issued to ${o.orderNo}`)) onIssued()
      }}
    >
      Issue {formatQty(remaining, material.unit)}
    </Button>
  )
}

const OPEN = (s: OrderStatus) => !['DISPATCHED', 'CANCELLED'].includes(s)
const FILTERS = ['Open', 'Needs yarn', 'Ready', 'All'] as const

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
  const canIssue = user?.role === 'OWNER' || user?.role === 'STORE'
  const issuedTo = (oid: string) => (issues.data ?? []).filter((i) => i.orderId === oid).reduce((a, i) => a + i.qty, 0)
  const reloadYarn = () => {
    materials.reload()
    issues.reload()
  }

  // Yarn still to be issued for an open order.
  const needsYarn = (o: Order) => OPEN(o.status) && o.yarnRequired > 0 && yarnNeed(o.yarnRequired, issuedTo(o.id), 0).remaining > 0
  const matches = [(o: Order) => OPEN(o.status), needsYarn, (o: Order) => o.status === 'READY', () => true]

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
        <YarnCheck o={o} material={materials.data?.find((m) => m.id === o.materialId)} issued={issuedTo(o.id)} canIssue={canIssue} onIssued={reloadYarn} />
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
      <DataTable columns={columns} data={rows} loading={orders.loading} initialSorting={[{ id: 'deadline', desc: period !== 'recent' }]} />
      <LoadMore hasMore={orders.hasMore} more={orders.more} />
      {canCreate && <OrderDialog open={open} onOpenChange={setOpen} onSaved={orders.reload} />}
    </div>
  )
}

const NEW = '__new__'
// Typical yarn use per metre of fabric (kg/m), used to suggest "Yarn needed". The user can overwrite it.
const YARN_PER_METRE: Record<string, number> = {
  poplin: 0.11, cambric: 0.09, lawn: 0.07, twill: 0.2, denim: 0.45, canvas: 0.5, oxford: 0.17,
  chambray: 0.15, satin: 0.13, georgette: 0.08, 'linen suiting': 0.22, 'rayon print': 0.12,
}
const FABRIC_TYPES = ['Poplin', 'Cambric', 'Lawn', 'Twill', 'Denim', 'Canvas', 'Oxford', 'Chambray', 'Satin', 'Georgette', 'Linen Suiting', 'Rayon Print']
const EMPTY = { buyerId: '', buyerName: '', materialId: '', fabricType: '', qty: '', yarnRequired: '', pricePerUnit: '', deadline: '' }

function OrderDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const buyers = useApi<Ref[]>(open ? '/buyers' : null)
  const materials = useApi<RawMaterial[]>(open ? '/materials' : null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  // Until the user types their own figure, "Yarn needed" follows fabric type × quantity.
  const [yarnEdited, setYarnEdited] = useState(false)
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
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    if (k === 'yarnRequired') setYarnEdited(true)
    if (k === 'pricePerUnit') setPriceEdited(true)
    setForm((f) => {
      const next = { ...f, [k]: e.target.value }
      if ((k === 'fabricType' || k === 'materialId') && !priceEdited && next.fabricType && next.materialId) {
        const price = typicalPrice(next.fabricType, next.materialId)
        if (price) next.pricePerUnit = String(price)
      }
      const perMetre = YARN_PER_METRE[next.fabricType.trim().toLowerCase()]
      if ((k === 'fabricType' || k === 'qty') && !yarnEdited && perMetre && Number(next.qty) > 0) {
        next.yarnRequired = String(Math.round(Number(next.qty) * perMetre))
      }
      return next
    })
  }
  // The deadline is worked out by the delivery panel, not typed: see components/DeliveryEstimate.
  const [delivery, setDelivery] = useState<Delivery>({ estimate: null, committed: '', reason: '', valid: false })
  const newBuyer = form.buyerId === NEW
  const mat = materials.data?.find((m) => m.id === form.materialId)

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
          materialId: form.materialId,
          fabricType: form.fabricType,
          deadline: delivery.committed,
          qty: Number(form.qty),
          yarnRequired: Number(form.yarnRequired),
          pricePerUnit: Number(form.pricePerUnit),
        },
      })
      toast.success(`${order.orderNo} created, due ${delivery.committed}`, {
        description:
          delivery.committed !== delivery.estimate
            ? `System estimate ${delivery.estimate}. The estimate and the reason are not stored yet (no API field).`
            : 'Due date is the system estimate.',
      })
      onSaved()
      onOpenChange(false)
      setForm(EMPTY)
      setYarnEdited(false)
    } catch (err) {
      const duplicate = err instanceof ApiError && err.code === 'CONFLICT'
      toast.error(duplicate ? 'That buyer already exists. Pick it from the list.' : err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New customer order</DialogTitle>
        </DialogHeader>
        <form id="order" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
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
          <Field label="Price (₹/m)" htmlFor="pricePerUnit" hint={form.pricePerUnit && !priceEdited ? 'Usual price for this fabric and yarn, edit if needed' : undefined}>
            <Input id="pricePerUnit" type="number" min="0.01" step="0.01" inputMode="decimal" required value={form.pricePerUnit} onChange={set('pricePerUnit')} />
          </Field>
          <Field label="Yarn" htmlFor="materialId">
            <select id="materialId" required className={selectClass} value={form.materialId} onChange={set('materialId')}>
              <option value="">Select yarn…</option>
              {materials.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.yarnType} · {m.colour}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Yarn needed (kg)"
            htmlFor="yarnRequired"
            hint={mat && `${formatQty(mat.qtyInStock, 'kg')} in store`}
          >
            <Input id="yarnRequired" type="number" min="0.01" step="0.01" inputMode="decimal" required value={form.yarnRequired} onChange={set('yarnRequired')} />
          </Field>
          <div className="sm:col-span-2">
            <DeliveryEstimate qty={Number(form.qty) || 0} yarnKg={Number(form.yarnRequired) || 0} materialId={form.materialId} onChange={setDelivery} />
          </div>
        </form>
        <DialogFooter className="items-center sm:justify-between">
          <div className="rounded-lg bg-brand-tint px-4 py-2">
            <p className="text-xs text-ink-2">Order value</p>
            <p className="text-2xl font-semibold tracking-tight text-brand tabular-nums">
              {Number(form.qty) * Number(form.pricePerUnit) > 0 ? formatINR(Number(form.qty) * Number(form.pricePerUnit)) : '—'}
            </p>
          </div>
          <Button type="submit" form="order" disabled={busy || !delivery.valid}>
            {busy ? 'Saving…' : 'Create order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

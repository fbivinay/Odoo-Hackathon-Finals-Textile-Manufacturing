import { useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Link2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from '@/auth/session'
import { PageHead } from '@/components/PageHead'
import { DataTable } from '@/components/DataTable'
import { Field, selectClass } from '@/components/Field'
import { Pill, StatusPill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatDate, formatINR, formatQty, toISODate } from '@/lib/format'
import { yarnNeed } from '@/lib/textile'
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
      onClick={async () => {
        if (await mutate('/materials/issues', 'POST', { materialId: material.id, orderId: o.id, qty: remaining }, `${formatQty(remaining, material.unit)} issued to ${o.orderNo}`)) onIssued()
      }}
    >
      Issue {formatQty(remaining, material.unit)}
    </Button>
  )
}

const FILTERS: { label: string; match: (s: OrderStatus) => boolean }[] = [
  { label: 'Open', match: (s) => !['DISPATCHED', 'CANCELLED'].includes(s) },
  { label: 'All', match: () => true },
  { label: 'Pending', match: (s) => s === 'PENDING' },
  { label: 'In production', match: (s) => ['SPINNING', 'WEAVING', 'DYEING', 'QC'].includes(s) },
  { label: 'Ready', match: (s) => s === 'READY' },
  { label: 'Dispatched', match: (s) => s === 'DISPATCHED' },
]

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

  const columns: ColumnDef<Order>[] = [
    { accessorKey: 'orderNo', header: 'Order' },
    { id: 'buyer', header: 'Buyer', accessorFn: (o) => o.buyer.name },
    { id: 'fabric', header: 'Fabric', accessorFn: (o) => `${o.fabricType} · ${o.colour}` },
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
      header: '',
      enableSorting: false,
      cell: ({ row: { original: o } }) => (
        <Button
          variant="ghost"
          size="xs"
          className="gap-1"
          onClick={() => navigator.clipboard.writeText(trackingUrl(o.trackingToken)).then(() => toast.success('Tracking link copied'))}
        >
          <Link2 className="size-3" />
          Buyer link
        </Button>
      ),
    },
  ]

  const rows = orders.rows.filter((o) => FILTERS[filter].match(o.status))

  return (
    <div className="space-y-4">
      <PageHead
        eyebrow="Order book"
        title="Orders"
        lede="Each buyer's order with its deadline, where it is on the floor, and whether there is yarn to start it."
        actions={
          <select aria-label="Period" className={`${selectClass} w-40 bg-surface`} value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="recent">Current book</option>
            {Array.from({ length: new Date().getFullYear() - 2022 }, (_, i) => String(new Date().getFullYear() - i)).map((y) => (
              <option key={y} value={y}>
                Placed in {y}
              </option>
            ))}
          </select>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f, i) => (
            <Button key={f.label} size="sm" variant={i === filter ? 'secondary' : 'ghost'} onClick={() => setFilter(i)}>
              {f.label}
              <span className="ml-1 text-xs text-muted-foreground">{orders.rows.filter((o) => f.match(o.status)).length}</span>
            </Button>
          ))}
        </div>
        {canCreate && (
          <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            New order
          </Button>
        )}
      </div>
      {orders.error && <p className="text-sm text-problem">{orders.error}</p>}
      <DataTable columns={columns} data={rows} loading={orders.loading} initialSorting={[{ id: 'deadline', desc: period !== 'recent' }]} />
      <LoadMore hasMore={orders.hasMore} more={orders.more} />
      {canCreate && <OrderDialog open={open} onOpenChange={setOpen} onSaved={orders.reload} />}
    </div>
  )
}

const EMPTY = { buyerId: '', materialId: '', fabricType: '', colour: '', qty: '', yarnRequired: '', pricePerUnit: '', deadline: '' }

function OrderDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const buyers = useApi<Ref[]>(open ? '/buyers' : null)
  const materials = useApi<RawMaterial[]>(open ? '/materials' : null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const mat = materials.data?.find((m) => m.id === form.materialId)
  const short = mat && form.yarnRequired ? yarnNeed(Number(form.yarnRequired), 0, mat.qtyInStock).shortBy : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await mutate(
      '/orders',
      'POST',
      { ...form, materialId: form.materialId || undefined, qty: Number(form.qty), yarnRequired: Number(form.yarnRequired), pricePerUnit: Number(form.pricePerUnit) },
      'Order created',
    )
    setBusy(false)
    if (ok) {
      onSaved()
      onOpenChange(false)
      setForm(EMPTY)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New order</DialogTitle>
        </DialogHeader>
        <form id="order" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Buyer" htmlFor="buyerId">
            <select id="buyerId" required className={selectClass} value={form.buyerId} onChange={set('buyerId')}>
              <option value="">Select…</option>
              {buyers.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Deadline" htmlFor="deadline">
            <Input id="deadline" type="date" required min={toISODate(new Date())} value={form.deadline} onChange={set('deadline')} />
          </Field>
          <Field label="Fabric type" htmlFor="fabricType">
            <Input id="fabricType" required placeholder="Poplin" value={form.fabricType} onChange={set('fabricType')} />
          </Field>
          <Field label="Colour" htmlFor="colour">
            <Input id="colour" required placeholder="Navy" value={form.colour} onChange={set('colour')} />
          </Field>
          <Field label="Quantity (m)" htmlFor="qty">
            <Input id="qty" type="number" min="1" required value={form.qty} onChange={set('qty')} />
          </Field>
          <Field label="Price (₹/m)" htmlFor="pricePerUnit">
            <Input id="pricePerUnit" type="number" min="0" step="0.01" required value={form.pricePerUnit} onChange={set('pricePerUnit')} />
          </Field>
          <Field label="Yarn" htmlFor="materialId">
            <select id="materialId" required className={selectClass} value={form.materialId} onChange={set('materialId')}>
              <option value="">Select…</option>
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
            hint={
              short === null ? (
                mat && `${formatQty(mat.qtyInStock, 'kg')} in store`
              ) : short > 0 ? (
                <span className="text-problem">Short by {formatQty(short, 'kg')}, order yarn first</span>
              ) : (
                <span className="text-good">Enough yarn to start</span>
              )
            }
          >
            <Input id="yarnRequired" type="number" min="0" step="0.01" required value={form.yarnRequired} onChange={set('yarnRequired')} />
          </Field>
        </form>
        <DialogFooter className="items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Value: {Number(form.qty) * Number(form.pricePerUnit) > 0 ? formatINR(Number(form.qty) * Number(form.pricePerUnit)) : '—'}
          </p>
          <Button type="submit" form="order" disabled={busy}>
            {busy ? 'Saving…' : 'Create order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

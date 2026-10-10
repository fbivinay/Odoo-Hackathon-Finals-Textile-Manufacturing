import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, PackagePlus } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from '@/auth/session'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Field, selectClass } from '@/components/Field'
import { LoadMore } from '@/components/LoadMore'
import { PageHead } from '@/components/PageHead'
import { Pill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ApiError } from '@/lib/api'
import { formatDateTime, formatINR, formatQty } from '@/lib/format'
import { recentOrdersPath } from '@/lib/queries'
import { useApi, usePaged } from '@/lib/useApi'
import type { MaterialCategory, MaterialInward, Order, RawMaterial, Ref } from '@/types'

// Everything the mill uses besides yarn. Yarn has its own tab (pages/Materials.tsx).
type Category = Exclude<MaterialCategory, 'YARN'>
const CATEGORY: Record<Category, string> = { DYE: 'Dyes', CHEMICAL: 'Chemicals', PACKAGING: 'Packaging', OTHER: 'Other' }
const CATEGORIES = Object.keys(CATEGORY) as Category[]
const UNITS = [
  { value: 'kg', label: 'kg' },
  { value: 'L', label: 'litres' },
  { value: 'pcs', label: 'pieces' },
  { value: 'rolls', label: 'rolls' },
  { value: 'm', label: 'metres' },
]

const receivedCols: ColumnDef<MaterialInward>[] = [
  { id: 'when', header: 'Received', accessorKey: 'receivedAt', cell: ({ getValue }) => formatDateTime(getValue<string>()) },
  { id: 'material', header: 'Material', accessorFn: (i) => `${i.material.yarnType} · ${i.material.colour}` },
  { id: 'supplier', header: 'Supplier', accessorFn: (i) => i.supplier.name },
  { id: 'qty', header: 'Qty', accessorFn: (i) => i.qty, cell: ({ row: { original: i } }) => formatQty(i.qty, i.material.unit) },
  { id: 'bill', header: 'Bill', accessorFn: (i) => i.billAmount, cell: ({ row: { original: i } }) => formatINR(i.billAmount) },
]

export function RawMaterials() {
  const { user } = useSession()
  const navigate = useNavigate()
  const stock = useApi<RawMaterial[]>('/materials?kind=other')
  const received = usePaged<MaterialInward>('/materials/inwards?kind=other')
  const [category, setCategory] = useState<Category | 'ALL'>('ALL')
  const [receiving, setReceiving] = useState(false)
  const [using, setUsing] = useState<RawMaterial | null>(null)
  // Only the store moves stock; production can look.
  const canEdit = user?.role === 'OWNER' || user?.role === 'STORE'

  const all = stock.data ?? []
  // Materials that need reordering come first.
  const rows = all.filter((m) => category === 'ALL' || m.category === category).sort((a, b) => Number(b.lowStock) - Number(a.lowStock))
  const low = all.filter((m) => m.lowStock).length
  const reload = () => {
    stock.reload()
    received.reload()
  }

  const stockCols: ColumnDef<RawMaterial>[] = [
    {
      accessorKey: 'yarnType',
      header: 'Material',
      cell: ({ row: { original: m } }) => (
        <div className="leading-tight">
          <p className="font-medium">{m.yarnType}</p>
          <p className="text-xs text-muted-foreground">{m.colour}</p>
        </div>
      ),
    },
    { accessorKey: 'category', header: 'Type', cell: ({ row: { original: m } }) => CATEGORY[m.category as Category] },
    {
      id: 'stock',
      header: 'In stock',
      accessorFn: (m) => m.qtyInStock,
      cell: ({ row: { original: m } }) => (
        <span className="inline-flex items-center gap-2 tabular-nums">
          {formatQty(m.qtyInStock, m.unit)}
          {m.lowStock && (
            <Pill tone="problem">
              <AlertTriangle className="mr-1 size-3" />
              Low
            </Pill>
          )}
        </span>
      ),
    },
    { id: 'reorder', header: 'Reorder at', accessorFn: (m) => m.reorderLevel, cell: ({ row: { original: m } }) => formatQty(m.reorderLevel, m.unit) },
    ...(canEdit
      ? [
          {
            id: 'action',
            header: '',
            enableSorting: false,
            cell: ({ row: { original: m } }) => (
              <Button
                size="xs"
                variant="outline"
                disabled={m.qtyInStock <= 0}
                onClick={(e) => {
                  e.stopPropagation() // the row itself opens the material's history
                  setUsing(m)
                }}
              >
                Use
              </Button>
            ),
          } satisfies ColumnDef<RawMaterial>,
        ]
      : []),
  ]

  return (
    <div className="space-y-5">
      <PageHead
        eyebrow="Dyes, chemicals, packaging"
        title="Raw Materials"
        actions={
          canEdit && (
            <Button className="gap-1.5" onClick={() => setReceiving(true)}>
              <PackagePlus className="size-4" />
              Receive material
            </Button>
          )
        }
      />

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Current Stock{low > 0 && ` · ${low} low`}</TabsTrigger>
          <TabsTrigger value="received">Received History</TabsTrigger>
        </TabsList>
        <TabsContent value="stock" className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {(['ALL', ...CATEGORIES] as const).map((c) => (
              <Button key={c} size="sm" variant={c === category ? 'secondary' : 'ghost'} onClick={() => setCategory(c)}>
                {c === 'ALL' ? 'All' : CATEGORY[c]}
                <span className="ml-1 text-xs text-muted-foreground">{c === 'ALL' ? all.length : all.filter((m) => m.category === c).length}</span>
              </Button>
            ))}
          </div>
          {stock.error && <p className="text-sm text-problem">{stock.error}</p>}
          <DataTable
            columns={stockCols}
            data={rows}
            loading={stock.loading}
            empty={
              <EmptyState
                icon={PackagePlus}
                line={category === 'ALL' ? 'No raw materials yet.' : `No ${CATEGORY[category].toLowerCase()}${category === 'OTHER' ? ' materials' : ''} yet.`}
                actionLabel={canEdit ? 'Receive material' : undefined}
                onAction={canEdit ? () => setReceiving(true) : undefined}
              />
            }
            onRowClick={(m) => navigate(`/raw-materials/${m.id}`)}
          />
        </TabsContent>
        <TabsContent value="received" className="space-y-3">
          <DataTable columns={receivedCols} data={received.rows} loading={received.loading} empty={<EmptyState icon={PackagePlus} line="Nothing received yet." />} />
          <LoadMore hasMore={received.hasMore} more={received.more} />
        </TabsContent>
      </Tabs>

      {receiving && <ReceiveDialog materials={all} startWith={category === 'ALL' ? null : category} onClose={() => setReceiving(false)} onSaved={reload} />}
      {using && <UseDialog m={using} onClose={() => setUsing(null)} onSaved={reload} />}
    </div>
  )
}

const NEW = '__new__'
const emptyForm = {
  materialId: '', supplierId: '', qty: '', rate: '',
  name: '', spec: '', category: 'DYE' as Category, unit: 'kg', supplierName: '', supplierPhone: '',
}

function ReceiveDialog({ materials, startWith, onClose, onSaved }: { materials: RawMaterial[]; startWith: Category | null; onClose: () => void; onSaved: () => void }) {
  const suppliers = useApi<Ref[]>('/suppliers')
  // Opened from an empty type (say Other): start on "add new" with that type chosen.
  const nothingYet = startWith !== null && !materials.some((m) => m.category === startWith)
  const [form, setForm] = useState({ ...emptyForm, category: startWith ?? emptyForm.category, materialId: nothingYet ? NEW : '' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const newMaterial = form.materialId === NEW
  const newSupplier = form.supplierId === NEW
  const picked = materials.find((m) => m.id === form.materialId)
  const unit = newMaterial ? form.unit : (picked?.unit ?? 'kg')
  const bill = Number(form.qty) * Number(form.rate)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      // A new material or supplier is saved first and stays selected, so a retry never creates it twice.
      let { materialId, supplierId } = form
      if (newMaterial) {
        const made = await api<RawMaterial>('/materials', {
          method: 'POST',
          body: { category: form.category, yarnType: form.name, colour: form.spec, unit: form.unit },
        })
        materialId = made.id
        setForm((f) => ({ ...f, materialId }))
        onSaved()
      }
      if (newSupplier) {
        const made = await api<Ref>('/suppliers', { method: 'POST', body: { name: form.supplierName, phone: form.supplierPhone || undefined } })
        supplierId = made.id
        setForm((f) => ({ ...f, supplierId }))
        suppliers.reload()
      }
      await api('/materials/inwards', { method: 'POST', body: { materialId, supplierId, qty: Number(form.qty), rate: Number(form.rate) } })
      toast.success('Material received, stock updated')
      onSaved()
      onClose()
    } catch (err) {
      const duplicate = err instanceof ApiError && err.code === 'CONFLICT'
      toast.error(duplicate ? 'That material or supplier already exists. Pick it from the list.' : err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Receive material</DialogTitle>
        </DialogHeader>
        <form id="receive-material" onSubmit={submit} className="grid gap-4">
          <Field label="Material" htmlFor="materialId">
            <select id="materialId" required className={selectClass} value={form.materialId} onChange={set('materialId')}>
              <option value="">Select material…</option>
              {CATEGORIES.map((c) => {
                const group = materials.filter((m) => m.category === c)
                return group.length ? (
                  <optgroup key={c} label={CATEGORY[c]}>
                    {group.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.yarnType} · {m.colour}
                      </option>
                    ))}
                  </optgroup>
                ) : null
              })}
              <option value={NEW}>+ Add new material</option>
            </select>
          </Field>
          {newMaterial && (
            <div className="grid gap-3 rounded-lg border border-border bg-zinc-50 p-3">
              <Field label="Name" htmlFor="name">
                <Input id="name" required autoFocus placeholder="Reactive Red ME4BL" value={form.name} onChange={set('name')} />
              </Field>
              <Field label="Shade, grade or size" htmlFor="spec">
                <Input id="spec" required placeholder="Red" value={form.spec} onChange={set('spec')} />
              </Field>
              <Field label="Type" htmlFor="category">
                <select id="category" className={selectClass} value={form.category} onChange={set('category')}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY[c]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Measured in" htmlFor="unit">
                <select id="unit" className={selectClass} value={form.unit} onChange={set('unit')}>
                  {UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          <Field label="Supplier" htmlFor="supplierId">
            <select id="supplierId" required className={selectClass} value={form.supplierId} onChange={set('supplierId')}>
              <option value="">Select supplier…</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value={NEW}>+ Add new supplier</option>
            </select>
          </Field>
          {newSupplier && (
            <div className="grid gap-3 rounded-lg border border-border bg-zinc-50 p-3">
              <Field label="Supplier name" htmlFor="supplierName">
                <Input id="supplierName" required autoFocus placeholder="Colourtex Dyes" value={form.supplierName} onChange={set('supplierName')} />
              </Field>
              <Field label="Phone (optional)" htmlFor="supplierPhone">
                <Input id="supplierPhone" type="tel" inputMode="tel" value={form.supplierPhone} onChange={set('supplierPhone')} />
              </Field>
            </div>
          )}

          <Field label={`Quantity (${unit})`} htmlFor="qty">
            <Input id="qty" type="number" min="0.01" step="0.01" inputMode="decimal" required value={form.qty} onChange={set('qty')} />
          </Field>
          <Field label={`Rate (₹/${unit})`} htmlFor="rate">
            <Input id="rate" type="number" min="0.01" step="0.01" inputMode="decimal" required value={form.rate} onChange={set('rate')} />
          </Field>
        </form>
        <DialogFooter className="items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Bill: {bill > 0 ? formatINR(bill) : '—'}</p>
          <Button type="submit" form="receive-material" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Using a material charges it to the order it went into, so it shows up in that order's cost.
function UseDialog({ m, onClose, onSaved }: { m: RawMaterial; onClose: () => void; onSaved: () => void }) {
  const orders = useApi<Order[]>(recentOrdersPath())
  const [orderId, setOrderId] = useState('')
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const open = (orders.data ?? []).filter((o) => !['DISPATCHED', 'CANCELLED', 'READY'].includes(o.status))
  const left = m.qtyInStock - Number(qty)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/materials/issues', { method: 'POST', body: { materialId: m.id, orderId, qty: Number(qty) } })
      toast.success(`${formatQty(Number(qty), m.unit)} of ${m.yarnType} used`)
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
          <DialogTitle>Use {m.yarnType}</DialogTitle>
          <DialogDescription>
            {m.colour} · {formatQty(m.qtyInStock, m.unit)} in stock
          </DialogDescription>
        </DialogHeader>
        <form id="use-material" onSubmit={submit} className="grid gap-4">
          <Field label="For order" htmlFor="orderId">
            <select id="orderId" required className={selectClass} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">{orders.loading ? 'Loading…' : 'Select order…'}</option>
              {open.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNo} · {o.fabricType} · {o.buyer.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Quantity (${m.unit})`} htmlFor="useQty" hint={Number(qty) > 0 && left >= 0 ? `${formatQty(left, m.unit)} left after this` : undefined}>
            <Input id="useQty" type="number" min="0.01" max={m.qtyInStock} step="0.01" inputMode="decimal" required value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        </form>
        <DialogFooter>
          <Button type="submit" form="use-material" disabled={busy}>
            {busy ? 'Saving…' : 'Use'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

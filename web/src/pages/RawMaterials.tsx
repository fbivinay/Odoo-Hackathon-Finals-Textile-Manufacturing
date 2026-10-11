import { useMemo, useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PackagePlus, Search, ShoppingCart } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useSession } from '@/auth/session'
import { actsAs } from '@/components/AppShell'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Field, selectClass } from '@/components/Field'
import { Pagination } from '@/components/Pagination'
import { PageHead } from '@/components/PageHead'
import { PurchaseOrders } from '@/components/PurchaseOrders'
import { ReorderDialog } from '@/components/ReorderDialog'
import { StockWarningDialog } from '@/components/StockWarningDialog'
import { Pill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ApiError } from '@/lib/api'
import { formatDateTime, formatINR, formatQty } from '@/lib/format'
import { toOrder } from '@/lib/reorder'
import { pagerOf, useApi, usePages } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import type { MaterialCategory, MaterialInward, PurchaseOrder, RawMaterial, Ref } from '@/types'

// Everything the mill uses besides yarn, in store sections. Yarn has its own tab (pages/Materials.tsx).
type Category = Exclude<MaterialCategory, 'YARN'>
export const CATEGORY: Record<Category, string> = {
  WEAVING: 'Weaving materials',
  DYEING: 'Dyeing chemicals',
  FINISHING: 'Finishing chemicals',
  QC: 'QC materials',
  PACKAGING: 'Dispatch and packaging',
  MAINTENANCE: 'Maintenance and spares',
}
const DEPARTMENT: Record<Category, string> = { WEAVING: 'WEAVING', DYEING: 'DYEING', FINISHING: 'FINISHING', QC: 'QC', PACKAGING: 'DISPATCH', MAINTENANCE: 'MAINTENANCE' }
// GST rules that apply to goods bought into the store (services and sales rules are left out).
const STORE_TAX_CODES = ['STARCH', 'PVA', 'LUBRICANT', 'DETERGENT', 'DYE', 'ENZYME', 'PEROXIDE', 'ALKALI', 'SALT', 'SULPHATE', 'ACID', 'TEXTILE_AUX', 'REAGENT', 'LABEL', 'TUBE', 'CARTON', 'PLASTIC', 'BELT', 'BEARING', 'MACHINE_SPARE']
type TaxCode = { code: string; label: string; hsn: string; rateToday: number; confidence: string }
const gstOf = (i: MaterialInward) => Number(i.cgst ?? 0) + Number(i.sgst ?? 0) + Number(i.igst ?? 0)
const CATEGORIES = Object.keys(CATEGORY) as Category[]
const STATUS = { short: 'Low or short', onorder: 'On order', ok: 'Enough stock' }
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
  {
    id: 'bill',
    header: 'Bill',
    accessorFn: (i) => Number(i.totalAmount ?? i.billAmount),
    cell: ({ row: { original: i } }) => (
      <div className="leading-tight tabular-nums">
        <p>{formatINR(Number(i.totalAmount ?? i.billAmount))}</p>
        <p className="text-xs text-muted-foreground">
          {i.billNo && `${i.billNo} · `}
          {gstOf(i) > 0 ? `incl. ${formatINR(gstOf(i))} GST (${Number(i.taxRatePct)}%)` : i.taxTreatment === 'UNCLASSIFIED' ? 'GST not classified' : 'No GST'}
        </p>
      </div>
    ),
  },
]

export function RawMaterials() {
  const { user } = useSession()
  const navigate = useNavigate()
  const stock = useApi<RawMaterial[]>('/materials?kind=other')
  const received = usePages<MaterialInward>('/materials/inwards?kind=other')
  const [category, setCategory] = useState<Category | 'ALL'>('ALL')
  const [receiving, setReceiving] = useState(false)
  const [using, setUsing] = useState<RawMaterial | null>(null)
  const [warning, setWarning] = useState<RawMaterial | null>(null)
  const [ordering, setOrdering] = useState(false)
  // Only the store moves stock; production can look.
  const canEdit = actsAs(user, 'STORE')

  const all = stock.data ?? []
  // Material already ordered and on its way is not short again.
  const pending = useApi<PurchaseOrder[]>('/materials/purchase-orders?status=PENDING&kind=other')
  const history = usePages<PurchaseOrder>('/materials/purchase-orders?kind=other')
  const onOrder = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of pending.data ?? []) map.set(p.material.id, (map.get(p.material.id) ?? 0) + Number(p.qty))
    return map
  }, [pending.data])
  const onOrderOf = (id: string) => onOrder.get(id) ?? 0
  const short = useMemo(() => (stock.data ?? []).map((m) => ({ m, qty: toOrder(m, 0, onOrder.get(m.id)) })).filter((s) => s.qty > 0), [stock.data, onOrder])
  const reloadOrders = () => {
    pending.reload()
    history.reload()
  }
  const shortOf = (id: string) => short.find((s) => s.m.id === id)?.qty ?? 0
  const reload = () => {
    stock.reload()
    received.reload()
  }

  // The list: every material, searchable and filterable. A box above sets the section filter.
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'' | 'short' | 'onorder' | 'ok'>('')
  // Which of the three lists is open.
  const [tab, setTab] = useState<'stock' | 'orders' | 'received'>('stock')
  const isLow = (m: RawMaterial) => m.lowStock || shortOf(m.id) > 0
  const valueOf = (m: RawMaterial) => Number(m.qtyInStock) * Number(m.avgCost)
  const needle = q.trim().toLowerCase()
  const rows = all
    .filter(
      (m) =>
        (category === 'ALL' || m.category === category) &&
        (!needle || [m.yarnType, m.colour, m.sku, m.subcategory].some((x) => x?.toLowerCase().includes(needle))) &&
        (!status || (status === 'short' ? isLow(m) : status === 'onorder' ? onOrderOf(m.id) > 0 : !isLow(m))),
    )
    .sort((a, b) => Number(isLow(b)) - Number(isLow(a)) || a.yarnType.localeCompare(b.yarnType))
  const lowCount = all.filter(isLow).length
  const filtersOn = !!needle || category !== 'ALL' || !!status


  // No column sorting: what is running low comes first.
  const columns: ColumnDef<RawMaterial>[] = [
    {
      id: 'material',
      header: 'Material',
      meta: { width: '34%' },
      enableSorting: false,
      cell: ({ row: { original: m } }) => (
        <div className="leading-tight">
          <p className="truncate font-medium">{m.yarnType}</p>
          <p className="truncate text-xs text-muted-foreground">{[m.colour, m.sku].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    { id: 'section', header: 'Section', meta: { width: '22%' }, enableSorting: false, accessorFn: (m) => CATEGORY[m.category as Category] ?? m.category },
    {
      id: 'stock',
      header: 'In stock',
      meta: { width: '18%' },
      enableSorting: false,
      cell: ({ row: { original: m } }) => (
        <div className="leading-tight tabular-nums">
          <p>{formatQty(m.qtyInStock, m.unit)}</p>
          <p className="text-xs text-muted-foreground">worth {formatINR(valueOf(m))}</p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      meta: { width: '26%' },
      enableSorting: false,
      cell: ({ row: { original: m } }) => (
        <div className="leading-tight">
          {isLow(m) ? <Pill tone="problem">{shortOf(m.id) > 0 ? `Short ${formatQty(shortOf(m.id), m.unit)}` : 'Low'}</Pill> : <Pill tone="good">OK</Pill>}
          {onOrderOf(m.id) > 0 && <p className="mt-0.5 text-xs font-medium whitespace-nowrap text-watch">{formatQty(onOrderOf(m.id), m.unit)} on order</p>}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHead
        eyebrow="Dyes, chemicals, packaging and spares"
        title="Raw Materials"
        actions={
          canEdit && (
            <div className="flex gap-2">
              {short.length > 0 && (
                <Button variant="outline" className="gap-1.5" onClick={() => setOrdering(true)}>
                  <ShoppingCart className="size-4" />
                  Order all short ({short.length})
                </Button>
              )}
              <Button className="gap-1.5" onClick={() => setReceiving(true)}>
                <PackagePlus className="size-4" />
                Receive material
              </Button>
            </div>
          )
        }
      />

      {stock.error && <p className="text-sm text-problem">{stock.error}</p>}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="stock">Current stock{lowCount > 0 && ` · ${lowCount} low`}</TabsTrigger>
            <TabsTrigger value="orders">Order history{(pending.data?.length ?? 0) > 0 && ` · ${pending.data!.length} pending`}</TabsTrigger>
            <TabsTrigger value="received">Received history</TabsTrigger>
          </TabsList>
          {tab === 'stock' && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {filtersOn && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setQ('')
                    setStatus('')
                    setCategory('ALL')
                  }}
                >
                  Remove filter
                </Button>
              )}
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input type="search" aria-label="Search materials" placeholder="Search name, shade or SKU" className="bg-white pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <select aria-label="Section" className={cn(selectClass, 'bg-white sm:w-auto sm:min-w-40')} value={category} onChange={(e) => setCategory(e.target.value as Category | 'ALL')}>
                <option value="ALL">All sections</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY[c]}
                  </option>
                ))}
              </select>
              <select aria-label="Stock status" className={cn(selectClass, 'bg-white sm:w-auto sm:min-w-36')} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="">All status</option>
                <option value="short">{STATUS.short}</option>
                <option value="onorder">{STATUS.onorder}</option>
                <option value="ok">{STATUS.ok}</option>
              </select>
            </div>
          )}
        </div>
        <TabsContent value="stock" className="mt-4">
          <DataTable
            columns={columns}
            data={rows}
            loading={stock.loading}
            onRowClick={(m) => navigate(`/raw-materials/${m.id}`)}
            empty={
              filtersOn ? (
                <EmptyState
                  icon={Search}
                  line="No material matches these filters."
                  actionLabel="Clear filters"
                  onAction={() => {
                    setQ('')
                    setStatus('')
                    setCategory('ALL')
                  }}
                />
              ) : (
                <EmptyState icon={PackagePlus} line="No raw materials yet." actionLabel={canEdit ? 'Receive material' : undefined} onAction={canEdit ? () => setReceiving(true) : undefined} />
              )
            }
          />
        </TabsContent>
        <TabsContent value="orders" className="mt-4 space-y-3">
          <PurchaseOrders
            rows={history.rows}
            loading={history.loading}
            pager={pagerOf(history)}
            canEdit={canEdit}
            onChanged={() => {
              reloadOrders()
              reload()
            }}
          />
        </TabsContent>
        <TabsContent value="received" className="mt-4 space-y-3">
          <DataTable columns={receivedCols} data={received.rows} loading={received.loading} empty={<EmptyState icon={PackagePlus} line="Nothing received yet." />} />
          <Pagination {...pagerOf(received)} />
        </TabsContent>
      </Tabs>

      {receiving && <ReceiveDialog materials={all} startWith={category === 'ALL' ? null : category} onClose={() => setReceiving(false)} onSaved={reload} />}
      {warning && <StockWarningDialog m={warning} onClose={() => setWarning(null)} onSaved={stock.reload} />}
      <ReorderDialog open={ordering} onOpenChange={setOrdering} items={short} inwardsPath="/materials/inwards?kind=other" onPlaced={reloadOrders} />
      {using && <UseDialog m={using} onClose={() => setUsing(null)} onSaved={reload} />}
    </div>
  )
}

const NEW = '__new__'
const emptyForm = {
  materialId: '', supplierId: '', qty: '', rate: '',
  name: '', spec: '', category: 'DYEING' as Category, unit: 'kg', supplierName: '', supplierPhone: '',
  sku: '', subcategory: '', taxCode: '', batchNo: '',
}

function ReceiveDialog({ materials, startWith, onClose, onSaved }: { materials: RawMaterial[]; startWith: Category | null; onClose: () => void; onSaved: () => void }) {
  const suppliers = useApi<Ref[]>('/suppliers')
  const taxCodes = useApi<TaxCode[]>('/materials/tax-codes')
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
          body: {
            category: form.category, yarnType: form.name, colour: form.spec, unit: form.unit, department: DEPARTMENT[form.category],
            sku: form.sku || undefined, subcategory: form.subcategory || undefined, taxCode: form.taxCode || undefined,
            isSpare: form.category === 'MAINTENANCE' && /spare|belt|bearing/i.test(form.subcategory),
          },
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
      await api('/materials/inwards', { method: 'POST', body: { materialId, supplierId, qty: Number(form.qty), rate: Number(form.rate), batchNo: form.batchNo || undefined } })
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
              <Field label="Sub-category (optional)" htmlFor="subcategory">
                <Input id="subcategory" placeholder="Reactive dyes" value={form.subcategory} onChange={set('subcategory')} />
              </Field>
              <Field label="SKU (optional)" htmlFor="sku">
                <Input id="sku" placeholder="DY-RD-005" value={form.sku} onChange={set('sku')} />
              </Field>
              <Field label="GST rule" htmlFor="taxCode" hint="Decides the GST on its bills. Unverified rates are assumptions.">
                <select id="taxCode" required className={selectClass} value={form.taxCode} onChange={set('taxCode')}>
                  <option value="">Select…</option>
                  {taxCodes.data
                    ?.filter((t) => STORE_TAX_CODES.includes(t.code))
                    .map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.label} (HSN {t.hsn}) · {t.rateToday}%{t.confidence === 'UNVERIFIED' ? ' · unverified' : ''}
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

// Records what has been used up. Stock goes down; nothing else is asked.
export function UseDialog({ m, onClose, onSaved }: { m: RawMaterial; onClose: () => void; onSaved: () => void }) {
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const left = m.qtyInStock - Number(qty)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/materials/issues', { method: 'POST', body: { materialId: m.id, qty: Number(qty) } })
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
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Use {m.yarnType}</DialogTitle>
          <DialogDescription>
            {m.colour} · {formatQty(m.qtyInStock, m.unit)} in stock
          </DialogDescription>
        </DialogHeader>
        <form id="use-material" onSubmit={submit}>
          <Field label={`Quantity used (${m.unit})`} htmlFor="useQty" hint={Number(qty) > 0 && left >= 0 ? `${formatQty(left, m.unit)} left after this` : undefined}>
            <Input id="useQty" type="number" min="0.01" max={m.qtyInStock} step="0.01" inputMode="decimal" required autoFocus value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        </form>
        <DialogFooter>
          <Button type="submit" form="use-material" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

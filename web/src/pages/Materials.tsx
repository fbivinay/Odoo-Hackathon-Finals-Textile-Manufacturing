import { useMemo, useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, Bell, BellOff, PackagePlus, ShoppingCart } from 'lucide-react'
import { PageHead } from '@/components/PageHead'
import { PurchaseOrders } from '@/components/PurchaseOrders'
import { ReorderDialog } from '@/components/ReorderDialog'
import { StockWarningDialog } from '@/components/StockWarningDialog'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Field, selectClass } from '@/components/Field'
import { Pill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { dayFromToday, formatDateTime, formatINR, formatQty } from '@/lib/format'
import { toOrder } from '@/lib/reorder'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import { pagerOf, useApi, usePages } from '@/lib/useApi'
import { Pagination } from '@/components/Pagination'
import type { MaterialInward, Planning, PurchaseOrder, RawMaterial, Ref } from '@/types'

const stockCols = (onWarning: (m: RawMaterial) => void, shortOf: (id: string) => number, onOrderOf: (id: string) => number): ColumnDef<RawMaterial>[] => [
  { accessorKey: 'yarnType', header: 'Yarn' },
  { accessorKey: 'colour', header: 'Colour' },
  {
    id: 'stock',
    header: 'In stock',
    accessorFn: (m) => m.qtyInStock,
    cell: ({ row: { original: m } }) => (
      <span className="inline-flex items-center gap-2 tabular-nums">
        {formatQty(m.qtyInStock, m.unit)}
        {(m.lowStock || shortOf(m.id) > 0) && (
          <Pill tone="problem">
            <AlertTriangle className="mr-1 size-3" />
            {shortOf(m.id) > 0 ? `Short ${formatQty(shortOf(m.id), m.unit)}` : 'Low'}
          </Pill>
        )}
        {onOrderOf(m.id) > 0 && <Pill tone="watch">On order {formatQty(onOrderOf(m.id), m.unit)}</Pill>}
      </span>
    ),
  },
  {
    id: 'warning',
    header: '',
    enableSorting: false,
    cell: ({ row: { original: m } }) => (
      <Button
        variant="ghost"
        size="icon-xs"
        title={m.reorderLevel > 0 ? `Warns below ${formatQty(m.reorderLevel, m.unit)}. Click to change.` : 'No low-stock warning. Click to set one.'}
        aria-label={`Low-stock warning for ${m.yarnType} ${m.colour}`}
        onClick={() => onWarning(m)}
      >
        {m.reorderLevel > 0 ? <Bell className="size-3.5" /> : <BellOff className="size-3.5 text-muted-foreground" />}
      </Button>
    ),
  },
]

const inwardCols: ColumnDef<MaterialInward>[] = [
  { id: 'when', header: 'Received', accessorKey: 'receivedAt', cell: ({ getValue }) => formatDateTime(getValue<string>()) },
  { id: 'yarn', header: 'Yarn', accessorFn: (i) => `${i.material.yarnType} · ${i.material.colour}` },
  { id: 'supplier', header: 'Supplier', accessorFn: (i) => i.supplier.name },
  { id: 'qty', header: 'Qty', accessorFn: (i) => i.qty, cell: ({ row: { original: i } }) => formatQty(i.qty, i.material.unit) },
  { id: 'bill', header: 'Bill', accessorFn: (i) => i.billAmount, cell: ({ row: { original: i } }) => formatINR(i.billAmount) },
]

export function Materials() {
  const stock = useApi<RawMaterial[]>('/materials?category=YARN')
  const inwards = usePages<MaterialInward>('/materials/inwards?category=YARN')
  const [open, setOpen] = useState(false)
  const [warning, setWarning] = useState<RawMaterial | null>(null)
  const [ordering, setOrdering] = useState(false)
  // Yarn the open orders still need, beyond what is in stock, counts towards the shortage.
  const plan = useApi<Planning>('/planning/schedule')
  // Yarn already ordered and on its way is not short again.
  const pending = useApi<PurchaseOrder[]>('/materials/purchase-orders?status=PENDING&category=YARN')
  const history = usePages<PurchaseOrder>('/materials/purchase-orders?category=YARN')
  const onOrder = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of pending.data ?? []) map.set(p.material.id, (map.get(p.material.id) ?? 0) + Number(p.qty))
    return map
  }, [pending.data])
  const onOrderOf = (id: string) => onOrder.get(id) ?? 0
  const short = useMemo(() => {
    const needed = new Map(plan.data?.yarnNeeds.map((y) => [y.id, y.needed]))
    return (stock.data ?? []).map((m) => ({ m, qty: toOrder(m, needed.get(m.id), onOrder.get(m.id)) })).filter((s) => s.qty > 0)
  }, [stock.data, plan.data, onOrder])
  const shortOf = (id: string) => short.find((s) => s.m.id === id)?.qty ?? 0
  const reloadOrders = () => {
    pending.reload()
    history.reload()
  }
  // Yarns that need reordering come first, biggest shortage on top.
  const rows = [...(stock.data ?? [])].sort((a, b) => shortOf(b.id) - shortOf(a.id) || Number(b.lowStock) - Number(a.lowStock))
  const low = rows.filter((m) => shortOf(m.id) > 0).length

  return (
    <div className="space-y-5">
      <PageHead
        eyebrow="From suppliers"
        title="Yarn Received"
        actions={
          <div className="flex gap-2">
            {short.length > 0 && (
              <Button variant="outline" className="gap-1.5" onClick={() => setOrdering(true)}>
                <ShoppingCart className="size-4" />
                Order all short ({short.length})
              </Button>
            )}
            <Button className="gap-1.5" onClick={() => setOpen(true)}>
              <PackagePlus className="size-4" />
              Receive yarn
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Current Stock{low > 0 && ` · ${low} short`}</TabsTrigger>
          <TabsTrigger value="orders">Order History{(pending.data?.length ?? 0) > 0 && ` · ${pending.data!.length} pending`}</TabsTrigger>
          <TabsTrigger value="deliveries">Received History</TabsTrigger>
        </TabsList>
        <TabsContent value="stock" className="space-y-3">
          {stock.error && <p className="text-sm text-problem">{stock.error}</p>}
          <DataTable
            columns={stockCols(setWarning, shortOf, onOrderOf)}
            data={rows}
            loading={stock.loading}
            empty={<EmptyState icon={PackagePlus} line="No yarn in the store yet." actionLabel="Receive yarn" onAction={() => setOpen(true)} />}
          />
        </TabsContent>
        <TabsContent value="orders" className="space-y-3">
          <PurchaseOrders
            rows={history.rows}
            loading={history.loading}
            pager={pagerOf(history)}
            canEdit
            onChanged={() => {
              reloadOrders()
              stock.reload()
              inwards.reload()
              plan.reload()
            }}
          />
        </TabsContent>
        <TabsContent value="deliveries" className="space-y-3">
          <DataTable columns={inwardCols} data={inwards.rows} loading={inwards.loading} empty="No yarn received yet." />
          <Pagination {...pagerOf(inwards)} />
        </TabsContent>
      </Tabs>

      <ReorderDialog open={ordering} onOpenChange={setOrdering} items={short} inwardsPath={`/materials/inwards?category=YARN&from=${dayFromToday(-365)}`} onPlaced={reloadOrders} />
      {warning && <StockWarningDialog m={warning} onClose={() => setWarning(null)} onSaved={stock.reload} />}

      <InwardDialog
        open={open}
        onOpenChange={setOpen}
        materials={stock.data ?? []}
        onSaved={() => {
          stock.reload()
          inwards.reload()
        }}
      />
    </div>
  )
}

const NEW = '__new__'
const emptyForm = { materialId: '', supplierId: '', qty: '', rate: '', yarnType: '', colour: '', supplierName: '', supplierPhone: '' }

function InwardDialog({
  open,
  onOpenChange,
  materials,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  materials: RawMaterial[]
  onSaved: () => void
}) {
  const suppliers = useApi<Ref[]>(open ? '/suppliers' : null)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const bill = Number(form.qty) * Number(form.rate)
  const newYarn = form.materialId === NEW
  const newSupplier = form.supplierId === NEW

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      // A new yarn or supplier is saved first and stays selected, so a retry never creates it twice.
      let { materialId, supplierId } = form
      if (newYarn) {
        const made = await api<RawMaterial>('/materials', {
          method: 'POST',
          body: { category: 'YARN', yarnType: form.yarnType, colour: form.colour },
        })
        materialId = made.id
        setForm((f) => ({ ...f, materialId }))
        onSaved()
      }
      if (newSupplier) {
        const made = await api<Ref>('/suppliers', {
          method: 'POST',
          body: { name: form.supplierName, phone: form.supplierPhone || undefined },
        })
        supplierId = made.id
        setForm((f) => ({ ...f, supplierId }))
        suppliers.reload()
      }
      const saved = await api<{ issuedTo: { orderNo: string }[] }>('/materials/inwards', {
        method: 'POST',
        body: { materialId, supplierId, qty: Number(form.qty), rate: Number(form.rate) },
      })
      const waiting = saved.issuedTo?.length ?? 0
      toast.success('Yarn received', { description: waiting ? `Issued to ${waiting} waiting order${waiting > 1 ? 's' : ''}.` : undefined })
      onSaved()
      onOpenChange(false)
      setForm(emptyForm)
    } catch (err) {
      const duplicate = err instanceof ApiError && err.code === 'CONFLICT'
      toast.error(duplicate ? 'That yarn or supplier already exists. Pick it from the list.' : err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Receive yarn</DialogTitle>
        </DialogHeader>
        <form id="inward" onSubmit={submit} className="grid gap-4">
          <Field label="Yarn" htmlFor="materialId">
            <select id="materialId" required className={selectClass} value={form.materialId} onChange={set('materialId')}>
              <option value="">Select yarn…</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.yarnType} · {m.colour}
                </option>
              ))}
              <option value={NEW}>+ Add new yarn</option>
            </select>
          </Field>
          {newYarn && (
            <div className="grid gap-3 rounded-lg border border-border bg-zinc-50 p-3">
              <Field label="Yarn type" htmlFor="yarnType">
                <Input id="yarnType" required autoFocus placeholder="Cotton 40s" value={form.yarnType} onChange={set('yarnType')} />
              </Field>
              <Field label="Colour" htmlFor="colour">
                <Input id="colour" required placeholder="Raw White" value={form.colour} onChange={set('colour')} />
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
                <Input id="supplierName" required autoFocus placeholder="Surat Yarn Agency" value={form.supplierName} onChange={set('supplierName')} />
              </Field>
              <Field label="Phone (optional)" htmlFor="supplierPhone">
                <Input id="supplierPhone" type="tel" inputMode="tel" value={form.supplierPhone} onChange={set('supplierPhone')} />
              </Field>
            </div>
          )}

          <Field label="Quantity (kg)" htmlFor="qty">
            <Input id="qty" type="number" min="0.01" step="0.01" required value={form.qty} onChange={set('qty')} />
          </Field>
          <Field label="Rate (₹/kg)" htmlFor="rate">
            <Input id="rate" type="number" min="0.01" step="0.01" required value={form.rate} onChange={set('rate')} />
          </Field>
        </form>
        <DialogFooter className="items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Bill: {bill > 0 ? formatINR(bill) : '—'}</p>
          <Button type="submit" form="inward" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

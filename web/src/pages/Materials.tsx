import { useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, PackagePlus } from 'lucide-react'
import { PageHead } from '@/components/PageHead'
import { DataTable } from '@/components/DataTable'
import { Field, selectClass } from '@/components/Field'
import { Pill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDateTime, formatINR, formatQty } from '@/lib/format'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import { useApi, usePaged } from '@/lib/useApi'
import { LoadMore } from '@/components/LoadMore'
import type { MaterialInward, RawMaterial, Ref } from '@/types'

const stockCols: ColumnDef<RawMaterial>[] = [
  { accessorKey: 'yarnType', header: 'Yarn' },
  { accessorKey: 'colour', header: 'Colour' },
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
]

const inwardCols: ColumnDef<MaterialInward>[] = [
  { id: 'when', header: 'Received', accessorKey: 'receivedAt', cell: ({ getValue }) => formatDateTime(getValue<string>()) },
  { id: 'yarn', header: 'Yarn', accessorFn: (i) => `${i.material.yarnType} · ${i.material.colour}` },
  { id: 'supplier', header: 'Supplier', accessorFn: (i) => i.supplier.name },
  { id: 'qty', header: 'Qty', accessorFn: (i) => i.qty, cell: ({ row: { original: i } }) => formatQty(i.qty, i.material.unit) },
  { id: 'bill', header: 'Bill', accessorFn: (i) => i.billAmount, cell: ({ row: { original: i } }) => formatINR(i.billAmount) },
]

export function Materials() {
  const stock = useApi<RawMaterial[]>('/materials')
  const inwards = usePaged<MaterialInward>('/materials/inwards')
  const [open, setOpen] = useState(false)
  // Yarns that need reordering come first.
  const rows = [...(stock.data ?? [])].sort((a, b) => Number(b.lowStock) - Number(a.lowStock))
  const low = rows.filter((m) => m.lowStock).length

  return (
    <div className="space-y-5">
      <PageHead
        eyebrow="Store"
        title="Raw material"
        actions={
          <Button className="gap-1.5" onClick={() => setOpen(true)}>
            <PackagePlus className="size-4" />
            Record delivery
          </Button>
        }
      />

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Stock{low > 0 && ` · ${low} low`}</TabsTrigger>
          <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
        </TabsList>
        <TabsContent value="stock" className="space-y-3">
          {stock.error && <p className="text-sm text-problem">{stock.error}</p>}
          <DataTable columns={stockCols} data={rows} loading={stock.loading} />
        </TabsContent>
        <TabsContent value="deliveries" className="space-y-3">
          <DataTable columns={inwardCols} data={inwards.rows} loading={inwards.loading} />
          <LoadMore hasMore={inwards.hasMore} more={inwards.more} />
        </TabsContent>
      </Tabs>

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
          body: { yarnType: form.yarnType, colour: form.colour },
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
      await api('/materials/inwards', {
        method: 'POST',
        body: { materialId, supplierId, qty: Number(form.qty), rate: Number(form.rate) },
      })
      toast.success('Delivery recorded')
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
          <DialogTitle>Record delivery</DialogTitle>
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

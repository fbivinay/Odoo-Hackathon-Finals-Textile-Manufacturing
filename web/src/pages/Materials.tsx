import { useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, PackagePlus } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { Field, selectClass } from '@/components/Field'
import { Pill } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatDateTime, formatINR, formatQty } from '@/lib/format'
import { isLowStock } from '@/lib/textile'
import { mutate, useApi } from '@/lib/useApi'
import type { MaterialInward, Order, RawMaterial, Ref } from '@/types'

const stockCols: ColumnDef<RawMaterial>[] = [
  { accessorKey: 'yarnType', header: 'Yarn' },
  { accessorKey: 'colour', header: 'Colour' },
  {
    id: 'stock',
    header: 'In stock',
    accessorFn: (m) => Number(m.qtyInStock),
    cell: ({ row: { original: m } }) => (
      <span className="inline-flex items-center gap-2 tabular-nums">
        {formatQty(m.qtyInStock, m.unit)}
        {isLowStock(m) && (
          <Pill tone="red">
            <AlertTriangle className="mr-1 size-3" />
            Low stock
          </Pill>
        )}
      </span>
    ),
  },
  { id: 'reorder', header: 'Reorder at', accessorFn: (m) => Number(m.reorderLevel), cell: ({ row: { original: m } }) => formatQty(m.reorderLevel, m.unit) },
  { id: 'cost', header: 'Avg cost / kg', accessorFn: (m) => Number(m.avgCost), cell: ({ row: { original: m } }) => formatINR(m.avgCost) },
]

const inwardCols: ColumnDef<MaterialInward>[] = [
  { id: 'when', header: 'Received', accessorKey: 'receivedAt', cell: ({ getValue }) => formatDateTime(getValue<string>()) },
  { id: 'yarn', header: 'Yarn', accessorFn: (i) => `${i.material.yarnType} · ${i.material.colour}` },
  { id: 'supplier', header: 'Supplier', accessorFn: (i) => i.supplier.name },
  { id: 'order', header: 'For order', accessorFn: (i) => i.order?.orderNo ?? '—' },
  { id: 'qty', header: 'Qty', accessorFn: (i) => Number(i.qty), cell: ({ row: { original: i } }) => formatQty(i.qty, 'kg') },
  { id: 'bill', header: 'Bill', accessorFn: (i) => Number(i.billAmount), cell: ({ row: { original: i } }) => formatINR(i.billAmount) },
]

export function Materials() {
  const stock = useApi<RawMaterial[]>('/materials')
  const inwards = useApi<MaterialInward[]>('/inwards')
  const [open, setOpen] = useState(false)
  const low = stock.data?.filter(isLowStock) ?? []

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Yarn types" value={stock.data?.length ?? 0} loading={stock.loading} />
        <KpiCard
          label="Total yarn in store"
          value={formatQty(stock.data?.reduce((a, m) => a + Number(m.qtyInStock), 0) ?? 0, 'kg')}
          loading={stock.loading}
        />
        <KpiCard
          label="Low stock"
          value={<span className={low.length ? 'text-rose-600' : undefined}>{low.length}</span>}
          hint={low.map((m) => m.yarnType).join(', ') || 'All above reorder level'}
          loading={stock.loading}
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Stock</h2>
          <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
            <PackagePlus className="size-4" />
            Record inward
          </Button>
        </div>
        {stock.error && <p className="text-sm text-rose-600">{stock.error}</p>}
        <DataTable columns={stockCols} data={stock.data ?? []} loading={stock.loading} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Inward log</h2>
        <DataTable columns={inwardCols} data={inwards.data ?? []} loading={inwards.loading} />
      </section>

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
  const orders = useApi<Order[]>(open ? '/orders' : null)
  const [form, setForm] = useState({ materialId: '', supplierId: '', orderId: '', qty: '', rate: '' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const bill = Number(form.qty) * Number(form.rate)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await mutate('/inwards', 'POST', { ...form, qty: Number(form.qty), rate: Number(form.rate) }, 'Inward recorded, stock updated')
    setBusy(false)
    if (ok) {
      onSaved()
      onOpenChange(false)
      setForm({ materialId: '', supplierId: '', orderId: '', qty: '', rate: '' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Yarn at the gate</DialogTitle>
        </DialogHeader>
        <form id="inward" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Yarn" htmlFor="materialId">
              <select id="materialId" required className={selectClass} value={form.materialId} onChange={set('materialId')}>
                <option value="">Select yarn…</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.yarnType} · {m.colour}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Supplier" htmlFor="supplierId">
            <select id="supplierId" required className={selectClass} value={form.supplierId} onChange={set('supplierId')}>
              <option value="">Select…</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="For order (optional)" htmlFor="orderId">
            <select id="orderId" className={selectClass} value={form.orderId} onChange={set('orderId')}>
              <option value="">General stock</option>
              {orders.data
                ?.filter((o) => !['DISPATCHED', 'CANCELLED'].includes(o.status))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNo} · {o.buyer.name}
                  </option>
                ))}
            </select>
          </Field>
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
            {busy ? 'Saving…' : 'Save inward'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

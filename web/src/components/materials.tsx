import { useMemo, useState, type FormEvent } from 'react'
import { Field, selectClass } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { dayFromToday, formatINR, formatQty } from '@/lib/format'
import { mutate, useApi } from '@/lib/useApi'
import type { MaterialInward, Order, Planning, RawMaterial, Ref } from '@/types'

// Shared by the Raw materials overview and the per-material page.

// Units the store measures in. Kilograms, litres and countable items are never mixed:
// every figure is per material, in that material's own unit.
export const UNITS = [
  { value: 'kg', label: 'kg (weight)' },
  { value: 'L', label: 'litres (volume)' },
  { value: 'pcs', label: 'pieces' },
  { value: 'rolls', label: 'rolls' },
  { value: 'm', label: 'metres' },
]

export type Status = 'OUT' | 'SHORT' | 'LOW' | 'OK'
export interface Row extends RawMaterial {
  committed: number // still needed by open orders, from the production plan
  available: number // in stock minus committed
  lastSupplier: string | null
  status: Status
}

export const STATUS: Record<Status, { tone: 'problem' | 'watch' | 'good' | 'neutral'; text: string }> = {
  OUT: { tone: 'problem', text: 'Out of stock' },
  SHORT: { tone: 'problem', text: 'Short for open orders' },
  LOW: { tone: 'watch', text: 'Low stock' },
  OK: { tone: 'good', text: 'In stock' },
}

// Every material with what open orders still need and who supplied it last.
export function useMaterialRows() {
  const materials = useApi<RawMaterial[]>('/materials')
  const planning = useApi<Planning>('/planning/schedule?days=90')
  const inwards = useApi<MaterialInward[]>('/materials/inwards?limit=500')
  const rows = useMemo<Row[]>(() => {
    const needed = new Map((planning.data?.yarnNeeds ?? []).map((y) => [y.id, y.needed]))
    const supplier = new Map<string, string>()
    for (const i of inwards.data ?? []) if (!supplier.has(i.material.id)) supplier.set(i.material.id, i.supplier.name) // newest first
    return (materials.data ?? []).map((m) => {
      const committed = needed.get(m.id) ?? 0
      const available = m.qtyInStock - committed
      const status: Status = m.qtyInStock <= 0 ? 'OUT' : available < 0 ? 'SHORT' : m.lowStock ? 'LOW' : 'OK'
      return { ...m, committed, available, lastSupplier: supplier.get(m.id) ?? null, status }
    })
  }, [materials.data, planning.data, inwards.data])
  const reload = () => {
    materials.reload()
    planning.reload()
    inwards.reload()
  }
  return { rows, loading: materials.loading, planLoading: planning.loading, error: materials.error, reload, planning: planning.data }
}

export function AddMaterial({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', spec: '', unit: 'kg', reorderLevel: '' })
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await mutate(
      '/materials',
      'POST',
      { yarnType: form.name.trim(), colour: form.spec.trim(), unit: form.unit, reorderLevel: Number(form.reorderLevel) || 0 },
      `${form.name.trim()} added`,
    )
    setBusy(false)
    if (ok) {
      onSaved()
      onClose()
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add material</DialogTitle>
        </DialogHeader>
        <form id="add-material" onSubmit={submit} className="space-y-4">
          <Field label="Name" htmlFor="name" hint="e.g. Reactive Red ME4BL, Hydrogen peroxide 50%, Fabric core 60 in">
            <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Grade, shade or size" htmlFor="spec" hint="Kept as the second line; the name + this pair must be unique.">
            <Input id="spec" required value={form.spec} onChange={(e) => setForm({ ...form, spec: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Unit" htmlFor="unit">
              <select id="unit" className={selectClass} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Reorder at (${form.unit})`} htmlFor="reorderLevel">
              <Input id="reorderLevel" type="number" min="0" step="0.01" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} />
            </Field>
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form="add-material" disabled={busy || !form.name.trim() || !form.spec.trim()}>
            {busy ? 'Saving…' : 'Add material'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Receive({ m, onClose, onSaved }: { m: Row; onClose: () => void; onSaved: () => void }) {
  const suppliers = useApi<Ref[]>('/suppliers')
  const [form, setForm] = useState({ supplierId: '', qty: '', rate: m.avgCost > 0 ? String(m.avgCost) : '' })
  const [busy, setBusy] = useState(false)
  const qty = Number(form.qty)
  const rate = Number(form.rate)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await mutate('/materials/inwards', 'POST', { materialId: m.id, supplierId: form.supplierId, qty, rate }, `${formatQty(qty, m.unit)} of ${m.yarnType} received`)
    setBusy(false)
    if (ok) {
      onSaved()
      onClose()
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Receive {m.yarnType}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {m.colour} · now {formatQty(m.qtyInStock, m.unit)} in stock
        </p>
        <form id="receive" onSubmit={submit} className="space-y-4">
          <Field label="Supplier" htmlFor="supplierId">
            <select id="supplierId" required className={selectClass} value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">Select supplier…</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={`Quantity (${m.unit})`} htmlFor="qty">
              <Input id="qty" type="number" min="0.01" step="0.01" required value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
            </Field>
            <Field label={`Rate (₹/${m.unit})`} htmlFor="rate">
              <Input id="rate" type="number" min="0.01" step="0.01" required value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
            </Field>
          </div>
        </form>
        <DialogFooter className="items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{qty > 0 && rate > 0 ? `Bill ${formatINR(qty * rate)} · stock after ${formatQty(m.qtyInStock + qty, m.unit)}` : ''}</p>
          <Button type="submit" form="receive" disabled={busy || !form.supplierId || !(qty > 0) || !(rate > 0)}>
            {busy ? 'Saving…' : 'Receive'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Issue({ m, onClose, onSaved }: { m: Row; onClose: () => void; onSaved: () => void }) {
  const orders = useApi<Order[]>(`/orders?dueFrom=${dayFromToday(-30)}&limit=500`)
  const [form, setForm] = useState({ orderId: '', qty: '' })
  const [busy, setBusy] = useState(false)
  const qty = Number(form.qty)
  const tooMuch = qty > m.qtyInStock
  const open = (orders.data ?? []).filter((o) => !['DISPATCHED', 'CANCELLED', 'READY'].includes(o.status))
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await mutate('/materials/issues', 'POST', { materialId: m.id, orderId: form.orderId, qty }, `${formatQty(qty, m.unit)} of ${m.yarnType} issued`)
    setBusy(false)
    if (ok) {
      onSaved()
      onClose()
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Issue {m.yarnType}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {formatQty(m.qtyInStock, m.unit)} in stock · issued material is charged to the order's cost
        </p>
        <form id="issue" onSubmit={submit} className="space-y-4">
          <Field label="To order" htmlFor="orderId">
            <select id="orderId" required className={selectClass} value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })}>
              <option value="">{orders.loading ? 'Loading orders…' : 'Select an open order…'}</option>
              {open.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNo} · {o.buyer.name} · {o.fabricType}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={`Quantity (${m.unit})`}
            htmlFor="issue-qty"
            hint={tooMuch ? <span className="text-problem">Only {formatQty(m.qtyInStock, m.unit)} in stock; the store will refuse this.</span> : qty > 0 ? `Stock after ${formatQty(m.qtyInStock - qty, m.unit)}` : undefined}
          >
            <Input id="issue-qty" type="number" min="0.01" step="0.01" required value={form.qty} aria-invalid={tooMuch} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
          </Field>
        </form>
        <DialogFooter>
          <Button type="submit" form="issue" disabled={busy || !form.orderId || !(qty > 0) || tooMuch}>
            {busy ? 'Saving…' : 'Issue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Stock adjustments (count corrections, damage, returns) have no endpoint yet. Say so plainly
// instead of offering a form that cannot save.
export function Adjust({ m, onClose }: { m: Row; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust {m.yarnType}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-ink-2">
          Stock can only change through a receipt or an issue today. Corrections after a physical count, damaged stock and returns to supplier need a
          stock-adjustment endpoint that the backend does not have yet, so nothing can be saved here.
        </p>
        <p className="text-xs text-ink-3">Requested: POST /materials/:id/adjustments {'{ qty (+/-), reason, note }'} recorded in the movement history.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


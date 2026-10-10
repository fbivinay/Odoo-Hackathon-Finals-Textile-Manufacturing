import { useEffect, useState } from 'react'
import { Printer, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import { selectClass } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatINR, formatQty, toISODate } from '@/lib/format'
import { fetchAll, useApi } from '@/lib/useApi'
import type { MaterialInward, RawMaterial, Ref } from '@/types'

export type ReorderItem = { m: RawMaterial; qty: number }
type Line = { qty: string; supplierId: string; rate: number }

const NONE = ''
const label = (m: RawMaterial) => (m.colour ? `${m.yarnType} · ${m.colour}` : m.yarnType)

// One purchase order for every short material. Each material goes to the supplier it last came
// from at the last rate paid; both can be changed. Placing it saves it as pending: stock only
// goes up when the store marks it received.
export function ReorderDialog({ open, onOpenChange, items, inwardsPath, onPlaced }: { open: boolean; onOpenChange: (o: boolean) => void; items: ReorderItem[]; inwardsPath: string; onPlaced: () => void }) {
  const suppliers = useApi<Ref[]>(open ? '/suppliers' : null)
  const [lines, setLines] = useState<Record<string, Line>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let live = true
    const base = Object.fromEntries(items.map(({ m, qty }) => [m.id, { qty: String(qty), supplierId: NONE, rate: Number(m.avgCost) }]))
    setLines(base)
    // Newest first, so the first delivery seen for a material is its last one.
    fetchAll<MaterialInward>(inwardsPath).then((rows) => {
      if (!live) return
      const last = new Map<string, MaterialInward>()
      for (const r of rows) if (!last.has(r.material.id)) last.set(r.material.id, r)
      setLines((cur) =>
        Object.fromEntries(Object.entries(cur).map(([id, l]) => [id, last.has(id) ? { ...l, supplierId: l.supplierId || last.get(id)!.supplier.id, rate: Number(last.get(id)!.rate) } : l])),
      )
    }, () => {})
    return () => {
      live = false
    }
  }, [open, items, inwardsPath])

  const edit = (id: string, patch: Partial<Line>) => setLines((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }))
  const rows = items.filter(({ m }) => lines[m.id]).map(({ m }) => ({ m, ...lines[m.id], amount: Number(lines[m.id].qty) * lines[m.id].rate }))
  const ordered = rows.filter((r) => Number(r.qty) > 0)
  const total = ordered.reduce((s, r) => s + (r.amount || 0), 0)
  const missingSupplier = ordered.some((r) => !r.supplierId)
  const today = toISODate(new Date())

  async function place() {
    setBusy(true)
    try {
      const made = await api<unknown[]>('/materials/purchase-orders', {
        method: 'POST',
        body: { lines: ordered.map((r) => ({ materialId: r.m.id, supplierId: r.supplierId, qty: Number(r.qty), rate: r.rate })) },
      })
      toast.success(`${made.length} order${made.length === 1 ? '' : 's'} placed`, { description: 'Pending in Order History until you mark them received.' })
      onPlaced()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="print-area max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Purchase order · {formatDate(today)}</DialogTitle>
          <DialogDescription>
            {items.length} item{items.length === 1 ? '' : 's'} short. Quantities cover open orders and refill to the warning level, less what is already on order.
          </DialogDescription>
        </DialogHeader>

        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 font-medium">Item</th>
              <th className="py-1.5 font-medium">In stock</th>
              <th className="w-28 py-1.5 font-medium">Order</th>
              <th className="py-1.5 font-medium">Supplier</th>
              <th className="py-1.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.m.id} className="border-t border-border">
                <td className="py-1.5 pr-2 font-medium">{label(r.m)}</td>
                <td className="py-1.5 pr-2 tabular-nums text-muted-foreground">{formatQty(r.m.qtyInStock, r.m.unit)}</td>
                <td className="py-1.5 pr-2">
                  <div className="flex items-center gap-1">
                    <Input aria-label={`Quantity of ${label(r.m)}`} type="number" min="0" step="10" className="h-8 tabular-nums print:border-0 print:p-0" value={r.qty} onChange={(e) => edit(r.m.id, { qty: e.target.value })} />
                    <span className="text-xs text-muted-foreground">{r.m.unit}</span>
                  </div>
                </td>
                <td className="py-1.5 pr-2">
                  <select aria-label={`Supplier for ${label(r.m)}`} className={`${selectClass} h-8 print:appearance-none print:border-0 print:p-0`} value={r.supplierId} onChange={(e) => edit(r.m.id, { supplierId: e.target.value })}>
                    <option value={NONE}>Pick supplier…</option>
                    {suppliers.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 text-right tabular-nums">{r.amount > 0 ? formatINR(r.amount) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td colSpan={4} className="py-2">
                Total at last rates paid
              </td>
              <td className="py-2 text-right tabular-nums">{formatINR(total)}</td>
            </tr>
          </tfoot>
        </table>

        <DialogFooter className="print:hidden">
          {missingSupplier && <p className="mr-auto self-center text-sm text-problem">Pick a supplier for every item.</p>}
          <Button variant="outline" className="gap-1.5" onClick={() => window.print()} disabled={!ordered.length}>
            <Printer className="size-4" />
            Print
          </Button>
          <Button className="gap-1.5" onClick={place} disabled={busy || !ordered.length || missingSupplier}>
            <ShoppingCart className="size-4" />
            {busy ? 'Placing…' : `Place order · ${formatINR(total)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

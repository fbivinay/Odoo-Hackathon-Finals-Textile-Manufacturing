import { useState, type FormEvent } from 'react'
import { Field } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatQty } from '@/lib/format'
import { mutate } from '@/lib/useApi'
import type { RawMaterial } from '@/types'

// Sets the stock level below which a material is flagged "Low". Used by Yarn Received and Raw Materials.
export function StockWarningDialog({ m, onClose, onSaved }: { m: RawMaterial; onClose: () => void; onSaved: () => void }) {
  const [level, setLevel] = useState(m.reorderLevel > 0 ? String(m.reorderLevel) : '')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const value = Number(level) || 0
    const ok = await mutate(`/materials/${m.id}`, 'PATCH', { reorderLevel: value }, value > 0 ? `Warning set at ${formatQty(value, m.unit)}` : 'Warning turned off')
    setBusy(false)
    if (ok) {
      onSaved()
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Low-stock warning</DialogTitle>
          <DialogDescription>
            {m.yarnType} · {m.colour} · {formatQty(m.qtyInStock, m.unit)} in stock
          </DialogDescription>
        </DialogHeader>
        <form id="stock-warning" onSubmit={submit}>
          <Field label={`Warn me below (${m.unit})`} htmlFor="reorderLevel" hint="Leave empty for no warning.">
            <Input id="reorderLevel" type="number" min="0" step="1" inputMode="numeric" autoFocus value={level} onChange={(e) => setLevel(e.target.value)} />
          </Field>
        </form>
        <DialogFooter>
          <Button type="submit" form="stock-warning" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

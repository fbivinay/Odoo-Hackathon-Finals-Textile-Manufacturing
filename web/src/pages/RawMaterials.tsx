import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, PackagePlus, Search, Truck } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { selectClass } from '@/components/Field'
import { AddMaterial, STATUS, useMaterialRows, type Row, type Status } from '@/components/materials'
import { PageHead } from '@/components/PageHead'
import { Pill } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatINR, formatMoney, formatQty } from '@/lib/format'
import { cn } from '@/lib/utils'

const ORDER: Record<Status, number> = { OUT: 0, SHORT: 1, LOW: 2, OK: 3 }

export function RawMaterials() {
  const { rows, loading, planLoading, error, reload } = useMaterialRows()
  const [filter, setFilter] = useState<'ALL' | Status>('ALL')
  const [unit, setUnit] = useState('ALL')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)

  const units = [...new Set(rows.map((r) => r.unit))]
  const shown = rows
    .filter((r) => (filter === 'ALL' || r.status === filter) && (unit === 'ALL' || r.unit === unit))
    .filter((r) => !q.trim() || `${r.yarnType} ${r.colour} ${r.lastSupplier ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.yarnType.localeCompare(b.yarnType))
  const count = (s: Status) => rows.filter((r) => r.status === s).length
  const value = rows.reduce((t, r) => t + r.qtyInStock * r.avgCost, 0)

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Store"
        title="Raw materials"
        lede="Everything the mill holds, from yarn to dyes, chemicals and packaging. Open a material to see its stock, movements, suppliers and the orders waiting for it."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to="/materials">
                <Truck className="size-4" />
                Yarn deliveries log
              </Link>
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
              <PackagePlus className="size-4" />
              Add material
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard label="Materials" value={String(rows.length)} hint={units.length ? `Measured in ${units.join(', ')}` : undefined} loading={loading} />
        <KpiCard label="Stock value" value={formatMoney(value)} hint="Stock × average cost" loading={loading} />
        <KpiCard label="Short for open orders" tone={count('SHORT') ? 'problem' : undefined} value={String(count('SHORT'))} hint="Committed more than is in stock" loading={loading || planLoading} />
        <KpiCard label="Low or out of stock" tone={count('LOW') + count('OUT') ? 'watch' : undefined} value={String(count('LOW') + count('OUT'))} hint="At or below reorder level" loading={loading} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['ALL', 'SHORT', 'LOW', 'OUT', 'OK'] as const).map((s) => (
          <Button key={s} size="sm" variant={filter === s ? 'secondary' : 'ghost'} onClick={() => setFilter(s)}>
            {s === 'ALL' ? 'All' : STATUS[s].text}
            <span className="ml-1 text-xs text-muted-foreground">{s === 'ALL' ? rows.length : count(s)}</span>
          </Button>
        ))}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input aria-label="Search materials" placeholder="Search name or supplier" className="w-56 bg-surface pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select aria-label="Unit" className={`${selectClass} w-32 bg-surface`} value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="ALL">All units</option>
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-problem">{error}</p>}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-[18px]" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="card">
          <EmptyState icon={PackagePlus} line={rows.length ? 'No material matches this filter.' : 'No materials yet. Add the first one.'} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((m) => (
            <MaterialCard key={m.id} m={m} />
          ))}
        </div>
      )}
      <p className="text-xs text-ink-3">Categories (yarn, dyes, chemicals, packaging…) are not stored by the API yet, so materials are listed by name and unit.</p>

      {adding && <AddMaterial onClose={() => setAdding(false)} onSaved={reload} />}
    </div>
  )
}

// One material at a glance: stock against its reorder level and what open orders need.
function MaterialCard({ m }: { m: Row }) {
  // Bar scale: the larger of stock, committed and twice the reorder level, so all three fit.
  const scale = Math.max(m.qtyInStock, m.committed, m.reorderLevel * 2, 1)
  const st = STATUS[m.status]
  return (
    <Link to={`/raw-materials/${m.id}`} className="card group block space-y-3 focus-visible:outline-2 focus-visible:outline-brand" aria-label={`Open ${m.yarnType}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="line-clamp-2 leading-snug font-medium">{m.yarnType}</p>
          <p className="truncate text-xs text-muted-foreground">{m.colour}</p>
        </div>
        <Pill tone={st.tone} className="shrink-0">{st.text}</Pill>
      </div>
      <div>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{formatQty(m.qtyInStock, m.unit)}</p>
        <p className="text-xs text-ink-3">in stock</p>
      </div>
      <div className="space-y-1">
        <div className="relative h-2 overflow-hidden rounded-full bg-ink/5">
          <div className={cn('h-full rounded-full', m.status === 'OK' ? 'bg-brand' : m.status === 'LOW' ? 'bg-watch' : 'bg-problem')} style={{ width: `${(m.qtyInStock / scale) * 100}%` }} />
          {/* reorder level marker */}
          <div className="absolute inset-y-0 w-0.5 bg-ink-2" style={{ left: `${(m.reorderLevel / scale) * 100}%` }} title="Reorder level" />
        </div>
        <p className="text-[0.68rem] text-ink-3">Line marks the reorder level ({formatQty(m.reorderLevel, m.unit)})</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-ink-3">Needed by open orders</dt>
        <dd className="text-right tabular-nums">{m.committed > 0 ? formatQty(m.committed, m.unit) : '—'}</dd>
        <dt className="text-ink-3">Available</dt>
        <dd className={cn('text-right tabular-nums', m.available < 0 && 'font-medium text-problem')}>{formatQty(m.available, m.unit)}</dd>
        <dt className="text-ink-3">Average cost</dt>
        <dd className="text-right tabular-nums">{m.avgCost > 0 ? `${formatINR(m.avgCost)}/${m.unit}` : '—'}</dd>
        <dt className="text-ink-3">Last supplier</dt>
        <dd className="truncate text-right">{m.lastSupplier ?? '—'}</dd>
      </dl>
      <p className="flex items-center gap-1 text-xs font-medium text-brand">
        View details
        <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
      </p>
    </Link>
  )
}

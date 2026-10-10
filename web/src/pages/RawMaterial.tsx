import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowLeft, Bell, BellOff, PackageSearch } from 'lucide-react'
import { useSession } from '@/auth/session'
import { actsAs } from '@/components/AppShell'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { PageHead } from '@/components/PageHead'
import { Pill } from '@/components/StatusPill'
import { StockWarningDialog } from '@/components/StockWarningDialog'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { dayFromToday, formatDate, formatDateTime, formatDayMonth, formatINR, formatMoney, formatQty } from '@/lib/format'
import { toOrder } from '@/lib/reorder'
import { useApi } from '@/lib/useApi'
import type { MaterialInward, PurchaseOrder, RawMaterial as Material, Ref } from '@/types'
import { CATEGORY, UseDialog } from './RawMaterials'

type TaxCodeInfo = { code: string; label: string; hsn: string; rateToday: number; confidence: string }
type Use = { id: string; qty: number; cost: number; issuedAt: string; department?: string | null; order?: { orderNo: string } | null }
interface Move {
  id: string
  at: string
  kind: 'IN' | 'OUT'
  party: string
  note: string
  qty: number // signed: + received, − used
  value: number
  balance: number // stock after this movement
}

// One store material (chemicals, packaging, spares...): what is in stock, everything about it,
// where it comes from, and every delivery and use.
export function RawMaterial() {
  const { id = '' } = useParams()
  const { user } = useSession()
  const canEdit = actsAs(user, 'STORE')
  const stock = useApi<Material[]>('/materials?kind=other')
  const m = stock.data?.find((x) => x.id === id)
  const ins = useApi<MaterialInward[]>(`/materials/inwards?materialId=${id}&limit=500`)
  const outs = useApi<Use[]>(`/materials/issues?materialId=${id}&limit=500`)
  const pending = useApi<PurchaseOrder[]>('/materials/purchase-orders?status=PENDING&kind=other')
  const suppliersList = useApi<Ref[]>('/suppliers')
  const taxCodes = useApi<TaxCodeInfo[]>('/materials/tax-codes')
  const [using, setUsing] = useState(false)
  const [warning, setWarning] = useState(false)
  const [shown, setShown] = useState(20)
  const refresh = () => {
    stock.reload()
    ins.reload()
    outs.reload()
  }

  // Every delivery and use, newest first, with the stock left after each one. Balances run back
  // from today's stock, so the latest always equals what the store shows.
  const moves = useMemo<Move[]>(() => {
    if (!m) return []
    const list = [
      ...(ins.data ?? []).map((i) => ({
        id: i.id,
        at: i.receivedAt,
        kind: 'IN' as const,
        party: i.supplier.name,
        note: i.billNo ?? '',
        qty: i.qty,
        value: Number(i.totalAmount ?? i.billAmount),
      })),
      ...(outs.data ?? []).map((u) => ({
        id: u.id,
        at: u.issuedAt,
        kind: 'OUT' as const,
        party: u.order?.orderNo ?? 'General use',
        note: u.department ? u.department.charAt(0) + u.department.slice(1).toLowerCase() : '',
        qty: -u.qty,
        value: Number(u.cost),
      })),
    ].sort((a, b) => b.at.localeCompare(a.at))
    const out: Move[] = []
    for (let i = 0, balance = m.qtyInStock; i < list.length; i += 1) {
      out.push({ ...list[i], balance })
      balance -= list[i].qty
    }
    return out
  }, [ins.data, outs.data, m])

  // Stock at the end of each of the last 90 days, for the chart.
  const curve = useMemo(() => {
    if (!m) return []
    const points: { day: string; stock: number }[] = []
    let i = 0
    for (let d = 0; d < 90; d += 1) {
      const day = dayFromToday(-d)
      while (i < moves.length && moves[i].at.slice(0, 10) > day) i += 1
      points.push({ day, stock: i < moves.length ? moves[i].balance : m.qtyInStock - moves.reduce((t, x) => t + x.qty, 0) })
    }
    return points.reverse()
  }, [moves, m])

  const suppliers = useMemo(() => {
    const by = new Map<string, { name: string; deliveries: number; qty: number; value: number; last: string }>()
    for (const i of ins.data ?? []) {
      const s = by.get(i.supplier.id) ?? { name: i.supplier.name, deliveries: 0, qty: 0, value: 0, last: i.receivedAt }
      s.deliveries += 1
      s.qty += i.qty
      s.value += i.billAmount
      if (i.receivedAt > s.last) s.last = i.receivedAt
      by.set(i.supplier.id, s)
    }
    return [...by.values()].sort((a, b) => b.qty - a.qty)
  }, [ins.data])

  if (stock.loading && !stock.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-80" />
        <Skeleton className="h-28" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (!m) {
    return (
      <div className="card">
        <EmptyState icon={PackageSearch} line="This material was not found." />
        <div className="pb-6 text-center">
          <Link to="/raw-materials" className="text-sm font-medium text-brand hover:underline">
            Back to raw materials
          </Link>
        </div>
      </div>
    )
  }

  const onOrder = (pending.data ?? []).filter((p) => p.material.id === m.id).reduce((t, p) => t + Number(p.qty), 0)
  const short = toOrder(m, 0, onOrder)
  const low = m.lowStock || short > 0
  const lastIn = moves.find((x) => x.kind === 'IN')
  const rule = taxCodes.data?.find((t) => t.code === m.taxCode)
  const usual = suppliersList.data?.find((s) => s.id === m.supplierId)?.name ?? suppliers[0]?.name
  const about: [string, string][] = [
    ['Section', CATEGORY[m.category as keyof typeof CATEGORY] ?? m.category],
    ['Type', m.subcategory || '—'],
    ['SKU', m.sku || '—'],
    ['Used by', m.department ? m.department.charAt(0) + m.department.slice(1).toLowerCase() : '—'],
    ['Usual supplier', usual ?? '—'],
    ['Delivery time', m.leadDays != null ? `${m.leadDays} days` : '—'],
    ['GST', rule ? `${rule.rateToday}% · HSN ${rule.hsn}${rule.confidence === 'UNVERIFIED' ? ' (unverified)' : ''}` : 'Not classified'],
    ['GST rule', rule?.label ?? '—'],
  ]
  const moveCols: ColumnDef<Move>[] = [
    { id: 'at', header: 'When', accessorFn: (x) => x.at, cell: ({ row: { original: x } }) => formatDateTime(x.at) },
    { id: 'kind', header: 'What', accessorFn: (x) => x.kind, cell: ({ row: { original: x } }) => <Pill tone={x.kind === 'IN' ? 'good' : 'neutral'}>{x.kind === 'IN' ? 'Received' : 'Used'}</Pill> },
    {
      id: 'party',
      header: 'From / for',
      accessorFn: (x) => x.party,
      cell: ({ row: { original: x } }) => (
        <div className="leading-tight">
          <p>{x.party}</p>
          {x.note && <p className="text-xs text-muted-foreground">{x.note}</p>}
        </div>
      ),
    },
    {
      id: 'qty',
      header: 'Quantity',
      accessorFn: (x) => x.qty,
      cell: ({ row: { original: x } }) => (
        <span className={x.qty > 0 ? 'text-good tabular-nums' : 'tabular-nums'}>
          {x.qty > 0 ? '+' : '−'}
          {formatQty(Math.abs(x.qty), m.unit)}
        </span>
      ),
    },
    { id: 'value', header: 'Value', accessorFn: (x) => x.value, cell: ({ row: { original: x } }) => formatINR(x.value) },
    { id: 'balance', header: 'Stock after', accessorFn: (x) => x.balance, cell: ({ row: { original: x } }) => formatQty(x.balance, m.unit) },
  ]

  return (
    <div className="space-y-6">
      <Link to="/raw-materials" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        <ArrowLeft className="size-3" />
        Raw Materials
      </Link>
      <PageHead
        eyebrow={about[0][1]}
        title={m.yarnType}
        lede={[m.colour, m.sku].filter(Boolean).join(' · ')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {low ? <Pill tone="problem">{short > 0 ? `Short ${formatQty(short, m.unit)}` : 'Low'}</Pill> : <Pill tone="good">Enough stock</Pill>}
            {canEdit && (
              <>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setWarning(true)}>
                  {m.reorderLevel > 0 ? <Bell className="size-4" /> : <BellOff className="size-4" />}
                  Warning level
                </Button>
                <Button size="sm" disabled={m.qtyInStock <= 0} onClick={() => setUsing(true)}>
                  Use
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="In stock" tone={low ? 'problem' : undefined} value={formatQty(m.qtyInStock, m.unit)} hint={lastIn ? `Last received ${formatDate(lastIn.at)}` : 'Never received'} />
        <KpiCard label="Warning level" value={m.reorderLevel > 0 ? formatQty(m.reorderLevel, m.unit) : 'Not set'} hint="Warns when stock falls below this" />
        <KpiCard
          label="On order"
          tone={onOrder > 0 ? 'watch' : undefined}
          value={onOrder > 0 ? formatQty(onOrder, m.unit) : 'Nothing'}
          hint={short > 0 ? `Still short by ${formatQty(short, m.unit)}` : 'Not short'}
        />
        <KpiCard label="Stock value" value={formatMoney(m.qtyInStock * m.avgCost)} hint={m.avgCost > 0 ? `Average ${formatINR(m.avgCost)} per ${m.unit}` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="section-head">About this material</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {about.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card space-y-3">
          <h2 className="section-head">Suppliers</h2>
          {ins.loading ? (
            <Skeleton className="h-32" />
          ) : suppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not received from any supplier yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 text-left font-medium">Supplier</th>
                  <th className="py-1 text-right font-medium">Deliveries</th>
                  <th className="py-1 text-right font-medium">Received</th>
                  <th className="py-1 text-right font-medium">Avg rate</th>
                  <th className="py-1 text-right font-medium">Last</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.name} className="border-b last:border-0">
                    <td className="py-1.5">{s.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.deliveries}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatQty(s.qty, m.unit)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatINR(s.value / s.qty)}</td>
                    <td className="py-1.5 text-right text-xs text-ink-3">{formatDate(s.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="section-head">Stock over the last 90 days</h2>
          {m.reorderLevel > 0 && <span className="text-xs text-ink-3">Dashed line: warning level</span>}
        </div>
        {ins.loading || outs.loading ? (
          <Skeleton className="h-56" />
        ) : moves.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deliveries or uses yet.</p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={curve} margin={{ left: 0, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="stockFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#714b67" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#714b67" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#e3e3e6" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} tickFormatter={(d) => formatDayMonth(d)} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={56} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e3e3e6', fontSize: 12 }} labelFormatter={(d) => formatDate(String(d))} formatter={(v) => [formatQty(Number(v), m.unit), 'Stock']} />
                {m.reorderLevel > 0 && <ReferenceLine y={m.reorderLevel} stroke="#96600a" strokeDasharray="4 4" />}
                <Area type="stepAfter" dataKey="stock" stroke="#714b67" strokeWidth={2} fill="url(#stockFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="section-head">Every delivery and use</h2>
        <DataTable columns={moveCols} data={moves.slice(0, shown)} loading={ins.loading || outs.loading} empty={<EmptyState icon={PackageSearch} line="No deliveries or uses yet." />} />
        {moves.length > shown && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => setShown((n) => n + 20)}>
              Show more ({(moves.length - shown).toLocaleString('en-IN')} left)
            </Button>
          </div>
        )}
      </section>

      {using && <UseDialog m={m} onClose={() => setUsing(false)} onSaved={refresh} />}
      {warning && <StockWarningDialog m={m} onClose={() => setWarning(false)} onSaved={stock.reload} />}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, PackageSearch, SlidersHorizontal } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Adjust, Issue, Receive, STATUS, useMaterialRows } from '@/components/materials'
import { PageHead } from '@/components/PageHead'
import { Pill } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { dayFromToday, formatDate, formatDateTime, formatDayMonth, formatINR, formatMoney, formatQty } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import type { MaterialInward, MaterialIssue, Order } from '@/types'

interface Move {
  id: string
  at: string
  kind: 'IN' | 'OUT'
  party: string
  qty: number // signed: + received, − issued
  rate: number | null
  value: number
  balance: number // stock after this movement
}

export function RawMaterial() {
  const { id = '' } = useParams()
  const { rows, loading, planning, reload } = useMaterialRows()
  const m = rows.find((r) => r.id === id)
  const ins = useApi<MaterialInward[]>(`/materials/inwards?materialId=${id}&limit=500`)
  const outs = useApi<(MaterialIssue & { order?: { orderNo: string } })[]>(`/materials/issues?materialId=${id}&limit=500`)
  const orders = useApi<Order[]>(`/orders?dueFrom=${dayFromToday(-120)}&limit=500`)
  const [action, setAction] = useState<'receive' | 'issue' | 'adjust' | null>(null)
  const refresh = () => {
    reload()
    ins.reload()
    outs.reload()
    orders.reload()
  }

  // Every receipt and issue, newest first, with the stock left after each one. Balances run back
  // from today's stock, so the latest always equals what the store shows.
  const moves = useMemo<Move[]>(() => {
    if (!m) return []
    const list = [
      ...(ins.data ?? []).map((i) => ({ id: i.id, at: i.receivedAt, kind: 'IN' as const, party: i.supplier.name, qty: i.qty, rate: i.rate, value: i.billAmount })),
      ...(outs.data ?? []).map((i) => ({ id: i.id, at: i.issuedAt, kind: 'OUT' as const, party: i.order?.orderNo ?? 'Order', qty: -i.qty, rate: i.qty ? i.cost / i.qty : null, value: i.cost })),
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

  const needing = useMemo(() => {
    const plan = new Map((planning?.orders ?? []).map((o) => [o.id, o]))
    return (orders.data ?? [])
      .filter((o) => o.materialId === id && !['DISPATCHED', 'CANCELLED'].includes(o.status))
      .map((o) => ({ ...o, toIssue: plan.get(o.id)?.yarnToIssue ?? 0, shortBy: plan.get(o.id)?.yarnShortBy ?? 0 }))
      .filter((o) => o.toIssue > 0)
      .sort((a, b) => a.deadline.localeCompare(b.deadline))
  }, [orders.data, planning, id])

  if (loading) {
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

  const st = STATUS[m.status]
  const lastIn = moves.find((x) => x.kind === 'IN')
  const moveCols: ColumnDef<Move>[] = [
    { id: 'at', header: 'When', accessorFn: (x) => x.at, cell: ({ row: { original: x } }) => formatDateTime(x.at) },
    { id: 'kind', header: 'Movement', accessorFn: (x) => x.kind, cell: ({ row: { original: x } }) => <Pill tone={x.kind === 'IN' ? 'good' : 'neutral'}>{x.kind === 'IN' ? 'Received' : 'Issued'}</Pill> },
    { id: 'party', header: 'From / to', accessorFn: (x) => x.party },
    {
      id: 'qty',
      header: 'Quantity',
      accessorFn: (x) => x.qty,
      cell: ({ row: { original: x } }) => (
        <span className={x.qty > 0 ? 'text-good' : undefined}>
          {x.qty > 0 ? '+' : '−'}
          {formatQty(Math.abs(x.qty), m.unit)}
        </span>
      ),
    },
    { id: 'rate', header: 'Rate', accessorFn: (x) => x.rate ?? 0, cell: ({ row: { original: x } }) => (x.rate ? `${formatINR(x.rate)}/${m.unit}` : '—') },
    { id: 'value', header: 'Value', accessorFn: (x) => x.value, cell: ({ row: { original: x } }) => formatINR(x.value) },
    { id: 'balance', header: 'Stock after', accessorFn: (x) => x.balance, cell: ({ row: { original: x } }) => formatQty(x.balance, m.unit) },
  ]

  return (
    <div className="space-y-6">
      <Link to="/raw-materials" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        <ArrowLeft className="size-3" />
        Raw materials
      </Link>
      <PageHead
        eyebrow={`Raw material · ${m.unit}`}
        title={m.yarnType}
        lede={m.colour}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={st.tone}>{st.text}</Pill>
            <Button size="sm" className="gap-1.5" onClick={() => setAction('receive')}>
              <ArrowDownToLine className="size-4" />
              Receive
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAction('issue')}>
              <ArrowUpFromLine className="size-4" />
              Issue
            </Button>
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setAction('adjust')}>
              <SlidersHorizontal className="size-4" />
              Adjust
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="In stock" value={formatQty(m.qtyInStock, m.unit)} hint={lastIn ? `Last received ${formatDate(lastIn.at)}` : 'Never received'} />
        <KpiCard label="Needed by open orders" value={formatQty(m.committed, m.unit)} hint="From the production plan" />
        <KpiCard label="Available" tone={m.available < 0 ? 'problem' : undefined} value={formatQty(m.available, m.unit)} hint={m.available < 0 ? 'Order more' : 'Free for new orders'} />
        <KpiCard label="Reorder at" tone={m.lowStock ? 'watch' : undefined} value={formatQty(m.reorderLevel, m.unit)} />
        <KpiCard label="Average cost" value={m.avgCost > 0 ? formatINR(m.avgCost) : '—'} hint={`per ${m.unit}`} />
        <KpiCard label="Stock value" value={formatMoney(m.qtyInStock * m.avgCost)} />
      </div>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="section-head">Stock over the last 90 days</h2>
          <span className="text-xs text-ink-3">Dashed line: reorder level</span>
        </div>
        {ins.loading || outs.loading ? (
          <Skeleton className="h-56" />
        ) : moves.length === 0 ? (
          <p className="text-sm text-muted-foreground">No receipts or issues yet.</p>
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
                <ReferenceLine y={m.reorderLevel} stroke="#96600a" strokeDasharray="4 4" />
                <Area type="stepAfter" dataKey="stock" stroke="#714b67" strokeWidth={2} fill="url(#stockFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
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
          {(ins.data?.length ?? 0) === 500 && <p className="text-xs text-ink-3">Based on the latest 500 deliveries.</p>}
        </section>

        <section className="card space-y-3">
          <h2 className="section-head">Open orders waiting for it</h2>
          {orders.loading ? (
            <Skeleton className="h-32" />
          ) : needing.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open order still needs this material issued.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 text-left font-medium">Order</th>
                  <th className="py-1 text-left font-medium">Due</th>
                  <th className="py-1 text-right font-medium">Still to issue</th>
                  <th className="py-1 text-right font-medium">Cover</th>
                </tr>
              </thead>
              <tbody>
                {needing.slice(0, 12).map((o) => (
                  <tr key={o.id} className="border-b last:border-0">
                    <td className="py-1.5">
                      {o.orderNo}
                      <span className="block text-xs text-ink-3">{o.buyer.name}</span>
                    </td>
                    <td className="py-1.5 text-xs">{formatDate(o.deadline)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatQty(o.toIssue, m.unit)}</td>
                    <td className="py-1.5 text-right">{o.shortBy > 0 ? <Pill tone="problem">Short {formatQty(o.shortBy, m.unit)}</Pill> : <Pill tone="good">Covered</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {needing.length > 12 && <p className="text-xs text-ink-3">+{needing.length - 12} more, earliest deadline first.</p>}
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="section-head">Movements</h2>
        <DataTable
          columns={moveCols}
          data={moves}
          loading={ins.loading || outs.loading}
          empty={<EmptyState icon={PackageSearch} line="No receipts or issues yet." />}
        />
      </section>

      {action === 'receive' && <Receive m={m} onClose={() => setAction(null)} onSaved={refresh} />}
      {action === 'issue' && <Issue m={m} onClose={() => setAction(null)} onSaved={refresh} />}
      {action === 'adjust' && <Adjust m={m} onClose={() => setAction(null)} />}
    </div>
  )
}

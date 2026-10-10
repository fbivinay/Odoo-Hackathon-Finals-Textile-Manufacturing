import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DataTable } from '@/components/DataTable'
import { label } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Input } from '@/components/ui/input'
import { formatINR, formatQty, unitFor } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import type { OwnerReport, Stage } from '@/types'

const STAGE_COLOR: Record<Stage, string> = { SPINNING: '#0ea5e9', WEAVING: '#6366f1', DYEING: '#a855f7' }

const orderCols: ColumnDef<OwnerReport['orders'][number]>[] = [
  { accessorKey: 'orderNo', header: 'Order' },
  { accessorKey: 'buyer', header: 'Buyer' },
  { accessorKey: 'revenue', header: 'Order value', cell: ({ getValue }) => formatINR(getValue<number>()) },
  { accessorKey: 'materialCost', header: 'Yarn cost', cell: ({ getValue }) => formatINR(getValue<number>()) },
  {
    accessorKey: 'margin',
    header: 'Margin',
    cell: ({ row: { original: o } }) => (
      <span className={o.margin < 0 ? 'text-rose-600' : 'text-emerald-700'}>
        {formatINR(o.margin)}
        {o.revenue > 0 && <span className="ml-1 text-xs text-muted-foreground">{Math.round((o.margin / o.revenue) * 100)}%</span>}
      </span>
    ),
  },
]

export function Dashboard() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const { data: r, loading, error } = useApi<OwnerReport>(`/reports/owner?month=${month}`)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Month at a glance</h2>
        <Input type="month" className="w-40" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Invoiced" value={formatINR(r?.revenue ?? 0)} loading={loading} />
        <KpiCard label="Received from buyers" value={formatINR(r?.received ?? 0)} loading={loading} />
        <KpiCard label="Raw material bills" value={formatINR(r?.materialCost ?? 0)} loading={loading} />
        <KpiCard label="Wages paid" value={formatINR(r?.wages ?? 0)} loading={loading} />
        <KpiCard
          label="Profit"
          value={<span className={(r?.profit ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-600'}>{formatINR(r?.profit ?? 0)}</span>}
          hint="Invoiced − material − wages"
          loading={loading}
          className="ring-1 ring-indigo-100"
        />
      </div>

      <section className="space-y-3 rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Machine output</h2>
          <div className="flex gap-3 text-xs text-muted-foreground">
            {(Object.keys(STAGE_COLOR) as Stage[]).map((s) => (
              <span key={s} className="flex items-center gap-1">
                <span className="size-2 rounded-full" style={{ background: STAGE_COLOR[s] }} />
                {label(s)} ({unitFor(s)})
              </span>
            ))}
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={r?.machines ?? []} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#f4f4f5" />
              <XAxis dataKey="code" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} />
              <Tooltip
                cursor={{ fill: '#f4f4f5' }}
                formatter={(v, _n, item) => [formatQty(Number(v), unitFor(item.payload.type)), 'Produced']}
              />
              <Bar dataKey="produced" radius={[4, 4, 0, 0]}>
                {r?.machines.map((m) => <Cell key={m.code} fill={STAGE_COLOR[m.type]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Cost per order</h2>
        <DataTable columns={orderCols} data={r?.orders ?? []} loading={loading} initialSorting={[{ id: 'margin', desc: true }]} />
      </section>
    </div>
  )
}

import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DataTable } from '@/components/DataTable'
import { label } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Input } from '@/components/ui/input'
import { formatINR, formatQty, unitFor } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import type { MachineOutput, OrderCost, Pnl, Stage } from '@/types'

const STAGE_COLOR: Record<Stage, string> = { SPINNING: '#0ea5e9', WEAVING: '#6366f1', DYEING: '#a855f7' }

const money = ({ getValue }: { getValue: () => unknown }) => formatINR(getValue() as number)

const orderCols: ColumnDef<OrderCost>[] = [
  { accessorKey: 'orderNo', header: 'Order' },
  { id: 'buyer', header: 'Buyer', accessorFn: (o) => o.buyer.name },
  { accessorKey: 'orderValue', header: 'Order value', cell: money },
  { accessorKey: 'materialCost', header: 'Yarn', cell: money },
  { accessorKey: 'labourCost', header: 'Labour', cell: money },
  { accessorKey: 'totalCost', header: 'Total cost', cell: money },
  {
    accessorKey: 'costPerUnit',
    header: 'Cost / m',
    cell: ({ row: { original: o } }) => (o.costPerUnit === null ? '—' : formatINR(o.costPerUnit)),
  },
  {
    accessorKey: 'margin',
    header: 'Margin',
    cell: ({ row: { original: o } }) => (
      <span className={o.margin < 0 ? 'text-rose-600' : 'text-emerald-700'}>
        {formatINR(o.margin)}
        {o.orderValue > 0 && <span className="ml-1 text-xs text-muted-foreground">{Math.round((o.margin / o.orderValue) * 100)}%</span>}
      </span>
    ),
  },
]

export function Dashboard() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const { data: p, loading, error } = useApi<Pnl>(`/reports/pnl?month=${month}`)
  const output = useApi<MachineOutput>(`/reports/machine-output?month=${month}`)
  const costs = useApi<OrderCost[]>('/reports/order-costs')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Month at a glance</h2>
        <Input type="month" className="w-40" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Invoiced" value={formatINR(p?.invoiced ?? 0)} hint={`Received ${formatINR(p?.paymentsReceived ?? 0)}`} loading={loading} />
        <KpiCard label="Raw material bills" value={formatINR(p?.materialBills ?? 0)} loading={loading} />
        <KpiCard label="Wages" value={formatINR(p?.wagesEarned ?? 0)} hint={`Paid out ${formatINR(p?.wagesPaid ?? 0)}`} loading={loading} />
        <KpiCard
          label="Cash flow"
          value={<span className={(p?.cashFlow ?? 0) < 0 ? 'text-rose-600' : undefined}>{formatINR(p?.cashFlow ?? 0)}</span>}
          hint="Received − bills − wages paid"
          loading={loading}
        />
        <KpiCard
          label="Profit"
          value={<span className={(p?.profit ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-600'}>{formatINR(p?.profit ?? 0)}</span>}
          hint="Invoiced − bills − wages"
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
            <BarChart data={output.data?.machines ?? []} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#f4f4f5" />
              <XAxis dataKey="code" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} />
              <Tooltip
                cursor={{ fill: '#f4f4f5' }}
                formatter={(v, _n, item) => [formatQty(Number(v), unitFor(item.payload.type)), 'Produced']}
              />
              <Bar dataKey="produced" radius={[4, 4, 0, 0]}>
                {output.data?.machines.map((m) => <Cell key={m.code} fill={STAGE_COLOR[m.type]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Cost per order (all time)</h2>
        <DataTable columns={orderCols} data={costs.data ?? []} loading={costs.loading} initialSorting={[{ id: 'margin', desc: true }]} />
      </section>
    </div>
  )
}

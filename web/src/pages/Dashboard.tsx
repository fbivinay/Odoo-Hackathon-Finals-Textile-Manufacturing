import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DataTable } from '@/components/DataTable'
import { PageHead } from '@/components/PageHead'
import { label } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Input } from '@/components/ui/input'
import { formatINR, formatQty, unitFor } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import type { MachineOutput, OrderCost, Pnl, Stage } from '@/types'

// Monochrome: colour is reserved for status, so stages are three inks.
const STAGE_COLOR: Record<Stage, string> = { SPINNING: '#a3a3ab', WEAVING: '#4a4a52', DYEING: '#0b0b0c' }

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
      <span className={o.margin < 0 ? 'text-problem' : 'text-good'}>
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
  // Costing for the orders placed in the chosen month.
  const monthEnd = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10)
  const costs = useApi<OrderCost[]>(`/reports/order-costs?from=${month}-01&to=${monthEnd}&limit=500`)

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Owner"
        title="Did the mill make money?"
        lede="Yarn bills, wages and buyer payments in one place, with what every machine produced and what each order really cost."
      />

      {/* The slab: the month's figures are what should stop you. */}
      <section className="slab space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Month at a glance</p>
            <h2 className="section-head mt-1">{new Date(`${month}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2>
          </div>
          <Input
            type="month"
            className="w-40 border-white/20 bg-white/10 text-white [color-scheme:dark]"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            aria-label="Month"
          />
        </div>
        {error && <p className="text-sm text-[#ff8f80]">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Invoiced" value={formatINR(p?.invoiced ?? 0)} hint={`Received ${formatINR(p?.paymentsReceived ?? 0)}`} loading={loading} />
        <KpiCard label="Raw material bills" value={formatINR(p?.materialBills ?? 0)} loading={loading} />
        <KpiCard label="Wages" value={formatINR(p?.wagesEarned ?? 0)} hint={`Paid out ${formatINR(p?.wagesPaid ?? 0)}`} loading={loading} />
        <KpiCard
          label="Cash flow"
          tone={(p?.cashFlow ?? 0) < 0 ? 'problem' : undefined}
          value={formatINR(p?.cashFlow ?? 0)}
          hint="Received − bills − wages paid"
          loading={loading}
        />
        <KpiCard
          label="Profit"
          tone={(p?.profit ?? 0) < 0 ? 'problem' : 'good'}
          value={formatINR(p?.profit ?? 0)}
          hint="Invoiced − bills − wages"
          loading={loading}
        />
      </div>
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-head">Machine output</h2>
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
              <CartesianGrid vertical={false} stroke="#e3e3e6" />
              <XAxis dataKey="code" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} />
              <Tooltip
                cursor={{ fill: 'rgba(11,11,12,0.05)' }}
                contentStyle={{ borderRadius: 12, border: '1px solid #e3e3e6', fontSize: 12 }}
                formatter={(v, _n, item) => [formatQty(Number(v), unitFor(item.payload.type)), 'Produced']}
              />
              <Bar dataKey="produced" radius={[6, 6, 0, 0]} animationDuration={900} animationEasing="ease-out">
                {output.data?.machines.map((m) => <Cell key={m.code} fill={STAGE_COLOR[m.type]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-head">Cost per order placed this month</h2>
        <DataTable columns={orderCols} data={costs.data ?? []} loading={costs.loading} initialSorting={[{ id: 'margin', desc: true }]} />
      </section>
    </div>
  )
}

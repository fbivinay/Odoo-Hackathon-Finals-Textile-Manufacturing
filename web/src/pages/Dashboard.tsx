import { useEffect, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DataTable } from '@/components/DataTable'
import { label } from '@/components/StatusPill'
import { selectClass } from '@/components/Field'
import { CountUp } from '@/components/CountUp'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatINR, formatMoney, formatQty, unitFor } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import type { MachineOutput, OrderCost, Pnl, Stage } from '@/types'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const THIS_MONTH = new Date().toISOString().slice(0, 7)
// The mill's records start in 2023 (Nov–Dec 2022 is warm-up stock and work in progress).
const YEARS = Array.from({ length: +THIS_MONTH.slice(0, 4) - 2022 }, (_, i) => String(+THIS_MONTH.slice(0, 4) - i))

function Figure({ label, value, note, tone, loading }: { label: string; value: string; note?: string; tone?: 'good' | 'watch' | 'problem'; loading?: boolean }) {
  return (
    <div className={cn('figure', tone && `figure--${tone}`)}>
      <p className="figure__label">{label}</p>
      {loading ? (
        <Skeleton className="mx-auto mt-2 h-9 w-32" />
      ) : (
        <p className="figure__value">
          <CountUp text={value} />
        </p>
      )}
      {note && !loading && <p className="figure__note">{note}</p>}
    </div>
  )
}

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
  const summary = useApi<{ receivables: number; orders: { delayed: number } }>('/dashboard/summary')

  // The chosen year, month by month: twelve small P&L calls (milliseconds each).
  const year = month.slice(0, 4)
  const [trend, setTrend] = useState<{ month: string; label: string; invoiced: number; profit: number }[]>([])
  useEffect(() => {
    let live = true
    const months = MONTHS.map((_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).filter((m) => m <= THIS_MONTH)
    Promise.all(months.map((m) => api<Pnl>(`/reports/pnl?month=${m}`)))
      .then((rows) => live && setTrend(rows.map((r, i) => ({ month: months[i], label: MONTHS[i].slice(0, 3), invoiced: r.invoiced, profit: r.profit }))))
      .catch(() => live && setTrend([]))
    return () => {
      live = false
    }
  }, [year])

  return (
    <div className="space-y-6">

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Month at a glance</p>
          <h2 className="section-head mt-1">{MONTHS[+month.slice(5, 7) - 1]} {month.slice(0, 4)}</h2>
        </div>
        <div className="flex gap-2">
          <select
            aria-label="Month"
            className={cn(selectClass, 'w-32 bg-surface')}
            value={month.slice(5, 7)}
            onChange={(e) => setMonth(`${month.slice(0, 4)}-${e.target.value}`)}
          >
            {MONTHS.map((name, i) => {
              const mm = String(i + 1).padStart(2, '0')
              return (
                <option key={mm} value={mm} disabled={`${month.slice(0, 4)}-${mm}` > THIS_MONTH}>
                  {name}
                </option>
              )
            })}
          </select>
          <select
            aria-label="Year"
            className={cn(selectClass, 'w-24 bg-surface')}
            value={month.slice(0, 4)}
            onChange={(e) => {
              const m = `${e.target.value}-${month.slice(5, 7)}`
              setMonth(m > THIS_MONTH ? THIS_MONTH : m)
            }}
          >
            {YEARS.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-sm text-problem">{error}</p>}

      {/* The figures panel: six numbers the owner reads first, each on its own raised card. */}
      <section className="figures-panel">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Figure label="Invoiced" value={formatMoney(p?.invoiced ?? 0)} note={`Received ${formatMoney(p?.paymentsReceived ?? 0)} from buyers`} loading={loading} />
          <Figure
            label="Profit"
            tone={(p?.profit ?? 0) < 0 ? 'problem' : 'good'}
            value={formatMoney(p?.profit ?? 0)}
            note={p?.invoiced ? `${Math.round((p.profit / p.invoiced) * 100)}% of invoiced, after yarn and wages` : 'Invoiced − yarn − wages'}
            loading={loading}
          />
          <Figure label="Yarn bought" value={formatMoney(p?.materialBills ?? 0)} note="Raw material bills this month" loading={loading} />
          <Figure label="Wages earned" value={formatMoney(p?.wagesEarned ?? 0)} note={`${formatMoney(p?.wagesPaid ?? 0)} paid out`} loading={loading} />
          <Figure
            label="Cash flow"
            tone={(p?.cashFlow ?? 0) < 0 ? 'watch' : undefined}
            value={formatMoney(p?.cashFlow ?? 0)}
            note="Received − bills − wages paid"
            loading={loading}
          />
          <Figure
            label="Owed by buyers"
            tone="watch"
            value={formatMoney(summary.data?.receivables ?? 0)}
            note={`${summary.data?.orders.delayed ?? 0} orders running late today`}
            loading={summary.loading}
          />
        </div>
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-head">{month.slice(0, 4)} month by month</h2>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-ink-3/50" />
              Invoiced (click a bar to open that month)
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-good" />
              Profit
            </span>
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trend} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#e3e3e6" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={64} tickFormatter={(v) => (Number(v) >= 1e7 ? `${(Number(v) / 1e7).toFixed(1)} Cr` : `${Math.round(Number(v) / 1e5)} L`)} />
              <Tooltip
                cursor={{ fill: 'rgba(11,11,12,0.05)' }}
                contentStyle={{ borderRadius: 12, border: '1px solid #e3e3e6', fontSize: 12 }}
                formatter={(v, n) => [formatMoney(Number(v)), n === 'invoiced' ? 'Invoiced' : 'Profit']}
              />
              <Bar dataKey="invoiced" radius={[6, 6, 0, 0]} animationDuration={900}>
                {trend.map((t) => (
                  <Cell key={t.month} fill={t.month === month ? '#4a4a52' : '#c9c9cf'} cursor="pointer" onClick={() => setMonth(t.month)} />
                ))}
              </Bar>
              <Line dataKey="profit" type="monotone" stroke="#16704a" strokeWidth={2} dot={{ r: 2.5 }} animationDuration={900} />
            </ComposedChart>
          </ResponsiveContainer>
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

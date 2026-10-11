import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Figure } from '@/components/Figure'
import { LiveBadge } from '@/components/LiveBadge'
import { label } from '@/components/StatusPill'
import { selectClass } from '@/components/Field'
import { useDataVersion } from '@/lib/changes'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatMoney, formatQty, unitFor } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import type { MachineOutput, Pnl, Stage } from '@/types'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const THIS_MONTH = new Date().toISOString().slice(0, 7)
// The mill's records start in 2023 (Nov–Dec 2022 is warm-up stock and work in progress).
const YEARS = Array.from({ length: +THIS_MONTH.slice(0, 4) - 2022 }, (_, i) => String(+THIS_MONTH.slice(0, 4) - i))

// Three shades of the brand purple; other colours are reserved for status.
const STAGE_COLOR: Record<Stage, string> = { SPINNING: '#c9b3c2', WEAVING: '#9a7790', DYEING: '#714b67' }

export function Dashboard() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  // The month's figures, today's output and the alerts refresh every 30 seconds.
  const { data: p, loading, error, updatedAt } = useApi<Pnl>(`/reports/pnl?month=${month}`, { refreshMs: 30000 })
  const output = useApi<MachineOutput>(`/reports/machine-output?month=${month}`, { refreshMs: 30000 })
  const summary = useApi<{ receivables: number; orders: { delayed: number } }>('/dashboard/summary', { refreshMs: 30000 })

  // The chosen year, month by month: twelve small P&L calls (milliseconds each).
  const year = month.slice(0, 4)
  const version = useDataVersion()
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
  }, [year, version])

  const monthName = MONTHS[+month.slice(5, 7) - 1]

  return (
    <div className="space-y-6">

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Month at a glance</p>
          <h2 className="section-head mt-1">{MONTHS[+month.slice(5, 7) - 1]} {month.slice(0, 4)}</h2>
          <div className="mt-1">
            <LiveBadge at={updatedAt} />
          </div>
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

      {/* The figures panel: money in, money out and what is left, for the chosen month. */}
      <section className="figures-panel">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Figure label="Invoiced" value={formatMoney(p?.invoiced ?? 0)} note={`Fabric billed to clients in ${monthName}, before GST`} loading={loading} />
          <Figure label="Collected" tone={p?.paymentsReceived ? 'good' : undefined} value={formatMoney(p?.paymentsReceived ?? 0)} note={`Payments received from clients in ${monthName}`} loading={loading} />
          <Figure
            label="Outstanding"
            tone={(summary.data?.receivables ?? 0) > 0.5 ? 'watch' : 'good'}
            value={formatMoney(summary.data?.receivables ?? 0)}
            note="Still owed by clients today, whatever the month"
            loading={summary.loading}
          />
          <Figure
            label="Total expenses"
            value={formatMoney(p?.expenses ?? 0)}
            note={`Materials used ${formatMoney(p?.materialsUsed ?? 0)} + wages ${formatMoney(p?.wagesEarned ?? 0)} + running costs ${formatMoney((p?.logistics ?? 0) + (p?.utilities ?? 0) + (p?.maintenance ?? 0))}`}
            loading={loading}
          />
          <Figure
            label="Profit"
            tone={(p?.profit ?? 0) < 0 ? 'problem' : (p?.profit ?? 0) > 0 ? 'good' : undefined}
            value={formatMoney(p?.profit ?? 0)}
            note={p?.invoiced ? `${Math.round((p.profit / p.invoiced) * 100)}% of invoiced, after total expenses` : 'Invoiced − total expenses'}
            loading={loading}
          />
          <Figure
            label="Cash flow"
            tone={(p?.cashFlow ?? 0) < 0 ? 'problem' : undefined}
            value={formatMoney(p?.cashFlow ?? 0)}
            note="Collected − supplier bills, expenses and wages paid"
            loading={loading}
          />
        </div>
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-head">{month.slice(0, 4)} month by month</h2>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-brand-soft" />
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
                  <Cell key={t.month} fill={t.month === month ? '#714b67' : '#c9b3c2'} cursor="pointer" onClick={() => setMonth(t.month)} />
                ))}
              </Bar>
              <Line dataKey="profit" type="monotone" stroke="#16704a" strokeWidth={2} dot={{ r: 2.5 }} animationDuration={900} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-head">Machine output vs most it could make</h2>
          <div className="flex gap-3 text-xs text-muted-foreground">
            {(Object.keys(STAGE_COLOR) as Stage[]).map((s) => (
              <span key={s} className="flex items-center gap-1">
                <span className="size-2 rounded-full" style={{ background: STAGE_COLOR[s] }} />
                {label(s)} ({unitFor(s)})
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-[#e3dde1]" />
              Max capacity
            </span>
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={output.data?.machines ?? []} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#e3e3e6" />
              <XAxis dataKey="code" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} />
              {/* Hover shows two numbers only: the most it could make this month so far, and what it made. */}
              <Tooltip
                cursor={{ fill: 'rgba(11,11,12,0.05)' }}
                contentStyle={{ borderRadius: 12, border: '1px solid #e3e3e6', fontSize: 12 }}
                itemStyle={{ color: '#2a2a2e' }}
                formatter={(v, name, item) => [formatQty(Number(v), unitFor(item.payload.type)), name]}
              />
              <Bar dataKey="capacity" name="Max capacity" fill="#e3dde1" radius={[6, 6, 0, 0]} animationDuration={900} animationEasing="ease-out" />
              <Bar dataKey="produced" name="Produced" radius={[6, 6, 0, 0]} animationDuration={900} animationEasing="ease-out">
                {output.data?.machines.map((m) => <Cell key={m.code} fill={STAGE_COLOR[m.type]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

    </div>
  )
}

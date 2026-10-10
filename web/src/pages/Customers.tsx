import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Clock, Crown, Percent, TriangleAlert } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { selectClass } from '@/components/Field'
import { PageHead } from '@/components/PageHead'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Skeleton } from '@/components/ui/skeleton'
import { summariseCustomers, type CustomerStats } from '@/lib/customers'
import { dayFromToday, formatDate, formatMoney } from '@/lib/format'
import { PERIODS, useCustomerData } from '@/lib/useCustomers'

const RANK_BY: { key: string; label: string; value: (r: CustomerStats) => number | null; asc?: boolean }[] = [
  { key: 'score', label: 'Overall score', value: (r) => r.score },
  { key: 'invoiced', label: 'Revenue', value: (r) => r.invoiced },
  { key: 'orders', label: 'Most orders', value: (r) => r.orders },
  { key: 'metres', label: 'Most metres', value: (r) => r.metres },
  { key: 'pay', label: 'Fastest payment', value: (r) => r.daysToPay, asc: true },
  { key: 'margin', label: 'Best margin', value: (r) => r.marginPct },
  { key: 'outstanding', label: 'Most outstanding', value: (r) => r.outstanding },
]

const pct = (v: number | null, digits = 0) => (v === null ? '—' : `${v.toFixed(digits)}%`)

export function Customers() {
  const navigate = useNavigate()
  const { data, error } = useCustomerData()
  const [period, setPeriod] = useState<string>('365')
  const [rankBy, setRankBy] = useState('score')
  const p = PERIODS.find((x) => x.key === period)!
  const from = p.days ? dayFromToday(-p.days) : null

  const stats = useMemo(() => (data ? summariseCustomers(data, { from, today: dayFromToday(0) }) : null), [data, from])
  const ranked = useMemo(() => {
    if (!stats) return []
    const r = RANK_BY.find((x) => x.key === rankBy)!
    // Buyers without a figure go last whichever way the list runs.
    return [...stats].sort((a, b) => {
      const va = r.value(a)
      const vb = r.value(b)
      if (va === null || vb === null) return va === null ? (vb === null ? 0 : 1) : -1
      return r.asc ? va - vb : vb - va
    })
  }, [stats, rankBy])

  const active = stats?.filter((s) => s.orders > 0) ?? []
  const invoiced = active.reduce((t, s) => t + s.invoiced, 0)
  const outstanding = stats?.reduce((t, s) => t + s.outstanding, 0) ?? 0
  const overdue = stats?.reduce((t, s) => t + s.overdue, 0) ?? 0
  const top = [...active].sort((a, b) => b.invoiced - a.invoiced)[0]
  const best = (get: (s: CustomerStats) => number | null, asc = false) =>
    active.filter((s) => get(s) !== null).sort((a, b) => (asc ? get(a)! - get(b)! : get(b)! - get(a)!))[0]
  const fastest = best((s) => s.daysToPay, true)
  const slowest = best((s) => s.daysToPay)
  const margin = best((s) => s.marginPct)
  const owing = best((s) => s.overdue || null)

  const columns: ColumnDef<CustomerStats>[] = [
    { id: 'name', header: 'Client', accessorFn: (s) => s.buyer.name, cell: ({ row: { original: s } }) => <span className="font-medium">{s.buyer.name}</span> },
    { id: 'orders', header: 'Total orders', accessorFn: (s) => s.orders },
    { id: 'invoiced', header: 'Revenue', accessorFn: (s) => s.invoiced, cell: ({ row: { original: s } }) => formatMoney(s.invoiced) },
    {
      id: 'outstanding',
      header: 'Outstanding',
      accessorFn: (s) => s.outstanding,
      cell: ({ row: { original: s } }) => <span className={s.overdue > 0 ? 'text-problem' : undefined}>{s.outstanding > 0 ? formatMoney(s.outstanding) : '—'}</span>,
    },
    { id: 'last', header: 'Last order', accessorFn: (s) => s.lastOrder ?? '', cell: ({ row: { original: s } }) => (s.lastOrder ? formatDate(s.lastOrder) : '—') },
  ]

  const loading = !stats && !error

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Sales"
        title="Clients"
        actions={
          <div className="flex gap-2">
            <select aria-label="Rank by" className={`${selectClass} max-w-52 bg-surface`} value={rankBy} onChange={(e) => setRankBy(e.target.value)}>
              {RANK_BY.map((r) => (
                <option key={r.key} value={r.key}>
                  Rank: {r.label}
                </option>
              ))}
            </select>
            <select aria-label="Period" className={`${selectClass} max-w-44 bg-surface`} value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
          </div>
        }
      />
      {error && <p className="text-sm text-problem">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Active clients" value={String(active.length)} hint={stats ? `of ${stats.length} on the books` : undefined} loading={loading} />
        <KpiCard label="Revenue" value={formatMoney(invoiced)} hint={`Invoiced, ${p.label.toLowerCase()}`} loading={loading} />
        <KpiCard label="Outstanding today" tone={overdue > 0 ? 'problem' : undefined} value={formatMoney(outstanding)} hint={overdue > 0 ? `${formatMoney(overdue)} over 60 days` : 'Nothing overdue'} loading={loading} />
        <KpiCard label="Top client" value={top ? pct(top.share * 100) : '—'} hint={top ? `of revenue from ${top.buyer.name}` : undefined} loading={loading} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <Highlight icon={Crown} label="Biggest client" s={top} value={top && formatMoney(top.invoiced)} onOpen={(id) => navigate(`/clients/${id}`)} />
            <Highlight icon={Clock} label="Fastest payer" s={fastest} value={fastest && `${fastest.daysToPay} days to pay`} onOpen={(id) => navigate(`/clients/${id}`)} />
            <Highlight icon={Percent} label="Best margin" s={margin} value={margin && pct(margin.marginPct, 1)} onOpen={(id) => navigate(`/clients/${id}`)} />
            {owing ? (
              <Highlight icon={TriangleAlert} tone="problem" label="Most overdue" s={owing} value={formatMoney(owing.overdue)} onOpen={(id) => navigate(`/clients/${id}`)} />
            ) : (
              <Highlight icon={TriangleAlert} tone="problem" label="Slowest payer" s={slowest} value={slowest && `${slowest.daysToPay} days to pay`} onOpen={(id) => navigate(`/clients/${id}`)} />
            )}
          </>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="section-head">Ranking</h2>
        <DataTable key={rankBy} columns={columns} data={ranked} loading={loading} onRowClick={(s) => navigate(`/clients/${s.buyer.id}`)} />
      </section>
    </div>
  )
}

export function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ground">
        <div className="h-full rounded-full bg-brand" style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs tabular-nums">{score}</span>
    </div>
  )
}

function Highlight({ icon: Icon, label, s, value, tone, onOpen }: { icon: typeof Crown; label: string; s?: CustomerStats; value?: string | null; tone?: 'problem'; onOpen: (id: string) => void }) {
  return (
    <button type="button" disabled={!s} onClick={() => s && onOpen(s.buyer.id)} className="card flex items-start gap-3 text-left transition hover:border-brand/40 disabled:opacity-60">
      <span className={`rounded-lg p-2 ${tone === 'problem' ? 'bg-problem-bg text-problem' : 'bg-brand-tint text-brand'}`}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-ink-2">{label}</span>
        <span className="block truncate font-semibold">{s?.buyer.name ?? '—'}</span>
        <span className={`block text-sm tabular-nums ${tone === 'problem' ? 'text-problem' : 'text-ink-2'}`}>{value ?? ''}</span>
      </span>
    </button>
  )
}

import { lazy, Suspense } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { selectClass } from '@/components/Field'
import { Figure } from '@/components/Figure'
import { PageHead } from '@/components/PageHead'
import { Pill } from '@/components/StatusPill'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { periodPresets, todayIst, type Overview as OverviewData } from '@/lib/accounts'
import { formatDate, formatINR, formatMoney } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

const Invoices = lazy(() => import('@/pages/accounts/Registers').then((m) => ({ default: m.Invoices })))
const Bills = lazy(() => import('@/pages/accounts/Registers').then((m) => ({ default: m.Bills })))
const Expenses = lazy(() => import('@/pages/accounts/Registers').then((m) => ({ default: m.Expenses })))
const Payroll = lazy(() => import('@/pages/accounts/Payroll').then((m) => ({ default: m.Payroll })))
const Gst = lazy(() => import('@/pages/accounts/Gst').then((m) => ({ default: m.Gst })))
const Reports = lazy(() => import('@/pages/accounts/Reports').then((m) => ({ default: m.Reports })))

const TABS = [
  ['overview', 'Overview'],
  ['invoices', 'Sales invoices'],
  ['bills', 'Supplier bills'],
  ['expenses', 'Expenses'],
  ['payroll', 'Payroll'],
  ['gst', 'GST'],
  ['reports', 'Reports'],
] as const

export type PeriodProps = { from: string; to: string }

// The period every tab works on, kept in the URL so a document's Back returns to the same view.
export function usePeriod() {
  const [params, setParams] = useSearchParams()
  const presets = periodPresets()
  const from = params.get('from') ?? presets[0].from
  const to = params.get('to') ?? presets[0].to
  const set = (next: Record<string, string>) => setParams((p) => {
    const out = new URLSearchParams(p)
    for (const [k, v] of Object.entries(next)) if (v) out.set(k, v); else out.delete(k)
    return out
  }, { replace: true })
  return { from, to, params, set, presets }
}

function PeriodBar() {
  const { from, to, set, presets } = usePeriod()
  const preset = presets.find((p) => p.from === from && p.to === to)?.key ?? 'custom'
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <select
        aria-label="Period"
        className={cn(selectClass, 'w-52 bg-surface')}
        value={preset}
        onChange={(e) => {
          const p = presets.find((x) => x.key === e.target.value)
          if (p) set({ from: p.from, to: p.to })
        }}
      >
        {presets.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        <option value="custom" disabled>
          Custom range
        </option>
      </select>
      <Input aria-label="From" type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
      <span className="text-sm text-muted-foreground">to</span>
      <Input aria-label="To" type="date" className="h-9 w-40" value={to} min={from} max={todayIst()} onChange={(e) => e.target.value && set({ to: e.target.value })} />
    </div>
  )
}

// Accounts: a working finance area, not a dashboard. Every figure comes from the recorded
// invoices, bills, expenses and payroll; each tab lists the transactions behind it.
export function Accounts() {
  const { from, to, params, set } = usePeriod()
  const tab = params.get('tab') ?? 'overview'
  return (
    <div className="space-y-5">
      <PageHead eyebrow="Owner only" title="Accounts" actions={<PeriodBar />} />
      <p className="-mt-3 text-xs text-muted-foreground">
        Synthetic demo data. Amounts before tax unless marked; GST is shown separately. Period {formatDate(from)} to {formatDate(to)}.
      </p>
      <Tabs value={tab} onValueChange={(v) => set({ tab: v === 'overview' ? '' : v, page: '' })}>
        <TabsList className="flex-wrap">
          {TABS.map(([k, label]) => (
            <TabsTrigger key={k} value={k}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <Suspense fallback={<Skeleton className="mt-4 h-96 w-full" />}>
          <TabsContent value="overview">{tab === 'overview' && <Overview from={from} to={to} />}</TabsContent>
          <TabsContent value="invoices">{tab === 'invoices' && <Invoices from={from} to={to} />}</TabsContent>
          <TabsContent value="bills">{tab === 'bills' && <Bills from={from} to={to} />}</TabsContent>
          <TabsContent value="expenses">{tab === 'expenses' && <Expenses from={from} to={to} />}</TabsContent>
          <TabsContent value="payroll">{tab === 'payroll' && <Payroll from={from} to={to} />}</TabsContent>
          <TabsContent value="gst">{tab === 'gst' && <Gst from={from} to={to} />}</TabsContent>
          <TabsContent value="reports">{tab === 'reports' && <Reports from={from} to={to} />}</TabsContent>
        </Suspense>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------- overview --

function Overview({ from, to }: PeriodProps) {
  const { data: o, loading, error } = useApi<OverviewData>(`/accounts/overview?from=${from}&to=${to}`)
  const { set } = usePeriod()
  if (error) return <p className="mt-4 text-sm text-problem">{error}</p>
  const p = o?.pnl
  const pct = (v?: number) => (p?.revenue ? ` · ${((100 * (v ?? 0)) / p.revenue).toFixed(1)}% of revenue` : '')
  return (
    <div className="mt-4 space-y-6">
      <section className="figures-panel">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Revenue" value={formatMoney(p?.revenue ?? 0)} note="Invoiced in the period, before GST" loading={loading} />
          <Figure label="Expenses" value={formatMoney(p?.expenses ?? 0)} note="Materials used, wages, logistics, utilities, maintenance" loading={loading} />
          <Figure label="Gross profit" tone={(p?.grossProfit ?? 0) < 0 ? 'problem' : 'good'} value={formatMoney(p?.grossProfit ?? 0)} note={`After materials and wages${pct(p?.grossProfit)}`} loading={loading} />
          <Figure label="Net profit" tone={(p?.netProfit ?? 0) < 0 ? 'problem' : 'good'} value={formatMoney(p?.netProfit ?? 0)} note={`After logistics, utilities, maintenance${pct(p?.netProfit)}`} loading={loading} />
          <Figure label="Receivable today" tone={o?.receivable.overdue ? 'watch' : undefined} value={formatMoney(o?.receivable.total ?? 0)} note={`${o?.receivable.count ?? 0} open invoices · ${formatMoney(o?.receivable.overdue ?? 0)} overdue`} loading={loading} onClick={() => set({ tab: 'invoices', status: 'OVERDUE' })} />
          <Figure label="Payable today" tone={o?.payable.billsOverdue ? 'watch' : undefined} value={formatMoney((o?.payable.bills ?? 0) + (o?.payable.expenses ?? 0))} note={`Bills ${formatMoney(o?.payable.bills ?? 0)} (${formatMoney(o?.payable.billsOverdue ?? 0)} overdue) · expenses ${formatMoney(o?.payable.expenses ?? 0)}`} loading={loading} onClick={() => set({ tab: 'bills', status: 'OVERDUE' })} />
          <Figure label="GST payable" value={formatMoney(o?.gst.payable ?? 0)} note={`Output ${formatMoney(o?.gst.output ?? 0)} + RCM ${formatMoney(o?.gst.rcm ?? 0)} − input ${formatMoney(o?.gst.input ?? 0)}`} loading={loading} onClick={() => set({ tab: 'gst' })} />
          <Figure label="Net cash movement" tone={(o?.cash.net ?? 0) < 0 ? 'watch' : undefined} value={formatMoney(o?.cash.net ?? 0)} note={`Received ${formatMoney(o?.cash.in ?? 0)} − paid ${formatMoney(o?.cash.out ?? 0)} (recorded payments only, no bank ledger)`} loading={loading} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <section className="data-table-wrap space-y-3 p-4">
          <h2 className="section-head">Month by month</h2>
          {!o ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={o.series} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid vertical={false} stroke="#eee" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatMoney(v)} width={70} />
                  <Tooltip formatter={(v) => formatINR(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="revenue" name="Revenue" fill="#c9b3c2" />
                  <Line dataKey="netProfit" name="Net profit" stroke="#714b67" strokeWidth={2} dot={false} />
                  <Line dataKey="cashIn" name="Cash received" stroke="#1f7a4d" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
        <section className="data-table-wrap space-y-2 p-4">
          <h2 className="section-head">Where the money went</h2>
          {p &&
            [
              ['Materials used', p.materials],
              ['Wages', p.wages],
              ['Utilities', p.utilities],
              ['Logistics', p.logistics],
              ['Maintenance stores', p.maintenance],
            ].map(([label, v]) => (
              <div key={label as string} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{label}</span>
                  <span className="tabular-nums">{formatMoney(v as number)}</span>
                </div>
                <div className="h-1.5 rounded bg-zinc-100">
                  <div className="h-1.5 rounded bg-brand" style={{ width: `${p.expenses ? (100 * (v as number)) / p.expenses : 0}%` }} />
                </div>
              </div>
            ))}
          <p className="pt-2 text-xs text-muted-foreground">
            Materials are charged as orders are billed. Purchases in the period: {formatMoney(o?.purchases ?? 0)}. Materials on orders not billed yet (work in progress, today): {formatMoney(o?.workInProgress ?? 0)}.
          </p>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <OpenList title="Oldest unpaid invoices" rows={o?.topReceivables} kind="invoices" />
        <OpenList title="Supplier bills due" rows={o?.billsDue} kind="bills" />
      </div>
    </div>
  )
}

function OpenList({ title, rows, kind }: { title: string; rows?: OverviewData['topReceivables']; kind: 'invoices' | 'bills' }) {
  return (
    <section className="data-table-wrap space-y-2 p-4">
      <h2 className="section-head">{title}</h2>
      {!rows ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing open.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border first:border-0">
                <td className="py-1.5">
                  <Link to={`/accounts/${kind}/${r.id}`} className="font-medium hover:text-brand">
                    {r.invoiceNo ?? r.billNo}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">{r.buyer ?? `${r.supplier} · ${r.material}`}</span>
                </td>
                <td className="py-1.5 text-right">
                  {r.daysOverdue > 0 ? <Pill tone="problem">{r.daysOverdue} days late</Pill> : <span className="text-xs text-muted-foreground">due {r.dueDate ? formatDate(r.dueDate) : '—'}</span>}
                </td>
                <td className="py-1.5 text-right tabular-nums">{formatINR(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

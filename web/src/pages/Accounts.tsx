import { lazy, Suspense, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight, Search } from 'lucide-react'
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

const TABS = [
  ['overview', 'Overview'],
  ['invoices', 'Sales invoices'],
  ['bills', 'Supplier bills'],
  ['expenses', 'Expenses'],
  ['payroll', 'Payroll'],
  ['gst', 'GST'],
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
  const [custom, setCustom] = useState(false)
  const fromRef = useRef<HTMLInputElement>(null)
  const preset = custom ? 'custom' : (presets.find((p) => p.from === from && p.to === to)?.key ?? 'custom')
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <select
        aria-label="Period"
        className={cn(selectClass, 'w-52 bg-surface')}
        value={preset}
        onChange={(e) => {
          const p = presets.find((x) => x.key === e.target.value)
          setCustom(!p)
          if (p) set({ from: p.from, to: p.to })
          // Custom: keep the dates as they are and open the From picker.
          else fromRef.current?.showPicker?.()
        }}
      >
        {presets.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom range</option>
      </select>
      <Input ref={fromRef} aria-label="From" type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => e.target.value && (setCustom(true), set({ from: e.target.value }))} />
      <span className="text-sm text-muted-foreground">to</span>
      <Input aria-label="To" type="date" className="h-9 w-40" value={to} min={from} max={todayIst()} onChange={(e) => e.target.value && (setCustom(true), set({ to: e.target.value }))} />
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
      <PageHead eyebrow="Books" title="Accounts" actions={<PeriodBar />} />
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
        </Suspense>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------- overview --

function Overview({ from, to }: PeriodProps) {
  const { data: o, loading, error } = useApi<OverviewData>(`/accounts/overview?from=${from}&to=${to}`)
  const { set } = usePeriod()
  const breakdown = useRef<HTMLElement>(null)
  if (error) return <p className="mt-4 text-sm text-problem">{error}</p>
  const p = o?.pnl
  const pct = (v?: number) => (p?.revenue ? ` · ${((100 * (v ?? 0)) / p.revenue).toFixed(1)}% of revenue` : '')
  const other = p ? p.logistics + p.utilities + p.maintenance : 0
  // Each cost line opens the records behind it.
  const costs: [string, number, () => void][] = p
    ? [
        ['Materials used', p.materials, () => set({ tab: 'bills', category: '' })],
        ['Wages', p.wages, () => set({ tab: 'payroll' })],
        ['Utilities', p.utilities, () => set({ tab: 'expenses', category: 'UTILITIES' })],
        ['Logistics', p.logistics, () => set({ tab: 'expenses', category: 'LOGISTICS' })],
        ['Maintenance stores', p.maintenance, () => set({ tab: 'bills', category: 'MAINTENANCE' })],
      ]
    : []
  return (
    <div className="mt-4 space-y-6">
      <section className="figures-panel">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Figure label="Revenue" value={formatMoney(p?.revenue ?? 0)} note="Invoiced in the period, before GST" loading={loading} onClick={() => set({ tab: 'invoices', status: '' })} />
          <Figure
            label="Expenses"
            value={formatMoney(p?.expenses ?? 0)}
            note={`Materials ${formatMoney(p?.materials ?? 0)} · wages ${formatMoney(p?.wages ?? 0)} · other ${formatMoney(other)}`}
            loading={loading}
            onClick={() => breakdown.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          />
          <Figure label="Gross profit" tone={(p?.grossProfit ?? 0) < 0 ? 'problem' : 'good'} value={formatMoney(p?.grossProfit ?? 0)} note={`Revenue − materials − wages${pct(p?.grossProfit)}`} loading={loading} />
          <Figure label="Net profit" tone={(p?.netProfit ?? 0) < 0 ? 'problem' : 'good'} value={formatMoney(p?.netProfit ?? 0)} note={`Revenue − all expenses${pct(p?.netProfit)}`} loading={loading} />
          <Figure
            label="Total receivable"
            tone={o?.receivable.overdue ? 'watch' : undefined}
            value={formatMoney(o?.receivable.total ?? 0)}
            note={`Buyers owe us today · ${o?.receivable.count ?? 0} invoices, ${formatMoney(o?.receivable.overdue ?? 0)} overdue`}
            loading={loading}
            onClick={() => set({ tab: 'invoices', status: '' })}
          />
          <Figure
            label="Total payable"
            tone={o?.payable.billsOverdue ? 'watch' : undefined}
            value={formatMoney((o?.payable.bills ?? 0) + (o?.payable.expenses ?? 0))}
            note={`We owe today · supplier bills ${formatMoney(o?.payable.bills ?? 0)} + unpaid expenses ${formatMoney(o?.payable.expenses ?? 0)}`}
            loading={loading}
            onClick={() => set({ tab: 'bills', status: 'OPEN' })}
          />
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
        <section ref={breakdown} className="data-table-wrap scroll-mt-4 space-y-1 p-4">
          <h2 className="section-head">Where the money went</h2>
          <p className="text-xs text-muted-foreground">Click a line to see its records.</p>
          {costs.map(([label, v, open]) => (
            <button key={label} type="button" onClick={open} className="group block w-full space-y-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-50">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>{label}</span>
                <span className="flex items-center gap-1 tabular-nums">
                  {formatMoney(v)}
                  <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
              <div className="h-1.5 rounded bg-zinc-100">
                <div className="h-1.5 rounded bg-brand" style={{ width: `${p?.expenses ? (100 * v) / p.expenses : 0}%` }} />
              </div>
            </button>
          ))}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <OpenList title="Oldest unpaid invoices" rows={o?.topReceivables} kind="invoices" />
        <OpenList title="Supplier bills due" rows={o?.billsDue} kind="bills" />
      </div>
    </div>
  )
}

const DUE = { all: 'All open', late: 'Overdue', soon: 'Due in 15 days', later: 'Due later' } as const

function OpenList({ title, rows, kind }: { title: string; rows?: OverviewData['topReceivables']; kind: 'invoices' | 'bills' }) {
  const [q, setQ] = useState('')
  const [due, setDue] = useState<keyof typeof DUE>('all')
  const today = todayIst()
  const soon = new Date(Date.parse(today) + 15 * 86400000).toISOString().slice(0, 10)
  const words = q.trim().toLowerCase()
  const shown = (rows ?? []).filter((r) => {
    const date = r.dueDate?.slice(0, 10) ?? ''
    const when = r.daysOverdue > 0 ? 'late' : date && date <= soon ? 'soon' : 'later'
    return (due === 'all' || due === when) && (!words || [r.invoiceNo, r.billNo, r.buyer, r.supplier, r.material, r.orderNo].some((v) => v?.toLowerCase().includes(words)))
  })
  return (
    <section className="data-table-wrap space-y-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="section-head">{title}</h2>
        {rows && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {shown.length} · {formatINR(shown.reduce((t, r) => t + r.balance, 0))}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label={`Search ${title.toLowerCase()}`} placeholder={kind === 'invoices' ? 'Invoice, buyer or order' : 'Bill, supplier or material'} className="h-9 pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select aria-label="When due" className={cn(selectClass, 'h-9 w-40')} value={due} onChange={(e) => setDue(e.target.value as keyof typeof DUE)}>
          {Object.entries(DUE).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {!rows ? (
        <Skeleton className="h-40 w-full" />
      ) : shown.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{rows.length ? 'Nothing matches these filters.' : 'Nothing open.'}</p>
      ) : (
        <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-border first:border-0">
                <td className="py-1.5">
                  <Link to={`/accounts/${kind}/${r.id}`} className="font-medium hover:text-brand">
                    {r.invoiceNo ?? r.billNo}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">{r.buyer ?? `${r.supplier} · ${r.material}`}</span>
                </td>
                <td className="py-1.5 text-right">
                  {r.daysOverdue > 0 ? <Pill tone="problem">{r.daysOverdue} day{r.daysOverdue === 1 ? '' : 's'} late</Pill> : <span className="text-xs text-muted-foreground">due {r.dueDate ? formatDate(r.dueDate) : '—'}</span>}
                </td>
                <td className="py-1.5 text-right tabular-nums">{formatINR(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  )
}

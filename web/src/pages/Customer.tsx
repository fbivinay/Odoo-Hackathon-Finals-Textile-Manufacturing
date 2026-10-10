import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowLeft, Mail, Phone, Search, Users } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { selectClass } from '@/components/Field'
import { PageHead } from '@/components/PageHead'
import { Pill, StatusPill } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { monthly, summariseCustomers, type CInvoice, type COrder } from '@/lib/customers'
import { dayFromToday, formatDate, formatINR, formatMoney, formatQty } from '@/lib/format'
import { GRADE_TONE, PERIODS, useCustomerData } from '@/lib/useCustomers'
import { ScoreBar } from '@/pages/Customers'

const DAY = 86400000
const PAY_BANDS = [
  { label: 'Within 15 days', max: 15 },
  { label: '16 to 30 days', max: 30 },
  { label: '31 to 60 days', max: 60 },
  { label: 'Over 60 days', max: Infinity },
]
// Paid: invoice date to final payment. Unpaid: days since the invoice.
function invoiceDays(i: CInvoice, today: string) {
  const paid = i.balance <= 0.5 && i.payments.length > 0
  const end = paid ? i.payments.reduce((m, x) => (x.paidAt > m ? x.paidAt : m), i.payments[0].paidAt) : today
  return { paid, days: Math.max(0, Math.floor((Date.parse(end) - Date.parse(i.issuedAt)) / DAY)) }
}
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })

export function Customer() {
  const { id = '' } = useParams()
  const { data, error } = useCustomerData()
  const [period, setPeriod] = useState<string>('365')
  const [allOrders, setAllOrders] = useState(false)
  const [allInvoices, setAllInvoices] = useState(false)
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const p = PERIODS.find((x) => x.key === period)!
  const from = p.days ? dayFromToday(-p.days) : null
  const today = dayFromToday(0)
  const inPeriod = (iso: string) => !from || iso.slice(0, 10) >= from

  const stats = useMemo(() => (data ? summariseCustomers(data, { from, today }) : null), [data, from, today])
  const rank = stats ? stats.findIndex((s) => s.buyer.id === id) : -1
  const s = stats?.[rank]

  const invoices = useMemo(() => data?.invoices.filter((i) => i.dispatch.buyer.id === id) ?? [], [data, id])
  const orders = useMemo(() => (data?.orders.filter((o) => o.buyerId === id && inPeriod(o.createdAt)) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [data, id, from]) // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => monthly(invoices, from).map((m) => ({ ...m, label: monthLabel(m.month) })), [invoices, from])
  const history = invoices
    .filter((i) => i.balance > 0.5 || inPeriod(i.issuedAt))
    .sort((a, b) => Number(b.balance > 0.5) - Number(a.balance > 0.5) || b.issuedAt.localeCompare(a.issuedAt))
  const found = (...nos: string[]) => !needle || nos.some((n) => n.toLowerCase().includes(needle))
  const shownInvoices = history.filter((i) => found(i.invoiceNo, i.dispatch.order.orderNo))
  const shownOrders = orders.filter((o) => found(o.orderNo))

  const fabrics = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of orders) if (o.status !== 'CANCELLED') m.set(o.fabricType, (m.get(o.fabricType) ?? 0) + o.qty)
    const total = [...m.values()].reduce((t, v) => t + v, 0)
    return [...m].sort((a, b) => b[1] - a[1]).map(([fabric, qty]) => ({ fabric, qty, share: total ? qty / total : 0 }))
  }, [orders])

  const bands = useMemo(() => {
    const all = invoices.filter((i) => inPeriod(i.issuedAt)).map((i) => invoiceDays(i, today))
    const counted = all.filter((x) => x.paid || x.days > 60).map((x) => x.days)
    const rows = PAY_BANDS.map((b, k) => ({ label: b.label, n: counted.filter((d) => d <= b.max && (k === 0 || d > PAY_BANDS[k - 1].max)).length }))
    rows.push({ label: 'Not paid yet, under 60 days', n: all.length - counted.length })
    return rows.map((b) => ({ ...b, share: all.length ? b.n / all.length : 0 }))
  }, [invoices, from]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="text-sm text-problem">{error}</p>
  if (!stats) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16" />
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (!s) {
    return (
      <div className="card">
        <EmptyState icon={Users} line="This client was not found." />
        <div className="pb-6 text-center">
          <Link to="/clients" className="text-sm font-medium text-brand hover:underline">
            Back to clients
          </Link>
        </div>
      </div>
    )
  }

  const invoiceCols: ColumnDef<CInvoice>[] = [
    { id: 'no', header: 'Invoice', accessorFn: (i) => i.invoiceNo },
    { id: 'order', header: 'Order', accessorFn: (i) => i.dispatch.order.orderNo },
    { id: 'issued', header: 'Issued', accessorFn: (i) => i.issuedAt, cell: ({ row: { original: i } }) => formatDate(i.issuedAt) },
    { id: 'amount', header: 'Amount', accessorFn: (i) => i.amount, cell: ({ row: { original: i } }) => formatINR(i.amount) },
    { id: 'status', header: 'Status', accessorFn: (i) => i.status, cell: ({ row: { original: i } }) => <StatusPill status={i.status} /> },
    { id: 'balance', header: 'Still owed', accessorFn: (i) => i.balance, cell: ({ row: { original: i } }) => (i.balance > 0.5 ? formatINR(i.balance) : '—') },
    {
      id: 'days',
      header: 'Days',
      accessorFn: (i) => invoiceDays(i, today).days,
      cell: ({ row: { original: i } }) => {
        const { days, paid } = invoiceDays(i, today)
        return paid ? (
          <span className="text-ink-2">Paid in {days} days</span>
        ) : (
          <Pill tone={days > 60 ? 'problem' : days > 30 ? 'watch' : 'neutral'}>{days} days unpaid</Pill>
        )
      },
    },
  ]
  const orderCols: ColumnDef<COrder>[] = [
    { id: 'no', header: 'Order', accessorFn: (o) => o.orderNo },
    { id: 'placed', header: 'Placed', accessorFn: (o) => o.createdAt, cell: ({ row: { original: o } }) => formatDate(o.createdAt) },
    { id: 'fabric', header: 'Fabric', accessorFn: (o) => o.fabricType },
    { id: 'qty', header: 'Quantity', accessorFn: (o) => o.qty, cell: ({ row: { original: o } }) => formatQty(o.qty) },
    { id: 'price', header: 'Price', accessorFn: (o) => o.pricePerUnit, cell: ({ row: { original: o } }) => `${formatINR(o.pricePerUnit)}/m` },
    { id: 'value', header: 'Value', accessorFn: (o) => o.qty * o.pricePerUnit, cell: ({ row: { original: o } }) => formatMoney(o.qty * o.pricePerUnit) },
    { id: 'deadline', header: 'Due', accessorFn: (o) => o.deadline, cell: ({ row: { original: o } }) => formatDate(o.deadline) },
    { id: 'status', header: 'Status', accessorFn: (o) => o.status, cell: ({ row: { original: o } }) => <StatusPill status={o.status} /> },
  ]

  return (
    <div className="space-y-6">
      <Link to="/clients" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        <ArrowLeft className="size-3" />
        Clients
      </Link>
      <PageHead
        eyebrow={s.firstOrder ? `Client since ${new Date(s.firstOrder).getFullYear()}` : 'Client'}
        title={s.buyer.name}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone={GRADE_TONE[s.grade]}>Grade {s.grade}</Pill>
            <span className="text-sm text-ink-2">
              #{rank + 1} of {stats.length}
            </span>
            <ScoreBar score={s.score} />
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
      <div className="-mt-3 flex flex-wrap gap-4 text-sm text-ink-2">
        {s.buyer.phone && (
          <a href={`tel:${s.buyer.phone}`} className="inline-flex items-center gap-1.5 hover:text-brand">
            <Phone className="size-3.5" />
            {s.buyer.phone}
          </a>
        )}
        {s.buyer.email && (
          <a href={`mailto:${s.buyer.email}`} className="inline-flex items-center gap-1.5 hover:text-brand">
            <Mail className="size-3.5" />
            {s.buyer.email}
          </a>
        )}
        <span>{s.openOrders} open orders</span>
        {s.lastOrder && <span>Last order {formatDate(s.lastOrder)}</span>}
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Revenue" value={formatMoney(s.invoiced)} hint={`${(s.share * 100).toFixed(1)}% of all sales`} />
        <KpiCard label="Orders" value={String(s.orders)} hint={`${formatQty(s.metres)}${s.cancelled ? `, ${s.cancelled} cancelled` : ''}`} />
        <KpiCard label="Average order" value={s.avgOrderValue ? formatMoney(s.avgOrderValue) : '—'} />
        <KpiCard label="Margin" value={s.marginPct === null ? '—' : `${s.marginPct}%`} hint="On delivered orders" />
        <KpiCard
          label="Days to pay"
          tone={s.daysToPay !== null && s.daysToPay > 60 ? 'problem' : s.daysToPay !== null && s.daysToPay <= 30 ? 'good' : undefined}
          value={s.daysToPay === null ? '—' : String(s.daysToPay)}
          hint={s.paidWithin30 === null ? 'No paid invoices' : `Median; ${Math.round(s.paidWithin30 * 100)}% paid within 30`}
        />
        <KpiCard label="Outstanding" tone={s.overdue > 0 ? 'problem' : undefined} value={formatMoney(s.outstanding)} hint={s.overdue > 0 ? `${formatMoney(s.overdue)} over 60 days` : 'Nothing overdue'} />
      </div>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="section-head">Invoiced and collected by month</h2>
          <span className="text-xs text-ink-3">Delivered on time: {s.onTimePct === null ? '—' : `${s.onTimePct}%`} of their orders</span>
        </div>
        {series.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices in this period.</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="#e3e3e6" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={64} tickFormatter={(v) => formatMoney(Number(v))} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e3e3e6', fontSize: 12 }} formatter={(v, n) => [formatMoney(Number(v)), n === 'invoiced' ? 'Invoiced' : 'Collected']} />
                <Legend formatter={(n) => (n === 'invoiced' ? 'Invoiced' : 'Collected')} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="invoiced" fill="#714b67" radius={[3, 3, 0, 0]} />
                <Bar dataKey="collected" fill="#c9b3c3" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="section-head">What they buy</h2>
          {fabrics.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders in this period.</p>
          ) : (
            <ul className="space-y-2">
              {fabrics.slice(0, 6).map((f) => (
                <li key={f.fabric} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{f.fabric}</span>
                    <span className="tabular-nums text-ink-2">
                      {formatQty(f.qty)} · {Math.round(f.share * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ground">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${f.share * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card space-y-3">
          <h2 className="section-head">How fast they pay</h2>
          <ul className="space-y-2">
            {bands.map((b, k) => (
              <li key={b.label} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{b.label}</span>
                  <span className="tabular-nums text-ink-2">
                    {b.n} invoices · {Math.round(b.share * 100)}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-ground">
                  <div className={`h-full rounded-full ${k < 2 ? 'bg-good' : k === 2 ? 'bg-watch' : k === 3 ? 'bg-problem' : 'bg-ink-3'}`} style={{ width: `${b.share * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-3">Invoices raised in the period, invoice date to final payment. An unpaid invoice already past 60 days counts as over 60.</p>
        </section>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
        <Input aria-label="Search invoices and orders" className="pl-9" placeholder="Search invoice or order number" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <section className="space-y-3">
        <h2 className="section-head">Invoices</h2>
        <DataTable
          columns={invoiceCols}
          data={allInvoices || needle ? shownInvoices : shownInvoices.slice(0, 15)}
          empty={<p className="p-4 text-sm text-muted-foreground">{needle ? `No invoice matches "${q.trim()}".` : 'No invoices in this period.'}</p>}
        />
        {!needle && shownInvoices.length > 15 && (
          <div className="text-center">
            <Button variant="outline" size="sm" onClick={() => setAllInvoices((v) => !v)}>
              {allInvoices ? 'Show latest 15' : `Show all ${shownInvoices.length} invoices`}
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="section-head">Orders</h2>
        <DataTable
          columns={orderCols}
          data={allOrders || needle ? shownOrders : shownOrders.slice(0, 25)}
          empty={<p className="p-4 text-sm text-muted-foreground">{needle ? `No order matches "${q.trim()}".` : 'No orders in this period.'}</p>}
        />
        {!needle && shownOrders.length > 25 && (
          <div className="text-center">
            <Button variant="outline" size="sm" onClick={() => setAllOrders((v) => !v)}>
              {allOrders ? 'Show latest 25' : `Show all ${shownOrders.length} orders`}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

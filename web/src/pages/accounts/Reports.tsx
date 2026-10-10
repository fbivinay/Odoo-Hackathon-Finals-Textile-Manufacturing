import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { selectClass } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { MonthRow } from '@/lib/accounts'
import { formatDate, formatINR } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import { usePeriod, type PeriodProps } from '@/pages/Accounts'

const REPORTS = [
  ['pnl', 'Profit and loss'],
  ['monthly', 'Monthly financial summary'],
  ['receivables', 'Buyer outstanding and ageing'],
  ['payables', 'Supplier outstanding and ageing'],
  ['purchases', 'Purchases by material category'],
  ['inventory', 'Inventory valuation and consumption'],
  ['expenses', 'Logistics and utilities breakdown'],
  ['order-costs', 'Production cost by order'],
] as const

const CAT: Record<string, string> = { YARN: 'Yarn', WEAVING: 'Weaving materials', DYEING: 'Dyeing chemicals', FINISHING: 'Finishing chemicals', QC: 'QC materials', PACKAGING: 'Dispatch and packaging', MAINTENANCE: 'Maintenance and spares' }

function T({ head, rows, foot }: { head: string[]; rows: ReactNode[][]; foot?: ReactNode[] }) {
  return (
    <div className="data-table-wrap overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={cn('px-3 py-2 font-medium', i > 0 && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((c, j) => (
                <td key={j} className={cn('px-3 py-1.5', j > 0 && 'text-right tabular-nums')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              {foot.map((c, j) => (
                <td key={j} className={cn('px-3 py-2', j > 0 && 'text-right tabular-nums')}>
                  {c}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

const m = (v: number) => formatINR(v)

export function Reports({ from, to }: PeriodProps) {
  const { params, set } = usePeriod()
  const name = (params.get('report') as (typeof REPORTS)[number][0]) || 'pnl'
  const r = useApi<Record<string, unknown>>(`/accounts/reports/${name}?from=${from}&to=${to}`)
  const title = REPORTS.find(([k]) => k === name)?.[1]
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <select aria-label="Report" className={cn(selectClass, 'w-80 bg-surface')} value={name} onChange={(e) => set({ report: e.target.value })}>
          {REPORTS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <Button variant="outline" className="gap-1.5" onClick={() => window.print()}>
          <Printer className="size-4" />
          Print report
        </Button>
      </div>
      <div className="print-area space-y-4 print:bottom-auto">
        <div className="hidden print:block">
          <p className="text-lg font-semibold">Everest Textile Mills · {title}</p>
          <p className="text-xs">
            {formatDate(from)} to {formatDate(to)} · synthetic demo data
          </p>
        </div>
        {r.error && <p className="text-sm text-problem">{r.error}</p>}
        {!r.data || r.loading ? <Skeleton className="h-80 w-full" /> : <Body name={name} data={r.data} />}
      </div>
    </div>
  )
}

function Body({ name, data }: { name: string; data: Record<string, unknown> }) {
  if (name === 'pnl') {
    const t = data.totals as Record<string, number>
    const line = (label: string, v: number, strong = false, indent = false) => [<span className={cn(strong && 'font-semibold', indent && 'pl-4')}>{label}</span>, <span className={cn(strong && 'font-semibold', v < 0 && 'text-problem')}>{m(v)}</span>, t.revenue ? `${((100 * v) / t.revenue).toFixed(1)}%` : '—']
    return (
      <>
        <T
          head={['', 'Amount', '% of revenue']}
          rows={[
            line('Revenue (sales invoiced, before GST)', t.revenue, true),
            line('Materials used (yarn, chemicals, packaging, QC)', -t.materials, false, true),
            line('Wages (gross)', -t.wages, false, true),
            line('Gross profit', t.grossProfit, true),
            line('Logistics and transport', -t.logistics, false, true),
            line('Factory utilities', -t.utilities, false, true),
            line('Maintenance stores used', -t.maintenance, false, true),
            line('Net profit', t.netProfit, true),
          ]}
        />
        <p className="text-xs text-muted-foreground">
          Accrual basis: materials count when issued to production, not when bought (purchases in the period {m(t.purchases)} sit in stock until used). GST is excluded; claimable GST is not a cost.
        </p>
        <MonthTable rows={data.series as MonthRow[]} />
      </>
    )
  }
  if (name === 'monthly') return <MonthTable rows={data.series as MonthRow[]} cash />
  if (name === 'receivables' || name === 'payables') {
    const d = data as { asOf: string; buckets: string[]; rows: { id: string; name: string; total: number; buckets: number[] }[]; totals: number[]; total: number }
    return (
      <>
        <p className="text-sm text-ink-2">Open balances as of {formatDate(d.asOf)}, by days past the due date.</p>
        <T head={[name === 'receivables' ? 'Buyer' : 'Supplier', ...d.buckets, 'Total']} rows={d.rows.map((x) => [x.name, ...x.buckets.map((v) => (v ? m(v) : '—')), <b>{m(x.total)}</b>])} foot={['Total', ...d.totals.map(m), m(d.total)]} />
      </>
    )
  }
  if (name === 'purchases') {
    const d = data as { rows: { category: string; bills: number; taxable: number; tax: number; total: number }[]; totals: Record<string, number> }
    return <T head={['Category', 'Bills', 'Taxable', 'GST', 'Total']} rows={d.rows.map((x) => [CAT[x.category] ?? x.category, x.bills, m(x.taxable), m(x.tax), m(x.total)])} foot={['Total', '', m(d.totals.taxable), m(d.totals.tax), m(d.totals.total)]} />
  }
  if (name === 'inventory') {
    const d = data as { stock: { category: string; items: number; value: number; low: number }[]; used: { category: string; department: string; cost: number }[]; totals: Record<string, number> }
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="font-medium">Stock on hand today, at average cost</h3>
          <T head={['Category', 'Items', 'At or below reorder', 'Value']} rows={d.stock.map((x) => [CAT[x.category] ?? x.category, x.items, x.low, m(x.value)])} foot={['Total', '', '', m(d.totals.value)]} />
        </div>
        <div className="space-y-2">
          <h3 className="font-medium">Issued in the period, by department</h3>
          <T head={['Category', 'Department', 'Cost']} rows={d.used.map((x) => [CAT[x.category] ?? x.category, x.department.toLowerCase(), m(x.cost)])} foot={['Total', '', m(d.totals.used)]} />
        </div>
      </div>
    )
  }
  if (name === 'expenses') {
    const d = data as { rows: { category: string; subcategory: string; entries: number; taxable: number; tax: number; total: number }[]; totals: Record<string, number> }
    return <T head={['Expense', 'Entries', 'Before GST', 'GST', 'Total']} rows={d.rows.map((x) => [`${x.category === 'LOGISTICS' ? 'Logistics' : 'Utilities'} · ${x.subcategory}`, x.entries, m(x.taxable), m(x.tax), m(x.total)])} foot={['Total', '', m(d.totals.taxable), m(d.totals.tax), m(d.totals.total)]} />
  }
  if (name === 'order-costs') return <OrderCosts data={data as { rows: OrderCostRow[]; totals: Record<string, number> }} />
  return null
}

function MonthTable({ rows, cash = false }: { rows: MonthRow[]; cash?: boolean }) {
  const cols: [string, keyof MonthRow][] = cash
    ? [['Revenue', 'revenue'], ['Net profit', 'netProfit'], ['Purchases', 'purchases'], ['Cash in', 'cashIn'], ['Cash out', 'cashOut'], ['Output GST', 'outputGst'], ['Input GST', 'inputGst'], ['GST payable', 'gstPayable']]
    : [['Revenue', 'revenue'], ['Materials', 'materials'], ['Wages', 'wages'], ['Gross profit', 'grossProfit'], ['Logistics', 'logistics'], ['Utilities', 'utilities'], ['Maintenance', 'maintenance'], ['Net profit', 'netProfit']]
  const total = (k: keyof MonthRow) => rows.reduce((t, r) => t + Number(r[k]), 0)
  return <T head={['Month', ...cols.map(([h]) => h)]} rows={rows.map((r) => [r.month, ...cols.map(([, k]) => <span className={cn(Number(r[k]) < 0 && 'text-problem')}>{m(Number(r[k]))}</span>)])} foot={['Total', ...cols.map(([, k]) => m(total(k)))]} />
}

type OrderCostRow = { id: string; orderNo: string; buyer: { name: string }; status: string; qty: number; materialCost: number; labourCost: number; totalCost: number; orderValue: number; invoiced: number; margin: number }

function OrderCosts({ data }: { data: { rows: OrderCostRow[]; totals: Record<string, number> } }) {
  const [shown, setShown] = useState(50)
  const rows = [...data.rows].filter((o) => o.status !== 'CANCELLED').sort((a, b) => b.orderValue - a.orderValue)
  return (
    <>
      <p className="text-sm text-ink-2">Orders placed in the period. Materials include yarn, chemicals and packaging issued to the order; labour is the shift time worked on it.</p>
      <T
        head={['Order', 'Value', 'Materials', 'Labour', 'Total cost', 'Invoiced', 'Margin']}
        rows={rows.slice(0, shown).map((o) => [
          <Link to={`/orders/${o.id}`} className="font-medium hover:text-brand">
            {o.orderNo} <span className="text-xs font-normal text-muted-foreground">{o.buyer.name}</span>
          </Link>,
          m(o.orderValue), m(o.materialCost), m(o.labourCost), m(o.totalCost), m(o.invoiced),
          o.totalCost === 0 ? '—' : <span className={o.margin < 0 ? 'text-problem' : 'text-good'}>{m(o.margin)}</span>,
        ])}
        foot={['Total', m(data.totals.orderValue), '', '', m(data.totals.totalCost), m(data.totals.invoiced), m(data.totals.margin)]}
      />
      {rows.length > shown && (
        <Button variant="outline" size="sm" className="print:hidden" onClick={() => setShown((s) => s + 100)}>
          Show more ({rows.length - shown} left)
        </Button>
      )}
    </>
  )
}

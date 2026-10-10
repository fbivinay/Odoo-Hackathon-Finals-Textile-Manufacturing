import { Link } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { selectClass } from '@/components/Field'
import { Pill } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TREATMENT } from '@/lib/accounts'
import { formatDate, formatINR } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import { usePeriod, type PeriodProps } from '@/pages/Accounts'

type Row = {
  type: 'SALES' | 'PURCHASE' | 'EXPENSE'
  id: string
  ref: string
  at: string
  party: string
  state: string | null
  taxCode: string | null
  rate: number
  treatment: string | null
  taxable: number
  cgst: number
  sgst: number
  igst: number
  tax: number
  itc: boolean
  link: string
  confidence: string
}
type Register = {
  summary: { output: number; input: number; ineligible: number; rcm: number; cgst: number; sgst: number; igst: number; flagged: number; payable: number }
  byMonth: { month: string; output: number; input: number; rcm: number; ineligible: number; payable: number }[]
  count: number
  rows: Row[]
}
type TaxRule = { code: string; label: string; hsn: string; itcEligible: boolean; confidence: string; note: string; rates: { from: string; rate: number }[]; rateToday: number }

const PAGE = 100
const CONF: Record<string, 'good' | 'watch' | 'problem' | 'neutral'> = { HIGH: 'good', REPORTED: 'neutral', UNVERIFIED: 'watch', PROJECT_RULE: 'watch', UNCLASSIFIED: 'problem' }

// GST register: every sales invoice, supplier bill and expense in the period with its tax, and
// links back to the source document. Output tax, input tax credit and reverse charge are summed
// from these rows only.
export function Gst({ from, to }: PeriodProps) {
  const { params, set } = usePeriod()
  const type = params.get('type') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const reg = useApi<Register>(`/accounts/gst?from=${from}&to=${to}${type ? `&type=${type}` : ''}${params.get('q') ? `&q=${encodeURIComponent(params.get('q')!)}` : ''}&page=${page}&pageSize=${PAGE}`)
  const rules = useApi<TaxRule[]>('/accounts/tax-rules')
  const s = reg.data?.summary
  return (
    <div className="mt-4 space-y-5">
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Output GST" value={formatINR(s?.output ?? 0)} hint="On sales invoices" loading={!s} />
        <KpiCard label="Input tax credit" tone="good" value={formatINR(s?.input ?? 0)} hint="Eligible GST on bills and expenses" loading={!s} />
        <KpiCard label="Reverse charge" value={formatINR(s?.rcm ?? 0)} hint="Paid by the mill on transport" loading={!s} />
        <KpiCard label="Net payable" tone="watch" value={formatINR(s?.payable ?? 0)} hint="Output + RCM − ITC" loading={!s} />
        <KpiCard label="CGST / SGST / IGST" value={`${formatINR(s?.cgst ?? 0)} / ${formatINR(s?.sgst ?? 0)}`} hint={`IGST ${formatINR(s?.igst ?? 0)}`} loading={!s} />
        <KpiCard label="Flagged rows" tone={s?.flagged ? 'watch' : undefined} value={String(s?.flagged ?? 0)} hint="Rate unverified or not classified" loading={!s} />
      </div>

      <section className="print-area space-y-2 print:bottom-auto">
        <div className="flex items-center justify-between">
          <h2 className="section-head">By month</h2>
          <Button variant="outline" size="sm" className="gap-1.5 print:hidden" onClick={() => window.print()}>
            <Printer className="size-4" />
            Print summary
          </Button>
        </div>
        <div className="data-table-wrap overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                {['Month', 'Output GST', 'Input tax credit', 'Reverse charge', 'Not claimable', 'Net payable'].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(reg.data?.byMonth ?? []).map((m) => (
                <tr key={m.month} className="border-t border-border">
                  <td className="px-3 py-1.5 font-medium">{m.month}</td>
                  {[m.output, m.input, m.rcm, m.ineligible, m.payable].map((v, i) => (
                    <td key={i} className={cn('px-3 py-1.5 tabular-nums', i === 4 && 'font-medium')}>
                      {formatINR(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Demo figures from synthetic data. Not a GST return and not legally verified; no GSTINs are recorded.
        </p>
      </section>

      <section className="space-y-2 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-head">Register</h2>
          <div className="flex gap-2">
            <select aria-label="Type" className={cn(selectClass, 'w-40 bg-surface')} value={type} onChange={(e) => set({ type: e.target.value, page: '' })}>
              <option value="">All transactions</option>
              <option value="SALES">Sales</option>
              <option value="PURCHASE">Purchases</option>
              <option value="EXPENSE">Expenses</option>
            </select>
          </div>
        </div>
        <div className="data-table-wrap overflow-x-auto">
          {!reg.data ? (
            <Skeleton className="m-4 h-64" />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  {['Date', 'Type', 'Reference', 'Party', 'Treatment', 'Rate', 'Taxable', 'CGST', 'SGST', 'IGST', 'ITC'].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reg.data.rows.map((r) => (
                  <tr key={`${r.type}-${r.id}`} className="border-t border-border">
                    <td className="px-3 py-1.5 whitespace-nowrap">{formatDate(r.at)}</td>
                    <td className="px-3 py-1.5 text-xs">{r.type.toLowerCase()}</td>
                    <td className="px-3 py-1.5">
                      <Link to={r.link} className="font-medium hover:text-brand">
                        {r.ref}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5">
                      {r.party}
                      {r.state && <span className="ml-1 text-xs text-muted-foreground">{r.state}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      {TREATMENT[r.treatment ?? ''] ?? r.treatment ?? '—'}
                      {r.confidence !== 'HIGH' && r.confidence !== 'REPORTED' && (
                        <Pill tone={CONF[r.confidence] ?? 'neutral'} className="ml-1">
                          {r.confidence === 'PROJECT_RULE' ? 'project rule' : r.confidence.toLowerCase()}
                        </Pill>
                      )}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">{r.rate}%</td>
                    <td className="px-3 py-1.5 tabular-nums">{formatINR(r.taxable)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{r.cgst ? formatINR(r.cgst) : '—'}</td>
                    <td className="px-3 py-1.5 tabular-nums">{r.sgst ? formatINR(r.sgst) : '—'}</td>
                    <td className="px-3 py-1.5 tabular-nums">{r.igst ? formatINR(r.igst) : '—'}</td>
                    <td className="px-3 py-1.5 text-xs">{r.type === 'SALES' ? 'output' : r.itc ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{reg.data ? `${((page - 1) * PAGE + 1).toLocaleString('en-IN')}–${Math.min(page * PAGE, reg.data.count).toLocaleString('en-IN')} of ${reg.data.count.toLocaleString('en-IN')}` : ''}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={!reg.data || page * PAGE >= reg.data.count} onClick={() => set({ page: String(page + 1) })}>
              Next
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-2 print:hidden">
        <h2 className="section-head">Tax rules in use</h2>
        <p className="text-xs text-muted-foreground">
          Rates change by date (the 22 Sep 2025 GST revision), so older bills keep the rate they were raised at. Gujarat parties pay CGST + SGST; other states pay IGST. Raw yarn is NIL by project rule.
        </p>
        <div className="data-table-wrap overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                {['Rule', 'HSN / SAC', 'Rate history', 'ITC', 'Confidence', 'Note'].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rules.data ?? []).map((r) => (
                <tr key={r.code} className="border-t border-border align-top">
                  <td className="px-3 py-1.5 font-medium">{r.label}</td>
                  <td className="px-3 py-1.5 text-xs">{r.hsn}</td>
                  <td className="px-3 py-1.5 text-xs whitespace-nowrap">{r.rates.map((x) => `${x.rate}% from ${formatDate(x.from)}`).join(' → ')}</td>
                  <td className="px-3 py-1.5 text-xs">{r.itcEligible ? 'yes' : 'no'}</td>
                  <td className="px-3 py-1.5">
                    <Pill tone={CONF[r.confidence] ?? 'neutral'}>{r.confidence === 'PROJECT_RULE' ? 'project rule' : r.confidence.toLowerCase()}</Pill>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-ink-2">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

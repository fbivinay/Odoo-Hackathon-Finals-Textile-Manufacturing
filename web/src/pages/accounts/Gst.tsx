import { Printer } from 'lucide-react'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { formatINR, formatMoney } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import type { PeriodProps } from '@/pages/Accounts'

type Register = {
  summary: { output: number; input: number; ineligible: number; rcm: number; cgst: number; sgst: number; igst: number; flagged: number; payable: number }
  byMonth: { month: string; output: number; input: number; rcm: number; ineligible: number; payable: number }[]
}
// GST for the period: output tax, input tax credit and reverse charge, summed from every sales
// invoice, supplier bill and expense, and month by month.
export function Gst({ from, to }: PeriodProps) {
  const reg = useApi<Register>(`/accounts/gst?from=${from}&to=${to}&pageSize=1`)
  const s = reg.data?.summary
  return (
    <div className="mt-4 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Output GST" value={formatMoney(s?.output ?? 0)} loading={!s} />
        <KpiCard label="Input tax credit" tone="good" value={formatMoney(s?.input ?? 0)} loading={!s} />
        <KpiCard label="Reverse charge" value={formatMoney(s?.rcm ?? 0)} loading={!s} />
        <KpiCard label="Net payable" tone="watch" value={formatMoney(s?.payable ?? 0)} loading={!s} />
        <KpiCard label="CGST + SGST" value={formatMoney((s?.cgst ?? 0) + (s?.sgst ?? 0))} loading={!s} />
        <KpiCard label="IGST" value={formatMoney(s?.igst ?? 0)} loading={!s} />
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

    </div>
  )
}

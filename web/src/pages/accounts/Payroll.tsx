import { useNavigate } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { selectClass } from '@/components/Field'
import { Pill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, formatINR } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import { usePeriod, type PeriodProps } from '@/pages/Accounts'

type Row = {
  worker: { id: string; code: string; name: string; shift: string; dailyWage: number; department?: string }
  present: number
  halfDays: number
  absent: number
  nightDays: number
  daysWorked: number
  basic: number
  allowances: number
  overtime: number
  deductions: number
  gross: number
  net: number
  paid: number
  due: number
  paidAt: string | null
}
type Sheet = { month: string; rows: Row[]; totals: Record<string, number> }
type Year = { rows: { month: string; workers: number; basic: number; allowances: number; overtime: number; deductions: number; gross: number; net: number }[] }

const MONTHS = (from: string, to: string) => {
  const out: string[] = []
  for (let m = to.slice(0, 7); m >= from.slice(0, 7); ) {
    out.push(m)
    const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 2, 1))
    m = d.toISOString().slice(0, 7)
  }
  return out
}
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

// Payroll register from the attendance register (backend/src/lib/payroll.js): basic for days
// worked, night-shift allowance, overtime and deductions as recorded, net paid on the 5th.
export function Payroll({ from, to }: PeriodProps) {
  const navigate = useNavigate()
  const { params, set } = usePeriod()
  const months = MONTHS(from, to)
  const month = params.get('month') && months.includes(params.get('month')!) ? params.get('month')! : months[0]
  const sheet = useApi<Sheet>(`/accounts/payroll?month=${month}`)
  const year = useApi<Year>(`/accounts/reports/payroll?from=${from}&to=${to}`)
  const t = sheet.data?.totals
  return (
    <div className="mt-4 space-y-5">
      <section className="print-area space-y-3 print:bottom-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <select aria-label="Payroll month" className={cn(selectClass, 'w-52 bg-surface')} value={month} onChange={(e) => set({ month: e.target.value })}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
          <Button variant="outline" className="gap-1.5" onClick={() => window.print()}>
            <Printer className="size-4" />
            Print payroll register
          </Button>
        </div>
        <div className="data-table-wrap overflow-x-auto">
          <div className="hidden px-4 pt-4 print:block">
            <p className="text-lg font-semibold">Everest Textile Mills · Payroll register · {monthName(month)}</p>
            <p className="text-xs">Synthetic demo data</p>
          </div>
          {!sheet.data ? (
            <Skeleton className="m-4 h-64" />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  {['Worker', 'Shift', 'Days', 'Night', 'Daily wage', 'Basic', 'Allowances', 'Overtime', 'Deductions', 'Gross', 'Net', 'Status'].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.data.rows.map((r) => (
                  <tr key={r.worker.id} className="cursor-pointer border-t border-border hover:bg-zinc-50" onClick={() => navigate(`/accounts/payslip/${r.worker.id}/${month}`)}>
                    <td className="px-3 py-1.5">
                      <span className="font-medium">{r.worker.name}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">{r.worker.code}</span>
                    </td>
                    <td className="px-3 py-1.5 text-ink-2">{r.worker.shift.toLowerCase()}</td>
                    <td className="px-3 py-1.5 tabular-nums">
                      {r.daysWorked}
                      {r.absent > 0 && <span className="ml-1 text-xs text-muted-foreground">({r.absent} absent)</span>}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">{r.nightDays || '—'}</td>
                    <td className="px-3 py-1.5 tabular-nums">{formatINR(Number(r.worker.dailyWage))}</td>
                    <td className="px-3 py-1.5 tabular-nums">{formatINR(r.basic)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{r.allowances ? formatINR(r.allowances) : '—'}</td>
                    <td className="px-3 py-1.5 tabular-nums">{r.overtime ? formatINR(r.overtime) : '—'}</td>
                    <td className="px-3 py-1.5 tabular-nums">{r.deductions ? formatINR(r.deductions) : '—'}</td>
                    <td className="px-3 py-1.5 tabular-nums">{formatINR(r.gross)}</td>
                    <td className="px-3 py-1.5 font-medium tabular-nums">{formatINR(r.net)}</td>
                    <td className="px-3 py-1.5">{r.paidAt ? <Pill tone="good">Paid {formatDate(r.paidAt)}</Pill> : r.net > 0 ? <Pill tone="watch">Due</Pill> : '—'}</td>
                  </tr>
                ))}
              </tbody>
              {t && (
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="px-3 py-2" colSpan={5}>
                      {t.workers} workers
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatINR(t.basic)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatINR(t.allowances)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatINR(t.overtime)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatINR(t.deductions)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatINR(t.gross)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatINR(t.net)}</td>
                    <td className="px-3 py-2 text-xs font-normal">{t.due > 0 ? `${formatINR(t.due)} still due` : 'All paid'}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
        <p className="text-xs text-muted-foreground print:hidden">
          Click a worker for the payslip. Rules: basic = days worked × daily wage (half day = half), ₹40 night-shift allowance per night worked. No statutory deductions are modelled in the demo data.
        </p>
      </section>

      <section className="space-y-2 print:hidden">
        <h2 className="section-head">Payroll by month in the period</h2>
        <div className="data-table-wrap overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                {['Month', 'Workers', 'Basic', 'Allowances', 'Overtime', 'Deductions', 'Gross', 'Net paid'].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(year.data?.rows ?? []).map((r) => (
                <tr key={r.month} className="cursor-pointer border-t border-border hover:bg-zinc-50" onClick={() => set({ month: r.month })}>
                  <td className="px-3 py-1.5 font-medium">{monthName(r.month)}</td>
                  <td className="px-3 py-1.5 tabular-nums">{r.workers}</td>
                  {[r.basic, r.allowances, r.overtime, r.deductions, r.gross, r.net].map((v, i) => (
                    <td key={i} className="px-3 py-1.5 tabular-nums">
                      {formatINR(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

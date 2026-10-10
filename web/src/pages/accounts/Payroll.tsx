import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { selectClass } from '@/components/Field'
import { Pill } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, formatINR, formatMoney } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import { usePeriod, type PeriodProps } from '@/pages/Accounts'

type Row = {
  worker: { id: string; code: string; name: string; shift: string; dailyWage: number; department?: string; stage: string | null; joined: string }
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
const SHIFT_NAMES: Record<string, string> = { MORNING: 'Morning', EVENING: 'Evening', NIGHT: 'Night' }
// Role on the floor: the stage of the last machine they ran.
const ROLE: Record<string, string> = { SPINNING: 'Spinning operator', WEAVING: 'Weaving operator', DYEING: 'Dyeing operator' }
const SUMS = ['basic', 'allowances', 'overtime', 'deductions', 'gross', 'net', 'due'] as const

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
  const [shift, setShift] = useState('')
  const [role, setRole] = useState('')
  const [joinedFrom, setJoinedFrom] = useState('')
  const [joinedTo, setJoinedTo] = useState('')
  const filtered = !!(shift || role || joinedFrom || joinedTo)
  const rows = (sheet.data?.rows ?? []).filter((r) => {
    const joined = r.worker.joined.slice(0, 10)
    return (!shift || r.worker.shift === shift) && (!role || r.worker.stage === role) && (!joinedFrom || joined >= joinedFrom) && (!joinedTo || joined <= joinedTo)
  })
  // Totals follow the filters.
  const t = sheet.data && { workers: rows.length, ...Object.fromEntries(SUMS.map((k) => [k, rows.reduce((sum, r) => sum + r[k], 0)])) } as Record<(typeof SUMS)[number] | 'workers', number>
  const select = (label: string, value: string, onChange: (v: string) => void, options: Record<string, string>, all: string, w: string) => (
    <select aria-label={label} className={cn(selectClass, w, 'bg-surface')} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{all}</option>
      {Object.entries(options).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  )
  return (
    <div className="mt-4 space-y-5">
      <section className="print-area space-y-4 print:bottom-auto">
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <select aria-label="Payroll month" className={cn(selectClass, 'w-40 bg-surface')} value={month} onChange={(e) => set({ month: e.target.value })}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
          {select('Shift', shift, setShift, SHIFT_NAMES, 'All shifts', 'w-32')}
          {select('Role', role, setRole, ROLE, 'All roles', 'w-40')}
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-sm text-muted-foreground">Joined</span>
            <Input aria-label="Joined from" title="Joined from" type="date" className="h-9 w-36" value={joinedFrom} max={joinedTo || undefined} onChange={(e) => setJoinedFrom(e.target.value)} />
          <span className="text-sm text-muted-foreground">to</span>
          <Input aria-label="Joined to" title="Joined to" type="date" className="h-9 w-36" value={joinedTo} min={joinedFrom || undefined} onChange={(e) => setJoinedTo(e.target.value)} />
          </span>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShift('')
                setRole('')
                setJoinedFrom('')
                setJoinedTo('')
              }}
            >
              Reset
            </Button>
          )}
          <Button variant="outline" className="ml-auto gap-1.5" onClick={() => window.print()}>
            <Printer className="size-4" />
            Print
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 print:hidden">
          <KpiCard label="Workers" value={String(t?.workers ?? 0)} loading={!t} />
          <KpiCard label="Net pay" value={formatMoney(t?.net ?? 0)} loading={!t} />
          <KpiCard label="Still due" tone={t?.due ? 'watch' : undefined} value={t?.due ? formatMoney(t.due) : 'All paid'} loading={!t} />
        </div>

        <div className="data-table-wrap overflow-x-auto">
          <div className="hidden px-4 pt-4 print:block">
            <p className="text-lg font-semibold">Everest Textile Mills · Payroll register · {monthName(month)}</p>
          </div>
          {!sheet.data ? (
            <Skeleton className="m-4 h-64" />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  {['Worker', 'Role', 'Days worked', 'Net pay', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                      No worker matches these filters.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.worker.id} className="cursor-pointer border-t border-border hover:bg-zinc-50" onClick={() => navigate(`/accounts/payslip/${r.worker.id}/${month}`)}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <p className="font-medium">{r.worker.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.worker.code} · {SHIFT_NAMES[r.worker.shift] ?? r.worker.shift} shift
                      </p>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-ink-2">{r.worker.stage ? ROLE[r.worker.stage] : '—'}</td>
                    <td className="px-4 py-2 tabular-nums">{r.daysWorked}</td>
                    <td className="px-4 py-2 font-medium tabular-nums">{formatINR(r.net)}</td>
                    <td className="px-4 py-2">{r.paidAt ? <Pill tone="good">Paid {formatDate(r.paidAt)}</Pill> : r.net > 0 ? <Pill tone="watch">Due</Pill> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-muted-foreground print:hidden">Click a worker to open the payslip with the full breakdown.</p>
      </section>

      <section className="space-y-2 print:hidden">
        <h2 className="section-head">Month by month</h2>
        <div className="data-table-wrap overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                {['Month', 'Workers', 'Gross pay', 'Net paid'].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(year.data?.rows ?? []).map((r) => (
                <tr key={r.month} className="cursor-pointer border-t border-border hover:bg-zinc-50" onClick={() => set({ month: r.month })}>
                  <td className="px-4 py-2 font-medium">{monthName(r.month)}</td>
                  <td className="px-4 py-2 tabular-nums">{r.workers}</td>
                  <td className="px-4 py-2 tabular-nums">{formatINR(r.gross)}</td>
                  <td className="px-4 py-2 tabular-nums">{formatINR(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

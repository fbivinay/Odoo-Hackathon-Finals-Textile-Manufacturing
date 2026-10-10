import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Recycle } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { selectClass } from '@/components/Field'
import { PageHead } from '@/components/PageHead'
import { RollLink } from '@/components/RollTrace'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/auth/session'
import { useDataVersion } from '@/lib/changes'
import { api, ApiError } from '@/lib/api'
import { fetchAll } from '@/lib/useApi'
import { dayFromToday, formatDayMonth, formatINR, formatMoney, formatQty } from '@/lib/format'
import { costPerMetreOf, rate, summariseWaste, type Bucket, type WasteRoll } from '@/lib/waste'
import type { OrderCost } from '@/types'

const PERIODS = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '365', label: 'Last 12 months', days: 365 },
]

const istIso = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600 * 1000).toISOString()

interface JobInfo {
  shift: string
  operator: string
  stage: string
}

export function Waste() {
  const { user } = useSession()
  const [period, setPeriod] = useState('30')
  const days = PERIODS.find((p) => p.key === period)!.days
  const [rolls, setRolls] = useState<WasteRoll[] | null>(null)
  const [costs, setCosts] = useState<Map<string, number> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [jobInfo, setJobInfo] = useState<Map<string, JobInfo>>(new Map())
  const isOwner = user?.role === 'OWNER'
  const version = useDataVersion()

  useEffect(() => {
    let live = true
    setError(null)
    fetchAll<WasteRoll>(`/qc/rolls?from=${dayFromToday(-days + 1)}`)
      // Dates are bucketed by the mill's day (IST), not UTC.
      .then((r) => live && setRolls(r.map((x) => ({ ...x, createdAt: istIso(x.createdAt) }))))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load rolls.'))
    return () => {
      live = false
    }
  }, [days, version])

  // Cost per metre comes from the owner's order-cost report; other roles see quantities only.
  useEffect(() => {
    if (!isOwner) return
    let live = true
    fetchAll<OrderCost>(`/reports/order-costs?from=${dayFromToday(-days - 120)}`)
      .then((c) => live && setCosts(costPerMetreOf(c)))
      .catch(() => live && setCosts(new Map()))
    return () => {
      live = false
    }
  }, [days, isOwner, version])

  const today = istIso(new Date().toISOString()).slice(0, 10)
  const summary = useMemo(() => (rolls ? summariseWaste(rolls, costs ?? new Map(), { trend: days <= 30 ? 'day' : 'month' }) : null), [rolls, costs, days])
  const todays = useMemo(() => (rolls ? summariseWaste(rolls.filter((r) => r.createdAt.slice(0, 10) === today), costs ?? new Map()) : null), [rolls, costs, today])
  const topJobs = useMemo(() => summary?.byJob.slice(0, 10) ?? [], [summary])

  // Shift and operator for the jobs on the leaderboard, from each job's first roll trace.
  useEffect(() => {
    const missing = topJobs.filter((j) => !jobInfo.has(j.key))
    if (missing.length === 0) return
    let live = true
    Promise.all(
      missing.map((j) =>
        api<{ job: { shift: string; stage: string; worker: { name: string } | null } | null }>(`/qc/rolls/${j.rollIds[0]}`)
          .then((t) => [j.key, { shift: t.job?.shift ?? '—', operator: t.job?.worker?.name ?? '—', stage: t.job?.stage ?? '—' }] as const)
          .catch(() => [j.key, { shift: '—', operator: '—', stage: '—' }] as const),
      ),
    ).then((rows) => live && setJobInfo((m) => new Map([...m, ...rows])))
    return () => {
      live = false
    }
  }, [topJobs, jobInfo])

  const loading = !rolls && !error
  const s = summary
  const costNote = !isOwner ? 'Cost is visible to the owner only' : s && s.costedShare < 1 ? `${Math.round(s.costedShare * 100)}% of rejected metres have a cost basis` : 'Yarn + labour per metre made'

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Production"
        title="Waste and rework"
        lede="Fabric that failed QC or went back for rework, traced to the job, machine and stage it came from. All quantities are metres of finished fabric."
        actions={
          <select aria-label="Period" className={`${selectClass} w-40 bg-surface`} value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        }
      />
      {error && <p className="text-sm text-problem">{error}</p>}

      <section className="space-y-3">
        <h2 className="section-head">Today</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <KpiCard label="Rolled today" value={formatQty(todays?.produced ?? 0)} hint={todays ? `${formatQty(todays.pendingQc)} still waiting for QC` : undefined} loading={loading} />
          <KpiCard label="Rejected today" tone={todays?.rejected ? 'problem' : undefined} value={formatQty(todays?.rejected ?? 0)} hint={todays?.rejectPct != null ? `${todays.rejectPct}% of checked` : 'Nothing checked yet'} loading={loading} />
          <KpiCard label="Sent to rework today" tone={todays?.reworked ? 'watch' : undefined} value={formatQty(todays?.reworked ?? 0)} loading={loading} />
          <KpiCard label="Rejected fabric cost today" value={isOwner ? formatMoney(todays?.rejectCost ?? 0) : '—'} hint={isOwner ? undefined : 'Owner only'} loading={loading || (isOwner && !costs)} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-head">{PERIODS.find((p) => p.key === period)!.label}</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <KpiCard label="Fabric checked" value={formatQty(s?.checked ?? 0)} hint={s ? `${formatQty(s.produced)} rolled, ${formatQty(s.pendingQc)} waiting` : undefined} loading={loading} />
          <KpiCard label="Rejected" tone="problem" value={s?.rejectPct != null ? `${s.rejectPct}%` : '—'} hint={s ? `${formatQty(s.rejected)} written off` : undefined} loading={loading} />
          <KpiCard
            label="Rework"
            tone="watch"
            value={s?.reworkPct != null ? `${s.reworkPct}%` : '—'}
            hint={s ? `${formatQty(s.reworkRecovered)} recovered · ${formatQty(s.reworkOpen)} open · ${formatQty(s.reworkThenRejected)} later rejected` : undefined}
            loading={loading}
          />
          <KpiCard label="Avoidable loss" value={isOwner && s ? formatMoney(s.rejectCost) : '—'} hint={costNote} loading={loading || (isOwner && !costs)} />
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="section-head">Rejects and rework over time</h2>
        {loading ? (
          <Skeleton className="h-64" />
        ) : !s || s.byMonth.length === 0 ? (
          <EmptyState icon={Recycle} line="No rolls in this period." />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={s.byMonth.map((b) => ({ ...b, rate: rate(b.rejected, b.checked) ?? 0, name: b.key.length === 10 ? formatDayMonth(b.key) : b.key }))} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="#e3e3e6" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis yAxisId="m" tickLine={false} axisLine={false} fontSize={12} width={56} />
                <YAxis yAxisId="pct" orientation="right" tickLine={false} axisLine={false} fontSize={12} width={36} unit="%" />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: '1px solid #e3e3e6', fontSize: 12 }}
                  formatter={(v, n) => (n === 'rate' ? [`${v}%`, 'Reject rate'] : [formatQty(Number(v)), n === 'rejected' ? 'Rejected' : 'Reworked'])}
                />
                <Bar yAxisId="m" dataKey="rejected" stackId="w" fill="#a82e22" radius={[0, 0, 0, 0]} />
                <Bar yAxisId="m" dataKey="reworked" stackId="w" fill="#c9b3c2" radius={[6, 6, 0, 0]} />
                <Line yAxisId="pct" dataKey="rate" type="monotone" stroke="#714b67" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown title="By stage the defect started in" note="Holes, uneven weaving and broken ends come from the loom; colour faults and stains from the dye house." rows={s?.byStage} loading={loading} showRate={false} isOwner={isOwner} />
        <Breakdown title="By defect" rows={s?.byDefect} loading={loading} showRate={false} isOwner={isOwner} />
        <Breakdown title="By dyeing machine the roll came off" rows={s?.byMachine} loading={loading} showRate isOwner={isOwner} />
        <Breakdown title="By fabric" rows={s?.byFabric} loading={loading} showRate isOwner={isOwner} />
      </div>

      <section className="space-y-3">
        <h2 className="section-head">Highest-waste production jobs</h2>
        <JobsTable rows={topJobs} info={jobInfo} loading={loading} isOwner={isOwner} />
      </section>

      <section className="card space-y-2 text-xs text-ink-2">
        <h2 className="text-sm font-medium text-ink">How these figures are worked out</h2>
        <p>Reject % = rejected metres ÷ checked metres × 100. Rework % uses the same base. Rolls still waiting for QC are not in either rate.</p>
        <p>A roll reworked and later rejected is counted once, in rejected; the rework line shows it separately but it is not added twice.</p>
        <p>Cost = rejected metres × the order's cost per metre made (yarn issued + labour, divided by every metre the order produced). Power, dyes and overheads are not recorded, so this understates the true loss.</p>
        <p>
          Not shown: physical material waste (yarn, dye, chemicals in kg or litres). Production records give yarn issued and spun but no waste quantity, category, reason or
          operator, and spun output equals yarn issued in every record. Weaving's planned 6% overrun is grey-fabric surplus, not waste. Recording real waste needs a
          backend endpoint (see the report).
        </p>
      </section>
    </div>
  )
}

function Breakdown({ title, note, rows, loading, showRate, isOwner }: { title: string; note?: string; rows?: Bucket[]; loading: boolean; showRate: boolean; isOwner: boolean }) {
  const max = Math.max(1, ...(rows ?? []).map((r) => r.rejected + r.reworked))
  return (
    <section className="card space-y-3">
      <div>
        <h2 className="section-head">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-ink-3">{note}</p>}
      </div>
      {loading ? (
        <Skeleton className="h-40" />
      ) : !rows || rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing rejected or reworked in this period.</p>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 8).map((r) => (
            <li key={r.key} className="space-y-1">
              <div className="flex justify-between gap-3 text-sm">
                <span>{r.label}</span>
                <span className="tabular-nums text-ink-2">
                  {formatQty(r.rejected)} rejected · {formatQty(r.reworked)} rework
                  {showRate && r.checked > 0 && <span className="ml-1 text-ink-3">({rate(r.rejected, r.checked)}%)</span>}
                  {isOwner && r.rejectCost > 0 && <span className="ml-1 text-ink-3">· {formatINR(r.rejectCost)}</span>}
                </span>
              </div>
              <div className="flex h-1.5 overflow-hidden rounded-full bg-ink/5">
                <div className="h-full bg-problem" style={{ width: `${(r.rejected / max) * 100}%` }} />
                <div className="h-full bg-brand-soft" style={{ width: `${(r.reworked / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type JobRow = ReturnType<typeof summariseWaste>['byJob'][number]

function JobsTable({ rows, info, loading, isOwner }: { rows: JobRow[]; info: Map<string, JobInfo>; loading: boolean; isOwner: boolean }) {
  const columns: ColumnDef<JobRow>[] = [
    { id: 'order', header: 'Order', accessorFn: (j) => j.orderNo },
    { id: 'machine', header: 'Machine', accessorFn: (j) => j.machine },
    { id: 'shift', header: 'Shift', accessorFn: (j) => info.get(j.key)?.shift ?? '…', cell: ({ getValue }) => String(getValue()).charAt(0) + String(getValue()).slice(1).toLowerCase() },
    { id: 'operator', header: 'Operator', accessorFn: (j) => info.get(j.key)?.operator ?? '…' },
    { id: 'checked', header: 'Checked', accessorFn: (j) => j.checked, cell: ({ getValue }) => formatQty(Number(getValue())) },
    { id: 'rejected', header: 'Rejected', accessorFn: (j) => j.rejected, cell: ({ getValue }) => <span className="text-problem">{formatQty(Number(getValue()))}</span> },
    { id: 'reworked', header: 'Rework', accessorFn: (j) => j.reworked, cell: ({ getValue }) => formatQty(Number(getValue())) },
    ...(isOwner ? [{ id: 'cost', header: 'Cost', accessorFn: (j: JobRow) => j.rejectCost, cell: ({ getValue }: { getValue: () => unknown }) => (Number(getValue()) > 0 ? formatINR(Number(getValue())) : '—') } as ColumnDef<JobRow>] : []),
    {
      id: 'rolls',
      header: 'Rolls (open trace)',
      enableSorting: false,
      cell: ({ row: { original: j } }) => (
        <span className="flex flex-wrap gap-x-2">
          {j.rollIds.slice(0, 4).map((id, i) => (
            <RollLink key={id} id={id} rollNo={`#${i + 1}`} />
          ))}
          {j.rollIds.length > 4 && <span className="text-xs text-ink-3">+{j.rollIds.length - 4}</span>}
        </span>
      ),
    },
  ]
  return <DataTable columns={columns} data={rows} loading={loading} empty={<EmptyState icon={Recycle} line="No job lost fabric in this period." />} />
}

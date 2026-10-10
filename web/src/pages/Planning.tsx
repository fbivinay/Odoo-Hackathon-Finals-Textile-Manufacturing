import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/DataTable'
import { PageHead } from '@/components/PageHead'
import { Pill, StatusPill, label } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { formatDate, formatDayMonth, formatQty, unitFor } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import type { Planning as Plan, Stage } from '@/types'

const STAGES: Stage[] = ['SPINNING', 'WEAVING', 'DYEING']
type PlanOrder = Plan['orders'][number]
type YarnNeed = Plan['yarnNeeds'][number]

const stageWindow = (s: PlanOrder['stages'][number]) =>
  !s.start ? null : s.start === s.end || !s.end ? formatDayMonth(s.start) : `${formatDayMonth(s.start)}–${formatDayMonth(s.end)}`

const orderCols: ColumnDef<PlanOrder>[] = [
  { accessorKey: 'orderNo', header: 'Order' },
  { id: 'buyer', header: 'Buyer', accessorFn: (o) => o.buyer.name },
  { id: 'fabric', header: 'Fabric', accessorFn: (o) => `${o.fabricType} · ${o.colour}` },
  { accessorKey: 'status', header: 'Now', cell: ({ row: { original: o } }) => <StatusPill status={o.status} /> },
  {
    id: 'plan',
    header: 'Planned stages',
    enableSorting: false,
    cell: ({ row: { original: o } }) => (
      <span className="flex gap-1.5">
        {o.stages.map((s) => {
          const w = stageWindow(s)
          return w ? (
            <span key={s.stage} className="rounded-md bg-ink/5 px-1.5 py-0.5 text-[0.66rem] text-ink-2">
              {label(s.stage).slice(0, 4)} {w}
            </span>
          ) : null
        })}
      </span>
    ),
  },
  { id: 'deadline', header: 'Deadline', accessorFn: (o) => o.deadline, cell: ({ row: { original: o } }) => formatDate(o.deadline) },
  {
    id: 'ready',
    header: 'Expected ready',
    accessorFn: (o) => o.expectedReady ?? '',
    cell: ({ row: { original: o } }) => (o.expectedReady ? formatDate(o.expectedReady) : 'Beyond horizon'),
  },
  {
    id: 'risk',
    header: 'Outlook',
    accessorFn: (o) => o.lateByDays,
    cell: ({ row: { original: o } }) => (o.onTime ? <Pill tone="good">On time</Pill> : <Pill tone="problem">Late {o.lateByDays}d</Pill>),
  },
]

const yarnCols: ColumnDef<YarnNeed>[] = [
  { id: 'yarn', header: 'Yarn', accessorFn: (y) => `${y.yarnType} · ${y.colour}` },
  { accessorKey: 'orders', header: 'Orders' },
  { accessorKey: 'needed', header: 'Needed', cell: ({ row: { original: y } }) => formatQty(y.needed, y.unit) },
  { accessorKey: 'inStock', header: 'In store', cell: ({ row: { original: y } }) => formatQty(y.inStock, y.unit) },
  {
    accessorKey: 'shortBy',
    header: 'To buy',
    cell: ({ row: { original: y } }) => (y.shortBy > 0 ? <Pill tone="problem">{formatQty(y.shortBy, y.unit)}</Pill> : <Pill tone="good">Covered</Pill>),
  },
]

export function Planning() {
  const { data: p, loading, error } = useApi<Plan>('/planning/schedule?days=90')
  const s = p?.summary

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Next 90 days"
        title="Will every order make its deadline?"
        lede="Every open order planned forward into each stage's real capacity, earliest deadline first. Recomputed on every visit from the last 60 days of output."
      />
      {error && <p className="text-sm text-problem">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard label="Open orders" value={String(s?.openOrders ?? 0)} loading={loading} />
        <KpiCard label="On time" tone="good" value={String(s?.onTime ?? 0)} loading={loading} />
        <KpiCard label="Expected late" tone={s?.late ? 'problem' : undefined} value={String(s?.late ?? 0)} hint="At current capacity" loading={loading} />
        <KpiCard
          label="Yarns to buy"
          tone={s?.yarnsShort ? 'problem' : undefined}
          value={String(s?.yarnsShort ?? 0)}
          hint="Order book needs more than the store holds"
          loading={loading}
        />
      </div>

      <section className="card space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="section-head">Weekly load</h2>
            <p className="lede mt-1!">Each cell is one week of planned work as a share of the stage's capacity. Darker is busier.</p>
          </div>
          {p && (
            <p className="text-[0.66rem] text-ink-3">
              {STAGES.map((st) => `${label(st)} ${formatQty(p.capacity[st].perDay, unitFor(st))}/day on ${p.capacity[st].usable} of ${p.capacity[st].machines}`).join(' · ')}
            </p>
          )}
        </div>
        {loading ? (
          <div className="skel h-28" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-[0.62rem]">
              <thead>
                <tr>
                  <th className="w-20" />
                  {p?.weeklyLoad.map((w) => (
                    <th key={w.weekStart} className="font-normal whitespace-nowrap text-ink-3">
                      {formatDayMonth(w.weekStart)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STAGES.map((st) => (
                  <tr key={st}>
                    <th className="pr-2 text-left font-medium whitespace-nowrap text-ink-2">{label(st)}</th>
                    {p?.weeklyLoad.map((w) => {
                      const u = w[st].utilisation
                      return (
                        <td
                          key={w.weekStart}
                          title={`${label(st)}, week of ${formatDate(w.weekStart)}: ${u}% (${formatQty(w[st].load, unitFor(st))} of ${formatQty(w[st].capacity, unitFor(st))})`}
                          className="h-9 min-w-9 rounded-md text-center font-medium tabular-nums transition-[scale] duration-200 hover:scale-110"
                          style={{
                            background: `color-mix(in srgb, var(--ink) ${Math.max(4, u * 0.9)}%, transparent)`,
                            color: u > 55 ? 'var(--surface)' : 'var(--ink-2)',
                          }}
                        >
                          {u}%
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="section-head">Schedule</h2>
        <DataTable columns={orderCols} data={p?.orders ?? []} loading={loading} initialSorting={[{ id: 'risk', desc: true }]} />
      </section>

      <section className="space-y-3">
        <h2 className="section-head">Yarn the order book needs</h2>
        <DataTable columns={yarnCols} data={p?.yarnNeeds ?? []} loading={loading} initialSorting={[{ id: 'shortBy', desc: true }]} />
      </section>
    </div>
  )
}

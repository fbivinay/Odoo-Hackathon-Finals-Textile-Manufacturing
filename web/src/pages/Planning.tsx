import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { useSession } from '@/auth/session'
import { DataTable } from '@/components/DataTable'
import { PageHead } from '@/components/PageHead'
import { Pill, StatusPill, label } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate, formatDayMonth, formatQty, unitFor } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import type { Planning as Plan } from '@/types'

type PlanOrder = Plan['orders'][number]
type YarnNeed = Plan['yarnNeeds'][number]

// Late orders first, then those waiting for yarn, then the rest.
const risk = (o: PlanOrder) => (o.lateByDays ?? 0) * 10 + (o.yarnShortBy > 0 ? 1 : 0)

// The three outlooks, in the same colours as their pills.
const OUTLOOKS = [
  { label: 'All', dot: '', match: () => true },
  { label: 'Late', dot: 'bg-problem', match: (o: PlanOrder) => Boolean(o.lateByDays) },
  { label: 'Needs yarn', dot: 'bg-watch', match: (o: PlanOrder) => !o.lateByDays && o.yarnShortBy > 0 },
  { label: 'On time', dot: 'bg-good', match: (o: PlanOrder) => !o.lateByDays && o.yarnShortBy <= 0 },
]

const orderCols: ColumnDef<PlanOrder>[] = [
  {
    accessorKey: 'orderNo',
    header: 'Order',
    cell: ({ row: { original: o } }) => (
      <div className="leading-tight">
        <p className="font-medium">{o.orderNo}</p>
        <p className="text-xs text-muted-foreground">{o.buyer.name}</p>
      </div>
    ),
  },
  { accessorKey: 'status', header: 'Now', cell: ({ row: { original: o } }) => <StatusPill status={o.status} /> },
  { id: 'deadline', header: 'Deadline', accessorFn: (o) => o.deadline, cell: ({ row: { original: o } }) => formatDate(o.deadline) },
  {
    id: 'ready',
    header: 'Ready by',
    accessorFn: (o) => o.expectedReady ?? '',
    cell: ({ row: { original: o } }) => (o.expectedReady ? formatDate(o.expectedReady) : 'Not scheduled'),
  },
  {
    id: 'risk',
    header: 'Outlook',
    accessorFn: risk,
    cell: ({ row: { original: o } }) =>
      o.lateByDays ? (
        <span className="inline-flex items-center gap-2">
          <Pill tone="problem">Late {o.lateByDays}d</Pill>
          {o.yarnShortBy > 0 && <span className="text-xs text-muted-foreground">needs {formatQty(o.yarnShortBy, 'kg')} yarn</span>}
        </span>
      ) : o.yarnShortBy > 0 ? (
        <Pill tone="watch">Needs {formatQty(o.yarnShortBy, 'kg')} yarn</Pill>
      ) : (
        <Pill tone="good">On time</Pill>
      ),
  },
]

const yarnCols: ColumnDef<YarnNeed>[] = [
  { id: 'yarn', header: 'Yarn', accessorFn: (y) => `${y.yarnType} · ${y.colour}` },
  { accessorKey: 'orders', header: 'Orders' },
  { accessorKey: 'needed', header: 'Needed', cell: ({ row: { original: y } }) => formatQty(y.needed, y.unit) },
  { accessorKey: 'inStock', header: 'In store', cell: ({ row: { original: y } }) => formatQty(y.inStock, y.unit) },
  {
    id: 'neededBy',
    header: 'For order due',
    accessorFn: (y) => y.neededBy ?? '',
    cell: ({ row: { original: y } }) => (y.neededBy ? formatDate(y.neededBy) : <span className="text-muted-foreground">—</span>),
  },
  {
    accessorKey: 'shortBy',
    header: 'To buy',
    cell: ({ row: { original: y } }) => (y.shortBy > 0 ? <Pill tone="problem">{formatQty(y.shortBy, y.unit)}</Pill> : <Pill tone="good">Covered</Pill>),
  },
]

export function Planning() {
  const { user } = useSession()
  const { data: p, loading, error } = useApi<Plan>('/planning/schedule?days=90')
  const s = p?.summary
  const [outlook, setOutlook] = useState(0)
  const [detail, setDetail] = useState<PlanOrder | null>(null)
  const down = p ? Object.values(p.capacity).reduce((n, c) => n + c.machines - c.usable, 0) : 0
  const orders = p?.orders ?? []

  return (
    <div className="space-y-5">
      <PageHead eyebrow="Open customer orders" title="Order Forecast" />
      {p && (
        <p className="-mt-2 text-xs text-muted-foreground">
          Worked out from the last 60 days of machine output{down > 0 ? `, with ${down} machine${down > 1 ? 's' : ''} down right now` : ''}. Click an order for its plan.
        </p>
      )}
      {error && <p className="text-sm text-problem">{error}</p>}

      {/* The store comes here to see what to buy; everyone else for the deadlines. */}
      <Tabs defaultValue={user?.role === 'STORE' ? 'yarn' : 'schedule'}>
        <TabsList>
          <TabsTrigger value="schedule">Deadlines{s && s.late > 0 ? ` · ${s.late} late` : ''}</TabsTrigger>
          <TabsTrigger value="yarn">Yarn to buy{s && s.yarnsShort > 0 ? ` · ${s.yarnsShort}` : ''}</TabsTrigger>
        </TabsList>
        <TabsContent value="schedule" className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {OUTLOOKS.map((f, i) => (
              <Button key={f.label} size="sm" variant={i === outlook ? 'secondary' : 'ghost'} className="gap-1.5" onClick={() => setOutlook(i)}>
                {f.dot && <span className={`size-2 rounded-full ${f.dot}`} />}
                {f.label}
                <span className="text-xs text-muted-foreground">{orders.filter(f.match).length}</span>
              </Button>
            ))}
          </div>
          <DataTable columns={orderCols} data={orders.filter(OUTLOOKS[outlook].match)} loading={loading} initialSorting={[{ id: 'risk', desc: true }]} empty="No orders here." onRowClick={setDetail} />
        </TabsContent>
        <TabsContent value="yarn">
          <DataTable columns={yarnCols} data={p?.yarnNeeds ?? []} loading={loading} initialSorting={[{ id: 'shortBy', desc: true }]} empty="Open orders need no more yarn." />
        </TabsContent>
      </Tabs>

      {detail && <PlanDialog o={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

// One order's plan: what each stage still has to make and when, then when it is ready against its deadline.
function PlanDialog({ o, onClose }: { o: PlanOrder; onClose: () => void }) {
  const when = (start: string | null, end: string | null) =>
    !start ? 'Not scheduled' : start === end || !end ? formatDayMonth(start) : `${formatDayMonth(start)} – ${formatDayMonth(end)}`

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{o.orderNo}</DialogTitle>
          <DialogDescription>
            {o.buyer.name} · {formatQty(o.qty)} {o.fabricType}
          </DialogDescription>
        </DialogHeader>

        <ol className="divide-y divide-border rounded-lg border border-border text-sm">
          {o.stages.map((st) => (
            <li key={st.stage} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="font-medium">{label(st.stage)}</span>
              {st.remaining > 0 ? (
                <span className="text-right text-xs text-muted-foreground tabular-nums">
                  {formatQty(st.remaining, unitFor(st.stage))} left · {when(st.start, st.end)}
                </span>
              ) : (
                <Pill tone="good">Done</Pill>
              )}
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="font-medium">Ready by</span>
            <span className="text-xs tabular-nums">{o.expectedReady ? formatDate(o.expectedReady) : 'Not scheduled'}</span>
          </li>
          <li className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="font-medium">Deadline</span>
            <span className="text-xs tabular-nums">{formatDate(o.deadline)}</span>
          </li>
        </ol>

        <div className="flex flex-wrap items-center gap-2">
          {o.lateByDays ? <Pill tone="problem">Late {o.lateByDays}d</Pill> : <Pill tone="good">On time</Pill>}
          {o.yarnShortBy > 0 && <Pill tone="watch">Needs {formatQty(o.yarnShortBy, 'kg')} yarn</Pill>}
        </div>
        {o.yarnShortBy > 0 && <p className="text-xs text-muted-foreground">Spinning can't start until the yarn arrives, counted as 7 days from today.</p>}
      </DialogContent>
    </Dialog>
  )
}

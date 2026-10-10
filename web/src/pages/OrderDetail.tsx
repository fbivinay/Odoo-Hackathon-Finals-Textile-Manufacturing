import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, PackageSearch, Phone } from 'lucide-react'
import { useSession } from '@/auth/session'
import { PageHead } from '@/components/PageHead'
import { Pill, StatusPill, label } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, formatDateTime, formatINR, formatMoney, formatQty, unitFor } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import type { Order, OrderCost, Planning, RawMaterial, Stage } from '@/types'

// GET /orders/:id
type Detail = Order & {
  buyer: { id: string; name: string; phone: string | null; email: string | null }
  material: RawMaterial | null
  issues: { id: string; qty: number; cost: number; issuedAt: string; material: Pick<RawMaterial, 'id' | 'category' | 'yarnType' | 'colour' | 'unit'> }[]
  jobs: {
    id: string
    stage: Stage
    shift: string
    status: string
    qtyPlanned: number
    qtyProduced: number
    startedAt: string
    completedAt: string | null
    machine: { code: string; name: string }
    worker: { name: string } | null
  }[]
  rolls: { id: string; rollNo: string; qty: number; status: string; createdAt: string; qcRecords: { result: string; defectType: string | null; checkedAt: string }[] }[]
  dispatches: {
    id: string
    dispatchNo: string
    vehicleNo: string | null
    dispatchedAt: string
    invoice: { invoiceNo: string; amount: number; status: string; issuedAt: string; payments: { amount: number; paidAt: string; method: string | null }[] } | null
  }[]
}

const STAGES: Stage[] = ['SPINNING', 'WEAVING', 'DYEING']
const DAY = 86400000
const n = Number
const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY)
// Stage length: hours under a day, else days.
const took = (a: string, b: string) => {
  const h = Math.round((Date.parse(b) - Date.parse(a)) / 3600000)
  return h < 24 ? `took ${h} hour${h === 1 ? '' : 's'}` : `took ${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? '' : 's'}`
}
const matName = (m: { yarnType: string; colour: string }) => (m.colour ? `${m.yarnType} · ${m.colour}` : m.yarnType)

type Event = { at: string; title: string; note?: string; tone?: 'good' | 'watch' | 'problem' }

export function OrderDetail() {
  const { id } = useParams()
  const { user } = useSession()
  const isOwner = user?.role === 'OWNER'
  const order = useApi<Detail>(`/orders/${id}`)
  const cost = useApi<OrderCost[]>(isOwner ? `/reports/order-costs?id=${id}` : null)
  const plan = useApi<Planning>('/planning/schedule')

  const back = (
    <Link to="/orders" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-brand">
      <ArrowLeft className="size-4" />
      Orders
    </Link>
  )
  if (order.error) return <div className="space-y-4">{back}<p className="text-sm text-problem">{order.error}</p></div>
  if (!order.data)
    return (
      <div className="space-y-4">
        {back}
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )

  const o = order.data
  const c = cost.data?.[0]
  const planned = plan.data?.orders.find((p) => p.id === o.id)
  const qty = n(o.qty)
  const value = qty * n(o.pricePerUnit)

  // Fabric made, checked and sent.
  const produced = sum(o.rolls, (r) => n(r.qty))
  const good = sum(o.rolls.filter((r) => ['PASSED', 'DISPATCHED'].includes(r.status)), (r) => n(r.qty))
  const rejected = o.rolls.filter((r) => r.status === 'REJECTED')
  const rejectedQty = sum(rejected, (r) => n(r.qty))
  const reworked = o.rolls.filter((r) => r.qcRecords.some((q) => q.result === 'REWORK'))
  const dispatchedQty = sum(o.rolls.filter((r) => r.status === 'DISPATCHED'), (r) => n(r.qty))
  const defects = new Map<string, number>()
  for (const r of o.rolls) for (const q of r.qcRecords) if (q.defectType && q.result !== 'PASS') defects.set(q.defectType, (defects.get(q.defectType) ?? 0) + 1)

  // Materials, yarn first.
  const used = new Map<string, { m: Detail['issues'][number]['material']; qty: number; cost: number }>()
  for (const i of o.issues) {
    const e = used.get(i.material.id) ?? { m: i.material, qty: 0, cost: 0 }
    e.qty += n(i.qty)
    e.cost += n(i.cost)
    used.set(i.material.id, e)
  }
  const materials = [...used.values()].sort((a, b) => Number(b.m.category === 'YARN') - Number(a.m.category === 'YARN') || b.cost - a.cost)
  const yarnIssued = o.material ? used.get(o.material.id)?.qty ?? 0 : 0
  const yarnPerMetre = produced > 0 && yarnIssued > 0 ? yarnIssued / produced : null
  const plannedPerMetre = qty > 0 && n(o.yarnRequired) > 0 ? n(o.yarnRequired) / qty : null

  // Money.
  const invoiced = sum(o.dispatches, (d) => n(d.invoice?.amount ?? 0))
  const paid = sum(o.dispatches, (d) => sum(d.invoice?.payments ?? [], (p) => n(p.amount)))

  // The order's life, oldest first.
  const events: Event[] = [{ at: o.createdAt, title: 'Order placed', note: `${formatQty(qty)} of ${o.fabricType}${o.colour ? ` · ${o.colour}` : ''}, due ${formatDate(o.deadline)}` }]
  const yarnIssues = o.issues.filter((i) => i.material.category === 'YARN').sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
  if (yarnIssues.length) events.push({ at: yarnIssues[0].issuedAt, title: 'Yarn issued from store', note: `${formatQty(sum(yarnIssues, (i) => n(i.qty)), 'kg')} in ${yarnIssues.length} lot${yarnIssues.length > 1 ? 's' : ''}` })
  for (const stage of STAGES) {
    const jobs = o.jobs.filter((j) => j.stage === stage)
    if (!jobs.length) continue
    const start = jobs.reduce((m, j) => (j.startedAt < m ? j.startedAt : m), jobs[0].startedAt)
    const running = jobs.some((j) => j.status === 'RUNNING')
    const end = running ? null : jobs.reduce((m, j) => ((j.completedAt ?? '') > m ? j.completedAt ?? '' : m), '')
    const machines = new Set(jobs.map((j) => j.machine.code)).size
    events.push({ at: start, title: `${label(stage)} started`, note: `${jobs.length} shift${jobs.length > 1 ? 's' : ''} on ${machines} machine${machines > 1 ? 's' : ''}` })
    if (end) events.push({ at: end, title: `${label(stage)} finished`, note: took(start, end) })
  }
  const checks = o.rolls.flatMap((r) => r.qcRecords).sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))
  if (checks.length) {
    events.push({ at: checks[0].checkedAt, title: 'Quality check started' })
    events.push({ at: checks[checks.length - 1].checkedAt, title: 'Last roll checked', note: `${o.rolls.length} rolls · ${formatQty(rejectedQty)} rejected`, tone: rejectedQty > 0 ? 'watch' : undefined })
  }
  for (const d of [...o.dispatches].sort((a, b) => a.dispatchedAt.localeCompare(b.dispatchedAt))) {
    events.push({
      at: d.dispatchedAt,
      title: `Dispatched ${d.dispatchNo}`,
      note: [d.vehicleNo, d.invoice && `invoice ${d.invoice.invoiceNo} ${formatINR(n(d.invoice.amount))}`].filter(Boolean).join(' · '),
    })
    for (const p of d.invoice?.payments ?? []) events.push({ at: p.paidAt, title: `Payment received ${formatINR(n(p.amount))}`, note: [d.invoice!.invoiceNo, p.method].filter(Boolean).join(' · '), tone: 'good' })
  }
  events.sort((a, b) => a.at.localeCompare(b.at))
  const lastTruck = o.dispatches.reduce((m, d) => (d.dispatchedAt > m ? d.dispatchedAt : m), '')
  const finished = o.status === 'DISPATCHED' && lastTruck
  const lateBy = finished ? daysBetween(o.deadline, lastTruck) : null

  return (
    <div className="space-y-6">
      {back}
      <PageHead
        eyebrow={`Ordered ${formatDate(o.createdAt)}`}
        title={o.orderNo}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={o.status} />
            {o.isDelayed && <Pill tone="problem">Late</Pill>}
            <Button variant="outline" size="sm" className="gap-1.5" asChild>
              <a href={`/track/${o.trackingToken}`} target="_blank" rel="noreferrer">
                <PackageSearch className="size-4" />
                Buyer tracking page
              </a>
            </Button>
          </div>
        }
      />
      <div className="-mt-3 flex flex-wrap gap-4 text-sm text-ink-2">
        {isOwner ? (
          <Link to={`/clients/${o.buyer.id}`} className="font-medium hover:text-brand">
            {o.buyer.name}
          </Link>
        ) : (
          <span className="font-medium">{o.buyer.name}</span>
        )}
        {o.buyer.phone && (
          <a href={`tel:${o.buyer.phone}`} className="inline-flex items-center gap-1.5 hover:text-brand">
            <Phone className="size-3.5" />
            {o.buyer.phone}
          </a>
        )}
        <span>
          {o.fabricType}
          {o.colour && ` · ${o.colour}`}
          {o.material && ` · ${matName(o.material)} yarn`}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Ordered" value={formatQty(qty)} hint={`${formatINR(n(o.pricePerUnit))}/m`} />
        <KpiCard label="Produced" value={formatQty(produced)} hint={`${o.rolls.length} rolls`} />
        <KpiCard label="Passed QC" tone="good" value={formatQty(good)} hint={produced ? `${Math.round((good / produced) * 100)}% of produced` : 'Nothing checked yet'} />
        <KpiCard label="Dispatched" value={formatQty(dispatchedQty)} hint={`${o.dispatches.length} truck${o.dispatches.length === 1 ? '' : 's'}`} />
        <KpiCard label="Order value" value={formatMoney(value)} hint={invoiced ? `${formatMoney(invoiced)} invoiced` : 'Not invoiced yet'} />
        <KpiCard
          label="Deadline"
          tone={o.isDelayed || (lateBy ?? 0) > 0 ? 'problem' : finished ? 'good' : undefined}
          value={formatDate(o.deadline)}
          hint={
            finished
              ? lateBy! > 0
                ? `Delivered ${lateBy} days late`
                : 'Delivered on time'
              : planned?.expectedReady
                ? `Expected ready ${formatDate(planned.expectedReady)}`
                : o.status === 'CANCELLED'
                  ? 'Cancelled'
                  : 'Not scheduled yet'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="section-head">Yarn and raw materials used</h2>
          {o.material && (
            <p className="text-sm text-ink-2">
              Needs {formatQty(n(o.yarnRequired), o.material.unit)} of {matName(o.material)}
              {o.yarnPerMetre != null && ` (${formatQty(qty)} × ${n(o.yarnPerMetre)} kg/m + ${n(o.wastagePct)}% wastage, from Mill Setup)`}; {formatQty(yarnIssued, o.material.unit)} issued so far.
            </p>
          )}
          {materials.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-medium">Material</th>
                  <th className="py-1.5 text-right font-medium">Used</th>
                  {isOwner && <th className="py-1.5 text-right font-medium">Cost</th>}
                </tr>
              </thead>
              <tbody>
                {materials.map(({ m, qty: q, cost: k }) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="py-1.5">
                      {matName(m)}
                      <span className="ml-1.5 text-xs text-muted-foreground">{label(m.category)}</span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{formatQty(q, m.unit)}</td>
                    {isOwner && <td className="py-1.5 text-right tabular-nums">{formatINR(k)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing issued to this order yet.</p>
          )}
        </section>

        <section className="card space-y-3">
          <h2 className="section-head">Wastage</h2>
          {o.rolls.length ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {o.wastagePct != null && (
                <>
                  <dt className="text-ink-2">Wastage allowed (Mill Setup)</dt>
                  <dd className="text-right tabular-nums">{n(o.wastagePct)}%</dd>
                </>
              )}
              <dt className="text-ink-2">Rejected fabric</dt>
              <dd className={cn('text-right tabular-nums', rejectedQty > 0 && 'font-medium text-problem')}>
                {formatQty(rejectedQty)} · {produced ? ((rejectedQty / produced) * 100).toFixed(1) : 0}%
              </dd>
              <dt className="text-ink-2">Rejected rolls</dt>
              <dd className="text-right tabular-nums">
                {rejected.length} of {o.rolls.length}
              </dd>
              <dt className="text-ink-2">Rolls sent back for rework</dt>
              <dd className="text-right tabular-nums">{reworked.length}</dd>
              {yarnPerMetre !== null && (
                <>
                  <dt className="text-ink-2">Yarn used per metre</dt>
                  <dd className="text-right tabular-nums">
                    {yarnPerMetre.toFixed(3)} kg
                    {plannedPerMetre && <span className="ml-1 text-xs text-muted-foreground">planned {plannedPerMetre.toFixed(3)}</span>}
                  </dd>
                </>
              )}
              {isOwner && c && c.costPerUnit !== null && rejectedQty > 0 && (
                <>
                  <dt className="text-ink-2">Cost of rejected fabric</dt>
                  <dd className="text-right tabular-nums text-problem">{formatINR(rejectedQty * c.costPerUnit)}</dd>
                </>
              )}
              {defects.size > 0 && (
                <>
                  <dt className="text-ink-2">Defects found</dt>
                  <dd className="text-right">{[...defects].map(([d, k]) => `${d} ×${k}`).join(', ')}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No fabric made yet.</p>
          )}
        </section>

        {isOwner && (
          <section className="card space-y-3">
            <h2 className="section-head">Cost and profit</h2>
            {c ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-2">Materials</dt>
                <dd className="text-right tabular-nums">{formatINR(c.materialCost)}</dd>
                <dt className="text-ink-2">Labour</dt>
                <dd className="text-right tabular-nums">{formatINR(c.labourCost)}</dd>
                <dt className="font-medium">Total cost</dt>
                <dd className="text-right font-medium tabular-nums">
                  {formatINR(c.totalCost)}
                  {c.costPerUnit !== null && <span className="ml-1 text-xs font-normal text-muted-foreground">{formatINR(c.costPerUnit)}/m</span>}
                </dd>
                {o.listPrice != null && (
                  <>
                    <dt className="text-ink-2">List price</dt>
                    <dd className="text-right tabular-nums">
                      {formatINR(n(o.listPrice))}/m
                      {n(o.pricePerUnit) !== n(o.listPrice) && <span className="ml-1 text-xs text-muted-foreground">sold at {formatINR(n(o.pricePerUnit))}/m</span>}
                    </dd>
                  </>
                )}
                <dt className="text-ink-2">Order value</dt>
                <dd className="text-right tabular-nums">{formatINR(c.orderValue)}</dd>
                <dt className="text-ink-2">Invoiced</dt>
                <dd className="text-right tabular-nums">{formatINR(c.invoiced)}</dd>
                <dt className="font-medium">{['DISPATCHED', 'READY'].includes(o.status) ? 'Profit' : 'Profit so far'}</dt>
                <dd className={cn('text-right font-medium tabular-nums', c.totalCost === 0 ? '' : c.margin < 0 ? 'text-problem' : 'text-good')}>
                  {c.totalCost === 0 ? '—' : formatINR(c.margin)}
                  {c.totalCost > 0 && c.orderValue > 0 && <span className="ml-1 text-xs text-muted-foreground">{Math.round((c.margin / c.orderValue) * 100)}%</span>}
                </dd>
                <dt className="text-ink-2">Paid by client</dt>
                <dd className="text-right tabular-nums">
                  {formatINR(paid)}
                  {invoiced - paid > 0.5 && <span className="ml-1 text-xs text-problem">{formatINR(invoiced - paid)} still owed</span>}
                </dd>
              </dl>
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </section>
        )}

        <section className={cn('card space-y-3', !isOwner && 'lg:col-span-2')}>
          <h2 className="section-head">History</h2>
          <ol className="relative space-y-3 border-l border-border pl-5">
            {events.map((e, i) => (
              <li key={i} className="relative">
                <span className={cn('absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-brand', e.tone === 'good' && 'bg-good', e.tone === 'watch' && 'bg-watch', e.tone === 'problem' && 'bg-problem')} />
                <p className="text-sm font-medium">{e.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(e.at)}
                  {e.note && ` · ${e.note}`}
                </p>
              </li>
            ))}
            {finished ? (
              <li className="relative">
                <span className={cn('absolute top-1.5 -left-[25px] size-2.5 rounded-full', lateBy! > 0 ? 'bg-problem' : 'bg-good')} />
                <p className="text-sm font-medium">Completed</p>
                <p className="text-xs text-muted-foreground">
                  {daysBetween(o.createdAt, lastTruck)} days from order to last truck · {lateBy! > 0 ? `${lateBy} days after the deadline` : 'within the deadline'}
                </p>
              </li>
            ) : (
              o.status !== 'CANCELLED' && (
                <li className="relative">
                  <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border border-border bg-surface" />
                  <p className="text-sm font-medium text-ink-2">Due {formatDate(o.deadline)}</p>
                  {planned?.expectedReady && <p className="text-xs text-muted-foreground">Plan says ready {formatDate(planned.expectedReady)}</p>}
                </li>
              )
            )}
          </ol>
        </section>
      </div>

      {o.jobs.length > 0 && (
        <section className="space-y-3">
          <h2 className="section-head">Production shifts</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  {['Stage', 'Machine', 'Worker', 'Shift', 'Made', 'Started', 'Finished'].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...o.jobs].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((j) => (
                  <tr key={j.id} className="border-t border-border">
                    <td className="px-3 py-1.5">{label(j.stage)}</td>
                    <td className="px-3 py-1.5">{j.machine.code}</td>
                    <td className="px-3 py-1.5">{j.worker?.name ?? '—'}</td>
                    <td className="px-3 py-1.5">{label(j.shift)}</td>
                    <td className="px-3 py-1.5 tabular-nums">
                      {formatQty(n(j.qtyProduced), unitFor(j.stage))}
                    </td>
                    <td className="px-3 py-1.5">{formatDateTime(j.startedAt)}</td>
                    <td className="px-3 py-1.5">{j.completedAt ? formatDateTime(j.completedAt) : <Pill tone="good">Running</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

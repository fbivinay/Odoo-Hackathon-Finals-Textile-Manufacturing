import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { Figure } from '@/components/Figure'
import { Pill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatMoney, formatQty } from '@/lib/format'
import { describe, STAGE_NAME } from '@/lib/lab'
import { cn } from '@/lib/utils'
import type { Run, Shared } from '@/pages/Lab'

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`
const orders = (n: number) => `${n} order${n === 1 ? '' : 's'}`
const plus = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10)

// One answer first (is it worth it, and why), then three numbers and the orders that move.
export function Results({ run, options, go }: Shared & { run: Run | null }) {
  if (!run) {
    return (
      <div className="mt-4 data-table-wrap p-8 text-center text-sm text-muted-foreground">
        No simulation yet.{' '}
        <button type="button" className="text-brand hover:underline" onClick={() => go('builder')}>
          Build a scenario
        </button>{' '}
        or start from a recommendation.
      </div>
    )
  }
  const { draft, result: r } = run
  const names = {
    machine: (id: string) => options?.machines.find((m) => m.id === id)?.code ?? 'Machine',
    yarn: (id: string) => options?.yarns.find((y) => y.id === id)?.name ?? 'Yarn',
  }
  const m = Object.fromEntries(r.metrics.map((x) => [x.key, x]))
  const late = { now: m.late?.base ?? 0, then: m.late?.alt ?? 0 }
  // Orders already past their deadline are late in every scenario; they are named, not counted as news.
  const past = r.baseline?.pastDeadline ?? 0
  // Already-overdue orders are late in every scenario, so they are left out of the count.
  const newLate = { now: Math.max(0, late.now - past), then: Math.max(0, late.then - past) }
  const book = { now: m.clearBookDays?.base ?? null, then: m.clearBookDays?.alt ?? null }
  const dayDiff = book.now !== null && book.then !== null ? book.then - book.now : 0
  const rush = r.rushOrder
  const busiest = r.baseline?.busiest
  const added = r.changes.addMachines?.map((a) => a.stage) ?? []
  const money = r.money.revenue
  // Machines added away from the stage orders wait on: any "free room" is on paper only, so no money is claimed.
  const offBottleneck = Boolean(busiest && added.length && !added.includes(busiest))
  const spare = offBottleneck ? 0 : money.spareCapacityContribution || 0
  const extra = (rush && money.rushOrderOnTime ? (money.rushContribution ?? 0) : 0) + spare

  const helps = late.then < late.now || dayDiff < 0 || Boolean(rush?.onTime)
  const hurts = late.then > late.now || dayDiff > 0 || Boolean(rush && !rush.onTime)
  const verdict = rush
    ? rush.onTime
      ? late.then > late.now
        ? `You can take it, but ${orders(late.then - late.now)} would turn late`
        : 'You can take this order'
      : 'This order would be late'
    : helps && !hurts
      ? 'Good for deliveries'
      : hurts && !helps
        ? 'Orders will be delayed'
        : helps
          ? 'Mixed result'
          : 'No change for your orders'
  const colour = rush ? (!rush.onTime ? 'problem' : late.then > late.now ? 'watch' : 'good') : helps && !hurts ? 'good' : hurts && !helps ? 'problem' : 'watch'

  // Plain reasons, from the figures only.
  const why: string[] = []
  if (dayDiff) why.push(`All open orders finish ${days(Math.abs(dayDiff))} ${dayDiff < 0 ? 'sooner' : 'later'}: by ${formatDate(plus(r.today, book.then!))} instead of ${formatDate(plus(r.today, book.now!))}.`)
  const sooner = r.orders.filter((o) => (o.daysEarlier ?? 0) > 0).length
  const later = r.orders.filter((o) => (o.daysEarlier ?? 0) < 0).length
  if (sooner || later) why.push([sooner && `${orders(sooner)} ready sooner`, later && `${orders(later)} ready later`].filter(Boolean).join(', ') + '.')
  if (late.then !== late.now) why.push(`${orders(Math.abs(late.then - late.now))} ${late.then < late.now ? 'fewer' : 'more'} will miss the deadline (${late.now} → ${late.then}).`)
  if (rush?.onTime && late.then <= late.now) why.push('No other order misses its deadline.')
  if (rush && !rush.onTime) why.push(rush.lateByDays ? `It would be ready ${days(rush.lateByDays)} after its deadline.` : 'The mill cannot fit it in the plan.')
  if (!helps && offBottleneck && busiest)
    why.push(
      `More ${added.map((s) => STAGE_NAME[s].toLowerCase()).join(' and ')} does not speed anything up: orders are waiting on ${STAGE_NAME[busiest].toLowerCase()}, which is full. Try adding a ${STAGE_NAME[busiest].toLowerCase()} machine instead.`,
    )
  if (spare > 0) why.push(`It frees room for about ${formatQty(Math.round(money.spareCapacityMetres), 'm')} more fabric in ${r.days} days, worth ${formatMoney(money.spareCapacityContribution)} if new orders fill it.`)
  if (r.changes.materials?.length && !why.length) why.push('Every open order already has the yarn it needs, so a late delivery holds nothing up.')
  if (!why.length) why.push('Every open order keeps its date.')

  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{draft.name || 'Scenario'}</h2>
          <p className="text-sm text-muted-foreground">{[...describe(r.changes, names).filter((d) => !draft.name.includes(d)), `next ${r.days} days`].join(' · ')}</p>
        </div>
        <SaveButton run={run} />
      </div>

      <section className={cn('rounded-2xl border-2 p-5', colour === 'good' ? 'border-good/50 bg-good/5' : colour === 'problem' ? 'border-problem/50 bg-problem/5' : 'border-watch/50 bg-watch/5')}>
        <p className={cn('text-2xl font-bold', colour === 'good' ? 'text-good' : colour === 'problem' ? 'text-problem' : 'text-watch')}>{verdict}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[15.5px] marker:text-ink-2">
          {why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </section>

      <section className="figures-panel">
        <div className="grid gap-4 sm:grid-cols-3">
          <Figure
            label="Orders that will be late"
            value={String(newLate.then)}
            note={[newLate.then === newLate.now ? 'Same as now' : `Now: ${newLate.now}`, past && `not counting ${orders(past)} already overdue`].filter(Boolean).join(', ')}
            tone={newLate.then < newLate.now ? 'good' : newLate.then > newLate.now ? 'problem' : undefined}
          />
          <Figure
            label="All orders finished by"
            value={book.then === null ? 'Not possible' : formatDate(plus(r.today, book.then))}
            note={!dayDiff ? 'Same as now' : `${days(Math.abs(dayDiff))} ${dayDiff < 0 ? 'earlier' : 'later'} than now`}
            tone={dayDiff < 0 ? 'good' : dayDiff > 0 ? 'problem' : undefined}
          />
          {rush ? (
            <Figure
              label="Rush order ready on"
              value={rush.expectedReady ? formatDate(rush.expectedReady) : 'Not possible'}
              note={[
                rush.expectedReady && (rush.onTime ? `${days(Math.round((Date.parse(rush.deadline) - Date.parse(rush.expectedReady)) / 86400000))} before its deadline` : `${days(rush.lateByDays ?? 0)} after its deadline`),
                extra > 0 && `earns ${formatMoney(extra)}`,
              ].filter(Boolean).join(', ')}
              tone={rush.onTime ? 'good' : 'problem'}
            />
          ) : extra > 0 ? (
            <Figure label="Extra money" value={formatMoney(extra)} note="If new orders fill the free machine time" tone="good" />
          ) : (
            <Figure label="Orders that move" value={String(sooner + later)} note={sooner || later ? [sooner && `${sooner} earlier`, later && `${later} later`].filter(Boolean).join(', ') : 'Every date stays the same'} tone={sooner && !later ? 'good' : later && !sooner ? 'problem' : undefined} />
          )}
        </div>
      </section>

      <ChangedOrders list={r.orders} />
    </div>
  )
}

// Orders whose ready date moves: the first six, the rest one click away.
function ChangedOrders({ list }: { list: Run['result']['orders'] }) {
  const [all, setAll] = useState(false)
  if (!list.length) return null
  const shown = all ? list : list.slice(0, 6)
  return (
    <section className="data-table-wrap space-y-2 p-4">
      <h2 className="section-head">Orders that move ({list.length})</h2>
      <table className="w-full text-sm">
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            <th className="py-1.5 text-left font-medium">Order</th>
            <th className="py-1.5 text-left font-medium">Deadline</th>
            <th className="py-1.5 text-left font-medium">Ready</th>
            <th className="py-1.5 text-right font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((o) => (
            <tr key={o.id} className="border-b last:border-0">
              <td className="py-2">
                <Link to={`/orders/${o.id}`} className="font-medium text-brand hover:underline">
                  {o.orderNo}
                </Link>
                <span className="block text-xs text-muted-foreground">{o.buyer}</span>
              </td>
              <td className="py-2">{formatDate(o.deadline)}</td>
              <td className="py-2">
                {o.before ? formatDate(o.before) : 'Not planned'} → <b>{o.after ? formatDate(o.after) : 'Not planned'}</b>
              </td>
              <td className="py-2 text-right">
                {(o.lateBefore ?? 0) > 0 && !o.lateAfter ? (
                  <Pill tone="good">Now on time</Pill>
                ) : !o.lateBefore && (o.lateAfter ?? 0) > 0 ? (
                  <Pill tone="problem">Now late</Pill>
                ) : (
                  <span className={(o.daysEarlier ?? 0) > 0 ? 'text-good' : 'text-problem'}>
                    {o.daysEarlier === null ? '—' : `${days(Math.abs(o.daysEarlier))} ${o.daysEarlier > 0 ? 'sooner' : 'later'}`}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length > 6 && (
        <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${list.length} orders`}
        </Button>
      )}
    </section>
  )
}

function SaveButton({ run }: { run: Run }) {
  const [name, setName] = useState(run.draft.name)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      await api('/lab/scenarios', { method: 'POST', body: { name, changes: run.result.changes, costs: run.result.costs, days: run.result.days } })
      toast.success('Scenario saved. Find it under Saved scenarios.')
      setOpen(false)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }
  if (!open)
    return (
      <Button className="gap-1.5" onClick={() => setOpen(true)}>
        <Save className="size-4" />
        Save
      </Button>
    )
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <Input aria-label="Scenario name" className="w-56" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus />
      <Button type="submit" disabled={busy || !name.trim()}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDown, ArrowUp, Save, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { selectClass } from '@/components/Field'
import { Pill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatDateTime, formatDayMonth, formatMoney } from '@/lib/format'
import { describe, show, STAGE_NAME, STAGES, type Explanation, type Metric, type Money, type Stage } from '@/lib/lab'
import { cn } from '@/lib/utils'
import type { Run, Shared } from '@/pages/Lab'
import { Section } from './parts'

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
  const busiest = r.baseline?.busiest
  const names = {
    machine: (id: string) => options?.machines.find((m) => m.id === id)?.code ?? 'Machine',
    yarn: (id: string) => options?.yarns.find((y) => y.id === id)?.name ?? 'Yarn',
  }
  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{draft.name}</h2>
          <p className="text-sm text-muted-foreground">{describe(r.changes, names).join(' · ')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Next {r.days} days from {formatDate(r.today)} · data read {formatDateTime(r.snapshotAt)} · baseline and scenario planned from the same data
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SaveButton run={run} />
        </div>
      </div>

      <Section title="Baseline vs scenario" tag="estimate">
        <MetricsTable metrics={r.metrics} />
      </Section>

      <MoneyBlock m={r.money} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Stage capacity" tag="estimate">
          <table className="w-full text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-medium">Stage</th>
                <th className="py-1 text-right font-medium">Machines</th>
                <th className="py-1 text-right font-medium">Per day, today</th>
                <th className="py-1 text-right font-medium">Per day, scenario</th>
              </tr>
            </thead>
            <tbody>
              {STAGES.map((s) => (
                <tr key={s} className="border-b last:border-0">
                  <td className="py-1.5">
                    {STAGE_NAME[s]}
                    {busiest === s && <Pill tone="watch" className="ml-2">busiest now</Pill>}
                    {r.scenario?.busiest === s && busiest !== s && <Pill tone="watch" className="ml-2">busiest after</Pill>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {r.capacity.base[s].machines} → {r.capacity.scenario[s].machines}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{show(r.capacity.base[s].perDay, r.capacity.base[s].unit)}</td>
                  <td className="py-1.5 text-right tabular-nums">{show(r.capacity.scenario[s].perDay, r.capacity.scenario[s].unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            {busiest && <>“Busiest” is the stage the open orders are waiting on over the next 4 weeks ({STAGE_NAME[busiest]}, {r.baseline.stages[busiest]?.utilisation}% booked). </>}On paper, with every machine running, the mill can finish at most {show(r.capacity.chain.base.perDay, 'm')} a day today and {show(r.capacity.chain.scenario.perDay, 'm')} in the scenario, limited by {STAGE_NAME[r.capacity.chain.scenario.bottleneck].toLowerCase()}.
          </p>
        </Section>
        <WeeklyChart weekly={r.weekly} start={r.scenario?.busiest ?? 'DYEING'} />
      </div>

      {(r.orders.length > 0 || r.rushOrder) && (
      <Section title={`Orders with a new ready date (${r.orders.length})`} tag="estimate">
        {r.rushOrder && (
          <p className={cn('text-sm', r.rushOrder.onTime ? 'text-good' : 'text-problem')}>
            Rush order: ready {r.rushOrder.expectedReady ? formatDate(r.rushOrder.expectedReady) : 'not within the plan'} for a {formatDate(r.rushOrder.deadline)} deadline
            {r.rushOrder.lateByDays ? ` — ${r.rushOrder.lateByDays} days late` : ' — on time'}.
          </p>
        )}
        <OrdersTable orders={r.orders} />
      </Section>
      )}

      {JSON.stringify(r.yarn.base) !== JSON.stringify(r.yarn.scenario) && (
        <Section title="Yarn short for planned orders" tag="estimate">
          <div className="grid gap-4 sm:grid-cols-2 text-sm">
            {(['base', 'scenario'] as const).map((k) => (
              <div key={k}>
                <p className="mb-1 text-xs font-medium text-muted-foreground">{k === 'base' ? 'Today' : 'Scenario'}</p>
                {r.yarn[k].length === 0 ? (
                  <p className="text-muted-foreground">Nothing short.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {r.yarn[k].map((y) => (
                      <li key={y.id} className="flex justify-between gap-2">
                        <span>{y.yarnType} · {y.colour}</span>
                        <span className="tabular-nums">{show(y.shortBy, y.unit)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Explain run={run} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Assumptions" tag="assumption">
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {r.money.assumptions.length ? r.money.assumptions.map((a) => <li key={a}>{a}</li>) : <li>No cost assumptions in this scenario.</li>}
            <li>
              Unit economics from the books, {formatDate(r.money.basis.from)} to {formatDate(r.money.basis.to)}: {show(r.money.basis.metresShipped, 'm')} shipped,{' '}
              {r.money.basis.contributionPerMetre === null ? 'no contribution per metre (no shipments)' : `${formatMoney(r.money.basis.contributionPerMetre)} contribution per metre after materials and freight`}.
            </li>
          </ul>
        </Section>
        <Section title="Limits of this model">
          <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
            {r.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  )
}

// Only what the change moves; the rest is named in one line so nothing is hidden.
export function MetricsTable({ metrics }: { metrics: Metric[] }) {
  const moved = metrics.filter((m) => m.change !== null && m.change !== 0)
  const same = metrics.filter((m) => !moved.includes(m))
  return (
    <div className="space-y-3">
      {moved.length === 0 ? (
        <p className="text-sm text-muted-foreground">This change does not move any measure in the period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-medium">Measure</th>
                <th className="py-1 text-right font-medium">Today’s plan</th>
                <th className="py-1 text-right font-medium">Scenario</th>
                <th className="py-1 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {moved.map((m) => (
                <tr key={m.key} className="border-b last:border-0">
                  <td className="py-1.5">{m.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{show(m.base, m.unit)}</td>
                  <td className="py-1.5 text-right font-medium tabular-nums">{show(m.alt, m.unit)}</td>
                  <td className={cn('py-1.5 text-right tabular-nums', m.effect === 'good' && 'text-good', m.effect === 'bad' && 'text-problem')}>
                    <span className="inline-flex items-center gap-1">
                      {m.change! > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
                      {`${m.change! > 0 ? '+' : ''}${show(m.change, m.unit)}${m.changePct !== null && m.unit !== '%' ? ` (${m.changePct > 0 ? '+' : ''}${m.changePct}%)` : ''}`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {same.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{same.length} measures stay the same</summary>
          <ul className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
            {same.map((m) => (
              <li key={m.key} className="flex justify-between gap-3">
                <span>{m.label}</span>
                <span className="tabular-nums">{show(m.base, m.unit)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

type Line = [string, number | null, string?]

// Only lines with a figure. A cost the owner did not enter is listed as missing above.
function MoneyBlock({ m }: { m: Money }) {
  const lines = (rows: Line[]) => rows.filter(([, v]) => v !== null && v !== 0)
  const oneTime = lines([
    ['Machines, installed', m.oneTime.machines],
    ['Repair', m.oneTime.repair],
    ['Extra yarn bought', m.materialPurchase || null, 'Cash into stock, not a cost until used'],
  ])
  const running = lines([
    ['Power', m.recurring.power],
    ['Operators', m.recurring.labour],
    ['Maintenance', m.recurring.maintenance],
    ['Sunday working', m.recurring.sundayWork],
    ['Logistics change', m.recurring.logistics, 'Negative = saving'],
    ['Extra material for rejects', m.recurring.extraMaterial],
  ])
  const revenue = lines([
    ['Existing orders ready inside the period', m.revenue.pulledIntoPeriod, 'Timing only: the same orders, sooner or later'],
    [
      m.revenue.rushOrderOnTime ? 'Rush order' : 'Rush order (would be late, not counted)',
      m.revenue.rushOrderValue,
      m.revenue.rushContribution === null ? undefined : `Earns ${formatMoney(m.revenue.rushContribution)} after its ${m.revenue.rushYarnKg} kg of yarn, dyes and freight`,
    ],
    ['Extra capacity, if new orders fill it', m.revenue.spareCapacityContribution, `${show(m.revenue.spareCapacityMetres, 'm')} more fabric × contribution per metre. Not confirmed.`],
  ])
  const col = (title: string, rows: Line[], total?: number) =>
    rows.length > 0 && (
      <div className="divide-y divide-border">
        <p className="pb-1 text-xs font-medium text-muted-foreground">{title}</p>
        {rows.map(([label, v, note]) => (
          <div key={label} className="flex justify-between gap-3 py-1">
            <span>
              {label}
              {note && <span className="block text-xs text-muted-foreground">{note}</span>}
            </span>
            <span className="tabular-nums">{formatMoney(v!)}</span>
          </div>
        ))}
        {total !== undefined && rows.length > 1 && (
          <div className="flex justify-between gap-3 py-1 font-medium">
            <span>Total</span>
            <span className="tabular-nums">{formatMoney(total)}</span>
          </div>
        )}
      </div>
    )
  const nothing = !oneTime.length && !running.length && !revenue.length
  const sameProfit = m.profit.confirmed === m.profit.ifCapacitySold
  const cards = sameProfit ? (['confirmed'] as const) : (['confirmed', 'ifCapacitySold'] as const)
  return (
    <Section title={`Money over the next ${m.days} days`} tag="estimate">
      {!m.complete && (
        <p className="rounded-lg border border-watch/40 bg-watch/5 p-2 text-sm text-watch">Not entered: {m.missing.join(', ')}. Those costs are left out, so profit and payback are incomplete.</p>
      )}
      {nothing ? (
        <p className="text-sm text-muted-foreground">No money moves in this scenario: no spend, no running cost and no new revenue in the period.</p>
      ) : (
        <>
          <div className="grid gap-6 text-sm md:grid-cols-3">
            {col('One-time spend', oneTime, m.oneTimeTotal)}
            {col('Running costs in the period', running, m.recurringTotal)}
            {col('Revenue', revenue)}
          </div>
          <div className={cn('grid gap-3', !sameProfit && 'sm:grid-cols-2')}>
            {cards.map((k) => (
              <div key={k} className={cn('rounded-lg border p-3', k === 'confirmed' ? 'border-border' : 'border-dashed border-border')}>
                <p className="text-xs font-medium text-muted-foreground">{k === 'confirmed' ? 'Change in operating profit' : 'If the extra capacity is sold'}</p>
                <p className={cn('text-2xl font-semibold tabular-nums', m.profit[k] < 0 ? 'text-problem' : 'text-good')}>{formatMoney(m.profit[k])}</p>
                <p className="text-xs text-muted-foreground">
                  {k === 'confirmed'
                    ? m.revenue.rushOrderValue !== null
                      ? 'The rush order’s earnings (if on time) minus running costs.'
                      : 'Running costs and savings only: finishing the same orders sooner brings no new sales by itself.'
                    : 'Adds the extra-capacity contribution; needs new orders.'}
                  {m.oneTimeTotal > 0 && ` Payback: ${m.paybackMonths[k] === null ? 'not reached at this rate' : `${m.paybackMonths[k]} months`}.`}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  )
}

function WeeklyChart({ weekly, start }: { weekly: Run['result']['weekly']; start: Stage }) {
  // Opens on the stage that changes most, else the busiest one.
  const moved = STAGES.map((st) => ({ st, d: weekly.reduce((t, w) => t + Math.abs(Number(w[`${st}_alt`] ?? 0) - Number(w[`${st}_base`] ?? 0)), 0) })).sort((a, b) => b.d - a.d)[0]
  const [stage, setStage] = useState<Stage>(moved.d > 0 ? moved.st : start)
  // Weeks after the open orders are done are empty on both sides; leave them off.
  const last = weekly.reduce((n, w, i) => (STAGES.some((st) => Number(w[`${st}_base`]) > 0 || Number(w[`${st}_alt`]) > 0) ? i : n), 0)
  const busyWeeks = weekly.slice(0, last + 1)
  return (
    <Section
      title="How busy each week is"
      tag="estimate"
      actions={
        <select aria-label="Stage" className={cn(selectClass, 'w-36 bg-surface')} value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_NAME[s]}
            </option>
          ))}
        </select>
      }
    >
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={busyWeeks} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} stroke="#e3e3e6" />
            <XAxis dataKey="weekStart" tickLine={false} axisLine={false} fontSize={12} tickFormatter={(d) => formatDayMonth(String(d))} minTickGap={24} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} width={40} unit="%" domain={[0, 100]} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e3e3e6', fontSize: 12 }} labelFormatter={(d) => `Week of ${formatDate(String(d))}`} formatter={(v) => [`${v}%`]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="stepAfter" dataKey={`${stage}_base`} name="Today’s plan" stroke="#9a9aa0" strokeWidth={2} dot={false} />
            <Line type="stepAfter" dataKey={`${stage}_alt`} name="Scenario" stroke="#714b67" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">Share of the stage’s capacity booked by open orders each week. Work is planned earliest deadline first, so near weeks fill up first.</p>
    </Section>
  )
}

function OrdersTable({ orders }: { orders: Run['result']['orders'] }) {
  const [all, setAll] = useState(false)
  if (orders.length === 0) return <p className="text-sm text-muted-foreground">No open order changes its ready date.</p>
  const shown = all ? orders : orders.slice(0, 10)
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-medium">Order</th>
              <th className="py-1 text-left font-medium">Deadline</th>
              <th className="py-1 text-right font-medium">Ready today’s plan</th>
              <th className="py-1 text-right font-medium">Ready scenario</th>
              <th className="py-1 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.id} className="border-b last:border-0">
                <td className="py-1.5">
                  <Link to={`/orders/${o.id}`} className="text-brand hover:underline">
                    {o.orderNo}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{o.buyer}</span>
                </td>
                <td className="py-1.5 text-xs">{formatDate(o.deadline)}</td>
                <td className="py-1.5 text-right text-xs">{o.before ? formatDate(o.before) : 'Not planned'}</td>
                <td className="py-1.5 text-right text-xs">{o.after ? formatDate(o.after) : 'Not planned'}</td>
                <td className={cn('py-1.5 text-right tabular-nums', (o.daysEarlier ?? 0) > 0 ? 'text-good' : 'text-problem')}>
                  {o.daysEarlier === null ? '—' : o.daysEarlier > 0 ? `${o.daysEarlier} days sooner` : `${-o.daysEarlier} days later`}
                  {(o.lateBefore ?? 0) > 0 && !o.lateAfter && <Pill tone="good" className="ml-2">now on time</Pill>}
                  {!o.lateBefore && (o.lateAfter ?? 0) > 0 && <Pill tone="problem" className="ml-2">now late</Pill>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {orders.length > 10 && (
        <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${orders.length}`}
        </Button>
      )}
    </>
  )
}

function Explain({ run }: { run: Run }) {
  const [busy, setBusy] = useState(false)
  const [ex, setEx] = useState<Explanation | null>(null)
  async function load() {
    setBusy(true)
    try {
      const { changes, costs, days } = run.result
      setEx(await api<Explanation>('/lab/explain', { method: 'POST', body: { changes, costs, days }, quiet: true }))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not explain the result.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section
      title="What this means"
      tag={ex ? (ex.source === 'gemini' ? 'ai' : 'rules') : undefined}
      actions={
        <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={load}>
          <Sparkles className="size-4" />
          {busy ? 'Explaining…' : ex ? 'Explain again' : 'Explain the result'}
        </Button>
      }
    >
      {!ex ? (
        <p className="text-sm text-muted-foreground">Explains the calculated figures above in plain words. It never adds numbers of its own.</p>
      ) : (
        <>
          {ex.source === 'rules' && <p className="text-xs text-muted-foreground">Written by fixed rules{ex.reason ? ` (AI not available: ${ex.reason})` : ''}.</p>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ex.sections.map((s) => (
              <div key={s.title}>
                <p className="text-xs font-medium text-muted-foreground">{s.title}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
                  {s.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
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


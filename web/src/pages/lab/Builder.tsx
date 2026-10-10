import { useState, type ReactNode } from 'react'
import { Play, Plus, Trash2 } from 'lucide-react'
import { Field, selectClass } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api, ApiError } from '@/lib/api'
import { formatINR, formatQty } from '@/lib/format'
import { describe, emptyDraft, HORIZONS, STAGE_NAME, STAGES, type Changes, type Costs, type LabResult, type Stage } from '@/lib/lab'
import { cn } from '@/lib/utils'
import type { Run, Shared } from '@/pages/Lab'
import { Section } from './parts'

const KINDS = [
  ['addMachines', 'A. Add machines', 'More capacity at a stage'],
  ['breakdowns', 'B. Machine breakdown', 'A machine out for some days'],
  ['sundays', 'C. Extra shift', 'Work Sundays (the mill already runs 3 shifts)'],
  ['materials', 'D. Yarn shortage or delay', 'Less stock or a late supplier'],
  ['rushOrder', 'E. Rush order', 'A new order with a tight deadline'],
  ['qc', 'F. Quality and waste', 'A different reject rate'],
  ['logistics', 'G. Logistics', 'Freight cost per metre up or down'],
] as const
type Kind = (typeof KINDS)[number][0]

const n = (v: string) => (v === '' ? undefined : Number(v))
const val = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? '' : String(v))

// Build a what-if from any mix of changes (H. custom = more than one ticked). Beside every input
// sits today's figure, so the change is always read against the real mill.
export function Builder({ options, optionsError, draft, setDraft, onResult }: Shared & { onResult: (run: Run) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const c = draft.changes
  const setChanges = (next: Changes) => setDraft({ ...draft, changes: next })
  const setCosts = (next: Costs) => setDraft({ ...draft, costs: next })
  const on = (k: Kind) => (k === 'sundays' ? Boolean(c.sundays) : c[k] !== undefined)

  function toggle(k: Kind) {
    if (on(k)) {
      const next = { ...c }
      delete next[k]
      return setChanges(next)
    }
    const today = options?.today ?? new Date().toISOString().slice(0, 10)
    const defaults: Changes = {
      addMachines: [{ stage: 'WEAVING', count: 1, fromDay: 0, rampDays: 0 }],
      breakdowns: [{ machineId: options?.machines[0]?.id ?? '', days: 7 }],
      sundays: true,
      materials: [{ materialId: options?.yarns[0]?.id ?? '', stockChange: 0, extraLeadDays: 7 }],
      rushOrder: { fabricType: options?.fabrics[0]?.fabricType ?? '', qty: 10000, deadline: new Date(Date.parse(today) + 30 * 86400000).toISOString().slice(0, 10) },
      qc: { rejectPct: options?.rejectRatePct ?? 5 },
      logistics: { costPerMetreChangePct: -10 },
    }
    setChanges({ ...c, [k]: defaults[k] })
  }

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const result = await api<LabResult>('/lab/simulate', { method: 'POST', body: { changes: c, costs: draft.costs, days: draft.days }, quiet: true })
      const name = draft.name.trim() || describe(c, names).join(' + ') || 'Scenario'
      onResult({ draft: { ...draft, name }, result })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The simulation could not run. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (optionsError) return <p className="mt-4 text-sm text-problem">{optionsError}</p>
  if (!options) return <Skeleton className="mt-4 h-96 w-full" />
  const names = {
    machine: (id: string) => options.machines.find((m) => m.id === id)?.code ?? 'Machine',
    yarn: (id: string) => options.yarns.find((y) => y.id === id)?.name ?? 'Yarn',
  }
  const stageOf = (s: Stage) => options.stages.find((x) => x.stage === s)!
  const anything = KINDS.some(([k]) => on(k))
  const needsCosts = Boolean(c.addMachines?.length)

  return (
    <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <Section title="What do you want to test?">
          <div className="grid gap-2 sm:grid-cols-2">
            {KINDS.map(([k, label, hint]) => (
              <label key={k} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition', on(k) ? 'border-brand bg-brand/5' : 'border-border hover:bg-zinc-50')}>
                <input type="checkbox" className="mt-0.5 accent-[var(--brand)]" checked={on(k)} onChange={() => toggle(k)} />
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Tick more than one to test them together (H. custom scenario).</p>
        </Section>

        {c.addMachines && (
          <Section title="A. Add machines" tag="assumption">
            {c.addMachines.map((a, i) => {
              const s = stageOf(a.stage)
              const set = (patch: Partial<typeof a>) => setChanges({ ...c, addMachines: c.addMachines!.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
              return (
                <div key={i} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3">
                  <Field label="Stage" htmlFor={`am-stage-${i}`} hint={`Today: ${s.machines} machines, about ${formatQty(s.avgPerDay, s.unit)}/day each`}>
                    <select id={`am-stage-${i}`} className={selectClass} value={a.stage} onChange={(e) => set({ stage: e.target.value as Stage })}>
                      {STAGES.map((st) => (
                        <option key={st} value={st}>
                          {STAGE_NAME[st]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="How many" htmlFor={`am-count-${i}`} hint="1 to 3">
                    <select id={`am-count-${i}`} className={selectClass} value={a.count} onChange={(e) => set({ count: +e.target.value })}>
                      {[1, 2, 3].map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={`Output per shift (${s.unit})`} htmlFor={`am-rate-${i}`} hint={`Blank = stage average ${formatQty(s.avgPerDay / 3, s.unit)}`}>
                    <Input id={`am-rate-${i}`} type="number" min={1} value={val(a.perShift)} onChange={(e) => set({ perShift: n(e.target.value) })} />
                  </Field>
                  <Field label="Starts on day" htmlFor={`am-from-${i}`} hint="0 = today (installation time)">
                    <Input id={`am-from-${i}`} type="number" min={0} max={180} value={val(a.fromDay)} onChange={(e) => set({ fromDay: n(e.target.value) })} />
                  </Field>
                  <Field label="Ramp-up days" htmlFor={`am-ramp-${i}`} hint="Days to reach full output">
                    <Input id={`am-ramp-${i}`} type="number" min={0} max={60} value={val(a.rampDays)} onChange={(e) => set({ rampDays: n(e.target.value) })} />
                  </Field>
                  <div className="flex items-end justify-end">
                    {c.addMachines!.length > 1 && (
                      <Button variant="ghost" size="sm" className="gap-1 text-problem" onClick={() => setChanges({ ...c, addMachines: c.addMachines!.filter((_, j) => j !== i) })}>
                        <Trash2 className="size-4" /> Remove
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
            {c.addMachines.length < 3 && (
              <Button variant="outline" size="sm" className="gap-1" onClick={() => setChanges({ ...c, addMachines: [...c.addMachines!, { stage: 'DYEING', count: 1, fromDay: 0, rampDays: 0 }] })}>
                <Plus className="size-4" /> Another stage
              </Button>
            )}
          </Section>
        )}

        {c.breakdowns && (
          <Section title="B. Machine breakdown" tag="assumption">
            {c.breakdowns.map((b, i) => {
              const m = options.machines.find((x) => x.id === b.machineId)
              const set = (patch: Partial<typeof b>) => setChanges({ ...c, breakdowns: c.breakdowns!.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
              return (
                <div key={i} className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
                  <Field label="Machine" htmlFor={`bd-m-${i}`} hint={m ? `Today: ${m.status.toLowerCase()}, about ${formatQty(m.perDay, m.stage === 'SPINNING' ? 'kg' : 'm')}/day` : undefined}>
                    <select id={`bd-m-${i}`} className={selectClass} value={b.machineId} onChange={(e) => set({ machineId: e.target.value })}>
                      {options.machines.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.code} · {STAGE_NAME[x.stage]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Down for (days)" htmlFor={`bd-d-${i}`} hint="1 to 90">
                    <Input id={`bd-d-${i}`} type="number" min={1} max={90} value={val(b.days)} onChange={(e) => set({ days: n(e.target.value) ?? 0 })} />
                  </Field>
                  <div className="flex items-end">
                    {c.breakdowns!.length > 1 && (
                      <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setChanges({ ...c, breakdowns: c.breakdowns!.filter((_, j) => j !== i) })}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setChanges({ ...c, breakdowns: [...c.breakdowns!, { machineId: options.machines[0].id, days: 7 }] })}>
              <Plus className="size-4" /> Another machine
            </Button>
          </Section>
        )}

        {c.sundays && (
          <Section title="C. Work Sundays" tag="assumption">
            <p className="text-sm text-muted-foreground">
              The mill already runs three 8-hour shifts, six days a week, so Sundays are the only extra time. Every stage works them; all {options.economics.workers} floor workers come in.
            </p>
          </Section>
        )}

        {c.materials && (
          <Section title="D. Yarn shortage or supplier delay" tag="assumption">
            <p className="text-xs text-muted-foreground">Only yarn is tied to each order’s schedule; chemicals and packaging don’t move dates in the plan.</p>
            {c.materials.map((m, i) => {
              const y = options.yarns.find((x) => x.id === m.materialId)
              const set = (patch: Partial<typeof m>) => setChanges({ ...c, materials: c.materials!.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
              return (
                <div key={i} className="grid gap-3 sm:grid-cols-3">
                  <Field label="Yarn" htmlFor={`ym-${i}`} hint={y ? `Today: ${formatQty(y.inStock, y.unit)} in stock, delivery ${y.leadDays} days` : undefined}>
                    <select id={`ym-${i}`} className={selectClass} value={m.materialId} onChange={(e) => set({ materialId: e.target.value })}>
                      {options.yarns.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={`Stock change (${y?.unit ?? 'kg'})`} htmlFor={`ys-${i}`} hint={y ? `Minus = lost or short; lowest −${y.inStock}` : undefined}>
                    <Input id={`ys-${i}`} type="number" min={y ? -y.inStock : undefined} value={val(m.stockChange)} onChange={(e) => set({ stockChange: n(e.target.value) })} />
                  </Field>
                  <Field label="Delivery late by (days)" htmlFor={`yd-${i}`} hint="0 to 90">
                    <Input id={`yd-${i}`} type="number" min={0} max={90} value={val(m.extraLeadDays)} onChange={(e) => set({ extraLeadDays: n(e.target.value) })} />
                  </Field>
                </div>
              )
            })}
          </Section>
        )}

        {c.rushOrder && (
          <Section title="E. Rush order" tag="assumption">
            {(() => {
              const r = c.rushOrder!
              const f = options.fabrics.find((x) => x.fabricType === r.fabricType)
              const set = (patch: Partial<typeof r>) => setChanges({ ...c, rushOrder: { ...r, ...patch } })
              return (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Fabric" htmlFor="ro-f" hint={f ? `Mill Setup: ${formatINR(f.pricePerMetre)}/m, ${f.yarnPerMetre} kg yarn per metre` : undefined}>
                    <select id="ro-f" className={selectClass} value={r.fabricType} onChange={(e) => set({ fabricType: e.target.value })}>
                      {options.fabrics.map((x) => (
                        <option key={x.fabricType} value={x.fabricType}>
                          {x.fabricType}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Metres" htmlFor="ro-q" hint="1 to 2,00,000">
                    <Input id="ro-q" type="number" min={1} max={200000} value={val(r.qty)} onChange={(e) => set({ qty: n(e.target.value) ?? 0 })} />
                  </Field>
                  <Field label="Deadline" htmlFor="ro-d">
                    <Input id="ro-d" type="date" min={options.today} value={r.deadline} onChange={(e) => set({ deadline: e.target.value })} />
                  </Field>
                  <Field label="Price per metre (₹)" htmlFor="ro-p" hint="Blank = Mill Setup price with its order rules">
                    <Input id="ro-p" type="number" min={1} value={val(r.pricePerUnit)} onChange={(e) => set({ pricePerUnit: n(e.target.value) })} />
                  </Field>
                </div>
              )
            })()}
          </Section>
        )}

        {c.qc && (
          <Section title="F. Quality and waste" tag="assumption">
            <Field label="Reject rate (%)" htmlFor="qc-r" hint={`Today: ${options.rejectRatePct}% of checked rolls rejected (last 90 days). Higher means every stage makes more to deliver the same good fabric.`}>
              <Input id="qc-r" type="number" min={0} max={50} step={0.1} className="w-40" value={val(c.qc.rejectPct)} onChange={(e) => setChanges({ ...c, qc: { rejectPct: n(e.target.value) ?? 0 } })} />
            </Field>
          </Section>
        )}

        {c.logistics && (
          <Section title="G. Logistics" tag="assumption">
            <Field
              label="Change in freight cost per metre (%)"
              htmlFor="lg"
              hint={`Today: ${options.economics.logisticsPerMetre !== null ? `${formatINR(options.economics.logisticsPerMetre)} per metre shipped (last 12 months)` : 'not enough shipments to work it out'}. Truck capacity is not modelled, so only cost changes.`}
            >
              <Input id="lg" type="number" min={-50} max={200} className="w-40" value={val(c.logistics.costPerMetreChangePct)} onChange={(e) => setChanges({ ...c, logistics: { costPerMetreChangePct: n(e.target.value) ?? 0 } })} />
            </Field>
          </Section>
        )}

        {anything && (
          <Section title="Costs" tag="assumption">
            <p className="text-xs text-muted-foreground">
              The records hold no machine prices, power ratings or staffing per machine. Enter your own figures; anything left blank is shown as missing, never guessed.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {needsCosts && (
                <>
                  <CostInput label="Machine price, installed (₹ each)" k="machineCost" costs={draft.costs} set={setCosts} required />
                  <CostInput label="Power per machine (kW)" k="powerKw" costs={draft.costs} set={setCosts} required />
                  <CostInput label="Electricity rate (₹/kWh)" k="tariff" costs={draft.costs} set={setCosts} required />
                  <CostInput label="Staff per machine per shift" k="staffPerShift" costs={draft.costs} set={setCosts} required hint={`Paid the floor average ${formatINR(options.economics.avgDailyWage)}/day`} />
                  <CostInput label="Maintenance per year (% of price)" k="maintenancePctYear" costs={draft.costs} set={setCosts} hint="Rule of thumb: 5%" />
                </>
              )}
              {c.breakdowns && <CostInput label="Repair cost (₹, one-time)" k="repairCost" costs={draft.costs} set={setCosts} />}
              {c.sundays && <CostInput label="Sunday pay (× day wage)" k="sundayPayMultiplier" costs={draft.costs} set={setCosts} hint="1 = normal wage; 2 = double" />}
            </div>
          </Section>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Section title="Run">
          <Field label="Name" htmlFor="lab-name">
            <Input id="lab-name" placeholder="e.g. Two more looms" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Period to evaluate" htmlFor="lab-days" hint="Money and output are worked out over this period">
            <select id="lab-days" className={selectClass} value={draft.days} onChange={(e) => setDraft({ ...draft, days: +e.target.value })}>
              {HORIZONS.map((d) => (
                <option key={d} value={d}>
                  Next {d} days
                </option>
              ))}
            </select>
          </Field>
          <div className="space-y-1 text-sm">
            <p className="text-xs font-medium text-muted-foreground">Changes</p>
            {anything ? (
              <ul className="list-disc space-y-0.5 pl-4">
                {describe(c, names).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">Tick at least one change.</p>
            )}
          </div>
          {error && <p className="text-sm text-problem">{error}</p>}
          <Button className="w-full gap-1.5" disabled={!anything || busy} onClick={run}>
            <Play className="size-4" />
            {busy ? 'Simulating…' : 'Run simulation'}
          </Button>
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setDraft(emptyDraft())}>
            Clear
          </Button>
          <p className="text-xs text-muted-foreground">Runs on today’s orders, machines and stock, in memory only. Nothing in the mill changes.</p>
        </Section>
      </aside>
    </div>
  )
}

function CostInput({ label, k, costs, set, required, hint }: { label: string; k: keyof Costs; costs: Costs; set: (c: Costs) => void; required?: boolean; hint?: ReactNode }) {
  const missing = required && costs[k] === undefined
  return (
    <Field label={label} htmlFor={`cost-${k}`} hint={missing ? <span className="text-watch">Needed for payback and ROI</span> : hint}>
      <Input id={`cost-${k}`} type="number" min={0} value={val(costs[k])} onChange={(e) => set({ ...costs, [k]: n(e.target.value) })} />
    </Field>
  )
}

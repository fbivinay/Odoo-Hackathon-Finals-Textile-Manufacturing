// Delivery-date estimate for a new order, built from the backend's own plan (GET /planning/schedule).
//
// The new order joins the back of the queue: every open order keeps the capacity the planner
// already gave it, so quoting a new order never moves an existing customer's date. Each stage
// then fills the capacity left over, day by day, in the same way the backend planner does:
// spinning (kg of yarn) → weaving (m) → dyeing (m), Sundays closed, a stage may start on the
// day the previous one ends. QC and dispatch preparation follow.
//
// The planner reports load per week, not per day, so a week's existing load is spread evenly
// over its remaining working days. Weekly totals are exact; the day a stage starts inside a
// busy week can be a day or two out.

export type Stage = 'SPINNING' | 'WEAVING' | 'DYEING'
export const STAGES: Stage[] = ['SPINNING', 'WEAVING', 'DYEING']

export interface PlanInput {
  today: string // YYYY-MM-DD, the first day work can be scheduled
  horizonDays: number // how far the backend plan reaches
  perDay: Record<Stage, number> // capacity per working day (kg for spinning, m for the others)
  usable: Record<Stage, number> // machines able to run now
  // Machines down now that the plan counts back in from a given day (backend: breakdown after 2 days, maintenance after 1).
  returning?: Record<Stage, { fromDay: number; perDay: number }[]>
  weeklyLoad: ({ weekStart: string } & Record<Stage, { load: number }>)[]
}

export interface OrderWork {
  yarnKg: number // spinning input
  metres: number // weaving and dyeing quantity
  reworkRate: number // share of rolls historically sent back for rework (0–1)
  yarnShortKg: number // yarn this order needs that the store cannot cover today
  yarnLeadDays?: number // the yarn's delivery days (Config, per material)
  qcDays?: number // Config mill setting
}

export interface StageSlot {
  stage: Stage
  qty: number
  unit: 'kg' | 'm'
  start: string
  end: string
  waitDays: number // working days the stage queued behind existing orders
}

export interface Estimate {
  ok: boolean
  date: string | null // estimated delivery (ready to dispatch)
  stages: StageSlot[]
  qcDay: string | null
  constraints: string[] // what pushes the date out, most important first
  limitation: string | null // why no reliable date can be given
}

// Defaults when Config has no value.
export const QC_DAYS = 1
export const DISPATCH_PREP_DAYS = 1
export const MAX_OVERRIDE_DAYS = 7
// Same rule as the backend planner: an order short of yarn cannot start spinning for 7 days (delivery lead time).
export const YARN_LEAD_DAYS = 7
const DAY = 86400000

const toDate = (s: string) => new Date(`${s}T00:00:00Z`)
const key = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (s: string, n: number) => key(new Date(toDate(s).getTime() + n * DAY))
const isWorking = (s: string) => toDate(s).getUTCDay() !== 0
const mondayOf = (s: string) => {
  const d = toDate(s)
  return addDays(s, -((d.getUTCDay() + 6) % 7))
}
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY)

function nextWorking(s: string, n: number) {
  let d = s
  let left = n
  while (left > 0) {
    d = addDays(d, 1)
    if (isWorking(d)) left -= 1
  }
  return d
}

// Free capacity per stage per day after existing orders, for every day in the horizon.
export function freeCapacity(plan: PlanInput): Record<Stage, number[]> {
  const days = Array.from({ length: plan.horizonDays }, (_, i) => addDays(plan.today, i))
  const weekOf = new Map(plan.weeklyLoad.map((w) => [w.weekStart, w]))
  const workingLeftInWeek = new Map<string, number>()
  for (const d of days) if (isWorking(d)) workingLeftInWeek.set(mondayOf(d), (workingLeftInWeek.get(mondayOf(d)) ?? 0) + 1)
  const out = {} as Record<Stage, number[]>
  for (const stage of STAGES) {
    out[stage] = days.map((d, i) => {
      if (!isWorking(d)) return 0
      const back = (plan.returning?.[stage] ?? []).reduce((t, m) => t + (i >= m.fromDay ? m.perDay : 0), 0)
      const week = weekOf.get(mondayOf(d))
      const existing = week ? week[stage].load / (workingLeftInWeek.get(mondayOf(d)) ?? 1) : 0
      return Math.max(0, plan.perDay[stage] + back - existing)
    })
  }
  return out
}

export function estimateDelivery(plan: PlanInput, work: OrderWork): Estimate {
  const none = (limitation: string): Estimate => ({ ok: false, date: null, stages: [], qcDay: null, constraints: [], limitation })
  if (!(work.metres > 0)) return none('Enter a quantity to estimate a date.')
  if (!(work.yarnKg > 0)) return none('Yarn needed is missing, so spinning time cannot be worked out.')
  for (const stage of STAGES) {
    if (!(plan.perDay[stage] > 0) && !(plan.returning?.[stage] ?? []).length) {
      return none(`No ${stage.toLowerCase()} capacity is available right now (${plan.usable[stage]} usable machines, no recent output), so no date can be promised.`)
    }
  }

  const free = freeCapacity(plan)
  const qty: Record<Stage, number> = {
    SPINNING: work.yarnKg,
    WEAVING: work.metres,
    // Rolls sent back for rework go through dyeing again, so dyeing carries that extra share.
    DYEING: work.metres * (1 + Math.max(0, work.reworkRate)),
  }
  const stages: StageSlot[] = []
  // A yarn shortfall holds spinning back by the delivery lead time, as the backend planner does.
  const leadDays = work.yarnLeadDays ?? YARN_LEAD_DAYS
  let cursor = work.yarnShortKg > 0 ? leadDays : 0
  for (const stage of STAGES) {
    let left = qty[stage]
    let start = -1
    let i = cursor
    for (; i < plan.horizonDays && left > 0.005; i += 1) {
      const take = Math.min(free[stage][i], left)
      if (take <= 0.005) continue
      if (start < 0) start = i
      left -= take
      if (left <= 0.005) break
    }
    if (left > 0.005) {
      return none(
        `${stage.charAt(0) + stage.slice(1).toLowerCase()} cannot fit this order inside the ${plan.horizonDays}-day plan with the current workload. ` +
          'Split the order or check again after existing orders move.',
      )
    }
    const startDay = addDays(plan.today, start)
    let wait = 0
    for (let d = cursor; d < start; d += 1) if (isWorking(addDays(plan.today, d))) wait += 1
    stages.push({ stage, qty: Math.round(qty[stage] * 100) / 100, unit: stage === 'SPINNING' ? 'kg' : 'm', start: startDay, end: addDays(plan.today, i), waitDays: wait })
    cursor = i
  }

  const lastEnd = stages[stages.length - 1].end
  const qcDay = nextWorking(lastEnd, work.qcDays ?? QC_DAYS)
  const date = nextWorking(qcDay, DISPATCH_PREP_DAYS)

  // What is holding the date back, in order of impact.
  const constraints: { weight: number; text: string }[] = []
  for (const s of stages) {
    const span = daysBetween(s.start, s.end) + 1
    if (s.waitDays > 0) constraints.push({ weight: s.waitDays, text: `${label(s.stage)} is booked by existing orders: this order waits ${s.waitDays} working day${s.waitDays === 1 ? '' : 's'} for a free machine.` })
    if (span > 2) constraints.push({ weight: span / 2, text: `${label(s.stage)} takes ${span} days for ${fmt(s.qty)} ${s.unit} at the capacity left over (${fmt(plan.perDay[s.stage])} ${s.unit}/day in total).` })
  }
  if (work.reworkRate > 0) constraints.push({ weight: 0.5, text: `Dyeing includes a ${Math.round(work.reworkRate * 100)}% rework allowance from recent QC results.` })
  constraints.sort((a, b) => b.weight - a.weight)
  const list = constraints.map((c) => c.text)
  if (work.yarnShortKg > 0) {
    list.unshift(`Yarn is short by ${fmt(work.yarnShortKg)} kg after stock already committed to open orders, so spinning waits ${work.yarnLeadDays ?? YARN_LEAD_DAYS} days for a delivery (starts ${stages[0].start} at the earliest).`)
  }
  return { ok: true, date, stages, qcDay, constraints: list, limitation: null }
}

// A committed date may be the estimate itself or up to seven calendar days later; never earlier.
export function checkCommitment(estimate: string, chosen: string): string | null {
  if (!chosen) return 'Pick a delivery date.'
  if (chosen < estimate) return `Cannot promise earlier than the estimated ${estimate}.`
  if (daysBetween(estimate, chosen) > MAX_OVERRIDE_DAYS) return `Can be at most ${MAX_OVERRIDE_DAYS} days after the estimate (${addDays(estimate, MAX_OVERRIDE_DAYS)}).`
  return null
}

const label = (s: Stage) => s.charAt(0) + s.slice(1).toLowerCase()
const fmt = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)

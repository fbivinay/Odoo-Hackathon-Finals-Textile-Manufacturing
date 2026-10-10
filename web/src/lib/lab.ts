// Everest Lab: shapes returned by /lab/* (backend/src/services/labService.js) and the small
// helpers the Lab screens share. All figures are computed on the server; nothing here estimates.
import { formatMoney } from './format.ts'

export type Stage = 'SPINNING' | 'WEAVING' | 'DYEING'
export const STAGE_NAME: Record<Stage, string> = { SPINNING: 'Spinning', WEAVING: 'Weaving', DYEING: 'Dyeing' }
export const STAGES = Object.keys(STAGE_NAME) as Stage[]
export const HORIZONS = [30, 90, 180, 365] as const

export interface Changes {
  addMachines?: { stage: Stage; count: number; perShift?: number; fromDay?: number; rampDays?: number }[]
  breakdowns?: { machineId: string; days: number }[]
  sundays?: boolean
  materials?: { materialId: string; stockChange?: number; extraLeadDays?: number }[]
  rushOrder?: { fabricType: string; colour?: string; qty: number; deadline: string; pricePerUnit?: number }
  qc?: { rejectPct: number }
  logistics?: { costPerMetreChangePct: number }
}
export interface Costs {
  machineCost?: number
  powerKw?: number
  tariff?: number
  staffPerShift?: number
  maintenancePctYear?: number
  repairCost?: number
  sundayPayMultiplier?: number
}
export interface Draft {
  name: string
  changes: Changes
  costs: Costs
  days: number
}

export interface Metric {
  key: string
  label: string
  unit: string
  better: 'higher' | 'lower' | 'none'
  base: number | null
  alt: number | null
  change: number | null
  changePct: number | null
  effect: 'good' | 'bad' | 'none'
}
export interface Money {
  days: number
  complete: boolean
  missing: string[]
  basis: { from: string; to: string; metresShipped: number; contributionPerMetre: number | null; avgDailyWage: number }
  oneTime: { machines: number | null; repair: number | null }
  oneTimeTotal: number
  recurring: { power: number | null; labour: number | null; maintenance: number | null; sundayWork: number | null; logistics: number | null; extraMaterial: number | null }
  recurringTotal: number
  materialPurchase: number
  revenue: {
    pulledIntoPeriod: number
    rushOrderValue: number | null
    rushOrderOnTime: boolean | null
    rushContribution: number | null
    rushYarnKg: number | null
    spareCapacityMetres: number
    spareCapacityContribution: number
  }
  profit: { confirmed: number; ifCapacitySold: number }
  paybackMonths: { confirmed: number | null; ifCapacitySold: number | null }
  roiPct: { confirmed: number | null; ifCapacitySold: number | null }
  assumptions: string[]
}
// One side of the comparison: where the work sits over the next 4 weeks.
export interface Side {
  busiest?: Stage // missing on results saved before it existed
  stages: Record<Stage, { load: number; capacity: number; utilisation: number | null }>
}
export interface Chain {
  perDay: number
  bottleneck: Stage
  rates: { stage: Stage; perDay: number }[]
}
export interface OrderChange {
  id: string
  orderNo: string
  buyer: string
  deadline: string
  qty: number
  before: string | null
  after: string | null
  daysEarlier: number | null
  lateBefore: number | null
  lateAfter: number | null
}
export interface YarnShort {
  id: string
  yarnType: string
  colour: string
  unit: string
  needed: number
  inStock: number
  shortBy: number
}
export interface LabResult {
  snapshotAt: string
  today: string
  days: number
  changes: Changes
  costs: Costs
  metrics: Metric[]
  baseline: Side
  scenario: Side
  capacity: {
    base: Record<Stage, { perDay: number; unit: string; machines: number }>
    scenario: Record<Stage, { perDay: number; unit: string; machines: number; added: { code: string; perDay: number; fromDay: number; rampDays: number }[] }>
    chain: { base: Chain; scenario: Chain }
  }
  weekly: ({ weekStart: string } & Record<string, number | string | null>)[]
  orders: OrderChange[]
  rushOrder: { expectedReady: string | null; lateByDays: number | null; onTime: boolean; deadline: string; qty: number } | null
  yarn: { base: YarnShort[]; scenario: YarnShort[] }
  money: Money
  limitations: string[]
}

export interface Explanation {
  source: 'gemini' | 'rules'
  reason?: string
  sections: { title: string; points: string[] }[]
}

export interface SummaryMetric {
  key: string
  label: string
  value: number | null
  unit?: string
  note?: string
  tone?: 'good' | 'watch' | 'problem'
  link?: string
}
export interface Recommendation {
  id: string
  kind: string
  title: string
  problem: string
  evidence: { label: string; value: string; link: string | null }[]
  action: string
  benefit: string
  costAndRisk: string
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  confidencePct: number
  assumptions: string[]
  limitations: string[]
  scenario: { name: string; changes: Changes } | null
}
export interface Intelligence {
  period: { from: string; to: string; days: number; previous: { from: string; to: string } }
  freshness: { snapshotAt: string; lastProductionLog: string | null; planHorizonDays: number }
  summary: SummaryMetric[]
  recommendations: Recommendation[]
}

export interface LabOptions {
  today: string
  stages: { stage: Stage; name: string; unit: string; machines: number; avgPerDay: number }[]
  machines: { id: string; code: string; name: string; stage: Stage; status: string; perDay: number }[]
  yarns: { id: string; name: string; unit: string; inStock: number; leadDays: number }[]
  fabrics: { fabricType: string; pricePerMetre: number; yarnPerMetre: number }[]
  economics: { contributionPerMetre: number | null; utilitiesPerDay: number; avgDailyWage: number; workers: number; logisticsPerMetre: number | null }
  rejectRatePct: number
}

export type Decision = 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED'
export const DECISION: Record<Decision, string> = { NEEDS_REVIEW: 'Needs review', APPROVED: 'Approved', REJECTED: 'Rejected' }
export interface SavedScenario {
  id: string
  name: string
  changes: Changes
  costs: Costs
  days: number
  snapshotAt: string | null
  evaluatedAt: string | null
  decision: Decision
  note: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  result?: LabResult | null
  headline?: { metrics: Metric[]; money: Pick<Money, 'oneTimeTotal' | 'recurringTotal' | 'profit' | 'paybackMonths' | 'complete'> } | null
  previous?: { snapshotAt: string; evaluatedAt: string; metrics: Metric[]; money: Money } | null
}

// A figure with its unit, the way the mill reads it. INR is rupees (the database keeps no ₹ sign).
export function show(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return '—'
  if (unit === 'INR' || unit === '₹') return formatMoney(value)
  const n = new Intl.NumberFormat('en-IN', { maximumFractionDigits: unit === '%' || unit === 'days' ? 1 : 0 }).format(value)
  if (unit === '%') return `${n}%`
  // "1 order", not "1 orders".
  return `${n} ${value === 1 && ['orders', 'machines', 'items', 'days'].includes(unit) ? unit.slice(0, -1) : unit}`
}

// One line per change, in plain words, for cards and the comparison header.
export function describe(changes: Changes, names: { machine?: (id: string) => string; yarn?: (id: string) => string } = {}): string[] {
  const out: string[] = []
  for (const a of changes.addMachines ?? [])
    out.push(`Add ${a.count} ${STAGE_NAME[a.stage].toLowerCase()} machine${a.count > 1 ? 's' : ''}${a.fromDay ? ` from day ${a.fromDay}` : ''}${a.rampDays ? `, ${a.rampDays}-day ramp-up` : ''}`)
  for (const b of changes.breakdowns ?? []) out.push(`${names.machine?.(b.machineId) ?? 'Machine'} down for ${b.days} days`)
  if (changes.sundays) out.push('Work Sundays')
  for (const m of changes.materials ?? []) {
    const parts = [m.stockChange ? `${m.stockChange > 0 ? '+' : ''}${m.stockChange} in stock` : null, m.extraLeadDays ? `delivery ${m.extraLeadDays} days later` : null].filter(Boolean)
    out.push(`${names.yarn?.(m.materialId) ?? 'Yarn'}: ${parts.join(', ') || 'no change'}`)
  }
  if (changes.rushOrder) out.push(`Rush order: ${changes.rushOrder.qty.toLocaleString('en-IN')} m ${changes.rushOrder.fabricType} by ${changes.rushOrder.deadline}`)
  if (changes.qc) out.push(`Reject rate ${changes.qc.rejectPct}%`)
  if (changes.logistics) out.push(`Logistics cost ${changes.logistics.costPerMetreChangePct > 0 ? '+' : ''}${changes.logistics.costPerMetreChangePct}% per metre`)
  return out
}

export const metric = (r: LabResult, key: string) => r.metrics.find((m) => m.key === key)

export const emptyDraft = (): Draft => ({ name: '', changes: {}, costs: { maintenancePctYear: 5, sundayPayMultiplier: 1 }, days: 90 })

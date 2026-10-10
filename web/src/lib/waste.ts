// Fabric waste and rework, worked out from QC records on finished rolls.
//
// Everything here is in metres of finished (dyed) fabric, the unit rolls are measured in, so
// quantities can be added and divided safely. Yarn (kg) is never subtracted from fabric (m).
//
//   rejected   = rolls whose final QC result is REJECT. Counted once, however many checks it had.
//   rework     = rolls that were sent back at least once. Split into recovered (later passed),
//                still in rework, and later rejected (already inside "rejected", so never added twice).
//   checked    = every roll that has had at least one QC decision. Rolls waiting for QC are left
//                out of the rates, because their outcome is not known yet.
//   reject %   = rejected m / checked m × 100        rework % = reworked m / checked m × 100
//   cost       = rejected m × that order's cost per metre made (yarn + labour ÷ metres produced).

export type FabricStage = 'WEAVING' | 'DYEING' | 'UNSPECIFIED'

// Where a defect starts: holes and weaving faults come from the loom, colour faults from the dye house.
export const DEFECT_STAGE: Record<string, FabricStage> = {
  Holes: 'WEAVING',
  'Uneven weaving': 'WEAVING',
  'Broken ends': 'WEAVING',
  'Colour mismatch': 'DYEING',
  'Shade variation': 'DYEING',
  Stains: 'DYEING',
}

export interface WasteRoll {
  id: string
  rollNo: string
  qty: number
  status: string
  createdAt: string
  jobId: string | null
  orderId: string
  order: { orderNo: string; fabricType: string; buyer?: { name: string } }
  machine: { id: string; code: string }
  qcRecords: { result: 'PASS' | 'REWORK' | 'REJECT'; defectType: string | null; checkedAt: string }[]
}

export interface Bucket {
  key: string
  label: string
  checked: number
  rejected: number
  reworked: number
  rejectCost: number
  rolls: number
}

export interface WasteSummary {
  produced: number
  pendingQc: number
  checked: number
  rejected: number
  reworked: number
  reworkRecovered: number
  reworkOpen: number
  reworkThenRejected: number
  rejectPct: number | null
  reworkPct: number | null
  rejectCost: number
  costedShare: number // share of rejected metres that had a cost basis
  byMachine: Bucket[]
  byFabric: Bucket[]
  byStage: Bucket[]
  byDefect: Bucket[]
  byJob: (Bucket & { orderNo: string; machine: string; rollIds: string[] })[]
  byMonth: Bucket[] // trend buckets: YYYY-MM, or YYYY-MM-DD when trend is "day"
}

const sortedChecks = (r: WasteRoll) => [...r.qcRecords].sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

export function summariseWaste(rolls: WasteRoll[], costPerMetre: Map<string, number>, { trend = 'month' }: { trend?: 'day' | 'month' } = {}): WasteSummary {
  const groups = new Map<string, Map<string, Bucket>>()
  const jobs = new Map<string, Bucket & { orderNo: string; machine: string; rollIds: string[] }>()
  const add = (group: string, key: string, label: string, f: (b: Bucket) => void) => {
    if (!groups.has(group)) groups.set(group, new Map())
    const g = groups.get(group)!
    if (!g.has(key)) g.set(key, { key, label, checked: 0, rejected: 0, reworked: 0, rejectCost: 0, rolls: 0 })
    f(g.get(key)!)
  }

  const s = { produced: 0, pendingQc: 0, checked: 0, rejected: 0, reworked: 0, reworkRecovered: 0, reworkOpen: 0, reworkThenRejected: 0, rejectCost: 0, costed: 0 }
  for (const r of rolls) {
    s.produced += r.qty
    const checks = sortedChecks(r)
    if (checks.length === 0) {
      s.pendingQc += r.qty
      continue
    }
    const last = checks[checks.length - 1]
    const isRejected = last.result === 'REJECT'
    const wasReworked = checks.some((c) => c.result === 'REWORK')
    const cost = isRejected && costPerMetre.has(r.orderId) ? r.qty * costPerMetre.get(r.orderId)! : 0
    s.checked += r.qty
    if (isRejected) {
      s.rejected += r.qty
      s.rejectCost += cost
      if (costPerMetre.has(r.orderId)) s.costed += r.qty
    }
    if (wasReworked) {
      s.reworked += r.qty
      if (isRejected) s.reworkThenRejected += r.qty
      else if (last.result === 'REWORK') s.reworkOpen += r.qty
      else s.reworkRecovered += r.qty
    }

    // The defect that decided the roll's fate (the reject, or the rework that sent it back).
    const decisive = isRejected ? last : checks.find((c) => c.result === 'REWORK')
    const stage: FabricStage = decisive?.defectType ? DEFECT_STAGE[decisive.defectType] ?? 'UNSPECIFIED' : 'UNSPECIFIED'
    const tally = (b: Bucket) => {
      b.checked += r.qty
      b.rolls += 1
      if (isRejected) {
        b.rejected += r.qty
        b.rejectCost += cost
      }
      if (wasReworked) b.reworked += r.qty
    }
    add('machine', r.machine.id, r.machine.code, tally)
    add('fabric', r.order.fabricType, r.order.fabricType, tally)
    const bucket = r.createdAt.slice(0, trend === 'day' ? 10 : 7)
    add('month', bucket, bucket, tally)
    if (isRejected || wasReworked) {
      add('stage', stage, stage === 'UNSPECIFIED' ? 'Not recorded' : stage.charAt(0) + stage.slice(1).toLowerCase(), (b) => {
        b.rolls += 1
        if (isRejected) {
          b.rejected += r.qty
          b.rejectCost += cost
        }
        if (wasReworked) b.reworked += r.qty
      })
      const defect = decisive?.defectType ?? 'Not recorded'
      add('defect', defect, defect, (b) => {
        b.rolls += 1
        if (isRejected) {
          b.rejected += r.qty
          b.rejectCost += cost
        }
        if (wasReworked) b.reworked += r.qty
      })
    }
    const jobKey = r.jobId ?? `order:${r.orderId}`
    if (!jobs.has(jobKey)) jobs.set(jobKey, { key: jobKey, label: jobKey, orderNo: r.order.orderNo, machine: r.machine.code, rollIds: [], checked: 0, rejected: 0, reworked: 0, rejectCost: 0, rolls: 0 })
    const j = jobs.get(jobKey)!
    tally(j)
    j.rollIds.push(r.id)
  }

  const list = (g: string, sort: (a: Bucket, b: Bucket) => number) => [...(groups.get(g)?.values() ?? [])].sort(sort)
  const byWaste = (a: Bucket, b: Bucket) => b.rejected + b.reworked - (a.rejected + a.reworked)
  return {
    produced: s.produced,
    pendingQc: s.pendingQc,
    checked: s.checked,
    rejected: s.rejected,
    reworked: s.reworked,
    reworkRecovered: s.reworkRecovered,
    reworkOpen: s.reworkOpen,
    reworkThenRejected: s.reworkThenRejected,
    rejectPct: pct(s.rejected, s.checked),
    reworkPct: pct(s.reworked, s.checked),
    rejectCost: s.rejectCost,
    costedShare: s.rejected > 0 ? s.costed / s.rejected : 1,
    byMachine: list('machine', byWaste),
    byFabric: list('fabric', byWaste),
    byStage: list('stage', byWaste),
    byDefect: list('defect', byWaste),
    byJob: [...jobs.values()].filter((j) => j.rejected + j.reworked > 0).sort(byWaste),
    byMonth: list('month', (a, b) => a.key.localeCompare(b.key)),
  }
}

// Cost of making one metre of an order: yarn + labour spread over every metre it produced
// (good and rejected). Orders that have produced nothing have no basis and are left out.
export function costPerMetreOf(costs: { id: string; materialCost: number; labourCost: number; goodQty: number; rejectedQty: number }[]) {
  const map = new Map<string, number>()
  for (const c of costs) {
    const made = c.goodQty + c.rejectedQty
    if (made > 0) map.set(c.id, (c.materialCost + c.labourCost) / made)
  }
  return map
}

export const rate = pct

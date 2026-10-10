// Dispatch checks: is this truck the right quantity for the order, and is finished fabric being
// left on the shelf. Pure functions so the rules are tested, not just drawn.

// Defaults; the owner can change both on the Config page (Mill settings).
// Buyers accept delivery within about 5% of the ordered length (rolls come in ~1,100 m pieces).
export const TOLERANCE = 0.05
// Finished fabric should leave within two working days of its last QC pass.
export const WAIT_LIMIT_DAYS = 3
export const DUE_SOON_DAYS = 3

const DAY = 86400000
const days = (from: string, to: string) => Math.floor((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY)

export type LoadCheck =
  | { kind: 'match'; total: number; diffPct: number } // within tolerance of the order
  | { kind: 'part'; total: number; toFollow: number } // short of the order: the rest ships later
  | { kind: 'over'; total: number; overBy: number; overPct: number } // more than the tolerance over

export function checkLoad({ ordered, shippedBefore, truck, tolerance = TOLERANCE }: { ordered: number; shippedBefore: number; truck: number; tolerance?: number }): LoadCheck {
  const total = shippedBefore + truck
  const diff = total - ordered
  if (diff > ordered * tolerance) return { kind: 'over', total, overBy: diff, overPct: Math.round((1000 * diff) / ordered) / 10 }
  if (diff < -ordered * tolerance) return { kind: 'part', total, toFollow: -diff }
  return { kind: 'match', total, diffPct: Math.round((1000 * diff) / ordered) / 10 }
}

export type ShelfFlag = 'overdue' | 'due-soon' | 'waiting' | null

// One order's fabric on the shelf. `complete` when what is shipped plus what is on the shelf
// covers the order; a flag when it is late, nearly due, or has sat too long (a forgotten dispatch).
export function shelfStatus({ ordered, shipped, onShelf, deadline, finishedAt, today, tolerance = TOLERANCE, waitLimit = WAIT_LIMIT_DAYS }: { ordered: number; shipped: number; onShelf: number; deadline: string; finishedAt: string; today: string; tolerance?: number; waitLimit?: number }) {
  const complete = shipped + onShelf >= ordered * (1 - tolerance)
  const waitingDays = Math.max(0, days(finishedAt, today))
  const dueIn = days(today, deadline)
  const flag: ShelfFlag = dueIn < 0 ? 'overdue' : dueIn <= DUE_SOON_DAYS ? 'due-soon' : complete && waitingDays > waitLimit ? 'waiting' : null
  return { complete, waitingDays, dueIn, flag }
}

// Most urgent first: overdue, then due soon, then waiting too long, then by deadline.
const RANK: Record<string, number> = { overdue: 0, 'due-soon': 1, waiting: 2, none: 3 }
export const byUrgency = <T extends { flag: ShelfFlag; deadline: string }>(a: T, b: T) =>
  RANK[a.flag ?? 'none'] - RANK[b.flag ?? 'none'] || a.deadline.localeCompare(b.deadline)

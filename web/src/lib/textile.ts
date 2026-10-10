import type { JobStatus, OrderStatus, RollStatus, Stage } from '@/types'

// Yarn still to issue for an order, and how much of that the store can't cover.
export function yarnNeed(required: number, issued: number, inStock: number) {
  const remaining = Math.max(0, required - issued)
  return { remaining, shortBy: Math.max(0, remaining - inStock) }
}

// Same rule as backend orderService.syncStatus — used by the mock so demo orders move by themselves.
export function deriveStatus(
  current: OrderStatus,
  target: number,
  jobs: { stage: Stage; status: JobStatus; startedAt: string }[],
  rolls: { status: RollStatus; qty: number }[],
): OrderStatus {
  if (current === 'CANCELLED') return current
  const latest = [...jobs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
  const running = latest.find((j) => j.status === 'RUNNING')
  const qty = (s: RollStatus) => rolls.filter((r) => r.status === s).reduce((a, r) => a + r.qty, 0)
  const passed = rolls.filter((r) => r.status === 'PASSED')
  const awaitingQc = rolls.some((r) => r.status === 'PENDING_QC' || r.status === 'REWORK')

  if (running) return running.stage
  if (awaitingQc) return 'QC'
  if (passed.length === 0 && qty('DISPATCHED') >= target) return 'DISPATCHED'
  if (passed.length > 0 && qty('DISPATCHED') + qty('PASSED') >= target) return 'READY'
  return latest[0]?.stage ?? 'PENDING'
}

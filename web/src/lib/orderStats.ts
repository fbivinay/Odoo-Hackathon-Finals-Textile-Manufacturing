// The six order boxes. Pure so the rules are tested, not just drawn. Quantities and money may
// arrive as decimal strings from the API, hence Number().
// Received, Dispatched and On-time follow the chosen period; Open, Waiting and Late are "today".

export type SOrder = { id: string; status: string; qty: number; pricePerUnit: number; deadline: string; createdAt: string }
export type SDispatch = { orderId: string; dispatchedAt: string; totalQty: number; invoice?: { amount: number } | null }

const CLOSED = ['DISPATCHED', 'CANCELLED']
const IN_PRODUCTION = ['SPINNING', 'WEAVING', 'DYEING', 'QC']
const DAY = 86400000
const day = (iso: string) => iso.slice(0, 10)
const inPeriod = (iso: string, from: string, to: string) => day(iso) >= from && day(iso) <= to

export function orderBoxes(
  orders: SOrder[],
  dispatches: SDispatch[], // every dispatch since `from`, so an order's last truck is known
  { from, to, today, waitingForYarn = 0 }: { from: string; to: string; today: string; waitingForYarn?: number },
) {
  const received = orders.filter((o) => inPeriod(o.createdAt, from, to))
  const live = received.filter((o) => o.status !== 'CANCELLED')

  const open = orders.filter((o) => !CLOSED.includes(o.status))
  const late = open.filter((o) => day(o.deadline) < today)
  const in7 = new Date(Date.parse(today) + 7 * DAY).toISOString().slice(0, 10)
  const dueSoon = open.filter((o) => day(o.deadline) >= today && day(o.deadline) <= in7)

  // An order counts as dispatched in the period when its last truck left in the period.
  const lastTruck = lastTrucks(dispatches)
  const done = orders.filter((o) => o.status === 'DISPATCHED' && lastTruck.has(o.id) && inPeriod(lastTruck.get(o.id)!, from, to))
  const onTime = done.filter((o) => day(lastTruck.get(o.id)!) <= day(o.deadline))
  const leadDays = done.map((o) => (Date.parse(lastTruck.get(o.id)!) - Date.parse(o.createdAt)) / DAY)
  const sent = dispatches.filter((d) => inPeriod(d.dispatchedAt, from, to))

  return {
    received: { count: received.length, metres: live.reduce((s, o) => s + Number(o.qty), 0), value: live.reduce((s, o) => s + Number(o.qty) * Number(o.pricePerUnit), 0) },
    open: {
      count: open.length,
      inProduction: open.filter((o) => IN_PRODUCTION.includes(o.status)).length,
      ready: open.filter((o) => o.status === 'READY').length,
      notStarted: open.filter((o) => o.status === 'PENDING').length,
    },
    waiting: { count: open.filter((o) => o.status === 'PENDING').length, forYarn: waitingForYarn },
    dispatched: { count: done.length, metres: sent.reduce((s, d) => s + Number(d.totalQty), 0), invoiced: sent.reduce((s, d) => s + Number(d.invoice?.amount ?? 0), 0) },
    late: { count: late.length, dueSoon: dueSoon.length },
    onTime: { pct: done.length ? Math.round((onTime.length / done.length) * 100) : null, avgDays: leadDays.length ? Math.round(leadDays.reduce((s, x) => s + x, 0) / leadDays.length) : null },
  }
}

// When each order's last truck left.
export function lastTrucks(dispatches: Pick<SDispatch, 'orderId' | 'dispatchedAt'>[]) {
  const last = new Map<string, string>()
  for (const d of dispatches) if ((last.get(d.orderId) ?? '') < d.dispatchedAt) last.set(d.orderId, d.dispatchedAt)
  return last
}

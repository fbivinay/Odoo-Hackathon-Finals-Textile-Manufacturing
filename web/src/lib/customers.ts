// Customer (buyer) league: what each buyer orders, pays and earns us, worked out from
// orders, invoices with their payments, and the owner's order-cost report.

export interface CBuyer {
  id: string
  name: string
  phone: string | null
  email: string | null
  createdAt: string
}
export interface COrder {
  id: string
  orderNo: string
  buyerId: string
  fabricType: string
  qty: number
  pricePerUnit: number
  deadline: string
  status: string
  createdAt: string
}
export interface CInvoice {
  id: string
  invoiceNo: string
  amount: number
  status: string
  issuedAt: string
  paid: number
  balance: number
  payments: { amount: number; paidAt: string }[]
  dispatch: { dispatchedAt: string; order: { id: string; orderNo: string }; buyer: { id: string } }
}
export interface CCost {
  id: string
  buyer: { id: string }
  status: string
  invoiced: number
  totalCost: number
}

const DAY = 86400000
const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const round1 = (x: number) => Math.round(x * 10) / 10

export interface CustomerStats {
  buyer: CBuyer
  orders: number
  cancelled: number
  openOrders: number
  metres: number
  orderValue: number
  invoiced: number
  share: number // of everyone's invoicing in the period, 0..1
  marginPct: number | null // on dispatched orders with a cost basis
  daysToPay: number | null // median, issue to final payment, fully paid invoices
  paidWithin30: number | null // share of paid invoices settled in 30 days
  outstanding: number // unpaid today, whatever the period
  overdue: number // part of outstanding older than 60 days
  oldestUnpaidDays: number | null
  onTimePct: number | null // our delivery to them: last dispatch on or before the deadline
  firstOrder: string | null
  lastOrder: string | null
  avgOrderValue: number | null
  topFabric: string | null
  score: number // 0..100, see rank()
  grade: 'A' | 'B' | 'C'
}

export function summariseCustomers(
  input: { buyers: CBuyer[]; orders: COrder[]; invoices: CInvoice[]; costs: CCost[] },
  { from, today }: { from: string | null; today: string },
): CustomerStats[] {
  const inPeriod = (iso: string) => !from || iso.slice(0, 10) >= from
  const lastDispatch = new Map<string, string>()
  for (const i of input.invoices) {
    const id = i.dispatch.order.id
    const at = i.dispatch.dispatchedAt
    if (!lastDispatch.has(id) || at > lastDispatch.get(id)!) lastDispatch.set(id, at)
  }

  const rows = input.buyers.map((buyer) => {
    const allOrders = input.orders.filter((o) => o.buyerId === buyer.id)
    const orders = allOrders.filter((o) => inPeriod(o.createdAt))
    const live = orders.filter((o) => o.status !== 'CANCELLED')
    const allInvoices = input.invoices.filter((i) => i.dispatch.buyer.id === buyer.id)
    const invoices = allInvoices.filter((i) => inPeriod(i.issuedAt))
    const invoiced = invoices.reduce((t, i) => t + i.amount, 0)

    const settled = invoices.filter((i) => i.balance <= 0.5 && i.payments.length)
    const payDays = settled.map((i) => days(i.issuedAt, i.payments.reduce((m, p) => (p.paidAt > m ? p.paidAt : m), i.payments[0].paidAt)))
    const unpaid = allInvoices.filter((i) => i.balance > 0.5)
    const ages = unpaid.map((i) => days(i.issuedAt, today))

    const costs = input.costs.filter((c) => c.buyer.id === buyer.id && c.status === 'DISPATCHED' && c.totalCost > 0 && c.invoiced > 0)
    const periodIds = new Set(orders.map((o) => o.id))
    const costed = costs.filter((c) => periodIds.has(c.id))
    const costInvoiced = costed.reduce((t, c) => t + c.invoiced, 0)

    const delivered = live.filter((o) => o.status === 'DISPATCHED' && lastDispatch.has(o.id))
    const fabrics = new Map<string, number>()
    for (const o of live) fabrics.set(o.fabricType, (fabrics.get(o.fabricType) ?? 0) + o.qty)
    const dates = allOrders.map((o) => o.createdAt).sort()

    return {
      buyer,
      orders: orders.length,
      cancelled: orders.length - live.length,
      openOrders: allOrders.filter((o) => !['DISPATCHED', 'CANCELLED'].includes(o.status)).length,
      metres: live.reduce((t, o) => t + o.qty, 0),
      orderValue: live.reduce((t, o) => t + o.qty * o.pricePerUnit, 0),
      invoiced,
      share: 0,
      marginPct: costInvoiced > 0 ? round1((100 * (costInvoiced - costed.reduce((t, c) => t + c.totalCost, 0))) / costInvoiced) : null,
      daysToPay: payDays.length ? Math.round(median(payDays)!) : null,
      paidWithin30: payDays.length ? payDays.filter((d) => d <= 30).length / payDays.length : null,
      outstanding: unpaid.reduce((t, i) => t + i.balance, 0),
      overdue: unpaid.filter((_, k) => ages[k] > 60).reduce((t, i) => t + i.balance, 0),
      oldestUnpaidDays: ages.length ? Math.floor(Math.max(...ages)) : null,
      onTimePct: delivered.length ? round1((100 * delivered.filter((o) => lastDispatch.get(o.id)!.slice(0, 10) <= o.deadline.slice(0, 10)).length) / delivered.length) : null,
      firstOrder: dates[0] ?? null,
      lastOrder: dates.at(-1) ?? null,
      avgOrderValue: live.length ? live.reduce((t, o) => t + o.qty * o.pricePerUnit, 0) / live.length : null,
      topFabric: [...fabrics].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      score: 0,
      grade: 'C' as const,
    }
  })
  const total = rows.reduce((t, r) => t + r.invoiced, 0)
  for (const r of rows) r.share = total > 0 ? r.invoiced / total : 0
  return rank(rows)
}

// Score = where a buyer stands among the others (percentile, 0..1) on four things the owner cares
// about: revenue 40%, payment speed 30%, margin 20%, order count 10%. A missing figure scores the middle.
// ponytail: fixed weights; make them owner-editable if the ranking gets argued about.
export function rank(rows: CustomerStats[]): CustomerStats[] {
  const pct = (get: (r: CustomerStats) => number | null, higherIsBetter = true) => {
    const vals = rows.map(get).filter((v): v is number => v !== null)
    return (r: CustomerStats) => {
      const v = get(r)
      if (v === null || vals.length < 2) return 0.5
      const better = vals.filter((x) => (higherIsBetter ? x < v : x > v)).length
      const same = vals.filter((x) => x === v).length - 1
      return (better + same / 2) / (vals.length - 1)
    }
  }
  const revenue = pct((r) => r.invoiced)
  const speed = pct((r) => r.daysToPay, false)
  const margin = pct((r) => r.marginPct)
  const count = pct((r) => r.orders)
  for (const r of rows) {
    r.score = r.orders || r.invoiced ? Math.round(100 * (0.4 * revenue(r) + 0.3 * speed(r) + 0.2 * margin(r) + 0.1 * count(r))) : 0
    r.grade = r.score >= 65 ? 'A' : r.score >= 40 ? 'B' : 'C'
  }
  return rows.sort((a, b) => b.score - a.score)
}

// Invoiced and collected per month, for one buyer's chart.
export function monthly(invoices: CInvoice[], from: string | null) {
  const m = new Map<string, { month: string; invoiced: number; collected: number }>()
  const at = (k: string) => m.get(k) ?? m.set(k, { month: k, invoiced: 0, collected: 0 }).get(k)!
  for (const i of invoices) {
    if (!from || i.issuedAt.slice(0, 10) >= from) at(i.issuedAt.slice(0, 7)).invoiced += i.amount
    for (const p of i.payments) if (!from || p.paidAt.slice(0, 10) >= from) at(p.paidAt.slice(0, 7)).collected += p.amount
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month))
}

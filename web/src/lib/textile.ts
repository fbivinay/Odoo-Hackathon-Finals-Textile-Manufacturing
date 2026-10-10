import type { OrderStatus, OwnerReport, Stage } from '@/types'

const n = (v: string | number) => Number(v) || 0

export function isLowStock(m: { qtyInStock: string; reorderLevel: string }) {
  return n(m.qtyInStock) <= n(m.reorderLevel)
}

// How much yarn an order still lacks; 0 means it can start.
export function yarnShortfall(stock: string | number, required: string | number) {
  return Math.max(0, n(required) - n(stock))
}

export const ORDER_FLOW: OrderStatus[] = ['PENDING', 'SPINNING', 'WEAVING', 'DYEING', 'QC', 'READY', 'DISPATCHED']

export function isOverdue(o: { deadline: string; status: OrderStatus }, now = Date.now()) {
  return !['READY', 'DISPATCHED', 'CANCELLED'].includes(o.status) && new Date(o.deadline).getTime() < now
}

const inMonth = (iso: string, month: string) => iso.slice(0, 7) === month

// Raw rows in, owner's month-end numbers out. The backend should return the same shape.
export function ownerReport(
  month: string,
  db: {
    orders: { id: string; orderNo: string; buyerName: string; qty: string; pricePerUnit: string }[]
    inwards: { billAmount: string; receivedAt: string }[]
    issues: { orderId: string; cost: string }[]
    invoices: { amount: string; issuedAt: string }[]
    payments: { amount: string; paidAt: string }[]
    wages: { amount: string; month: string }[]
    jobs: { machineId: string; qtyProduced: string; startedAt: string }[]
    machines: { id: string; code: string; type: Stage }[]
  },
): OwnerReport {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const revenue = sum(db.invoices.filter((i) => inMonth(i.issuedAt, month)).map((i) => n(i.amount)))
  const received = sum(db.payments.filter((p) => inMonth(p.paidAt, month)).map((p) => n(p.amount)))
  const materialCost = sum(db.inwards.filter((i) => inMonth(i.receivedAt, month)).map((i) => n(i.billAmount)))
  const wages = sum(db.wages.filter((w) => w.month === month).map((w) => n(w.amount)))

  const orders = db.orders.map((o) => {
    const cost = sum(db.issues.filter((i) => i.orderId === o.id).map((i) => n(i.cost)))
    const rev = n(o.qty) * n(o.pricePerUnit)
    return { orderNo: o.orderNo, buyer: o.buyerName, materialCost: cost, revenue: rev, margin: rev - cost }
  })

  const machines = db.machines.map((m) => ({
    code: m.code,
    type: m.type,
    produced: sum(db.jobs.filter((j) => j.machineId === m.id && inMonth(j.startedAt, month)).map((j) => n(j.qtyProduced))),
  }))

  return { month, revenue, received, materialCost, wages, profit: revenue - materialCost - wages, orders, machines }
}

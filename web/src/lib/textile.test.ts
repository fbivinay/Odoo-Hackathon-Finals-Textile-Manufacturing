import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLowStock, isOverdue, ownerReport, yarnShortfall } from './textile.ts'

test('low stock at or below reorder level', () => {
  assert.equal(isLowStock({ qtyInStock: '100', reorderLevel: '100' }), true)
  assert.equal(isLowStock({ qtyInStock: '100.5', reorderLevel: '100' }), false)
})

test('yarn shortfall', () => {
  assert.equal(yarnShortfall('80', '120'), 40)
  assert.equal(yarnShortfall('200', '120'), 0)
})

test('overdue ignores finished orders', () => {
  const past = '2020-01-01T00:00:00Z'
  assert.equal(isOverdue({ deadline: past, status: 'WEAVING' }), true)
  assert.equal(isOverdue({ deadline: past, status: 'DISPATCHED' }), false)
})

test('owner report sums only the given month', () => {
  const r = ownerReport('2026-10', {
    orders: [{ id: 'o1', orderNo: 'ORD-1', buyerName: 'B', qty: '100', pricePerUnit: '50' }],
    inwards: [
      { billAmount: '1000', receivedAt: '2026-10-02T10:00:00Z' },
      { billAmount: '999', receivedAt: '2026-09-30T10:00:00Z' },
    ],
    issues: [{ orderId: 'o1', cost: '1200' }],
    invoices: [{ amount: '5000', issuedAt: '2026-10-05T10:00:00Z' }],
    payments: [{ amount: '2000', paidAt: '2026-10-06T10:00:00Z' }],
    wages: [{ amount: '1500', month: '2026-10' }, { amount: '7', month: '2026-09' }],
    jobs: [{ machineId: 'm1', qtyProduced: '40', startedAt: '2026-10-03T08:00:00Z' }],
    machines: [{ id: 'm1', code: 'WV-01', type: 'WEAVING' }],
  })
  assert.equal(r.revenue, 5000)
  assert.equal(r.received, 2000)
  assert.equal(r.materialCost, 1000)
  assert.equal(r.wages, 1500)
  assert.equal(r.profit, 2500)
  assert.deepEqual(r.orders[0], { orderNo: 'ORD-1', buyer: 'B', materialCost: 1200, revenue: 5000, margin: 3800 })
  assert.equal(r.machines[0].produced, 40)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { orderBoxes } from './orderStats.ts'

const o = (id: string, status: string, createdAt: string, deadline: string, qty = 1000) => ({ id, status, qty, pricePerUnit: 100, createdAt, deadline })

test('order boxes for a month', () => {
  const orders = [
    o('a', 'DISPATCHED', '2026-09-01', '2026-10-05'), // last truck 3 Oct: on time
    o('b', 'DISPATCHED', '2026-09-10', '2026-10-02'), // last truck 4 Oct: late
    o('c', 'WEAVING', '2026-10-02', '2026-10-08'), // open, late
    o('d', 'PENDING', '2026-10-03', '2026-10-14'), // open, due within 7 days
    o('e', 'CANCELLED', '2026-10-04', '2026-11-01'),
    o('f', 'READY', '2026-08-01', '2026-10-30'),
  ]
  const dispatches = [
    { orderId: 'a', dispatchedAt: '2026-09-28T10:00:00Z', totalQty: 500, invoice: { amount: 50000 } }, // before the month
    { orderId: 'a', dispatchedAt: '2026-10-03T10:00:00Z', totalQty: 520, invoice: { amount: 52000 } },
    { orderId: 'b', dispatchedAt: '2026-10-04T10:00:00Z', totalQty: 1010, invoice: { amount: 101000 } },
  ]
  const b = orderBoxes(orders, dispatches, { from: '2026-10-01', to: '2026-10-31', today: '2026-10-10', waitingForYarn: 1 })
  assert.deepEqual(b.received, { count: 3, metres: 2000, value: 200000 })
  assert.deepEqual(b.open, { count: 3, inProduction: 1, ready: 1, notStarted: 1 })
  assert.deepEqual(b.waiting, { count: 1, forYarn: 1 })
  assert.deepEqual(b.dispatched, { count: 2, metres: 1530, invoiced: 153000 })
  assert.deepEqual(b.late, { count: 1, dueSoon: 1 })
  assert.equal(b.onTime.pct, 50)
})

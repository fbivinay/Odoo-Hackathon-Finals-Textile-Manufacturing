import assert from 'node:assert/strict'
import { test } from 'node:test'
import { monthly, summariseCustomers, type CInvoice, type COrder } from './customers.ts'

const buyer = (id: string) => ({ id, name: id, phone: null, email: null, createdAt: '2025-01-01' })
const order = (id: string, buyerId: string, extra: Partial<COrder> = {}): COrder => ({
  id, orderNo: id, buyerId, fabricType: 'Poplin', qty: 1000, pricePerUnit: 100, deadline: '2026-03-10T00:00:00Z', status: 'DISPATCHED', createdAt: '2026-02-01T00:00:00Z', ...extra,
})
const invoice = (orderId: string, buyerId: string, amount: number, issuedAt: string, paidAt: string | null, dispatchedAt = issuedAt): CInvoice => ({
  id: `i-${orderId}`, invoiceNo: `INV-${orderId}`, amount, status: paidAt ? 'PAID' : 'UNPAID', issuedAt,
  paid: paidAt ? amount : 0, balance: paidAt ? 0 : amount, payments: paidAt ? [{ amount, paidAt }] : [],
  dispatch: { dispatchedAt, order: { id: orderId, orderNo: orderId }, buyer: { id: buyerId } },
})

test('revenue, payment speed, outstanding and on-time delivery per buyer', () => {
  const rows = summariseCustomers(
    {
      buyers: [buyer('fast'), buyer('slow')],
      orders: [order('a', 'fast'), order('b', 'fast', { status: 'CANCELLED' }), order('c', 'slow'), order('d', 'slow')],
      invoices: [
        invoice('a', 'fast', 100000, '2026-03-01T00:00:00Z', '2026-03-11T00:00:00Z'),
        invoice('c', 'slow', 100000, '2026-03-01T00:00:00Z', '2026-05-01T00:00:00Z', '2026-03-20T00:00:00Z'),
        invoice('d', 'slow', 50000, '2026-03-01T00:00:00Z', null),
      ],
      costs: [{ id: 'a', buyer: { id: 'fast' }, status: 'DISPATCHED', invoiced: 100000, totalCost: 80000 }],
    },
    { from: null, today: '2026-06-01' },
  )
  const fast = rows.find((r) => r.buyer.id === 'fast')!
  const slow = rows.find((r) => r.buyer.id === 'slow')!
  assert.equal(fast.daysToPay, 10)
  assert.equal(fast.paidWithin30, 1)
  assert.equal(fast.cancelled, 1)
  assert.equal(fast.marginPct, 20)
  assert.equal(fast.onTimePct, 100)
  assert.equal(slow.daysToPay, 61)
  assert.equal(slow.outstanding, 50000)
  assert.equal(slow.overdue, 50000) // 92 days unpaid
  assert.equal(slow.onTimePct, 50) // order c shipped after its deadline
  assert.equal(Math.round(slow.share * 100), 60)
  // slow wins revenue (40%), fast wins payment speed (30%); margin and order count tie
  assert.deepEqual([slow.score, fast.score], [55, 45])
  assert.equal(rows[0], slow)
})

test('period filter keeps receivables whole but limits revenue to the period', () => {
  const rows = summariseCustomers(
    { buyers: [buyer('x')], orders: [order('a', 'x', { createdAt: '2024-01-01T00:00:00Z' })], invoices: [invoice('a', 'x', 1000, '2024-02-01T00:00:00Z', null)], costs: [] },
    { from: '2026-01-01', today: '2026-06-01' },
  )
  assert.equal(rows[0].invoiced, 0)
  assert.equal(rows[0].outstanding, 1000)
  assert.equal(rows[0].score, 0)
})

test('monthly invoiced and collected', () => {
  const m = monthly([invoice('a', 'x', 500, '2026-03-05T00:00:00Z', '2026-04-02T00:00:00Z')], null)
  assert.deepEqual(m, [
    { month: '2026-03', invoiced: 500, collected: 0 },
    { month: '2026-04', invoiced: 0, collected: 500 },
  ])
})

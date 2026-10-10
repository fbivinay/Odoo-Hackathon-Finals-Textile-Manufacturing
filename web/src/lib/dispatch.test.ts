import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byUrgency, checkLoad, shelfStatus } from './dispatch.ts'

test('a truck within 5% of the order matches; short is a part delivery; beyond 5% is over', () => {
  assert.deepEqual(checkLoad({ ordered: 3000, shippedBefore: 0, truck: 3060 }), { kind: 'match', total: 3060, diffPct: 2 })
  assert.deepEqual(checkLoad({ ordered: 3000, shippedBefore: 1000, truck: 1100 }), { kind: 'part', total: 2100, toFollow: 900 })
  assert.deepEqual(checkLoad({ ordered: 3000, shippedBefore: 2000, truck: 1300 }), { kind: 'over', total: 3300, overBy: 300, overPct: 10 })
})

test('finished fabric is flagged when overdue, nearly due, or left waiting', () => {
  const base = { ordered: 3000, shipped: 0, onShelf: 3060, finishedAt: '2026-10-01', today: '2026-10-10' }
  assert.equal(shelfStatus({ ...base, deadline: '2026-10-09' }).flag, 'overdue')
  assert.equal(shelfStatus({ ...base, deadline: '2026-10-12' }).flag, 'due-soon')
  const s = shelfStatus({ ...base, deadline: '2026-10-30' })
  assert.deepEqual([s.flag, s.waitingDays, s.complete], ['waiting', 9, true])
  // part of the order still in production is not "forgotten"
  assert.equal(shelfStatus({ ...base, onShelf: 1100, deadline: '2026-10-30' }).flag, null)
})

test('most urgent first', () => {
  const rows = [
    { flag: null, deadline: '2026-10-11' },
    { flag: 'waiting' as const, deadline: '2026-10-30' },
    { flag: 'overdue' as const, deadline: '2026-10-01' },
  ]
  assert.deepEqual([...rows].sort(byUrgency).map((r) => r.flag), ['overdue', 'waiting', null])
})

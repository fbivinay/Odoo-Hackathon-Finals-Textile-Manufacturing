import assert from 'node:assert/strict'
import { test } from 'node:test'
import { costPerMetreOf, summariseWaste, type WasteRoll } from './waste.ts'

let n = 0
const roll = (qty: number, results: ('PASS' | 'REWORK' | 'REJECT')[], defect: string | null = null, extra: Partial<WasteRoll> = {}): WasteRoll => {
  n += 1
  return {
    id: `r${n}`, rollNo: `ROLL-${n}`, qty, status: '', createdAt: '2026-10-05T08:00:00Z', jobId: 'job1', orderId: 'o1',
    order: { orderNo: 'ORD-1', fabricType: 'Poplin' }, machine: { id: 'm1', code: 'DY-01' },
    qcRecords: results.map((result, i) => ({ result, defectType: result === 'PASS' ? null : defect, checkedAt: `2026-10-0${6 + i}T08:00:00Z` })),
    ...extra,
  }
}

test('rejected counted once; rework split into recovered, open and later rejected', () => {
  const s = summariseWaste(
    [
      roll(1000, ['PASS']),
      roll(500, ['REJECT'], 'Holes'),
      roll(400, ['REWORK', 'PASS'], 'Stains'),
      roll(300, ['REWORK', 'REJECT'], 'Shade variation'),
      roll(200, ['REWORK'], 'Colour mismatch'),
      roll(100, []), // waiting for QC
    ],
    new Map(),
  )
  assert.equal(s.produced, 2500)
  assert.equal(s.pendingQc, 100)
  assert.equal(s.checked, 2400)
  assert.equal(s.rejected, 800) // 500 + 300, the reworked-then-rejected roll is not added twice
  assert.equal(s.reworked, 900)
  assert.equal(s.reworkRecovered, 400)
  assert.equal(s.reworkOpen, 200)
  assert.equal(s.reworkThenRejected, 300)
  assert.equal(s.rejectPct, 33.3) // 800 / 2400
  assert.equal(s.reworkPct, 37.5)
})

test('waiting rolls are left out of rates; no checks gives no rate instead of 0%', () => {
  const s = summariseWaste([roll(100, [])], new Map())
  assert.equal(s.rejectPct, null)
  assert.equal(s.checked, 0)
})

test('defects are attributed to the stage they start in', () => {
  const s = summariseWaste([roll(100, ['REJECT'], 'Holes'), roll(50, ['REJECT'], 'Stains'), roll(10, ['REJECT'], null)], new Map())
  const by = Object.fromEntries(s.byStage.map((b) => [b.key, b.rejected]))
  assert.deepEqual(by, { WEAVING: 100, DYEING: 50, UNSPECIFIED: 10 })
})

test('reject cost uses the order cost per metre; orders without a basis are flagged, not guessed', () => {
  const costs = costPerMetreOf([
    { id: 'o1', materialCost: 9000, labourCost: 1000, goodQty: 900, rejectedQty: 100 },
    { id: 'o2', materialCost: 500, labourCost: 0, goodQty: 0, rejectedQty: 0 },
  ])
  assert.equal(costs.get('o1'), 10)
  assert.equal(costs.has('o2'), false)
  const s = summariseWaste([roll(100, ['REJECT'], 'Holes'), roll(100, ['REJECT'], 'Holes', { orderId: 'o2' })], costs)
  assert.equal(s.rejectCost, 1000)
  assert.equal(s.costedShare, 0.5)
})

test('highest-waste jobs rank by rejected + reworked metres', () => {
  const s = summariseWaste([roll(100, ['REJECT'], 'Holes', { jobId: 'a' }), roll(300, ['REWORK', 'PASS'], 'Stains', { jobId: 'b' }), roll(500, ['PASS'], null, { jobId: 'c' })], new Map())
  assert.deepEqual(s.byJob.map((j) => j.key), ['b', 'a'])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addDays, checkCommitment, estimateDelivery, type PlanInput } from './deadline.ts'

// 2026-10-12 is a Monday.
const plan = (load = 0, overrides: Partial<PlanInput> = {}): PlanInput => ({
  today: '2026-10-12',
  horizonDays: 90,
  perDay: { SPINNING: 1000, WEAVING: 2000, DYEING: 4000 },
  usable: { SPINNING: 3, WEAVING: 8, DYEING: 3 },
  weeklyLoad: [
    { weekStart: '2026-10-12', SPINNING: { load: load * 1000 * 6 }, WEAVING: { load: load * 2000 * 6 }, DYEING: { load: load * 4000 * 6 } },
  ],
  ...overrides,
})
const work = { yarnKg: 500, metres: 2000, reworkRate: 0, yarnShortKg: 0 }

test('empty mill: stages run back to back, then QC and dispatch prep', () => {
  const e = estimateDelivery(plan(), work)
  assert.equal(e.ok, true)
  assert.deepEqual(e.stages.map((s) => [s.stage, s.start, s.end]), [
    ['SPINNING', '2026-10-12', '2026-10-12'],
    ['WEAVING', '2026-10-12', '2026-10-12'],
    ['DYEING', '2026-10-12', '2026-10-12'],
  ])
  assert.equal(e.qcDay, '2026-10-13')
  assert.equal(e.date, '2026-10-14')
})

test('more metres take longer', () => {
  const small = estimateDelivery(plan(), work).date!
  const big = estimateDelivery(plan(), { ...work, yarnKg: 2500, metres: 10000 }).date!
  assert.ok(big > small, `${big} should be after ${small}`)
})

test('existing workload pushes the date out and is reported', () => {
  const quiet = estimateDelivery(plan(0), work)
  const busy = estimateDelivery(plan(0.9), { ...work, metres: 6000, yarnKg: 1500 })
  assert.ok(busy.date! > quiet.date!)
  assert.ok(busy.constraints.some((c) => /takes \d+ days/.test(c)))
})

test('a fully booked week makes the order wait for the next week', () => {
  const e = estimateDelivery(plan(1), work)
  assert.equal(e.stages[0].start, '2026-10-19') // next Monday
  assert.ok(e.stages[0].waitDays >= 5)
  assert.match(e.constraints[0], /waits \d+ working days/)
})

test('Sundays are never scheduled', () => {
  const e = estimateDelivery(plan(), { ...work, yarnKg: 6500 }) // 6.5 days of spinning
  assert.equal(e.stages[0].end, '2026-10-19') // Mon..Sat is six days, Sunday skipped
  for (const s of e.stages) assert.notEqual(new Date(`${s.start}T00:00:00Z`).getUTCDay(), 0)
})

test('rework allowance adds dyeing time', () => {
  const plain = estimateDelivery(plan(), { ...work, metres: 7900 })
  const rework = estimateDelivery(plan(), { ...work, metres: 7900, reworkRate: 0.1 })
  assert.ok(rework.stages[2].qty > plain.stages[2].qty)
})

test('yarn shortage holds spinning for the 7-day delivery lead time', () => {
  const e = estimateDelivery(plan(), { ...work, yarnShortKg: 300 })
  assert.equal(e.stages[0].start, '2026-10-19') // today + 7 days
  assert.match(e.constraints[0], /short by 300 kg.*waits 7 days/)
  assert.ok(e.date! > estimateDelivery(plan(), work).date!)
})

test('a repaired machine adds its capacity back from its return day', () => {
  const noWeaving = plan(0, { perDay: { SPINNING: 1000, WEAVING: 0, DYEING: 4000 } })
  const back = estimateDelivery({ ...noWeaving, returning: { SPINNING: [], WEAVING: [{ fromDay: 2, perDay: 2000 }], DYEING: [] } }, work)
  assert.equal(back.ok, true)
  assert.equal(back.stages[1].start, '2026-10-14') // weaving resumes on day 2
})

test('no reliable date: missing quantity, no capacity, beyond the plan', () => {
  assert.equal(estimateDelivery(plan(), { ...work, metres: 0 }).ok, false)
  const down = estimateDelivery(plan(0, { perDay: { SPINNING: 1000, WEAVING: 0, DYEING: 4000 } }), work)
  assert.equal(down.ok, false)
  assert.match(down.limitation!, /No weaving capacity/)
  const huge = estimateDelivery(plan(0, { horizonDays: 10 }), { ...work, yarnKg: 50000 })
  assert.equal(huge.ok, false)
  assert.match(huge.limitation!, /cannot fit/)
})

test('commitment: 0 and 7 days later are allowed, earlier and 8 days are not', () => {
  const est = '2026-10-20'
  assert.equal(checkCommitment(est, est), null)
  assert.equal(checkCommitment(est, addDays(est, 1)), null)
  assert.equal(checkCommitment(est, addDays(est, 7)), null)
  assert.match(checkCommitment(est, addDays(est, 8))!, /at most 7 days/)
  assert.match(checkCommitment(est, addDays(est, -1))!, /earlier/)
})

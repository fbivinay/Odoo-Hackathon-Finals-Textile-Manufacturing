import assert from 'node:assert/strict'
import { test } from 'node:test'
import { quote, type Rule } from './pricing.ts'

const rules: Rule[] = [
  { id: 'a', kind: 'QUANTITY', below: 1000, pricePct: 5, wastagePct: 2 },
  { id: 'b', kind: 'QUANTITY', below: 500, pricePct: 10, wastagePct: 3 },
  { id: 'c', kind: 'DEADLINE', below: 14, pricePct: 8, wastagePct: 0 },
]
const spec = { yarnPerMetre: 0.1, wastagePct: 5, pricePerMetre: 100 }

test('a normal order uses the fabric figures', () => {
  const q = quote(spec, rules, { qty: 3000, daysToDeadline: 30 })
  assert.deepEqual([q.yarnKg, q.price, q.applied.length], [315, 100, 0])
})

test('the tightest size band and a rush band add up', () => {
  const q = quote(spec, rules, { qty: 400, daysToDeadline: 10 })
  assert.deepEqual(q.applied.map((r) => r.id), ['b', 'c'])
  assert.equal(q.price, 118) // +10% small, +8% rush
  assert.equal(q.yarnKg, 43) // 400 x 0.1 x 1.08
})

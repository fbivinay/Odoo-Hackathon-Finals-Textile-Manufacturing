import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toOrder } from './reorder.ts'

test('orders what open orders need plus a refill to the warning level, rounded up', () => {
  assert.equal(toOrder({ qtyInStock: 300, reorderLevel: 800 }), 500)
  assert.equal(toOrder({ qtyInStock: 3000, reorderLevel: 800 }, 2500), 300)
  assert.equal(toOrder({ qtyInStock: 795, reorderLevel: 800 }), 10)
  assert.equal(toOrder({ qtyInStock: 3000, reorderLevel: 800 }, 1000), 0)
  // already ordered and on its way
  assert.equal(toOrder({ qtyInStock: 300, reorderLevel: 800 }, 0, 500), 0)
})

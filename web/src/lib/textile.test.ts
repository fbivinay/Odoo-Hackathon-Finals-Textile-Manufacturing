import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deriveStatus, yarnNeed } from './textile.ts'

test('yarn need nets out what was already issued', () => {
  assert.deepEqual(yarnNeed(500, 0, 300), { remaining: 500, shortBy: 200 })
  assert.deepEqual(yarnNeed(500, 200, 300), { remaining: 300, shortBy: 0 })
  assert.deepEqual(yarnNeed(500, 500, 0), { remaining: 0, shortBy: 0 })
})

const job = (stage: 'SPINNING' | 'WEAVING' | 'DYEING', status: 'RUNNING' | 'COMPLETED', startedAt: string) => ({ stage, status, startedAt })

test('order status follows the floor', () => {
  assert.equal(deriveStatus('PENDING', 100, [], []), 'PENDING')
  assert.equal(deriveStatus('PENDING', 100, [job('SPINNING', 'RUNNING', '1')], []), 'SPINNING')
  assert.equal(deriveStatus('SPINNING', 100, [job('SPINNING', 'COMPLETED', '1')], []), 'SPINNING')
  assert.equal(deriveStatus('DYEING', 100, [job('DYEING', 'COMPLETED', '3')], [{ status: 'PENDING_QC', qty: 60 }]), 'QC')
  assert.equal(deriveStatus('QC', 100, [], [{ status: 'PASSED', qty: 60 }, { status: 'DISPATCHED', qty: 40 }]), 'READY')
  assert.equal(deriveStatus('READY', 100, [], [{ status: 'DISPATCHED', qty: 100 }]), 'DISPATCHED')
  assert.equal(deriveStatus('CANCELLED', 100, [job('WEAVING', 'RUNNING', '1')], []), 'CANCELLED')
})

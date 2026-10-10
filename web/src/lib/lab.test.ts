import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describe, show } from './lab.ts'

test('figures show with their unit; INR is rupees', () => {
  assert.equal(show(null, 'm'), '—')
  assert.equal(show(12.345, '%'), '12.3%')
  assert.equal(show(2500000, 'INR'), '₹25.0 L')
  assert.equal(show(1234, 'm'), '1,234 m')
})

test('changes read as plain sentences', () => {
  const lines = describe(
    { addMachines: [{ stage: 'WEAVING', count: 2, fromDay: 7 }], sundays: true, breakdowns: [{ machineId: 'x', days: 5 }], qc: { rejectPct: 3 } },
    { machine: () => 'WV-05' },
  )
  assert.deepEqual(lines, ['Add 2 weaving machines from day 7', 'WV-05 down for 5 days', 'Work Sundays', 'Reject rate 3%'])
})

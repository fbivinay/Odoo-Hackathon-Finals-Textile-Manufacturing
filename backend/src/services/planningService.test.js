// node --test: the planner is pure, so it runs on a hand-made snapshot without a database.
const test = require('node:test');
const assert = require('node:assert');
const { plan } = require('./planningService');

const order = (n, qty, deadline, extra = {}) => ({
  id: `o${n}`, orderNo: `ORD-${n}`, buyer: { id: 'b', name: 'B' }, fabricType: 'Denim', colour: 'Blue',
  qty, yarnRequired: qty * 0.2, pricePerUnit: 100, materialId: 'y1', status: 'PENDING',
  deadline: new Date(`${deadline}T00:00:00.000Z`), issued: 0, done: { SPINNING: 0, WEAVING: 0, DYEING: 0 }, ...extra,
});
const snap = () => ({
  takenAt: '2026-10-12T00:00:00.000Z',
  today: '2026-10-12', // a Monday
  qcDays: 1,
  stageAverage: { SPINNING: 600, WEAVING: 1500, DYEING: 3000 },
  machines: [
    { id: 'sp1', code: 'SP-01', type: 'SPINNING', status: 'RUNNING', perDay: 600 },
    { id: 'wv1', code: 'WV-01', type: 'WEAVING', status: 'RUNNING', perDay: 1500 },
    { id: 'wv2', code: 'WV-02', type: 'WEAVING', status: 'IDLE', perDay: 1500 },
    { id: 'dy1', code: 'DY-01', type: 'DYEING', status: 'RUNNING', perDay: 3000 },
  ],
  orders: [order(1, 6000, '2026-10-20'), order(2, 9000, '2026-10-28'), order(3, 12000, '2026-11-10')],
  materials: [{ id: 'y1', yarnType: 'Cotton', colour: 'Raw', unit: 'kg', category: 'YARN', qtyInStock: 3000, leadDays: 5 }],
});
const readyOf = (r) => Object.fromEntries(r.orders.map((o) => [o.id, o.expectedReady]));
const later = (a, b) => (a === null ? b !== null : b !== null && a > b); // is a later than b

test('same snapshot and changes give the same plan', () => {
  const s = snap();
  const changes = { addMachines: [{ stage: 'WEAVING', count: 2, fromDay: 3, rampDays: 5 }], sundays: true };
  assert.deepStrictEqual(plan(s, changes, 90), plan(s, changes, 90));
  assert.deepStrictEqual(s, snap(), 'plan must not change its snapshot');
});

test('adding machines never makes an order later', () => {
  const base = readyOf(plan(snap(), {}, 90));
  for (const stage of ['SPINNING', 'WEAVING', 'DYEING']) {
    const alt = readyOf(plan(snap(), { addMachines: [{ stage, count: 1 }] }, 90));
    for (const id of Object.keys(base)) assert.ok(!later(alt[id], base[id]), `${stage} ${id}`);
  }
});

test('a breakdown never makes an order earlier', () => {
  const base = readyOf(plan(snap(), {}, 90));
  const alt = readyOf(plan(snap(), { breakdowns: [{ machineId: 'wv1', days: 10 }] }, 90));
  for (const id of Object.keys(base)) assert.ok(!later(base[id], alt[id]), id);
  const cap = plan(snap(), { breakdowns: [{ machineId: 'wv1', days: 10 }] }, 90).capacity.WEAVING;
  assert.strictEqual(cap.usable, 1);
  assert.deepStrictEqual(cap.returning.map((m) => m.fromDay), [10]);
});

test('Sunday working never makes an order later and adds capacity', () => {
  const base = plan(snap(), {}, 28);
  const alt = plan(snap(), { sundays: true }, 28);
  for (const [id, day] of Object.entries(readyOf(base))) assert.ok(!later(readyOf(alt)[id], day), id);
  const total = (r) => r.weeklyLoad.reduce((t, w) => t + w.WEAVING.capacity, 0);
  assert.ok(total(alt) > total(base));
});

test('a rush order joins the queue by deadline and uses capacity', () => {
  const rush = { fabricType: 'Denim', qty: 5000, yarnRequired: 1000, pricePerUnit: 120, deadline: '2026-10-25', materialId: 'y1' };
  const r = plan(snap(), { rushOrder: rush }, 90);
  assert.deepStrictEqual(r.orders.map((o) => o.id), ['o1', 'what-if-rush', 'o2', 'o3']);
  assert.strictEqual(r.summary.openOrders, 4);
});

test('less yarn in stock or a longer delivery never helps', () => {
  const base = readyOf(plan(snap(), {}, 90));
  const alt = readyOf(plan(snap(), { materials: [{ materialId: 'y1', stockChange: -3000, extraLeadDays: 10 }] }, 90));
  for (const id of Object.keys(base)) assert.ok(!later(base[id], alt[id]), id);
});

test('more work per metre (rejects) never helps', () => {
  const base = readyOf(plan(snap(), {}, 90));
  const alt = readyOf(plan(snap(), { workFactor: 1.2 }, 90));
  for (const id of Object.keys(base)) assert.ok(!later(base[id], alt[id]), id);
});

test('a machine added later ramps up instead of jumping to full output', () => {
  const r = plan(snap(), { addMachines: [{ stage: 'DYEING', count: 1, fromDay: 7, rampDays: 7 }] }, 28);
  const caps = r.weeklyLoad.map((w) => w.DYEING.capacity);
  assert.ok(caps[0] < caps[1] && caps[1] < caps[2], caps.join(','));
});

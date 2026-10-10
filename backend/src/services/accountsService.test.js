// node --test: monthShare is pure date arithmetic; no database is touched.
const test = require('node:test');
const assert = require('node:assert');
const { monthShare, todayIst } = require('./accountsService');

test('monthly costs count for the share of their month inside the period', () => {
  const p = (from, to) => ({ from, to });
  assert.equal(monthShare('2026-08', p('2026-07-14', '2026-09-30')), 1);
  assert.equal(monthShare('2026-07', p('2026-07-14', '2026-09-30')), 18 / 31);
  assert.equal(monthShare('2026-02', p('2026-02-10', '2026-02-10')), 1 / 28);
  assert.equal(monthShare('2026-03', p('2026-02-10', '2026-02-20')), 0);
  // The current month is booked to date, so a period running to today carries all of it.
  const today = todayIst();
  assert.equal(monthShare(today.slice(0, 7), p(`${today.slice(0, 7)}-01`, today)), 1);
});

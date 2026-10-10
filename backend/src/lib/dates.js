const { badRequest } = require('./errors');

// 'YYYY-MM' (defaults to the current month) → [start, end) in UTC
function monthRange(month) {
  const value = month || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw badRequest('month must be YYYY-MM');
  const [y, m] = value.split('-').map(Number);
  return { month: value, start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// 'YYYY-MM-DD' (defaults to today) → the UTC-midnight Date stored in @db.Date columns
function dateOnly(value) {
  const str = value || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) throw badRequest('date must be YYYY-MM-DD');
  return new Date(`${str}T00:00:00.000Z`);
}

module.exports = { monthRange, startOfToday, dateOnly };

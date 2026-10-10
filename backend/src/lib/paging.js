const { badRequest } = require('./errors');

const MAX_LIMIT = 500;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// A list plus paging info; handle() sends it as { ok, data, meta }.
class Page {
  constructor(data, meta) {
    this.data = data;
    this.meta = meta;
  }
}

function parseLimit(limit) {
  if (limit === undefined || limit === '') return null;
  const value = Number(limit);
  if (!Number.isInteger(value) || value < 1) throw badRequest('limit must be a positive whole number');
  return Math.min(value, MAX_LIMIT);
}

// ?limit=&cursor= → Prisma take/cursor. Without limit the whole list is returned.
// One extra row is fetched to learn whether another page exists.
function pageArgs({ limit, cursor } = {}) {
  const take = parseLimit(limit);
  if (!take) return {};
  return { take: take + 1, ...(cursor && { cursor: { id: String(cursor) }, skip: 1 }) };
}

function toPage(rows, { limit } = {}) {
  const take = parseLimit(limit);
  const hasMore = Boolean(take) && rows.length > take;
  const data = hasMore ? rows.slice(0, take) : rows;
  return new Page(data, { count: data.length, nextCursor: hasMore ? data[data.length - 1].id : null });
}

function parseDate(value, name) {
  const date = new Date(DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) throw badRequest(`${name} must be YYYY-MM-DD or an ISO date`);
  return date;
}

// ?from=&to= → Prisma date filter. A date-only `to` includes that whole day.
function dateRange(from, to, names = ['from', 'to']) {
  if (!from && !to) return undefined;
  const range = {};
  if (from) range.gte = parseDate(from, names[0]);
  if (to) {
    const end = parseDate(to, names[1]);
    if (DATE_ONLY.test(to)) end.setUTCDate(end.getUTCDate() + 1);
    range[DATE_ONLY.test(to) ? 'lt' : 'lte'] = end;
  }
  return range;
}

module.exports = { Page, pageArgs, toPage, dateRange };

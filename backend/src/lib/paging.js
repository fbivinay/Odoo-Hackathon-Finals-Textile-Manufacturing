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

// Two ways to page a list, both with ?limit=:
//   ?cursor=  keyset paging for "load more" (one extra row is fetched to learn whether more exist)
//   ?page=    numbered pages, 1-based; the answer then carries the total so a pager can be drawn
// Without limit the whole list is returned.
function parsePage(page) {
  if (page === undefined || page === '') return null;
  const value = Number(page);
  if (!Number.isInteger(value) || value < 1) throw badRequest('page must be a positive whole number');
  return value;
}

function pageArgs({ limit, cursor, page } = {}) {
  const take = parseLimit(limit);
  if (!take) return {};
  const number = parsePage(page);
  if (number) return { take, skip: (number - 1) * take };
  return { take: take + 1, ...(cursor && { cursor: { id: String(cursor) }, skip: 1 }) };
}

// `total` is the size of the whole match; pass it when ?page= was asked for (see countFor).
function toPage(rows, { limit, page } = {}, total) {
  const take = parseLimit(limit);
  const number = take ? parsePage(page) : null;
  if (number) return new Page(rows, { count: rows.length, total: total ?? rows.length, page: number, pages: Math.max(1, Math.ceil((total ?? rows.length) / take)), limit: take, nextCursor: null });
  const hasMore = Boolean(take) && rows.length > take;
  const data = hasMore ? rows.slice(0, take) : rows;
  return new Page(data, { count: data.length, nextCursor: hasMore ? data[data.length - 1].id : null });
}

// The size of the whole match, counted only when numbered pages were asked for.
const countFor = (delegate, where, query = {}) => (query.page && query.limit ? delegate.count({ where }) : undefined);

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

module.exports = { Page, pageArgs, toPage, countFor, dateRange };

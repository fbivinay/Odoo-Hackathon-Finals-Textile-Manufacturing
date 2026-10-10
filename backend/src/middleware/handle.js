const asyncHandler = require('./asyncHandler');
const { Page } = require('../lib/paging');

// Wraps a function that returns data into the standard { ok, data } envelope.
// Paged lists also carry { meta: { count, nextCursor } }.
const handle = (fn, status = 200) =>
  asyncHandler(async (req, res) => {
    const result = await fn(req);
    if (result instanceof Page) return res.status(status).json({ ok: true, data: result.data, meta: result.meta });
    return res.status(status).json({ ok: true, data: result });
  });

module.exports = handle;

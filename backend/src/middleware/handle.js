const asyncHandler = require('./asyncHandler');

// Wraps a function that returns data into the standard { ok, data } envelope.
const handle = (fn, status = 200) =>
  asyncHandler(async (req, res) => {
    const data = await fn(req);
    res.status(status).json({ ok: true, data });
  });

module.exports = handle;

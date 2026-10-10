const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const handle = require('../middleware/handle');
const orderService = require('../services/orderService');

const router = Router();

// The link is the only credential, so cap how fast anyone can try links: 60 per 15 minutes per IP.
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }));

// Public: the tracking token in the link is the only credential a buyer needs.
router.get('/:token', handle((req) => orderService.track(req.params.token)));

module.exports = router;

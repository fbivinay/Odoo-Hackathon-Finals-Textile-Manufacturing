const { Router } = require('express');
const handle = require('../middleware/handle');
const orderService = require('../services/orderService');

const router = Router();

// Public: the tracking token in the link is the only credential a buyer needs.
router.get('/:token', handle((req) => orderService.track(req.params.token)));

module.exports = router;

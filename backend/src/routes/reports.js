const { Router } = require('express');
const handle = require('../middleware/handle');
const { requireAuth, requireRole } = require('../middleware/auth');
const reportService = require('../services/reportService');

const router = Router();
router.use(requireAuth);

const owner = requireRole();

router.get('/dashboard/summary', handle(() => reportService.summary()));
router.get('/reports/order-costs', owner, handle(() => reportService.orderCosts()));
router.get('/reports/machine-output', owner, handle((req) => reportService.machineOutput(req.query)));
router.get('/reports/pnl', owner, handle((req) => reportService.pnl(req.query)));

module.exports = router;

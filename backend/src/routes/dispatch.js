const { Router } = require('express');
const handle = require('../middleware/handle');
const { requireAuth, requireRole } = require('../middleware/auth');
const dispatchService = require('../services/dispatchService');
const { dispatchSchema, paymentSchema } = require('../validators/dispatchValidators');

const router = Router();
router.use(requireAuth);

const desk = requireRole('DISPATCH');

router.get('/dispatch/stock', handle(() => dispatchService.stock()));
router.get('/dispatch', handle((req) => dispatchService.list(req.query)));
router.post('/dispatch', desk, handle((req) => dispatchService.create(dispatchSchema.parse(req.body)), 201));
router.get('/dispatch/:id', handle((req) => dispatchService.get(req.params.id)));

router.get('/invoices', handle((req) => dispatchService.listInvoices(req.query)));
router.post('/invoices/:id/payments', desk, handle((req) => dispatchService.addPayment(req.params.id, paymentSchema.parse(req.body)), 201));

module.exports = router;

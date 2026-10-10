const { Router } = require('express');
const handle = require('../middleware/handle');
const { requireAuth, requireRole } = require('../middleware/auth');
const orderService = require('../services/orderService');
const { createOrderSchema, orderStatusSchema, cancelOrderSchema } = require('../validators/orderValidators');

const router = Router();
router.use(requireAuth);

router.get('/', handle((req) => orderService.list(req.query)));
router.post('/', requireRole('STORE', 'DISPATCH'), handle((req) => orderService.create(createOrderSchema.parse(req.body)), 201));
router.get('/:id', handle((req) => orderService.get(req.params.id)));
router.patch('/:id/status', requireRole(), handle((req) => orderService.updateStatus(req.params.id, orderStatusSchema.parse(req.body).status)));
router.post('/:id/cancel', requireRole(), handle((req) => orderService.cancel(req.params.id, cancelOrderSchema.parse(req.body))));

module.exports = router;

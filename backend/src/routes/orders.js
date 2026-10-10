const { Router } = require('express');
const handle = require('../middleware/handle');
const { requireAuth, requireRole } = require('../middleware/auth');
const orderService = require('../services/orderService');
const { createOrderSchema, orderStatusSchema } = require('../validators/orderValidators');

const router = Router();
router.use(requireAuth);

router.get('/', handle((req) => orderService.list(req.query)));
router.post('/', requireRole('STORE', 'DISPATCH'), handle((req) => orderService.create(createOrderSchema.parse(req.body)), 201));
router.get('/:id', handle((req) => orderService.get(req.params.id)));
router.patch('/:id/status', requireRole(), handle((req) => orderService.updateStatus(req.params.id, orderStatusSchema.parse(req.body).status)));

module.exports = router;

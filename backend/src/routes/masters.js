const { Router } = require('express');
const handle = require('../middleware/handle');
const { requireAuth, requireRole } = require('../middleware/auth');
const masterService = require('../services/masterService');
const { supplierSchema, buyerSchema } = require('../validators/masterValidators');

const router = Router();
router.use(requireAuth);

router.get('/suppliers', handle(() => masterService.listSuppliers()));
router.post('/suppliers', requireRole('STORE'), handle((req) => masterService.createSupplier(supplierSchema.parse(req.body)), 201));

router.get('/buyers', handle(() => masterService.listBuyers()));
router.post('/buyers', requireRole('STORE', 'DISPATCH'), handle((req) => masterService.createBuyer(buyerSchema.parse(req.body)), 201));

module.exports = router;

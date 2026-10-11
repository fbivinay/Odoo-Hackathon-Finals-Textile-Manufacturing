const { Router } = require('express');
const handle = require('../middleware/handle');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notFound, forbidden } = require('../lib/errors');
const masterService = require('../services/masterService');
const { supplierSchema, buyerSchema, buyerUpdateSchema } = require('../validators/masterValidators');

const router = Router();
router.use(requireAuth);

router.get('/suppliers', handle(() => masterService.listSuppliers()));
router.post('/suppliers', requireRole('STORE'), handle((req) => masterService.createSupplier(supplierSchema.parse(req.body)), 201));

router.get('/buyers', handle(() => masterService.listBuyers()));
router.post('/buyers', requireRole('STORE', 'DISPATCH'), handle((req) => masterService.createBuyer(buyerSchema.parse(req.body)), 201));
// A client's delivery address or phone: the desks that take orders, or anyone given the Clients tab.
const canEditBuyer = (req, res, next) => {
  const u = req.user;
  if (u.role === 'OWNER' || u.roles.some((r) => ['STORE', 'DISPATCH'].includes(r)) || u.tabs.includes('/clients')) return next();
  throw forbidden('You do not have access to this resource');
};
router.patch('/buyers/:id', canEditBuyer, handle(async (req) => (await masterService.updateBuyer(req.params.id, buyerUpdateSchema.parse(req.body))) || Promise.reject(notFound('Client not found'))));

module.exports = router;

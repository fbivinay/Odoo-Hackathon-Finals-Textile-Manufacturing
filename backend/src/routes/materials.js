const { Router } = require('express');
const handle = require('../middleware/handle');
const { requireAuth, requireRole } = require('../middleware/auth');
const materialService = require('../services/materialService');
const v = require('../validators/materialValidators');

const router = Router();
router.use(requireAuth);

router.get('/', handle((req) => materialService.list(req.query)));
router.post('/', requireRole('STORE'), handle((req) => materialService.create(v.createMaterialSchema.parse(req.body)), 201));

router.get('/inwards', handle((req) => materialService.listInwards(req.query)));
router.post('/inwards', requireRole('STORE'), handle((req) => materialService.inward(v.inwardSchema.parse(req.body), req.user.id), 201));

router.get('/issues', handle((req) => materialService.listIssues(req.query)));
router.post('/issues', requireRole('STORE'), handle((req) => materialService.issue(v.issueSchema.parse(req.body)), 201));

router.get('/purchase-orders', handle((req) => materialService.listPurchaseOrders(req.query)));
router.post('/purchase-orders', requireRole('STORE'), handle((req) => materialService.placeOrders(v.purchaseOrderSchema.parse(req.body).lines, req.user.id), 201));
router.post('/purchase-orders/:id/receive', requireRole('STORE'), handle((req) => materialService.receiveOrder(req.params.id, v.receiveSchema.parse(req.body || {}), req.user.id)));
router.post('/purchase-orders/:id/cancel', requireRole('STORE'), handle((req) => materialService.cancelOrder(req.params.id)));

router.patch('/:id', requireRole('STORE'), handle((req) => materialService.update(req.params.id, v.updateMaterialSchema.parse(req.body))));

module.exports = router;

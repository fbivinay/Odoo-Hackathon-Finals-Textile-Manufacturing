const { Router } = require('express');
const handle = require('../middleware/handle');
const { requireAuth, requireRole } = require('../middleware/auth');
const qcService = require('../services/qcService');
const { inspectSchema } = require('../validators/qcValidators');

const router = Router();
router.use(requireAuth);

router.get('/summary', handle((req) => qcService.summary(req.query)));
router.get('/rolls', handle((req) => qcService.listRolls(req.query)));
router.get('/rolls/:id', handle((req) => qcService.getRoll(req.params.id)));
router.post('/rolls/:id/inspect', requireRole('QC'), handle((req) => qcService.inspect(req.params.id, inspectSchema.parse(req.body), req.user.id), 201));

module.exports = router;

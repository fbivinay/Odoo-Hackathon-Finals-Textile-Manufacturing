const { Router } = require('express');
const handle = require('../middleware/handle');
const { requireAuth, requireRole } = require('../middleware/auth');
const productionService = require('../services/productionService');
const v = require('../validators/productionValidators');

const router = Router();
router.use(requireAuth);

const floor = requireRole('PRODUCTION');

router.get('/machines', handle(() => productionService.listMachines()));
router.post('/machines', requireRole(), handle((req) => productionService.createMachine(v.machineSchema.parse(req.body)), 201));
router.patch('/machines/:id/status', floor, handle((req) => productionService.setMachineStatus(req.params.id, v.machineStatusSchema.parse(req.body).status)));

router.get('/production/board', handle(() => productionService.board()));
router.get('/production/jobs', handle((req) => productionService.listJobs(req.query)));
router.post('/production/jobs', floor, handle((req) => productionService.startJob(v.startJobSchema.parse(req.body)), 201));
router.post('/production/jobs/:id/progress', floor, handle((req) => productionService.logProgress(req.params.id, v.progressSchema.parse(req.body))));
router.post('/production/jobs/:id/complete', floor, handle((req) => productionService.finishJob(req.params.id, 'COMPLETED')));
router.post('/production/jobs/:id/stop', floor, handle((req) => productionService.finishJob(req.params.id, 'STOPPED')));
router.post('/production/rolls', floor, handle((req) => productionService.createRoll(v.rollSchema.parse(req.body)), 201));

module.exports = router;

const { Router } = require('express');
const handle = require('../middleware/handle');
const { requireAuth, requireRole, requireTab } = require('../middleware/auth');
const workforceService = require('../services/workforceService');
const v = require('../validators/workforceValidators');

const router = Router();
router.use(requireAuth);

const floor = requireRole('PRODUCTION');
const owner = requireRole();

router.get('/workers', handle(() => workforceService.listWorkers()));
router.get('/workers/roster', owner, handle(() => workforceService.roster()));
// The worker list is part of Mill Setup: the owner, or someone given that tab.
const setup = requireTab('/config');
router.post('/workers', setup, handle((req) => workforceService.createWorker(v.workerSchema.parse(req.body), req.user), 201));
router.patch('/workers/:id', setup, handle((req) => workforceService.updateWorker(req.params.id, v.updateWorkerSchema.parse(req.body), req.user)));
router.delete('/workers/:id', setup, handle((req) => workforceService.removeWorker(req.params.id, req.user)));

router.get('/attendance', floor, handle((req) => workforceService.attendance(req.query)));
router.post('/attendance', floor, handle((req) => workforceService.markAttendance(v.attendanceSchema.parse(req.body))));

router.get('/wages', owner, handle((req) => workforceService.wages(req.query)));
router.post('/wages/pay', owner, handle((req) => workforceService.payWages(v.payWagesSchema.parse(req.body))));

module.exports = router;

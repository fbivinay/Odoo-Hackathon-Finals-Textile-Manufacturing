const { Router } = require('express');
const handle = require('../middleware/handle');
const { requireAuth, requireRole } = require('../middleware/auth');
const workforceService = require('../services/workforceService');
const v = require('../validators/workforceValidators');

const router = Router();
router.use(requireAuth);

const floor = requireRole('PRODUCTION');
const owner = requireRole();

router.get('/workers', handle(() => workforceService.listWorkers()));
router.post('/workers', owner, handle((req) => workforceService.createWorker(v.workerSchema.parse(req.body)), 201));
router.patch('/workers/:id', owner, handle((req) => workforceService.updateWorker(req.params.id, v.updateWorkerSchema.parse(req.body))));

router.get('/attendance', floor, handle((req) => workforceService.attendance(req.query)));
router.post('/attendance', floor, handle((req) => workforceService.markAttendance(v.attendanceSchema.parse(req.body))));

router.get('/wages', owner, handle((req) => workforceService.wages(req.query)));
router.post('/wages/pay', owner, handle((req) => workforceService.payWages(v.payWagesSchema.parse(req.body))));

module.exports = router;

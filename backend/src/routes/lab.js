const { Router } = require('express');
const handle = require('../middleware/handle');
const { requireAuth, requireRole } = require('../middleware/auth');
const lab = require('../services/labService');
const v = require('../validators/labValidators');

// Everest Lab is the owner's: it reads profit, wages and costs. Simulations are read-only POSTs.
const router = Router();
router.use(requireAuth, requireRole());

router.get('/intelligence', handle((req) => lab.intelligence(req.query)));
router.get('/options', handle(() => lab.options()));
router.post('/simulate', handle((req) => lab.simulate(v.simulateSchema.parse(req.body))));
// Explains a fresh run of the same inputs, so only figures the server computed reach the model.
router.post('/explain', handle(async (req) => lab.explain(await lab.simulate(v.simulateSchema.parse(req.body)))));
router.get('/scenarios', handle(() => lab.listScenarios()));
router.post('/scenarios', handle((req) => lab.createScenario(v.scenarioSchema.parse(req.body), req.user), 201));
router.get('/scenarios/:id', handle((req) => lab.getScenario(req.params.id)));
router.get('/scenarios/:id/history', handle((req) => lab.history(req.params.id)));
router.patch('/scenarios/:id', handle((req) => lab.updateScenario(req.params.id, v.scenarioPatchSchema.parse(req.body), req.user)));
router.post('/scenarios/:id/run', handle((req) => lab.runScenario(req.params.id, req.user)));
router.delete('/scenarios/:id', handle((req) => lab.deleteScenario(req.params.id, req.user)));

module.exports = router;

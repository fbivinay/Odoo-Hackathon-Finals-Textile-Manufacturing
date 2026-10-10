const { Router } = require('express');
const handle = require('../middleware/handle');
const { requireAuth, requireRole } = require('../middleware/auth');
const configService = require('../services/configService');
const v = require('../validators/configValidators');

const router = Router();
router.use(requireAuth);

// Everyone reads the figures (the order form and dispatch checks use them); only the owner edits.
const owner = requireRole();

router.get('/', handle(() => configService.get()));
router.get('/changes', owner, handle((req) => configService.changes(req.query)));
router.put('/fabrics/:fabricType', owner, handle((req) => configService.saveFabric(req.params.fabricType, v.fabricSchema.parse(req.body), req.user)));
router.post('/rules', owner, handle((req) => configService.addRule(v.ruleSchema.parse(req.body), req.user), 201));
router.patch('/rules/:id', owner, handle((req) => configService.updateRule(req.params.id, v.ruleUpdateSchema.parse(req.body), req.user)));
router.delete('/rules/:id', owner, handle((req) => configService.deleteRule(req.params.id, req.user)));
router.put('/settings', owner, handle((req) => configService.saveSettings(v.settingsSchema.parse(req.body), req.user)));
router.patch('/materials/:id', owner, handle((req) => configService.saveMaterial(req.params.id, v.materialConfigSchema.parse(req.body), req.user)));

module.exports = router;

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const handle = require('../middleware/handle');
const assistantService = require('../services/assistantService');
const { chatSchema } = require('../validators/assistantValidators');

const router = Router();
router.use(requireAuth);

// Each question costs a model call, so every person gets a steady but bounded pace.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'TOO_MANY_REQUESTS', message: 'Slow down a little and try again in a minute.' },
});

router.post('/chat', chatLimiter, handle((req) => assistantService.chat(req.user, chatSchema.parse(req.body).messages)));

module.exports = router;

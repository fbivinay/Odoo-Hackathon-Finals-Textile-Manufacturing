const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../middleware/asyncHandler');
const authService = require('../services/authService');
const { requireAuth } = require('../middleware/auth');
const { signinSchema, changePasswordSchema } = require('../validators/authValidators');
const { unauthorized } = require('../lib/errors');

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // roomy enough to switch between the demo logins
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(authLimiter);

router.post(
  '/signin',
  asyncHandler(async (req, res) => {
    // Malformed input (bad email format, empty password) is treated the same as
    // wrong credentials — a login form shouldn't leak field-level validation detail.
    const parsed = signinSchema.safeParse(req.body);
    if (!parsed.success) throw unauthorized('Invalid email or password');

    const data = await authService.signin(parsed.data);
    res.json({ ok: true, data });
  })
);

router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await authService.changePassword(req.user.id, changePasswordSchema.parse(req.body));
    res.json({ ok: true, data });
  })
);

module.exports = router;

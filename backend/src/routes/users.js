const { Router } = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const userService = require('../services/userService');
const { createUserSchema } = require('../validators/authValidators');

const router = Router();

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await userService.getById(req.user.id);
    res.json({ ok: true, data });
  })
);

router.get(
  '/users',
  requireAuth,
  requireRole(),
  asyncHandler(async (req, res) => {
    const data = await userService.list();
    res.json({ ok: true, data });
  })
);

router.post(
  '/users',
  requireAuth,
  requireRole(),
  asyncHandler(async (req, res) => {
    const data = await userService.create(createUserSchema.parse(req.body));
    res.status(201).json({ ok: true, data });
  })
);

module.exports = router;

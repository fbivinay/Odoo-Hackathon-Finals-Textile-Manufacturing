const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { unauthorized, forbidden } = require('../lib/errors');
const { rolesOf } = require('../lib/tabs');
const asyncHandler = require('./asyncHandler');

const PASSWORD_CHANGE_PATHS = ['/api/me', '/api/auth/change-password'];

const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw unauthorized('Missing or malformed Authorization header');
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw unauthorized('Invalid or expired token');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) throw unauthorized('Account no longer exists');
  if (!user.isActive) throw unauthorized('Account has been deactivated');

  // An owner-issued password only opens the door to changing it.
  if (user.mustChangePassword && !PASSWORD_CHANGE_PATHS.includes(req.originalUrl.split('?')[0])) {
    throw forbidden('Set a new password to continue', 'PASSWORD_CHANGE_REQUIRED');
  }

  req.user = { id: user.id, role: user.role, roles: rolesOf(user), name: user.name };
  next();
});

// OWNER passes every role check. An extra tab brings its role's access with it.
const requireRole = (...roles) => (req, res, next) => {
  if (req.user?.role !== 'OWNER' && !roles.some((r) => req.user?.roles.includes(r))) {
    throw forbidden('You do not have access to this resource');
  }
  next();
};

module.exports = { requireAuth, requireRole };

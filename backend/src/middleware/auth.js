const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { unauthorized, forbidden } = require('../lib/errors');
const asyncHandler = require('./asyncHandler');

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

  req.user = { id: user.id, role: user.role, name: user.name };
  next();
});

// OWNER passes every role check.
const requireRole = (...roles) => (req, res, next) => {
  if (req.user?.role !== 'OWNER' && !roles.includes(req.user?.role)) {
    throw forbidden('You do not have access to this resource');
  }
  next();
};

module.exports = { requireAuth, requireRole };

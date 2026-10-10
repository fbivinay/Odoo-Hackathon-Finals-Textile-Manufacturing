const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { unauthorized, badRequest } = require('../lib/errors');

async function signin({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.isActive) throw unauthorized('Invalid email or password');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw unauthorized('Invalid email or password');

  const token = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  });

  return {
    token,
    user: { id: user.id, email: user.email, role: user.role, name: user.name, mustChangePassword: user.mustChangePassword, extraTabs: user.extraTabs },
  };
}

// A forced first-time change skips the current password: the session was just opened with it.
async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user.mustChangePassword) {
    const valid = currentPassword && (await bcrypt.compare(currentPassword, user.passwordHash));
    if (!valid) throw badRequest('Current password is wrong', 'WRONG_PASSWORD');
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw badRequest('Pick a password different from the current one', 'SAME_PASSWORD');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, 10), mustChangePassword: false },
  });
  return { changed: true };
}

module.exports = { signin, changePassword };

const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { notFound, badRequest } = require('../lib/errors');

const publicFields = { id: true, name: true, email: true, role: true, isActive: true, mustChangePassword: true, extraTabs: true, shift: true, createdAt: true };

async function getById(id) {
  const user = await prisma.user.findUnique({ where: { id }, select: publicFields });
  if (!user) throw notFound('User not found');
  return user;
}

async function list() {
  // Active logins first, most recently added or edited on top; deactivated ones sink to the end.
  return prisma.user.findMany({
    select: publicFields,
    orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
  });
}

async function create({ name, email, password, role, extraTabs = [], shift = null }) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.create({
    data: { name, email: email.toLowerCase(), passwordHash, role, extraTabs, shift, mustChangePassword: true },
    select: publicFields,
  });
}

async function update(id, actorId, { password, ...changes }) {
  await getById(id);
  // The owner can't lock themselves out or drop their own access.
  if (id === actorId && (changes.isActive === false || (changes.role && changes.role !== 'OWNER'))) {
    throw badRequest('You cannot change your own role or deactivate yourself', 'OWN_ACCOUNT');
  }

  const data = { ...changes, updatedAt: new Date() };
  if (password) {
    data.passwordHash = await bcrypt.hash(password, 10);
    data.mustChangePassword = true;
  }
  return prisma.user.update({ where: { id }, data, select: publicFields });
}

module.exports = { getById, list, create, update };

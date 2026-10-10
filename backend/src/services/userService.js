const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { notFound } = require('../lib/errors');

const publicFields = { id: true, name: true, email: true, role: true, isActive: true, createdAt: true };

async function getById(id) {
  const user = await prisma.user.findUnique({ where: { id }, select: publicFields });
  if (!user) throw notFound('User not found');
  return user;
}

async function list() {
  return prisma.user.findMany({ select: publicFields, orderBy: { createdAt: 'asc' } });
}

async function create({ name, email, password, role }) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.create({
    data: { name, email: email.toLowerCase(), passwordHash, role },
    select: publicFields,
  });
}

module.exports = { getById, list, create };

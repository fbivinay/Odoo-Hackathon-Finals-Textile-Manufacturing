const { PrismaClient, Prisma } = require('@prisma/client');

// Send Decimal columns as JSON numbers instead of strings.
Prisma.Decimal.prototype.toJSON = function toJSON() {
  return this.toNumber();
};

const prisma = new PrismaClient();

module.exports = prisma;

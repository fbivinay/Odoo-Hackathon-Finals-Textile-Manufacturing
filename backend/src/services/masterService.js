const prisma = require('../lib/prisma');

const listSuppliers = () => prisma.supplier.findMany({ orderBy: { name: 'asc' } });
const createSupplier = (data) => prisma.supplier.create({ data });

const listBuyers = () =>
  prisma.buyer.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { orders: true } } } });
const createBuyer = (data) => prisma.buyer.create({ data });

module.exports = { listSuppliers, createSupplier, listBuyers, createBuyer };

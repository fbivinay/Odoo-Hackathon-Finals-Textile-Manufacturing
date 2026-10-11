const prisma = require('../lib/prisma');

const listSuppliers = () => prisma.supplier.findMany({ orderBy: { name: 'asc' } });
const createSupplier = (data) => prisma.supplier.create({ data });

const listBuyers = () =>
  prisma.buyer.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { orders: true } } } });
const createBuyer = (data) => prisma.buyer.create({ data });
// Null when there is no such client.
const updateBuyer = async (id, data) => ((await prisma.buyer.findUnique({ where: { id } })) ? prisma.buyer.update({ where: { id }, data }) : null);

module.exports = { listSuppliers, createSupplier, listBuyers, createBuyer, updateBuyer };

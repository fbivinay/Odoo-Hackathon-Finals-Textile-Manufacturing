const prisma = require('../lib/prisma');
const { notFound, conflict } = require('../lib/errors');
const { pageArgs, toPage, dateRange } = require('../lib/paging');

const withLowStock = (m) => ({ ...m, lowStock: Number(m.qtyInStock) <= Number(m.reorderLevel) });

async function list({ lowStock } = {}) {
  const materials = await prisma.rawMaterial.findMany({ orderBy: [{ yarnType: 'asc' }, { colour: 'asc' }] });
  const rows = materials.map(withLowStock);
  return lowStock === 'true' ? rows.filter((m) => m.lowStock) : rows;
}

async function create(data) {
  return withLowStock(await prisma.rawMaterial.create({ data }));
}

async function update(id, data) {
  const material = await prisma.rawMaterial.findUnique({ where: { id } });
  if (!material) throw notFound('Material not found');
  return withLowStock(await prisma.rawMaterial.update({ where: { id }, data }));
}

// Yarn arriving at the gate: record the bill, add to stock, re-average the cost.
async function inward({ materialId, supplierId, orderId, qty, rate }, userId) {
  return prisma.$transaction(async (tx) => {
    const material = await tx.rawMaterial.findUnique({ where: { id: materialId } });
    if (!material) throw notFound('Material not found');
    if (!(await tx.supplier.findUnique({ where: { id: supplierId } }))) throw notFound('Supplier not found');
    if (orderId && !(await tx.order.findUnique({ where: { id: orderId } }))) throw notFound('Order not found');

    const oldQty = Number(material.qtyInStock);
    const newQty = oldQty + qty;
    const avgCost = (oldQty * Number(material.avgCost) + qty * rate) / newQty;

    const entry = await tx.materialInward.create({
      data: { materialId, supplierId, orderId, receivedById: userId, qty, rate, billAmount: qty * rate },
      include: { supplier: true, order: { select: { id: true, orderNo: true } } },
    });
    const updated = await tx.rawMaterial.update({
      where: { id: materialId },
      data: { qtyInStock: { increment: qty }, avgCost: Math.round(avgCost * 100) / 100 },
    });

    return { ...entry, material: withLowStock(updated) };
  });
}

// from/to filter on receivedAt.
async function listInwards(query = {}) {
  const { materialId, orderId, supplierId, from, to } = query;
  const rows = await prisma.materialInward.findMany({
    where: { materialId, orderId, supplierId, receivedAt: dateRange(from, to) },
    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
    ...pageArgs(query),
    include: {
      material: { select: { id: true, yarnType: true, colour: true, unit: true } },
      supplier: { select: { id: true, name: true } },
      order: { select: { id: true, orderNo: true } },
      receivedBy: { select: { id: true, name: true } },
    },
  });
  return toPage(rows, query);
}

// Yarn leaving the store for an order. The guarded decrement stops stock going negative.
async function issue({ materialId, orderId, qty }) {
  return prisma.$transaction(async (tx) => {
    const material = await tx.rawMaterial.findUnique({ where: { id: materialId } });
    if (!material) throw notFound('Material not found');
    if (!(await tx.order.findUnique({ where: { id: orderId } }))) throw notFound('Order not found');

    const { count } = await tx.rawMaterial.updateMany({
      where: { id: materialId, qtyInStock: { gte: qty } },
      data: { qtyInStock: { decrement: qty } },
    });
    if (count === 0) {
      throw conflict(`Only ${Number(material.qtyInStock)} ${material.unit} in stock`, 'INSUFFICIENT_STOCK');
    }

    const entry = await tx.materialIssue.create({
      data: { materialId, orderId, qty, cost: qty * Number(material.avgCost) },
      include: { order: { select: { id: true, orderNo: true } } },
    });
    const updated = await tx.rawMaterial.findUnique({ where: { id: materialId } });

    return { ...entry, material: withLowStock(updated) };
  });
}

// from/to filter on issuedAt.
async function listIssues(query = {}) {
  const { materialId, orderId, from, to } = query;
  const rows = await prisma.materialIssue.findMany({
    where: { materialId, orderId, issuedAt: dateRange(from, to) },
    orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
    ...pageArgs(query),
    include: {
      material: { select: { id: true, yarnType: true, colour: true, unit: true } },
      order: { select: { id: true, orderNo: true } },
    },
  });
  return toPage(rows, query);
}

module.exports = { list, create, update, inward, listInwards, issue, listIssues };

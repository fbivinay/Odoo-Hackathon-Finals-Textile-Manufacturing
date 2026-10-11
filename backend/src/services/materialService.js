const prisma = require('../lib/prisma');
const { notFound, conflict, badRequest } = require('../lib/errors');
const { pageArgs, toPage, countFor, dateRange } = require('../lib/paging');
const { taxFor } = require('../lib/tax');

const withLowStock = (m) => ({ ...m, lowStock: Number(m.qtyInStock) <= Number(m.reorderLevel) });

// ?category=YARN|DYE|… picks one kind; ?kind=other is everything that is not yarn.
const ofKind = ({ category, kind } = {}) => (kind === 'other' ? { category: { not: 'YARN' } } : category ? { category } : undefined);

async function list({ lowStock, category, kind } = {}) {
  const materials = await prisma.rawMaterial.findMany({
    where: ofKind({ category, kind }),
    orderBy: [{ yarnType: 'asc' }, { colour: 'asc' }],
  });
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

// Yarn is issued to orders by itself: an order gets its yarn the moment it is taken, and
// orders left waiting get it as soon as a delivery arrives. Stock goes to the earliest
// deadlines first; an order may get part of what it needs if that is all there is.
async function allocateYarn(tx, materialId) {
  const material = await tx.rawMaterial.findUnique({ where: { id: materialId } });
  if (!material || material.category !== 'YARN') return [];

  const orders = await tx.order.findMany({
    where: { materialId, yarnRequired: { gt: 0 }, status: { notIn: ['DISPATCHED', 'CANCELLED'] } },
    orderBy: [{ priority: 'desc' }, { deadline: 'asc' }, { id: 'asc' }],
    select: { id: true, orderNo: true, yarnRequired: true },
  });
  if (orders.length === 0) return [];
  const issuedRows = await tx.materialIssue.groupBy({
    by: ['orderId'],
    where: { materialId, orderId: { in: orders.map((o) => o.id) } },
    _sum: { qty: true },
  });
  const issuedTo = new Map(issuedRows.map((r) => [r.orderId, Number(r._sum.qty || 0)]));

  let stock = Number(material.qtyInStock);
  const given = [];
  for (const order of orders) {
    if (stock <= 0.005) break;
    const owed = Math.round((Number(order.yarnRequired) - (issuedTo.get(order.id) || 0)) * 100) / 100;
    if (owed <= 0.005) continue;
    const qty = Math.min(owed, Math.round(stock * 100) / 100);
    await tx.materialIssue.create({ data: { materialId, orderId: order.id, qty, cost: qty * Number(material.avgCost) } });
    stock -= qty;
    given.push({ orderNo: order.orderNo, qty });
  }
  if (given.length > 0) {
    const total = given.reduce((sum, g) => sum + g.qty, 0);
    await tx.rawMaterial.update({ where: { id: materialId }, data: { qtyInStock: { decrement: total } } });
  }
  return given;
}

// Runs the same rule over every yarn. Used once after loading a dataset.
async function allocateAllYarn() {
  const yarns = await prisma.rawMaterial.findMany({ where: { category: 'YARN' }, select: { id: true } });
  let orders = 0;
  for (const yarn of yarns) {
    orders += (await prisma.$transaction((tx) => allocateYarn(tx, yarn.id), { timeout: 60000 })).length;
  }
  return orders;
}

// Yarn arriving at the gate: record the bill, add to stock, re-average the cost.
async function inward(data, userId) {
  return prisma.$transaction((tx) => addInward(tx, data, userId));
}

// The tax rule for a material: its own, else yarn's no-GST rule; other items without a rule are
// left unclassified (no tax charged) and show up flagged in the GST register.
const taxCodeOf = (m) => m.taxCode || (m.category === 'YARN' ? 'YARN_RAW' : null);

async function addInward(tx, { materialId, supplierId, orderId, qty, rate, batchNo, billNo }, userId) {
  const material = await tx.rawMaterial.findUnique({ where: { id: materialId } });
  if (!material) throw notFound('Material not found');
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw notFound('Supplier not found');
  if (orderId && !(await tx.order.findUnique({ where: { id: orderId } }))) throw notFound('Order not found');

  const oldQty = Number(material.qtyInStock);
  const newQty = oldQty + qty;
  const avgCost = (oldQty * Number(material.avgCost) + qty * rate) / newQty;

  // The delivery is its supplier bill: taxable value, GST by place of supply, due date by credit days.
  const billAmount = Math.round(qty * rate * 100) / 100;
  const now = new Date();
  const code = taxCodeOf(material);
  const tax = code ? taxFor(code, billAmount, now, supplier.state) : { taxTreatment: 'UNCLASSIFIED', totalAmount: billAmount };
  const count = await tx.materialInward.count();
  const entry = await tx.materialInward.create({
    data: {
      materialId, supplierId, orderId, receivedById: userId, qty, rate, billAmount, receivedAt: now,
      billNo: billNo || `PB-${String(count + 1).padStart(5, '0')}`, batchNo, dueDate: new Date(now.getTime() + supplier.creditDays * 86400000),
      ...tax,
    },
    include: { supplier: true, order: { select: { id: true, orderNo: true } } },
  });
  await tx.rawMaterial.update({
    where: { id: materialId },
    data: { qtyInStock: { increment: qty }, avgCost: Math.round(avgCost * 100) / 100 },
  });
  // Orders that were waiting for this yarn get it now.
  const issuedTo = await allocateYarn(tx, materialId);
  const updated = await tx.rawMaterial.findUnique({ where: { id: materialId } });

  return { ...entry, material: withLowStock(updated), issuedTo };
}

const poInclude = {
  material: { select: { id: true, category: true, yarnType: true, colour: true, unit: true, leadDays: true } },
  supplier: { select: { id: true, name: true, phone: true } },
  orderedBy: { select: { id: true, name: true } },
};

// ?status=PENDING|RECEIVED|CANCELLED, plus ?category= / ?kind=other like the stock list.
async function listPurchaseOrders(query = {}) {
  const where = { status: query.status, material: ofKind(query) };
  const rows = await prisma.purchaseOrder.findMany({
    where,
    orderBy: [{ orderedAt: 'desc' }, { poNo: 'desc' }],
    ...pageArgs(query),
    include: poInclude,
  });
  const total = await countFor(prisma.purchaseOrder, where, query);
  return toPage(rows, query, total);
}

// One PO number per line, numbered on from the last one.
async function placeOrders(lines, userId) {
  return prisma.$transaction(async (tx) => {
    const last = await tx.purchaseOrder.findFirst({ orderBy: { poNo: 'desc' }, select: { poNo: true } });
    let n = last ? Number(last.poNo.slice(3)) : 0;
    const made = [];
    for (const { materialId, supplierId, qty, rate } of lines) {
      if (!(await tx.rawMaterial.findUnique({ where: { id: materialId } }))) throw notFound('Material not found');
      if (!(await tx.supplier.findUnique({ where: { id: supplierId } }))) throw notFound('Supplier not found');
      n += 1;
      made.push(await tx.purchaseOrder.create({
        data: { poNo: `PO-${String(n).padStart(5, '0')}`, materialId, supplierId, qty, rate, orderedById: userId },
        include: poInclude,
      }));
    }
    return made;
  });
}

// The goods are at the gate: only now does the material go into stock.
async function receiveOrder(id, { qty, rate } = {}, userId) {
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw notFound('Purchase order not found');
    // The guarded update stops a double click receiving the same order twice.
    const { count } = await tx.purchaseOrder.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'RECEIVED', receivedAt: new Date() } });
    if (count === 0) throw conflict(`${po.poNo} is already ${po.status.toLowerCase()}`, 'NOT_PENDING');
    const got = { qty: qty ?? Number(po.qty), rate: rate ?? Number(po.rate) };
    const entry = await addInward(tx, { materialId: po.materialId, supplierId: po.supplierId, ...got }, userId);
    const updated = await tx.purchaseOrder.update({ where: { id }, data: { inwardId: entry.id, ...got }, include: poInclude });
    return { ...updated, issuedTo: entry.issuedTo };
  });
}

async function cancelOrder(id) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!po) throw notFound('Purchase order not found');
  const { count } = await prisma.purchaseOrder.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
  if (count === 0) throw conflict(`${po.poNo} is already ${po.status.toLowerCase()}`, 'NOT_PENDING');
  return prisma.purchaseOrder.findUnique({ where: { id }, include: poInclude });
}

// from/to filter on receivedAt.
async function listInwards(query = {}) {
  const { materialId, orderId, supplierId, from, to } = query;
  const where = { materialId, orderId, supplierId, receivedAt: dateRange(from, to), material: ofKind(query) };
  const rows = await prisma.materialInward.findMany({
    where,
    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
    ...pageArgs(query),
    include: {
      material: { select: { id: true, category: true, yarnType: true, colour: true, unit: true } },
      supplier: { select: { id: true, name: true } },
      order: { select: { id: true, orderNo: true } },
      receivedBy: { select: { id: true, name: true } },
    },
  });
  const total = await countFor(prisma.materialInward, where, query);
  return toPage(rows, query, total);
}

// Yarn leaving the store for an order. The guarded decrement stops stock going negative.
async function issue({ materialId, orderId, jobId, department, qty }) {
  return prisma.$transaction(async (tx) => {
    const material = await tx.rawMaterial.findUnique({ where: { id: materialId } });
    if (!material) throw notFound('Material not found');
    // Yarn always goes to an order; other materials may be used without one.
    if (material.category === 'YARN' && !orderId) throw badRequest('Yarn must be issued to an order');
    if (orderId && !(await tx.order.findUnique({ where: { id: orderId } }))) throw notFound('Order not found');

    const { count } = await tx.rawMaterial.updateMany({
      where: { id: materialId, qtyInStock: { gte: qty } },
      data: { qtyInStock: { decrement: qty } },
    });
    if (count === 0) {
      throw conflict(`Only ${Number(material.qtyInStock)} ${material.unit} in stock`, 'INSUFFICIENT_STOCK');
    }

    const entry = await tx.materialIssue.create({
      data: { materialId, orderId, jobId, department, qty, cost: Math.round(qty * Number(material.avgCost) * 100) / 100 },
      include: { order: { select: { id: true, orderNo: true } } },
    });
    const updated = await tx.rawMaterial.findUnique({ where: { id: materialId } });

    return { ...entry, material: withLowStock(updated) };
  });
}

// from/to filter on issuedAt.
async function listIssues(query = {}) {
  const { materialId, orderId, from, to } = query;
  const where = { materialId, orderId, issuedAt: dateRange(from, to), material: ofKind(query) };
  const rows = await prisma.materialIssue.findMany({
    where,
    orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
    ...pageArgs(query),
    include: {
      material: { select: { id: true, category: true, yarnType: true, colour: true, unit: true } },
      order: { select: { id: true, orderNo: true } },
    },
  });
  const total = await countFor(prisma.materialIssue, where, query);
  return toPage(rows, query, total);
}

module.exports = { allocateYarn, allocateAllYarn, list, create, update, inward, listInwards, issue, listIssues, listPurchaseOrders, placeOrders, receiveOrder, cancelOrder };

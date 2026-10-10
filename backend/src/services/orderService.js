const prisma = require('../lib/prisma');
const { nextNumber } = require('../lib/numbering');
const { notFound, badRequest } = require('../lib/errors');
const { allocateYarn } = require('./materialService');
const { pageArgs, toPage, dateRange } = require('../lib/paging');

const CLOSED = ['DISPATCHED', 'CANCELLED'];

const sumQty = (rows) => rows.reduce((total, r) => total + Number(r.qty), 0);

const decorate = (order) => ({
  ...order,
  isDelayed: !CLOSED.includes(order.status) && new Date(order.deadline) < new Date(),
});

// Is there enough yarn in the store to start (or finish) this order?
async function availability(order, db = prisma) {
  const required = Number(order.yarnRequired);
  if (!order.materialId) return { required, issued: 0, inStock: 0, shortBy: 0, enough: required === 0 };

  const [material, issues] = await Promise.all([
    db.rawMaterial.findUnique({ where: { id: order.materialId } }),
    db.materialIssue.findMany({ where: { orderId: order.id, materialId: order.materialId } }),
  ]);
  const issued = sumQty(issues);
  const inStock = Number(material.qtyInStock);
  const shortBy = Math.max(0, required - issued - inStock);

  return { required, issued, inStock, shortBy, enough: shortBy === 0, unit: material.unit };
}

// Order status is derived from what is actually happening on the floor and in the store.
async function syncStatus(tx, orderId) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { rolls: true, jobs: { orderBy: { startedAt: 'desc' } } },
  });
  if (order.status === 'CANCELLED') return order;

  const running = order.jobs.find((j) => j.status === 'RUNNING');
  const byStatus = (status) => order.rolls.filter((r) => r.status === status);
  const dispatchedQty = sumQty(byStatus('DISPATCHED'));
  const passed = byStatus('PASSED');
  const awaitingQc = byStatus('PENDING_QC').length + byStatus('REWORK').length;
  const target = Number(order.qty);

  let status = order.jobs[0]?.stage || 'PENDING';
  if (running) status = running.stage;
  else if (awaitingQc > 0) status = 'QC';
  else if (passed.length === 0 && dispatchedQty >= target) status = 'DISPATCHED';
  else if (passed.length > 0 && dispatchedQty + sumQty(passed) >= target) status = 'READY';

  if (status === order.status) return order;
  return tx.order.update({ where: { id: orderId }, data: { status } });
}

const delayedWhere = () => ({ deadline: { lt: new Date() }, status: { notIn: CLOSED } });

// from/to filter on createdAt, dueFrom/dueTo on deadline.
async function list(query = {}) {
  const { status, buyerId, q, delayed, from, to, dueFrom, dueTo } = query;
  const orders = await prisma.order.findMany({
    where: {
      AND: [
        { status, buyerId, createdAt: dateRange(from, to), deadline: dateRange(dueFrom, dueTo, ['dueFrom', 'dueTo']) },
        delayed === 'true' ? delayedWhere() : {},
        q
          ? {
              OR: [
                { orderNo: { contains: q, mode: 'insensitive' } },
                { fabricType: { contains: q, mode: 'insensitive' } },
                { buyer: { name: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {},
      ],
    },
    orderBy: [{ deadline: 'asc' }, { id: 'asc' }],
    include: { buyer: { select: { id: true, name: true } } },
    ...pageArgs(query),
  });
  return toPage(orders.map(decorate), query);
}

async function create(data) {
  if (!(await prisma.buyer.findUnique({ where: { id: data.buyerId } }))) throw notFound('Buyer not found');
  if (data.materialId && !(await prisma.rawMaterial.findUnique({ where: { id: data.materialId } }))) {
    throw notFound('Material not found');
  }
  if (data.yarnRequired > 0 && !data.materialId) throw badRequest('materialId is required with yarnRequired');

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: { ...data, orderNo: await nextNumber(tx.order, 'ORD') },
      include: { buyer: { select: { id: true, name: true } } },
    });
    // The order gets its yarn straight away if the store has it.
    if (created.materialId) await allocateYarn(tx, created.materialId);
    return created;
  });
  return { ...decorate(order), availability: await availability(order) };
}

async function get(id) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      buyer: true,
      material: true,
      issues: { orderBy: { issuedAt: 'desc' }, include: { material: { select: { id: true, category: true, yarnType: true, colour: true, unit: true } } } },
      jobs: {
        orderBy: { startedAt: 'desc' },
        include: { machine: true, worker: { select: { id: true, name: true, code: true } } },
      },
      rolls: {
        orderBy: { createdAt: 'asc' },
        include: { machine: { select: { id: true, code: true } }, qcRecords: { orderBy: { checkedAt: 'asc' }, select: { result: true, defectType: true, checkedAt: true } } },
      },
      dispatches: { orderBy: { dispatchedAt: 'desc' }, include: { invoice: { include: { payments: { orderBy: { paidAt: 'asc' } } } } } },
    },
  });
  if (!order) throw notFound('Order not found');
  return { ...decorate(order), availability: await availability(order) };
}

async function updateStatus(id, status) {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw notFound('Order not found');
  return decorate(await prisma.order.update({ where: { id }, data: { status } }));
}

const STAGE_LABEL = {
  PENDING: 'Order received, waiting to start',
  SPINNING: 'Yarn is being spun',
  WEAVING: 'Fabric is being woven',
  DYEING: 'Fabric is being dyed',
  QC: 'Fabric is being quality checked',
  READY: 'Ready to ship',
  DISPATCHED: 'Dispatched',
  CANCELLED: 'Cancelled',
};
const TIMELINE = ['PENDING', 'SPINNING', 'WEAVING', 'DYEING', 'QC', 'READY', 'DISPATCHED'];

// Public, buyer-facing view: no prices, no internal ids.
async function track(token) {
  const order = await prisma.order.findUnique({
    where: { trackingToken: token },
    include: { buyer: true, rolls: true, dispatches: { orderBy: { dispatchedAt: 'asc' } } },
  });
  if (!order) throw notFound('Order not found');

  const reached = TIMELINE.indexOf(order.status);
  const qtyOf = (status) => sumQty(order.rolls.filter((r) => r.status === status));

  return {
    orderNo: order.orderNo,
    buyer: order.buyer.name,
    fabricType: order.fabricType,
    colour: order.colour,
    qty: order.qty,
    deadline: order.deadline,
    status: order.status,
    statusLabel: STAGE_LABEL[order.status],
    isDelayed: decorate(order).isDelayed,
    timeline: TIMELINE.map((step, i) => ({ step, label: STAGE_LABEL[step], done: i <= reached })),
    qtyReady: qtyOf('PASSED'),
    qtyDispatched: qtyOf('DISPATCHED'),
    dispatches: order.dispatches.map((d) => ({
      dispatchNo: d.dispatchNo,
      vehicleNo: d.vehicleNo,
      dispatchedAt: d.dispatchedAt,
    })),
  };
}

module.exports = { list, create, get, updateStatus, availability, syncStatus, track, sumQty, decorate, delayedWhere, CLOSED };

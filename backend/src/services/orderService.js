const prisma = require('../lib/prisma');
const { nextNumber } = require('../lib/numbering');
const { notFound, badRequest } = require('../lib/errors');
const { allocateYarn } = require('./materialService');
const { quoteFor } = require('./configService');
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
  const awaitingQc = byStatus('PENDING_QC').length;
  // Rejected metres are owed by the remake order, not this one.
  const target = Number(order.qty) - sumQty(byStatus('REJECTED'));
  // Fabric sent back by quality check returns the order to the stage that has to make it again.
  const backTo = reworkStageLeft(order);

  let status = order.jobs[0]?.stage || 'PENDING';
  if (running) status = running.stage;
  else if (backTo) status = backTo;
  else if (awaitingQc > 0) status = 'QC';
  else if (passed.length === 0 && dispatchedQty >= target) status = 'DISPATCHED';
  else if (passed.length > 0 && dispatchedQty + sumQty(passed) >= target) status = 'READY';

  // Rework puts an order at the front of the queue until its rolls are back; a remake stays first until shipped.
  const priority = !!backTo || (!!order.remakeOfId && status !== 'DISPATCHED');
  if (status === order.status && priority === order.priority) return order;
  return tx.order.update({ where: { id: orderId }, data: { status, priority, ...(order.priority && !priority && !order.remakeOfId ? { note: null } : {}) } });
}

// Owner only. Stops its machines, returns yarn that was issued but never spun, and leaves the rolls
// already made as unsold stock. An order with fabric already on a truck can't be cancelled.
async function cancel(id, { reason }) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, include: { dispatches: { select: { id: true } }, jobs: { where: { status: 'RUNNING' } } } });
    if (!order) throw notFound('Order not found');
    if (order.status === 'CANCELLED') throw badRequest('Order is already cancelled');
    if (order.dispatches.length) throw badRequest('Fabric from this order has already been dispatched');

    const now = new Date();
    for (const job of order.jobs) {
      await tx.productionJob.update({ where: { id: job.id }, data: { status: 'STOPPED', completedAt: now } });
      await tx.machine.update({ where: { id: job.machineId }, data: { status: 'IDLE' } });
    }

    let yarnReturned = 0;
    if (order.materialId) {
      const [issued, spun] = await Promise.all([
        tx.materialIssue.aggregate({ where: { orderId: id, materialId: order.materialId }, _sum: { qty: true, cost: true } }),
        tx.productionJob.aggregate({ where: { orderId: id, stage: 'SPINNING' }, _sum: { qtyProduced: true } }),
      ]);
      const qty = Number(issued._sum.qty || 0);
      yarnReturned = Math.round(Math.max(0, qty - Number(spun._sum.qtyProduced || 0)) * 100) / 100;
      if (yarnReturned > 0) {
        // A negative issue at the order's own cost per kg, so its material cost and the stock both come back.
        const cost = Math.round((Number(issued._sum.cost || 0) / qty) * yarnReturned * 100) / 100;
        await tx.materialIssue.create({ data: { materialId: order.materialId, orderId: id, qty: -yarnReturned, cost: -cost } });
        await tx.rawMaterial.update({ where: { id: order.materialId }, data: { qtyInStock: { increment: yarnReturned } } });
      }
    }

    const updated = await tx.order.update({ where: { id }, data: { status: 'CANCELLED', priority: false, note: `Cancelled: ${reason}` } });
    // The yarn freed up goes to the next order waiting for it.
    if (yarnReturned > 0) await allocateYarn(tx, order.materialId);
    return { ...decorate(updated), stoppedJobs: order.jobs.length, yarnReturned };
  });
}

// Fabric sent back from quality check has to be made again from its rework stage onwards. This is
// the earliest stage that still owes some of it, or null. Mirrors the targets in productionService.queue.
function reworkStageLeft(order) {
  const flow = ['WEAVING', 'DYEING'];
  const rework = order.rolls.filter((r) => r.status === 'REWORK' && r.reworkStage);
  for (const stage of flow) {
    const extra = sumQty(rework.filter((r) => flow.indexOf(r.reworkStage) <= flow.indexOf(stage)));
    if (extra <= 0) continue;
    const done = order.jobs.filter((j) => j.stage === stage && j.rework).reduce((total, j) => total + Number(j.qtyProduced), 0);
    if (extra - done > extra * 0.01) return stage;
  }
  return null;
}

const delayedWhere = () => ({ deadline: { lt: new Date() }, status: { notIn: CLOSED } });

// from/to filter on createdAt, dueFrom/dueTo on deadline.
// The status groups the Orders page filters by.
const GROUPS = {
  open: { notIn: CLOSED },
  pending: 'PENDING',
  production: { in: ['SPINNING', 'WEAVING', 'DYEING'] },
  qc: 'QC',
  ready: 'READY',
  dispatched: 'DISPATCHED',
  cancelled: 'CANCELLED',
};

// What the Orders page opens with, counted in the database rather than by loading every order:
// open orders by where they stand, how many are past their deadline, and how many are ready to ship.
async function summary() {
  const [byStatus, late] = await Promise.all([
    prisma.order.groupBy({ by: ['status'], _count: true }),
    prisma.order.count({ where: delayedWhere() }),
  ]);
  const n = (...statuses) => byStatus.filter((r) => statuses.includes(r.status)).reduce((total, r) => total + r._count, 0);
  return {
    total: byStatus.reduce((total, r) => total + r._count, 0),
    open: byStatus.filter((r) => !CLOSED.includes(r.status)).reduce((total, r) => total + r._count, 0),
    notStarted: n('PENDING'),
    inProduction: n('SPINNING', 'WEAVING', 'DYEING', 'QC'),
    ready: n('READY'),
    late,
  };
}

// ?group= is one of GROUPS; ?sort=newest lists the latest orders first (default: priority, then deadline).
async function list(query = {}) {
  const { buyerId, q, delayed, from, to, dueFrom, dueTo, group, sort } = query;
  const status = query.status || GROUPS[group];
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
    orderBy: sort === 'newest' ? [{ createdAt: 'desc' }, { id: 'desc' }] : [{ priority: 'desc' }, { deadline: 'asc' }, { id: 'asc' }],
    include: { buyer: { select: { id: true, name: true } } },
    ...pageArgs(query),
  });
  return toPage(await withRework(await withReplaced(orders.map(decorate))), query);
}

// An order with fabric back from quality check shows the stage it has returned to (`reworkStage`),
// until that fabric has been made again.
async function withRework(orders) {
  const open = orders.filter((o) => !CLOSED.includes(o.status)).map((o) => o.id);
  if (open.length === 0) return orders;
  const back = await prisma.roll.findMany({ where: { orderId: { in: open }, status: 'REWORK', reworkStage: { not: null } }, select: { orderId: true } });
  const ids = [...new Set(back.map((r) => r.orderId))];
  if (ids.length === 0) return orders;
  const full = await prisma.order.findMany({ where: { id: { in: ids } }, include: { rolls: true, jobs: true } });
  const stageOf = new Map(full.map((o) => [o.id, reworkStageLeft(o)]));
  return orders.map((o) => (stageOf.get(o.id) ? { ...o, reworkStage: stageOf.get(o.id) } : o));
}

// A replacement order shows the number of the order it makes up for.
async function withReplaced(orders) {
  const ids = [...new Set(orders.map((o) => o.replacesOrderId).filter(Boolean))];
  if (ids.length === 0) return orders;
  const found = await prisma.order.findMany({ where: { id: { in: ids } }, select: { id: true, orderNo: true } });
  const noOf = new Map(found.map((o) => [o.id, o.orderNo]));
  return orders.map((o) => (o.replacesOrderId ? { ...o, replacesOrderNo: noOf.get(o.replacesOrderId) || null } : o));
}

async function create(input) {
  // Config decides the yarn, so every order gets the same rule however it was entered. The figures
  // used are stored on the order; the agreed price is the one sent (it may be negotiated).
  const q = await quoteFor(input.fabricType, input);
  const data = q
    ? {
        ...input,
        materialId: input.materialId || q.spec.materialId || undefined,
        yarnRequired: q.yarnKg,
        yarnPerMetre: q.spec.yarnPerMetre,
        wastagePct: q.wastagePct,
        listPrice: q.price,
        pricePerUnit: input.pricePerUnit || q.price,
      }
    : input;
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
  const [shown] = await withRework(await withReplaced([decorate(order)]));
  return { ...shown, availability: await availability(order) };
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

module.exports = { list, summary, create, get, updateStatus, availability, syncStatus, cancel, track, sumQty, decorate, delayedWhere, CLOSED };

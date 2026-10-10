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
  const inRework = byStatus('REWORK').length;
  const awaitingQc = byStatus('PENDING_QC').length;
  // Rejected metres are owed by the remake order, not this one.
  const target = Number(order.qty) - sumQty(byStatus('REJECTED'));

  let status = order.jobs[0]?.stage || 'PENDING';
  if (running) status = running.stage;
  else if (inRework > 0) status = 'DYEING'; // back on the finishing line
  else if (awaitingQc > 0) status = 'QC';
  else if (passed.length === 0 && dispatchedQty >= target) status = 'DISPATCHED';
  else if (passed.length > 0 && dispatchedQty + sumQty(passed) >= target) status = 'READY';

  // Rework puts an order at the front of the queue until its rolls are back; a remake stays first until shipped.
  const priority = inRework > 0 || (!!order.remakeOfId && status !== 'DISPATCHED');
  if (status === order.status && priority === order.priority) return order;
  return tx.order.update({ where: { id: orderId }, data: { status, priority, ...(order.priority && !priority && !order.remakeOfId ? { note: null } : {}) } });
}

// A rejected roll is owed again: a new priority order for the same buyer, fabric and price, due on the
// original deadline. Metres rejected before the remake starts are added to it rather than opening another.
async function remake(tx, roll, defectType) {
  const order = await tx.order.findUnique({ where: { id: roll.orderId } });
  if (order.status === 'CANCELLED') return null;
  const rootId = order.remakeOfId || order.id;
  const qty = Number(roll.qty);
  const yarn = Number(order.qty) > 0 ? Math.round((Number(order.yarnRequired) * qty / Number(order.qty)) * 100) / 100 : 0;
  const reason = `${roll.rollNo} rejected${defectType ? ` (${defectType})` : ''}`;

  const open = await tx.order.findFirst({ where: { remakeOfId: rootId, status: 'PENDING', jobs: { none: {} } } });
  const made = open
    ? await tx.order.update({ where: { id: open.id }, data: { qty: { increment: qty }, yarnRequired: { increment: yarn }, note: `${open.note}; ${reason}` } })
    : await tx.order.create({
        data: {
          orderNo: await nextNumber(tx.order, 'ORD'),
          buyerId: order.buyerId, materialId: order.materialId, fabricType: order.fabricType, colour: order.colour,
          qty, yarnRequired: yarn, pricePerUnit: order.pricePerUnit, yarnPerMetre: order.yarnPerMetre, wastagePct: order.wastagePct, listPrice: order.listPrice,
          deadline: order.deadline, priority: true, remakeOfId: rootId,
          note: `Remake for ${(await tx.order.findUnique({ where: { id: rootId }, select: { orderNo: true } })).orderNo}: ${reason}`,
        },
      });
  if (made.materialId) await allocateYarn(tx, made.materialId);
  return made;
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
    orderBy: [{ priority: 'desc' }, { deadline: 'asc' }, { id: 'asc' }],
    include: { buyer: { select: { id: true, name: true } } },
    ...pageArgs(query),
  });
  return toPage(orders.map(decorate), query);
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

module.exports = { list, create, get, updateStatus, availability, syncStatus, remake, cancel, track, sumQty, decorate, delayedWhere, CLOSED };

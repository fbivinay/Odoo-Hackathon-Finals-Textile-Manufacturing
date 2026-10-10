const prisma = require('../lib/prisma');
const { notFound, badRequest } = require('../lib/errors');
const { syncStatus, remake } = require('./orderService');
const { pageArgs, toPage, dateRange } = require('../lib/paging');

const ROLL_STATUS = { PASS: 'PASSED', REWORK: 'REWORK', REJECT: 'REJECTED' };

const rollInclude = {
  order: { select: { id: true, orderNo: true, fabricType: true, colour: true, buyer: { select: { name: true } } } },
  machine: { select: { id: true, code: true, name: true } },
  qcRecords: { orderBy: { checkedAt: 'desc' }, include: { inspector: { select: { id: true, name: true } } } },
};

// from/to filter on createdAt.
async function listRolls(query = {}) {
  const { status, orderId, machineId, from, to } = query;
  // The QC queue and the rework list skip rolls of cancelled orders: those are unsold stock.
  const queue = ['PENDING_QC', 'REWORK'].includes(status) ? { order: { status: { not: 'CANCELLED' } } } : {};
  const rolls = await prisma.roll.findMany({
    where: { status, orderId, machineId, createdAt: dateRange(from, to), ...queue },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: rollInclude,
    ...pageArgs(query),
  });
  return toPage(rolls, query);
}

// Full trace: roll → order, machine, job (shift, worker) and every inspection.
async function getRoll(id) {
  const roll = await prisma.roll.findUnique({
    where: { id },
    include: {
      ...rollInclude,
      job: { include: { worker: { select: { id: true, code: true, name: true } } } },
      dispatch: { select: { id: true, dispatchNo: true, dispatchedAt: true } },
    },
  });
  if (!roll) throw notFound('Roll not found');
  return roll;
}

// Pass: the roll is finished stock for Dispatch. Reject: it is waste, and a priority remake order is
// opened for its metres. Rework: it goes back to the finishing line and its order jumps the queue
// until production sends it back to QC (reworked below).
async function inspect(rollId, { result, defectType, notes }, userId) {
  return prisma.$transaction(async (tx) => {
    const roll = await tx.roll.findUnique({ where: { id: rollId }, include: { order: { select: { status: true, note: true } } } });
    if (!roll) throw notFound('Roll not found');
    if (roll.status !== 'PENDING_QC') throw badRequest(roll.status === 'REWORK' ? 'Roll is in rework; production sends it back to QC when done' : `Roll is already ${roll.status}`);
    if (roll.order.status === 'CANCELLED') throw badRequest('Order is cancelled; this roll is unsold stock');

    await tx.qCRecord.create({
      data: { rollId, inspectorId: userId, result, defectType: result === 'PASS' ? null : defectType, notes },
    });
    const updated = await tx.roll.update({
      where: { id: rollId },
      data: { status: ROLL_STATUS[result] },
      include: rollInclude,
    });
    if (result === 'REWORK') {
      const why = `Rework ${roll.rollNo}${defectType ? `: ${defectType}` : ''}`;
      const kept = (roll.order.note || '').startsWith('Rework ') ? `${roll.order.note}; ` : '';
      await tx.order.update({ where: { id: roll.orderId }, data: { note: kept + why } });
    }
    const remakeOrder = result === 'REJECT' ? await remake(tx, roll, defectType) : null;
    await syncStatus(tx, roll.orderId);
    return { ...updated, remake: remakeOrder && { id: remakeOrder.id, orderNo: remakeOrder.orderNo } };
  });
}

// Production has redone a rework roll: it joins the QC queue again.
async function reworked(rollId) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.roll.updateMany({ where: { id: rollId, status: 'REWORK' }, data: { status: 'PENDING_QC' } });
    const roll = await tx.roll.findUnique({ where: { id: rollId }, include: rollInclude });
    if (!roll) throw notFound('Roll not found');
    if (!count) throw badRequest(`Roll is ${roll.status}, not in rework`);
    await syncStatus(tx, roll.orderId);
    return { ...roll, status: 'PENDING_QC' };
  });
}

// Rolls by status, with the share that passed out of everything checked.
async function counts(createdAt) {
  const byStatus = await prisma.roll.groupBy({ by: ['status'], where: { createdAt }, _count: true });
  const result = { PENDING_QC: 0, PASSED: 0, REWORK: 0, REJECTED: 0, DISPATCHED: 0 };
  for (const row of byStatus) result[row.status] = row._count;

  const checked = result.PASSED + result.DISPATCHED + result.REWORK + result.REJECTED;
  return { counts: result, passRate: checked ? Math.round(((result.PASSED + result.DISPATCHED) / checked) * 100) : null };
}

// What passed, what failed, what is waiting — plus where the defects come from.
// from/to limit it to rolls made (and defects found) in that period.
async function summary({ from, to } = {}) {
  const range = dateRange(from, to);
  const [status, defects, machines] = await Promise.all([
    counts(range),
    prisma.qCRecord.findMany({
      where: { result: { not: 'PASS' }, checkedAt: range },
      select: { defectType: true, roll: { select: { machineId: true } } },
    }),
    prisma.machine.findMany({ select: { id: true, code: true, name: true } }),
  ]);

  const tally = (keyOf) => {
    const map = new Map();
    for (const d of defects) map.set(keyOf(d), (map.get(keyOf(d)) || 0) + 1);
    return map;
  };
  const byType = tally((d) => d.defectType || 'Unspecified');
  const byMachine = tally((d) => d.roll.machineId);

  return {
    ...status,
    defectsByType: [...byType].map(([defectType, count]) => ({ defectType, count })),
    defectsByMachine: machines
      .map((m) => ({ ...m, count: byMachine.get(m.id) || 0 }))
      .filter((m) => m.count > 0),
  };
}

module.exports = { listRolls, getRoll, inspect, reworked, counts, summary };

const prisma = require('../lib/prisma');
const { notFound, badRequest } = require('../lib/errors');
const orderService = require('./orderService');
const { syncStatus } = orderService;
const { pageArgs, toPage, dateRange } = require('../lib/paging');

const ROLL_STATUS = { PASS: 'PASSED', REWORK: 'REWORK', REJECT: 'REJECTED' };

const rollInclude = {
  order: { select: { id: true, orderNo: true, fabricType: true, colour: true, buyer: { select: { name: true } } } },
  machine: { select: { id: true, code: true, name: true } },
  qcRecords: { orderBy: { checkedAt: 'desc' }, include: { inspector: { select: { id: true, name: true } } } },
};

// from/to filter on createdAt. `status` takes one value or several, comma separated.
async function listRolls(query = {}) {
  const { orderId, machineId, from, to } = query;
  const wanted = String(query.status || '').split(',').filter(Boolean);
  const status = wanted.length > 1 ? { in: wanted } : wanted[0];
  // The QC queue skips rolls of cancelled orders: those are unsold stock.
  const queue = wanted.includes('PENDING_QC') ? { order: { status: { not: 'CANCELLED' } } } : {};
  // ?q= matches the roll number, its order number, fabric, colour, buyer or machine.
  const q = String(query.q || '').trim();
  const has = { contains: q, mode: 'insensitive' };
  const search = q ? { OR: [{ rollNo: has }, { machine: { code: has } }, { order: { OR: [{ orderNo: has }, { fabricType: has }, { colour: has }, { buyer: { name: has } }] } }] } : {};
  // ?defect= keeps rolls that failed a check for that reason.
  const defect = query.defect ? { qcRecords: { some: { defectType: String(query.defect) } } } : {};
  const rolls = await prisma.roll.findMany({
    where: { AND: [{ status, orderId, machineId, createdAt: dateRange(from, to), ...queue }, search, defect] },
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

// Pass: the roll is finished stock, ready for Dispatch.
// Rework: the roll's fabric goes back to weaving or dyeing under the same order, to be made again;
//   what comes off that job is cut into new rolls and checked afresh.
// Reject: the roll is waste, and a priority order is raised to make the same fabric again.
async function inspect(rollId, { result, defectType, notes, reworkStage }, userId) {
  const checked = await prisma.$transaction(async (tx) => {
    const roll = await tx.roll.findUnique({ where: { id: rollId }, include: { order: { select: { status: true, note: true } } } });
    if (!roll) throw notFound('Roll not found');
    if (roll.status !== 'PENDING_QC') throw badRequest(`Roll is already ${roll.status}`);
    if (roll.order.status === 'CANCELLED') throw badRequest('Order is cancelled; this roll is unsold stock');

    await tx.qCRecord.create({
      data: { rollId, inspectorId: userId, result, defectType: result === 'PASS' ? null : defectType, notes },
    });
    const updated = await tx.roll.update({
      where: { id: rollId },
      data: { status: ROLL_STATUS[result], reworkStage: result === 'REWORK' ? reworkStage : null },
      include: rollInclude,
    });
    if (result === 'REWORK') {
      // Shown on the Orders page: why this order is back on the floor.
      const why = `Rework ${roll.rollNo}${defectType ? `: ${defectType}` : ''}`;
      const kept = (roll.order.note || '').startsWith('Rework ') ? `${roll.order.note}; ` : '';
      await tx.order.update({ where: { id: roll.orderId }, data: { note: kept + why } });
    }
    await syncStatus(tx, roll.orderId);
    return updated;
  });
  if (result !== 'REJECT') return checked;

  const replacementOrder = await replace(checked, defectType);
  // `remake` is the same order under the name the Orders screens read.
  return { ...checked, replacementOrderId: replacementOrder.id, replacementOrder, remake: { id: replacementOrder.id, orderNo: replacementOrder.orderNo } };
}

// A priority order for the rejected roll's length: same buyer, fabric, colour, yarn, price and deadline.
async function replace(roll, defectType) {
  const from = await prisma.order.findUnique({ where: { id: roll.orderId } });
  // A remake of a remake still points at the first order.
  const rootId = from.remakeOfId || from.id;
  const root = rootId === from.id ? from : await prisma.order.findUnique({ where: { id: rootId }, select: { orderNo: true } });
  const share = Number(from.qty) > 0 ? Number(roll.qty) / Number(from.qty) : 0;
  const made = await orderService.create({
    buyerId: from.buyerId,
    materialId: from.materialId || undefined,
    fabricType: from.fabricType,
    colour: from.colour || '',
    qty: Number(roll.qty),
    yarnRequired: Math.round(Number(from.yarnRequired) * share * 100) / 100,
    pricePerUnit: Number(from.pricePerUnit),
    deadline: from.deadline,
    priority: true,
    replacesOrderId: from.id,
    remakeOfId: rootId,
    note: `Remake for ${root.orderNo}: ${roll.rollNo} rejected${defectType ? ` (${defectType})` : ''}`,
  });
  await prisma.$transaction(async (tx) => {
    await tx.roll.update({ where: { id: roll.id }, data: { replacementOrderId: made.id } });
    await syncStatus(tx, roll.orderId);
  });
  return { id: made.id, orderNo: made.orderNo, qty: made.qty };
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

module.exports = { listRolls, getRoll, inspect, counts, summary };

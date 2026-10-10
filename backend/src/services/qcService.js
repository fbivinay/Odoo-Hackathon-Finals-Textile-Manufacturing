const prisma = require('../lib/prisma');
const { notFound, badRequest } = require('../lib/errors');
const { syncStatus } = require('./orderService');

const ROLL_STATUS = { PASS: 'PASSED', REWORK: 'REWORK', REJECT: 'REJECTED' };

const rollInclude = {
  order: { select: { id: true, orderNo: true, fabricType: true, colour: true, buyer: { select: { name: true } } } },
  machine: { select: { id: true, code: true, name: true } },
  qcRecords: { orderBy: { checkedAt: 'desc' }, include: { inspector: { select: { id: true, name: true } } } },
};

function listRolls({ status, orderId, machineId } = {}) {
  return prisma.roll.findMany({
    where: { status, orderId, machineId },
    orderBy: { createdAt: 'desc' },
    include: rollInclude,
  });
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

async function inspect(rollId, { result, defectType, notes }, userId) {
  return prisma.$transaction(async (tx) => {
    const roll = await tx.roll.findUnique({ where: { id: rollId } });
    if (!roll) throw notFound('Roll not found');
    if (!['PENDING_QC', 'REWORK'].includes(roll.status)) throw badRequest(`Roll is already ${roll.status}`);

    await tx.qCRecord.create({
      data: { rollId, inspectorId: userId, result, defectType: result === 'PASS' ? null : defectType, notes },
    });
    const updated = await tx.roll.update({
      where: { id: rollId },
      data: { status: ROLL_STATUS[result] },
      include: rollInclude,
    });
    await syncStatus(tx, roll.orderId);
    return updated;
  });
}

// What passed, what failed, what is waiting — plus where the defects come from.
async function summary() {
  const [byStatus, defects, machines] = await Promise.all([
    prisma.roll.groupBy({ by: ['status'], _count: true }),
    prisma.qCRecord.findMany({
      where: { result: { not: 'PASS' } },
      select: { defectType: true, roll: { select: { machineId: true } } },
    }),
    prisma.machine.findMany({ select: { id: true, code: true, name: true } }),
  ]);

  const counts = { PENDING_QC: 0, PASSED: 0, REWORK: 0, REJECTED: 0, DISPATCHED: 0 };
  for (const row of byStatus) counts[row.status] = row._count;

  const tally = (keyOf) => {
    const map = new Map();
    for (const d of defects) map.set(keyOf(d), (map.get(keyOf(d)) || 0) + 1);
    return map;
  };
  const byType = tally((d) => d.defectType || 'Unspecified');
  const byMachine = tally((d) => d.roll.machineId);

  const checked = counts.PASSED + counts.DISPATCHED + counts.REWORK + counts.REJECTED;
  return {
    counts,
    passRate: checked ? Math.round(((counts.PASSED + counts.DISPATCHED) / checked) * 100) : null,
    defectsByType: [...byType].map(([defectType, count]) => ({ defectType, count })),
    defectsByMachine: machines
      .map((m) => ({ ...m, count: byMachine.get(m.id) || 0 }))
      .filter((m) => m.count > 0),
  };
}

module.exports = { listRolls, getRoll, inspect, summary };

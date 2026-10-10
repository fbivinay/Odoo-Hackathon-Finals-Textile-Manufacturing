const prisma = require('../lib/prisma');
const { nextNumber } = require('../lib/numbering');
const { startOfToday } = require('../lib/dates');
const { notFound, conflict, badRequest } = require('../lib/errors');
const { syncStatus } = require('./orderService');

const jobInclude = {
  order: { select: { id: true, orderNo: true, fabricType: true, colour: true, qty: true, deadline: true } },
  machine: { select: { id: true, code: true, name: true, type: true } },
  worker: { select: { id: true, code: true, name: true } },
};

const withPercent = (job) => ({
  ...job,
  percent: Math.min(100, Math.round((Number(job.qtyProduced) / Number(job.qtyPlanned)) * 100)),
});

const listMachines = () => prisma.machine.findMany({ orderBy: { code: 'asc' } });
const createMachine = (data) => prisma.machine.create({ data });

// What every machine is doing right now, and what it has produced today.
async function board() {
  const [machines, today] = await Promise.all([
    prisma.machine.findMany({
      orderBy: { code: 'asc' },
      include: { jobs: { where: { status: 'RUNNING' }, include: jobInclude, take: 1 } },
    }),
    prisma.productionLog.groupBy({
      by: ['machineId'],
      where: { loggedAt: { gte: startOfToday() } },
      _sum: { qty: true },
    }),
  ]);
  const producedToday = new Map(today.map((t) => [t.machineId, Number(t._sum.qty)]));

  const rows = machines.map(({ jobs, ...machine }) => ({
    ...machine,
    producedToday: producedToday.get(machine.id) || 0,
    currentJob: jobs[0] ? withPercent(jobs[0]) : null,
  }));
  const count = (status) => rows.filter((m) => m.status === status).length;

  return {
    machines: rows,
    summary: {
      total: rows.length,
      running: count('RUNNING'),
      idle: count('IDLE'),
      breakdown: count('BREAKDOWN'),
      maintenance: count('MAINTENANCE'),
      producedToday: rows.reduce((total, m) => total + m.producedToday, 0),
    },
  };
}

// A breakdown or maintenance stop also stops whatever was running on the machine.
async function setMachineStatus(id, status) {
  return prisma.$transaction(async (tx) => {
    const machine = await tx.machine.findUnique({ where: { id } });
    if (!machine) throw notFound('Machine not found');

    const running = await tx.productionJob.findMany({ where: { machineId: id, status: 'RUNNING' } });
    if (running.length > 0) {
      await tx.productionJob.updateMany({
        where: { machineId: id, status: 'RUNNING' },
        data: { status: 'STOPPED', completedAt: new Date() },
      });
    }
    const updated = await tx.machine.update({ where: { id }, data: { status } });
    for (const job of running) await syncStatus(tx, job.orderId);
    return updated;
  });
}

async function startJob({ orderId, machineId, workerId, shift, qtyPlanned }) {
  return prisma.$transaction(async (tx) => {
    const [order, machine] = await Promise.all([
      tx.order.findUnique({ where: { id: orderId } }),
      tx.machine.findUnique({ where: { id: machineId } }),
    ]);
    if (!order) throw notFound('Order not found');
    if (!machine) throw notFound('Machine not found');
    if (['DISPATCHED', 'CANCELLED'].includes(order.status)) throw badRequest(`Order is ${order.status}`);
    if (workerId && !(await tx.worker.findUnique({ where: { id: workerId } }))) throw notFound('Worker not found');

    // Claim the machine only if it is still idle, so two jobs can't start on it at once.
    const { count } = await tx.machine.updateMany({
      where: { id: machineId, status: 'IDLE' },
      data: { status: 'RUNNING' },
    });
    if (count === 0) throw conflict(`Machine ${machine.code} is ${machine.status}`, 'MACHINE_BUSY');

    const job = await tx.productionJob.create({
      data: { orderId, machineId, workerId, shift, qtyPlanned, stage: machine.type },
      include: jobInclude,
    });
    await syncStatus(tx, orderId);
    return withPercent(job);
  });
}

async function logProgress(jobId, { qty }) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.productionJob.findUnique({ where: { id: jobId } });
    if (!job) throw notFound('Job not found');
    if (job.status !== 'RUNNING') throw badRequest(`Job is ${job.status}`);

    await tx.productionLog.create({ data: { jobId, machineId: job.machineId, qty } });
    const updated = await tx.productionJob.update({
      where: { id: jobId },
      data: { qtyProduced: { increment: qty } },
      include: jobInclude,
    });
    return withPercent(updated);
  });
}

async function finishJob(jobId, status) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.productionJob.findUnique({ where: { id: jobId } });
    if (!job) throw notFound('Job not found');
    if (job.status !== 'RUNNING') throw badRequest(`Job is already ${job.status}`);

    const updated = await tx.productionJob.update({
      where: { id: jobId },
      data: { status, completedAt: new Date() },
      include: jobInclude,
    });
    await tx.machine.updateMany({ where: { id: job.machineId, status: 'RUNNING' }, data: { status: 'IDLE' } });
    await syncStatus(tx, job.orderId);
    return withPercent(updated);
  });
}

async function listJobs({ orderId, machineId, status } = {}) {
  const jobs = await prisma.productionJob.findMany({
    where: { orderId, machineId, status },
    orderBy: { startedAt: 'desc' },
    include: jobInclude,
  });
  return jobs.map(withPercent);
}

// A finished roll comes off a job, so it always carries its order and machine.
async function createRoll({ jobId, qty }) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.productionJob.findUnique({ where: { id: jobId } });
    if (!job) throw notFound('Job not found');

    const roll = await tx.roll.create({
      data: {
        rollNo: await nextNumber(tx.roll, 'ROLL'),
        orderId: job.orderId,
        machineId: job.machineId,
        jobId,
        qty,
      },
      include: {
        order: { select: { id: true, orderNo: true } },
        machine: { select: { id: true, code: true } },
      },
    });
    await syncStatus(tx, job.orderId);
    return roll;
  });
}

module.exports = {
  listMachines,
  createMachine,
  board,
  setMachineStatus,
  startJob,
  logProgress,
  finishJob,
  listJobs,
  createRoll,
};

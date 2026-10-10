const prisma = require('../lib/prisma');
const { nextNumber } = require('../lib/numbering');
const { startOfToday } = require('../lib/dates');
const { notFound, conflict, badRequest } = require('../lib/errors');
const { syncStatus } = require('./orderService');
const { setting } = require('./configService');
const { pageArgs, toPage, dateRange } = require('../lib/paging');

const jobInclude = {
  order: { select: { id: true, orderNo: true, fabricType: true, colour: true, qty: true, deadline: true } },
  machine: { select: { id: true, code: true, name: true, type: true } },
  worker: { select: { id: true, code: true, name: true } },
};

const withPercent = (job) => ({
  ...job,
  percent: Math.min(100, Math.round((Number(job.qtyProduced) / Number(job.qtyPlanned)) * 100)),
});

const STAGES = ['SPINNING', 'WEAVING', 'DYEING'];
const OPEN = { status: { notIn: ['DISPATCHED', 'CANCELLED'] } };

// What a stage has to make for an order: spinning in kg of yarn, weaving and dyeing in metres of fabric.
const stageTarget = (order, stage) => Number(stage === 'SPINNING' ? order.yarnRequired : order.qty);
// Anything under 1% of the target counts as finished, so rounding never leaves a phantom job.
const leftOf = (target, done) => (target - done > target * 0.01 ? Math.round((target - done) * 100) / 100 : 0);

// Output so far per order and stage, across every job whatever its status.
async function stageOutput(orderIds) {
  const rows = await prisma.productionJob.groupBy({
    by: ['orderId', 'stage', 'status'],
    where: { orderId: { in: orderIds } },
    _sum: { qtyProduced: true },
    _count: true,
  });
  const out = new Map();
  for (const row of rows) {
    const key = `${row.orderId}|${row.stage}`;
    const entry = out.get(key) || { done: 0, running: 0 };
    entry.done += Number(row._sum.qtyProduced || 0);
    if (row.status === 'RUNNING') entry.running += row._count;
    out.set(key, entry);
  }
  return (orderId, stage) => out.get(`${orderId}|${stage}`) || { done: 0, running: 0 };
}

// Orders with work still left in a stage, earliest deadline first. A job closed short of
// its plan leaves the rest here, so the remainder is never forgotten.
async function queue({ stage } = {}) {
  if (!STAGES.includes(stage)) throw badRequest('stage must be SPINNING, WEAVING or DYEING');
  const orders = await prisma.order.findMany({
    where: OPEN,
    orderBy: [{ deadline: 'asc' }, { id: 'asc' }],
    include: { buyer: { select: { id: true, name: true } } },
  });
  const output = await stageOutput(orders.map((o) => o.id));
  const before = STAGES[STAGES.indexOf(stage) - 1];

  return orders
    .map((order) => {
      const target = stageTarget(order, stage);
      const { done, running } = output(order.id, stage);
      const remaining = leftOf(target, done);
      // An order moves on whole: weaving opens only once all its yarn is spun, dyeing only once
      // all its fabric is woven. `available` is then everything this stage still has to make.
      const handedOver = !before || leftOf(stageTarget(order, before), output(order.id, before).done) === 0;
      const available = handedOver ? remaining : 0;
      return {
        id: order.id, orderNo: order.orderNo, fabricType: order.fabricType, buyer: order.buyer, deadline: order.deadline,
        status: order.status, target, done: Math.round(done * 100) / 100, remaining, available, running,
      };
    })
    .filter((row) => row.remaining > 0 && row.available > 0);
}

// Machines on the floor. Removed ones stay only in old jobs, rolls and reports.
const listMachines = () => prisma.machine.findMany({ where: { removedAt: null }, orderBy: { code: 'asc' } });
const createMachine = (data) => prisma.machine.create({ data });

// Code, name and daily capacity. Each change is kept in the Mill Setup history.
async function updateMachine(id, data, user) {
  const machine = await prisma.machine.findUnique({ where: { id } });
  if (!machine) throw notFound('Machine not found');
  if (data.code && data.code !== machine.code && (await prisma.machine.findUnique({ where: { code: data.code } }))) {
    throw conflict(`${data.code} is already on the floor`, 'CONFLICT');
  }
  const changed = Object.keys(data).filter((k) => String(data[k] ?? '') !== String(machine[k] === null ? '' : k === 'dailyCapacity' ? Number(machine[k]) : machine[k]));
  return prisma.$transaction(async (tx) => {
    const updated = await tx.machine.update({ where: { id }, data });
    if (changed.length) {
      await tx.configChange.createMany({
        data: changed.map((field) => ({
          what: `Machine ${machine.code}`, field,
          oldValue: machine[field] == null ? null : String(field === 'dailyCapacity' ? Number(machine[field]) : machine[field]),
          newValue: data[field] == null ? null : String(data[field]), changedBy: user.name,
        })),
      });
    }
    return updated;
  });
}

// Takes a machine off the floor. One that has run jobs is kept, marked removed, so its jobs,
// rolls and output still point at it; one with no records is deleted outright.
async function deleteMachine(id, user) {
  const machine = await prisma.machine.findUnique({ where: { id }, include: { _count: { select: { jobs: true, rolls: true, logs: true } } } });
  if (!machine || machine.removedAt) throw notFound('Machine not found');
  if (machine.status === 'RUNNING') throw conflict(`${machine.code} is running an order. Finish or stop it first.`, 'MACHINE_BUSY');
  const used = machine._count.jobs + machine._count.rolls + machine._count.logs > 0;
  return prisma.$transaction(async (tx) => {
    if (used) await tx.machine.update({ where: { id }, data: { removedAt: new Date(), status: 'IDLE' } });
    else await tx.machine.delete({ where: { id } });
    await tx.configChange.create({ data: { what: `Machine ${machine.code}`, field: 'machine', oldValue: 'on', newValue: 'removed', changedBy: user.name } });
    return { id };
  });
}

// What every machine is doing right now, and what it has produced today.
async function board() {
  const [machines, today] = await Promise.all([
    prisma.machine.findMany({
      where: { removedAt: null },
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
      producedToday: Math.round(rows.reduce((total, m) => total + m.producedToday, 0) * 100) / 100,
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
    if (!machine || machine.removedAt) throw notFound('Machine not found');
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
    // A job can't make more than it was planned for; extra work is a new job.
    const left = Math.round((Number(job.qtyPlanned) - Number(job.qtyProduced)) * 100) / 100;
    if (qty > left + 0.005) {
      throw badRequest(left > 0 ? `Only ${left} left on this job` : 'This job has already made its planned quantity', 'OVER_PLAN');
    }
    // Nor can a machine make more in a day than its capacity (Mill Setup), when one is set.
    const machine = await tx.machine.findUnique({ where: { id: job.machineId } });
    if (machine.dailyCapacity !== null) {
      const today = await tx.productionLog.aggregate({ where: { machineId: job.machineId, loggedAt: { gte: startOfToday() } }, _sum: { qty: true } });
      const room = Math.round((Number(machine.dailyCapacity) - Number(today._sum.qty || 0)) * 100) / 100;
      if (qty > room + 0.005) {
        throw badRequest(room > 0 ? `Only ${room} left of ${machine.code}'s capacity for today` : `${machine.code} has reached its capacity for the day`, 'CAPACITY_REACHED');
      }
    }

    await tx.productionLog.create({ data: { jobId, machineId: job.machineId, qty } });
    const updated = await tx.productionJob.update({
      where: { id: jobId },
      data: { qtyProduced: { increment: qty } },
      include: jobInclude,
    });
    return withPercent(updated);
  });
}

// Dyed fabric leaves the line wound into rolls of about Config's roll length (metres).

async function finishJob(jobId, status) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.productionJob.findUnique({ where: { id: jobId }, include: { rolls: true } });
    if (!job) throw notFound('Job not found');
    if (job.status !== 'RUNNING') throw badRequest(`Job is already ${job.status}`);

    // Finishing means the whole job is made: whatever was not logged yet is recorded now, so the
    // order is complete in this stage and moves on whole. Stopping keeps the job as it stands.
    let produced = Number(job.qtyProduced);
    if (status === 'COMPLETED') {
      const order = await tx.order.findUnique({ where: { id: job.orderId } });
      const made = await tx.productionJob.aggregate({ where: { orderId: job.orderId, stage: job.stage }, _sum: { qtyProduced: true } });
      const stageLeft = stageTarget(order, job.stage) - Number(made._sum.qtyProduced || 0);
      const fill = Math.round(Math.max(0, Math.min(Number(job.qtyPlanned) - produced, stageLeft)) * 100) / 100;
      if (fill > 0) {
        await tx.productionLog.create({ data: { jobId, machineId: job.machineId, qty: fill } });
        await tx.productionJob.update({ where: { id: jobId }, data: { qtyProduced: { increment: fill } } });
        produced += fill;
      }
    }

    // Finishing dyeing sends the fabric on to quality check: whatever has been made and not
    // yet rolled is cut into rolls here, so nothing dyed is left without a roll.
    let rollsSent = 0;
    if (status === 'COMPLETED' && job.stage === 'DYEING') {
      const rollLength = await setting('rollLength');
      let unrolled = produced - job.rolls.reduce((total, r) => total + Number(r.qty), 0);
      while (unrolled > 1) {
        const qty = Math.round(Math.min(rollLength, unrolled) * 100) / 100;
        await tx.roll.create({
          data: { rollNo: await nextNumber(tx.roll, 'ROLL'), orderId: job.orderId, machineId: job.machineId, jobId, qty },
        });
        unrolled -= qty;
        rollsSent += 1;
      }
    }

    const updated = await tx.productionJob.update({
      where: { id: jobId },
      data: { status, completedAt: new Date() },
      include: jobInclude,
    });
    await tx.machine.updateMany({ where: { id: job.machineId, status: 'RUNNING' }, data: { status: 'IDLE' } });
    await syncStatus(tx, job.orderId);
    return { ...withPercent(updated), rollsSent };
  });
}

// from/to filter on startedAt.
async function listJobs(query = {}) {
  const { orderId, machineId, workerId, status, stage, from, to } = query;
  const jobs = await prisma.productionJob.findMany({
    where: { orderId, machineId, workerId, status, stage, startedAt: dateRange(from, to) },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    include: jobInclude,
    ...pageArgs(query),
  });
  return toPage(jobs.map(withPercent), query);
}

// A finished roll comes off a job, so it always carries its order and machine.
async function createRoll({ jobId, qty }) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.productionJob.findUnique({ where: { id: jobId }, include: { rolls: true } });
    if (!job) throw notFound('Job not found');
    // Rolls are cut from what the job has made, so they can't add up to more than that.
    const unrolled = Math.round((Number(job.qtyProduced) - job.rolls.reduce((total, r) => total + Number(r.qty), 0)) * 100) / 100;
    if (qty > unrolled + 0.005) {
      throw badRequest(unrolled > 0 ? `Only ${unrolled} m made and not yet rolled` : 'Nothing made yet to roll. Add output first.', 'OVER_OUTPUT');
    }

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
  STAGES,
  stageTarget,
  leftOf,
  stageOutput,
  queue,
  listMachines,
  createMachine,
  updateMachine,
  deleteMachine,
  board,
  setMachineStatus,
  startJob,
  logProgress,
  finishJob,
  listJobs,
  createRoll,
};

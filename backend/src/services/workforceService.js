const prisma = require('../lib/prisma');
const { monthRange, dateOnly } = require('../lib/dates');
const { notFound } = require('../lib/errors');
const { payslip } = require('../lib/payroll');

// Everyone on the floor today. Removed workers stay in old registers only.
// The machine each worker last ran, from one pass over the jobs (newest first per worker).
const lastJobs = () => prisma.$queryRaw`
  SELECT DISTINCT ON (j."workerId") j."workerId", j.stage::text stage, m.code, m.name
  FROM "ProductionJob" j JOIN "Machine" m ON m.id = j."machineId"
  WHERE j."workerId" IS NOT NULL ORDER BY j."workerId", j."startedAt" DESC`;

const listWorkers = () => prisma.worker.findMany({ where: { removedAt: null }, orderBy: { code: 'asc' } });

const changeLog = (what, field, oldValue, newValue, user) => ({ what, field, oldValue: oldValue == null ? null : String(oldValue), newValue: newValue == null ? null : String(newValue), changedBy: user?.name || 'System' });

// A new worker takes the next code after the highest one (W-073 after W-072) unless one is given.
async function createWorker({ code, ...data }, user) {
  return prisma.$transaction(async (tx) => {
    if (!code) {
      const last = await tx.worker.findFirst({ where: { code: { startsWith: 'W-' } }, orderBy: { code: 'desc' }, select: { code: true } });
      code = `W-${String((last ? Number(last.code.slice(2)) || 0 : 0) + 1).padStart(3, '0')}`;
    }
    const worker = await tx.worker.create({ data: { code, ...data } });
    await tx.configChange.create({ data: changeLog(`Worker ${worker.name}`, 'worker', null, 'added', user) });
    return worker;
  });
}

async function updateWorker(id, data, user) {
  const worker = await prisma.worker.findUnique({ where: { id } });
  if (!worker || worker.removedAt) throw notFound('Worker not found');
  const before = { name: worker.name, shift: worker.shift, dailyWage: Number(worker.dailyWage), isActive: worker.isActive };
  const changed = Object.keys(data).filter((k) => String(before[k]) !== String(data[k]));
  return prisma.$transaction(async (tx) => {
    const updated = await tx.worker.update({ where: { id }, data });
    if (changed.length) await tx.configChange.createMany({ data: changed.map((k) => changeLog(`Worker ${worker.name}`, k, before[k], data[k], user)) });
    return updated;
  });
}

// Takes a worker off the list. One with attendance, wages or jobs is kept, marked removed, so
// the old registers and payslips stay whole; one with no records is deleted outright.
async function removeWorker(id, user) {
  const worker = await prisma.worker.findUnique({ where: { id }, include: { _count: { select: { attendance: true, wages: true, jobs: true } } } });
  if (!worker || worker.removedAt) throw notFound('Worker not found');
  const used = worker._count.attendance + worker._count.wages + worker._count.jobs > 0;
  return prisma.$transaction(async (tx) => {
    if (used) await tx.worker.update({ where: { id }, data: { removedAt: new Date(), isActive: false } });
    else await tx.worker.delete({ where: { id } });
    await tx.configChange.create({ data: changeLog(`Worker ${worker.name}`, 'worker', 'on', 'removed', user) });
    return { id };
  });
}

// Floor crew for the Employees page: each worker with the machine they last ran, their mark on the
// latest register day, and days worked in that month (half day = 0.5).
async function roster() {
  const last = (await prisma.attendance.aggregate({ _max: { date: true } }))._max.date;
  const monthStart = last && new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1));
  const [workers, jobs] = await Promise.all([
    prisma.worker.findMany({
      where: { removedAt: null },
      orderBy: { code: 'asc' },
      include: { attendance: last ? { where: { date: { gte: monthStart, lte: last } }, select: { date: true, status: true } } : false },
    }),
    lastJobs(),
  ]);
  const jobOf = new Map(jobs.map((j) => [j.workerId, j]));
  return {
    date: last ? last.toISOString().slice(0, 10) : null,
    workers: workers.map(({ attendance = [], ...w }) => ({
      ...w,
      machine: jobOf.has(w.id) ? { code: jobOf.get(w.id).code, name: jobOf.get(w.id).name, stage: jobOf.get(w.id).stage } : null,
      status: attendance.find((a) => a.date.getTime() === last.getTime())?.status || null,
      daysWorked: attendance.reduce((t, a) => t + (a.status === 'PRESENT' ? 1 : a.status === 'HALF_DAY' ? 0.5 : 0), 0),
    })),
  };
}

// The day's register: every active worker, marked or not.
async function attendance({ date } = {}) {
  const day = dateOnly(date);
  const [workers, marks] = await Promise.all([
    prisma.worker.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    prisma.attendance.findMany({ where: { date: day } }),
  ]);
  const statusOf = new Map(marks.map((m) => [m.workerId, m.status]));

  return {
    date: day.toISOString().slice(0, 10),
    workers: workers.map((w) => ({ ...w, status: statusOf.get(w.id) || null })),
  };
}

async function markAttendance({ date, entries }) {
  const day = dateOnly(date);
  const workers = await prisma.worker.findMany({ where: { id: { in: entries.map((e) => e.workerId) } } });
  const shiftOf = new Map(workers.map((w) => [w.id, w.shift]));
  const missing = entries.find((e) => !shiftOf.has(e.workerId));
  if (missing) throw notFound(`Worker ${missing.workerId} not found`);

  await prisma.$transaction(
    entries.map(({ workerId, status }) =>
      prisma.attendance.upsert({
        where: { workerId_date: { workerId, date: day } },
        update: { status },
        create: { workerId, date: day, status, shift: shiftOf.get(workerId) },
      })
    )
  );
  return attendance({ date });
}

// Wages earned from the register (lib/payroll.js): days worked x daily wage, half day = half,
// plus the night-shift allowance. `earned` is gross pay; `paid` is the net actually paid.
async function wages({ month } = {}) {
  const range = monthRange(month);
  const [workers, marks, payments, jobs] = await Promise.all([
    prisma.worker.findMany({ orderBy: { code: 'asc' } }),
    prisma.attendance.findMany({ where: { date: { gte: range.start, lt: range.end } } }),
    prisma.wagePayment.findMany({ where: { month: range.month } }),
    lastJobs(),
  ]);
  // The stage of the last job they ran is their role on the floor (spinning, weaving or dyeing).
  const stageOf = new Map(jobs.map((j) => [j.workerId, j.stage]));
  const paidOf = new Map(payments.map((p) => [p.workerId, p]));
  const marksOf = new Map();
  for (const m of marks) marksOf.set(m.workerId, [...(marksOf.get(m.workerId) || []), m]);

  const rows = workers
    .map((worker) => {
      const mine = marksOf.get(worker.id) || [];
      const days = (status) => mine.filter((m) => m.status === status).length;
      const present = days('PRESENT');
      const halfDays = days('HALF_DAY');
      const nightDays = mine.filter((m) => m.shift === 'NIGHT' && m.status !== 'ABSENT').reduce((t, m) => t + (m.status === 'PRESENT' ? 1 : 0.5), 0);
      const payment = paidOf.get(worker.id);
      const slip = payslip({ present, halfDays, nightDays, dailyWage: worker.dailyWage, overtime: Number(payment?.overtime || 0), deductions: Number(payment?.deductions || 0) });
      const earned = slip.gross;
      const paid = payment ? Number(payment.amount) : 0;
      return {
        worker: { id: worker.id, code: worker.code, name: worker.name, shift: worker.shift, dailyWage: worker.dailyWage, department: worker.department, stage: stageOf.get(worker.id) || null, joined: worker.createdAt },
        present,
        halfDays,
        absent: days('ABSENT'),
        nightDays,
        ...slip,
        earned,
        paid,
        due: Math.max(0, Math.round((slip.net - paid) * 100) / 100),
        paidAt: payment?.paidAt || null,
      };
    })
    .filter((row) => row.worker && (row.earned > 0 || row.paid > 0 || row.absent > 0));

  const total = (key) => rows.reduce((sum, r) => sum + r[key], 0);
  return { month: range.month, rows, totals: { earned: total('earned'), paid: total('paid'), due: total('due') } };
}

// Settle everything still due for the month.
async function payWages({ month } = {}) {
  const sheet = await wages({ month });
  const due = sheet.rows.filter((r) => r.due > 0);

  await prisma.$transaction(
    due.map((r) =>
      prisma.wagePayment.upsert({
        where: { workerId_month: { workerId: r.worker.id, month: sheet.month } },
        update: { amount: r.net, paidAt: new Date(), daysWorked: r.daysWorked, basic: r.basic, allowances: r.allowances, overtime: r.overtime, deductions: r.deductions, gross: r.gross },
        create: { workerId: r.worker.id, month: sheet.month, amount: r.net, daysWorked: r.daysWorked, basic: r.basic, allowances: r.allowances, overtime: r.overtime, deductions: r.deductions, gross: r.gross },
      })
    )
  );
  return wages({ month });
}

module.exports = { listWorkers, roster, createWorker, updateWorker, removeWorker, attendance, markAttendance, wages, payWages };

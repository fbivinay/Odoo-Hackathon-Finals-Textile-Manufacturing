const prisma = require('../lib/prisma');
const { monthRange, dateOnly } = require('../lib/dates');
const { notFound } = require('../lib/errors');
const { payslip } = require('../lib/payroll');

// Everyone on the floor today. Removed workers stay in old registers only.
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
  const [workers, marks, payments] = await Promise.all([
    prisma.worker.findMany({ orderBy: { code: 'asc' } }),
    prisma.attendance.findMany({ where: { date: { gte: range.start, lt: range.end } } }),
    prisma.wagePayment.findMany({ where: { month: range.month } }),
  ]);
  const paidOf = new Map(payments.map((p) => [p.workerId, p]));

  const rows = workers
    .map((worker) => {
      const mine = marks.filter((m) => m.workerId === worker.id);
      const days = (status) => mine.filter((m) => m.status === status).length;
      const present = days('PRESENT');
      const halfDays = days('HALF_DAY');
      const nightDays = mine.filter((m) => m.shift === 'NIGHT' && m.status !== 'ABSENT').reduce((t, m) => t + (m.status === 'PRESENT' ? 1 : 0.5), 0);
      const payment = paidOf.get(worker.id);
      const slip = payslip({ present, halfDays, nightDays, dailyWage: worker.dailyWage, overtime: Number(payment?.overtime || 0), deductions: Number(payment?.deductions || 0) });
      const earned = slip.gross;
      const paid = payment ? Number(payment.amount) : 0;
      return {
        worker: { id: worker.id, code: worker.code, name: worker.name, shift: worker.shift, dailyWage: worker.dailyWage, department: worker.department },
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

module.exports = { listWorkers, createWorker, updateWorker, removeWorker, attendance, markAttendance, wages, payWages };

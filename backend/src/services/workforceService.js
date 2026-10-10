const prisma = require('../lib/prisma');
const { monthRange, dateOnly } = require('../lib/dates');
const { notFound } = require('../lib/errors');

const listWorkers = () => prisma.worker.findMany({ orderBy: { code: 'asc' } });
const createWorker = (data) => prisma.worker.create({ data });

async function updateWorker(id, data) {
  if (!(await prisma.worker.findUnique({ where: { id } }))) throw notFound('Worker not found');
  return prisma.worker.update({ where: { id }, data });
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

// Wages earned from the register: full day = daily wage, half day = half.
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
      const earned = (present + halfDays * 0.5) * Number(worker.dailyWage);
      const payment = paidOf.get(worker.id);
      const paid = payment ? Number(payment.amount) : 0;
      return {
        worker: { id: worker.id, code: worker.code, name: worker.name, shift: worker.shift, dailyWage: worker.dailyWage },
        present,
        halfDays,
        absent: days('ABSENT'),
        earned,
        paid,
        due: Math.max(0, earned - paid),
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
        update: { amount: r.earned, paidAt: new Date() },
        create: { workerId: r.worker.id, month: sheet.month, amount: r.earned },
      })
    )
  );
  return wages({ month });
}

module.exports = { listWorkers, createWorker, updateWorker, attendance, markAttendance, wages, payWages };

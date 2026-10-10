const prisma = require('../lib/prisma');
const { monthRange, dateOnly } = require('../lib/dates');
const { notFound } = require('../lib/errors');
const { payslip } = require('../lib/payroll');

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

module.exports = { listWorkers, createWorker, updateWorker, attendance, markAttendance, wages, payWages };

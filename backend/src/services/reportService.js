const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const { monthRange } = require('../lib/dates');
const { pageArgs, toPage, countFor, dateRange } = require('../lib/paging');
const materialService = require('./materialService');
const orderService = require('./orderService');
const productionService = require('./productionService');
const qcService = require('./qcService');
const { setting } = require('./configService');

const round = (n) => Math.round(n * 100) / 100;
const sum = (rows, key) => rows.reduce((total, r) => total + Number(r[key]), 0);

// One-screen picture of the mill right now. Counted in the database, so it stays quick on years of data.
async function summary() {
  const unpaid = { status: { not: 'PAID' } };
  const [byStatusRows, delayed, delayedList, lowStock, floor, qc, shelf, billed, received] = await Promise.all([
    prisma.order.groupBy({ by: ['status'], _count: true }),
    prisma.order.count({ where: orderService.delayedWhere() }),
    prisma.order.findMany({
      where: orderService.delayedWhere(),
      orderBy: { deadline: 'asc' },
      take: 10,
      include: { buyer: { select: { id: true, name: true } } },
    }),
    materialService.list({ lowStock: 'true' }),
    productionService.board(),
    qcService.counts(),
    prisma.roll.aggregate({ where: { status: 'PASSED', dispatchId: null }, _count: true, _sum: { qty: true } }),
    prisma.$queryRaw`SELECT COALESCE(SUM(COALESCE("totalAmount", amount)), 0)::float AS amount FROM "Invoice" WHERE status <> 'PAID'`,
    prisma.payment.aggregate({ where: { invoice: unpaid }, _sum: { amount: true } }),
  ]);

  const byStatus = {};
  let total = 0;
  for (const row of byStatusRows) {
    byStatus[row.status] = row._count;
    total += row._count;
  }
  const closed = orderService.CLOSED.reduce((n, status) => n + (byStatus[status] || 0), 0);

  return {
    orders: {
      total,
      open: total - closed,
      delayed,
      byStatus,
      delayedList: delayedList.map(orderService.decorate),
    },
    materials: { lowStockCount: lowStock.length, lowStock },
    machines: floor.summary,
    qc: { ...qc.counts, passRate: qc.passRate },
    finishedStock: { rolls: shelf._count, qty: Number(shelf._sum.qty || 0) },
    receivables: round(Number(billed[0].amount || 0) - Number(received._sum.amount || 0)),
  };
}

// What it actually cost to make each order: yarn issued + labour time on its jobs.
// Filters: status, buyerId, from/to (order created), limit/cursor. Totals are summed in the database.
async function orderCosts(query = {}) {
  const { id, status, buyerId, from, to } = query;
  const filtered = Boolean(id || status || buyerId || from || to || query.limit);
  const where = { id, status, buyerId, createdAt: dateRange(from, to) };
  const orders = await prisma.order.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { buyer: { select: { id: true, name: true } } },
    ...pageArgs(query),
  });
  const total = await countFor(prisma.order, where, query);
  const page = toPage(orders, query, total);
  const ids = page.data.map((o) => o.id);
  if (ids.length === 0) return page;

  // On an unfiltered run every order is wanted, so skip the id list entirely.
  const shiftHours = await setting('shiftHours');
  const only = (column) => (filtered ? Prisma.sql`WHERE ${column} IN (${Prisma.join(ids)})` : Prisma.empty);
  const [issues, labour, rolls, invoices] = await Promise.all([
    prisma.materialIssue.groupBy({ by: ['orderId'], where: filtered ? { orderId: { in: ids } } : {}, _sum: { cost: true } }),
    prisma.$queryRaw`
      SELECT j."orderId" AS id,
             SUM(w."dailyWage" * EXTRACT(EPOCH FROM (COALESCE(j."completedAt", NOW()) - j."startedAt")) / 3600 / ${shiftHours})::float AS value
      FROM "ProductionJob" j JOIN "Worker" w ON w.id = j."workerId"
      ${only(Prisma.sql`j."orderId"`)}
      GROUP BY j."orderId"`,
    prisma.roll.groupBy({ by: ['orderId', 'status'], where: filtered ? { orderId: { in: ids } } : {}, _sum: { qty: true }, _count: true }),
    prisma.$queryRaw`
      SELECT d."orderId" AS id, SUM(i.amount)::float AS value
      FROM "Invoice" i JOIN "Dispatch" d ON d.id = i."dispatchId"
      ${only(Prisma.sql`d."orderId"`)}
      GROUP BY d."orderId"`,
  ]);

  const materialOf = new Map(issues.map((r) => [r.orderId, Number(r._sum.cost || 0)]));
  const labourOf = new Map(labour.map((r) => [r.id, r.value || 0]));
  const invoicedOf = new Map(invoices.map((r) => [r.id, r.value || 0]));
  const rollsOf = new Map();
  for (const r of rolls) {
    const entry = rollsOf.get(r.orderId) || { goodQty: 0, good: 0, rejectedQty: 0 };
    if (['PASSED', 'DISPATCHED'].includes(r.status)) {
      entry.goodQty += Number(r._sum.qty || 0);
      entry.good += r._count;
    }
    if (r.status === 'REJECTED') entry.rejectedQty += Number(r._sum.qty || 0);
    rollsOf.set(r.orderId, entry);
  }

  page.data = page.data.map((order) => {
    const materialCost = materialOf.get(order.id) || 0;
    const labourCost = labourOf.get(order.id) || 0;
    const { goodQty, good, rejectedQty } = rollsOf.get(order.id) || { goodQty: 0, good: 0, rejectedQty: 0 };
    const totalCost = materialCost + labourCost;
    const orderValue = Number(order.qty) * Number(order.pricePerUnit);

    return {
      id: order.id,
      orderNo: order.orderNo,
      buyer: order.buyer,
      fabricType: order.fabricType,
      colour: order.colour,
      status: order.status,
      qty: order.qty,
      goodQty: round(goodQty),
      rolls: good,
      rejectedQty: round(rejectedQty),
      materialCost: round(materialCost),
      labourCost: round(labourCost),
      totalCost: round(totalCost),
      costPerUnit: goodQty ? round(totalCost / goodQty) : null,
      costPerRoll: good ? round(totalCost / good) : null,
      orderValue: round(orderValue),
      invoiced: round(invoicedOf.get(order.id) || 0),
      margin: round(orderValue - totalCost),
    };
  });
  return page;
}

// How much every machine on the floor produced in the month against the most it could have made
// (its daily capacity × working days so far; Sundays closed), with a per-day series for charts.
async function machineOutput({ month } = {}) {
  const range = monthRange(month);
  const until = Math.min(range.end.getTime(), Date.now());
  let workDays = 0;
  for (let t = range.start.getTime(); t < until; t += 86400000) if (new Date(t).getUTCDay() !== 0) workDays += 1;
  const [machines, logs] = await Promise.all([
    prisma.machine.findMany({ where: { removedAt: null }, orderBy: { code: 'asc' } }),
    prisma.productionLog.findMany({ where: { loggedAt: { gte: range.start, lt: range.end } } }),
  ]);

  const daily = new Map();
  const rows = machines.map((machine) => {
    const mine = logs.filter((l) => l.machineId === machine.id);
    for (const log of mine) {
      const day = log.loggedAt.toISOString().slice(0, 10);
      daily.set(day, (daily.get(day) || 0) + Number(log.qty));
    }
    const capacity = machine.dailyCapacity === null ? null : round(Number(machine.dailyCapacity) * workDays);
    return { id: machine.id, code: machine.code, name: machine.name, type: machine.type, status: machine.status, produced: round(sum(mine, 'qty')), capacity };
  });

  return {
    month: range.month,
    workDays,
    machines: rows,
    daily: [...daily].sort().map(([date, qty]) => ({ date, qty: round(qty) })),
    total: round(sum(rows, 'produced')),
  };
}

// Did the mill make money this month? The month's line from Accounts (materials charged when their
// fabric is invoiced, not when bought), so the Overview, Accounts and Everest Lab show one profit.
// All pre-tax: GST collected or paid is not income or cost (Accounts > GST shows it separately).
async function pnl({ month } = {}) {
  const range = monthRange(month);
  // Required here, not at the top: accountsService requires this file.
  const accounts = require('./accountsService');
  const p = accounts.period({ from: `${range.month}-01`, to: new Date(range.end.getTime() - 86400000).toISOString().slice(0, 10) });
  const within = { gte: p.start, lt: p.end };
  const [[books], bills, supplierPaid, wagesPaid] = await Promise.all([
    accounts.monthly(p),
    prisma.materialInward.aggregate({ where: { receivedAt: within }, _sum: { billAmount: true } }),
    prisma.supplierPayment.aggregate({ where: { paidAt: within }, _sum: { amount: true } }),
    prisma.wagePayment.aggregate({ where: { paidAt: within }, _sum: { amount: true } }),
  ]);

  return {
    month: range.month,
    invoiced: books.revenue,
    materialsUsed: books.materials,
    // Bought this month: stock until it is used, so not a cost.
    materialBills: round(Number(bills._sum.billAmount || 0)),
    wagesEarned: books.wages,
    wagesPaid: round(Number(wagesPaid._sum.amount || 0)),
    logistics: books.logistics,
    utilities: books.utilities,
    maintenance: books.maintenance,
    expenses: round(books.materials + books.wages + books.logistics + books.utilities + books.maintenance),
    paymentsReceived: books.cashIn,
    supplierPayments: round(Number(supplierPaid._sum.amount || 0)),
    profit: books.netProfit,
    // Money actually in minus money actually out (supplier bills, expenses and wages paid).
    cashFlow: round(books.cashIn - books.cashOut),
  };
}

module.exports = { summary, orderCosts, machineOutput, pnl };

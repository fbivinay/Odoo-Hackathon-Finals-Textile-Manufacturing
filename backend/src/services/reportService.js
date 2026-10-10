const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const { monthRange } = require('../lib/dates');
const { pageArgs, toPage, dateRange } = require('../lib/paging');
const materialService = require('./materialService');
const orderService = require('./orderService');
const productionService = require('./productionService');
const qcService = require('./qcService');
const workforceService = require('./workforceService');
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
  const orders = await prisma.order.findMany({
    where: { id, status, buyerId, createdAt: dateRange(from, to) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { buyer: { select: { id: true, name: true } } },
    ...pageArgs(query),
  });
  const page = toPage(orders, query);
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

// How much every machine produced in the month, with a per-day series for charts.
async function machineOutput({ month } = {}) {
  const range = monthRange(month);
  const [machines, logs] = await Promise.all([
    prisma.machine.findMany({ orderBy: { code: 'asc' } }),
    prisma.productionLog.findMany({ where: { loggedAt: { gte: range.start, lt: range.end } } }),
  ]);

  const daily = new Map();
  const rows = machines.map((machine) => {
    const mine = logs.filter((l) => l.machineId === machine.id);
    for (const log of mine) {
      const day = log.loggedAt.toISOString().slice(0, 10);
      daily.set(day, (daily.get(day) || 0) + Number(log.qty));
    }
    return { id: machine.id, code: machine.code, name: machine.name, type: machine.type, status: machine.status, produced: round(sum(mine, 'qty')) };
  });

  return {
    month: range.month,
    machines: rows,
    daily: [...daily].sort().map(([date, qty]) => ({ date, qty: round(qty) })),
    total: round(sum(rows, 'produced')),
  };
}

// Did the mill make money this month? Material bills, wages, logistics and utilities against sales.
// All pre-tax: GST collected or paid is not income or cost (Accounts > GST shows it separately).
async function pnl({ month } = {}) {
  const range = monthRange(month);
  const within = { gte: range.start, lt: range.end };
  const [inwards, invoices, payments, wageSheet, expenses, supplierPaid, expensePaid] = await Promise.all([
    prisma.materialInward.findMany({ where: { receivedAt: within } }),
    prisma.invoice.findMany({ where: { issuedAt: within } }),
    prisma.payment.findMany({ where: { paidAt: within } }),
    workforceService.wages({ month: range.month }),
    prisma.expense.findMany({ where: { incurredAt: within } }),
    prisma.supplierPayment.findMany({ where: { paidAt: within } }),
    prisma.expense.findMany({ where: { paidAt: within } }),
  ]);

  const materialBills = sum(inwards, 'billAmount');
  const invoiced = sum(invoices, 'amount');
  const paymentsReceived = sum(payments, 'amount');
  const { earned: wagesEarned, paid: wagesPaid } = wageSheet.totals;
  // Tax the mill cannot claim back is a cost; claimable GST is not.
  const costOf = (e) => Number(e.amount) + (e.itcEligible ? 0 : Number(e.cgst) + Number(e.sgst) + Number(e.igst));
  const logistics = expenses.filter((e) => e.category === 'LOGISTICS').reduce((t, e) => t + costOf(e), 0);
  const utilities = expenses.filter((e) => e.category === 'UTILITIES').reduce((t, e) => t + costOf(e), 0);
  const paidOut = sum(supplierPaid, 'amount') + expensePaid.reduce((t, e) => t + Number(e.totalAmount ?? e.amount), 0);

  return {
    month: range.month,
    materialBills: round(materialBills),
    wagesEarned: round(wagesEarned),
    wagesPaid: round(wagesPaid),
    logistics: round(logistics),
    utilities: round(utilities),
    invoiced: round(invoiced),
    paymentsReceived: round(paymentsReceived),
    supplierPayments: round(sum(supplierPaid, 'amount')),
    // Billed sales against the month's costs.
    profit: round(invoiced - materialBills - wagesEarned - logistics - utilities),
    // Money actually in minus money actually out (supplier bills paid, expenses paid, wages paid).
    cashFlow: round(paymentsReceived - paidOut - wagesPaid),
  };
}

module.exports = { summary, orderCosts, machineOutput, pnl };

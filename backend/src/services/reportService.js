const prisma = require('../lib/prisma');
const { monthRange } = require('../lib/dates');
const materialService = require('./materialService');
const orderService = require('./orderService');
const productionService = require('./productionService');
const qcService = require('./qcService');
const dispatchService = require('./dispatchService');
const workforceService = require('./workforceService');

const HOURS_PER_SHIFT = 8;
const round = (n) => Math.round(n * 100) / 100;
const sum = (rows, key) => rows.reduce((total, r) => total + Number(r[key]), 0);

// One-screen picture of the mill right now.
async function summary() {
  const [orders, lowStock, floor, qc, shelf, invoices] = await Promise.all([
    orderService.list(),
    materialService.list({ lowStock: 'true' }),
    productionService.board(),
    qcService.summary(),
    dispatchService.stock(),
    dispatchService.listInvoices(),
  ]);

  const byStatus = {};
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
  const open = orders.filter((o) => !['DISPATCHED', 'CANCELLED'].includes(o.status));

  return {
    orders: {
      total: orders.length,
      open: open.length,
      delayed: open.filter((o) => o.isDelayed).length,
      byStatus,
      delayedList: open.filter((o) => o.isDelayed).slice(0, 10),
    },
    materials: { lowStockCount: lowStock.length, lowStock },
    machines: floor.summary,
    qc: { ...qc.counts, passRate: qc.passRate },
    finishedStock: { rolls: shelf.totalRolls, qty: shelf.totalQty },
    receivables: round(sum(invoices, 'balance')),
  };
}

// What it actually cost to make each order: yarn issued + labour time on its jobs.
async function orderCosts() {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      buyer: { select: { id: true, name: true } },
      issues: true,
      jobs: { include: { worker: true } },
      rolls: true,
      dispatches: { include: { invoice: true } },
    },
  });

  return orders.map((order) => {
    const materialCost = sum(order.issues, 'cost');
    const labourCost = order.jobs.reduce((total, job) => {
      if (!job.worker) return total;
      const hours = ((job.completedAt || new Date()) - job.startedAt) / 3600000;
      return total + (Number(job.worker.dailyWage) * hours) / HOURS_PER_SHIFT;
    }, 0);
    const good = order.rolls.filter((r) => ['PASSED', 'DISPATCHED'].includes(r.status));
    const goodQty = sum(good, 'qty');
    const totalCost = materialCost + labourCost;
    const orderValue = Number(order.qty) * Number(order.pricePerUnit);
    const invoiced = order.dispatches.reduce((total, d) => total + Number(d.invoice?.amount || 0), 0);

    return {
      id: order.id,
      orderNo: order.orderNo,
      buyer: order.buyer,
      fabricType: order.fabricType,
      colour: order.colour,
      status: order.status,
      qty: order.qty,
      goodQty,
      rolls: good.length,
      rejectedQty: sum(order.rolls.filter((r) => r.status === 'REJECTED'), 'qty'),
      materialCost: round(materialCost),
      labourCost: round(labourCost),
      totalCost: round(totalCost),
      costPerUnit: goodQty ? round(totalCost / goodQty) : null,
      costPerRoll: good.length ? round(totalCost / good.length) : null,
      orderValue: round(orderValue),
      invoiced: round(invoiced),
      margin: round(orderValue - totalCost),
    };
  });
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

// Did the mill make money this month? Yarn bills and wages against buyer payments.
async function pnl({ month } = {}) {
  const range = monthRange(month);
  const within = { gte: range.start, lt: range.end };
  const [inwards, invoices, payments, wageSheet] = await Promise.all([
    prisma.materialInward.findMany({ where: { receivedAt: within } }),
    prisma.invoice.findMany({ where: { issuedAt: within } }),
    prisma.payment.findMany({ where: { paidAt: within } }),
    workforceService.wages({ month: range.month }),
  ]);

  const materialBills = sum(inwards, 'billAmount');
  const invoiced = sum(invoices, 'amount');
  const paymentsReceived = sum(payments, 'amount');
  const { earned: wagesEarned, paid: wagesPaid } = wageSheet.totals;

  return {
    month: range.month,
    materialBills: round(materialBills),
    wagesEarned: round(wagesEarned),
    wagesPaid: round(wagesPaid),
    invoiced: round(invoiced),
    paymentsReceived: round(paymentsReceived),
    // Billed sales against the month's costs.
    profit: round(invoiced - materialBills - wagesEarned),
    // Money actually in minus money actually out.
    cashFlow: round(paymentsReceived - materialBills - wagesPaid),
  };
}

module.exports = { summary, orderCosts, machineOutput, pnl };

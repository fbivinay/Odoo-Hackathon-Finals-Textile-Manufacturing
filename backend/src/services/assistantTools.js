const prisma = require('../lib/prisma');
const materialService = require('./materialService');
const orderService = require('./orderService');
const productionService = require('./productionService');
const planningService = require('./planningService');
const qcService = require('./qcService');
const dispatchService = require('./dispatchService');
const reportService = require('./reportService');
const workforceService = require('./workforceService');
const masterService = require('./masterService');
const userService = require('./userService');
const { TAB_LABEL, ROLE_LABEL } = require('../lib/tabs');

// What the chat assistant can look up. Every tool only reads; nothing here changes data.
// `access` lists the sidebar tabs that open a tool (any one is enough); 'OWNER' means owner only.
// The assistant is only ever handed the tools the signed-in user may use, and `run` is checked
// again before it executes, so the model cannot reach data the person could not open themselves.

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
// A moment in the mill's own clock, ready to quote: "10 Oct 2026, 10:44 PM".
const when = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/, (m) => m.toUpperCase()) : null;
const num = (n) => (n === null || n === undefined ? null : Math.round(Number(n) * 100) / 100);
const cap = (limit, max = 25, fallback = 10) => Math.min(Math.max(Number(limit) || fallback, 1), max);
const rowsOf = (result) => (Array.isArray(result) ? result : result.data);

const DATE = { type: 'string', description: 'YYYY-MM-DD' };
const MONTH = { type: 'string', description: 'YYYY-MM; defaults to the current month' };
const ORDER_STATUS = ['PENDING', 'SPINNING', 'WEAVING', 'DYEING', 'QC', 'READY', 'DISPATCHED', 'CANCELLED'];

const orderRow = (o) => ({
  orderNo: o.orderNo, buyer: o.buyer?.name, fabric: o.fabricType, colour: o.colour, qtyMetres: num(o.qty),
  status: o.status, deadline: day(o.deadline), placedOn: day(o.createdAt), isLate: o.isDelayed,
});

async function orderByNo(orderNo) {
  // People say "2700" as often as "ORD-2700".
  const typed = String(orderNo).trim();
  const wanted = /^\d+$/.test(typed) ? `ORD-${typed}` : typed;
  const order = await prisma.order.findFirst({ where: { orderNo: { equals: wanted, mode: 'insensitive' } }, select: { id: true } });
  return order?.id;
}

// The kinds of material this person's tabs cover: yarn sits under Yarn Received, the rest under Raw Materials.
function materialKinds(ctx, wanted = 'all') {
  const kinds = [];
  if (ctx.can('/materials') && wanted !== 'other') kinds.push('yarn');
  if (ctx.can('/raw-materials') && wanted !== 'yarn') kinds.push('other');
  return kinds;
}
const kindQuery = (kinds) => (kinds.length === 2 ? {} : kinds[0] === 'yarn' ? { category: 'YARN' } : { kind: 'other' });
const NO_KIND = { note: 'This person has no access to that kind of material.' };
const KIND = { type: 'string', enum: ['yarn', 'other', 'all'], description: 'yarn, other (dyes, chemicals, packaging) or all' };

const TOOLS = [
  {
    name: 'stock_levels',
    description: 'Current stock of yarn and other raw materials (dyes, chemicals, packaging), with low-stock flags.',
    access: ['/materials', '/raw-materials'],
    input: { kind: KIND, lowOnly: { type: 'boolean', description: 'only items at or below their reorder level' }, search: { type: 'string', description: 'part of the material name or colour' } },
    async run({ kind, lowOnly, search }, ctx) {
      const kinds = materialKinds(ctx, kind);
      if (!kinds.length) return NO_KIND;
      const q = (search || '').toLowerCase();
      const rows = (await materialService.list({ ...kindQuery(kinds), lowStock: lowOnly ? 'true' : undefined }))
        .filter((m) => !q || `${m.yarnType} ${m.colour}`.toLowerCase().includes(q))
        .map((m) => ({ name: m.yarnType, colour: m.colour, type: m.category, inStock: num(m.qtyInStock), unit: m.unit, reorderLevel: num(m.reorderLevel), lowStock: m.lowStock, avgCostPerUnit: num(m.avgCost) }));
      return { count: rows.length, materials: rows.slice(0, 40) };
    },
  },
  {
    name: 'received_history',
    description: 'Deliveries of yarn or other materials received at the gate: what, how much, from which supplier, bill amount.',
    access: ['/materials', '/raw-materials'],
    input: { kind: KIND, from: DATE, to: DATE, limit: { type: 'integer' } },
    async run({ kind, from, to, limit }, ctx) {
      const kinds = materialKinds(ctx, kind);
      if (!kinds.length) return NO_KIND;
      const rows = rowsOf(await materialService.listInwards({ ...kindQuery(kinds), from, to, limit: cap(limit) }));
      return rows.map((i) => ({ receivedOn: day(i.receivedAt), material: `${i.material.yarnType} ${i.material.colour}`, qty: num(i.qty), unit: i.material.unit, supplier: i.supplier.name, ratePerUnit: num(i.rate), bill: num(i.billAmount) }));
    },
  },
  {
    name: 'purchase_orders',
    description: 'Purchase orders placed with suppliers for yarn or other materials, and whether they have arrived.',
    access: ['/materials', '/raw-materials'],
    input: { kind: KIND, status: { type: 'string', enum: ['PENDING', 'RECEIVED', 'CANCELLED'] }, limit: { type: 'integer' } },
    async run({ kind, status, limit }, ctx) {
      const kinds = materialKinds(ctx, kind);
      if (!kinds.length) return NO_KIND;
      const rows = rowsOf(await materialService.listPurchaseOrders({ ...kindQuery(kinds), status, limit: cap(limit) }));
      return rows.map((p) => ({ poNo: p.poNo, material: p.material && `${p.material.yarnType} ${p.material.colour}`, supplier: p.supplier?.name, qty: num(p.qty), status: p.status, orderedOn: day(p.orderedAt), receivedOn: day(p.receivedAt) }));
    },
  },
  {
    name: 'suppliers',
    description: 'The suppliers the mill buys from.',
    access: ['/materials', '/raw-materials'],
    input: {},
    run: async () => (await masterService.listSuppliers()).map((s) => ({ name: s.name, phone: s.phone })),
  },
  {
    name: 'order_counts',
    description: 'How many buyer orders are in each status, how many are open, and how many are past their deadline.',
    access: ['/orders'],
    input: {},
    async run() {
      const [byStatus, late] = await Promise.all([
        prisma.order.groupBy({ by: ['status'], _count: true }),
        prisma.order.count({ where: orderService.delayedWhere() }),
      ]);
      const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count]));
      const total = byStatus.reduce((n, r) => n + r._count, 0);
      const closed = orderService.CLOSED.reduce((n, s) => n + (counts[s] || 0), 0);
      return { total, open: total - closed, pastDeadline: late, byStatus: counts };
    },
  },
  {
    name: 'order_trend',
    description: 'Orders received month by month (count, metres, value) for trends, comparisons and forecasts. Includes this month so far, its pace, and ready-made signals for estimating next month. Optionally the top buyers or fabrics of the period.',
    access: ['/orders'],
    input: {
      months: { type: 'integer', description: 'how many past months to include, default 6, at most 24' },
      breakdown: { type: 'string', enum: ['buyer', 'fabric'], description: 'also list the top buyers or fabrics over the period' },
    },
    async run({ months, breakdown }) {
      const span = cap(months, 24, 6);
      const now = new Date();
      const monthStart = (offset) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
      const key = (d) => d.toISOString().slice(0, 7);
      // Thirteen months back at least, so "same month last year" is always there to compare.
      const since = monthStart(-Math.max(span, 13));
      const rows = await prisma.$queryRaw`
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month,
               count(*)::int AS orders, sum(qty)::float AS metres, sum(qty * "pricePerUnit")::float AS value
        FROM "Order" WHERE "createdAt" >= ${since} AND status <> 'CANCELLED'
        GROUP BY 1 ORDER BY 1`;
      const of = new Map(rows.map((m) => [m.month, { month: m.month, orders: m.orders, metres: num(m.metres), value: num(m.value) }]));
      const at = (offset) => of.get(key(monthStart(offset))) || { month: key(monthStart(offset)), orders: 0, metres: 0, value: 0 };

      const current = at(0);
      const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
      const daysSoFar = now.getUTCDate();
      const atThisPace = Math.round((current.orders / daysSoFar) * daysInMonth);
      const lastThree = [at(-1), at(-2), at(-3)];
      const avgLastThree = Math.round(lastThree.reduce((n, m) => n + m.orders, 0) / 3);
      const nextMonthLastYear = at(-11).orders;
      const signals = [atThisPace, avgLastThree, nextMonthLastYear].filter((n) => n > 0);

      const result = {
        monthly: Array.from({ length: span }, (_, i) => at(i - span)).concat([]),
        thisMonthSoFar: { ...current, daysSoFar, daysInMonth, ordersAtThisPaceByMonthEnd: atThisPace, sameMonthLastYear: at(-12).orders },
        forNextMonthEstimate: {
          nextMonth: key(monthStart(1)),
          averageOfLastThreeFullMonths: avgLastThree,
          thisMonthProjectedAtCurrentPace: atThisPace,
          sameMonthLastYear: nextMonthLastYear,
          likelyRange: signals.length ? { low: Math.min(...signals), high: Math.max(...signals) } : null,
          note: 'An estimate from past orders only; it knows nothing about new buyers, prices or the season ahead.',
        },
      };
      if (breakdown) {
        const top = await prisma.order.groupBy({
          by: [breakdown === 'buyer' ? 'buyerId' : 'fabricType'],
          where: { createdAt: { gte: monthStart(-span) }, status: { not: 'CANCELLED' } },
          _count: true, _sum: { qty: true }, orderBy: { _count: { id: 'desc' } }, take: 8,
        });
        const names = breakdown === 'buyer' ? new Map((await masterService.listBuyers()).map((b) => [b.id, b.name])) : null;
        result.top = top.map((t) => ({ [breakdown]: names ? names.get(t.buyerId) : t.fabricType, orders: t._count, metres: num(t._sum.qty) }));
      }
      return result;
    },
  },
  {
    name: 'search_orders',
    description: 'Find buyer orders. Filter by text (order number, fabric or buyer name), status, lateness, deadline range or placed-on range. Sorted by deadline, earliest first.',
    access: ['/orders'],
    input: {
      text: { type: 'string', description: 'part of an order number, fabric or buyer name' },
      status: { type: 'string', enum: ORDER_STATUS },
      lateOnly: { type: 'boolean', description: 'only open orders past their deadline' },
      openOnly: { type: 'boolean', description: 'leave out dispatched and cancelled orders' },
      dueFrom: DATE, dueTo: DATE, placedFrom: DATE, placedTo: DATE,
      limit: { type: 'integer', description: 'rows to return, at most 25' },
    },
    async run({ text, status, lateOnly, openOnly, dueFrom, dueTo, placedFrom, placedTo, limit }) {
      const take = cap(limit);
      // Open-only is filtered here, so fetch enough rows to still fill the page.
      const page = await orderService.list({ q: text, status, delayed: lateOnly ? 'true' : undefined, dueFrom, dueTo, from: placedFrom, to: placedTo, limit: openOnly ? 500 : take });
      const rows = page.data.filter((o) => !openOnly || !orderService.CLOSED.includes(o.status));
      return { shown: Math.min(rows.length, take), moreExist: rows.length > take || Boolean(page.meta.nextCursor), orders: rows.slice(0, take).map(orderRow) };
    },
  },
  {
    name: 'order_details',
    description: 'Everything about one buyer order by its order number: progress through spinning, weaving, dyeing, rolls and their quality results, yarn, and dispatches.',
    access: ['/orders'],
    input: { orderNo: { type: 'string', description: 'e.g. ORD-2700; a bare number like 2700 is fine' } },
    required: ['orderNo'],
    async run({ orderNo }, ctx) {
      const id = await orderByNo(orderNo);
      if (!id) return { note: `No order with number ${orderNo}.` };
      const o = await orderService.get(id);
      const stage = (s) => {
        const jobs = o.jobs.filter((j) => j.stage === s);
        return { jobs: jobs.length, running: jobs.filter((j) => j.status === 'RUNNING').length, produced: num(jobs.reduce((n, j) => n + Number(j.qtyProduced || 0), 0)) };
      };
      const rolls = {};
      for (const r of o.rolls) rolls[r.status] = (rolls[r.status] || 0) + 1;
      const money = ctx.can('/dispatch'); // invoices belong to the dispatch desk
      return {
        ...orderRow(o), buyerPhone: o.buyer.phone, yarn: o.material && `${o.material.yarnType} ${o.material.colour}`, yarnNeededKg: num(o.yarnRequired),
        yarnIssuedKg: num(o.issues.reduce((n, i) => n + Number(i.qty), 0)), yarnAvailability: o.availability,
        stages: { SPINNING: stage('SPINNING'), WEAVING: stage('WEAVING'), DYEING: stage('DYEING') },
        rollsByStatus: rolls,
        dispatches: o.dispatches.map((d) => ({ dispatchNo: d.dispatchNo, on: day(d.dispatchedAt), vehicle: d.vehicleNo, ...(money && d.invoice ? { invoiceNo: d.invoice.invoiceNo, invoiceAmountBeforeGst: num(d.invoice.amount), invoiceTotalWithGst: num(d.invoice.totalAmount ?? d.invoice.amount), invoiceStatus: d.invoice.status } : {}) })),
      };
    },
  },
  {
    name: 'buyers',
    description: 'The mill\'s buyers (clients) and how many orders each has placed.',
    access: ['/orders', '/clients'],
    input: {},
    run: async () => (await masterService.listBuyers()).map((b) => ({ name: b.name, phone: b.phone, orders: b._count.orders })),
  },
  {
    name: 'production_floor',
    description: 'Live production floor: every machine, whether it is running, idle or down, what order it is on, and what it produced today.',
    access: ['/production'],
    input: {},
    async run() {
      const { machines, summary } = await productionService.board();
      return {
        summary,
        machines: machines.map((m) => ({
          code: m.code, stage: m.type, status: m.status, producedToday: num(m.producedToday),
          job: m.currentJob && { orderNo: m.currentJob.order?.orderNo, operator: m.currentJob.worker?.name, shift: m.currentJob.shift, planned: num(m.currentJob.qtyPlanned), produced: num(m.currentJob.qtyProduced), percent: m.currentJob.percent },
        })),
      };
    },
  },
  {
    name: 'production_queue',
    description: 'Orders waiting for work in one stage (spinning, weaving or dyeing), earliest deadline first, with how much is left.',
    access: ['/production'],
    input: { stage: { type: 'string', enum: ['SPINNING', 'WEAVING', 'DYEING'] } },
    required: ['stage'],
    async run({ stage }) {
      const rows = await productionService.queue({ stage });
      return { waiting: rows.length, orders: rows.slice(0, 15).map((r) => ({ orderNo: r.orderNo, buyer: r.buyer?.name, fabric: r.fabricType, deadline: day(r.deadline), target: num(r.target), done: num(r.done), remaining: num(r.remaining), canStartNow: num(r.available), running: r.running })) };
    },
  },
  {
    name: 'attendance',
    description: 'The worker attendance register for one day: who is present, half day, absent or not marked.',
    access: ['/production'],
    input: { date: { ...DATE, description: 'YYYY-MM-DD; defaults to today' } },
    async run({ date }) {
      const register = await workforceService.attendance({ date });
      const counts = {};
      for (const w of register.workers) counts[w.status || 'NOT_MARKED'] = (counts[w.status || 'NOT_MARKED'] || 0) + 1;
      const names = (status) => register.workers.filter((w) => w.status === status).map((w) => `${w.name} (${w.shift})`).slice(0, 30);
      return { date: register.date, workers: register.workers.length, counts, absent: names('ABSENT'), halfDay: names('HALF_DAY') };
    },
  },
  {
    name: 'delivery_forecast',
    description: 'The delivery forecast: which open orders will finish on time or late, which are waiting for yarn, and which yarns need buying.',
    access: ['/orders', '/production'], // Order Forecast was removed; its readers all have Orders
    input: {},
    async run() {
      const plan = await planningService.schedule({ days: 90 });
      const row = (o) => ({ orderNo: o.orderNo, buyer: o.buyer?.name, deadline: day(o.deadline), expectedReady: o.expectedReady, lateByDays: o.lateByDays, yarnShortByKg: o.yarnShortBy });
      return {
        summary: plan.summary,
        lateOrders: plan.orders.filter((o) => o.lateByDays > 0).slice(0, 15).map(row),
        waitingForYarn: plan.orders.filter((o) => o.yarnShortBy > 0).slice(0, 15).map(row),
        yarnToBuy: plan.yarnNeeds.filter((m) => m.shortBy > 0).map((m) => ({ yarn: `${m.yarnType} ${m.colour}`, shortByKg: m.shortBy, inStockKg: num(m.inStock), neededBy: m.neededBy, orders: m.orders })),
      };
    },
  },
  {
    name: 'quality_summary',
    description: 'Quality check results: rolls passed, sent for rework, rejected and waiting, the pass rate, and defects by type and by machine. Optional date range.',
    access: ['/qc', '/waste'],
    input: { from: DATE, to: DATE },
    run: async ({ from, to }) => {
      const s = await qcService.summary({ from, to });
      return { rollsByStatus: s.counts, passRatePercent: s.passRate, defectsByType: s.defectsByType, defectsByMachine: s.defectsByMachine.map((m) => ({ machine: m.code, defects: m.count })) };
    },
  },
  {
    name: 'rolls',
    description: 'Fabric rolls, newest first. Filter by status (e.g. REJECTED for waste, PENDING_QC for the inspection queue), order number or date made.',
    access: ['/qc', '/waste'],
    input: { status: { type: 'string', enum: ['PENDING_QC', 'PASSED', 'REWORK', 'REJECTED', 'DISPATCHED'] }, orderNo: { type: 'string' }, from: DATE, to: DATE, limit: { type: 'integer' } },
    async run({ status, orderNo, from, to, limit }) {
      const orderId = orderNo ? await orderByNo(orderNo) : undefined;
      if (orderNo && !orderId) return { note: `No order with number ${orderNo}.` };
      const rows = rowsOf(await qcService.listRolls({ status, orderId, from, to, limit: cap(limit) }));
      return rows.map((r) => ({ rollNo: r.rollNo, orderNo: r.order.orderNo, fabric: r.order.fabricType, machine: r.machine.code, metres: num(r.qty), status: r.status, madeOn: day(r.createdAt), lastCheck: r.qcRecords[0] && { result: r.qcRecords[0].result, defect: r.qcRecords[0].defectType, by: r.qcRecords[0].inspector?.name } }));
    },
  },
  {
    name: 'ready_to_dispatch',
    description: 'Finished fabric that passed quality check and is waiting to be loaded, grouped by order.',
    access: ['/dispatch'],
    input: {},
    async run() {
      const s = await dispatchService.stock();
      return { totalRolls: s.totalRolls, totalMetres: num(s.totalQty), orders: s.orders.slice(0, 20).map((g) => ({ orderNo: g.order.orderNo, buyer: g.order.buyer.name, fabric: g.order.fabricType, deadline: day(g.order.deadline), rolls: g.rolls.length, metres: num(g.totalQty), orderedMetres: num(g.order.qty) })) };
    },
  },
  {
    name: 'dispatches',
    description: 'Shipments sent to buyers, newest first: dispatch number, order, buyer, vehicle, quantity and invoice.',
    access: ['/dispatch'],
    input: { orderNo: { type: 'string' }, from: DATE, to: DATE, limit: { type: 'integer' } },
    async run({ orderNo, from, to, limit }) {
      const orderId = orderNo ? await orderByNo(orderNo) : undefined;
      if (orderNo && !orderId) return { note: `No order with number ${orderNo}.` };
      const rows = rowsOf(await dispatchService.list({ orderId, from, to, limit: cap(limit) }));
      return rows.map((d) => ({ dispatchNo: d.dispatchNo, on: day(d.dispatchedAt), orderNo: d.order.orderNo, buyer: d.buyer.name, vehicle: d.vehicleNo, rolls: d.rolls.length, metres: num(d.totalQty ?? d.rolls.reduce((n, r) => n + Number(r.qty), 0)), invoiceNo: d.invoice?.invoiceNo, invoiceAmountBeforeGst: num(d.invoice?.amount), invoiceTotalWithGst: num(d.invoice?.totalAmount ?? d.invoice?.amount), invoiceStatus: d.invoice?.status }));
    },
  },
  {
    name: 'invoices',
    description: 'Invoices raised on buyers, newest first, with amount paid and balance. Filter by status to see what is still owed.',
    access: ['/dispatch', '/clients'],
    input: { status: { type: 'string', enum: ['UNPAID', 'PARTIAL', 'PAID'] }, from: DATE, to: DATE, limit: { type: 'integer' } },
    async run({ status, from, to, limit }) {
      const rows = rowsOf(await dispatchService.listInvoices({ status, from, to, limit: cap(limit) }));
      return rows.map((i) => ({ invoiceNo: i.invoiceNo, buyer: i.dispatch?.buyer?.name, orderNo: i.dispatch?.order?.orderNo, issuedOn: day(i.issuedAt), amountBeforeGst: num(i.amount), gst: num(Number(i.cgst || 0) + Number(i.sgst || 0) + Number(i.igst || 0)), totalWithGst: num(i.totalAmount ?? i.amount), paid: num(i.paid), balance: num(i.balance), status: i.status }));
    },
  },
  {
    name: 'mill_summary',
    description: 'Owner overview of the whole mill right now: orders by status, late orders, low stock, machines, quality, finished stock and money owed by buyers.',
    access: 'OWNER',
    input: {},
    async run() {
      const s = await reportService.summary();
      return {
        orders: { total: s.orders.total, open: s.orders.open, pastDeadline: s.orders.delayed, byStatus: s.orders.byStatus, mostOverdue: s.orders.delayedList.map(orderRow) },
        lowStock: s.materials.lowStock.map((m) => ({ name: `${m.yarnType} ${m.colour}`, inStock: num(m.qtyInStock), unit: m.unit, reorderLevel: num(m.reorderLevel) })),
        machines: s.machines, quality: s.qc, finishedStock: s.finishedStock, owedByBuyers: s.receivables,
      };
    },
  },
  {
    name: 'profit_and_loss',
    description: 'Owner only. Money for one month: material bills, wages, invoiced sales, payments received, profit and cash flow.',
    access: 'OWNER',
    input: { month: MONTH },
    run: ({ month }) => reportService.pnl({ month }),
  },
  {
    name: 'money_trend',
    description: 'Owner only. Month by month money: invoiced sales, payments received, material bills, wages, profit and cash flow, for trends and comparisons.',
    access: 'OWNER',
    input: { months: { type: 'integer', description: 'how many months back including this one, default 6, at most 12' } },
    async run({ months }) {
      const span = cap(months, 12, 6);
      const now = new Date();
      const keys = Array.from({ length: span }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (span - 1 - i), 1)).toISOString().slice(0, 7));
      return { note: 'The last month listed is the current one and is not finished yet.', monthly: await Promise.all(keys.map((month) => reportService.pnl({ month }))) };
    },
  },
  {
    name: 'order_costs',
    description: 'What orders cost to make (yarn + labour) against what they were sold for, with margin. Pass an order number for one order.',
    access: ['/clients'],
    input: { orderNo: { type: 'string' }, from: DATE, to: DATE, limit: { type: 'integer' } },
    async run({ orderNo, from, to, limit }) {
      const id = orderNo ? await orderByNo(orderNo) : undefined;
      if (orderNo && !id) return { note: `No order with number ${orderNo}.` };
      const page = await reportService.orderCosts({ id, from, to, limit: cap(limit) });
      return page.data.map((o) => ({ orderNo: o.orderNo, buyer: o.buyer?.name, fabric: o.fabricType, status: o.status, goodMetres: o.goodQty, rejectedMetres: o.rejectedQty, yarnCost: o.materialCost, labourCost: o.labourCost, totalCost: o.totalCost, costPerMetre: o.costPerUnit, orderValue: o.orderValue, invoiced: o.invoiced, margin: o.margin }));
    },
  },
  {
    name: 'machine_output',
    description: 'Owner only. How much each machine produced in a month, and the mill total.',
    access: 'OWNER',
    input: { month: MONTH },
    async run({ month }) {
      const r = await reportService.machineOutput({ month });
      return { month: r.month, total: r.total, machines: r.machines.map((m) => ({ code: m.code, stage: m.type, status: m.status, produced: m.produced })) };
    },
  },
  {
    name: 'wages',
    description: 'Owner only. Wages for a month: total earned, paid and still due, and the workers owed the most.',
    access: 'OWNER',
    input: { month: MONTH },
    async run({ month }) {
      const w = await workforceService.wages({ month });
      const owed = w.rows.filter((r) => r.due > 0).sort((a, b) => b.due - a.due);
      return { month: w.month, workers: w.rows.length, totals: w.totals, workersWithDues: owed.length, topDues: owed.slice(0, 10).map((r) => ({ worker: r.worker.name, shift: r.worker.shift, present: r.present, halfDays: r.halfDays, absent: r.absent, earned: r.earned, paid: r.paid, due: r.due })) };
    },
  },
  {
    name: 'employees',
    description: 'Owner only. The people who can sign in to the system: role, additional access, whether the login is active, and when each was added (use it for oldest and newest employees).',
    access: 'OWNER',
    input: {},
    async run() {
      // Oldest first, so "who joined first / last" reads straight off the list.
      const users = (await userService.list()).sort((a, b) => a.createdAt - b.createdAt);
      return users.map((u) => ({ name: u.name, email: u.email, role: ROLE_LABEL[u.role], additionalAccess: u.extraTabs.map((t) => TAB_LABEL[t] || t), active: u.isActive, passwordNotSetYet: u.mustChangePassword, addedAt: when(u.createdAt) }));
    },
  },
];

const allowed = (tool, user) => user.role === 'OWNER' || (tool.access !== 'OWNER' && tool.access.some((t) => user.tabs.includes(t)));

// The tools this person may use, in the shape the model expects.
const toolsFor = (user) =>
  TOOLS.filter((t) => allowed(t, user)).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { type: 'object', properties: t.input, required: t.required || [] },
  }));

const MAX_RESULT = 14000; // characters of JSON handed back to the model per lookup

async function runTool(name, input, user) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool || !allowed(tool, user)) return { error: 'This person does not have access to that information.' };
  try {
    const ctx = { can: (tab) => user.role === 'OWNER' || user.tabs.includes(tab) };
    const json = JSON.stringify(await tool.run(input || {}, ctx));
    return json.length > MAX_RESULT ? { truncated: true, note: 'Too much to show at once; narrow the question.', partial: json.slice(0, MAX_RESULT) } : JSON.parse(json);
  } catch (err) {
    // A bad filter (say, a malformed date) is the model's to fix; anything else stays vague.
    return { error: err.statusCode && err.statusCode < 500 ? err.message : 'That lookup failed.' };
  }
}

module.exports = { TOOLS, toolsFor, runTool, allowed };

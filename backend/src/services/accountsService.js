// Accounts: registers, documents and reports, all worked out from the recorded transactions.
// Nothing here is stored twice: a supplier bill is its MaterialInward, a sales invoice its
// Invoice, an expense its Expense. Revenue and costs are pre-tax; GST is reported on its own.
//
// Accrual P&L for a period:
//   revenue           = invoices issued (taxable value)
//   materials used    = cost of goods sold: each order's issued materials (yarn, chemicals, packaging)
//                       charged when its fabric is invoiced, in proportion to the metres billed,
//                       plus store issues not tied to an order (QC kits, swatch boxes) when issued.
//                       Materials on orders not yet billed are work in progress, not cost.
//   maintenance       = maintenance stores issued (oil, spares)
//   wages             = gross pay for the months in the period
//   logistics, utilities = expenses incurred (+ any GST that cannot be claimed back)
// Purchases are not a P&L line: bought stock is inventory until it is issued, so it is never
// counted both as stock and as cost.

const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const { notFound, badRequest, conflict } = require('../lib/errors');
const { RULES, rateOn, taxFor, HOME_STATE } = require('../lib/tax');
const { payslip } = require('../lib/payroll');
const workforceService = require('./workforceService');
const reportService = require('./reportService');
const { payableOf, withBalance } = require('./dispatchService');

const DAY = 86400000;
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const tz = Prisma.sql`'Asia/Kolkata'`;
const taxOf = (row) => r2(Number(row.cgst || 0) + Number(row.sgst || 0) + Number(row.igst || 0));
const todayIst = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

// Business identity: only what is configured. No address, GSTIN or signature is invented.
const COMPANY = { name: 'Everest Textile Mills', state: HOME_STATE, address: null, gstin: null, synthetic: true };

// ?from=YYYY-MM-DD&to=YYYY-MM-DD in IST; default: this financial year (April to March) to date.
function period({ from, to } = {}) {
  const today = todayIst();
  const fyStart = `${+today.slice(5, 7) >= 4 ? today.slice(0, 4) : +today.slice(0, 4) - 1}-04-01`;
  const f = from || fyStart;
  const t = to || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) throw badRequest('from and to must be YYYY-MM-DD');
  if (f > t) throw badRequest('from must be on or before to');
  return { from: f, to: t, start: new Date(`${f}T00:00:00+05:30`), end: new Date(new Date(`${t}T00:00:00+05:30`).getTime() + DAY) };
}
const months = (from, to) => {
  const out = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); ) {
    out.push(m);
    const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1));
    m = d.toISOString().slice(0, 7);
  }
  return out;
};
const page = ({ page: p = 1, pageSize = 50 } = {}) => {
  const take = Math.min(Math.max(Number(pageSize) || 50, 1), 500);
  return { take, skip: (Math.max(Number(p) || 1, 1) - 1) * take };
};

// ------------------------------------------------------------ month series --

// Every money stream by IST month, from the database in one pass each.
async function monthly(p) {
  const { start, end } = p;
  const by = async (sql) => new Map((await prisma.$queryRaw(sql)).map((x) => [x.m, x]));
  const [sales, receipts, issues, purchases, supplierPaid, exp, expPaid, wageRows] = await Promise.all([
    by(Prisma.sql`SELECT to_char("issuedAt" AT TIME ZONE ${tz}, 'YYYY-MM') m, SUM(amount)::float v, SUM(cgst+sgst+igst)::float tax FROM "Invoice" WHERE "issuedAt" >= ${start} AND "issuedAt" < ${end} GROUP BY 1`),
    by(Prisma.sql`SELECT to_char("paidAt" AT TIME ZONE ${tz}, 'YYYY-MM') m, SUM(amount)::float v FROM "Payment" WHERE "paidAt" >= ${start} AND "paidAt" < ${end} GROUP BY 1`),
    by(Prisma.sql`WITH oc AS (
                    SELECT i."orderId", SUM(i.cost) cost, SUM(CASE WHEN rm.category = 'YARN' THEN i.cost ELSE 0 END) yarn
                    FROM "MaterialIssue" i JOIN "RawMaterial" rm ON rm.id = i."materialId"
                    WHERE i."orderId" IS NOT NULL AND rm.category <> 'MAINTENANCE' GROUP BY 1),
                  sent AS (SELECT d.id, d."orderId", (SELECT SUM(r.qty) FROM "Roll" r WHERE r."dispatchId" = d.id) metres FROM "Dispatch" d),
                  shipped AS (SELECT "orderId", SUM(metres) metres FROM sent GROUP BY 1),
                  sold AS (
                    SELECT to_char(inv."issuedAt" AT TIME ZONE ${tz}, 'YYYY-MM') m,
                           oc.cost * s.metres / GREATEST(o.qty, sh.metres) cost, oc.yarn * s.metres / GREATEST(o.qty, sh.metres) yarn
                    FROM "Invoice" inv JOIN sent s ON s.id = inv."dispatchId" JOIN "Order" o ON o.id = s."orderId"
                    JOIN shipped sh ON sh."orderId" = s."orderId" JOIN oc ON oc."orderId" = s."orderId"
                    WHERE inv."issuedAt" >= ${start} AND inv."issuedAt" < ${end}),
                  loose AS (
                    SELECT to_char(i."issuedAt" AT TIME ZONE ${tz}, 'YYYY-MM') m,
                           SUM(CASE WHEN rm.category = 'MAINTENANCE' THEN 0 ELSE i.cost END) cost,
                           SUM(CASE WHEN rm.category = 'MAINTENANCE' THEN i.cost ELSE 0 END) maint
                    FROM "MaterialIssue" i JOIN "RawMaterial" rm ON rm.id = i."materialId"
                    WHERE i."orderId" IS NULL AND i."issuedAt" >= ${start} AND i."issuedAt" < ${end} GROUP BY 1)
                  SELECT m, SUM(v)::float v, SUM(maint)::float maint, SUM(yarn)::float yarn FROM (
                    SELECT m, cost v, 0 maint, yarn FROM sold
                    UNION ALL SELECT m, cost, maint, 0 FROM loose) x GROUP BY m`),
    by(Prisma.sql`SELECT to_char("receivedAt" AT TIME ZONE ${tz}, 'YYYY-MM') m, SUM("billAmount")::float v, SUM(CASE WHEN "itcEligible" THEN cgst+sgst+igst ELSE 0 END)::float itc FROM "MaterialInward" WHERE "receivedAt" >= ${start} AND "receivedAt" < ${end} GROUP BY 1`),
    by(Prisma.sql`SELECT to_char("paidAt" AT TIME ZONE ${tz}, 'YYYY-MM') m, SUM(amount)::float v FROM "SupplierPayment" WHERE "paidAt" >= ${start} AND "paidAt" < ${end} GROUP BY 1`),
    by(Prisma.sql`SELECT to_char("incurredAt" AT TIME ZONE ${tz}, 'YYYY-MM') m,
                    SUM(CASE WHEN category = 'LOGISTICS' THEN amount + CASE WHEN "itcEligible" THEN 0 ELSE cgst+sgst+igst END ELSE 0 END)::float logistics,
                    SUM(CASE WHEN category = 'UTILITIES' THEN amount + CASE WHEN "itcEligible" THEN 0 ELSE cgst+sgst+igst END ELSE 0 END)::float utilities,
                    SUM(CASE WHEN "itcEligible" THEN cgst+sgst+igst ELSE 0 END)::float itc,
                    SUM(CASE WHEN "taxTreatment" LIKE 'RCM%' THEN cgst+sgst+igst ELSE 0 END)::float rcm
                  FROM "Expense" WHERE "incurredAt" >= ${start} AND "incurredAt" < ${end} GROUP BY 1`),
    by(Prisma.sql`SELECT to_char("paidAt" AT TIME ZONE ${tz}, 'YYYY-MM') m, SUM(COALESCE("totalAmount", amount))::float v FROM "Expense" WHERE "paidAt" >= ${start} AND "paidAt" < ${end} GROUP BY 1`),
    by(Prisma.sql`SELECT month m, SUM(COALESCE(gross, amount))::float gross, SUM(amount)::float net FROM "WagePayment" WHERE month >= ${p.from.slice(0, 7)} AND month <= ${p.to.slice(0, 7)} GROUP BY 1`),
  ]);
  const wagesPaidIn = await by(Prisma.sql`SELECT to_char("paidAt" AT TIME ZONE ${tz}, 'YYYY-MM') m, SUM(amount)::float v FROM "WagePayment" WHERE "paidAt" >= ${start} AND "paidAt" < ${end} GROUP BY 1`);

  const out = [];
  for (const m of months(p.from, p.to)) {
    // A month with no payroll yet (the current one) is accrued from the attendance register.
    let wages = wageRows.get(m)?.gross;
    if (wages == null) wages = (await workforceService.wages({ month: m })).totals.earned;
    const e = exp.get(m) || {};
    const row = {
      month: m,
      revenue: r2(sales.get(m)?.v),
      outputGst: r2(sales.get(m)?.tax),
      materials: r2(issues.get(m)?.v),
      yarn: r2(issues.get(m)?.yarn),
      maintenance: r2(issues.get(m)?.maint),
      wages: r2(wages),
      logistics: r2(e.logistics),
      utilities: r2(e.utilities),
      purchases: r2(purchases.get(m)?.v),
      inputGst: r2((purchases.get(m)?.itc || 0) + (e.itc || 0)),
      rcm: r2(e.rcm),
      cashIn: r2(receipts.get(m)?.v),
      cashOut: r2((supplierPaid.get(m)?.v || 0) + (expPaid.get(m)?.v || 0) + (wagesPaidIn.get(m)?.v || 0)),
    };
    row.grossProfit = r2(row.revenue - row.materials - row.wages);
    row.netProfit = r2(row.grossProfit - row.logistics - row.utilities - row.maintenance);
    row.gstPayable = r2(row.outputGst + row.rcm - row.inputGst);
    out.push(row);
  }
  return out;
}

const total = (rows, key) => r2(rows.reduce((t, x) => t + Number(x[key] || 0), 0));

// ------------------------------------------------------------- balances --

// Open sales invoices and supplier bills as of today, with days past due.
async function openInvoices() {
  const rows = await prisma.$queryRaw`
    SELECT i.id, i."invoiceNo", i."issuedAt", i."dueDate", COALESCE(i."totalAmount", i.amount)::float payable,
           COALESCE((SELECT SUM(p.amount) FROM "Payment" p WHERE p."invoiceId" = i.id), 0)::float paid,
           b.id "buyerId", b.name buyer, o."orderNo"
    FROM "Invoice" i JOIN "Dispatch" d ON d.id = i."dispatchId" JOIN "Buyer" b ON b.id = d."buyerId" JOIN "Order" o ON o.id = d."orderId"
    WHERE i.status <> 'PAID'`;
  const today = todayIst();
  return rows
    .map((x) => ({ ...x, balance: r2(x.payable - x.paid), daysOverdue: x.dueDate ? Math.max(0, Math.round((Date.parse(today) - Date.parse(new Date(x.dueDate).toISOString().slice(0, 10))) / DAY)) : 0 }))
    .filter((x) => x.balance > 0.005);
}

async function openBills() {
  const rows = await prisma.$queryRaw`
    SELECT w.id, w."billNo", w."receivedAt", w."dueDate", COALESCE(w."totalAmount", w."billAmount")::float payable,
           COALESCE((SELECT SUM(p.amount) FROM "SupplierPayment" p WHERE p."inwardId" = w.id), 0)::float paid,
           s.id "supplierId", s.name supplier, rm."yarnType" material, rm.category
    FROM "MaterialInward" w JOIN "Supplier" s ON s.id = w."supplierId" JOIN "RawMaterial" rm ON rm.id = w."materialId"`;
  const today = todayIst();
  return rows
    .map((x) => ({ ...x, balance: r2(x.payable - x.paid), daysOverdue: x.dueDate ? Math.max(0, Math.round((Date.parse(today) - Date.parse(new Date(x.dueDate).toISOString().slice(0, 10))) / DAY)) : 0 }))
    .filter((x) => x.balance > 0.005);
}

const BUCKETS = [['Not due', -1], ['1-30 days', 30], ['31-60 days', 60], ['61-90 days', 90], ['Over 90 days', Infinity]];
function ageing(rows, key) {
  const parties = new Map();
  for (const x of rows) {
    const e = parties.get(x[key]) || { name: x[key === 'buyerId' ? 'buyer' : 'supplier'], id: x[key], total: 0, buckets: BUCKETS.map(() => 0) };
    const i = x.daysOverdue <= 0 ? 0 : BUCKETS.findIndex(([, max]) => x.daysOverdue <= max);
    e.buckets[i] = r2(e.buckets[i] + x.balance);
    e.total = r2(e.total + x.balance);
    parties.set(x[key], e);
  }
  const list = [...parties.values()].sort((a, b) => b.total - a.total);
  return { buckets: BUCKETS.map(([b]) => b), rows: list, totals: BUCKETS.map((_, i) => total(list.map((x) => ({ v: x.buckets[i] })), 'v')), total: total(list, 'total') };
}

// ------------------------------------------------------------- overview --

async function workInProgress() {
  const [row] = await prisma.$queryRaw`
    WITH oc AS (SELECT "orderId", SUM(cost) cost FROM "MaterialIssue" i JOIN "RawMaterial" rm ON rm.id = i."materialId" WHERE "orderId" IS NOT NULL AND rm.category <> 'MAINTENANCE' GROUP BY 1),
    sh AS (SELECT d."orderId", SUM(r.qty) metres FROM "Dispatch" d JOIN "Roll" r ON r."dispatchId" = d.id GROUP BY 1)
    SELECT COALESCE(SUM(oc.cost * GREATEST(0, 1 - COALESCE(sh.metres, 0) / GREATEST(o.qty, COALESCE(sh.metres, 0)))), 0)::float v
    FROM oc JOIN "Order" o ON o.id = oc."orderId" LEFT JOIN sh ON sh."orderId" = oc."orderId" WHERE o.status <> 'CANCELLED'`;
  return r2(row.v);
}

async function overview(query) {
  const p = period(query);
  const [series, invoices, bills, unpaidExpenses, wip] = await Promise.all([
    monthly(p),
    openInvoices(),
    openBills(),
    prisma.expense.findMany({ where: { status: { in: ['UNPAID', 'ACCRUED'] } }, orderBy: { dueDate: 'asc' } }),
    workInProgress(),
  ]);
  const sum = (k) => total(series, k);
  const today = todayIst();
  const dueSoon = new Date(Date.parse(today) + 15 * DAY).toISOString().slice(0, 10);
  return {
    period: { from: p.from, to: p.to },
    company: COMPANY,
    pnl: {
      revenue: sum('revenue'), materials: sum('materials'), wages: sum('wages'), grossProfit: sum('grossProfit'),
      logistics: sum('logistics'), utilities: sum('utilities'), maintenance: sum('maintenance'), netProfit: sum('netProfit'),
      expenses: r2(sum('materials') + sum('wages') + sum('logistics') + sum('utilities') + sum('maintenance')),
    },
    receivable: { total: total(invoices, 'balance'), overdue: total(invoices.filter((x) => x.daysOverdue > 0), 'balance'), count: invoices.length, overdueCount: invoices.filter((x) => x.daysOverdue > 0).length },
    payable: {
      bills: total(bills, 'balance'),
      billsOverdue: total(bills.filter((x) => x.daysOverdue > 0), 'balance'),
      billsDueSoon: total(bills.filter((x) => x.daysOverdue <= 0 && new Date(x.dueDate).toISOString().slice(0, 10) <= dueSoon), 'balance'),
      expenses: r2(unpaidExpenses.reduce((t, e) => t + Number(e.totalAmount ?? e.amount), 0)),
      accrued: r2(unpaidExpenses.filter((e) => e.status === 'ACCRUED').reduce((t, e) => t + Number(e.totalAmount ?? e.amount), 0)),
    },
    // Movement of recorded receipts and payments only; there is no bank ledger or opening balance.
    cash: { in: sum('cashIn'), out: sum('cashOut'), net: r2(sum('cashIn') - sum('cashOut')) },
    gst: { output: sum('outputGst'), input: sum('inputGst'), rcm: sum('rcm'), payable: sum('gstPayable') },
    purchases: sum('purchases'),
    workInProgress: wip,
    series,
    // Every open item (a few dozen), most overdue first; the overview filters them on screen.
    topReceivables: invoices.sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance),
    billsDue: bills.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)),
  };
}

// ------------------------------------------------------- sales invoices --

// HSN heading by fabric (synthetic classification by fibre and weight; all at 5%).
const FABRIC_HSN = { Satin: '5407', Georgette: '5407', 'Rayon Print': '5516', 'Linen Suiting': '5309', Denim: '5209', Canvas: '5209', Twill: '5513', Oxford: '5513', Chambray: '5513' };
const fabricHsn = (fabric) => FABRIC_HSN[fabric] || '5208';

async function listInvoices(query) {
  const p = period(query);
  const { status, buyerId, q } = query;
  const today = new Date(`${todayIst()}T00:00:00+05:30`);
  const where = {
    issuedAt: { gte: p.start, lt: p.end },
    ...(status === 'OVERDUE' ? { status: { not: 'PAID' }, dueDate: { lt: today } } : status ? { status } : {}),
    ...(buyerId ? { dispatch: { buyerId } } : {}),
    ...(q ? { OR: [{ invoiceNo: { contains: q, mode: 'insensitive' } }, { dispatch: { order: { orderNo: { contains: q, mode: 'insensitive' } } } }, { dispatch: { buyer: { name: { contains: q, mode: 'insensitive' } } } }] } : {}),
  };
  const [rows, count, sums] = await Promise.all([
    prisma.invoice.findMany({
      where, orderBy: [{ issuedAt: 'desc' }, { invoiceNo: 'desc' }], ...page(query),
      include: { payments: true, dispatch: { select: { dispatchNo: true, dispatchedAt: true, buyer: { select: { id: true, name: true, state: true } }, order: { select: { id: true, orderNo: true } } } } },
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where, _sum: { amount: true, cgst: true, sgst: true, igst: true, totalAmount: true } }),
  ]);
  return {
    rows: rows.map((i) => ({ ...withBalance(i), tax: taxOf(i), payable: payableOf(i), overdueDays: overdue(i.dueDate, i.status) })),
    count,
    totals: { taxable: r2(sums._sum.amount), tax: r2(Number(sums._sum.cgst) + Number(sums._sum.sgst) + Number(sums._sum.igst)), total: r2(sums._sum.totalAmount ?? sums._sum.amount) },
  };
}

const overdue = (dueDate, status) => {
  if (!dueDate || status === 'PAID') return 0;
  return Math.max(0, Math.round((Date.parse(todayIst()) - Date.parse(new Date(dueDate).toISOString().slice(0, 10))) / DAY));
};

async function getInvoice(id) {
  const i = await prisma.invoice.findUnique({
    where: { id },
    include: {
      payments: { orderBy: { paidAt: 'asc' } },
      dispatch: { include: { buyer: true, rolls: { orderBy: { rollNo: 'asc' }, select: { rollNo: true, qty: true } }, order: { select: { id: true, orderNo: true, fabricType: true, colour: true, pricePerUnit: true, createdAt: true } } } },
    },
  });
  if (!i) throw notFound('Invoice not found');
  const audit = await prisma.auditLog.findMany({ where: { entity: 'Invoice', entityId: id }, orderBy: { at: 'asc' } });
  return { ...withBalance(i), tax: taxOf(i), payable: payableOf(i), overdueDays: overdue(i.dueDate, i.status), hsn: fabricHsn(i.dispatch.order.fabricType), company: COMPANY, audit };
}

// ------------------------------------------------------- supplier bills --

async function listBills(query) {
  const p = period(query);
  const { status, supplierId, category, q } = query;
  const where = {
    receivedAt: { gte: p.start, lt: p.end },
    ...(supplierId ? { supplierId } : {}),
    ...(category ? { material: { category } } : {}),
    ...(q ? { OR: [{ billNo: { contains: q, mode: 'insensitive' } }, { supplier: { name: { contains: q, mode: 'insensitive' } } }, { material: { yarnType: { contains: q, mode: 'insensitive' } } }] } : {}),
  };
  // Paid / open / overdue depends on payments, so those filters work on the matching ids.
  let ids = null;
  if (status) {
    const all = await prisma.materialInward.findMany({ where, select: { id: true, billAmount: true, totalAmount: true, dueDate: true, payments: { select: { amount: true } } } });
    const today = todayIst();
    ids = all
      .filter((w) => {
        const bal = Number(w.totalAmount ?? w.billAmount) - w.payments.reduce((t, x) => t + Number(x.amount), 0);
        const late = w.dueDate && new Date(w.dueDate).toISOString().slice(0, 10) < today;
        return status === 'PAID' ? bal <= 0.005 : status === 'OVERDUE' ? bal > 0.005 && late : bal > 0.005;
      })
      .map((w) => w.id);
  }
  const filtered = ids ? { ...where, id: { in: ids } } : where;
  const [rows, count, sums] = await Promise.all([
    prisma.materialInward.findMany({
      where: filtered, orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], ...page(query),
      include: { payments: true, supplier: { select: { id: true, name: true, state: true } }, material: { select: { id: true, yarnType: true, colour: true, unit: true, category: true, sku: true } } },
    }),
    prisma.materialInward.count({ where: filtered }),
    prisma.materialInward.aggregate({ where: filtered, _sum: { billAmount: true, cgst: true, sgst: true, igst: true, totalAmount: true } }),
  ]);
  return {
    rows: rows.map(billShape),
    count,
    totals: { taxable: r2(sums._sum.billAmount), tax: r2(Number(sums._sum.cgst) + Number(sums._sum.sgst) + Number(sums._sum.igst)), total: r2(sums._sum.totalAmount ?? sums._sum.billAmount) },
  };
}

function billShape(w) {
  const payable = r2(w.totalAmount ?? w.billAmount);
  const paid = r2(w.payments.reduce((t, x) => t + Number(x.amount), 0));
  const balance = r2(payable - paid);
  const days = balance > 0.005 ? overdue(w.dueDate, 'OPEN') : 0;
  return { ...w, tax: taxOf(w), payable, paid, balance, overdueDays: days, status: balance <= 0.005 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID' };
}

async function getBill(id) {
  const w = await prisma.materialInward.findUnique({
    where: { id },
    include: { payments: { orderBy: { paidAt: 'asc' } }, supplier: true, material: true, receivedBy: { select: { name: true } }, purchaseOrder: { select: { poNo: true, orderedAt: true } }, order: { select: { orderNo: true } } },
  });
  if (!w) throw notFound('Bill not found');
  const audit = await prisma.auditLog.findMany({ where: { entity: 'SupplierBill', entityId: id }, orderBy: { at: 'asc' } });
  const rule = w.taxCode ? RULES[w.taxCode] : null;
  return { ...billShape(w), rule: rule && { code: w.taxCode, label: rule.label, hsn: rule.hsn, confidence: rule.confidence, note: rule.note }, company: COMPANY, audit };
}

async function payBill(id, { amount, method, reference, paidAt }, user) {
  return prisma.$transaction(async (tx) => {
    const w = await tx.materialInward.findUnique({ where: { id }, include: { payments: true } });
    if (!w) throw notFound('Bill not found');
    const balance = Math.round(Number(w.totalAmount ?? w.billAmount) * 100) - w.payments.reduce((t, x) => t + Math.round(Number(x.amount) * 100), 0);
    const value = Math.round(Number(amount) * 100);
    if (value <= 0) throw badRequest('Payment must be more than zero');
    if (value > balance) throw badRequest(`Payment exceeds the balance of ${(balance / 100).toFixed(2)}`);
    const when = paidAt ? new Date(paidAt) : new Date();
    if (when < w.receivedAt) throw badRequest('Payment date is before the goods were received');
    if (reference && (await tx.supplierPayment.findFirst({ where: { reference } }))) throw conflict(`Reference ${reference} is already recorded`, 'DUPLICATE');
    await tx.supplierPayment.create({ data: { inwardId: id, amount: value / 100, method, reference, paidAt: when } });
    await tx.auditLog.create({ data: { entity: 'SupplierBill', entityId: id, action: 'PAYMENT', detail: `${(value / 100).toFixed(2)} by ${method || 'unspecified'}${reference ? ` (${reference})` : ''}`, by: user.name } });
    return getBillTx(tx, id);
  });
}
const getBillTx = async (tx, id) => billShape(await tx.materialInward.findUnique({ where: { id }, include: { payments: true, supplier: true, material: true } }));

// -------------------------------------------------------------- expenses --

async function listExpenses(query) {
  const p = period(query);
  const { category, subcategory, status, costCentre, q } = query;
  const where = {
    incurredAt: { gte: p.start, lt: p.end },
    ...(category ? { category } : {}),
    ...(subcategory ? { subcategory } : {}),
    ...(status ? { status } : {}),
    ...(costCentre ? { costCentre } : {}),
    ...(q ? { OR: [{ voucherNo: { contains: q, mode: 'insensitive' } }, { payee: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }, { reference: { contains: q, mode: 'insensitive' } }] } : {}),
  };
  const [rows, count, sums, subs] = await Promise.all([
    prisma.expense.findMany({ where, orderBy: [{ incurredAt: 'desc' }, { voucherNo: 'desc' }], ...page(query), include: { order: { select: { orderNo: true } }, dispatch: { select: { dispatchNo: true } } } }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true, cgst: true, sgst: true, igst: true, totalAmount: true } }),
    prisma.expense.groupBy({ by: ['category', 'subcategory'], where: { incurredAt: { gte: p.start, lt: p.end }, ...(category ? { category } : {}) }, _sum: { amount: true }, _count: true }),
  ]);
  return {
    rows: rows.map((e) => ({ ...e, tax: taxOf(e) })),
    count,
    totals: { taxable: r2(sums._sum.amount), tax: r2(Number(sums._sum.cgst) + Number(sums._sum.sgst) + Number(sums._sum.igst)), total: r2(sums._sum.totalAmount ?? sums._sum.amount) },
    bySubcategory: subs.map((s) => ({ category: s.category, subcategory: s.subcategory, amount: r2(s._sum.amount), count: s._count })).sort((a, b) => b.amount - a.amount),
  };
}

async function getExpense(id) {
  const e = await prisma.expense.findUnique({ where: { id }, include: { order: { select: { orderNo: true } }, dispatch: { select: { dispatchNo: true, dispatchedAt: true } } } });
  if (!e) throw notFound('Expense not found');
  const audit = await prisma.auditLog.findMany({ where: { entity: 'Expense', entityId: id }, orderBy: { at: 'asc' } });
  const rule = e.taxCode ? RULES[e.taxCode] : null;
  return { ...e, tax: taxOf(e), rule: rule && { code: e.taxCode, label: rule.label, hsn: rule.hsn, confidence: rule.confidence, note: rule.note }, company: COMPANY, audit };
}

async function createExpense(data, user) {
  const incurredAt = new Date(data.incurredAt);
  if (data.orderId && !(await prisma.order.findUnique({ where: { id: data.orderId } }))) throw notFound('Order not found');
  if (data.dispatchId && !(await prisma.dispatch.findUnique({ where: { id: data.dispatchId } }))) throw notFound('Dispatch not found');
  // The same bill entered twice, or a second freight charge on one truck, would double-count.
  const day = new Date(`${data.incurredAt.slice(0, 10)}T00:00:00+05:30`);
  const twin = await prisma.expense.findFirst({
    where: {
      OR: [
        { payee: data.payee, subcategory: data.subcategory, amount: data.amount, incurredAt: { gte: day, lt: new Date(day.getTime() + DAY) } },
        ...(data.reference ? [{ reference: data.reference }] : []),
        ...(data.dispatchId ? [{ dispatchId: data.dispatchId, subcategory: data.subcategory }] : []),
      ],
    },
  });
  if (twin) throw conflict(`Looks like ${twin.voucherNo} already records this`, 'DUPLICATE');
  const tax = taxFor(data.taxCode, data.amount, incurredAt, data.partyState || HOME_STATE);
  return prisma.$transaction(async (tx) => {
    const count = await tx.expense.count();
    const { partyState, ...rest } = data;
    const e = await tx.expense.create({
      data: {
        ...rest, incurredAt, dueDate: data.dueDate ? new Date(data.dueDate) : incurredAt,
        paidAt: data.status === 'PAID' ? new Date(data.paidAt || data.incurredAt) : null,
        voucherNo: `EXP-${String(count + 1).padStart(5, '0')}`, ...tax,
      },
    });
    await tx.auditLog.create({ data: { entity: 'Expense', entityId: e.id, action: 'CREATED', detail: `${e.voucherNo} ${e.subcategory} ${r2(e.totalAmount)}`, by: user.name } });
    return e;
  });
}

async function payExpense(id, { method, reference, paidAt }, user) {
  const e = await prisma.expense.findUnique({ where: { id } });
  if (!e) throw notFound('Expense not found');
  if (e.status === 'PAID') throw conflict(`${e.voucherNo} is already paid`, 'ALREADY_PAID');
  const when = paidAt ? new Date(paidAt) : new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.expense.update({ where: { id }, data: { status: 'PAID', paidAt: when, method, reference } });
    await tx.auditLog.create({ data: { entity: 'Expense', entityId: id, action: 'PAID', detail: `${method || 'unspecified'}${reference ? ` (${reference})` : ''}`, by: user.name } });
    return updated;
  });
}

// --------------------------------------------------------------- payroll --

async function payroll({ month }) {
  const sheet = await workforceService.wages({ month });
  const sum = (k) => r2(sheet.rows.reduce((t, x) => t + Number(x[k] || 0), 0));
  return { ...sheet, totals: { ...sheet.totals, basic: sum('basic'), allowances: sum('allowances'), overtime: sum('overtime'), deductions: sum('deductions'), gross: sum('gross'), net: sum('net'), workers: sheet.rows.length } };
}

async function payrollYear(query) {
  const p = period(query);
  const rows = await prisma.$queryRaw`
    SELECT month, COUNT(*)::int workers, SUM(COALESCE(basic, amount))::float basic, SUM(COALESCE(allowances, 0))::float allowances,
           SUM(COALESCE(overtime, 0))::float overtime, SUM(COALESCE(deductions, 0))::float deductions, SUM(COALESCE(gross, amount))::float gross, SUM(amount)::float net
    FROM "WagePayment" WHERE month >= ${p.from.slice(0, 7)} AND month <= ${p.to.slice(0, 7)} GROUP BY month ORDER BY month`;
  return { period: { from: p.from, to: p.to }, rows };
}

async function getPayslip({ workerId, month }) {
  const worker = await prisma.worker.findUnique({ where: { id: workerId } });
  if (!worker) throw notFound('Worker not found');
  const sheet = await workforceService.wages({ month });
  const row = sheet.rows.find((x) => x.worker.id === workerId);
  if (!row) throw notFound('No attendance or pay for that month');
  const payment = await prisma.wagePayment.findUnique({ where: { workerId_month: { workerId, month } } });
  return { worker, month, ...row, payment, company: COMPANY };
}

// ------------------------------------------------------------------- GST --

async function gstRegister(query) {
  const p = period(query);
  const { type, q } = query;
  const { take, skip } = page(query);
  const like = q ? `%${q}%` : null;
  const rows = await prisma.$queryRaw`
    SELECT * FROM (
      SELECT 'SALES' type, i.id, i."invoiceNo" ref, i."issuedAt" at, b.name party, b.state, i."taxCode", i."taxRatePct"::float rate, i."taxTreatment" treatment,
             i.amount::float taxable, i.cgst::float, i.sgst::float, i.igst::float, i."itcEligible" itc, '/accounts/invoices/' || i.id link
      FROM "Invoice" i JOIN "Dispatch" d ON d.id = i."dispatchId" JOIN "Buyer" b ON b.id = d."buyerId"
      WHERE i."issuedAt" >= ${p.start} AND i."issuedAt" < ${p.end}
      UNION ALL
      SELECT 'PURCHASE', w.id, w."billNo", w."receivedAt", s.name, s.state, w."taxCode", w."taxRatePct"::float, w."taxTreatment",
             w."billAmount"::float, w.cgst::float, w.sgst::float, w.igst::float, w."itcEligible", '/accounts/bills/' || w.id
      FROM "MaterialInward" w JOIN "Supplier" s ON s.id = w."supplierId"
      WHERE w."receivedAt" >= ${p.start} AND w."receivedAt" < ${p.end}
      UNION ALL
      SELECT 'EXPENSE', e.id, e."voucherNo", e."incurredAt", e.payee, NULL, e."taxCode", e."taxRatePct"::float, e."taxTreatment",
             e.amount::float, e.cgst::float, e.sgst::float, e.igst::float, e."itcEligible", '/accounts/expenses/' || e.id
      FROM "Expense" e
      WHERE e."incurredAt" >= ${p.start} AND e."incurredAt" < ${p.end}
    ) x
    WHERE (${type ?? null}::text IS NULL OR x.type = ${type ?? null})
      AND (${like}::text IS NULL OR x.ref ILIKE ${like} OR x.party ILIKE ${like})
    ORDER BY x.at DESC, x.ref DESC`;
  const enrich = rows.map((x) => ({ ...x, tax: r2(x.cgst + x.sgst + x.igst), confidence: x.taxCode ? RULES[x.taxCode]?.confidence : 'UNCLASSIFIED' }));
  const sum = (f) => r2(enrich.filter(f).reduce((t, x) => t + x.tax, 0));
  const byMonth = new Map();
  for (const x of enrich) {
    const m = new Date(new Date(x.at).getTime() + 5.5 * 3600000).toISOString().slice(0, 7);
    const e = byMonth.get(m) || { month: m, output: 0, input: 0, rcm: 0, ineligible: 0 };
    if (x.type === 'SALES') e.output = r2(e.output + x.tax);
    else if (x.itc) e.input = r2(e.input + x.tax);
    else e.ineligible = r2(e.ineligible + x.tax);
    if (x.treatment?.startsWith('RCM')) e.rcm = r2(e.rcm + x.tax);
    byMonth.set(m, e);
  }
  const summary = {
    output: sum((x) => x.type === 'SALES'),
    input: sum((x) => x.type !== 'SALES' && x.itc),
    ineligible: sum((x) => x.type !== 'SALES' && !x.itc),
    rcm: sum((x) => x.treatment?.startsWith('RCM')),
    cgst: r2(enrich.reduce((t, x) => t + x.cgst, 0)),
    sgst: r2(enrich.reduce((t, x) => t + x.sgst, 0)),
    igst: r2(enrich.reduce((t, x) => t + x.igst, 0)),
    flagged: enrich.filter((x) => x.confidence === 'UNVERIFIED' || x.confidence === 'UNCLASSIFIED').length,
  };
  summary.payable = r2(summary.output + summary.rcm - summary.input);
  return {
    period: { from: p.from, to: p.to },
    summary,
    byMonth: [...byMonth.values()].map((m) => ({ ...m, payable: r2(m.output + m.rcm - m.input) })).sort((a, b) => a.month.localeCompare(b.month)),
    count: enrich.length,
    rows: enrich.slice(skip, skip + take),
  };
}

function taxRules() {
  return Object.entries(RULES).map(([code, r]) => ({
    code, label: r.label, hsn: r.hsn, itcEligible: r.itc, confidence: r.confidence, note: r.note, treatment: r.treatment || 'TAXABLE',
    rates: r.rates.map(([from, rate]) => ({ from, rate })), rateToday: rateOn(code, new Date()),
  }));
}

// --------------------------------------------------------------- reports --

async function report(name, query) {
  const p = period(query);
  const range = Prisma.sql`>= ${p.start}`;
  switch (name) {
    case 'pnl':
    case 'monthly': {
      const series = await monthly(p);
      const keys = ['revenue', 'materials', 'wages', 'grossProfit', 'logistics', 'utilities', 'maintenance', 'netProfit', 'purchases', 'cashIn', 'cashOut', 'outputGst', 'inputGst', 'rcm', 'gstPayable'];
      return { period: { from: p.from, to: p.to }, series, totals: Object.fromEntries(keys.map((k) => [k, total(series, k)])) };
    }
    case 'receivables':
      return { asOf: todayIst(), ...ageing(await openInvoices(), 'buyerId') };
    case 'payables':
      return { asOf: todayIst(), ...ageing(await openBills(), 'supplierId') };
    case 'purchases': {
      const rows = await prisma.$queryRaw`
        SELECT rm.category, COUNT(*)::int bills, SUM(w."billAmount")::float taxable, SUM(w.cgst + w.sgst + w.igst)::float tax, SUM(COALESCE(w."totalAmount", w."billAmount"))::float total
        FROM "MaterialInward" w JOIN "RawMaterial" rm ON rm.id = w."materialId"
        WHERE w."receivedAt" ${range} AND w."receivedAt" < ${p.end} GROUP BY rm.category ORDER BY taxable DESC`;
      return { period: { from: p.from, to: p.to }, rows, totals: { taxable: total(rows, 'taxable'), tax: total(rows, 'tax'), total: total(rows, 'total') } };
    }
    case 'inventory': {
      const [stock, used] = await Promise.all([
        prisma.$queryRaw`SELECT category, COUNT(*)::int items, SUM("qtyInStock" * "avgCost")::float value, SUM(CASE WHEN "qtyInStock" <= "reorderLevel" THEN 1 ELSE 0 END)::int low FROM "RawMaterial" GROUP BY category ORDER BY value DESC`,
        prisma.$queryRaw`SELECT rm.category, COALESCE(i.department, 'UNASSIGNED') department, SUM(i.cost)::float cost
          FROM "MaterialIssue" i JOIN "RawMaterial" rm ON rm.id = i."materialId"
          WHERE i."issuedAt" ${range} AND i."issuedAt" < ${p.end} GROUP BY 1, 2 ORDER BY cost DESC`,
      ]);
      return { period: { from: p.from, to: p.to }, stock, used, totals: { value: total(stock, 'value'), used: total(used, 'cost') } };
    }
    case 'expenses': {
      const rows = await prisma.$queryRaw`
        SELECT category, subcategory, COUNT(*)::int entries, SUM(amount)::float taxable, SUM(cgst + sgst + igst)::float tax, SUM(COALESCE("totalAmount", amount))::float total
        FROM "Expense" WHERE "incurredAt" ${range} AND "incurredAt" < ${p.end} GROUP BY 1, 2 ORDER BY 1, taxable DESC`;
      return { period: { from: p.from, to: p.to }, rows, totals: { taxable: total(rows, 'taxable'), tax: total(rows, 'tax'), total: total(rows, 'total') } };
    }
    case 'payroll':
      return payrollYear(query);
    case 'gst': {
      const g = await gstRegister({ ...query, pageSize: 1 });
      return { period: g.period, summary: g.summary, byMonth: g.byMonth };
    }
    case 'order-costs': {
      const rows = await reportService.orderCosts({ from: p.from, to: p.to });
      const list = rows.data ?? rows;
      return { period: { from: p.from, to: p.to }, rows: list, totals: { orderValue: total(list, 'orderValue'), totalCost: total(list, 'totalCost'), invoiced: total(list, 'invoiced'), margin: total(list, 'margin') } };
    }
    default:
      throw notFound(`Unknown report ${name}`);
  }
}

module.exports = {
  COMPANY, overview, listInvoices, getInvoice, listBills, getBill, payBill, listExpenses, getExpense, createExpense, payExpense,
  payroll, payrollYear, getPayslip, gstRegister, taxRules, report, period, monthly, payslip,
};

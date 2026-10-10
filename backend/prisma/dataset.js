require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');

// Dataset = a folder with one JSON array per model, e.g. data/sample/Order.json.
//   npm run data:export -- data/sample
//   npm run data:check  -- data/sample            (no database needed)
//   npm run data:import -- data/sample --reset    (--reset wipes every table first: local only)
//   npm run data:import -- data/sample --merge    (adds rows whose id is not there yet; never
//                                                  deletes or overwrites, so re-running adds nothing)
// Format and rules: docs/data-format.md

// Insert order: every table comes after the tables it points to.
const MODELS = [
  'User', 'Supplier', 'Buyer', 'RawMaterial', 'Worker', 'Machine', 'Order', 'MaterialInward',
  'ProductionJob', 'MaterialIssue', 'ProductionLog', 'Dispatch', 'Roll', 'QCRecord', 'Invoice',
  'Payment', 'Attendance', 'WagePayment', 'PurchaseOrder', 'SupplierPayment', 'Expense', 'AuditLog',
];
const { taxFor } = require('../src/lib/tax');
const { payslip } = require('../src/lib/payroll');
const delegate = (model) => prisma[model[0].toLowerCase() + model.slice(1)];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CHUNK = 2000;

const [command, dirArg, ...flags] = process.argv.slice(2);

function load(dir) {
  const data = {};
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const model = path.basename(file, '.json');
    if (!MODELS.includes(model)) throw new Error(`Unknown model file ${file}`);
    data[model] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!Array.isArray(data[model])) throw new Error(`${file} must be a JSON array`);
  }
  for (const model of MODELS) data[model] = data[model] || [];
  return data;
}

const sum = (rows, key = 'qty') => rows.reduce((total, r) => total + Number(r[key]), 0);
const near = (a, b) => Math.abs(a - b) < 0.011;
const groupBy = (rows, key) => {
  const map = new Map();
  for (const row of rows) map.set(row[key], [...(map.get(row[key]) || []), row]);
  return map;
};

// Rules the API relies on. Foreign keys and enums are enforced by Postgres on import.
function check(data) {
  const problems = [];
  const bad = (message) => problems.length < 200 && problems.push(message);
  const byId = (model) => new Map(data[model].map((r) => [r.id, r]));

  for (const model of MODELS) {
    const ids = new Set();
    for (const row of data[model]) {
      if (!row.id) bad(`${model}: row without id`);
      if (ids.has(row.id)) bad(`${model}: duplicate id ${row.id}`);
      ids.add(row.id);
    }
  }

  // New records are numbered count + 1, so existing numbers must be 0001..N with no gaps.
  for (const [model, field, prefix] of [['Order', 'orderNo', 'ORD'], ['Roll', 'rollNo', 'ROLL'], ['Dispatch', 'dispatchNo', 'DSP'], ['Invoice', 'invoiceNo', 'INV']]) {
    const have = new Set(data[model].map((r) => r[field]));
    for (let n = 1; n <= data[model].length; n += 1) {
      const expected = `${prefix}-${String(n).padStart(4, '0')}`;
      if (!have.has(expected)) { bad(`${model}: ${field} must run ${prefix}-0001..N without gaps (missing ${expected})`); break; }
    }
  }

  const inwards = groupBy(data.MaterialInward, 'materialId');
  const issues = groupBy(data.MaterialIssue, 'materialId');
  for (const m of data.RawMaterial) {
    const expected = sum(inwards.get(m.id) || []) - sum(issues.get(m.id) || []);
    if (!near(Number(m.qtyInStock), expected)) bad(`RawMaterial ${m.id}: qtyInStock ${m.qtyInStock} != inwards - issues (${expected})`);
    if (expected < 0) bad(`RawMaterial ${m.id}: issued more than received`);
  }
  for (const i of data.MaterialInward) {
    if (!near(Number(i.billAmount), Number(i.qty) * Number(i.rate))) bad(`MaterialInward ${i.id}: billAmount != qty * rate`);
  }

  // Stock never below zero at any moment, not just at the end.
  const ledger = new Map();
  for (const i of data.MaterialInward) ledger.set(i.materialId, [...(ledger.get(i.materialId) || []), [String(i.receivedAt), Number(i.qty)]]);
  for (const i of data.MaterialIssue) ledger.set(i.materialId, [...(ledger.get(i.materialId) || []), [String(i.issuedAt), -Number(i.qty)]]);
  for (const [materialId, moves] of ledger) {
    let bal = 0;
    for (const [at, q] of moves.sort((a, b) => a[0].localeCompare(b[0]) || b[1] - a[1])) {
      bal += q;
      if (bal < -0.011) { bad(`RawMaterial ${materialId}: stock below zero on ${at.slice(0, 10)}`); break; }
    }
  }

  // GST: components match the rate and the place of supply, totals add up (lib/tax.js).
  const suppliers = byId('Supplier');
  const buyers = byId('Buyer');
  const taxOk = (label, row, taxable, state) => {
    if (row.taxCode == null) return;
    const want = taxFor(row.taxCode, taxable, row.issuedAt || row.receivedAt || row.incurredAt, state);
    for (const k of ['cgst', 'sgst', 'igst', 'totalAmount']) {
      if (!near(Number(row[k]), want[k])) { bad(`${label}: ${k} ${row[k]} should be ${want[k]} (${row.taxCode} ${want.taxRatePct}%, ${state})`); return; }
    }
    if (row.taxTreatment !== want.taxTreatment) bad(`${label}: treatment ${row.taxTreatment} should be ${want.taxTreatment}`);
  };
  const supplierPaid = groupBy(data.SupplierPayment, 'inwardId');
  for (const i of data.MaterialInward) {
    taxOk(`MaterialInward ${i.id}`, i, Number(i.billAmount), suppliers.get(i.supplierId)?.state);
    const paid = sum(supplierPaid.get(i.id) || [], 'amount');
    if (paid > Number(i.totalAmount ?? i.billAmount) + 0.011) bad(`MaterialInward ${i.id}: supplier paid more than the bill`);
  }
  const inwardById = byId('MaterialInward');
  for (const p of data.SupplierPayment) {
    const i = inwardById.get(p.inwardId);
    if (i && String(p.paidAt) < String(i.receivedAt)) bad(`SupplierPayment ${p.id}: paid before the goods arrived`);
  }
  const vouchers = new Set();
  for (const e of data.Expense) {
    if (vouchers.has(e.voucherNo)) bad(`Expense ${e.voucherNo}: duplicate voucher`);
    vouchers.add(e.voucherNo);
    if ((e.status === 'PAID') !== Boolean(e.paidAt)) bad(`Expense ${e.voucherNo}: PAID must go with paidAt, and only then`);
    if (Number(e.amount) <= 0) bad(`Expense ${e.voucherNo}: amount must be positive`);
  }
  for (const w of data.WagePayment) {
    if (w.gross == null) continue;
    if (!near(Number(w.gross), Number(w.basic) + Number(w.allowances) + Number(w.overtime))) bad(`WagePayment ${w.id}: gross != basic + allowances + overtime`);
    if (!near(Number(w.amount), Number(w.gross) - Number(w.deductions))) bad(`WagePayment ${w.id}: net paid != gross - deductions`);
  }
  // Payslips match the attendance register.
  const register = new Map();
  for (const a of data.Attendance) {
    const k = `${a.workerId}|${String(a.date).slice(0, 7)}`;
    const e = register.get(k) || { present: 0, halfDays: 0, nightDays: 0 };
    if (a.status === 'PRESENT') e.present += 1;
    if (a.status === 'HALF_DAY') e.halfDays += 1;
    if (a.status !== 'ABSENT' && a.shift === 'NIGHT') e.nightDays += a.status === 'PRESENT' ? 1 : 0.5;
    register.set(k, e);
  }
  const workers = byId('Worker');
  for (const w of data.WagePayment) {
    if (w.gross == null) continue;
    const e = register.get(`${w.workerId}|${w.month}`) || { present: 0, halfDays: 0, nightDays: 0 };
    const want = payslip({ ...e, dailyWage: workers.get(w.workerId)?.dailyWage, overtime: Number(w.overtime), deductions: Number(w.deductions) });
    if (!near(Number(w.gross), want.gross)) bad(`WagePayment ${w.id}: gross ${w.gross} does not match the register (${want.gross})`);
  }

  const machines = byId('Machine');
  const logs = groupBy(data.ProductionLog, 'jobId');
  const running = groupBy(data.ProductionJob.filter((j) => j.status === 'RUNNING'), 'machineId');
  for (const j of data.ProductionJob) {
    const machine = machines.get(j.machineId);
    if (machine && machine.type !== j.stage) bad(`ProductionJob ${j.id}: stage ${j.stage} != machine type ${machine.type}`);
    if (!near(Number(j.qtyProduced || 0), sum(logs.get(j.id) || []))) bad(`ProductionJob ${j.id}: qtyProduced != sum of its ProductionLog rows`);
    if (j.status !== 'RUNNING' && !j.completedAt) bad(`ProductionJob ${j.id}: ${j.status} job needs completedAt`);
    if (j.status === 'RUNNING' && j.completedAt) bad(`ProductionJob ${j.id}: RUNNING job must not have completedAt`);
  }
  for (const m of data.Machine) {
    const count = (running.get(m.id) || []).length;
    if (count > 1) bad(`Machine ${m.code}: ${count} RUNNING jobs`);
    if ((m.status === 'RUNNING') !== (count === 1)) bad(`Machine ${m.code}: status ${m.status} but ${count} RUNNING job(s)`);
  }

  const jobs = byId('ProductionJob');
  const dispatches = byId('Dispatch');
  const records = groupBy(data.QCRecord, 'rollId');
  const RESULT = { PASSED: 'PASS', DISPATCHED: 'PASS', REWORK: 'REWORK', REJECTED: 'REJECT' };
  for (const r of data.Roll) {
    const job = r.jobId && jobs.get(r.jobId);
    if (job && (job.orderId !== r.orderId || job.machineId !== r.machineId)) bad(`Roll ${r.rollNo}: order/machine differ from its job`);
    if ((r.status === 'DISPATCHED') !== Boolean(r.dispatchId)) bad(`Roll ${r.rollNo}: status DISPATCHED must go with dispatchId, and only then`);
    const dispatch = r.dispatchId && dispatches.get(r.dispatchId);
    if (dispatch && dispatch.orderId !== r.orderId) bad(`Roll ${r.rollNo}: dispatched under another order`);
    const mine = [...(records.get(r.id) || [])].sort((a, b) => String(a.checkedAt).localeCompare(String(b.checkedAt)));
    const last = mine[mine.length - 1];
    if (r.status === 'PENDING_QC' ? mine.length > 0 : last?.result !== RESULT[r.status]) bad(`Roll ${r.rollNo}: status ${r.status} does not match its latest QCRecord`);
  }

  const orders = byId('Order');
  const rollsByDispatch = groupBy(data.Roll.filter((r) => r.dispatchId), 'dispatchId');
  const invoiceOf = new Map(data.Invoice.map((i) => [i.dispatchId, i]));
  const payments = groupBy(data.Payment, 'invoiceId');
  for (const d of data.Dispatch) {
    const order = orders.get(d.orderId);
    if (order && order.buyerId !== d.buyerId) bad(`Dispatch ${d.dispatchNo}: buyer differs from the order's buyer`);
    const rolls = rollsByDispatch.get(d.id) || [];
    if (rolls.length === 0) bad(`Dispatch ${d.dispatchNo}: no rolls`);
    const invoice = invoiceOf.get(d.id);
    if (!invoice) { bad(`Dispatch ${d.dispatchNo}: no invoice`); continue; }
    if (order && !near(Number(invoice.amount), sum(rolls) * Number(order.pricePerUnit))) bad(`Invoice ${invoice.invoiceNo}: amount != dispatched qty * order.pricePerUnit`);
    taxOk(`Invoice ${invoice.invoiceNo}`, invoice, Number(invoice.amount), buyers.get(d.buyerId)?.state);
    const payable = Number(invoice.totalAmount ?? invoice.amount);
    const paid = sum(payments.get(invoice.id) || [], 'amount');
    const status = paid <= 0 ? 'UNPAID' : near(paid, payable) ? 'PAID' : 'PARTIAL';
    if (paid > payable + 0.011) bad(`Invoice ${invoice.invoiceNo}: overpaid`);
    else if (invoice.status !== status) bad(`Invoice ${invoice.invoiceNo}: status ${invoice.status} should be ${status}`);
  }

  // Same rule as orderService.syncStatus.
  const rollsByOrder = groupBy(data.Roll, 'orderId');
  const jobsByOrder = groupBy(data.ProductionJob, 'orderId');
  for (const o of data.Order) {
    if (o.status === 'CANCELLED') continue;
    const rolls = rollsByOrder.get(o.id) || [];
    const mine = [...(jobsByOrder.get(o.id) || [])].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    const of = (status) => rolls.filter((r) => r.status === status);
    const dispatched = sum(of('DISPATCHED'));
    const passed = of('PASSED');
    const active = mine.find((j) => j.status === 'RUNNING');
    let expected = mine[0]?.stage || 'PENDING';
    if (active) expected = active.stage;
    else if (of('PENDING_QC').length + of('REWORK').length > 0) expected = 'QC';
    else if (passed.length === 0 && dispatched >= Number(o.qty)) expected = 'DISPATCHED';
    else if (passed.length > 0 && dispatched + sum(passed) >= Number(o.qty)) expected = 'READY';
    if (o.status !== expected) bad(`Order ${o.orderNo}: status ${o.status} should be ${expected}`);
  }

  const unique = (model, keys) => {
    const seen = new Set();
    for (const row of data[model]) {
      const key = keys.map((k) => (k === 'date' ? String(row[k]).slice(0, 10) : String(row[k]))).join('|');
      if (seen.has(key)) bad(`${model}: duplicate ${keys.join('+')} ${key}`);
      seen.add(key);
    }
  };
  unique('Attendance', ['workerId', 'date']);
  unique('WagePayment', ['workerId', 'month']);
  for (const u of data.User) if (!u.password && !u.passwordHash) bad(`User ${u.email}: needs password or passwordHash`);

  return problems;
}

async function exportTo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const model of MODELS) {
    const rows = await delegate(model).findMany({ orderBy: { id: 'asc' } });
    fs.writeFileSync(path.join(dir, `${model}.json`), `${JSON.stringify(rows, null, 1)}\n`);
    console.log(`${model.padEnd(15)} ${rows.length}`);
  }
}

async function importFrom(dir) {
  const data = load(dir);
  const problems = check(data);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    throw new Error(`${problems.length} problem(s) found, nothing imported`);
  }

  const merge = flags.includes('--merge');
  if (flags.includes('--reset')) {
    for (const model of [...MODELS].reverse()) await delegate(model).deleteMany();
  } else if (!merge && (await prisma.user.count()) + (await prisma.order.count()) > 0) {
    throw new Error('Database is not empty. Re-run with --merge to add only missing rows, or --reset (local only) to wipe it first.');
  }

  for (const model of MODELS) {
    const rows = data[model].map((row) => {
      const out = { ...row };
      if (model === 'User' && out.password) {
        out.passwordHash = bcrypt.hashSync(out.password, 10);
        out.email = out.email.toLowerCase();
      }
      delete out.password;
      if (model === 'Attendance' && DATE_ONLY.test(out.date)) out.date = `${out.date}T00:00:00.000Z`;
      return out;
    });
    let added = 0;
    for (let i = 0; i < rows.length; i += CHUNK) added += (await delegate(model).createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: merge })).count;
    console.log(`${model.padEnd(15)} ${rows.length}${merge ? ` (${added} new)` : ''}`);
  }
}

async function main() {
  if (!dirArg || !['export', 'check', 'import'].includes(command)) {
    throw new Error('Usage: node prisma/dataset.js <export|check|import> <dir> [--reset]');
  }
  if (command === 'export') return exportTo(dirArg);
  if (command === 'import') return importFrom(dirArg);

  const problems = check(load(dirArg));
  console.log(problems.length ? problems.join('\n') : 'Dataset is consistent');
  if (problems.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

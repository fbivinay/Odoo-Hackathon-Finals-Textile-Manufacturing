require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');
const materialService = require('../src/services/materialService');
const orderService = require('../src/services/orderService');
const productionService = require('../src/services/productionService');
const qcService = require('../src/services/qcService');
const dispatchService = require('../src/services/dispatchService');
const workforceService = require('../src/services/workforceService');

// `npm run seed` adds logins, machines and (on an empty database) demo data.
// `npm run seed -- --reset` wipes every table first.
const RESET = process.argv.includes('--reset');
const PASSWORD = 'Password123';
const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (n) => new Date(Date.now() + n * DAY);

const users = [
  { name: 'Mill Owner', email: 'owner@everest.dev', role: 'OWNER' },
  { name: 'Store Keeper', email: 'store@everest.dev', role: 'STORE' },
  { name: 'Floor Supervisor', email: 'production@everest.dev', role: 'PRODUCTION' },
  { name: 'QC Inspector', email: 'qc@everest.dev', role: 'QC' },
  { name: 'Dispatch Clerk', email: 'dispatch@everest.dev', role: 'DISPATCH' },
];

const machines = [
  { code: 'SP-01', name: 'Spinning Frame 1', type: 'SPINNING' },
  { code: 'SP-02', name: 'Spinning Frame 2', type: 'SPINNING' },
  { code: 'WV-01', name: 'Loom 1', type: 'WEAVING' },
  { code: 'WV-02', name: 'Loom 2', type: 'WEAVING' },
  { code: 'WV-03', name: 'Loom 3', type: 'WEAVING' },
  { code: 'DY-01', name: 'Dyeing Vat 1', type: 'DYEING' },
  { code: 'DY-02', name: 'Dyeing Vat 2', type: 'DYEING' },
];

async function reset() {
  const tables = [
    'payment', 'invoice', 'qCRecord', 'productionLog', 'roll', 'dispatch', 'productionJob',
    'materialIssue', 'materialInward', 'order', 'rawMaterial', 'attendance', 'wagePayment',
    'worker', 'machine', 'buyer', 'supplier', 'user',
  ];
  for (const table of tables) await prisma[table].deleteMany();
}

// Run one order through a stage: start a job, report output, finish it.
async function runStage(order, machine, worker, qty, { finish = true } = {}) {
  const job = await productionService.startJob({
    orderId: order.id, machineId: machine.id, workerId: worker.id, shift: worker.shift, qtyPlanned: Number(order.qty),
  });
  await productionService.logProgress(job.id, { qty });
  if (finish) await productionService.finishJob(job.id, 'COMPLETED');
  return job;
}

async function demoData(byEmail, m) {
  const [sunrise, kohinoor] = await Promise.all([
    prisma.supplier.create({ data: { name: 'Sunrise Yarn Traders', phone: '9820011223' } }),
    prisma.supplier.create({ data: { name: 'Kohinoor Cotton Co', phone: '9820044556' } }),
  ]);
  const [arvind, bluebird, fabindia] = await Promise.all([
    prisma.buyer.create({ data: { name: 'Arvind Garments', phone: '9876500011', email: 'orders@arvindgarments.in' } }),
    prisma.buyer.create({ data: { name: 'Bluebird Exports', phone: '9876500022', email: 'buy@bluebird.in' } }),
    prisma.buyer.create({ data: { name: 'Fab India Retail', phone: '9876500033' } }),
  ]);

  const cottonWhite = await materialService.create({ yarnType: 'Cotton 40s', colour: 'White', unit: 'kg', reorderLevel: 200 });
  const cottonBlue = await materialService.create({ yarnType: 'Cotton 40s', colour: 'Blue', unit: 'kg', reorderLevel: 200 });
  const polyBlack = await materialService.create({ yarnType: 'Polyester 150D', colour: 'Black', unit: 'kg', reorderLevel: 100 });
  const silkRed = await materialService.create({ yarnType: 'Silk Blend', colour: 'Red', unit: 'kg', reorderLevel: 80 });

  const store = byEmail['store@everest.dev'].id;
  await materialService.inward({ materialId: cottonWhite.id, supplierId: sunrise.id, qty: 600, rate: 210 }, store);
  await materialService.inward({ materialId: cottonBlue.id, supplierId: sunrise.id, qty: 400, rate: 235 }, store);
  await materialService.inward({ materialId: polyBlack.id, supplierId: kohinoor.id, qty: 300, rate: 160 }, store);
  await materialService.inward({ materialId: silkRed.id, supplierId: kohinoor.id, qty: 60, rate: 620 }, store);

  const workers = await Promise.all(
    [
      ['W-01', 'Ramesh Patel', 'MORNING', 650], ['W-02', 'Suresh Yadav', 'MORNING', 650],
      ['W-03', 'Anita Kumari', 'MORNING', 700], ['W-04', 'Imran Shaikh', 'EVENING', 680],
      ['W-05', 'Lakshmi Devi', 'EVENING', 700], ['W-06', 'Mohan Singh', 'NIGHT', 750],
    ].map(([code, name, shift, dailyWage]) => prisma.worker.create({ data: { code, name, shift, dailyWage } }))
  );
  for (let back = 6; back >= 0; back -= 1) {
    await workforceService.markAttendance({
      date: daysFromNow(-back).toISOString().slice(0, 10),
      entries: workers.map((w, i) => ({
        workerId: w.id,
        status: (i + back) % 7 === 0 ? 'ABSENT' : (i + back) % 5 === 0 ? 'HALF_DAY' : 'PRESENT',
      })),
    });
  }

  const order = (buyer, material, fabricType, colour, qty, yarnRequired, pricePerUnit, dueIn) =>
    orderService.create({ buyerId: buyer.id, materialId: material.id, fabricType, colour, qty, yarnRequired, pricePerUnit, deadline: daysFromNow(dueIn) });

  // 1. Finished and shipped, invoice fully paid.
  const shipped = await order(arvind, cottonWhite, 'Poplin', 'White', 600, 150, 180, 4);
  await materialService.issue({ materialId: cottonWhite.id, orderId: shipped.id, qty: 150 });
  await runStage(shipped, m['SP-01'], workers[0], 600);
  await runStage(shipped, m['WV-01'], workers[1], 600);
  const shippedDye = await runStage(shipped, m['DY-01'], workers[2], 600);
  const shippedRolls = [];
  for (let i = 0; i < 3; i += 1) shippedRolls.push(await productionService.createRoll({ jobId: shippedDye.id, qty: 200 }));
  const qc = byEmail['qc@everest.dev'].id;
  for (const roll of shippedRolls) await qcService.inspect(roll.id, { result: 'PASS' }, qc);
  const sent = await dispatchService.create({ orderId: shipped.id, rollIds: shippedRolls.map((r) => r.id), vehicleNo: 'GJ-05-AB-1234' });
  await dispatchService.addPayment(sent.invoice.id, { amount: sent.invoice.amount, method: 'NEFT' });

  // 2. Ready on the shelf, one roll rejected for a defect.
  const ready = await order(bluebird, polyBlack, 'Twill', 'Black', 400, 100, 150, 6);
  await materialService.issue({ materialId: polyBlack.id, orderId: ready.id, qty: 100 });
  await runStage(ready, m['WV-02'], workers[3], 500);
  const readyDye = await runStage(ready, m['DY-02'], workers[4], 500);
  const readyRolls = [];
  for (let i = 0; i < 5; i += 1) readyRolls.push(await productionService.createRoll({ jobId: readyDye.id, qty: 100 }));
  for (const roll of readyRolls.slice(0, 4)) await qcService.inspect(roll.id, { result: 'PASS' }, qc);
  await qcService.inspect(readyRolls[4].id, { result: 'REJECT', defectType: 'Colour mismatch', notes: 'Shade lighter than sample' }, qc);

  // 3. Waiting at QC, one roll sent for rework.
  const checking = await order(fabindia, cottonBlue, 'Denim', 'Blue', 300, 80, 260, 3);
  await materialService.issue({ materialId: cottonBlue.id, orderId: checking.id, qty: 80 });
  const checkingJob = await runStage(checking, m['WV-03'], workers[5], 300);
  const checkingRolls = [];
  for (let i = 0; i < 3; i += 1) checkingRolls.push(await productionService.createRoll({ jobId: checkingJob.id, qty: 100 }));
  await qcService.inspect(checkingRolls[0].id, { result: 'REWORK', defectType: 'Uneven weaving' }, qc);

  // 4 and 5. On the floor right now, one of them past its deadline.
  const weaving = await order(arvind, cottonWhite, 'Canvas', 'White', 800, 200, 140, 9);
  await materialService.issue({ materialId: cottonWhite.id, orderId: weaving.id, qty: 120 });
  await runStage(weaving, m['SP-02'], workers[0], 800);
  await runStage(weaving, m['WV-01'], workers[1], 320, { finish: false });

  const late = await order(bluebird, cottonBlue, 'Chambray', 'Blue', 500, 130, 210, 5);
  await materialService.issue({ materialId: cottonBlue.id, orderId: late.id, qty: 130 });
  await runStage(late, m['SP-01'], workers[2], 180, { finish: false });
  await prisma.order.update({ where: { id: late.id }, data: { deadline: daysFromNow(-2) } });

  // 6. New order with not enough yarn in the store.
  await order(fabindia, silkRed, 'Silk Satin', 'Red', 350, 90, 540, 14);

  await productionService.setMachineStatus(m['DY-02'].id, 'BREAKDOWN');

  // Spread the reported output over the past week so the charts have a shape.
  const logs = await prisma.productionLog.findMany({ orderBy: { loggedAt: 'asc' } });
  for (const [i, log] of logs.entries()) {
    const back = Math.max(0, 6 - Math.floor((i * 7) / logs.length));
    await prisma.productionLog.update({ where: { id: log.id }, data: { loggedAt: daysFromNow(-back) } });
  }

  // Give every job a believable duration so labour cost is not zero.
  const jobs = await prisma.productionJob.findMany();
  for (const [i, job] of jobs.entries()) {
    const hours = 5 + (i % 4);
    const end = job.completedAt || new Date();
    await prisma.productionJob.update({ where: { id: job.id }, data: { startedAt: new Date(end - hours * 60 * 60 * 1000) } });
  }
}

async function main() {
  if (RESET) await reset();

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const byEmail = {};
  for (const user of users) {
    byEmail[user.email] = await prisma.user.upsert({ where: { email: user.email }, update: {}, create: { ...user, passwordHash } });
  }

  const m = {};
  for (const machine of machines) {
    m[machine.code] = await prisma.machine.upsert({ where: { code: machine.code }, update: {}, create: machine });
  }

  if ((await prisma.order.count()) === 0) {
    await demoData(byEmail, m);
    console.log('Seeded logins, machines and demo data');
  } else {
    console.log('Seeded logins and machines (orders exist, demo data skipped; use --reset to rebuild)');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

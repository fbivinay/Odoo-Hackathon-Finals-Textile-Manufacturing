// What a fresh database starts with in Mill Setup: three order rules, a daily capacity for every
// machine, 4 machines per stage and a list of 36 workers. Anything the mill has already set is left alone.
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { addRule } = require('../src/services/configService');
const { setMachineStatus } = require('../src/services/productionService');

const DEFAULTS = [
  { kind: 'QUANTITY', below: 500, pricePct: 10, wastagePct: 2 },
  { kind: 'QUANTITY', below: 1000, pricePct: 5, wastagePct: 1 },
  { kind: 'DEADLINE', below: 7, pricePct: 15, wastagePct: 0 },
];

// A good day's output per machine, from the busiest tenth of days in the Everest dataset:
// kg of yarn for spinning, metres of fabric for weaving and dyeing.
const CAPACITY = { SPINNING: 550, WEAVING: 950, DYEING: 2600 };

async function main() {
  if ((await prisma.orderRule.count()) > 0) console.log('Order rules already set, left as they are.');
  else {
    for (const rule of DEFAULTS) await addRule(rule, { name: 'Default' });
    console.log(`Added ${DEFAULTS.length} default order rules.`);
  }

  let machines = 0;
  for (const [type, dailyCapacity] of Object.entries(CAPACITY)) {
    machines += (await prisma.machine.updateMany({ where: { type, dailyCapacity: null }, data: { dailyCapacity } })).count;
  }
  console.log(machines ? `Set the standard daily capacity on ${machines} machine(s).` : 'Every machine already has a daily capacity.');
  await trimWorkers();
  await trimMachines();

  // A short delivery address for each demo client that has none (all in Bengaluru). Addresses
  // typed in the app are never overwritten.
  let addressed = 0;
  for (const [name, address] of Object.entries(ADDRESSES)) {
    addressed += (await prisma.buyer.updateMany({ where: { name, address: null }, data: { address } })).count;
  }
  if (addressed) console.log(`Added a delivery address to ${addressed} client(s).`);

  // Rolls the dataset left "in rework" with no stage to go back to: put them back in the check queue.
  const rechecks = await prisma.roll.updateMany({ where: { status: 'REWORK', reworkStage: null }, data: { status: 'PENDING_QC' } });
  if (rechecks.count) console.log(`${rechecks.count} roll(s) back from rework are waiting for a re-check.`);
}

// The mill runs 4 machines in each stage. Extra ones in the dataset come off the floor (their
// past jobs and output stay); a job running on one is stopped, so its order returns to the list.
// Skipped once any machine has been removed, so Mill Setup changes are never touched.
const PER_STAGE = 4;
async function trimMachines() {
  if ((await prisma.machine.count({ where: { removedAt: { not: null } } })) > 0) return console.log('Machine list already trimmed, left as it is.');
  let off = 0;
  for (const type of ['SPINNING', 'WEAVING', 'DYEING']) {
    const extra = await prisma.machine.findMany({ where: { type }, orderBy: { code: 'asc' }, skip: PER_STAGE });
    for (const machine of extra) {
      if (machine.status === 'RUNNING') await setMachineStatus(machine.id, 'IDLE');
      await prisma.machine.update({ where: { id: machine.id }, data: { removedAt: new Date(), status: 'IDLE' } });
      off += 1;
    }
  }
  console.log(`Kept ${PER_STAGE} machines in each stage; took ${off} off the floor.`);
}

const ADDRESSES = {
  'Aditya Birla Fashion': 'Whitefield, Bengaluru 560066',
  'Arvind Garments': 'Peenya Industrial Area, Bengaluru 560058',
  'Fabindia Sourcing': 'Indiranagar, Bengaluru 560038',
  'Gokaldas Exports': 'Mysore Road, Bengaluru 560026',
  'Page Industries': 'Bommasandra, Bengaluru 560099',
  'Raymond Apparel': 'Yeshwanthpur, Bengaluru 560022',
  'Shahi Exports': 'Bommanahalli, Bengaluru 560068',
  'Siyaram Silk Mills': 'Rajajinagar, Bengaluru 560010',
  'Welspun Home': 'Electronic City, Bengaluru 560100',
  'Westside Sourcing': 'Koramangala, Bengaluru 560034',
};

// The mill runs 36 floor workers, 12 on each shift. The dataset carries more (people who left,
// spare hands): the extras stay in the old registers and payslips but come off the list. Skipped
// once anyone has been removed, so workers added or removed in Mill Setup are never touched.
const PER_SHIFT = 12;
async function trimWorkers() {
  if ((await prisma.worker.count({ where: { removedAt: { not: null } } })) > 0) return console.log('Worker list already trimmed, left as it is.');
  let off = 0;
  for (const shift of ['MORNING', 'EVENING', 'NIGHT']) {
    const keep = await prisma.worker.findMany({ where: { shift, isActive: true }, orderBy: { code: 'asc' }, take: PER_SHIFT, select: { id: true } });
    off += (await prisma.worker.updateMany({ where: { shift, id: { notIn: keep.map((w) => w.id) } }, data: { removedAt: new Date(), isActive: false } })).count;
  }
  console.log(`Kept ${PER_SHIFT} workers on each shift; took ${off} off the list.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

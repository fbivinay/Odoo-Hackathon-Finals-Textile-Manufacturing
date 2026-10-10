// The order rules a fresh database starts with. Skipped once the mill has any rule of its own.
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { addRule } = require('../src/services/configService');

const DEFAULTS = [
  { kind: 'QUANTITY', below: 500, pricePct: 10, wastagePct: 2 },
  { kind: 'QUANTITY', below: 1000, pricePct: 5, wastagePct: 1 },
  { kind: 'DEADLINE', below: 7, pricePct: 15, wastagePct: 0 },
];

async function main() {
  if ((await prisma.orderRule.count()) > 0) return console.log('Order rules already set, left as they are.');
  for (const rule of DEFAULTS) await addRule(rule, { name: 'Default' });
  console.log(`Added ${DEFAULTS.length} default order rules.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

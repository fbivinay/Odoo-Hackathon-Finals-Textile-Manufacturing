require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { allocateAllYarn } = require('../src/services/materialService');

// One-off after loading a dataset: give every open order the yarn the store already has for it,
// the same way the app does when an order is taken or yarn is received.
allocateAllYarn()
  .then((orders) => console.log(`Yarn issued to ${orders} waiting order(s)`))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

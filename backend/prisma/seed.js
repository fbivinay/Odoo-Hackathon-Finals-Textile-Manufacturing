require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const PASSWORD = 'Password123';

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
  { code: 'DY-01', name: 'Dyeing Vat 1', type: 'DYEING' },
];

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: { ...user, passwordHash },
    });
  }

  for (const machine of machines) {
    await prisma.machine.upsert({ where: { code: machine.code }, update: {}, create: machine });
  }

  console.log(`Seeded ${users.length} users and ${machines.length} machines`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

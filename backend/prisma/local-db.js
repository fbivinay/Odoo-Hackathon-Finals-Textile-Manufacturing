// Local Postgres for development, no install needed: `npm run db` (keep it running).
// Data lives in backend/.pgdata; delete that folder to start clean.
const path = require('path');
const EmbeddedPostgres = require('embedded-postgres').default;

const pg = new EmbeddedPostgres({
  databaseDir: path.join(__dirname, '..', '.pgdata'),
  user: 'postgres',
  password: 'postgres',
  port: 5433,
  persistent: true,
  // Windows otherwise picks its own code page (WIN1252), which cannot store ₹.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

async function main() {
  await pg.initialise().catch(() => {}); // already initialised on later runs
  await pg.start();
  // UTF8 even inside an older WIN1252 cluster; already exists on later runs.
  const client = pg.getPgClient();
  await client.connect();
  await client.query(`CREATE DATABASE everest ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`).catch(() => {});
  await client.end();
  console.log('Local Postgres ready: postgresql://postgres:postgres@localhost:5433/everest');
}

const stop = () => pg.stop().finally(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

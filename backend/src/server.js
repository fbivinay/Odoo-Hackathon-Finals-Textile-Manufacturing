require('dotenv').config();
const app = require('./app');
const prisma = require('./lib/prisma');

const PORT = process.env.PORT || 4000;

// Open the database connection before taking requests, so the first one isn't the slow one.
prisma
  .$connect()
  .catch((e) => console.error('Database not reachable at startup:', e.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Everest Textile backend listening on port ${PORT}`);
    });
  });

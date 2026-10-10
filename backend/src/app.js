const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const trackRouter = require('./routes/track');
const mastersRouter = require('./routes/masters');
const materialsRouter = require('./routes/materials');
const ordersRouter = require('./routes/orders');
const productionRouter = require('./routes/production');
const qcRouter = require('./routes/qc');
const dispatchRouter = require('./routes/dispatch');
const workforceRouter = require('./routes/workforce');
const reportsRouter = require('./routes/reports');
const assistantRouter = require('./routes/assistant');
const { notFoundHandler, errorHandler } = require('./middleware/errors');

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
    credentials: true,
  })
);
// Chat messages can carry photos, so this one route takes a bigger body than the rest.
app.use('/api/assistant', express.json({ limit: '18mb' }), assistantRouter);
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, data: { status: 'up' } }));

app.use('/api/auth', authRouter);
app.use('/api/track', trackRouter); // public buyer tracking
app.use('/api/materials', materialsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/qc', qcRouter);
app.use('/api', usersRouter); // /me, /users
app.use('/api', mastersRouter); // /suppliers, /buyers
app.use('/api', productionRouter); // /machines, /production/*
app.use('/api', dispatchRouter); // /dispatch, /invoices
app.use('/api', workforceRouter); // /workers, /attendance, /wages
app.use('/api', reportsRouter); // /dashboard, /reports/*

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

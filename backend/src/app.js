const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const { notFoundHandler, errorHandler } = require('./middleware/errors');

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, data: { status: 'up' } }));

app.use('/api/auth', authRouter);
app.use('/api', usersRouter); // exposes /api/me, /api/users

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

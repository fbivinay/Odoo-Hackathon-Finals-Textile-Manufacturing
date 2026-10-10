# Backend — Everest Textile Mills

Node.js + Express + Prisma + PostgreSQL. Endpoint shapes: `../docs/api.md`.

## Setup

```bash
cd backend
npm install
cp .env.example .env        # defaults point at the local database
npm run db                  # terminal 1: local Postgres on :5433 (no install needed)
npm run setup               # once: migrate + load data/everest; re-run to reset
npm run dev                 # terminal 2: http://localhost:4000, health: GET /health
```

Development is local-first. Neon is used only by the deployed app on Render.
`npm run seed -- --reset` loads the small six-order demo instead of the full dataset.

Logins: `owner@`, `store@`, `production@`, `qc@`, `dispatch@everest.dev` / `Password123`.

## Structure

```
src/
  app.js         express app, route mounting
  server.js      entrypoint
  routes/        thin: validate, call a service, wrap with handle()
  services/      all business logic and Prisma calls
  middleware/    requireAuth, requireRole, handle, errors
  validators/    zod schemas
  lib/           prisma client, errors, dates, numbering
prisma/
  schema.prisma
  migrations/
  seed.js
```

Rule: routes never touch Prisma directly, services never touch `req`/`res`.

## Deploy (Render)

`../render.yaml` describes the service. Set `DATABASE_URL`, `JWT_SECRET` and `CORS_ORIGIN` (comma-separated frontend origins) in the dashboard.

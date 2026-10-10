# Backend — Everest Textile Mills

Node.js + Express + Prisma + PostgreSQL. Endpoint shapes: `../docs/api.md`.

## Setup

```bash
cd backend
npm install
cp .env.example .env        # fill in DATABASE_URL and JWT_SECRET
npx prisma migrate deploy   # apply migrations
npm run seed                # logins, machines, demo data
npm run dev                 # http://localhost:4000, health: GET /health
```

`npm run seed -- --reset` wipes every table and rebuilds the demo data.

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

# Everest Textile Mills — Odoo Hackathon Finals

One platform replacing the mill's notebooks and phone calls. Problem statement: `docs/problem-statement.pdf`.

## Rules for Claude (both teammates)

- **Replies:** super short, concise, to the point. Tables, charts and diagrams are welcome; long prose is not.
- **Commits & pushes:** message of 8 words or fewer. Never add Claude as co-author or any "Generated with" line.
- **Ownership:** Gopal owns `backend/`, the frontend teammate owns `web/`. Don't edit the other side unless asked; if an API shape changes, say so.
- Pull with rebase before pushing; both work on `main`.

## Stack

| Layer | Tech |
|---|---|
| Frontend (`web/`) | React 19 + Vite + TypeScript + Tailwind v4 + shadcn/ui + TanStack Table + Recharts |
| Backend (`backend/`) | Node + Express (CommonJS JS) + Prisma 5 + zod |
| Database | PostgreSQL on Neon |
| Auth | JWT + bcrypt, roles: `OWNER` `STORE` `PRODUCTION` `QC` `DISPATCH` |
| Deploy | web → Vercel, backend → Render, DB → Neon |

## Commands

```bash
# backend (http://localhost:4000)
cd backend && npm i && cp .env.example .env
npx prisma migrate deploy && npm run seed && npm run dev
npm run seed -- --reset    # wipe and rebuild demo data

# web (http://localhost:5173)
cd web && npm i && cp .env.example .env && npm run dev
npm test && npx tsc -b && npm run lint
```

Seed logins: `owner@` `store@` `production@` `qc@` `dispatch@everest.dev` / `Password123`.

## Backend conventions

```
backend/src/
  app.js         mounts routers under /api
  routes/        thin: validate with zod, call a service, shape the response
  services/      all business logic and Prisma calls
  validators/    zod schemas
  middleware/    requireAuth, requireRole(...roles), asyncHandler, errors
  lib/           prisma client, AppError helpers
```

- Routes never touch Prisma; services never touch `req`/`res`. Wrap route functions in `handle()`.
- Endpoint list for the frontend: `docs/api.md`. Update it whenever a route or shape changes.
- Order status is derived by `orderService.syncStatus`; call it after any job, roll, QC or dispatch change.
- Every response: `{ ok: true, data }` or `{ ok: false, error, message }`.
- Throw `badRequest/notFound/conflict/...` from `lib/errors`.
- `OWNER` passes every `requireRole` check.
- Multi-step stock or dispatch changes go in `prisma.$transaction`.

## Frontend conventions

- Call the API only through `web/src/lib/api.ts` (unwraps the envelope, adds the JWT).
- `VITE_USE_MOCKS=true` runs the UI on `web/src/lib/mock.ts` without a backend.
- Screens are still the round-1 HRMS ones, to be reworked for the textile flow.

## Domain flow

```
Supplier → MaterialInward → RawMaterial stock → MaterialIssue
Buyer → Order → ProductionJob (machine × stage × shift) → ProductionLog, Roll
Roll → QCRecord (pass/rework/reject) → Dispatch → Invoice → Payment
Worker → Attendance → WagePayment
```

Schema: `backend/prisma/schema.prisma`. Buyers track an order publicly via `Order.trackingToken`.

## Skills (`.claude/skills/`, loaded automatically)

| Skill | Use for |
|---|---|
| `prisma-client-api` | Prisma queries, transactions (written for Prisma 7; we run 5, skip its adapter setup) |
| `shadcn` | adding and composing shadcn/ui components |
| `vercel-react-best-practices` | React performance patterns |
| `frontend-design` | visual direction for new screens |
| `web-design-guidelines` | UI and accessibility review |

Add more with `npx skills add <repo> -s <skill> -a claude-code --copy`.

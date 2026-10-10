# Everest Textile Mills

Textile Manufacturing System — Odoo Hackathon Finals. One platform for raw material, production floor, quality checks, buyer order tracking, dispatch and month-end costing.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite + TypeScript + Tailwind CSS v4 + shadcn/ui |
| Backend | Node.js + Express + Prisma ORM |
| Database | PostgreSQL on [Neon](https://neon.tech) |
| Hosting | Frontend → Vercel · Backend → Render |

## Local Setup

### Backend
```bash
cd backend
cp .env.example .env   # Add DATABASE_URL (Neon) and JWT_SECRET
npm install
npx prisma migrate dev && npm run seed
npm run dev            # http://localhost:4000
```

### Frontend
```bash
cd web
cp .env.example .env   # VITE_API_URL=http://localhost:4000/api
npm install
npm run dev            # http://localhost:5173
```

## Demo Logins

Password for all: `Password123`

| Role | Email |
|---|---|
| Owner | `owner@everest.dev` |
| Store | `store@everest.dev` |
| Production | `production@everest.dev` |
| QC | `qc@everest.dev` |
| Dispatch | `dispatch@everest.dev` |

## Structure

```
├── backend/   # Express API, Prisma schema, seed
├── web/       # React + Vite frontend
├── docs/      # Problem statement
└── CLAUDE.md  # Shared Claude Code instructions and conventions
```

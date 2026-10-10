# Everest Lab Implementation Plan

> Executed natively in one session (owner asked to build straight away).

**Goal:** Owner-only Everest Lab: intelligence, rule-based recommendations, what-if simulation on the real planning engine, comparison, saved scenarios.

**Architecture:** `planningService` split into `snapshot()` + pure `plan(snap, changes, days)`; `labService` runs baseline and scenario on one snapshot and adds money; `/lab` routes owner-only; `LabScenario` table; web `/lab` page with 5 tabs.

**Spec:** `docs/superpowers/specs/2026-10-10-everest-lab-design.md`

## Global Constraints
- Simulation never writes operational tables (only `LabScenario`, `AuditLog`).
- Owner-only (`requireRole()` / `ProtectedRoute roles={[]}`).
- No invented machine prices, power or staffing: owner inputs, required when machines are added.
- `GET /planning/schedule` output unchanged.
- Commit messages ≤ 8 words, no co-author lines.

## Review Focus
- Same scenario run twice → identical result (test in Task 1).
- Unknown machineId / material id / fabric → 400, not crash (Task 2).
- Adding machines with no cost inputs → result still shown, money marked "needs prices" (Task 2).
- Stage with zero machines + add machine → capacity comes from fallback rate or explicit perShift (Task 1).
- Gemini missing/quota → rules explanation, never an error to the user (Task 3).

---

### Task 1: Pure planner
- Modify `backend/src/services/planningService.js`: `snapshot()`, `plan(snap, changes, days)`, `schedule()` = both.
- Test `backend/src/services/planningService.test.js` (node:test): determinism, add machine never later, breakdown never earlier, Sundays never later, rush order appears.
- Verify `/planning/schedule` JSON identical before/after on local DB.

### Task 2: labService + validators + routes
- Create `backend/src/validators/labValidators.js`, `backend/src/services/labService.js` (intelligence, recommendations, simulate, money), `backend/src/routes/lab.js`, mount in `app.js`.
- Test: simulate leaves DB row counts unchanged; bad inputs 400.

### Task 3: Explain (Gemini + rules) and saved scenarios
- Export `generate` from `assistantService`; `labService.explain` with rules fallback.
- Migration `LabScenario` + `LabDecision`; CRUD + run; AuditLog.

### Task 4: Web
- `web/src/pages/Lab.tsx` + `web/src/pages/lab/*` (Intelligence, Builder, Results, Compare, Saved), `web/src/lib/lab.ts` types.
- App route `/lab` owner-only, NAV entry.

### Task 5: Docs and checks
- `docs/api.md` Lab section; tsc, lint, web tests, build; browser walk-through; note for Gopal.

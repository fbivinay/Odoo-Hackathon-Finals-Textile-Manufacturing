# Everest Lab — design

Owner-only workspace: **Understand → Recommend → Simulate → Compare → Decide**.
Nothing in Lab ever writes to orders, stock, production, dispatch, payroll or accounts.

Decisions taken with the owner (2026-10-10): backend allowed (heads-up to Gopal), scenarios saved in a new DB table, AI narration via existing Gemini with a rule-based fallback, everything in one release.

## 1. What the data really supports

| Need | Source in repo | Status |
|---|---|---|
| Stage capacity per machine | `planningService.stageCapacity` (60-day avg output per shift × 3 shifts) | real |
| Forward plan, lateness, yarn shortage | `planningService.schedule` (EDF, Sundays closed, supplier lead days, qcDays) | real |
| Stages | SPINNING (kg), WEAVING (m), DYEING (m); SP/WV/DY machines exist | real — spinning scenarios valid |
| Revenue, materials, wages, logistics, utilities, maintenance, net profit | `accountsService.overview` / `monthly` | real |
| Order margin | `reportService.orderCosts` | real |
| QC pass/rework/reject, defects | `qcService.summary` | real |
| Receivables / payables | `accountsService.overview` | real |
| Finished stock awaiting dispatch | `dispatchService.stock` | real |
| Machine price, power draw, staff per machine | none | **owner input** (no defaults invented; field required) |
| Breakdown history | only current `Machine.status` | limited — no frequency analysis |
| Trucks / dispatch capacity | none (dispatch has free-text vehicleNo) | **not modelled**; logistics = cost per metre only |
| Shifts | mill already runs 3 × 8 h = 24 h | "extra shift" = **Sunday working** (only real headroom) |

## 2. Engine (backend, deterministic)

Refactor `planningService.schedule` into two parts, behaviour of `GET /planning/schedule` unchanged:

- `snapshot()` — loads machines + rates, open orders, materials, stage output, issues, settings. Returns a plain object + `takenAt`.
- `plan(snapshot, changes = {}, days)` — pure function, no Prisma. `schedule()` = `plan(await snapshot(), {}, days)`.

`changes` (validated with zod in `validators/labValidators.js`):

| Key | Shape | Effect in `plan` |
|---|---|---|
| `addMachines` | `[{stage, count 1–3, perShift?, fromDay 0–180, rampDays 0–60}]` | extra capacity from `fromDay`, linear ramp; perShift defaults to stage average |
| `breakdowns` | `[{machineId, days 1–90}]` | machine's capacity removed for days 0..days |
| `sundays` | `boolean` | Sundays become working days |
| `materials` | `[{materialId, stockChange (± qty, stock ≥0), extraLeadDays 0–90}]` | changes stock handed out and lead days for short orders |
| `rushOrder` | `{fabricType, qty 1–200000, deadline, pricePerUnit?}` | inserted into EDF queue; yarn from `configService.quoteFor`; price defaults to quote |
| `qc` | `{rejectPct 0–50}` | remaining weaving+dyeing scaled by (1−base)/(1−new); base from last-90-day QC |
| `logistics` | `{costPerMetreChangePct −50–200}` | financial only |

Costs block (owner inputs, required when machines are added): `machineCost` (₹ each), `powerKw`, `staffPerShift`, `maintenancePctYear` (default 5, labelled assumption). Tariff ₹/kWh = owner input.

`labService.simulate({changes, costs, days})`:
1. `snap = snapshot()`; `base = plan(snap, {}, days)`; `alt = plan(snap, changes, days)` — same snapshot, so reproducible.
2. Metrics both sides: capacity per stage (theoretical vs used = utilisation), bottleneck stage per week, orders on time / late / unscheduled, avg days late, metres ready inside horizon, yarn/material shortages, QC workload (metres to inspect).
3. Per-order diff: expectedReady before/after, improved/worsened lists.
4. Money (all over the chosen horizon, ₹, rounded to paise at the end):
   - contribution per metre = (revenue − materials − logistics) / metres invoiced, last 12 months (accounts) — shown as source.
   - **Revenue pulled forward** = value of orders that become ready inside the horizon only in scenario (timing, not new money).
   - **New revenue** = rush order value only if it finishes by its deadline.
   - **Spare capacity opportunity** = unused bottleneck capacity × contribution/m, flagged "needs new orders — not confirmed".
   - Costs: one-time (machine cost × count); recurring for horizon: power (kW × 24h × working days × tariff), labour (staffPerShift × 3 × avg daily wage of that stage's workers), maintenance (pct × capex × days/365), Sunday working (wages of one day per week × workers + utilities/day from accounts), logistics change.
   - Incremental operating profit = new revenue contribution − recurring costs; payback (months) = capex ÷ monthly incremental profit (or "not paid back" if ≤ 0); ROI over horizon.
5. Return `{base, alt, diff, money, assumptions[], limitations[], snapshotAt}`.

Validation errors → 400 with plain message (e.g. "Machine X is already down", "count must be 1 to 3", "Machine prices are needed to work out payback").

## 3. Intelligence + recommendations

`GET /lab/intelligence?from&to` (owner): summary cards (open/late orders, on-time %, output, utilisation, down machines, shortages, QC rates, finished awaiting dispatch, revenue/costs/profit, receivable/payable, logistics + utilities), each with `source` and `asOf`; missing → `null` + reason.

Recommendations are rules over that data, each `{id, title, problem, evidence[{label, value, link}], action, why, benefit, cost, risks, confidence: HIGH|MEDIUM|LOW, assumptions, limitations, scenario}` — `scenario` pre-fills the builder:

| Rule | Fires when | Scenario |
|---|---|---|
| Capacity at bottleneck | a stage ≥ 90 % used in ≥ half the weeks and it is the stage where late orders wait | add 1 machine at that stage |
| Machine down | machine in BREAKDOWN/MAINTENANCE | breakdown of that machine (shows cost of it staying down) |
| Slow machine | output ≥ 30 % below stage average over 60 days | — (evidence only) |
| Late orders | orders planned late | Sunday working |
| Yarn/material short | planned shortage with lead time | material stock + |
| QC rejects | reject rate above last-year rate, top defect | qc reject target |
| Negative margins | orders with margin < 0 in period | — |
| Chemical usage | dye/chem cost per metre up > 10 % vs previous period | — |
| Logistics cost | logistics per metre up > 10 % vs previous period | logistics |
| Overdue receivables | overdue > 0 | — |

## 4. AI narration

`POST /lab/explain {result}` → Gemini via existing `assistantService` call helper; prompt = computed figures only (no buyer names, GSTINs). Instruction: explain, never add numbers. No key / error / quota → rule-based paragraph built from the diff. Response tagged `source: 'gemini' | 'rules'`. UI labels AI text.

## 5. Saved scenarios

Migration `LabScenario`:
```
id, name, changes Json, costs Json, days Int,
result Json?, snapshotAt DateTime?, evaluatedAt DateTime?,
decision LabDecision (NEEDS_REVIEW default | APPROVED | REJECTED), note String?,
createdBy String, createdAt, updatedAt
```
Routes (owner): `GET/POST /lab/scenarios`, `GET/PATCH/DELETE /lab/scenarios/:id`, `POST /lab/scenarios/:id/run` (rerun → keeps previous result as `previous` in response). Actions logged in `AuditLog` (entity `LabScenario`).
"Approved" is a note only — no apply-to-live.

## 6. Web (`/lab`, owner, NAV "Everest Lab", FlaskConical icon)

Tabs (URL `?tab=`):
1. **Intelligence** — period bar, figures panel (same `Figure` boxes), freshness line, then **AI Recommendations** cards (evidence list with links to Orders/Raw Materials/Production, "Simulate this", "Evidence" expand). Rule-based badge.
2. **Scenario builder** — type picker A–H; forms show current baseline beside each input; combine several (custom). Horizon 30/90/180/365. Run.
3. **Results** — baseline vs scenario table (value, Δ, %, good/bad tone), money block split one-time / recurring / revenue (labels: confirmed vs opportunity), stage capacity chart (Recharts bars before/after per week), orders improved/worsened table, assumptions + limitations, AI explanation panel. Save.
4. **Compare** — pick baseline + up to 3 (quick action: "Add 1/2/3 machines at …" builds three); table of metrics; priority select (on-time, profit, low investment, shortages, bottleneck, balanced) highlights the leader per priority with the reason; pros/cons per column.
5. **Saved** — list (name, created, last run, decision), open/edit/rerun/compare, decision + note.

Visual tags: Actual (data), Estimate (calculated), Assumption (owner input), AI (narration).

## 7. Tests

- `backend/test/lab.test.js`: `plan()` pure — same input same output; baseline unchanged after simulate (DB row counts before/after); add machine never makes an order later; breakdown never makes one earlier; validation rejects count 4, negative stock, unknown machine; rush order uses capacity.
- `/planning/schedule` output identical before/after refactor (snapshot compare).
- Web: `npx tsc -b`, lint, build; browser walk-through of the 14 journeys.

## 8. Out of scope / limits (shown in UI)

Truck/vehicle capacity, breakdown frequency, minute-level timing, cash-flow timing of capex financing, multi-scenario optimisation. Revenue from spare capacity is never counted as confirmed.

# Synthetic Data: Everest Textile Mills

Two importable datasets built by `backend/prisma/synthetic/`. Format and rules: `docs/data-format.md`.

| Folder | What it is |
|---|---|
| `backend/data/everest` | History from 2023-01-01 to **2026-10-10 10:30 IST**, the floor as it stands at that moment, and the confirmed order book due over the next 90 days. |
| `backend/data/everest-live` | The same data advanced through 10 scripted live events (see its `README.md`). Import it to show the floor about 4 hours later. |

```bash
cd backend
npm run data:generate -- --as-of 2026-10-10    # rebuild both folders; output is byte-identical for the same date
npm run data:check  -- data/everest            # → Dataset is consistent
npm run data:check  -- data/everest-live       # → Dataset is consistent
npm run data:import -- data/everest --reset    # wipes the DB, then loads
```

Pass the import date as `--as-of`. History stops at 10:30 IST on that date. "Today" on the dashboard is that date.

## How it is generated

One timeline is simulated, then cut at the as-of moment, so history, today's floor and the order book come from the same run:

1. Orders arrive daily (Poisson). Volume rises in the Aug–Oct festive season, dips in the monsoon and grows about 7% a year. 18% of orders are rush orders with tight deadlines. Over the last 3 weeks the order book for the next quarter is added, due 25–92 days out.
2. Each order runs spinning → weaving → dyeing. The mill runs **24 hours, Monday to Saturday**, in three 8-hour shifts (06/14/22 IST), and is closed on Sundays and festival holidays, the same calendar as the attendance register. **One job = one machine for one shift**, staffed by a worker from that shift's attendance. Machines take the first free shift, skip planned maintenance (24 h every 45–75 days), and occasionally break down (job `STOPPED`, 1–6 shifts of repair, the rest moves to another machine).
3. Dyeing output is cut into ~1,000–1,400 m rolls. QC checks each roll 3–30 h later: about 90% pass, 6% rework (re-checked 1–2.5 days later), 4% reject. Rates are worse in the monsoon, on worse machines and on the 5% of "bad batch" orders. Orders short after QC get a top-up dyeing lot.
4. Every passed roll leaves in one truck, or two for 28% of orders. Each dispatch gets an invoice at dispatched qty × price. Buyers pay on their own terms (15–60 days, some late), 15% in two parts, 1.5% never.
5. Yarn is issued when spinning starts. Stock is tracked in time order: bulk reorders arrive 4–12 days after stock falls below the reorder level, and a shortfall triggers an urgent truck for that order at a 6% premium. The price index follows seasons, inflation and the mid-2024 cotton spike.
6. Attendance runs Mon–Sat, excluding festival holidays. Each month's wages are paid on the 5th of the next month, at exactly what the register earned.
7. Cut at T: jobs crossing T are `RUNNING` with partial output. Rolls, QC, dispatches, payments, wages and yarn movements after T are dropped. One loom breaks down this morning and one machine is on maintenance. Every order status is derived with the same rule as `orderService.syncStatus`.

Same as-of date in, same bytes out (seeded PRNG, ids like `ord_000123`). `build.js` also runs `verify.js`: every job is staffed by a worker who is on that day and shift's register, no shift runs on a closed day, and no job is longer than one shift. The datasets pass `data:check`, and both were imported with `npm run data:import` into a local Postgres 16 and read back through the API.

## Volume (`data/everest`)

| Model | 2023 | 2024 | 2025 | 2026 (to 10 Oct) | Total | everest-live |
|---|---|---|---|---|---|---|
| User | | | | | 8 | 8 |
| Supplier | | | | | 16 | 16 |
| Buyer | | | | | 36 | 36 |
| RawMaterial | | | | | 12 | 12 |
| Worker | | | | | 48 | 48 |
| Machine | | | | | 13 | 13 |
| Order | 430 | 416 | 453 | 467 | 1766 | 1766 |
| MaterialInward | 156 | 143 | 161 | 142 | 602 | 603 |
| MaterialIssue | 411 | 406 | 450 | 389 | 1656 | 1656 |
| ProductionJob | 7038 | 6648 | 7628 | 6327 | 27641 | 27651 |
| ProductionLog | 7038 | 6645 | 7631 | 6327 | 27641 | 27660 |
| Roll | 1200 | 1162 | 1323 | 1051 | 4736 | 4737 |
| QCRecord | 1286 | 1240 | 1401 | 1122 | 5049 | 5052 |
| Dispatch | 426 | 418 | 469 | 386 | 1699 | 1700 |
| Invoice | 426 | 418 | 469 | 386 | 1699 | 1700 |
| Payment | 435 | 470 | 513 | 414 | 1832 | 1833 |
| Attendance | 12286 | 12901 | 13564 | 10540 | 49291 | 49306 |
| WagePayment | 483 | 506 | 532 | 399 | 1920 | 1920 |

Revenue is ₹7.7–9.0 Cr a year. Yarn is about 70% of revenue and wages about 11%, leaving a gross margin of 16–24% before energy, dyes and overheads, which are not in the schema. Single months swing from negative to strongly positive, because yarn bills arrive in bulk ahead of the invoices.

## State at 2026-10-10 10:30 IST

| Area | State |
|---|---|
| Orders | 1766 total: 1621 dispatched, 38 cancelled, 107 open (72 pending, 14 spinning, 13 weaving, 1 dyeing, 3 at QC, 4 ready). **6 delayed.** |
| Order book | 114 orders due after today, the last on 2027-01-07. 72 have not started. |
| Floor | 9 machines running, WV-02 in breakdown (job stopped 09:40), DY-02 on maintenance, 2 idle. Logs from this morning feed "produced today". |
| Yarn | 4 of 12 yarns at or below reorder level. The pending order book needs more yarn than is in stock for 9 of 10 yarns (`availability.shortBy` on each order). |
| QC | Rolls pending, in rework and passed are on the shelf. 250 rejected rolls in history. |
| Money | 102 unpaid and 5 part-paid invoices, ₹1.96 Cr receivable. All months up to September have wages paid; October wages are due. |
| People | 48 workers, 45 active. Today only the morning shift is marked present. |

## Live scenario (`data/everest-live`)

Events are applied in order from 10:50 to 14:00 IST. Each picks its target by a fixed rule, so the result is deterministic. New rows carry `sim_` ids, and history rows are never rewritten.

| # | Event | Effect |
|---|---|---|
| 1 | Yarn delivery | Inward for the yarn furthest below its reorder level; stock and average cost updated. |
| 2 | Production update | One hour of output logged on every running job. |
| 3 | Machine breakdown | First running spinning frame stops; its job becomes `STOPPED`; the order's status updates. |
| 4 | QC inspection | Oldest 4 pending rolls: pass, pass, rework, reject. |
| 5 | Machine recovery | This morning's broken loom is repaired and resumes its order with a new job. |
| 6 | Roll off the line | Running dyeing job logs output and a new roll goes to `PENDING_QC`. |
| 7 | QC pass | That roll passes. |
| 8 | Dispatch | Ready order with the earliest deadline ships all passed rolls; invoice raised. |
| 9 | Payment | Oldest unpaid invoice paid in full. |
| 10 | Shift handover (14:00) | Morning jobs close, the evening crew is marked present and continues every unfinished job. |

To demo, import `everest` and then `everest-live`. Either import resets the database, so the demo can be replayed with nothing else to clean up.

## Schema audit

| Need from the brief | Supported by | Gap |
|---|---|---|
| Suppliers, yarn receipts, stock, consumption | `Supplier` `MaterialInward` `RawMaterial` `MaterialIssue` | No returns or stock adjustments. No purchase orders, so yarn in transit can't be shown. |
| Orders, specs, deadlines, status | `Order` `Buyer` | No tentative/forecast flag, so forecasts are left out. Only confirmed orders are in the book. |
| Production by stage, machine, shift, output | `ProductionJob` `ProductionLog` | **No planned jobs**: a job exists only once started. Future machine assignments can't be stored. |
| Machine status, breakdowns, maintenance | `Machine.status`, `STOPPED` jobs | No downtime log or maintenance schedule, so breakdown history only shows as stopped jobs. No machine operating cost or capacity field. |
| QC, defects, rework, rejects | `Roll` `QCRecord` | No disposition for rejected rolls (scrap, seconds sale). |
| Dispatch, invoices, payments | `Dispatch` `Invoice` `Payment` | No delivery confirmation or delivered date. |
| Workforce | `Worker` `Attendance` `WagePayment` | One shift per worker per day. Wage history is not versioned, so a raise would recolour past months. |
| Finance | Bills, wages, invoices, payments | **No expense model** (power, dyes and chemicals, overheads), so profit is gross of those. |
| Simulation audit trail | `sim_` ids and the event table in `everest-live/README.md` | No event log table for live runs from the app. |

### Proposed schema changes (need the backend owner's approval; nothing has been changed)

1. `JobStatus.PLANNED` plus `ProductionJob.plannedStart`/`plannedEnd`, for the production schedule and future machine load.
2. `Order.isTentative` (or an `OrderForecast` model), for forecast orders kept apart from confirmed ones.
3. `MachineDowntime { machineId, kind: BREAKDOWN|MAINTENANCE, startedAt, endedAt, reason, planned }`, for breakdown history, planned maintenance and real utilisation.
4. `Expense { category, amount, incurredAt, note }`, for power, chemicals and overheads so profit is net.
5. `Dispatch.deliveredAt`, for delivery status on the buyer tracking page.
6. `Machine.capacityPerShift`, so planning doesn't hard-code rates.
7. `SimulationEvent { kind, payload, appliedAt }`, if the live demo should be driven from the app rather than by importing a folder.

## API notes for the frontend

Every existing endpoint works on this data (checked against a local import). What the screens need to know:

| Need | Endpoint | Notes |
|---|---|---|
| Month P&L, any month 2023-01 → 2026-10 | `GET /reports/pnl?month=YYYY-MM` | 2026-10 is a partial month (to the 10th). |
| Machine output per month + daily series | `GET /reports/machine-output?month=YYYY-MM` | Mixed units: spinning in kg, weaving and dyeing in m. |
| Order costing | `GET /reports/order-costs` | All orders, ~660 KB, 1.8 s. |
| Live floor | `GET /production/board` | `producedToday` uses today's logs. |
| Alerts | `GET /dashboard/summary` | Delayed orders, low stock, machines down, receivables. |
| Order book | `GET /orders?status=PENDING` | Deadlines up to 2027-01-07; yarn shortfall via `GET /orders/:id` → `availability`. |
| QC queue | `GET /qc/rolls?status=PENDING_QC` and `?status=REWORK` | **Avoid unfiltered `/qc/rolls`: 3 MB.** |

Gaps for the frontend: there is no date-range filter on lists (only `?month=` on reports) and no pagination. `/orders` (680 KB), `/dispatch` (1.4 MB) and `/qc/rolls` (3 MB) return everything. Proposed: `?from=&to=&limit=&cursor=` on the list endpoints. No planning endpoint exists. Proposed: `GET /planning/schedule?days=90` returning planned stage slots per order, weekly load per stage, yarn needs against stock, and expected ready date against deadline (needs schema change 1, or computed on the fly from fixed rates).

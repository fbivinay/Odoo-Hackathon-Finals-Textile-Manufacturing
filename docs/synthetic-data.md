# Synthetic Data: Everest Textile Mills

Two parts: a historical dataset loaded once, and a live event stream that keeps the mill moving.

| Part | Where | What it is |
|---|---|---|
| Dataset | `backend/data/everest` | Nov 2022 → **2026-10-10 10:30 IST**: every order, truck, shift, roll, QC check, dispatch, invoice, payment and attendance mark, plus today's floor and the order book due over the next 90 days. |
| Live stream | `backend/stream/live_stream.py` | Python, stdlib only. Posts one believable event at a time through the real API: new orders, yarn trucks, yarn issues, jobs, output, rolls, QC, dispatches, payments, breakdowns and repairs, shift handovers. |

```bash
cd backend
npm run db                                   # terminal 1: local Postgres
npm run setup                                # load data/everest (re-run to reset)
npm run dev                                  # terminal 2: API on :4000
npm run stream                               # terminal 3: live events every 3 s, Ctrl+C to stop
python stream/live_stream.py --interval 1 --steps 200 --seed 7   # bounded and repeatable
python stream/live_stream.py --dry-run --steps 20                # read the floor, write nothing

npm run data:generate -- --as-of 2026-10-10  # rebuild the dataset (byte-identical for a date)
npm run data:check -- data/everest           # → Dataset is consistent
```

## Guarantees

The build (`prisma/synthetic/build.js`) refuses to write the dataset unless all of these hold:

| Check | Where |
|---|---|
| Every import rule in `docs/data-format.md` (stock, jobs, machines, rolls, QC, invoices, order status, numbering) | `npm run data:check` |
| **No loss month.** Every month from Jan 2023 to the as-of month has invoicing and a positive profit (invoiced − yarn bills − wages earned, the same sum as `/reports/pnl`) | `verify.js` → `verifyMonths` |
| Every job is staffed by a worker on that day's and shift's register; no shift runs on a Sunday or festival holiday; no job is longer than one shift | `verify.js` → `verifyFloor` |

The stream writes only through the API, so the backend's own rules keep data consistent. After 40 live events the exported database still passed `data:check`. It refuses any API other than localhost unless you pass `--allow-remote`. It keeps at most one machine broken down at a time, and appends every event as a JSON line to `stream/events.log` (git-ignored), each marked `"synthetic": true`.

## How the history is built

- **Calendar.** The mill runs 24 hours in three shifts (06/14/22 IST), Monday to Saturday. It is closed on Sundays and festival holidays. Orders arrive on working days; QC checks happen 07:00–21:00, and trucks leave 09:00–18:00.
- **Warm start.** Simulation begins 1 Nov 2022, so January 2023 opens with yarn in the store and orders on the floor. The two warm-up months exist only as opening work in progress; the dashboard's year picker starts at 2023.
- **Orders.** About 55 a month, with an Aug–Oct festive lift and a mild monsoon dip. Quantities are 500–8,000 m, 12 fabrics and 36 buyers. 18% are rush orders. The last three weeks add the order book for the next quarter.
- **Production.** 17 machines (4 spinning, 9 weaving, 4 dyeing). One job is one machine for one shift. There is planned maintenance every 45–75 days and occasional breakdowns.
- **Yarn and pricing.** Every Monday the store orders roughly what the floor used over the last four weeks, steered toward the next two weeks of planned issues. Each order arrives as two or three trucks spread over the week, so bills follow consumption. Quotes are made off the yarn price index on the day of the order, so the mid-2024 cotton spike passes through to prices instead of sinking a month.
- **Quality.** About 90% of rolls pass, 6% go to rework and 4% are rejected. Rates are worse in the monsoon, on worse machines and on "bad batch" orders.
- **Money.** Every passed roll ships, and each truck gets an invoice. Buyers pay on 15–60 day terms; some pay late, some in two parts.

## Volume (`data/everest`)

| Model | Nov–Dec 2022 | 2023 | 2024 | 2025 | 2026 (to 10 Oct) | Total |
|---|---|---|---|---|---|---|
| Order | 107 | 638 | 658 | 703 | 658 | 2764 |
| MaterialInward | 108 | 736 | 735 | 754 | 573 | 2906 |
| MaterialIssue | 100 | 627 | 644 | 697 | 555 | 2623 |
| ProductionJob | 1523 | 10181 | 10543 | 11358 | 8837 | 42442 |
| Roll | 248 | 1800 | 1830 | 1943 | 1535 | 7356 |
| QCRecord | 258 | 1916 | 1952 | 2058 | 1629 | 7813 |
| Dispatch | 83 | 640 | 668 | 704 | 551 | 2646 |
| Invoice | 83 | 640 | 668 | 704 | 551 | 2646 |
| Payment | 29 | 720 | 770 | 752 | 637 | 2908 |
| Attendance | 3286 | 19149 | 19183 | 19887 | 15730 | 77235 |

Masters: 8 users, 10 suppliers, 36 buyers, 10 yarns, 72 workers and 17 machines. Suppliers and yarns are a starter set of 10 each; the store adds more from the delivery form.

Invoiced per year: ₹13.46 Cr in 2023, ₹14.78 Cr in 2024, ₹15.30 Cr in 2025 and ₹12.50 Cr in 2026 to 10 Oct. Every month invoices ₹80 L–₹1.7 Cr, with profit after yarn and wages typically 25–45%. Energy, dyes and overheads aren't in the schema, so this is a gross figure.

## Schema notes

No schema changes. Planning is computed on the fly by `/planning/schedule`. Tentative orders, a machine downtime log, an expense table and a delivered date stay out until the backend owner decides otherwise.

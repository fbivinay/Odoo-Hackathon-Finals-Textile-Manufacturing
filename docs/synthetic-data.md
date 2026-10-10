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
- **Warm start.** Simulation begins 1 Oct 2022, so January 2023 opens with yarn in the store and orders on the floor. The two warm-up months exist only as opening work in progress; the dashboard's year picker starts at 2023.
- **Orders.** About 55 a month, with an Aug–Oct festive lift and a mild monsoon dip. Quantities are 500–8,000 m, 12 fabrics and 36 buyers. 18% are rush orders, and about one in twenty waits 5–12 days for a special yarn or shade, which is why about 18% of deliveries run late. The last three weeks add the order book for the next quarter.
- **Production.** 17 machines (4 spinning, 9 weaving, 4 dyeing). One job is one machine for one shift. There is planned maintenance every 45–75 days and occasional breakdowns.
- **Yarn and pricing.** Every Monday the store orders roughly what the floor used over the last four weeks, steered toward the next two weeks of planned issues. Each order arrives as two or three trucks spread over the week, so bills follow consumption. Quotes are made off the yarn price index on the day of the order, so the mid-2024 cotton spike passes through to prices instead of sinking a month.
- **Quality.** About 90% of rolls pass, 6% go to rework and 4% are rejected. Rates are worse in the monsoon, on worse machines and on "bad batch" orders.
- **Money.** Every passed roll ships, and each truck gets an invoice. Buyers pay on 15–60 day terms; some pay late, some in two parts.

## Volume (`data/everest`)

| Model | Nov–Dec 2022 | 2023 | 2024 | 2025 | 2026 (to 10 Oct) | Total |
|---|---|---|---|---|---|---|
| Order | 152 | 615 | 683 | 681 | 646 | 2777 |
| MaterialInward | 159 | 693 | 746 | 722 | 601 | 2921 |
| MaterialIssue | 148 | 602 | 674 | 657 | 568 | 2649 |
| ProductionJob | 2262 | 9535 | 10426 | 10424 | 8841 | 41488 |
| Roll | 383 | 1676 | 1877 | 1882 | 1563 | 7381 |
| QCRecord | 387 | 1770 | 1985 | 1978 | 1661 | 7781 |
| Dispatch | 135 | 616 | 682 | 680 | 559 | 2672 |
| Invoice | 135 | 616 | 682 | 680 | 559 | 2672 |
| Payment | 73 | 675 | 775 | 756 | 634 | 2913 |
| Attendance | 4898 | 18916 | 19714 | 20141 | 15730 | 79399 |

Masters: 8 users, 13 suppliers (10 yarn, 3 for dyes, chemicals and packaging), 10 buyers, 20 materials (10 yarns plus 10 other raw materials: 4 dyes, 4 chemicals, 2 packaging), 72 workers and 17 machines. More are added from the app's forms. Seed is 20230104.

Invoiced per year: ₹10.98 Cr in 2023, ₹11.71 Cr in 2024, ₹14.05 Cr in 2025 and ₹11.27 Cr in 2026 to 10 Oct. Every month makes a profit after yarn and wages, from about 4% in the leanest month to 35–40% in the best; 15–30% is typical. Energy, dyes and overheads aren't in the schema, so this is a gross figure.

Per order, a finished order earns a median of about 25% after yarn and labour (10th–90th percentile 18–33%). A few are thin or slightly negative: bad batches, and deals taken to hold an account. Rush orders carry a 10% premium and the five biggest buyers negotiate harder. Orders not yet started, or cancelled, have no cost yet, so the overview shows them as such instead of a 100% margin.

## Schema notes

No schema changes. Planning is computed on the fly by `/planning/schedule`. Tentative orders, a machine downtime log, an expense table and a delivered date stay out until the backend owner decides otherwise.

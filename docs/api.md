# API Reference

Base URL: `<backend>/api`. Send `Authorization: Bearer <token>` on everything except sign-in and tracking.

Every response is `{ ok: true, data }` or `{ ok: false, error, message }`. Quantities and money are JSON numbers; dates are ISO strings.

## Paging and date filters

These lists accept `?limit=` (max 500) and `?cursor=`, plus `?from=&to=` (`YYYY-MM-DD` or ISO; a date-only `to` includes that day):

| List | `from`/`to` filter on |
|---|---|
| `/orders` | `createdAt` (also `dueFrom`/`dueTo` on `deadline`) |
| `/dispatch` | `dispatchedAt` |
| `/invoices` | `issuedAt` |
| `/qc/rolls` | `createdAt` |
| `/production/jobs` | `startedAt` |
| `/materials/inwards`, `/materials/issues` | `receivedAt`, `issuedAt` |
| `/reports/order-costs` | order `createdAt` |

They answer `{ ok, data: [...], meta: { count, nextCursor } }`. Pass `nextCursor` back as `cursor` for the next page; `null` means the end. Without `limit` the whole list comes back, which is megabytes on the full dataset, so always send one.

"Write" below lists the roles allowed to call it. `OWNER` can call everything. Every signed-in role can read, unless marked.

## Auth and users

| Method | Path | Write | Body / notes |
|---|---|---|---|
| POST | `/auth/signin` | public | `{ email, password }` → `{ token, user }` |
| GET | `/me` | | current user |
| GET | `/users` | OWNER | read is owner-only too |
| POST | `/users` | OWNER | `{ name, email, password, role }` — password is temporary (6+ letters or digits); sets `mustChangePassword` |
| PATCH | `/users/:id` | OWNER | any of `{ name, role, isActive, password, extraTabs }`; a new password forces a change at next sign-in |
| POST | `/auth/change-password` | | `{ newPassword, currentPassword? }` — current one not needed while `mustChangePassword` |

`extraTabs` (also accepted by `POST /users`) is a list of sidebar paths granted to that one person on top of their role: `/materials`, `/raw-materials`, `/orders`, `/production`, `/planning`, `/qc`, `/waste`, `/dispatch`, `/clients`. A tab brings the write access it needs (e.g. `/qc` lets them inspect rolls).

While `mustChangePassword` is true every other endpoint answers 403 `PASSWORD_CHANGE_REQUIRED`; only `/me` and `/auth/change-password` work.

## Suppliers and buyers

| Method | Path | Write | Body / notes |
|---|---|---|---|
| GET | `/suppliers` | | |
| POST | `/suppliers` | STORE | `{ name, phone? }` |
| GET | `/buyers` | | includes `_count.orders` |
| POST | `/buyers` | STORE, DISPATCH | `{ name, phone?, email? }` |

## Raw material (yarn at the gate)

| Method | Path | Write | Body / notes |
|---|---|---|---|
| GET | `/materials` | | each row has `category` and `lowStock`; `?lowStock=true`, `?category=YARN/DYE/CHEMICAL/PACKAGING/OTHER`, `?kind=other` (everything except yarn) |
| POST | `/materials` | STORE | `{ category?, yarnType, colour, unit?, reorderLevel? }`; `category` defaults to `YARN`; for other materials `yarnType` is the name and `colour` the shade, grade or size |
| PATCH | `/materials/:id` | STORE | `{ unit?, reorderLevel? }` |
| GET | `/materials/inwards` | | `?materialId=&orderId=&supplierId=`, plus `?category=` or `?kind=other` |
| POST | `/materials/inwards` | STORE | `{ materialId, supplierId, orderId?, qty, rate }` adds stock, re-averages cost |
| GET | `/materials/issues` | | `?materialId=&orderId=`, plus `?category=` or `?kind=other` |
| POST | `/materials/issues` | STORE | `{ materialId, orderId?, qty }` → 409 `INSUFFICIENT_STOCK` if short; `orderId` is required for yarn and optional for other materials |
| GET | `/materials/purchase-orders` | | `?status=` (PENDING, RECEIVED or CANCELLED), plus `?category=` or `?kind=other` |
| POST | `/materials/purchase-orders` | STORE | `{ lines: [{ materialId, supplierId, qty, rate }] }` creates one PENDING order per line (`PO-00001`…); stock is not touched |
| POST | `/materials/purchase-orders/:id/receive` | STORE | `{ qty?, rate? }` (defaults to what was ordered) marks it RECEIVED and records an inward: adds stock, issues yarn to waiting orders → `issuedTo[]`; 409 `NOT_PENDING` |
| POST | `/materials/purchase-orders/:id/cancel` | STORE | PENDING → CANCELLED; 409 `NOT_PENDING` |

## Orders

Yarn is issued automatically: when an order is created (if the store has it) and when yarn is received (to waiting orders, earliest deadline first, partly if that is all there is). `POST /materials/inwards` returns `issuedTo[]`. `npm run setup` runs the same rule once over the loaded data.

| Method | Path | Write | Body / notes |
|---|---|---|---|
| GET | `/orders` | | `?status=&buyerId=&q=&delayed=true` + paging; each row has `isDelayed` |
| POST | `/orders` | STORE, DISPATCH | `{ buyerId, materialId?, fabricType, colour?, qty, yarnRequired?, pricePerUnit?, deadline }` → includes `availability`. When the fabric has Config figures (saved or from history), the server sets `yarnRequired` = qty × yarnPerMetre × (1 + wastage %, plus size/deadline bands), defaults `materialId` to the usual yarn and `pricePerUnit` to the Config price, and stores `yarnPerMetre`, `wastagePct`, `listPrice` on the order |
| GET | `/orders/:id` | | buyer, material, issues (with `material`), jobs, rolls (with `qcRecords`), dispatches (with `invoice.payments`), `availability` |
| PATCH | `/orders/:id/status` | OWNER | `{ status }` manual override, e.g. `CANCELLED` |
| GET | `/track/:token` | public | buyer page; token is `order.trackingToken` |

`availability`: `{ required, issued, inStock, shortBy, enough, unit }`.

Order status moves by itself: `PENDING → SPINNING/WEAVING/DYEING` (running job) `→ QC` (rolls waiting) `→ READY` (enough passed rolls) `→ DISPATCHED`.

## Production floor

| Method | Path | Write | Body / notes |
|---|---|---|---|
| GET | `/machines` | | |
| POST | `/machines` | OWNER | `{ code, name, type }` type = `SPINNING/WEAVING/DYEING` |
| PATCH | `/machines/:id/status` | PRODUCTION | `{ status }` = `IDLE/BREAKDOWN/MAINTENANCE`; stops the running job |
| GET | `/production/board` | | `{ machines[], summary }`; each machine has `currentJob` (with `percent`) and `producedToday` |
| GET | `/production/queue` | | `?stage=SPINNING/WEAVING/DYEING` → orders with work left in that stage: `{ id, orderNo, fabricType, buyer, deadline, status, target, done, remaining, available, running }`; `available` is how much can start now, given what the stage before has made |
| GET | `/production/jobs` | | `?orderId=&machineId=&workerId=&status=&stage=` + paging |
| POST | `/production/jobs` | PRODUCTION | `{ orderId, machineId, workerId?, shift, qtyPlanned }` → 409 `MACHINE_BUSY` unless idle |
| POST | `/production/jobs/:id/progress` | PRODUCTION | `{ qty }` quantity produced since last report; 400 `OVER_PLAN` if it would exceed the job's planned quantity |
| POST | `/production/jobs/:id/complete` | PRODUCTION | frees the machine; on a dyeing job, output not yet rolled is cut into rolls (~1,100 m) and sent to QC, returned as `rollsSent` |
| POST | `/production/jobs/:id/stop` | PRODUCTION | frees the machine |
| POST | `/production/rolls` | PRODUCTION | `{ jobId, qty }` → roll in `PENDING_QC`, linked to order + machine; 400 `OVER_OUTPUT` if rolls would exceed what the job has made |

## Quality check

| Method | Path | Write | Body / notes |
|---|---|---|---|
| GET | `/qc/rolls` | | `?status=PENDING_QC/PASSED/REWORK/REJECTED/DISPATCHED&orderId=&machineId=` |
| GET | `/qc/rolls/:id` | | full trace: order, machine, job, worker, inspections |
| POST | `/qc/rolls/:id/inspect` | QC | `{ result: PASS/REWORK/REJECT, defectType?, notes? }`; `defectType` needed unless PASS |
| GET | `/qc/summary` | | `?from=&to=` → `{ counts, passRate, defectsByType[], defectsByMachine[] }` |

## Dispatch, invoices, payments

| Method | Path | Write | Body / notes |
|---|---|---|---|
| GET | `/dispatch/stock` | | finished rolls on the shelf, grouped by order |
| GET | `/dispatch` | | `?orderId=&buyerId=` + paging; each has `rolls`, `totalQty`, `invoice` |
| GET | `/dispatch/:id` | | |
| POST | `/dispatch` | DISPATCH | `{ orderId, rollIds[], vehicleNo? }` creates the invoice; 409 `ROLLS_NOT_AVAILABLE` on wrong or already-sent rolls |
| GET | `/invoices` | | `?status=UNPAID/PARTIAL/PAID`; each has `paid`, `balance` |
| POST | `/invoices/:id/payments` | DISPATCH | `{ amount, method? }` |

## Workers, attendance, wages

| Method | Path | Write | Body / notes |
|---|---|---|---|
| GET | `/workers` | | |
| POST | `/workers` | OWNER | `{ code, name, shift, dailyWage }` |
| PATCH | `/workers/:id` | OWNER | `{ name?, shift?, dailyWage?, isActive? }` |
| GET | `/attendance` | PRODUCTION | `?date=YYYY-MM-DD` (default today); read needs PRODUCTION too |
| POST | `/attendance` | PRODUCTION | `{ date?, entries: [{ workerId, status }] }` status = `PRESENT/ABSENT/HALF_DAY` |
| GET | `/wages` | OWNER | `?month=YYYY-MM` → `{ rows[], totals: { earned, paid, due } }` |
| POST | `/wages/pay` | OWNER | `{ month? }` pays everything due |

## Owner dashboard and reports

| Method | Path | Write | Body / notes |
|---|---|---|---|
| GET | `/dashboard/summary` | | orders, low stock, machines, QC, finished stock, receivables |
| GET | `/reports/order-costs` | OWNER or Clients access | `?id=&status=&buyerId=` + paging; per order: material, labour, total, cost per unit and per roll, margin |
| GET | `/planning/schedule` | | `?days=90` (1–365) forward plan, see below |
| GET | `/reports/machine-output` | OWNER | `?month=` → per machine total + `daily[]` series |
| GET | `/reports/pnl` | OWNER | `?month=` → bills, wages, invoiced, payments, `profit`, `cashFlow` |

## Planning schedule

`GET /planning/schedule?days=90` plans every open order forward, earliest deadline first, into the free capacity of each stage. Nothing is stored; it is recomputed on each call.

| Field | Meaning |
|---|---|
| `capacity.<STAGE>` | `{ machines, usable, perDay, fullPerDay, returning[] }`; `perDay` = usable machines × their 60-day average output per shift × 3 shifts; `returning` lists down machines and the day they rejoin |
| `summary` | `{ openOrders, onTime, late, unscheduled, waitingForYarn, yarnsShort }` |
| `orders[]` | order fields + `stages[]` (`{ stage, remaining, start, end }`), `yarnToIssue`, `yarnShortBy` (stock is allocated earliest deadline first), `expectedReady`, `lateByDays`, `onTime`, `withinHorizon` |
| `weeklyLoad[]` | per week (Monday `weekStart`): each stage's `{ load, capacity, utilisation }` |
| `yarnNeeds[]` | per yarn: `needed` by open orders, `inStock`, `shortBy`, `orders`, `neededBy` (deadline of the first order that stock can't cover) |

Assumptions: an order short of yarn can't start for 7 days (delivery lead time), Sundays are closed, a broken machine is counted back after 2 days and one under maintenance after 1, one day is added for QC, spinning is planned in kg of yarn and weaving/dyeing in order quantity.

## Config (owner edits, everyone reads)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/config` | | `{ fabrics, rules, settings, materials }`. A fabric with no saved row is filled from the last 365 days of orders (`saved: false`); `history` always carries those figures |
| PUT | `/config/fabrics/:fabricType` | OWNER | `{ materialId?, yarnPerMetre, wastagePct, pricePerMetre }` upsert. Yarn to issue = metres × yarnPerMetre × (1 + wastage %) |
| POST | `/config/rules` | OWNER | `{ kind, below, pricePct, wastagePct }` (kind QUANTITY or DEADLINE); 409 if that band exists |
| PATCH / DELETE | `/config/rules/:id` | OWNER | `{ below?, pricePct?, wastagePct? }` |
| PUT | `/config/settings` | OWNER | `{ qcDays?, rollLength?, shiftHours?, dispatchTolerancePct?, shelfWaitDays? }`; a missing key uses its default (1, 1100, 8, 5, 3) |
| PATCH | `/config/materials/:id` | OWNER | `{ reorderLevel?, supplierId?, leadDays? }` |
| GET | `/config/changes` | OWNER | `?limit=` (max 500), newest first: `what, field, oldValue, newValue, changedBy, changedAt` |

Read by: planning (`qcDays`, each material's `leadDays` when an order is short of yarn), finishing a dyeing job (`rollLength`), order costs (`shiftHours`), the order form (fabrics and rules) and dispatch checks (`dispatchTolerancePct`, `shelfWaitDays`).

## Errors

| Status | `error` |
|---|---|
| 400 | `VALIDATION_ERROR`, `BAD_REQUEST`, `OVER_PLAN`, `OVER_OUTPUT` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT`, `INSUFFICIENT_STOCK`, `MACHINE_BUSY`, `ROLLS_NOT_AVAILABLE` |

## Assistant (AI chat)

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/assistant/chat` | any signed-in | `{ messages: [{ role: 'user'|'assistant', text, images?: [{ mediaType, data }] }] }` → `{ reply, lookups }` |

- The browser keeps the conversation and sends it whole each time; the last message must be the user's.
- Images: base64 without the `data:` prefix, JPEG/PNG/WebP/GIF, at most 3 per message and about 4 MB each. Only the newest message's images are read.
- Read-only. It answers from the same services as the screens, limited to the tabs that person can open (role + additional access); owner-only figures stay with the owner. Anything outside the mill system gets a fixed "ask about the system" reply.
- 15 questions a minute per person. Needs `GEMINI_API_KEY` (free, from aistudio.google.com) in `backend/.env`; without it the endpoint answers 503 `ASSISTANT_OFF`. `AI_MODEL` picks the Gemini model (default `gemini-flash-lite-latest`).
- Call it with `api(path, { method: 'POST', quiet: true, body })` so a chat message does not re-fetch every screen.


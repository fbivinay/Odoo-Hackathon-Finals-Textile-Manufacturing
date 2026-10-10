# Dataset Format (synthetic data import)

Source of truth for fields: `backend/prisma/schema.prisma`. Working example: `backend/data/sample/` (exported from the seed).

## Format

One folder per dataset, one JSON array per model, file named after the model:

```
backend/data/<dataset>/
  User.json  Supplier.json  Buyer.json  RawMaterial.json  Worker.json  Machine.json
  Order.json  MaterialInward.json  MaterialIssue.json  ProductionJob.json  ProductionLog.json
  Dispatch.json  Roll.json  QCRecord.json  Invoice.json  Payment.json  Attendance.json  WagePayment.json
```

- Every row carries its own `id` (any unique string; make them deterministic, e.g. `ord_2024_0153`).
- Relations are plain foreign-key strings (`buyerId`, `orderId`, ...). No nested objects.
- Numbers as JSON numbers, 2 decimals at most. Dates as ISO UTC strings (`2025-03-14T08:30:00.000Z`).
- `Attendance.date` may be `YYYY-MM-DD`. `WagePayment.month` is `YYYY-MM`.
- `User` rows take `password` (plain, hashed on import) instead of `passwordHash`.
- Each dataset is self-contained: import wipes the database and loads only that folder.

```bash
cd backend
npm run data:check  -- data/<dataset>           # validate, no database needed
npm run data:import -- data/<dataset> --reset   # wipe and load
npm run data:export -- data/<dataset>           # dump the current database
```

## Enums

| Enum | Values |
|---|---|
| Role | `OWNER` `STORE` `PRODUCTION` `QC` `DISPATCH` |
| Shift | `MORNING` `EVENING` `NIGHT` |
| Stage | `SPINNING` `WEAVING` `DYEING` |
| OrderStatus | `PENDING` `SPINNING` `WEAVING` `DYEING` `QC` `READY` `DISPATCHED` `CANCELLED` |
| MachineStatus | `IDLE` `RUNNING` `BREAKDOWN` `MAINTENANCE` |
| JobStatus | `RUNNING` `COMPLETED` `STOPPED` |
| RollStatus | `PENDING_QC` `PASSED` `REWORK` `REJECTED` `DISPATCHED` |
| QCResult | `PASS` `REWORK` `REJECT` |
| AttendanceStatus | `PRESENT` `ABSENT` `HALF_DAY` |
| InvoiceStatus | `UNPAID` `PARTIAL` `PAID` |

## Models

`*` required, `?` optional, `=x` default if omitted, `→` foreign key, `U` unique. Listed in import order.

| Model | Fields |
|---|---|
| User | `id*` `name*` `email*`U `password*` `role*` `isActive=true` `createdAt=now` |
| Supplier | `id*` `name*`U `phone?` `createdAt` |
| Buyer | `id*` `name*`U `phone?` `email?` `createdAt` |
| RawMaterial | `id*` `yarnType*` `colour*` (pair U) `unit=kg` `qtyInStock*` `reorderLevel*` `avgCost*` `createdAt` |
| Worker | `id*` `code*`U `name*` `shift*` `dailyWage*` `isActive=true` `createdAt` |
| Machine | `id*` `code*`U `name*` `type*` (Stage) `status=IDLE` `createdAt` |
| Order | `id*` `orderNo*`U `trackingToken*`U `buyerId*`→Buyer `materialId?`→RawMaterial `fabricType*` `colour*` `qty*` `yarnRequired=0` `pricePerUnit=0` `deadline*` `status*` `createdAt*` |
| MaterialInward | `id*` `materialId*`→RawMaterial `supplierId*`→Supplier `orderId?`→Order `receivedById*`→User `qty*` `rate*` `billAmount*` `receivedAt*` |
| MaterialIssue | `id*` `materialId*`→RawMaterial `orderId*`→Order `qty*` `cost*` `issuedAt*` |
| ProductionJob | `id*` `orderId*`→Order `machineId*`→Machine `workerId?`→Worker `stage*` `shift*` `status*` `qtyPlanned*` `qtyProduced*` `startedAt*` `completedAt?` |
| ProductionLog | `id*` `jobId*`→ProductionJob `machineId*`→Machine `qty*` `loggedAt*` |
| Dispatch | `id*` `dispatchNo*`U `orderId*`→Order `buyerId*`→Buyer `vehicleNo?` `dispatchedAt*` |
| Roll | `id*` `rollNo*`U `orderId*`→Order `machineId*`→Machine `jobId?`→ProductionJob `dispatchId?`→Dispatch `qty*` `status*` `createdAt*` |
| QCRecord | `id*` `rollId*`→Roll `inspectorId*`→User `result*` `defectType?` `notes?` `checkedAt*` |
| Invoice | `id*` `invoiceNo*`U `dispatchId*`→Dispatch U `amount*` `status*` `issuedAt*` |
| Payment | `id*` `invoiceId*`→Invoice `amount*` `method?` `paidAt*` |
| Attendance | `id*` `workerId*`→Worker `date*` (pair U) `shift*` `status*` |
| WagePayment | `id*` `workerId*`→Worker `month*` (pair U) `amount*` `paidAt*` |

## Rules the data must keep

`npm run data:check` enforces all of these; import refuses a dataset that breaks one.

| Area | Rule |
|---|---|
| Numbering | `orderNo` `ORD-0001`, `rollNo` `ROLL-0001`, `dispatchNo` `DSP-0001`, `invoiceNo` `INV-0001`: run 1..N with no gaps. New records get count + 1, so a gap causes a clash. |
| Stock | `RawMaterial.qtyInStock` = sum of inwards − sum of issues, never negative. |
| Bills | `MaterialInward.billAmount` = `qty × rate`. |
| Jobs | `stage` = the machine's `type`. `qtyProduced` = sum of its logs. Finished jobs have `completedAt`; running ones do not. |
| Machines | At most one `RUNNING` job per machine, and status is `RUNNING` exactly when it has one. |
| Rolls | Same order and machine as its job. `DISPATCHED` exactly when `dispatchId` is set, under the same order. |
| QC | `PENDING_QC` rolls have no record. Otherwise the latest record matches: `PASSED`/`DISPATCHED`→`PASS`, `REWORK`→`REWORK`, `REJECTED`→`REJECT`. |
| Dispatch | Buyer = the order's buyer. Has at least one roll and exactly one invoice. |
| Invoice | `amount` = dispatched qty × `order.pricePerUnit`. `status` follows payments; no overpayment. |
| Order status | Running job → its stage. Else rolls awaiting QC or rework → `QC`. Else passed rolls on shelf and passed + dispatched ≥ `qty` → `READY`. Else nothing on shelf and dispatched ≥ `qty` → `DISPATCHED`. Else the latest job's stage, or `PENDING`. `CANCELLED` is free. |

Not checked, but worth keeping realistic: `MaterialIssue.cost` ≈ `qty × avgCost` at the time, `defectType` empty on `PASS`, inspectors are `QC` users, receivers are `STORE` users.

## Things that shape the screens

- Reports default to the **current calendar month**, and "produced today" uses today's `ProductionLog` rows. History must run up to the import date or the dashboard looks empty.
- An order is delayed when `deadline` is past and it is not `DISPATCHED`/`CANCELLED`.
- Low stock = `qtyInStock ≤ reorderLevel`.
- Wages are computed from `Attendance` (full day = `dailyWage`, half day = half). `WagePayment` only records what was paid.
- Labour cost per order = worker's `dailyWage` × job hours ÷ 8, so job durations should be a few hours, not days.
- Keep these five logins (password `Password123`): `owner@`, `store@`, `production@`, `qc@`, `dispatch@everest.dev`.
- List endpoints are not paginated yet. Aim for under ~3,000 orders and ~20,000 rolls, or tell the backend owner first.

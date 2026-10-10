# Accounts, store sections and GST

How the money side of Everest works: what is recorded where, the tax rules, and the assumptions
behind the synthetic data. Endpoints are listed in `api.md` (section Accounts).

## Where each amount lives (nothing is stored twice)

| What | Record | Notes |
|---|---|---|
| Supplier bill | `MaterialInward` | One delivery = one bill line: `billNo`, `dueDate`, `batchNo`, taxable `billAmount`, GST fields, `totalAmount`. Stock only goes up through receiving (or a purchase order marked received). |
| Supplier payment | `SupplierPayment` | Against one bill; cannot exceed its balance; duplicate references refused. |
| Sales invoice | `Invoice` | One per dispatch (`dispatchId` unique), so a truck cannot be billed twice. `amount` = taxable value (metres × order price); `totalAmount` = with GST; `dueDate` = buyer credit days. |
| Buyer payment | `Payment` | Against the GST-inclusive total; part payments allowed; over-payment refused. |
| Material used | `MaterialIssue` | At average cost, with `orderId`, `jobId` and `department`. One item per material; use by several departments is on the issue, never a second item. |
| Expense | `Expense` | Logistics and factory utilities only, with voucher number, payee, cost centre, order/dispatch link, status PAID / UNPAID / ACCRUED. Store materials are never booked as expenses. Duplicate entries (same payee, type, amount and day; same reference; a second freight charge on one dispatch) are refused. |
| Payroll | `WagePayment` | Payslip per worker and month: days, basic, allowances, overtime, deductions, gross, net (`amount`). Recomputed from `Attendance` by `backend/src/lib/payroll.js`. |
| Money edits | `AuditLog` | Payments, expense creation and payment, with who and when. |

## Profit and loss (Accounts > Reports)

Accrual basis, all before GST:

- **Revenue** = invoices issued in the period (taxable value).
- **Materials used** = each order's issued materials (yarn, chemicals, packaging) charged when its fabric is invoiced, in proportion to the metres billed, plus store issues not tied to an order. Materials on orders not billed yet are shown as work in progress, not cost.
- **Wages** = payroll gross for the months in the period (the running month is accrued from attendance).
- **Logistics, utilities** = expenses incurred, plus any GST that cannot be claimed back.
- **Maintenance** = maintenance stores issued (oil, grease, spares).
- Purchases are not a P&L line: bought stock is inventory until it is used.

The Overview tab's month figures (`/reports/pnl`) are the simpler bills-based view: material bills, wages, logistics and utilities against invoiced sales.

## GST rules (`backend/src/lib/tax.js`)

Project assumptions, documented and configurable in one file:

- The mill is in **Gujarat**. A Gujarat party is intra-state (CGST + SGST, half each); any other state is IGST. Rates are applied in whole paise.
- **Raw yarn is NIL** by project rule. In reality cotton and man-made yarn are taxable (5% after 22 Sep 2025); change `YARN_RAW` to apply it.
- Rates are chosen by transaction date. The 22 Sep 2025 revision (56th GST Council) is modelled where reported, e.g. starch, corrugated cartons and QC reagents 12% → 5%, coal 5% → 18%. Old bills keep the rate they were raised at.
- Every rule carries a **confidence** flag: HIGH, REPORTED (secondary sources; check the CBIC notification before filing), UNVERIFIED (sources conflict or none found), PROJECT_RULE. Unverified rows are counted on the GST tab.
- Transport by a goods transport agency is 5% under **reverse charge**: the agency's bill carries no tax; the mill owes it and claims it back (shown as RCM).
- Electricity, water, tolls are exempt; fuel and government fees are outside GST; salaries are not a supply.
- No GSTIN, address, signature or seal is stored or printed. Every printed document says it is synthetic demo data and not a tax invoice.

## Store sections

`MaterialCategory`: YARN, WEAVING (sizing agents, loom lubricants, loom cleaners), DYEING (reactive and disperse dyes, wetting agents, detergents, desizing enzyme, hydrogen peroxide, caustic soda, soda ash, salt, sodium sulphate, acetic acid), FINISHING (softener, fixing agent, anti-crease resin), QC (fastness kits, pH strips, sample tags), PACKAGING (tubes, poly wrap, cover bags, barcode labels, straps, cartons), MAINTENANCE (machine oil, grease, belts, bearings, rapier tapes, ring travellers, degreaser). Each item has SKU, sub-category, main department, GST rule and, for spares, `isSpare`.

The migration `20261010160000_accounts` maps the old sections without dropping rows: DYE → DYEING, CHEMICAL → DYEING (softener → FINISHING), OTHER → MAINTENANCE.

## Synthetic data (`backend/prisma/synthetic/accounts.js`)

Runs after the core simulation with its own random seed, so orders, jobs, rolls, QC, dispatches, attendance and machines are byte-for-byte unchanged. It covers 2023-01-01 to 2025-12-31 in full, plus 2026 to the as-of date. Records after the as-of moment are cut. Weekly reorders still on the way show as pending purchase orders.

- **Consumption follows production.** Sizing is used per metre woven. Dye (1–4% of fabric weight by shade depth) and chemicals are used per metre dyed. Finishing agents follow the last dyeing shift, sample tags follow the first QC check, and tubes, covers, labels and wrap follow the rolls on each truck. Maintenance and QC kits are issued monthly.
- **Purchasing.** A weekly review orders about six weeks' use when stock, counting deliveries on the way, falls below about three weeks' use. Stock counts only once the truck arrives, and an urgent delivery covers any use the shelf cannot meet. The validator checks that stock never goes below zero at any moment.
- **Bills and payments.** Bills are paid around their due date (supplier credit days); 1 in 25 is paid late and 1 in 12 in two parts.
- **Logistics.**
  - Own light trucks run to Gujarat and Maharashtra buyers, costing diesel, tolls and trip allowance. Hired trucks cover 8% of those trips.
  - Part-load transport agencies, charged per kg, cover other states.
  - Loading crew is paid per roll. Monthly driver salaries, quarterly vehicle service, and yearly insurance and permits are included.
- **Utilities.** Electricity is worked out from machine hours, water and boiler coal from metres dyed, plus generator diesel for power cuts, sewerage charges and ETP operation. Each is booked to its month of use and billed on the 5th of the next month. The running month is ACCRUED.
- **Invoices.** Fabric carries 5% GST by the buyer's state, and buyer payments settle the GST-inclusive total.
- **Payroll.** Payslips include a ₹40 night-shift allowance. No statutory deductions are modelled.

Records replaced (synthetic data only, regenerated by the same script):

- **The 10 starter non-yarn items** keep their ids and names. Their fixed deliveries (e.g. "2022-12-05 150 kg") are replaced by consumption-driven purchasing, because those items were never consumed before and could not balance once use was modelled.
- **Invoices and payments.** Invoice `amount` is still the taxable value. GST fields were added, and buyer payment amounts now cover the GST total. The payment dates and the split of part payments are unchanged.

Re-running the generator gives identical files. `npm run data:import -- data/everest --merge` only adds rows whose id is missing (re-running adds 0). `--reset` wipes tables and is for local databases only; never run it on Neon.

## Checks

- `npm run data:check -- data/everest`: GST components and totals on every invoice, bill and expense (recomputed from `tax.js`); supplier and buyer payments never above the bill; stock never below zero at any moment; payslips match attendance; no duplicate vouchers; plus the existing production and dispatch rules.
- An end-to-end run against the local API covered:
  - receipts: CGST+SGST from Gujarat, IGST from Maharashtra, NIL yarn;
  - part and over-payment;
  - an issue raising the order's cost;
  - reverse-charge transport;
  - duplicate expense and double dispatch refused;
  - invoice GST by buyer state;
  - P&L revenue = sum of invoices;
  - P&L wages = payroll gross;
  - store users refused on `/accounts`.

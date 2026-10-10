# everest-live — synthetic live-demo scenario (seed syn1)

Starts from `data/everest` (as of 2026-10-10T05:00:00.000Z) and applies the scripted events below, in order.
Every event row is synthetic. Import this folder to show the floor a few hours later.

## Event log

| # | Time (UTC) | Event | Effect |
|---|---|---|---|
| 1 | 2026-10-10T05:20:00.000Z | YARN_DELIVERY | 750 kg Cotton 60s Combed Raw White received at ₹357.51/kg; stock now 775 kg |
| 2 | 2026-10-10T05:40:00.000Z | PRODUCTION_UPDATE | 9 running jobs reported one hour of output |
| 3 | 2026-10-10T06:00:00.000Z | MACHINE_BREAKDOWN | SP-01 broke down; ORD-1742 spinning stopped at 129 kg |
| 4 | 2026-10-10T06:20:00.000Z | QC_INSPECTION | ROLL-4792 PASS, ROLL-4795 PASS, ROLL-4797 REWORK, ROLL-4798 REJECT |
| 5 | 2026-10-10T06:45:00.000Z | MACHINE_RECOVERY | WV-01 repaired; resumed ORD-1701 weaving (225.24 m left) |
| 6 | 2026-10-10T07:00:00.000Z | ROLL_OFF_LINE | ROLL-4800 (97.36 m) from DY-02 for ORD-1699 |
| 7 | 2026-10-10T07:30:00.000Z | QC_INSPECTION | ROLL-4800 PASS |
| 8 | 2026-10-10T08:00:00.000Z | DISPATCH | DSP-1699: 1 rolls (1060 m) of ORD-1692 on GJ-05-SM-0001, invoice raised |
| 9 | 2026-10-10T08:20:00.000Z | PAYMENT | INV-0021 paid in full, ₹157651.4 |
| 10 | 2026-10-10T08:30:00.000Z | SHIFT_HANDOVER | morning shift closed; 6 jobs handed to the evening crew (15 at work) |

| Model | Rows |
|---|---|
| User | 8 |
| Supplier | 16 |
| Buyer | 36 |
| RawMaterial | 12 |
| Worker | 48 |
| Machine | 13 |
| Order | 1766 |
| MaterialInward | 608 |
| MaterialIssue | 1661 |
| ProductionJob | 27891 |
| ProductionLog | 27902 |
| Dispatch | 1699 |
| Roll | 4800 |
| QCRecord | 5126 |
| Invoice | 1699 |
| Payment | 1824 |
| Attendance | 49306 |
| WagePayment | 1920 |

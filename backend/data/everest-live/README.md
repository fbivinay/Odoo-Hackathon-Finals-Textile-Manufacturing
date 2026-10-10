# everest-live — synthetic live-demo scenario (seed syn1)

Starts from `data/everest` (as of 2026-10-10T05:00:00.000Z) and applies the scripted events below, in order.
Every event row is synthetic. Import this folder to show the floor a few hours later.

## Event log

| # | Time (UTC) | Event | Effect |
|---|---|---|---|
| 1 | 2026-10-10T05:20:00.000Z | YARN_DELIVERY | 600 kg Polyester 75D Bright Raw White received at ₹204.17/kg; stock now 620 kg |
| 2 | 2026-10-10T05:40:00.000Z | PRODUCTION_UPDATE | 9 running jobs reported one hour of output |
| 3 | 2026-10-10T06:00:00.000Z | MACHINE_BREAKDOWN | SP-01 broke down; ORD-1735 spinning stopped at 122 kg |
| 4 | 2026-10-10T06:20:00.000Z | QC_INSPECTION | ROLL-4730 PASS, ROLL-4732 PASS |
| 5 | 2026-10-10T06:45:00.000Z | MACHINE_RECOVERY | WV-02 repaired; resumed ORD-1677 weaving (671.91 m left) |
| 6 | 2026-10-10T07:00:00.000Z | ROLL_OFF_LINE | ROLL-4737 (1100 m) from DY-03 for ORD-1682 |
| 7 | 2026-10-10T07:30:00.000Z | QC_INSPECTION | ROLL-4737 PASS |
| 8 | 2026-10-10T08:00:00.000Z | DISPATCH | DSP-1700: 4 rolls (4030 m) of ORD-1669 on GJ-05-SM-0001, invoice raised |
| 9 | 2026-10-10T08:20:00.000Z | PAYMENT | INV-0079 paid in full, ₹81238.4 |
| 10 | 2026-10-10T08:30:00.000Z | SHIFT_HANDOVER | morning shift closed; 9 jobs handed to the evening crew (15 at work) |

| Model | Rows |
|---|---|
| User | 8 |
| Supplier | 16 |
| Buyer | 36 |
| RawMaterial | 12 |
| Worker | 48 |
| Machine | 13 |
| Order | 1766 |
| MaterialInward | 603 |
| MaterialIssue | 1656 |
| ProductionJob | 27651 |
| ProductionLog | 27660 |
| Dispatch | 1700 |
| Roll | 4737 |
| QCRecord | 5052 |
| Invoice | 1700 |
| Payment | 1833 |
| Attendance | 49306 |
| WagePayment | 1920 |

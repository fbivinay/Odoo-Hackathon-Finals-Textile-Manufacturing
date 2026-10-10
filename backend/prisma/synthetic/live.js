// Scripted live-demo events applied on top of the base dataset. Deterministic: each event
// picks its target by a fixed rule (oldest, lowest, first by code), so the same base gives
// the same scenario. Every row it adds has a `sim_` id; history rows are never rewritten,
// only today's open records move forward (running jobs, pending rolls, open invoices).
const { syncOrderStatuses, PER_SHIFT, SHIFT_HOURS, round2, pad } = require('./generate');

const MIN = 60 * 1000;

function applyLiveEvents(data, { asOf }) {
  const T = Date.parse(asOf);
  const events = [];
  const at = (minutes) => new Date(T + minutes * MIN).toISOString();
  const by = (model) => new Map(data[model].map((x) => [x.id, x]));
  const machines = by('Machine');
  const orders = by('Order');
  const seq = {};
  const simId = (kind) => `sim_${kind}_${pad((seq[kind] = (seq[kind] || 0) + 1), 3)}`;
  const log = (minutes, kind, detail) => events.push({ at: at(minutes), kind, detail });
  const running = () => data.ProductionJob.filter((j) => j.status === 'RUNNING').sort((a, b) => machines.get(a.machineId).code.localeCompare(machines.get(b.machineId).code));
  const addLog = (job, qty, when) => {
    if (qty <= 0) return;
    data.ProductionLog.push({ id: simId('log'), jobId: job.id, machineId: job.machineId, qty: round2(qty), loggedAt: when });
    job.qtyProduced = round2(job.qtyProduced + qty);
  };
  const perHour = (job) => PER_SHIFT[job.stage] / SHIFT_HOURS;
  const left = (job) => Math.max(0, job.qtyPlanned - job.qtyProduced);
  const today = asOf.slice(0, 10);
  const onShift = (shift) => {
    const ids = new Set(data.Worker.filter((w) => w.shift === shift && w.isActive).map((w) => w.id));
    return data.Attendance.filter((a) => a.date === today && ids.has(a.workerId) && a.status !== 'ABSENT').map((a) => a.workerId);
  };
  const inspector = data.User.find((u) => u.email === 'qc@everest.dev');
  const storeKeeper = data.User.find((u) => u.email === 'store@everest.dev');

  // 1. Yarn truck at the gate for the material furthest below its reorder level.
  {
    const m = [...data.RawMaterial].sort((a, b) => a.qtyInStock / a.reorderLevel - b.qtyInStock / b.reorderLevel)[0];
    const last = data.MaterialInward.filter((i) => i.materialId === m.id).at(-1);
    const qty = Math.max(500, Math.round((m.reorderLevel * 3) / 50) * 50);
    const rate = round2(last.rate * 1.01);
    m.avgCost = round2((m.qtyInStock * m.avgCost + qty * rate) / (m.qtyInStock + qty));
    m.qtyInStock = round2(m.qtyInStock + qty);
    data.MaterialInward.push({ id: simId('inw'), materialId: m.id, supplierId: last.supplierId, orderId: null, receivedById: storeKeeper.id, qty, rate, billAmount: round2(qty * rate), receivedAt: at(20) });
    log(20, 'YARN_DELIVERY', `${qty} kg ${m.yarnType} ${m.colour} received at ₹${rate}/kg; stock now ${m.qtyInStock} kg`);
  }

  // 2. Hourly output report from every running machine.
  {
    const jobs = running();
    for (const j of jobs) addLog(j, Math.min(left(j), Math.floor(perHour(j))), at(40));
    log(40, 'PRODUCTION_UPDATE', `${jobs.length} running jobs reported one hour of output`);
  }

  // 3. A spinning frame breaks down; its job stops.
  {
    const j = running().find((x) => x.stage === 'SPINNING');
    if (j) {
      addLog(j, Math.min(left(j), Math.floor(perHour(j) / 2)), at(60));
      j.status = 'STOPPED';
      j.completedAt = at(60);
      machines.get(j.machineId).status = 'BREAKDOWN';
      log(60, 'MACHINE_BREAKDOWN', `${machines.get(j.machineId).code} broke down; ${orders.get(j.orderId).orderNo} spinning stopped at ${j.qtyProduced} kg`);
    }
  }

  // 4. QC clears the oldest rolls waiting: pass, pass, rework, reject.
  const inspect = (roll, result, defectType, notes, minutes) => {
    data.QCRecord.push({ id: simId('qc'), rollId: roll.id, inspectorId: inspector.id, result, defectType, notes, checkedAt: at(minutes) });
    roll.status = { PASS: 'PASSED', REWORK: 'REWORK', REJECT: 'REJECTED' }[result];
  };
  {
    const waiting = data.Roll.filter((x) => x.status === 'PENDING_QC').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 4);
    const plan = [['PASS', null, null], ['PASS', null, null], ['REWORK', 'Shade variation', 'Re-dye and re-check'], ['REJECT', 'Holes', 'Beyond repair, set aside as seconds']];
    waiting.forEach((x, i) => inspect(x, ...plan[i], 80 + i * 5));
    log(80, 'QC_INSPECTION', waiting.map((x, i) => `${x.rollNo} ${plan[i][0]}`).join(', ') || 'no rolls waiting');
  }

  // 5. This morning's broken loom is repaired and picks its order back up.
  {
    const loom = data.Machine.filter((m) => m.type === 'WEAVING' && m.status === 'BREAKDOWN').sort((a, b) => a.code.localeCompare(b.code))[0];
    const stopped = loom && data.ProductionJob.filter((j) => j.machineId === loom.id && j.status === 'STOPPED').sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
    if (loom && stopped) {
      const remaining = round2(stopped.qtyPlanned - stopped.qtyProduced);
      if (remaining > 0) {
        data.ProductionJob.push({
          id: simId('job'), orderId: stopped.orderId, machineId: loom.id, workerId: onShift('MORNING')[0] || stopped.workerId, stage: 'WEAVING', shift: 'MORNING',
          status: 'RUNNING', qtyPlanned: remaining, qtyProduced: 0, startedAt: at(105), completedAt: null,
        });
        loom.status = 'RUNNING';
      } else loom.status = 'IDLE';
      log(105, 'MACHINE_RECOVERY', `${loom.code} repaired; resumed ${orders.get(stopped.orderId).orderNo} weaving (${remaining} m left)`);
    }
  }

  // 6–7. A roll comes off the running dyeing line and passes QC.
  {
    const j = running().find((x) => x.stage === 'DYEING');
    if (j) {
      const qty = Math.min(left(j), 1100);
      if (qty > 0) {
        addLog(j, qty, at(120));
        const roll = { id: simId('rol'), rollNo: `ROLL-${pad(data.Roll.length + 1)}`, orderId: j.orderId, machineId: j.machineId, jobId: j.id, dispatchId: null, qty: round2(qty), status: 'PENDING_QC', createdAt: at(120) };
        data.Roll.push(roll);
        log(120, 'ROLL_OFF_LINE', `${roll.rollNo} (${roll.qty} m) from ${machines.get(j.machineId).code} for ${orders.get(j.orderId).orderNo}`);
        inspect(roll, 'PASS', null, null, 150);
        log(150, 'QC_INSPECTION', `${roll.rollNo} PASS`);
      }
    }
  }
  syncOrderStatuses(data);

  // 8. The ready order with the earliest deadline is loaded and invoiced.
  {
    const o = data.Order.filter((x) => x.status === 'READY').sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
    if (o) {
      const rolls = data.Roll.filter((x) => x.orderId === o.id && x.status === 'PASSED');
      const n = data.Dispatch.length + 1;
      const d = { id: simId('dsp'), dispatchNo: `DSP-${pad(n)}`, orderId: o.id, buyerId: o.buyerId, vehicleNo: 'GJ-05-SM-0001', dispatchedAt: at(180) };
      data.Dispatch.push(d);
      for (const x of rolls) Object.assign(x, { status: 'DISPATCHED', dispatchId: d.id });
      const qty = rolls.reduce((t, x) => t + x.qty, 0);
      data.Invoice.push({ id: simId('inv'), invoiceNo: `INV-${pad(data.Invoice.length + 1)}`, dispatchId: d.id, amount: round2(qty * o.pricePerUnit), status: 'UNPAID', issuedAt: at(180) });
      log(180, 'DISPATCH', `${d.dispatchNo}: ${rolls.length} rolls (${round2(qty)} m) of ${o.orderNo} on ${d.vehicleNo}, invoice raised`);
    }
  }

  // 9. The oldest unpaid invoice is settled.
  {
    const inv = data.Invoice.filter((i) => i.status === 'UNPAID').sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))[0];
    if (inv) {
      data.Payment.push({ id: simId('pay'), invoiceId: inv.id, amount: inv.amount, method: 'NEFT', paidAt: at(200) });
      inv.status = 'PAID';
      log(200, 'PAYMENT', `${inv.invoiceNo} paid in full, ₹${inv.amount}`);
    }
  }

  // 10. 14:00 IST shift handover: morning jobs close, evening crew takes over the same machines.
  {
    const evening = data.Worker.filter((w) => w.shift === 'EVENING' && w.isActive);
    for (const w of evening) data.Attendance.push({ id: simId('att'), workerId: w.id, date: today, shift: 'EVENING', status: 'PRESENT' });
    const crew = onShift('EVENING');
    let handed = 0;
    for (const [i, j] of running().entries()) {
      const shiftEnd = Date.parse(at(210));
      const hoursLeft = Math.max(0, (shiftEnd - Date.parse(j.startedAt)) / (60 * MIN) - (j.qtyProduced / perHour(j)));
      addLog(j, Math.min(left(j), Math.floor(perHour(j) * hoursLeft)), at(205));
      j.status = 'COMPLETED';
      j.completedAt = at(205);
      const rest = round2(j.qtyPlanned - j.qtyProduced);
      if (rest > 0) {
        data.ProductionJob.push({
          id: simId('job'), orderId: j.orderId, machineId: j.machineId, workerId: crew[i % crew.length], stage: j.stage, shift: 'EVENING',
          status: 'RUNNING', qtyPlanned: rest, qtyProduced: 0, startedAt: at(215), completedAt: null,
        });
        handed += 1;
      } else machines.get(j.machineId).status = 'IDLE';
    }
    log(210, 'SHIFT_HANDOVER', `morning shift closed; ${handed} jobs handed to the evening crew (${crew.length} at work)`);
  }

  syncOrderStatuses(data);
  return { data, events };
}

module.exports = { applyLiveEvents };

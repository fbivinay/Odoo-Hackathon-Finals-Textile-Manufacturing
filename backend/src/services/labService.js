// Everest Lab: what is happening, what to do about it, and what-if simulations.
//
// Every figure comes from the mill's records or from the planner (planningService.plan), which is
// pure: a simulation plans the same snapshot twice, once as it is and once with the changes, in
// memory. Nothing here writes to orders, stock, production, dispatch or accounts; the only writes
// are saved scenarios (LabScenario) and their audit trail.
//
// Money is in rupees, rounded to paise on the way out. Costs the records cannot give (machine
// price, power draw, staff per machine, electricity rate) come from the owner; without them the
// figure is left out and listed as missing, never guessed.

const prisma = require('../lib/prisma');
const { badRequest, notFound } = require('../lib/errors');
const { snapshot, plan } = require('./planningService');
const accounts = require('./accountsService');
const qcService = require('./qcService');
const configService = require('./configService');
const reportService = require('./reportService');
const { STAGES } = require('./productionService');
const { generate } = require('./assistantService');

const DAY = 86400000;
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (day, n) => isoDay(Date.parse(`${day}T00:00:00Z`) + n * DAY);
const STAGE_NAME = { SPINNING: 'Spinning', WEAVING: 'Weaving', DYEING: 'Dyeing' };
const UNIT = { SPINNING: 'kg', WEAVING: 'm', DYEING: 'm' };
const DOWN = ['BREAKDOWN', 'MAINTENANCE'];

// Working days in [from, to) counted from day 0 = snapshot day; Sundays only if the mill works them.
function workingDays(today, from, to, sundays) {
  let n = 0;
  for (let i = from; i < to; i += 1) if (sundays || new Date(`${addDays(today, i)}T00:00:00Z`).getUTCDay() !== 0) n += 1;
  return n;
}
const sundaysIn = (today, days) => workingDays(today, 0, days, true) - workingDays(today, 0, days, false);

// ------------------------------------------------------------------ inputs --

// The last 12 months of the books, per metre shipped: what a metre sells for and what it costs.
async function unitEconomics(today) {
  const p = accounts.period({ from: addDays(today, -365), to: today });
  const [series, shipped, workers] = await Promise.all([
    accounts.monthly(p),
    prisma.roll.aggregate({ where: { dispatch: { dispatchedAt: { gte: p.start, lt: p.end } } }, _sum: { qty: true } }),
    prisma.worker.aggregate({ where: { isActive: true, department: 'Production floor' }, _count: true, _avg: { dailyWage: true } }),
  ]);
  const sum = (k) => series.reduce((t, m) => t + Number(m[k] || 0), 0);
  const metres = Number(shipped._sum.qty || 0);
  const f = { revenue: sum('revenue'), materials: sum('materials'), yarn: sum('yarn'), logistics: sum('logistics'), utilities: sum('utilities'), wages: sum('wages'), metres };
  const per = (k) => (metres ? f[k] / metres : null);
  return {
    from: p.from,
    to: p.to,
    metres: r2(metres),
    pricePerMetre: per('revenue'),
    materialsPerMetre: per('materials'),
    // Dyes, chemicals and packaging per metre; yarn is priced per fabric from its own stock cost.
    otherMaterialsPerMetre: metres ? (f.materials - f.yarn) / metres : null,
    logisticsPerMetre: per('logistics'),
    // What one more metre sold adds before fixed costs (wages, utilities are paid anyway).
    contributionPerMetre: metres ? (f.revenue - f.materials - f.logistics) / metres : null,
    utilitiesPerDay: f.utilities / workingDays(p.from, 0, 365, false),
    workers: workers._count,
    avgDailyWage: Number(workers._avg.dailyWage || 0),
  };
}

// Share of checked rolls rejected over the last 90 days: the base for a QC what-if.
async function rejectRate(today) {
  const { counts } = await qcService.counts({ gte: new Date(`${addDays(today, -90)}T00:00:00Z`) });
  const checked = counts.PASSED + counts.DISPATCHED + counts.REWORK + counts.REJECTED;
  return checked ? counts.REJECTED / checked : 0;
}

// Check a what-if against the data and turn it into the planner's changes.
async function toPlanChanges(snap, changes, baseReject) {
  const out = {};
  const anything = Object.values(changes).some((v) => (Array.isArray(v) ? v.length : v !== undefined && v !== false));
  if (!anything) throw badRequest('Choose at least one change to simulate.');

  if (changes.addMachines?.length) {
    for (const a of changes.addMachines) {
      if (!a.perShift && !snap.stageAverage[a.stage]) throw badRequest(`${STAGE_NAME[a.stage]} has no recent output to copy. Enter the new machine's output per shift.`);
    }
    out.addMachines = changes.addMachines;
  }
  if (changes.breakdowns?.length) {
    for (const b of changes.breakdowns) if (!snap.machines.some((m) => m.id === b.machineId)) throw badRequest('That machine does not exist.');
    out.breakdowns = changes.breakdowns;
  }
  if (changes.sundays) out.sundays = true;
  if (changes.materials?.length) {
    for (const c of changes.materials) {
      const m = snap.materials.find((x) => x.id === c.materialId);
      if (!m) throw badRequest('That material does not exist.');
      // Only yarn is tied to each order's schedule; chemicals and packaging are not planned per order.
      if (m.category !== 'YARN') throw badRequest(`${m.yarnType} is not a yarn. Only yarn shortages move the production plan.`);
      if (m.qtyInStock + c.stockChange < 0) throw badRequest(`${m.yarnType} has only ${r2(m.qtyInStock)} ${m.unit} in stock; it cannot drop by ${Math.abs(c.stockChange)}.`);
    }
    out.materials = changes.materials;
  }
  if (changes.rushOrder) {
    const r = changes.rushOrder;
    if (r.deadline <= snap.today) throw badRequest('The rush order deadline must be after today.');
    const q = await configService.quoteFor(r.fabricType, { qty: r.qty, deadline: r.deadline });
    if (!q) throw badRequest(`"${r.fabricType}" is not a fabric in Mill Setup.`);
    out.rushOrder = { ...r, fabricType: q.spec.fabricType, yarnRequired: q.yarnKg, materialId: q.spec.materialId, pricePerUnit: r.pricePerUnit ?? q.price };
  }
  if (changes.qc) out.workFactor = (1 - baseReject) / (1 - changes.qc.rejectPct / 100);
  return out;
}

// ---------------------------------------------------------------- results --

// Finished metres a day the whole chain can turn out: the slowest stage, spinning in kg turned
// into metres with the open orders' yarn per metre.
function chainPerDay(capacity, yarnPerMetre) {
  const per = (s) => (capacity[s].fullPerDay) / (s === 'SPINNING' ? yarnPerMetre || 1 : 1);
  const rates = STAGES.map((s) => ({ stage: s, perDay: per(s) }));
  const slowest = rates.reduce((a, b) => (b.perDay < a.perDay ? b : a));
  return { perDay: slowest.perDay, bottleneck: slowest.stage, rates };
}

function measure(result, snap, yarnPerMetre) {
  const price = new Map(snap.orders.map((o) => [o.id, Number(o.qty) * o.pricePerUnit]));
  const real = result.orders.filter((o) => o.id !== 'what-if-rush');
  const ready = real.filter((o) => o.expectedReady && o.withinHorizon);
  const late = real.filter((o) => o.lateByDays > 0);
  const util = Object.fromEntries(
    STAGES.map((s) => {
      // Next 4 weeks: beyond that the open orders are done and every stage looks idle.
      const weeks = result.weeklyLoad.slice(0, 4);
      const load = weeks.reduce((t, w) => t + w[s].load, 0);
      const cap = weeks.reduce((t, w) => t + w[s].capacity, 0);
      return [s, { load: r2(load), capacity: r2(cap), utilisation: pct(load, cap) }];
    }),
  );
  const chain = chainPerDay(result.capacity, yarnPerMetre);
  const dayOf = (d) => Math.round((Date.parse(d) - Date.parse(snap.today)) / DAY);
  const planned = real.filter((o) => o.expectedReady).map((o) => dayOf(o.expectedReady));
  return {
    avgDaysToReady: planned.length ? r2(planned.reduce((t, d) => t + d, 0) / planned.length) : null,
    clearBookDays: planned.length ? Math.max(...planned) : null,
    openOrders: real.length,
    onTime: real.filter((o) => o.onTime).length,
    late: late.length,
    // Already past the deadline today: late whatever the scenario does.
    pastDeadline: real.filter((o) => isoDay(o.deadline) < snap.today && o.status !== 'READY').length,
    unscheduled: real.filter((o) => o.expectedReady === null).length,
    avgDaysLate: late.length ? r2(late.reduce((t, o) => t + o.lateByDays, 0) / late.length) : 0,
    readyInHorizon: ready.length,
    metresReady: r2(ready.reduce((t, o) => t + Number(o.qty), 0)),
    valueReady: r2(ready.reduce((t, o) => t + (price.get(o.id) || 0), 0)),
    waitingForYarn: real.filter((o) => o.yarnShortBy > 0).length,
    yarnShortKg: r2(result.yarnNeeds.reduce((t, y) => t + y.shortBy, 0)),
    stages: util,
    chainPerDay: r2(chain.perDay),
    // The stage the open orders are waiting on: most loaded over the next 4 weeks. On a tie the
    // later stage wins, since the last stage an order passes decides when it is ready.
    busiest: STAGES.reduce((a, b) => ((util[b].utilisation ?? 0) >= (util[a].utilisation ?? 0) ? b : a)),
  };
}

const METRICS = [
  ['onTime', 'Open orders finishing on time', 'orders', 'higher'],
  ['late', 'Open orders finishing late', 'orders', 'lower'],
  ['unscheduled', 'Orders that cannot be planned', 'orders', 'lower'],
  ['avgDaysLate', 'Average days late (late orders)', 'days', 'lower'],
  ['avgDaysToReady', 'Average days until an open order is ready', 'days', 'lower'],
  ['clearBookDays', 'Days to finish every open order', 'days', 'lower'],
  ['readyInHorizon', 'Orders ready within the period', 'orders', 'higher'],
  ['metresReady', 'Fabric ready within the period', 'm', 'higher'],
  ['valueReady', 'Order value ready within the period', 'INR', 'higher'],
  ['waitingForYarn', 'Orders waiting for yarn', 'orders', 'lower'],
  ['yarnShortKg', 'Yarn short', 'kg', 'lower'],
  ['chainPerDay', 'Finished fabric the mill can make a day', 'm/day', 'higher'],
];

function compare(base, alt) {
  const rows = METRICS.map(([key, label, unit, better]) => ({ key, label, unit, better, base: base[key], alt: alt[key] }));
  for (const s of STAGES) {
    rows.push({ key: `util_${s}`, label: `${STAGE_NAME[s]} machines busy, next 4 weeks`, unit: '%', better: 'none', base: base.stages[s].utilisation, alt: alt.stages[s].utilisation });
  }
  return rows.map((r) => {
    const change = r.base === null || r.alt === null ? null : r2(r.alt - r.base);
    return {
      ...r,
      change,
      changePct: change !== null && r.base ? r2((change / Math.abs(r.base)) * 100) : null,
      effect: change === null || change === 0 || r.better === 'none' ? 'none' : (change > 0) === (r.better === 'higher') ? 'good' : 'bad',
    };
  });
}

function orderChanges(base, alt) {
  const before = new Map(base.orders.map((o) => [o.id, o]));
  return alt.orders
    .filter((o) => o.id !== 'what-if-rush')
    .map((o) => {
      const b = before.get(o.id);
      const shift = o.expectedReady && b.expectedReady ? Math.round((Date.parse(o.expectedReady) - Date.parse(b.expectedReady)) / DAY) : null;
      return {
        id: o.id, orderNo: o.orderNo, buyer: o.buyer.name, deadline: isoDay(o.deadline), qty: Number(o.qty),
        before: b.expectedReady, after: o.expectedReady, daysEarlier: shift === null ? null : -shift,
        lateBefore: b.lateByDays, lateAfter: o.lateByDays,
      };
    })
    .filter((o) => o.before !== o.after)
    .sort((a, b) => (b.daysEarlier ?? -999) - (a.daysEarlier ?? -999));
}

// Money over the chosen period. One-time spend, recurring costs and revenue are kept apart, and
// revenue that depends on finding new orders is never mixed with money already on the books.
function money({ snap, changes, planChanges, costs, days, econ, base, alt, altResult }) {
  const missing = [];
  const assumptions = [];
  const need = (key, label) => {
    if (costs[key] === undefined) missing.push(label);
    return costs[key];
  };
  const added = changes.addMachines || [];
  const count = added.reduce((t, a) => t + a.count, 0);
  const sundays = Boolean(changes.sundays);

  const oneTime = { machines: null, repair: null };
  const recurring = { power: null, labour: null, maintenance: null, sundayWork: null, logistics: null, extraMaterial: null };
  if (count) {
    const price = need('machineCost', 'Machine price');
    const kw = need('powerKw', 'Power per machine (kW)');
    const tariff = need('tariff', 'Electricity rate (₹/kWh)');
    const staff = need('staffPerShift', 'Staff per machine per shift');
    let machineDays = 0;
    for (const a of added) machineDays += a.count * workingDays(snap.today, a.fromDay || 0, days, sundays);
    if (price !== undefined) oneTime.machines = price * count;
    if (kw !== undefined && tariff !== undefined) recurring.power = kw * 24 * tariff * machineDays;
    if (staff !== undefined) recurring.labour = staff * 3 * econ.avgDailyWage * machineDays;
    if (price !== undefined) recurring.maintenance = (costs.maintenancePctYear / 100) * price * count * (days / 365);
    assumptions.push(`New machines run 3 shifts × 8 h on working days from their start day; power drawn at ${kw ?? '?'} kW all that time.`);
    assumptions.push(`Operators paid the floor's average day wage of ${r2(econ.avgDailyWage)} per shift.`);
    assumptions.push(`Maintenance ${costs.maintenancePctYear}% of machine price a year (your estimate).`);
  }
  if (changes.breakdowns?.length && costs.repairCost !== undefined) oneTime.repair = costs.repairCost;
  if (sundays) {
    const n = sundaysIn(snap.today, days);
    recurring.sundayWork = n * (econ.workers * econ.avgDailyWage * costs.sundayPayMultiplier + econ.utilitiesPerDay);
    assumptions.push(`Sunday working: ${n} Sundays, all ${econ.workers} floor workers at ${costs.sundayPayMultiplier}× day wage, plus a normal day's utilities (${r2(econ.utilitiesPerDay)}).`);
  }
  if (changes.logistics && econ.logisticsPerMetre !== null) {
    recurring.logistics = (changes.logistics.costPerMetreChangePct / 100) * econ.logisticsPerMetre * alt.metresReady;
    assumptions.push(`Logistics: ${r2(econ.logisticsPerMetre)} per metre shipped over the last 12 months, changed by ${changes.logistics.costPerMetreChangePct}%.`);
  }
  if (planChanges.workFactor && econ.materialsPerMetre !== null) {
    recurring.extraMaterial = (planChanges.workFactor - 1) * econ.materialsPerMetre * alt.metresReady;
  }

  // Revenue. A rush order is new money only if it finishes by its deadline inside the period.
  const rush = altResult.orders.find((o) => o.id === 'what-if-rush');
  const rushIn = planChanges.rushOrder;
  const rushOnTime = Boolean(rush && rush.onTime && rush.withinHorizon);
  const rushValue = rushIn ? rushIn.qty * rushIn.pricePerUnit : 0;
  // Its own yarn at stock cost, plus the mill's usual dyes, chemicals, packaging and freight per metre.
  const rushYarnCost = rushIn ? rushIn.yarnRequired * (snap.materials.find((m) => m.id === rushIn.materialId)?.avgCost || 0) : 0;
  const rushContribution = rushIn && econ.otherMaterialsPerMetre !== null ? rushIn.qty * rushIn.pricePerUnit - rushYarnCost - rushIn.qty * (econ.otherMaterialsPerMetre + (econ.logisticsPerMetre || 0)) : null;
  if (rushIn) assumptions.push(`Rush order cost: ${rushIn.yarnRequired} kg of its yarn at stock cost, plus ${r2((econ.otherMaterialsPerMetre || 0) + (econ.logisticsPerMetre || 0))} per metre for dyes, chemicals, packaging and freight (last 12 months).`);

  const workDays = workingDays(snap.today, 0, days, sundays);
  const extraPerDay = Math.max(0, alt.chainPerDay - base.chainPerDay);
  const opportunity = econ.contributionPerMetre !== null && extraPerDay > 0 ? extraPerDay * workDays * econ.contributionPerMetre : 0;

  const sumOf = (o) => Object.values(o).reduce((t, v) => t + (v || 0), 0);
  const oneTimeTotal = sumOf(oneTime);
  const recurringTotal = sumOf(recurring);
  const confirmedProfit = (rushOnTime ? rushContribution || 0 : 0) - recurringTotal;
  const ifSoldProfit = confirmedProfit + opportunity;
  const perMonth = (p) => (p * 30) / days;
  const payback = (p) => (oneTimeTotal > 0 && perMonth(p) > 0 ? r2(oneTimeTotal / perMonth(p)) : null);
  const roi = (p) => (oneTimeTotal > 0 ? r2((p / oneTimeTotal) * 100) : null);
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null ? null : r2(v)]));

  return {
    days,
    complete: missing.length === 0,
    missing,
    basis: { from: econ.from, to: econ.to, metresShipped: econ.metres, contributionPerMetre: econ.contributionPerMetre === null ? null : r2(econ.contributionPerMetre), avgDailyWage: r2(econ.avgDailyWage) },
    oneTime: round(oneTime),
    oneTimeTotal: r2(oneTimeTotal),
    recurring: round(recurring),
    recurringTotal: r2(recurringTotal),
    materialPurchase: r2(
      (changes.materials || []).reduce((t, c) => t + Math.max(0, c.stockChange) * (snap.materials.find((m) => m.id === c.materialId)?.avgCost || 0), 0),
    ),
    revenue: {
      // Same orders, ready sooner or later: timing, not new money.
      pulledIntoPeriod: r2(alt.valueReady - base.valueReady),
      rushOrderValue: rushIn ? r2(rushValue) : null,
      rushOrderOnTime: rushIn ? rushOnTime : null,
      rushContribution: rushContribution === null ? null : r2(rushContribution),
      rushYarnKg: rushIn ? rushIn.yarnRequired : null,
      // Only if new orders are found to fill it.
      spareCapacityMetres: r2(extraPerDay * workDays),
      spareCapacityContribution: r2(opportunity),
    },
    profit: { confirmed: r2(confirmedProfit), ifCapacitySold: r2(ifSoldProfit) },
    paybackMonths: { confirmed: payback(confirmedProfit), ifCapacitySold: payback(ifSoldProfit) },
    roiPct: { confirmed: roi(confirmedProfit), ifCapacitySold: roi(ifSoldProfit) },
    assumptions,
  };
}

async function simulate({ changes, costs = {}, days = 90 }, prepared) {
  const today = isoDay(Date.now());
  const [snap, econ, baseReject] = prepared || (await Promise.all([snapshot(), unitEconomics(today), rejectRate(today)]));
  const planChanges = await toPlanChanges(snap, changes, baseReject);
  const yarnPerMetre = snap.orders.reduce((t, o) => t + Number(o.yarnRequired), 0) / (snap.orders.reduce((t, o) => t + Number(o.qty), 0) || 1);
  const baseResult = plan(snap, {}, days);
  const altResult = plan(snap, planChanges, days);
  const base = measure(baseResult, snap, yarnPerMetre);
  const alt = measure(altResult, snap, yarnPerMetre);

  const limitations = [
    'Plans whole days, three 8-hour shifts, Sundays closed unless Sunday working is chosen. Not minute by minute.',
    'Machine output is each machine\'s average per shift over the last 60 days; a new machine copies its stage\'s average unless you set it.',
    'Trucks and dispatch capacity are not modelled; logistics changes only move cost.',
    'Breakdown history is not recorded, so how often machines fail is not predicted.',
    'Chemicals and packaging are not planned per order; only yarn shortages move dates.',
  ];
  if (changes.qc) limitations.push(`Reject what-if: today's reject rate (last 90 days) is ${r2(baseReject * 100)}%; every stage makes extra to cover the change.`);
  const rush = altResult.orders.find((o) => o.id === 'what-if-rush');

  return {
    snapshotAt: snap.takenAt,
    today: snap.today,
    days,
    changes,
    costs,
    metrics: compare(base, alt),
    baseline: base,
    scenario: alt,
    capacity: {
      base: Object.fromEntries(STAGES.map((s) => [s, { perDay: baseResult.capacity[s].fullPerDay, unit: UNIT[s], machines: baseResult.capacity[s].machines }])),
      scenario: Object.fromEntries(STAGES.map((s) => [s, { perDay: altResult.capacity[s].fullPerDay, unit: UNIT[s], machines: altResult.capacity[s].machines + (altResult.capacity[s].added?.length || 0), added: altResult.capacity[s].added || [] }])),
      chain: { base: chainPerDay(baseResult.capacity, yarnPerMetre), scenario: chainPerDay(altResult.capacity, yarnPerMetre) },
    },
    weekly: baseResult.weeklyLoad.map((w, i) => ({
      weekStart: w.weekStart,
      ...Object.fromEntries(STAGES.flatMap((s) => [[`${s}_base`, w[s].utilisation], [`${s}_alt`, altResult.weeklyLoad[i]?.[s].utilisation ?? null]])),
    })),
    orders: orderChanges(baseResult, altResult),
    rushOrder: rush ? { expectedReady: rush.expectedReady, lateByDays: rush.lateByDays, onTime: rush.onTime, deadline: changes.rushOrder.deadline, qty: changes.rushOrder.qty } : null,
    yarn: { base: baseResult.yarnNeeds.filter((y) => y.shortBy > 0), scenario: altResult.yarnNeeds.filter((y) => y.shortBy > 0) },
    money: money({ snap, changes, planChanges, costs, days, econ, base, alt, altResult }),
    limitations,
  };
}

// ----------------------------------------------------------- intelligence --

function periodOf(query) {
  // Mill days are IST, as in Accounts; `to` defaults to today there.
  const p = accounts.period({ from: query.from || addDays(accounts.todayIst(), -89), to: query.to });
  const length = Math.round((Date.parse(p.to) - Date.parse(p.from)) / DAY) + 1;
  const prev = accounts.period({ from: addDays(p.from, -length), to: addDays(p.from, -1) });
  return { p, prev, length };
}

async function producedByStage(p) {
  const [rows, machines] = await Promise.all([
    prisma.productionLog.groupBy({ by: ['machineId'], where: { loggedAt: { gte: p.start, lt: p.end } }, _sum: { qty: true } }),
    prisma.machine.findMany({ select: { id: true, type: true } }),
  ]);
  const type = new Map(machines.map((m) => [m.id, m.type]));
  const out = { SPINNING: 0, WEAVING: 0, DYEING: 0 };
  for (const r of rows) out[type.get(r.machineId)] += Number(r._sum.qty || 0);
  return out;
}

async function deliveries(p) {
  const rows = await prisma.$queryRaw`
    SELECT o.id, o.deadline, MAX(d."dispatchedAt") AS last
    FROM "Order" o JOIN "Dispatch" d ON d."orderId" = o.id
    WHERE o.status = 'DISPATCHED'
    GROUP BY o.id, o.deadline
    HAVING MAX(d."dispatchedAt") >= ${p.start} AND MAX(d."dispatchedAt") < ${p.end}`;
  const onTime = rows.filter((r) => isoDay(r.last) <= isoDay(r.deadline)).length;
  return { count: rows.length, onTime, pct: pct(onTime, rows.length) };
}

async function storeCostPerMetre(p, dyed) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(SUM(i.cost), 0)::float AS cost
    FROM "MaterialIssue" i JOIN "RawMaterial" m ON m.id = i."materialId"
    WHERE m.category IN ('DYEING', 'FINISHING') AND i."issuedAt" >= ${p.start} AND i."issuedAt" < ${p.end}`;
  return dyed ? rows[0].cost / dyed : null;
}

async function shippedMetres(p) {
  const r = await prisma.roll.aggregate({ where: { dispatch: { dispatchedAt: { gte: p.start, lt: p.end } } }, _sum: { qty: true } });
  return Number(r._sum.qty || 0);
}

const metric = (key, label, value, extra = {}) => ({ key, label, value: value === undefined ? null : value, ...extra });
// Rupees the way the mill reads them in a note: crore and lakh above a lakh.
const short = (n) => {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(1)} L`;
  return `${sign}₹${Math.round(a).toLocaleString('en-IN')}`;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function intelligence(query = {}) {
  const { p, prev, length } = periodOf(query);
  const today = isoDay(Date.now());
  const [snap, overview, prevSeries, qc, qcPrev, made, madePrev, sent, shipped, shippedPrev, stock, onOrder, lastLog, costs, econ, baseReject] = await Promise.all([
    snapshot(),
    accounts.overview({ from: p.from, to: p.to }),
    accounts.monthly(prev),
    qcService.summary({ from: p.from, to: p.to }),
    qcService.counts({ gte: prev.start, lt: prev.end }),
    producedByStage(p),
    producedByStage(prev),
    deliveries(p),
    shippedMetres(p),
    shippedMetres(prev),
    prisma.rawMaterial.findMany({ select: { id: true, category: true, qtyInStock: true, reorderLevel: true } }),
    prisma.purchaseOrder.groupBy({ by: ['materialId'], where: { status: 'PENDING' }, _sum: { qty: true } }),
    prisma.productionLog.findFirst({ orderBy: { loggedAt: 'desc' }, select: { loggedAt: true } }),
    reportService.orderCosts({ from: p.from, to: p.to }),
    unitEconomics(today),
    rejectRate(today),
  ]);
  const base = plan(snap, {}, 90);
  const [chemNow, chemPrev] = await Promise.all([storeCostPerMetre(p, made.DYEING), storeCostPerMetre(prev, madePrev.DYEING)]);
  const prevTotal = (k) => prevSeries.reduce((t, m) => t + Number(m[k] || 0), 0);
  const overdue = snap.orders.filter((o) => isoDay(o.deadline) < today && o.status !== 'READY');
  const next4 = base.weeklyLoad.slice(0, 4);
  const util = Object.fromEntries(STAGES.map((s) => [s, pct(next4.reduce((t, w) => t + w[s].load, 0), next4.reduce((t, w) => t + w[s].capacity, 0))]));
  const down = snap.machines.filter((m) => DOWN.includes(m.status));
  const checked = (c) => c.PASSED + c.DISPATCHED + c.REWORK + c.REJECTED;
  const pnl = overview.pnl;

  // What has to be bought now, by the Yarn and Raw Materials pages' rule: what the open orders still
  // need plus a refill to the warning level, less stock and what is already on order.
  const neededOf = new Map(base.yarnNeeds.map((y) => [y.id, y.needed]));
  const onOrderOf = new Map(onOrder.map((o) => [o.materialId, Number(o._sum.qty || 0)]));
  const gap = (m) => (neededOf.get(m.id) || 0) + Number(m.reorderLevel) - Number(m.qtyInStock);
  const toBuy = stock.filter((m) => gap(m) - (onOrderOf.get(m.id) || 0) > 0);
  const buyOf = new Map(toBuy.map((m) => [m.id, { qty: Math.ceil((gap(m) - (onOrderOf.get(m.id) || 0)) / 10) * 10, reserve: Number(m.reorderLevel) }]));
  const coming = stock.filter((m) => gap(m) > 0).length - toBuy.length;
  const yarnToBuy = toBuy.filter((m) => m.category === 'YARN').length;

  // The four figures the owner reads first; everything else is one click away in its own section.
  // Every open order past its deadline is also planned late, so `overdue` is part of `atRisk`.
  const atRisk = base.summary.late + base.summary.unscheduled;
  const summary = [
    metric('openOrders', 'Open orders', snap.orders.length, {
      unit: 'orders',
      note: !atRisk
        ? 'All planned to finish on time'
        : overdue.length === atRisk
          ? `${plural(atRisk, 'order')} already past the deadline`
          : `${plural(atRisk, 'order')} will finish late${overdue.length ? `, ${overdue.length} already past the deadline` : ''}`,
      tone: undefined, // plain black: a count, not a warning
      link: '/orders',
    }),
    metric('onTime', 'On-time delivery', sent.pct, {
      unit: '%',
      note: sent.count ? `${sent.onTime} of ${plural(sent.count, 'order')} delivered on time, last ${length} days` : `No order fully dispatched in the last ${length} days`,
      tone: sent.pct === null ? undefined : sent.pct >= 90 ? 'good' : sent.pct >= 75 ? 'watch' : 'problem',
      link: '/orders',
    }),
    metric('netProfit', 'Net profit', pnl.netProfit, {
      unit: '₹',
      note: `Last ${length} days · revenue ${short(pnl.revenue)} · costs ${short(pnl.expenses)}`,
      tone: pnl.netProfit < 0 ? 'problem' : 'good',
      link: '/accounts',
    }),
    metric('shortages', 'Material shortages', toBuy.length, {
      unit: 'items',
      note: `${plural(yarnToBuy, 'yarn')}, ${plural(toBuy.length - yarnToBuy, 'store item')} to order${coming ? ` · ${coming} more already on order` : ''}`,
      tone: toBuy.length ? 'problem' : 'good',
      link: yarnToBuy ? '/materials' : '/raw-materials',
    }),
  ];

  const recommendations = await recommend({
    snap, base, util, down, overdue, qc, qcPrev, checked, costs: costs.data, chemNow, chemPrev, buyOf,
    logisticsNow: shipped ? pnl.logistics / shipped : null, logisticsPrev: shippedPrev ? prevTotal('logistics') / shippedPrev : null,
    overview, econ, baseReject, dyed: made.DYEING, wagesPerMonth: pnl.wages / (length / 30),
  });

  return {
    period: { from: p.from, to: p.to, days: length, previous: { from: prev.from, to: prev.to } },
    freshness: { snapshotAt: snap.takenAt, lastProductionLog: lastLog?.loggedAt ?? null, planHorizonDays: 90 },
    summary,
    recommendations,
  };
}

// ------------------------------------------------------- recommendations --

const fmt = (n, unit = '') => `${r2(n).toLocaleString('en-IN')}${unit ? ` ${unit}` : ''}`;
const clampPct = (n) => Math.round(Math.max(30, Math.min(95, n)));
const rupees = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

// Run a recommendation's what-if (no costs) so its benefit is a computed figure, not a claim.
// What a simulation changes, in plain words, starting lower case: when every open order is done,
// how much sooner or later each one is ready, and late orders only when that count moves.
function gain(m, sooner) {
  const book = m.clearBookDays;
  const parts = [
    book.base !== null && book.alt !== null && book.alt !== book.base ? `all open orders done in ${book.alt} days instead of ${book.base}` : null,
    Math.abs(sooner) >= 0.5 ? `each order ready about ${Math.round(Math.abs(sooner) * 10) / 10} days ${sooner > 0 ? 'sooner' : 'later'}` : null,
    m.late.alt !== m.late.base ? `late orders ${m.late.base} → ${m.late.alt}` : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join('; ')}.` : 'no order date changes.';
}
const upper = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const shortGain = (pv) => (pv.book[0] !== null && pv.book[1] !== null && pv.book[0] !== pv.book[1]
  ? `All orders done ${plural(Math.abs(pv.book[0] - pv.book[1]), 'day')} ${pv.book[1] < pv.book[0] ? 'sooner' : 'later'}.`
  : `${plural(pv.ordersChanged, 'order')} get a new date.`);
const dayMonth = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

async function preview(changes, prepared) {
  const r = await simulate({ changes, costs: {}, days: 90 }, prepared);
  const m = Object.fromEntries(r.metrics.map((x) => [x.key, x]));
  const sooner = r2(m.avgDaysToReady.base - m.avgDaysToReady.alt);
  return {
    improves: m.late.alt < m.late.base || m.unscheduled.alt < m.unscheduled.base || sooner >= 0.5,
    sooner,
    late: [m.late.base, m.late.alt],
    unscheduled: [m.unscheduled.base, m.unscheduled.alt],
    metresReady: [m.metresReady.base, m.metresReady.alt],
    valueReady: [m.valueReady.base, m.valueReady.alt],
    ordersChanged: r.orders.length,
    text: gain(m, sooner),
    book: [m.clearBookDays.base, m.clearBookDays.alt],
  };
}

async function recommend(ctx) {
  const { snap, base, util, down, overdue, qc, qcPrev, checked, costs, chemNow, chemPrev, logisticsNow, logisticsPrev, overview, econ, baseReject, buyOf, wagesPerMonth } = ctx;
  const prepared = [snap, econ, baseReject];
  const out = [];
  const lateOrders = base.orders.filter((o) => o.lateByDays > 0 || o.expectedReady === null);

  // 1. Capacity at a verified bottleneck.
  const weeks = base.weeklyLoad.slice(0, 8);
  for (const s of STAGES) {
    const busy = weeks.filter((w) => w[s].utilisation >= 90).length;
    const top = Math.max(...STAGES.map((x) => util[x] ?? 0)) === (util[s] ?? 0);
    if (busy < Math.ceil(weeks.length / 2) && !(top && (util[s] ?? 0) >= 90)) continue;
    const changes = { addMachines: [{ stage: s, count: 1 }] };
    const pv = await preview(changes, prepared);
    // Busy is not enough: only a stage where one more machine actually moves orders is a bottleneck.
    if (!pv.improves) continue;
    out.push({
      id: `capacity-${s}`,
      kind: 'capacity',
      title: `Evaluate adding one ${STAGE_NAME[s].toLowerCase()} machine`,
      problem: `${STAGE_NAME[s]} is ${util[s]}% busy for the next 4 weeks; orders wait here.`,
      evidence: [
        { label: `${STAGE_NAME[s]} machines busy, next 4 weeks`, value: `${util[s]}%`, link: '/production' },
        { label: `${STAGE_NAME[s]} machines`, value: `${snap.machines.filter((m) => m.type === s).length} (avg ${fmt(snap.stageAverage[s], UNIT[s])}/day each)`, link: '/production' },
        { label: 'Open orders planned late or unplannable', value: `${lateOrders.length}`, link: '/orders' },
        { label: 'Simulated with one more machine', value: `${pv.ordersChanged} orders get an earlier date`, link: null },
      ],
      action: `Price one more ${STAGE_NAME[s].toLowerCase()} machine and test it in the scenario.`,
      benefit: shortGain(pv),
      costAndRisk: 'Machine price and staff not known yet; the next stage may slow down.',
      confidencePct: clampPct(55 + busy * 3 + Math.min(20, pv.sooner * 4) + (pv.late[1] < pv.late[0] ? 10 : 0)),
      assumptions: ['New machine copies the stage average output.', 'Demand stays as the current open orders.'],
      limitations: ['Machine price, power and staffing are not in the records.'],
      preview: pv,
      scenario: { name: `Add 1 ${STAGE_NAME[s].toLowerCase()} machine`, changes },
    });
  }

  // 2. Machines down.
  for (const m of down) {
    const changes = { breakdowns: [{ machineId: m.id, days: 14 }] };
    const pv = await preview(changes, prepared);
    const stageTotal = snap.machines.filter((x) => x.type === m.type).reduce((t, x) => t + x.perDay, 0);
    out.push({
      id: `down-${m.code}`,
      kind: 'machine',
      title: `Get ${m.code} back running`,
      problem: `${m.code} is in ${m.status === 'BREAKDOWN' ? 'breakdown' : 'maintenance'}; it makes ${Math.round((m.perDay / (stageTotal || 1)) * 100)}% of ${STAGE_NAME[m.type].toLowerCase()} output.`,
      evidence: [
        { label: 'Status', value: m.status === 'BREAKDOWN' ? 'Breakdown' : 'Maintenance', link: '/production' },
        { label: 'Its usual output', value: `${fmt(m.perDay, UNIT[m.type])}/day`, link: '/production' },
      ],
      action: 'Confirm the repair date; move its jobs to the other machines.',
      benefit: `If it stays down two weeks: ${shortGain(pv).toLowerCase()}`,
      costAndRisk: 'Repair cost not known; no breakdown history to predict repeats.',
      confidencePct: pv.sooner < 0 || pv.late[1] > pv.late[0] ? clampPct(65 + Math.min(20, -pv.sooner * 5)) : 35, // only worth chasing if its absence would hurt
      assumptions: ['Other machines keep their recent output.'],
      limitations: ['No breakdown history.'],
      preview: pv,
      scenario: { name: `${m.code} down for 14 days`, changes },
    });
  }

  // 3. Slow machines: 30% or more below their stage's average over 60 days.
  const slow = snap.machines.filter((m) => snap.stageAverage[m.type] && m.perDay < 0.7 * snap.stageAverage[m.type]);
  if (slow.length) {
    const worst = [...slow].sort((a, b) => a.perDay / snap.stageAverage[a.type] - b.perDay / snap.stageAverage[b.type])[0];
    out.push({
      id: 'slow-machines',
      kind: 'machine',
      title: `Check ${slow.length} slow machine${slow.length > 1 ? 's' : ''}`,
      problem: `${slow.slice(0, 3).map((m) => m.code).join(', ')}${slow.length > 3 ? ` +${slow.length - 3}` : ''} make 30% less than similar machines.`,
      evidence: slow.map((m) => ({ label: m.code, value: `${fmt(m.perDay, UNIT[m.type])}/day vs stage ${fmt(snap.stageAverage[m.type], UNIT[m.type])}`, link: '/production' })),
      action: `Check settings and upkeep, starting with ${worst.code}.`,
      benefit: 'More output without buying anything.',
      costAndRisk: 'Only maintenance time; the fabric they ran may be the cause.',
      confidencePct: 45,
      assumptions: ['Average output per completed job reflects machine speed.'],
      limitations: ['Job mix differs between machines.'],
      preview: null,
      scenario: null,
    });
  }

  // 4. Late orders: try Sunday working. Orders already past their deadline are planned late too,
  // so they are part of lateOrders, not extra to it.
  if (lateOrders.length) {
    const changes = { sundays: true };
    const pv = await preview(changes, prepared);
    out.push({
      id: 'late-orders',
      kind: 'delivery',
      title: `Protect ${plural(lateOrders.length, 'order')} at risk`,
      problem: `${plural(lateOrders.length, 'order')} will miss the deadline${overdue.length ? ` (${overdue.length} already overdue)` : ''}.`,
      evidence: lateOrders.slice(0, 6).map((o) => ({ label: o.orderNo, value: o.lateByDays ? `planned ${o.lateByDays} days late` : 'cannot be planned yet', link: `/orders/${o.id}` })),
      action: `Run ${lateOrders.length > 1 ? 'them' : 'it'} first and tell the ${lateOrders.length > 1 ? 'buyers' : 'buyer'} the new date today.`,
      benefit: pv.late[1] < pv.late[0] ? `Sunday working cuts late orders to ${pv.late[1]}.` : 'Buyers hear early and keep trusting the mill.',
      costAndRisk: `About ${rupees(econ.workers * econ.avgDailyWage + econ.utilitiesPerDay)} per Sunday if the floor works it.`,
      confidencePct: pv.improves ? clampPct(55 + Math.min(20, pv.sooner * 4) + (pv.late[1] < pv.late[0] ? 15 : 0)) : 40,
      assumptions: ['All floor workers work Sundays at their day wage.'],
      limitations: ['Overtime premiums are not in the records; set the multiplier in the scenario.'],
      preview: pv,
      scenario: null,
    });
  }

  // 5. Yarn short for planned orders and not already on order. The amount is the Yarn page's:
  // what the orders need plus a refill to the warning level, less stock and what is on its way.
  const yarnShort = base.yarnNeeds.filter((y) => y.shortBy > 0 && buyOf.has(y.id));
  for (const y of yarnShort.slice(0, 3)) {
    const lead = snap.materials.find((m) => m.id === y.id)?.leadDays ?? 7;
    const { qty, reserve } = buyOf.get(y.id);
    const changes = { materials: [{ materialId: y.id, stockChange: qty, extraLeadDays: 0 }] };
    const pv = await preview(changes, prepared);
    out.push({
      id: `yarn-${y.id}`,
      kind: 'material',
      title: `Order ${fmt(qty, y.unit)} of ${y.yarnType} now`,
      problem: `${plural(y.orders, 'order')} need ${fmt(Math.ceil(y.needed), y.unit)} of ${y.yarnType}; ${y.inStock > 0 ? `only ${fmt(y.inStock, y.unit)}` : 'none'} in stock.`,
      evidence: [
        { label: 'Short by', value: fmt(y.shortBy, y.unit), link: '/materials' },
        { label: 'First needed by', value: y.neededBy ? isoDay(y.neededBy) : '—', link: '/materials' },
        { label: 'Supplier delivery time', value: `${lead} days`, link: '/materials' },
      ],
      action: `Order ${fmt(qty, y.unit)} today; delivery takes ${plural(lead, 'day')}.`,
      benefit: pv.improves ? shortGain(pv) : 'These orders start on time.',
      costAndRisk: `About ${rupees(qty * (snap.materials.find((m) => m.id === y.id)?.avgCost || 0))} of stock; a late delivery still holds them up.`,
      // Short but not yet holding anything up: still worth ordering, less urgent.
      confidencePct: pv.improves ? 90 : 70,
      assumptions: ['Stock is handed to orders earliest deadline first.'],
      limitations: [],
      preview: pv,
      scenario: { name: `${y.yarnType} topped up`, changes },
    });
  }

  // 6. QC rejects higher than the previous period.
  const rejNow = pct(qc.counts.REJECTED + qc.counts.REWORK, checked(qc.counts));
  const rejPrev = pct(qcPrev.counts.REJECTED + qcPrev.counts.REWORK, checked(qcPrev.counts));
  if (rejNow !== null && rejPrev !== null && rejNow > rejPrev + 1) {
    const top = [...qc.defectsByType].sort((a, b) => b.count - a.count)[0];
    const topMachine = [...qc.defectsByMachine].sort((a, b) => b.count - a.count)[0];
    out.push({
      id: 'qc-rejects',
      kind: 'quality',
      title: `Tackle ${top?.defectType?.toLowerCase() || 'rising defects'}`,
      problem: `${rejNow}% of rolls failed QC, up from ${rejPrev}%${top ? `; mostly ${top.defectType.toLowerCase()}` : ''}.`,
      evidence: [
        top && { label: 'Most common defect', value: `${top.defectType} (${top.count})`, link: '/waste' },
        topMachine && { label: 'Machine with most defects', value: `${topMachine.code} (${topMachine.count})`, link: '/waste' },
      ].filter(Boolean),
      action: `Find the cause${topMachine ? ` on ${topMachine.code}` : ''}${top ? `, starting with ${top.defectType.toLowerCase()}` : ''}.`,
      benefit: 'Fewer rejects means less fabric made twice.',
      costAndRisk: 'Only inspection time; the yarn may be the cause.',
      confidencePct: clampPct(60 + (rejNow - rejPrev) * 5),
      assumptions: [],
      limitations: ['Defects are counted per roll, not per metre.'],
      preview: null,
      scenario: null,
    });
  }

  // 7. Orders losing money.
  const losing = (costs || []).filter((o) => o.margin < 0 && o.totalCost > 0);
  if (losing.length) {
    const lost = -losing.reduce((t, o) => t + o.margin, 0);
    const worst = [...losing].sort((a, b) => a.margin - b.margin)[0];
    out.push({
      id: 'margins',
      kind: 'money',
      title: `Review ${plural(losing.length, 'loss-making order')}`,
      problem: `${plural(losing.length, 'order')} lost ${rupees(lost)}; worst is ${worst.orderNo} (${worst.fabricType}).`,
      evidence: losing.sort((a, b) => a.margin - b.margin).slice(0, 6).map((o) => ({ label: o.orderNo, value: `margin ${rupees(o.margin)}`, link: `/orders/${o.id}` })),
      action: `Check the price and material use, starting with ${worst.orderNo}.`,
      benefit: `Stops a ${rupees(lost)} loss repeating on the next orders.`,
      costAndRisk: 'Nothing to spend; open orders may still look worse than they end.',
      confidencePct: 75,
      assumptions: ['Labour = worker day wage × job hours.'],
      limitations: ['Utilities and logistics are not split per order.'],
      preview: null,
      scenario: null,
    });
  }

  // 8. Dye and chemical use per metre dyed.
  if (chemNow !== null && chemPrev !== null && chemPrev > 0 && chemNow > chemPrev * 1.1) {
    out.push({
      id: 'chemicals',
      kind: 'material',
      title: 'Dye and chemical cost per metre is rising',
      problem: `Dyes cost ₹${r2(chemNow)} per metre, up ${Math.round((chemNow / chemPrev - 1) * 100)}% from ₹${r2(chemPrev)}.`,
      evidence: [{ label: 'Dyeing + finishing issues per metre dyed', value: `${r2(chemNow)} vs ${r2(chemPrev)}`, link: '/raw-materials' }],
      action: 'Compare recipes and issue slips with last period.',
      benefit: `About ${rupees((chemNow - chemPrev) * ctx.dyed)} saved at the old rate.`,
      costAndRisk: 'Nothing to spend; darker shades need more dye.',
      confidencePct: clampPct(50 + ((chemNow / chemPrev - 1) * 100) / 2),
      assumptions: [],
      limitations: ['Shade mix is not accounted for.'],
      preview: null,
      scenario: null,
    });
  }

  // 9. Logistics per metre shipped.
  if (logisticsNow !== null && logisticsPrev && logisticsNow > logisticsPrev * 1.1) {
    out.push({
      id: 'logistics',
      kind: 'money',
      title: 'Logistics cost per metre is rising',
      problem: `Freight is ₹${r2(logisticsNow)} per metre, up from ₹${r2(logisticsPrev)}.`,
      evidence: [{ label: 'Logistics per metre', value: `${r2(logisticsNow)} vs ${r2(logisticsPrev)}`, link: '/accounts' }],
      action: 'Combine part loads and compare transporters.',
      benefit: 'Full trucks cost less per metre.',
      costAndRisk: 'Nothing to spend; waiting for a full truck can delay deliveries.',
      confidencePct: clampPct(50 + ((logisticsNow / logisticsPrev - 1) * 100) / 2),
      assumptions: [],
      limitations: ['Truck capacity is not modelled.'],
      preview: null,
      scenario: null,
    });
  }

  // 10. Overdue receivables.
  if (overview.receivable.overdue > 0) {
    // Most overdue first (the list is sorted that way).
    const late = overview.topReceivables.filter((x) => x.daysOverdue > 0);
    const [oldest] = late;
    out.push({
      id: 'receivables',
      kind: 'money',
      title: `Collect ${short(overview.receivable.overdue)} overdue`,
      problem: `${short(overview.receivable.overdue)} overdue on ${plural(overview.receivable.overdueCount, 'invoice')}; oldest ${plural(oldest.daysOverdue, 'day')} late.`,
      evidence: overview.topReceivables.filter((x) => x.daysOverdue > 0).slice(0, 5).map((x) => ({ label: x.invoiceNo, value: `${rupees(x.balance)} · ${x.daysOverdue} days overdue`, link: `/accounts/invoices/${x.id}` })),
      action: `Call ${oldest.buyer} first about ${oldest.invoiceNo}.`,
      benefit: `${short(overview.receivable.overdue)} back in the bank for yarn and wages.`,
      costAndRisk: 'Nothing to spend; push big buyers gently.',
      confidencePct: 92, // straight from the books
      assumptions: [],
      limitations: [],
      preview: null,
      scenario: null,
    });
  }

  // The four the records support most strongly. The percentage is how strongly the evidence and
  // the simulated gain back each one, by the fixed rule above it; it is not a probability model.
  return out
    .map((r) => ({ ...r, confidence: r.confidencePct >= 80 ? 'HIGH' : r.confidencePct >= 60 ? 'MEDIUM' : 'LOW' }))
    .sort((a, b) => b.confidencePct - a.confidencePct)
    .slice(0, 4);
}

// ------------------------------------------------------------ explanation --

// Plain-language reading of a result, from the computed figures only.
function rulesExplanation(r) {
  const m = Object.fromEntries(r.metrics.map((x) => [x.key, x]));
  const good = r.metrics.filter((x) => x.effect === 'good');
  const bad = r.metrics.filter((x) => x.effect === 'bad');
  const val = (v, unit) => (v === null ? '—' : unit === 'INR' ? rupees(v) : unit === '%' ? `${v}%` : fmt(v, unit));
  const line = (x) => `${x.label}: ${val(x.base, x.unit)} → ${val(x.alt, x.unit)}`;
  const [was, now] = [r.baseline.busiest, r.scenario.busiest];
  const busyPct = (side, st) => side.stages[st].utilisation;
  const sections = [
    ['What changed', good.length || bad.length ? [...good, ...bad].slice(0, 5).map(line) : ['Nothing measurable changes in this period.']],
    [
      'Why',
      [
        was !== now
          ? `The busiest stage moves from ${STAGE_NAME[was]} to ${STAGE_NAME[now]}.`
          : `${STAGE_NAME[now]} is still the busiest stage (${busyPct(r.baseline, now)}% → ${busyPct(r.scenario, now)}% over the next 4 weeks), so it still sets the pace.`,
        `${r.orders.length} open orders get a different ready date.`,
      ],
    ],
    [
      'Main benefit',
      [
        m.late.alt < m.late.base ? `${m.late.base - m.late.alt} fewer late orders.` : null,
        r.money.revenue.pulledIntoPeriod > 0 ? `${rupees(r.money.revenue.pulledIntoPeriod)} of existing orders ready inside the period (timing, not new sales).` : null,
        r.money.revenue.spareCapacityMetres > 0 ? `${fmt(r.money.revenue.spareCapacityMetres, 'm')} of extra capacity, worth ${rupees(r.money.revenue.spareCapacityContribution)} only if new orders fill it.` : null,
      ].filter(Boolean).concat(m.late.alt >= m.late.base && r.money.revenue.pulledIntoPeriod <= 0 && !r.money.revenue.spareCapacityMetres ? ['No clear benefit in this period.'] : []),
    ],
    [
      'What could go wrong',
      [
        bad.length ? `${bad.map((x) => x.label.toLowerCase()).join(', ')} get worse.` : null,
        r.money.recurringTotal > 0 ? `${rupees(r.money.recurringTotal)} of running costs over ${r.days} days.` : null,
        r.money.missing.length ? `Costs not entered: ${r.money.missing.join(', ')} — profit and payback are incomplete.` : null,
        r.rushOrder && !r.rushOrder.onTime ? `The rush order would finish ${r.rushOrder.lateByDays ?? 'too'} days late.` : null,
      ].filter(Boolean),
    ],
    ['Remaining constraint', [`${STAGE_NAME[now]} at ${busyPct(r.scenario, now)}% of its capacity over the next 4 weeks.`, `On paper the whole mill can finish at most ${fmt(r.capacity.chain.scenario.perDay, 'm')} a day.`]],
    [
      'Consider next',
      [r.money.paybackMonths.confirmed ? `Payback on confirmed money: ${r.money.paybackMonths.confirmed} months.` : r.money.paybackMonths.ifCapacitySold ? `Payback only if the extra capacity is sold: ${r.money.paybackMonths.ifCapacitySold} months.` : 'Try another option in the scenario builder before deciding.'],
    ],
  ];
  return sections.map(([title, points]) => ({ title, points: points.length ? points : ['—'] }));
}

async function explain(result) {
  const rules = rulesExplanation(result);
  // Only computed figures go to the model: no buyer names, no GSTINs.
  const facts = {
    days: result.days,
    changes: result.changes,
    metrics: result.metrics.map(({ label, unit, base, alt, effect }) => ({ label, unit, base, alt, effect })),
    busiestStage: { before: result.baseline.busiest, after: result.scenario.busiest },
    ordersWithNewDates: result.orders.length,
    money: result.money,
    rushOrder: result.rushOrder,
    limitations: result.limitations,
  };
  const prompt = `You explain a what-if simulation of a textile mill to its owner. Use ONLY the figures in the JSON below; never add, estimate or round figures differently. Money is in rupees. "pulledIntoPeriod" is timing of existing orders, not new sales; "spareCapacityContribution" counts only if new orders are found.
Reply in exactly six sections with these titles, each 1-3 short "- " bullets in plain words: What changed; Why; Main benefit; What could go wrong; Remaining constraint; Consider next.
Format: a line "## <title>" then bullets. No other text.

${JSON.stringify(facts)}`;
  try {
    const res = await generate({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 900, temperature: 0.1 } });
    const text = (res.candidates?.[0]?.content?.parts || []).filter((x) => x.text && !x.thought).map((x) => x.text).join('').trim();
    const sections = text
      .split(/^##\s*/m)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [title, ...rest] = s.split('\n');
        return { title: title.trim(), points: rest.map((l) => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean) };
      })
      .filter((s) => s.points.length);
    if (sections.length >= 3) return { source: 'gemini', sections };
  } catch (err) {
    return { source: 'rules', reason: err.message, sections: rules };
  }
  return { source: 'rules', reason: 'The model gave no usable answer.', sections: rules };
}

// --------------------------------------------------------- saved scenarios --

const audit = (tx, id, action, detail, user) => tx.auditLog.create({ data: { entity: 'LabScenario', entityId: id, action, detail, by: user.name } });

async function listScenarios() {
  const rows = await prisma.labScenario.findMany({ orderBy: { updatedAt: 'desc' } });
  // The list stays light: the full result is fetched with one scenario.
  return rows.map(({ result, ...s }) => ({ ...s, headline: result ? { metrics: result.metrics, money: { oneTimeTotal: result.money.oneTimeTotal, recurringTotal: result.money.recurringTotal, profit: result.money.profit, paybackMonths: result.money.paybackMonths, complete: result.money.complete } } : null }));
}

async function getScenario(id) {
  const s = await prisma.labScenario.findUnique({ where: { id } });
  if (!s) throw notFound('Scenario not found');
  return s;
}

async function createScenario({ name, changes, costs, days }, user) {
  const result = await simulate({ changes, costs, days });
  return prisma.$transaction(async (tx) => {
    const s = await tx.labScenario.create({ data: { name, changes, costs, days, result, snapshotAt: new Date(result.snapshotAt), evaluatedAt: new Date(), createdBy: user.name } });
    await audit(tx, s.id, 'CREATED', name, user);
    return s;
  });
}

async function updateScenario(id, data, user) {
  const s = await getScenario(id);
  const rerun = data.changes || data.costs || data.days;
  const next = { changes: data.changes ?? s.changes, costs: data.costs ?? s.costs, days: data.days ?? s.days };
  const result = rerun ? await simulate(next) : null;
  return prisma.$transaction(async (tx) => {
    const saved = await tx.labScenario.update({
      where: { id },
      data: { ...data, ...(result && { result, snapshotAt: new Date(result.snapshotAt), evaluatedAt: new Date() }) },
    });
    const what = [data.decision && `decision ${data.decision}`, data.note !== undefined && 'note', data.name && 'name', rerun && 'inputs'].filter(Boolean).join(', ');
    await audit(tx, id, 'UPDATED', what, user);
    return saved;
  });
}

async function runScenario(id, user) {
  const s = await getScenario(id);
  const result = await simulate({ changes: s.changes, costs: s.costs, days: s.days });
  const saved = await prisma.$transaction(async (tx) => {
    const row = await tx.labScenario.update({ where: { id }, data: { result, snapshotAt: new Date(result.snapshotAt), evaluatedAt: new Date() } });
    await audit(tx, id, 'RERUN', `data as of ${result.snapshotAt}`, user);
    return row;
  });
  return { ...saved, previous: s.result ? { snapshotAt: s.snapshotAt, evaluatedAt: s.evaluatedAt, metrics: s.result.metrics, money: s.result.money } : null };
}

async function deleteScenario(id, user) {
  await getScenario(id);
  await prisma.$transaction(async (tx) => {
    await tx.labScenario.delete({ where: { id } });
    await audit(tx, id, 'DELETED', null, user);
  });
  return { id };
}

async function history(id) {
  return prisma.auditLog.findMany({ where: { entity: 'LabScenario', entityId: id }, orderBy: { at: 'desc' } });
}

// The pickers in the scenario builder: real machines, yarns and fabrics, plus the baseline beside each input.
async function options() {
  const [snap, fabrics, today] = [await snapshot(), await configService.fabrics(), isoDay(Date.now())];
  const econ = await unitEconomics(today);
  return {
    today,
    stages: STAGES.map((s) => ({ stage: s, name: STAGE_NAME[s], unit: UNIT[s], machines: snap.machines.filter((m) => m.type === s).length, avgPerDay: r2(snap.stageAverage[s]) })),
    machines: snap.machines.map((m) => ({ id: m.id, code: m.code, name: m.name, stage: m.type, status: m.status, perDay: r2(m.perDay) })),
    yarns: snap.materials.filter((m) => m.category === 'YARN').map((m) => ({ id: m.id, name: `${m.yarnType} · ${m.colour}`, unit: m.unit, inStock: r2(m.qtyInStock), leadDays: m.leadDays })),
    fabrics: fabrics.map((f) => ({ fabricType: f.fabricType, pricePerMetre: f.pricePerMetre, yarnPerMetre: f.yarnPerMetre })),
    economics: { ...econ, contributionPerMetre: econ.contributionPerMetre === null ? null : r2(econ.contributionPerMetre), utilitiesPerDay: r2(econ.utilitiesPerDay), avgDailyWage: r2(econ.avgDailyWage), logisticsPerMetre: econ.logisticsPerMetre === null ? null : r2(econ.logisticsPerMetre) },
    rejectRatePct: r2((await rejectRate(today)) * 100),
  };
}

module.exports = { intelligence, simulate, explain, options, listScenarios, getScenario, createScenario, updateScenario, runScenario, deleteScenario, history, rulesExplanation };

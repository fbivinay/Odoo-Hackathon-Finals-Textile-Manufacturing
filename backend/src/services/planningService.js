const prisma = require('../lib/prisma');
const { badRequest } = require('../lib/errors');
const { CLOSED } = require('./orderService');
const { settings } = require('./configService');
const { STAGES, stageTarget, leftOf, stageOutput } = require('./productionService');

const SHIFTS_PER_DAY = 3;
const RATE_WINDOW_DAYS = 60;
// Typical wait for a yarn truck once it is ordered; an order short of yarn can't start spinning before that.
// A machine that is down is expected back after this many days, not lost for the whole plan.
const BACK_IN_DAYS = { BREAKDOWN: 2, MAINTENANCE: 1 };
const MAX_DAYS_AHEAD = 365;
const DAY = 24 * 60 * 60 * 1000;

const round = (n) => Math.round(n * 100) / 100;
const dayKey = (date) => date.toISOString().slice(0, 10);
const isSunday = (date) => date.getUTCDay() === 0; // the mill is closed on Sundays

// Monday of the week a date falls in.
function weekStart(date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return dayKey(d);
}

// Everything the plan reads, loaded once. Plain data: the planner below never touches the database,
// so Everest Lab can plan the same snapshot with and without a what-if change.
async function snapshot() {
  const since = new Date(Date.now() - RATE_WINDOW_DAYS * DAY);
  const [machines, rates, orders, materials, { qcDays }] = await Promise.all([
    prisma.machine.findMany({ where: { removedAt: null } }),
    prisma.productionJob.groupBy({
      by: ['machineId'],
      where: { status: 'COMPLETED', startedAt: { gte: since } },
      _avg: { qtyProduced: true },
    }),
    prisma.order.findMany({
      where: { status: { notIn: CLOSED } },
      // Remakes and rework jump the queue; otherwise earliest deadline first.
      orderBy: [{ priority: 'desc' }, { deadline: 'asc' }, { id: 'asc' }],
      include: { buyer: { select: { id: true, name: true } } },
    }),
    prisma.rawMaterial.findMany(),
    settings(),
  ]);
  const rateOf = new Map(rates.map((r) => [r.machineId, Number(r._avg.qtyProduced || 0)]));
  const ids = orders.map((o) => o.id);
  const [output, issued] = await Promise.all([
    stageOutput(ids),
    prisma.materialIssue.groupBy({ by: ['orderId'], where: { orderId: { in: ids } }, _sum: { qty: true } }),
  ]);
  const issuedOf = new Map(issued.map((r) => [r.orderId, Number(r._sum.qty || 0)]));

  // Each machine's output per shift; one with no recent jobs counts as its stage's average.
  const perShift = {};
  for (const stage of STAGES) {
    const known = machines.filter((m) => m.type === stage).map((m) => rateOf.get(m.id)).filter(Boolean);
    perShift[stage] = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  }
  return {
    takenAt: new Date().toISOString(),
    today: dayKey(new Date()),
    qcDays,
    stageAverage: Object.fromEntries(STAGES.map((s) => [s, perShift[s] * SHIFTS_PER_DAY])),
    machines: machines.map((m) => ({ id: m.id, code: m.code, name: m.name, type: m.type, status: m.status, perDay: (rateOf.get(m.id) || perShift[m.type]) * SHIFTS_PER_DAY })),
    orders: orders.map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      buyer: o.buyer,
      fabricType: o.fabricType,
      colour: o.colour,
      qty: o.qty,
      yarnRequired: o.yarnRequired,
      pricePerUnit: Number(o.pricePerUnit),
      materialId: o.materialId,
      status: o.status,
      deadline: o.deadline,
      priority: o.priority,
      issued: issuedOf.get(o.id) || 0,
      done: Object.fromEntries(STAGES.map((s) => [s, output(o.id, s).done])),
    })),
    materials: materials.map((m) => ({ id: m.id, yarnType: m.yarnType, colour: m.colour, unit: m.unit, category: m.category, qtyInStock: Number(m.qtyInStock), avgCost: Number(m.avgCost), leadDays: m.leadDays })),
  };
}

// What one day of a stage can produce: each usable machine's recent average per shift × 3 shifts,
// plus machines that are down now (back after a few days) and, in a what-if, machines added or broken.
function stageCapacity(snap, changes = {}) {
  const broken = new Map((changes.breakdowns || []).map((b) => [b.machineId, b.days]));
  const capacity = {};
  for (const stage of STAGES) {
    const all = snap.machines.filter((m) => m.type === stage);
    const backIn = (m) => Math.max(BACK_IN_DAYS[m.status] || 0, broken.get(m.id) || 0);
    const usable = all.filter((m) => !backIn(m));
    const added = (changes.addMachines || [])
      .filter((a) => a.stage === stage)
      .flatMap((a) => Array.from({ length: a.count }, (_, i) => ({
        code: `NEW-${stage.slice(0, 2)}-${i + 1}`,
        fromDay: a.fromDay || 0,
        rampDays: a.rampDays || 0,
        perDay: round(a.perShift ? a.perShift * SHIFTS_PER_DAY : snap.stageAverage[stage]),
      })));
    capacity[stage] = {
      machines: all.length,
      usable: usable.length,
      perDay: round(usable.reduce((total, m) => total + m.perDay, 0)),
      fullPerDay: round(all.reduce((total, m) => total + m.perDay, 0)),
      // Machines that are down now, with the day they rejoin the plan.
      returning: all.filter((m) => backIn(m)).map((m) => ({ code: m.code, fromDay: backIn(m), perDay: round(m.perDay) })),
    };
    if (added.length) {
      capacity[stage].added = added;
      capacity[stage].fullPerDay = round(capacity[stage].fullPerDay + added.reduce((t, a) => t + a.perDay, 0));
    }
  }
  return capacity;
}

// Forward plan for every open order: earliest deadline first, each stage filling the free capacity
// of its machines day by day. Pure: the same snapshot and changes always give the same plan.
// `changes` (all optional, used by Everest Lab): addMachines, breakdowns, sundays, materials,
// rushOrder, workFactor (extra work per unit of good fabric, e.g. from more QC rejects).
function plan(snap, changes = {}, days = 90) {
  const horizon = Number(days);
  const capacity = stageCapacity(snap, changes);
  const isWorkingDay = (date) => Boolean(changes.sundays) || !isSunday(date);
  const workFactor = changes.workFactor || 1;

  const materialChange = new Map((changes.materials || []).map((m) => [m.materialId, m]));
  const materials = snap.materials.map((m) => {
    const c = materialChange.get(m.id);
    return c ? { ...m, qtyInStock: Math.max(0, m.qtyInStock + (c.stockChange || 0)), leadDays: (m.leadDays ?? 7) + (c.extraLeadDays || 0) } : m;
  });
  const orders = changes.rushOrder ? withRush(snap.orders, changes.rushOrder) : snap.orders;

  // A short yarn waits for its supplier's delivery time (Config, per material).
  const leadDaysOf = new Map(materials.map((m) => [m.id, m.leadDays]));
  const today = new Date(`${snap.today}T00:00:00.000Z`);
  const dayAt = (index) => new Date(today.getTime() + index * DAY);
  const used = { SPINNING: new Map(), WEAVING: new Map(), DYEING: new Map() };

  // What a stage can make on a given day: today's usable machines plus any that are back by then,
  // plus added machines once commissioned (ramping up linearly).
  const capacityOn = (stage, index) =>
    capacity[stage].perDay +
    capacity[stage].returning.reduce((total, m) => total + (index >= m.fromDay ? m.perDay : 0), 0) +
    (capacity[stage].added || []).reduce((total, m) => total + (index < m.fromDay ? 0 : m.perDay * Math.min(1, m.rampDays ? (index - m.fromDay + 1) / m.rampDays : 1)), 0);

  // Put `qty` of a stage on the first days with room, starting at day `from`. Returns the day range used.
  function allocate(stage, qty, from) {
    if (capacity[stage].fullPerDay <= 0) return null;
    let left = qty;
    let start = null;
    let index = from;
    for (; left > 0.005 && index < MAX_DAYS_AHEAD * 2; index += 1) {
      if (!isWorkingDay(dayAt(index))) continue;
      const free = capacityOn(stage, index) - (used[stage].get(index) || 0);
      if (free <= 0.005) continue;
      const take = Math.min(free, left);
      used[stage].set(index, (used[stage].get(index) || 0) + take);
      left -= take;
      if (start === null) start = index;
      if (left <= 0.005) break;
    }
    return left > 0.005 ? null : { start, end: index };
  }

  const yarn = new Map(materials.map((m) => [m.id, { needed: 0, orders: 0, neededBy: null }]));
  // Stock is handed out in the same order as the plan, so two orders never count the same yarn.
  const stockLeft = new Map(materials.map((m) => [m.id, Number(m.qtyInStock)]));
  const planned = orders.map((order) => {
    const finishing = ['QC', 'READY'].includes(order.status);

    const yarnToIssue = Math.max(0, Number(order.yarnRequired) - order.issued) * workFactor;
    let yarnShortBy = 0;
    if (order.materialId && yarnToIssue > 0 && yarn.has(order.materialId)) {
      const entry = yarn.get(order.materialId);
      entry.needed += yarnToIssue;
      entry.orders += 1;
      const covered = Math.min(yarnToIssue, stockLeft.get(order.materialId));
      stockLeft.set(order.materialId, stockLeft.get(order.materialId) - covered);
      yarnShortBy = yarnToIssue - covered;
      // The first order that can't be covered sets how soon the yarn has to arrive.
      if (yarnShortBy > 0 && !entry.neededBy) entry.neededBy = order.deadline;
    }

    // Short of yarn: nothing can start until a delivery arrives.
    let cursor = yarnShortBy > 0 && !finishing ? leadDaysOf.get(order.materialId) ?? 7 : 0;
    let blocked = false;
    const stages = STAGES.map((stage) => {
      // Whatever a stage still owes is planned, even if a later stage has already started on the first part.
      const remaining = finishing ? 0 : leftOf(stageTarget(order, stage), order.done[stage]) * workFactor;
      if (remaining === 0) return { stage, remaining: 0, start: null, end: null };

      const slot = blocked ? null : allocate(stage, remaining, cursor);
      if (!slot) {
        blocked = true;
        return { stage, remaining: round(remaining), start: null, end: null };
      }
      cursor = slot.end;
      return { stage, remaining: round(remaining), start: dayKey(dayAt(slot.start)), end: dayKey(dayAt(slot.end)) };
    });

    const readyIndex = order.status === 'READY' ? 0 : cursor + snap.qcDays;
    const expectedReady = blocked ? null : dayAt(readyIndex);
    const lateByDays = expectedReady ? Math.max(0, Math.ceil((expectedReady - order.deadline) / DAY)) : null;

    return {
      id: order.id,
      orderNo: order.orderNo,
      buyer: order.buyer,
      fabricType: order.fabricType,
      colour: order.colour,
      qty: order.qty,
      status: order.status,
      deadline: order.deadline,
      stages,
      yarnToIssue: round(yarnToIssue),
      yarnShortBy: round(yarnShortBy),
      expectedReady: expectedReady && dayKey(expectedReady),
      lateByDays,
      onTime: lateByDays === 0,
      withinHorizon: readyIndex <= horizon,
    };
  });

  // Booked load against capacity, week by week, inside the horizon.
  const weeks = new Map();
  for (let index = 0; index < horizon; index += 1) {
    const date = dayAt(index);
    if (!isWorkingDay(date)) continue;
    const key = weekStart(date);
    if (!weeks.has(key)) weeks.set(key, { weekStart: key, SPINNING: { load: 0, capacity: 0 }, WEAVING: { load: 0, capacity: 0 }, DYEING: { load: 0, capacity: 0 } });
    for (const stage of STAGES) {
      weeks.get(key)[stage].load += used[stage].get(index) || 0;
      weeks.get(key)[stage].capacity += capacityOn(stage, index);
    }
  }
  const weeklyLoad = [...weeks.values()].map((week) => {
    for (const stage of STAGES) {
      const { load, capacity: cap } = week[stage];
      week[stage] = { load: round(load), capacity: round(cap), utilisation: cap ? Math.round((load / cap) * 100) : 0 };
    }
    return week;
  });

  const yarnNeeds = materials
    .map((m) => {
      const { needed, orders: count, neededBy } = yarn.get(m.id);
      const inStock = Number(m.qtyInStock);
      return { id: m.id, yarnType: m.yarnType, colour: m.colour, unit: m.unit, needed: round(needed), inStock, shortBy: round(Math.max(0, needed - inStock)), orders: count, neededBy };
    })
    .filter((m) => m.needed > 0)
    .sort((a, b) => b.shortBy - a.shortBy);

  const late = planned.filter((o) => o.lateByDays > 0);
  return {
    days: horizon,
    capacity,
    summary: {
      openOrders: planned.length,
      onTime: planned.filter((o) => o.onTime).length,
      late: late.length,
      unscheduled: planned.filter((o) => o.expectedReady === null).length,
      waitingForYarn: planned.filter((o) => o.yarnShortBy > 0).length,
      yarnsShort: yarnNeeds.filter((m) => m.shortBy > 0).length,
    },
    orders: planned,
    weeklyLoad,
    yarnNeeds,
  };
}

// A hypothetical order slotted into the earliest-deadline-first queue (after orders due the same day).
function withRush(orders, rush) {
  const order = {
    id: 'what-if-rush',
    orderNo: 'RUSH (what-if)',
    buyer: { id: null, name: 'Hypothetical buyer' },
    fabricType: rush.fabricType,
    colour: rush.colour || '',
    qty: rush.qty,
    yarnRequired: rush.yarnRequired,
    pricePerUnit: rush.pricePerUnit,
    materialId: rush.materialId || null,
    status: 'PENDING',
    deadline: new Date(`${rush.deadline}T00:00:00.000Z`),
    issued: 0,
    done: { SPINNING: 0, WEAVING: 0, DYEING: 0 },
  };
  // Behind the priority orders (remakes, rework), then by deadline.
  const at = orders.findIndex((o) => !o.priority && o.deadline > order.deadline);
  return at === -1 ? [...orders, order] : [...orders.slice(0, at), order, ...orders.slice(at)];
}

async function schedule({ days = 90 } = {}) {
  const horizon = Number(days);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > MAX_DAYS_AHEAD) throw badRequest(`days must be 1 to ${MAX_DAYS_AHEAD}`);
  return plan(await snapshot(), {}, horizon);
}

module.exports = { schedule, snapshot, plan, MAX_DAYS_AHEAD };

const prisma = require('../lib/prisma');
const { badRequest } = require('../lib/errors');
const { CLOSED } = require('./orderService');
const { STAGES, stageTarget, leftOf, stageOutput } = require('./productionService');

const SHIFTS_PER_DAY = 3;
const RATE_WINDOW_DAYS = 60;
const QC_DAYS = 1;
const MAX_DAYS_AHEAD = 365;
const DAY = 24 * 60 * 60 * 1000;

const round = (n) => Math.round(n * 100) / 100;
const dayKey = (date) => date.toISOString().slice(0, 10);
const isWorkingDay = (date) => date.getUTCDay() !== 0; // the mill is closed on Sundays

// Monday of the week a date falls in.
function weekStart(date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return dayKey(d);
}

// What one day of a stage can produce: each usable machine's recent average per shift × 3 shifts.
async function stageCapacity() {
  const since = new Date(Date.now() - RATE_WINDOW_DAYS * DAY);
  const [machines, rates] = await Promise.all([
    prisma.machine.findMany(),
    prisma.productionJob.groupBy({
      by: ['machineId'],
      where: { status: 'COMPLETED', startedAt: { gte: since } },
      _avg: { qtyProduced: true },
    }),
  ]);
  const rateOf = new Map(rates.map((r) => [r.machineId, Number(r._avg.qtyProduced || 0)]));

  const capacity = {};
  for (const stage of STAGES) {
    const all = machines.filter((m) => m.type === stage);
    const known = all.map((m) => rateOf.get(m.id)).filter(Boolean);
    const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
    const usable = all.filter((m) => !['BREAKDOWN', 'MAINTENANCE'].includes(m.status));
    const perShift = usable.reduce((total, m) => total + (rateOf.get(m.id) || fallback), 0);
    capacity[stage] = { machines: all.length, usable: usable.length, perDay: round(perShift * SHIFTS_PER_DAY) };
  }
  return capacity;
}

// Forward plan for every open order: earliest deadline first, each stage filling the
// free capacity of its machines day by day. Computed on the fly; nothing is stored.
async function schedule({ days = 90 } = {}) {
  const horizon = Number(days);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > MAX_DAYS_AHEAD) throw badRequest(`days must be 1 to ${MAX_DAYS_AHEAD}`);

  const [capacity, orders, materials] = await Promise.all([
    stageCapacity(),
    prisma.order.findMany({
      where: { status: { notIn: CLOSED } },
      orderBy: [{ deadline: 'asc' }, { id: 'asc' }],
      include: { buyer: { select: { id: true, name: true } } },
    }),
    prisma.rawMaterial.findMany(),
  ]);
  const ids = orders.map((o) => o.id);
  const [output, issued] = await Promise.all([
    stageOutput(ids),
    prisma.materialIssue.groupBy({ by: ['orderId'], where: { orderId: { in: ids } }, _sum: { qty: true } }),
  ]);
  const issuedOf = new Map(issued.map((r) => [r.orderId, Number(r._sum.qty || 0)]));

  const today = new Date(`${dayKey(new Date())}T00:00:00.000Z`);
  const dayAt = (index) => new Date(today.getTime() + index * DAY);
  const used = { SPINNING: new Map(), WEAVING: new Map(), DYEING: new Map() };

  // Put `qty` of a stage on the first days with room, starting at day `from`. Returns the day range used.
  function allocate(stage, qty, from) {
    const perDay = capacity[stage].perDay;
    if (perDay <= 0) return null;
    let left = qty;
    let start = null;
    let index = from;
    for (; left > 0.005 && index < MAX_DAYS_AHEAD * 2; index += 1) {
      if (!isWorkingDay(dayAt(index))) continue;
      const free = perDay - (used[stage].get(index) || 0);
      if (free <= 0.005) continue;
      const take = Math.min(free, left);
      used[stage].set(index, (used[stage].get(index) || 0) + take);
      left -= take;
      if (start === null) start = index;
      if (left <= 0.005) break;
    }
    return left > 0.005 ? null : { start, end: index };
  }

  const yarn = new Map(materials.map((m) => [m.id, { needed: 0, orders: 0 }]));
  // Stock is handed out in the same order as the plan, so two orders never count the same yarn.
  const stockLeft = new Map(materials.map((m) => [m.id, Number(m.qtyInStock)]));
  const plan = orders.map((order) => {
    const finishing = ['QC', 'READY'].includes(order.status);

    let cursor = 0;
    let blocked = false;
    const stages = STAGES.map((stage) => {
      // Whatever a stage still owes is planned, even if a later stage has already started on the first part.
      const remaining = finishing ? 0 : leftOf(stageTarget(order, stage), output(order.id, stage).done);
      if (remaining === 0) return { stage, remaining: 0, start: null, end: null };

      const slot = blocked ? null : allocate(stage, remaining, cursor);
      if (!slot) {
        blocked = true;
        return { stage, remaining: round(remaining), start: null, end: null };
      }
      cursor = slot.end;
      return { stage, remaining: round(remaining), start: dayKey(dayAt(slot.start)), end: dayKey(dayAt(slot.end)) };
    });

    const yarnToIssue = Math.max(0, Number(order.yarnRequired) - (issuedOf.get(order.id) || 0));
    let yarnShortBy = 0;
    if (order.materialId && yarnToIssue > 0 && yarn.has(order.materialId)) {
      const entry = yarn.get(order.materialId);
      entry.needed += yarnToIssue;
      entry.orders += 1;
      const covered = Math.min(yarnToIssue, stockLeft.get(order.materialId));
      stockLeft.set(order.materialId, stockLeft.get(order.materialId) - covered);
      yarnShortBy = yarnToIssue - covered;
    }

    const readyIndex = order.status === 'READY' ? 0 : cursor + QC_DAYS;
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
      weeks.get(key)[stage].capacity += capacity[stage].perDay;
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
      const { needed, orders: count } = yarn.get(m.id);
      const inStock = Number(m.qtyInStock);
      return { id: m.id, yarnType: m.yarnType, colour: m.colour, unit: m.unit, needed: round(needed), inStock, shortBy: round(Math.max(0, needed - inStock)), orders: count };
    })
    .filter((m) => m.needed > 0)
    .sort((a, b) => b.shortBy - a.shortBy);

  const late = plan.filter((o) => o.lateByDays > 0);
  return {
    days: horizon,
    capacity,
    summary: {
      openOrders: plan.length,
      onTime: plan.filter((o) => o.onTime).length,
      late: late.length,
      unscheduled: plan.filter((o) => o.expectedReady === null).length,
      waitingForYarn: plan.filter((o) => o.yarnShortBy > 0).length,
      yarnsShort: yarnNeeds.filter((m) => m.shortBy > 0).length,
    },
    orders: plan,
    weeklyLoad,
    yarnNeeds,
  };
}

module.exports = { schedule };

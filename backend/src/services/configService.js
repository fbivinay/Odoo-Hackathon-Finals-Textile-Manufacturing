const prisma = require('../lib/prisma');
const { notFound, badRequest, conflict } = require('../lib/errors');
const { quote } = require('../lib/pricing');

// Mill-wide numbers and their defaults. A key with no row uses its default, so a fresh
// database behaves exactly as before the Config page existed.
const SETTINGS = {
  qcDays: { label: 'Days for quality check', default: 1, min: 0, max: 30 },
  rollLength: { label: 'Roll length (m)', default: 1100, min: 50, max: 5000 },
  shiftHours: { label: 'Hours in a shift', default: 8, min: 1, max: 24 },
  dispatchTolerancePct: { label: 'Dispatch tolerance (%)', default: 5, min: 0, max: 50 },
  shelfWaitDays: { label: 'Max days finished fabric may wait', default: 3, min: 0, max: 60 },
};

const num = (v) => (v === null || v === undefined ? null : Number(v));
const round = (v, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;

async function settings() {
  const rows = await prisma.setting.findMany();
  const stored = new Map(rows.map((r) => [r.key, Number(r.value)]));
  return Object.fromEntries(Object.entries(SETTINGS).map(([key, s]) => [key, stored.has(key) ? stored.get(key) : s.default]));
}

const setting = async (key) => (await settings())[key];

// What the last year of orders says about each fabric: usual yarn, yarn per metre, usual price,
// and how much of what was made was rejected. Used as the starting values until the owner saves.
async function fabricHistory() {
  const [orders, waste] = await Promise.all([
    prisma.$queryRaw`
      SELECT "fabricType" AS fabric,
             COUNT(*)::int AS orders,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "pricePerUnit")::float AS price,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "yarnRequired" / NULLIF(qty, 0))::float AS "yarnPerMetre",
             mode() WITHIN GROUP (ORDER BY "materialId") AS "materialId"
      FROM "Order"
      WHERE "createdAt" > NOW() - INTERVAL '365 days' AND status <> 'CANCELLED' AND qty > 0 AND "yarnRequired" > 0
      GROUP BY "fabricType"`,
    prisma.$queryRaw`
      SELECT o."fabricType" AS fabric,
             (SUM(CASE WHEN r.status = 'REJECTED' THEN r.qty ELSE 0 END) / NULLIF(SUM(r.qty), 0) * 100)::float AS pct
      FROM "Roll" r JOIN "Order" o ON o.id = r."orderId"
      WHERE r."createdAt" > NOW() - INTERVAL '365 days'
      GROUP BY o."fabricType"`,
  ]);
  const wasteOf = new Map(waste.map((w) => [w.fabric, w.pct || 0]));
  return new Map(orders.map((o) => [o.fabric, { ...o, wastagePct: round(wasteOf.get(o.fabric) || 0, 1) }]));
}

async function fabrics() {
  const [specs, history] = await Promise.all([prisma.fabricSpec.findMany(), fabricHistory()]);
  const saved = new Map(specs.map((s) => [s.fabricType, s]));
  const names = [...new Set([...history.keys(), ...saved.keys()])].sort();
  return names.map((fabricType) => {
    const h = history.get(fabricType);
    const s = saved.get(fabricType);
    // History's yarn per metre already includes the waste allowance; the spec stores it net.
    const fromHistory = h && {
      materialId: h.materialId,
      yarnPerMetre: round(h.yarnPerMetre / (1 + h.wastagePct / 100), 4),
      wastagePct: h.wastagePct,
      pricePerMetre: round(h.price),
    };
    return {
      fabricType,
      saved: Boolean(s),
      materialId: s ? s.materialId ?? fromHistory?.materialId ?? null : fromHistory.materialId,
      yarnPerMetre: s ? num(s.yarnPerMetre) : fromHistory.yarnPerMetre,
      wastagePct: s ? num(s.wastagePct) : fromHistory.wastagePct,
      pricePerMetre: s ? num(s.pricePerMetre) : fromHistory.pricePerMetre,
      updatedAt: s?.updatedAt ?? null,
      history: h ? { orders: h.orders, yarnPerMetre: round(h.yarnPerMetre, 4), pricePerMetre: round(h.price), wastagePct: h.wastagePct } : null,
    };
  });
}

async function get() {
  const [fabricRows, rules, values, materials] = await Promise.all([
    fabrics(),
    prisma.orderRule.findMany({ orderBy: [{ kind: 'asc' }, { below: 'asc' }] }),
    settings(),
    prisma.rawMaterial.findMany({
      orderBy: [{ category: 'asc' }, { yarnType: 'asc' }, { colour: 'asc' }],
      select: { id: true, category: true, yarnType: true, colour: true, unit: true, reorderLevel: true, avgCost: true, supplierId: true, leadDays: true },
    }),
  ]);
  return {
    fabrics: fabricRows,
    rules: rules.map((r) => ({ ...r, pricePct: num(r.pricePct), wastagePct: num(r.wastagePct) })),
    settings: Object.entries(SETTINGS).map(([key, s]) => ({ key, label: s.label, value: values[key], default: s.default, min: s.min, max: s.max })),
    materials: materials.map((m) => ({ ...m, reorderLevel: num(m.reorderLevel), avgCost: num(m.avgCost) })),
  };
}

// Ids read badly in the log: show the yarn or supplier name instead.
async function readable(tx, values) {
  if (!values) return values;
  const out = { ...values };
  if (out.materialId) {
    const m = await tx.rawMaterial.findUnique({ where: { id: out.materialId } });
    out.materialId = m ? (m.colour ? `${m.yarnType} · ${m.colour}` : m.yarnType) : out.materialId;
  }
  if (out.supplierId) out.supplierId = (await tx.supplier.findUnique({ where: { id: out.supplierId } }))?.name ?? out.supplierId;
  return out;
}

// One log row per field that actually changed.
async function log(tx, what, rawBefore, rawAfter, user) {
  const [before, after] = [await readable(tx, rawBefore), await readable(tx, rawAfter)];
  const rows = Object.keys(after)
    .filter((field) => String(before?.[field] ?? '') !== String(after[field] ?? ''))
    .map((field) => ({ what, field, oldValue: before?.[field] == null ? null : String(before[field]), newValue: after[field] == null ? null : String(after[field]), changedBy: user.name }));
  if (rows.length) await tx.configChange.createMany({ data: rows });
}

async function saveFabric(fabricType, data, user) {
  if (data.materialId && !(await prisma.rawMaterial.findUnique({ where: { id: data.materialId } }))) throw notFound('Material not found');
  const current = (await fabrics()).find((f) => f.fabricType === fabricType);
  return prisma.$transaction(async (tx) => {
    const saved = await tx.fabricSpec.upsert({ where: { fabricType }, create: { fabricType, ...data }, update: data });
    await log(tx, `Fabric ${fabricType}`, current, data, user);
    return saved;
  });
}

// A fabric with orders in the last year can't go: its figures would only come back from history.
async function deleteFabric(fabricType, user) {
  const current = (await fabrics()).find((f) => f.fabricType === fabricType);
  if (!current) throw notFound('Fabric not found');
  if (current.history) throw conflict(`${fabricType} has orders, so it can't be removed`, 'FABRIC_IN_USE');
  return prisma.$transaction(async (tx) => {
    await tx.fabricSpec.delete({ where: { fabricType } });
    await tx.configChange.create({ data: { what: `Fabric ${fabricType}`, field: 'fabric', oldValue: 'on', newValue: 'removed', changedBy: user.name } });
    return { fabricType };
  });
}

async function addRule(data, user) {
  if (await prisma.orderRule.findUnique({ where: { kind_below: { kind: data.kind, below: data.below } } })) {
    throw conflict('A rule for that size already exists', 'CONFLICT');
  }
  return prisma.$transaction(async (tx) => {
    const rule = await tx.orderRule.create({ data });
    await tx.configChange.create({ data: { what: ruleName(rule), field: 'rule', oldValue: null, newValue: `${data.pricePct}% price, ${data.wastagePct}% wastage`, changedBy: user.name } });
    return rule;
  });
}

async function updateRule(id, data, user) {
  const rule = await prisma.orderRule.findUnique({ where: { id } });
  if (!rule) throw notFound('Rule not found');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.orderRule.update({ where: { id }, data });
    await log(tx, ruleName(rule), { pricePct: num(rule.pricePct), wastagePct: num(rule.wastagePct), below: rule.below }, data, user);
    return updated;
  });
}

async function deleteRule(id, user) {
  const rule = await prisma.orderRule.findUnique({ where: { id } });
  if (!rule) throw notFound('Rule not found');
  return prisma.$transaction(async (tx) => {
    await tx.orderRule.delete({ where: { id } });
    await tx.configChange.create({ data: { what: ruleName(rule), field: 'rule', oldValue: 'on', newValue: 'removed', changedBy: user.name } });
    return { id };
  });
}

const ruleName = (r) => (r.kind === 'QUANTITY' ? `Orders under ${r.below} m` : `Deadline under ${r.below} days`);

async function saveSettings(values, user) {
  for (const [key, value] of Object.entries(values)) {
    const s = SETTINGS[key];
    if (!s) throw badRequest(`Unknown setting ${key}`);
    if (value < s.min || value > s.max) throw badRequest(`${s.label} must be ${s.min} to ${s.max}`);
  }
  const before = await settings();
  return prisma.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(values)) {
      await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    await log(tx, 'Mill settings', before, values, user);
    return settings();
  });
}

async function saveMaterial(id, data, user) {
  const material = await prisma.rawMaterial.findUnique({ where: { id } });
  if (!material) throw notFound('Material not found');
  if (data.supplierId && !(await prisma.supplier.findUnique({ where: { id: data.supplierId } }))) throw notFound('Supplier not found');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.rawMaterial.update({ where: { id }, data });
    const name = material.colour ? `${material.yarnType} · ${material.colour}` : material.yarnType;
    await log(tx, name, { reorderLevel: num(material.reorderLevel), supplierId: material.supplierId, leadDays: material.leadDays }, data, user);
    return updated;
  });
}

// The figures a new order of this fabric is taken with: the saved spec, or history if none.
async function quoteFor(fabricType, { qty, deadline }) {
  const spec = (await fabrics()).find((f) => f.fabricType.toLowerCase() === fabricType.trim().toLowerCase());
  if (!spec) return null;
  const rules = await prisma.orderRule.findMany();
  const DAY = 86400000;
  const today = new Date(new Date().toISOString().slice(0, 10));
  const daysToDeadline = Math.round((new Date(new Date(deadline).toISOString().slice(0, 10)) - today) / DAY);
  return { spec, ...quote(spec, rules, { qty, daysToDeadline }) };
}

async function changes({ limit = 100 } = {}) {
  return prisma.configChange.findMany({ orderBy: { changedAt: 'desc' }, take: Math.min(Number(limit) || 100, 500) });
}

module.exports = { SETTINGS, settings, setting, get, fabrics, quoteFor, saveFabric, deleteFabric, addRule, updateRule, deleteRule, saveSettings, saveMaterial, changes };

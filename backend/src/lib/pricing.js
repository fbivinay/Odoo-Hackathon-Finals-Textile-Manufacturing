// Yarn and price for a new order from the Config figures: the fabric's own numbers, plus the
// tightest quantity band and the tightest deadline band the order falls in.
// Same rule as web/src/lib/pricing.ts, which shows the preview on the order form.

function bandFor(rules, kind, value) {
  if (value === null || !(value >= 0)) return null;
  return rules.filter((r) => r.kind === kind && value < r.below).sort((a, b) => a.below - b.below)[0] || null;
}

function quote(spec, rules, { qty, daysToDeadline }) {
  const applied = [bandFor(rules, 'QUANTITY', qty), bandFor(rules, 'DEADLINE', daysToDeadline)].filter(Boolean);
  const wastagePct = Number(spec.wastagePct) + applied.reduce((s, r) => s + Number(r.wastagePct), 0);
  const pricePct = applied.reduce((s, r) => s + Number(r.pricePct), 0);
  return {
    yarnKg: qty > 0 ? Math.round(qty * Number(spec.yarnPerMetre) * (1 + wastagePct / 100)) : 0,
    price: Math.round(Number(spec.pricePerMetre) * (1 + pricePct / 100) * 100) / 100,
    wastagePct,
    pricePct,
  };
}

module.exports = { bandFor, quote };

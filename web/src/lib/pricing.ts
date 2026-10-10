// Yarn and price for a new order from the Config figures: the fabric's own numbers, plus the
// tightest quantity band and the tightest deadline band the order falls in.

export type Spec = { yarnPerMetre: number; wastagePct: number; pricePerMetre: number }
export type Rule = { id: string; kind: 'QUANTITY' | 'DEADLINE'; below: number; pricePct: number; wastagePct: number }

export function bandFor(rules: Rule[], kind: Rule['kind'], value: number | null) {
  if (value === null || !(value >= 0)) return null
  return rules.filter((r) => r.kind === kind && value < r.below).sort((a, b) => a.below - b.below)[0] ?? null
}

export function quote(spec: Spec, rules: Rule[], { qty, daysToDeadline }: { qty: number; daysToDeadline: number | null }) {
  const size = bandFor(rules, 'QUANTITY', qty)
  const rush = bandFor(rules, 'DEADLINE', daysToDeadline)
  const applied = [size, rush].filter((r): r is Rule => r !== null)
  const wastagePct = spec.wastagePct + applied.reduce((s, r) => s + r.wastagePct, 0)
  const pricePct = applied.reduce((s, r) => s + r.pricePct, 0)
  return {
    yarnKg: qty > 0 ? Math.round(qty * spec.yarnPerMetre * (1 + wastagePct / 100)) : 0,
    price: Math.round(spec.pricePerMetre * (1 + pricePct / 100) * 100) / 100,
    wastagePct,
    pricePct,
    applied,
  }
}

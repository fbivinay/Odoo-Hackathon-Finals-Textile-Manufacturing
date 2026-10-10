// Store, purchasing and accounts for the synthetic history: every non-yarn material the mill
// buys and uses, supplier bills and payments, logistics and utility expenses.
//
// Runs after the core simulation (generate.js) on its finished timeline, with its own random
// stream, so orders, production, QC and dispatches come out exactly as before. Everything is
// derived from that timeline: dyeing chemicals follow the metres dyed, packaging follows the rolls
// on each truck, electricity follows machine hours. Stock is bought ahead of use, so no item
// ever goes below zero, and nothing dated after the as-of moment is kept.

const { taxFor } = require('../../src/lib/tax');

const H = 3600 * 1000;
const D = 24 * H;
const IST = 5.5 * H;
const round2 = (n) => Math.round(n * 100) / 100;
const pad = (n, w = 4) => String(n).padStart(w, '0');
const iso = (t) => (t == null ? null : new Date(t).toISOString());
const istMonth = (t) => new Date(t + IST).toISOString().slice(0, 7);
const monthStart = (ym) => Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1) - IST;
const addMonths = (ym, n) => {
  const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

function rng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, between: (a, b) => a + next() * (b - a), int: (a, b) => Math.floor(a + next() * (b - a + 1)), chance: (p) => next() < p, pick: (arr) => arr[Math.floor(next() * arr.length)] };
}

// Places for GST: Gujarat is the mill's own state (CGST+SGST), anything else is IGST.
// Existing suppliers keep their ids; new ones continue the sup_o_ series.
const OTHER_SUPPLIERS = [
  ['sup_o_001', 'Colourtex Dyes', 'Gujarat', 30],
  ['sup_o_002', 'Atul Chemicals', 'Gujarat', 30],
  ['sup_o_003', 'Surat Packaging Co', 'Gujarat', 30],
  ['sup_o_004', 'Ahmedabad Starch & Sizing', 'Gujarat', 30],
  ['sup_o_005', 'Western Lubricants', 'Maharashtra', 30],
  ['sup_o_006', 'Vapi Speciality Chemicals', 'Gujarat', 45],
  ['sup_o_007', 'Mumbai Lab Supplies', 'Maharashtra', 30],
  ['sup_o_008', 'Rajkot Bearings & Belts', 'Gujarat', 15],
  ['sup_o_009', 'Ludhiana Loom Spares', 'Punjab', 15],
  ['sup_o_010', 'Surat Label House', 'Gujarat', 30],
];
const SUP = Object.fromEntries(OTHER_SUPPLIERS.map(([id, name, state, credit]) => [id, { id, name, state, creditDays: credit }]));

// [id, sku, category, name, spec, unit, rate, tax code, supplier, department, subcategory, spare, pack, lead days]
// The first ten keep the ids and names they already had in the dataset.
const CATALOG = [
  ['mat_o_001', 'DY-RD-001', 'DYEING', 'Reactive Red ME4BL', 'Red', 'kg', 620, 'DYE', 'sup_o_001', 'DYEING', 'Reactive dyes', false, 25, 6],
  ['mat_o_002', 'DY-RD-002', 'DYEING', 'Reactive Navy Blue', 'Navy', 'kg', 680, 'DYE', 'sup_o_001', 'DYEING', 'Reactive dyes', false, 25, 6],
  ['mat_o_003', 'DY-RD-003', 'DYEING', 'Indigo Granules', 'Indigo', 'kg', 540, 'DYE', 'sup_o_001', 'DYEING', 'Reactive dyes', false, 25, 6],
  ['mat_o_004', 'DY-RD-004', 'DYEING', 'Sulphur Black BR', 'Black', 'kg', 210, 'DYE', 'sup_o_001', 'DYEING', 'Reactive dyes', false, 50, 6],
  ['mat_o_005', 'DY-AL-001', 'DYEING', 'Caustic Soda Flakes', '98% purity', 'kg', 48, 'ALKALI', 'sup_o_002', 'DYEING', 'Alkalis', false, 50, 5],
  ['mat_o_006', 'DY-BL-001', 'DYEING', 'Hydrogen Peroxide', '50% solution', 'L', 42, 'PEROXIDE', 'sup_o_002', 'DYEING', 'Bleaching agents', false, 35, 5],
  ['mat_o_007', 'DY-AL-002', 'DYEING', 'Soda Ash', 'Light', 'kg', 36, 'ALKALI', 'sup_o_002', 'DYEING', 'Alkalis', false, 50, 5],
  ['mat_o_008', 'FN-SF-001', 'FINISHING', 'Softener', 'Cationic', 'L', 95, 'TEXTILE_AUX', 'sup_o_002', 'FINISHING', 'Fabric softeners', false, 50, 5],
  ['mat_o_009', 'PK-TB-001', 'PACKAGING', 'Paper Tubes', '60 inch core', 'pcs', 38, 'TUBE', 'sup_o_003', 'DISPATCH', 'Cardboard tubes and roll cores', false, 100, 4],
  ['mat_o_010', 'PK-WR-001', 'PACKAGING', 'Poly Wrap', '200 gauge', 'rolls', 780, 'PLASTIC', 'sup_o_003', 'DISPATCH', 'Plastic wrapping and covers', false, 5, 4],
  ['mat_o_011', 'WV-SZ-001', 'WEAVING', 'Maize Starch', 'Sizing grade', 'kg', 38, 'STARCH', 'sup_o_004', 'WEAVING', 'Sizing agents', false, 50, 4],
  ['mat_o_012', 'WV-SZ-002', 'WEAVING', 'PVA', 'Fully hydrolysed', 'kg', 210, 'PVA', 'sup_o_004', 'WEAVING', 'Sizing agents', false, 25, 5],
  ['mat_o_013', 'WV-LB-001', 'WEAVING', 'Loom Oil', 'ISO VG 68', 'L', 165, 'LUBRICANT', 'sup_o_005', 'WEAVING', 'Lubricants and grease', false, 20, 6],
  ['mat_o_014', 'WV-LB-002', 'WEAVING', 'Loom Grease', 'Lithium EP2', 'kg', 240, 'LUBRICANT', 'sup_o_005', 'WEAVING', 'Lubricants and grease', false, 10, 6],
  ['mat_o_015', 'WV-CL-001', 'WEAVING', 'Loom Cleaner', 'Solvent based', 'L', 120, 'DETERGENT', 'sup_o_006', 'WEAVING', 'Cleaning materials', false, 20, 5],
  ['mat_o_016', 'DY-DS-001', 'DYEING', 'Disperse Black', 'For polyester', 'kg', 540, 'DYE', 'sup_o_001', 'DYEING', 'Disperse dyes', false, 25, 6],
  ['mat_o_017', 'DY-DS-002', 'DYEING', 'Disperse Navy', 'For polyester', 'kg', 580, 'DYE', 'sup_o_001', 'DYEING', 'Disperse dyes', false, 25, 6],
  ['mat_o_018', 'DY-DS-003', 'DYEING', 'Disperse Red', 'For polyester', 'kg', 610, 'DYE', 'sup_o_001', 'DYEING', 'Disperse dyes', false, 25, 6],
  ['mat_o_019', 'DY-WA-001', 'DYEING', 'Wetting Agent', 'Non-ionic', 'kg', 145, 'DETERGENT', 'sup_o_006', 'DYEING', 'Wetting agents', false, 50, 5],
  ['mat_o_020', 'DY-DT-001', 'DYEING', 'Soaping Detergent', 'Anionic', 'kg', 130, 'DETERGENT', 'sup_o_006', 'DYEING', 'Detergents and washing agents', false, 50, 5],
  ['mat_o_021', 'DY-DZ-001', 'DYEING', 'Desizing Enzyme', 'Amylase', 'kg', 380, 'ENZYME', 'sup_o_006', 'DYEING', 'Desizing agents', false, 25, 6],
  ['mat_o_022', 'DY-SL-001', 'DYEING', 'Industrial Salt', 'Sodium chloride', 'kg', 6, 'SALT', 'sup_o_002', 'DYEING', 'Salts', false, 500, 4],
  ['mat_o_023', 'DY-SL-002', 'DYEING', 'Sodium Sulphate', 'Anhydrous', 'kg', 14, 'SULPHATE', 'sup_o_002', 'DYEING', 'Salts', false, 250, 4],
  ['mat_o_024', 'DY-AC-001', 'DYEING', 'Acetic Acid', 'Glacial 99%', 'L', 70, 'ACID', 'sup_o_002', 'DYEING', 'Acids and pH control', false, 35, 5],
  ['mat_o_025', 'FN-FX-001', 'FINISHING', 'Colour Fixing Agent', 'Cationic', 'kg', 160, 'TEXTILE_AUX', 'sup_o_006', 'FINISHING', 'Colour-fixing agents', false, 50, 5],
  ['mat_o_026', 'FN-OT-001', 'FINISHING', 'Anti-crease Resin', 'Low formaldehyde', 'kg', 175, 'TEXTILE_AUX', 'sup_o_006', 'FINISHING', 'Other finishing agents', false, 50, 6],
  ['mat_o_027', 'QC-RG-001', 'QC', 'Fastness Test Kit', 'Grey scale + strips', 'pcs', 450, 'REAGENT', 'sup_o_007', 'QC', 'Testing reagents and consumables', false, 4, 7],
  ['mat_o_028', 'QC-RG-002', 'QC', 'pH Indicator Strips', 'Pack of 100', 'pcs', 180, 'REAGENT', 'sup_o_007', 'QC', 'Testing reagents and consumables', false, 5, 7],
  ['mat_o_029', 'QC-LB-001', 'QC', 'Sample Tags', 'Printed', 'pcs', 1.2, 'LABEL', 'sup_o_010', 'QC', 'Sample labels and marking', false, 500, 4],
  ['mat_o_030', 'PK-CV-001', 'PACKAGING', 'Roll Cover Bags', 'LDPE 60 inch', 'pcs', 18, 'PLASTIC', 'sup_o_003', 'DISPATCH', 'Plastic wrapping and covers', false, 100, 4],
  ['mat_o_031', 'PK-LB-001', 'PACKAGING', 'Barcode Labels', '100 x 50 mm', 'pcs', 0.8, 'LABEL', 'sup_o_010', 'DISPATCH', 'Labels and barcode stickers', false, 1000, 4],
  ['mat_o_032', 'PK-ST-001', 'PACKAGING', 'PP Packing Strap', '12 mm, 1000 m', 'rolls', 650, 'PLASTIC', 'sup_o_003', 'DISPATCH', 'Packing straps', false, 2, 4],
  ['mat_o_033', 'PK-CT-001', 'PACKAGING', 'Corrugated Cartons', 'Swatch boxes', 'pcs', 35, 'CARTON', 'sup_o_003', 'DISPATCH', 'Cartons', false, 50, 4],
  ['mat_o_034', 'MT-OL-001', 'MAINTENANCE', 'Machine Oil', 'ISO VG 46', 'L', 150, 'LUBRICANT', 'sup_o_005', 'MAINTENANCE', 'Machine oil and grease', false, 20, 6],
  ['mat_o_035', 'MT-GR-001', 'MAINTENANCE', 'Bearing Grease', 'EP2', 'kg', 230, 'LUBRICANT', 'sup_o_005', 'MAINTENANCE', 'Machine oil and grease', false, 10, 6],
  ['mat_o_036', 'MT-BT-001', 'MAINTENANCE', 'V-Belt', 'B-section', 'pcs', 420, 'BELT', 'sup_o_008', 'MAINTENANCE', 'Belts and bearings', true, 4, 5],
  ['mat_o_037', 'MT-BR-001', 'MAINTENANCE', 'Ball Bearing', '6205-2RS', 'pcs', 260, 'BEARING', 'sup_o_008', 'MAINTENANCE', 'Belts and bearings', true, 10, 5],
  ['mat_o_038', 'MT-SP-001', 'MAINTENANCE', 'Rapier Tape', 'For rapier looms', 'pcs', 2800, 'MACHINE_SPARE', 'sup_o_009', 'MAINTENANCE', 'Machine spare parts', true, 1, 10],
  ['mat_o_039', 'MT-SP-002', 'MAINTENANCE', 'Ring Travellers', 'Box of 1000', 'pcs', 350, 'MACHINE_SPARE', 'sup_o_009', 'MAINTENANCE', 'Machine spare parts', true, 5, 10],
  ['mat_o_040', 'MT-CL-001', 'MAINTENANCE', 'Degreaser', 'Maintenance cleaning', 'L', 140, 'DETERGENT', 'sup_o_006', 'MAINTENANCE', 'Cleaning and maintenance supplies', false, 20, 5],
];

const LIGHT = ['white', 'ivory', 'natural', 'champagne', 'beige', 'sand'];
const PALE = ['peach', 'pink', 'lilac', 'mint', 'sky blue', 'light blue'];
const DARK = ['black', 'navy', 'dark', 'maroon', 'wine', 'indigo', 'olive'];

function addAccounts(ctx) {
  const { T, START, orders, jobs, rolls, dispatches, inwards: yarnInwards, yarnIssues, storeKeeperId, buyers, yarnSuppliers } = ctx;
  const r = rng(20260101);
  const counters = {};
  const nextId = (kind) => `${kind}_${pad((counters[kind] = (counters[kind] || 0) + 1), 6)}`;

  const items = CATALOG.map(([id, sku, category, name, spec, unit, rate, taxCode, supplierId, department, subcategory, isSpare, pack, leadDays]) => ({
    id, sku, category, name, spec, unit, rate, taxCode, supplierId, department, subcategory, isSpare, pack, leadDays, uses: [],
  }));
  const item = Object.fromEntries(items.map((i) => [i.sku, i]));
  const use = (sku, qty, at, extra = {}) => {
    if (qty <= 0 || at > T) return;
    item[sku].uses.push({ qty: round2(qty), at: Math.round(at), ...extra });
  };

  // ---------- consumption, from the production timeline ----------
  const jobsOf = new Map();
  for (const j of jobs) jobsOf.set(j.order.id, [...(jobsOf.get(j.order.id) || []), j]);
  const rollsOf = new Map();
  for (const x of rolls) rollsOf.set(x.order.id, [...(rollsOf.get(x.order.id) || []), x]);

  for (const o of orders) {
    const mine = (jobsOf.get(o.id) || []).sort((a, b) => a.startedAt - b.startedAt);
    const fibre = o.material.yarnType.startsWith('Polyester') ? 'POLY' : o.material.yarnType.startsWith('Poly-Cotton') ? 'BLEND' : 'CELL';
    const colour = o.colour.toLowerCase();
    const light = LIGHT.some((c) => colour.includes(c));
    // kg of dye per 1,000 m: about 1-4% of the fabric weight (~120 g/m), by depth of shade.
    const shade = light ? 0 : PALE.some((c) => colour.includes(c)) ? 1.5 : DARK.some((c) => colour.includes(c)) ? 5 : 3;
    const forOrder = { orderId: o.id };

    // Weaving: size the warp before the first loom shift.
    const weave = mine.filter((j) => j.stage === 'WEAVING');
    if (weave.length) {
      const k = weave.reduce((t, j) => t + j.qtyProduced, 0) / 1000;
      const at = weave[0].startedAt - 2 * H;
      const extra = { ...forOrder, jobId: weave[0].id, department: 'WEAVING' };
      if (fibre !== 'POLY') use('WV-SZ-001', k * 8, at, extra);
      use('WV-SZ-002', k * (fibre === 'CELL' ? 1 : 2.5), at, extra);
    }

    // Dyeing: pretreatment, dye and after-wash for the metres dyed (top-up lots included).
    const dye = mine.filter((j) => j.stage === 'DYEING');
    if (dye.length) {
      const k = dye.reduce((t, j) => t + j.qtyProduced, 0) / 1000;
      const at = dye[0].startedAt - H;
      const extra = { ...forOrder, jobId: dye[0].id, department: 'DYEING' };
      use('DY-WA-001', k * 1.2, at, extra);
      use('DY-DT-001', k * (fibre === 'POLY' ? 1.5 : 2), at, extra);
      if (fibre === 'POLY') {
        use('DY-AC-001', k * 2, at, extra);
        use('DY-AL-001', k * 1.5, at, extra); // reduction clearing
        if (shade) use(colour.includes('black') ? 'DY-DS-001' : /navy|blue|teal/.test(colour) ? 'DY-DS-002' : 'DY-DS-003', (k * shade) / 1.2, at, extra);
      } else {
        use('DY-DZ-001', k * 0.8, at, extra);
        use('DY-BL-001', k * (light ? 8 : 4), at, extra);
        use('DY-AL-001', k * (light ? 5 : 3), at, extra);
        use('DY-AC-001', k * 1, at, extra);
        if (shade) {
          const sku = colour.includes('indigo') || colour.includes('stone') ? 'DY-RD-003'
            : colour.includes('black') ? 'DY-RD-004' : /navy|blue|teal/.test(colour) ? 'DY-RD-002' : 'DY-RD-001';
          use(sku, k * (sku === 'DY-RD-003' ? 0.5 : shade), at, extra); // denim yarn is rope-dyed: indigo only tops the shade
          use('DY-AL-002', k * 6, at, extra);
          if (shade >= 5) use('DY-SL-002', k * 25, at, extra);
          else use('DY-SL-001', k * 50, at, extra);
        }
      }
      // Finishing after the last dyeing shift.
      const last = dye[dye.length - 1];
      const fin = { ...forOrder, jobId: last.id, department: 'FINISHING' };
      const done = (last.completedAt || last.startedAt) + H;
      use('FN-SF-001', k * 5, done, fin);
      if (fibre !== 'POLY' && shade) use('FN-FX-001', k * 1.5, done, fin);
      if (['Poplin', 'Oxford', 'Twill', 'Linen Suiting', 'Chambray'].includes(o.fabricType)) use('FN-OT-001', k * 3, done, fin);
    }

    // QC: one sample tag per roll, at its first inspection.
    for (const x of rollsOf.get(o.id) || []) {
      const first = x.inspections[0];
      if (first) use('QC-LB-001', 1, first.checkedAt, { ...forOrder, department: 'QC' });
    }
  }

  // Dispatch: every roll leaves on a tube, in a cover bag, with two barcode labels.
  const rollsOn = new Map();
  for (const x of rolls) if (x.dispatch) rollsOn.set(x.dispatch.id, [...(rollsOn.get(x.dispatch.id) || []), x]);
  for (const d of dispatches) {
    const n = (rollsOn.get(d.id) || []).length;
    const extra = { orderId: d.orderId, department: 'DISPATCH' };
    const at = d.dispatchedAt - H;
    use('PK-TB-001', n, at, extra);
    use('PK-CV-001', n, at, extra);
    use('PK-LB-001', n * 2, at, extra);
    use('PK-WR-001', n * 0.04, at, extra);
    use('PK-ST-001', 0.05, at, extra);
  }

  // Monthly stores issues not tied to an order: maintenance, QC kits, loom upkeep, swatch boxes.
  const months = [];
  for (let m = istMonth(START + 40 * D); monthStart(m) <= T; m = addMonths(m, 1)) months.push(m);
  for (const m of months) {
    const at = monthStart(m) + 2 * D + 11 * H;
    const jitter = () => r.between(0.85, 1.15);
    use('MT-OL-001', 8 * 3 * jitter(), at, { department: 'MAINTENANCE' });
    use('MT-GR-001', 17 * 1.2 * jitter(), at, { department: 'MAINTENANCE' });
    use('MT-CL-001', 8 * jitter(), at, { department: 'MAINTENANCE' });
    use('WV-LB-001', 9 * 4 * jitter(), at, { department: 'WEAVING' });
    use('WV-LB-002', 9 * jitter(), at, { department: 'WEAVING' });
    use('WV-CL-001', 6 * jitter(), at, { department: 'WEAVING' });
    use('MT-BT-001', r.int(2, 6), at, { department: 'MAINTENANCE' });
    use('MT-BR-001', r.int(4, 9), at, { department: 'MAINTENANCE' });
    if (r.chance(0.4)) use('MT-SP-001', 1, at, { department: 'MAINTENANCE' });
    use('MT-SP-002', r.int(6, 10), at, { department: 'MAINTENANCE' });
    use('QC-RG-001', r.int(3, 5), at, { department: 'QC' });
    use('QC-RG-002', r.int(2, 4), at, { department: 'QC' });
    use('PK-CT-001', r.int(15, 30), at, { department: 'DISPATCH' });
  }

  // ---------- purchasing: buy ahead of use, never below zero ----------
  const priceAt = (base, t) => round2(base * (1 + 0.035 * ((t - START) / (365 * D))) * r.between(0.97, 1.03));
  const inwards = [];
  const issues = [];
  const stockOut = [];
  const pendingOrders = [];
  for (const it of items) {
    it.uses.sort((a, b) => a.at - b.at);
    const total = it.uses.reduce((t, u) => t + u.qty, 0);
    const span = Math.max(1, (Math.min(T, it.uses.at(-1)?.at ?? T) - START) / (30.44 * D));
    const monthly = total / span;
    const roundUp = (q) => Math.max(it.pack, Math.ceil(q / it.pack) * it.pack);
    it.reorderLevel = Math.max(it.pack, Math.round((monthly * 0.75) / it.pack) * it.pack); // ~3 weeks of use
    let qty = 0;
    let avg = 0;
    const receive = (q, at) => {
      if (at > T) return;
      const rate = priceAt(it.rate, at);
      avg = (qty * avg + q * rate) / (qty + q);
      qty += q;
      inwards.push({ it, qty: q, rate, at: Math.round(at) });
    };
    receive(roundUp(monthly * 2), Math.min(START + 5 * D, (it.uses[0]?.at ?? T) - D)); // opening stock, before the first use
    // Weekly stores review: below the reorder level (counting what is already on the way), order
    // about six weeks' use. It only counts as stock once the truck arrives.
    let review = START + 12 * D;
    const onTheWay = [];
    const arrive = (until) => {
      onTheWay.sort((a, b) => a.at - b.at);
      while (onTheWay.length && onTheWay[0].at <= until) {
        const p = onTheWay.shift();
        receive(p.qty, p.at);
      }
    };
    const reviewUntil = (until) => {
      for (; review < until; review += 7 * D) {
        arrive(review);
        const coming = onTheWay.reduce((t, p) => t + p.qty, 0);
        if (qty + coming < it.reorderLevel) onTheWay.push({ qty: roundUp(monthly * 1.5), at: review + it.leadDays * D });
      }
    };
    for (const u of it.uses) {
      reviewUntil(u.at);
      arrive(u.at);
      // A use the shelf cannot cover gets an urgent delivery the day before.
      if (qty < u.qty) receive(roundUp(u.qty - qty + monthly), u.at - D);
      qty = round2(qty - u.qty);
      if (qty < -0.005) stockOut.push(it.sku);
      issues.push({ it, ...u, cost: round2(u.qty * avg) });
    }
    reviewUntil(T);
    arrive(T);
    for (const p of onTheWay) pendingOrders.push({ it, qty: p.qty, orderedAt: p.at - it.leadDays * D });
    it.qtyInStock = round2(qty);
    it.avgCost = round2(avg);
  }
  if (stockOut.length) throw new Error(`Stock went negative for ${[...new Set(stockOut)].join(', ')}`);

  // ---------- supplier bills (every delivery, yarn included) and payments ----------
  inwards.sort((a, b) => a.at - b.at);
  const supplierState = new Map([...yarnSuppliers.map((s) => [s.id, s]), ...Object.values(SUP).map((s) => [s.id, s])]);
  const bills = [
    ...yarnInwards.map((i) => ({ row: i, at: Date.parse(i.receivedAt), taxable: i.billAmount, supplierId: i.supplierId, taxCode: 'YARN_RAW' })),
    ...inwards.map((i) => {
      const row = {
        id: nextId('inw_x'), materialId: i.it.id, supplierId: i.it.supplierId, orderId: null, receivedById: storeKeeperId,
        qty: i.qty, rate: i.rate, billAmount: round2(i.qty * i.rate), receivedAt: iso(i.at),
      };
      return { row, at: i.at, taxable: row.billAmount, supplierId: row.supplierId, taxCode: i.it.taxCode };
    }),
  ].sort((a, b) => a.at - b.at || a.row.id.localeCompare(b.row.id));
  const supplierPayments = [];
  bills.forEach((b, n) => {
    const s = supplierState.get(b.supplierId);
    const ym = istMonth(b.at).replace('-', '').slice(2);
    Object.assign(b.row, {
      billNo: `PB-${pad(n + 1, 5)}`, // synthetic purchase bill number, not a real supplier invoice
      batchNo: `LOT-${ym}-${pad((n % 997) + 1, 3)}`,
      dueDate: iso(b.at + s.creditDays * D),
      ...taxFor(b.taxCode, b.taxable, iso(b.at), s.state),
    });
    // Paid around the due date; one in twenty-five runs late; one in twelve is paid in two parts.
    const due = b.at + s.creditDays * D;
    const payAt = due + (r.chance(0.04) ? r.between(15, 40) : r.between(-4, 6)) * D;
    const total = b.row.totalAmount;
    const ref = () => `UTR${pad(r.int(1, 99999999), 8)}`;
    if (payAt > T) return;
    if (r.chance(1 / 12)) {
      const first = round2(total * r.between(0.4, 0.7));
      supplierPayments.push({ id: nextId('spay'), inwardId: b.row.id, amount: first, method: 'NEFT', reference: ref(), paidAt: iso(payAt - 10 * D) });
      supplierPayments.push({ id: nextId('spay'), inwardId: b.row.id, amount: round2(total - first), method: 'NEFT', reference: ref(), paidAt: iso(payAt) });
    } else {
      supplierPayments.push({ id: nextId('spay'), inwardId: b.row.id, amount: total, method: r.chance(0.8) ? 'NEFT' : 'RTGS', reference: ref(), paidAt: iso(payAt) });
    }
  });

  // ---------- expenses: logistics and factory utilities ----------
  const expenses = [];
  const BUYER_KM = { Gujarat: 280, Maharashtra: 320, Karnataka: 1250, Haryana: 1150, Delhi: 1150 };
  const OWN_FLEET = ['GJ-05-TX-4417', 'GJ-05-TX-4418'];
  const expense = (e) => {
    if (e.incurredAt > T) return;
    const tax = taxFor(e.taxCode, e.amount, iso(e.incurredAt), e.state || 'Gujarat');
    const dueDate = e.dueAt ?? (e.creditDays ? e.incurredAt + e.creditDays * D : e.incurredAt);
    const settled = e.paidAt ?? dueDate + (e.creditDays || e.dueAt ? r.between(-3, 5) * D : 0);
    // Accrued: the service was used, no bill has come yet. Unpaid: billed, not settled by today.
    const status = e.billAt > T ? 'ACCRUED' : settled <= T ? 'PAID' : 'UNPAID';
    expenses.push({
      category: e.category, subcategory: e.subcategory, description: e.description, payee: e.payee, supplierId: null,
      incurredAt: e.incurredAt, dueDate: iso(dueDate), amount: round2(e.amount), status,
      paidAt: status === 'PAID' ? iso(Math.max(settled, e.incurredAt)) : null,
      method: status === 'PAID' ? e.method || 'NEFT' : null,
      reference: status === 'PAID' && e.method !== 'Cash' ? `UTR${pad(r.int(1, 99999999), 8)}` : null,
      costCentre: e.costCentre, orderId: e.orderId || null, dispatchId: e.dispatchId || null, recurring: Boolean(e.recurring),
      ...tax,
    });
  };
  const year = (t) => new Date(t + IST).getUTCFullYear();
  const dieselPrice = (t) => round2(89.5 + 0.6 * (year(t) - 2023) + r.between(-0.8, 0.8));
  const buyerState = new Map(buyers.map((b) => [b.id, b.state]));

  // Per truck: own fleet within Gujarat and Maharashtra, a transport agency further away.
  for (const d of dispatches) {
    if (d.dispatchedAt > T) continue;
    const state = buyerState.get(d.buyerId) || 'Gujarat';
    const km = BUYER_KM[state] || 600;
    const base = { category: 'LOGISTICS', dispatchId: d.id, orderId: d.orderId, incurredAt: d.dispatchedAt, costCentre: 'Dispatch' };
    if (km <= 400 && !r.chance(0.08)) {
      const truck = r.pick(OWN_FLEET);
      const litres = (2 * km) / 8; // light truck: a dispatch is a few hundred kg of fabric
      expense({ ...base, subcategory: 'Diesel/petrol', description: `${d.dispatchNo} ${truck}: ${Math.round(litres)} L for ${2 * km} km`, payee: 'Highway fuel station', amount: litres * dieselPrice(d.dispatchedAt), taxCode: 'FUEL', method: 'Card', paidAt: d.dispatchedAt });
      expense({ ...base, subcategory: 'Tolls and parking', description: `${d.dispatchNo} ${truck}: tolls both ways`, payee: 'FASTag tolls', amount: km * 2 * r.between(1.7, 2.1), taxCode: 'TOLL', method: 'FASTag', paidAt: d.dispatchedAt });
      expense({ ...base, subcategory: 'Driver allowances', description: `${d.dispatchNo}: trip allowance`, payee: 'Fleet drivers', amount: 250 * Math.ceil((2 * km) / 400), taxCode: 'SALARY', method: 'Cash', paidAt: d.dispatchedAt });
    } else if (km <= 400) {
      expense({ ...base, subcategory: 'Truck rental', description: `${d.dispatchNo}: hired truck, own fleet busy`, payee: 'Kamrej Truck Hire', amount: km * 2 * r.between(15, 18), taxCode: 'VEHICLE_HIRE', creditDays: 15 });
    } else {
      // Part-load by weight: ~0.13 kg per metre of fabric plus the tube, charged per kg by distance.
      const metres = (rollsOn.get(d.id) || []).reduce((t, x) => t + x.qty, 0);
      const kg = metres * 0.13 + (rollsOn.get(d.id) || []).length * 1.5;
      expense({ ...base, subcategory: 'Third-party transport', description: `${d.dispatchNo}: part load to ${state}, ${Math.round(kg)} kg, ${km} km`, payee: 'Highway Freight Carriers', amount: Math.max(2500, kg * (3 + km * 0.008) * r.between(0.95, 1.05)), taxCode: 'GTA', creditDays: 15 });
    }
    expense({ ...base, subcategory: 'Loading and unloading', description: `${d.dispatchNo}: loading crew`, payee: 'Loading labour (casual)', amount: 300 + 40 * (rollsOn.get(d.id) || []).length, taxCode: 'UNREGISTERED', method: 'Cash', paidAt: d.dispatchedAt });
    if (r.chance(0.006)) {
      expense({ ...base, subcategory: 'Failed delivery', description: `${d.dispatchNo}: buyer warehouse closed, redelivered next day`, payee: 'Highway Freight Carriers', amount: 1500 + km * r.between(1.5, 2.5), taxCode: 'GTA', creditDays: 15, incurredAt: d.dispatchedAt + D });
    }
  }

  // Machine hours per month by stage, for the power bill.
  const hours = new Map();
  for (const j of jobs) {
    if (j.startedAt > T) continue;
    const m = istMonth(j.startedAt);
    const e = hours.get(m) || { SPINNING: 0, WEAVING: 0, DYEING: 0, dyedMetres: 0 };
    e[j.stage] += ((j.completedAt || T) - j.startedAt) / H;
    if (j.stage === 'DYEING') e.dyedMetres += j.qtyProduced;
    hours.set(m, e);
  }
  for (const m of months) {
    const s = monthStart(m);
    const billAt = monthStart(addMonths(m, 1)) + 4 * D + 11 * H; // bills arrive on the 5th of next month
    const h = hours.get(m) || { SPINNING: 0, WEAVING: 0, DYEING: 0, dyedMetres: 0 };
    const y = year(s);
    // Booked to the month of use (its last day, or today for the running month).
    const util = { category: 'UTILITIES', recurring: true, costCentre: 'Utilities', incurredAt: Math.min(T, monthStart(addMonths(m, 1)) - 12 * H), billAt, dueAt: billAt + 15 * D };
    // Connected load per running machine (kW): ring frame 30, loom 7, dyeing machine 22; plus lighting and compressors.
    const kwh = h.SPINNING * 30 + h.WEAVING * 7 + h.DYEING * 22 + 6000;
    expense({ ...util, subcategory: 'Electricity', description: `${m}: ${Math.round(kwh).toLocaleString('en-IN')} kWh`, payee: 'Electricity distribution company', amount: kwh * (7.6 + 0.3 * (y - 2023)), taxCode: 'ELECTRICITY' });
    const m3 = h.dyedMetres * 0.012 + 600; // ~100 L per kg of fabric dyed, ~0.12 kg per metre
    expense({ ...util, subcategory: 'Water', description: `${m}: ${Math.round(m3).toLocaleString('en-IN')} m³`, payee: 'Municipal water and sewerage board', amount: m3 * 22, taxCode: 'WATER' });
    const coal = h.dyedMetres * 0.0001; // ~0.1 kg coal per metre for dyeing steam
    expense({ ...util, subcategory: 'Steam and boiler fuel', description: `${m}: ${coal.toFixed(1)} t boiler coal`, payee: 'Bhavnagar Coal Traders', amount: coal * (8800 + 300 * (y - 2023)), taxCode: 'COAL', dueAt: billAt + 30 * D });
    const outage = r.between(6, 20);
    expense({ ...util, subcategory: 'Generator diesel', description: `${m}: ${outage.toFixed(1)} h of power cuts on DG set`, payee: 'Highway fuel station', amount: outage * 35 * dieselPrice(s), taxCode: 'FUEL', method: 'Card', billAt: 0, dueAt: undefined, incurredAt: Math.min(T, s + 15 * D), paidAt: Math.min(T, s + 15 * D) });
    expense({ ...util, subcategory: 'Wastewater treatment', description: `${m}: sewerage and discharge charges`, payee: 'Municipal water and sewerage board', amount: 9000 + m3 * 4, taxCode: 'WATER' });
    expense({ ...util, subcategory: 'Effluent treatment plant', description: `${m}: ETP operation and sludge handling`, payee: 'GreenFlow ETP Services', amount: 65000 + m3 * 9, taxCode: 'ETP', dueAt: billAt + 30 * D });

    // Fleet and logistics overheads.
    const fleet = { category: 'LOGISTICS', costCentre: 'Fleet', recurring: true };
    const salaryAt = monthStart(addMonths(m, 1)) + 11 * H;
    for (const [i, name] of ['Driver 1 (GJ-05-TX-4417)', 'Driver 2 (GJ-05-TX-4418)'].entries()) {
      expense({ ...fleet, subcategory: 'Driver salaries', description: `${m}: salary, ${name}`, payee: name, amount: 21000 * (1 + 0.06 * (y - 2023)) + i * 500, taxCode: 'SALARY', method: 'NEFT', incurredAt: salaryAt, paidAt: salaryAt });
    }
    expense({ ...fleet, subcategory: 'Courier', description: `${m}: swatches and documents`, payee: 'Swift Courier Services', amount: r.int(4, 12) * r.between(350, 900), taxCode: 'COURIER', creditDays: 15, incurredAt: Math.min(T, s + 26 * D) });
    if (+m.slice(5) % 3 === 0) {
      for (const truck of OWN_FLEET) {
        expense({ ...fleet, subcategory: 'Vehicle maintenance', description: `${m}: service and repairs, ${truck}`, payee: 'Udhna Truck Garage', amount: r.between(12000, 26000), taxCode: 'REPAIRS', creditDays: 7, incurredAt: Math.min(T, s + 10 * D) });
      }
    }
    if (m.slice(5) === '04') {
      for (const truck of OWN_FLEET) {
        expense({ ...fleet, subcategory: 'Vehicle insurance', description: `FY ${y}-${String(y + 1).slice(2)}: goods vehicle policy, ${truck}`, payee: 'General insurance company', amount: 42000 * (1 + 0.05 * (y - 2023)), taxCode: 'INSURANCE', creditDays: 0, recurring: false, incurredAt: s + 2 * D });
        expense({ ...fleet, subcategory: 'Permits', description: `FY ${y}-${String(y + 1).slice(2)}: national permit, ${truck}`, payee: 'RTO permit fees', amount: 16500, taxCode: 'GOVT_FEE', method: 'Online', recurring: false, incurredAt: s + 3 * D, paidAt: s + 3 * D });
      }
    }
  }
  expenses.sort((a, b) => a.incurredAt - b.incurredAt || a.description.localeCompare(b.description));
  expenses.forEach((e, i) => {
    e.id = `exp_${pad(i + 1, 6)}`;
    e.voucherNo = `EXP-${pad(i + 1, 5)}`;
    e.incurredAt = iso(e.incurredAt);
    e.createdAt = e.incurredAt;
  });

  // ---------- rows ----------
  const materialRows = items.map((it) => ({
    id: it.id, category: it.category, yarnType: it.name, colour: it.spec, unit: it.unit, qtyInStock: it.qtyInStock, reorderLevel: it.reorderLevel,
    avgCost: it.avgCost, supplierId: it.supplierId, leadDays: it.leadDays, sku: it.sku, subcategory: it.subcategory, department: it.department,
    taxCode: it.taxCode, isSpare: it.isSpare, createdAt: iso(START),
  }));
  const issueRows = issues.map((u) => ({
    id: nextId('iss_x'), materialId: u.it.id, orderId: u.orderId || null, jobId: u.jobId || null, department: u.department,
    qty: u.qty, cost: u.cost, issuedAt: iso(u.at),
  }));
  const supplierRows = OTHER_SUPPLIERS.map(([id, name, state, creditDays], i) => ({ id, name, phone: `98790${pad(20000 + i * 613, 5)}`, state, creditDays, createdAt: iso(START) }));
  // Weekly reorders still on the way at the as-of moment show as pending purchase orders.
  const purchaseOrders = pendingOrders
    .sort((a, b) => a.orderedAt - b.orderedAt || a.it.sku.localeCompare(b.it.sku))
    .map((p, i) => ({
      id: `po_${pad(i + 1, 6)}`, poNo: `PO-${pad(i + 1, 5)}`, materialId: p.it.id, supplierId: p.it.supplierId, orderedById: storeKeeperId,
      qty: p.qty, rate: p.it.avgCost, status: 'PENDING', orderedAt: iso(p.orderedAt), receivedAt: null, inwardId: null,
    }));
  return {
    purchaseOrders,
    materials: materialRows,
    inwards: bills.filter((b) => b.row.id.startsWith('inw_x')).map((b) => b.row),
    issues: issueRows,
    suppliers: supplierRows,
    supplierPayments,
    expenses,
  };
}

module.exports = { addAccounts, CATALOG };

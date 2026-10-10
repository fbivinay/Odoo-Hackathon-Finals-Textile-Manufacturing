// Deterministic synthetic history for Everest Textile Mills (format: docs/data-format.md).
//
// One timeline is simulated from 2023-01-01 to the as-of moment T (10:30 IST on the as-of
// date). Orders arrive, run shift by shift through spinning, weaving and dyeing on real
// machine capacity, yarn is bought and issued, rolls come off the dyeing line, QC passes,
// reworks or rejects them, trucks leave and buyers pay. Everything after T is cut away, so
// history, today's floor and the order book come out of one run and agree with each other.
//
// Pure: no database. Same as-of date in, identical dataset out.

const H = 3600 * 1000;
const D = 24 * H;
const IST = 5.5 * H;
// The mill is simulated from 1 Nov 2022 so that January 2023 opens with orders already on the floor
// and yarn already in the store; the two warm-up months carry over as opening work in progress.
const START = Date.UTC(2022, 10, 1) - IST; // 2022-11-01 00:00 IST
const SHIFT_HOURS = 8;
const SEED = 20230101;

// ---------- seeded randomness ----------

function rng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (a, b) => a + next() * (b - a),
    int: (a, b) => Math.floor(a + next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted(items, weightOf) {
      const total = items.reduce((t, x) => t + weightOf(x), 0);
      let roll = next() * total;
      for (const x of items) if ((roll -= weightOf(x)) <= 0) return x;
      return items[items.length - 1];
    },
    normal(mean, sd) {
      const u = Math.max(next(), 1e-9);
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    poisson(lambda) {
      const l = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k += 1;
        p *= next();
      } while (p > l);
      return k - 1;
    },
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
const roundTo = (n, step) => Math.round(n / step) * step;
const pad = (n, w = 4) => String(n).padStart(w, '0');
const istDay = (t) => new Date(t + IST).toISOString().slice(0, 10);
const iso = (t) => (t == null ? null : new Date(t).toISOString());
// Shifts start at 06:00, 14:00 and 22:00 IST.
const SHIFTS = ['MORNING', 'EVENING', 'NIGHT'];
const shiftIndex = (t) => Math.floor(((((t + IST - 6 * H) % D) + D) % D) / (SHIFT_HOURS * H));
const shiftOf = (t) => SHIFTS[shiftIndex(t)];
const shiftStart = (t) => {
  const offset = ((((t + IST - 6 * H) % D) + D) % D) % (SHIFT_HOURS * H);
  return t - offset;
};
const nextShiftStart = (t) => shiftStart(t) + SHIFT_HOURS * H;
// Attendance date of the shift running at t (a night shift belongs to the day it starts).
const rosterDay = (t) => istDay(shiftStart(t));
const isClosedDay = (t) => new Date(`${istDay(t)}T00:00:00Z`).getUTCDay() === 0 || HOLIDAYS.has(istDay(t));
// Move t forward into working hours (IST) on a working day: QC and the dispatch desk keep office hours.
function workingHours(t, from, to) {
  for (let i = 0; i < 30; i += 1) {
    const h = (((t + IST) / H) % 24 + 24) % 24;
    if (!isClosedDay(t) && h >= from && h < to) return t;
    t = h < from && !isClosedDay(t) ? t + (from - h) * H : t + (24 - h + from) * H;
  }
  return t;
}

// ---------- catalogue ----------

const MATERIALS = [
  ['Cotton 40s', 'Raw White', 235], ['Cotton 60s Combed', 'Raw White', 290], ['Cotton 80s Compact', 'Raw White', 360],
  ['Cotton 30s', 'Raw White', 210], ['Cotton 10s OE', 'Raw White', 160], ['Cotton 20s Rope-dyed', 'Indigo', 265],
  ['Poly-Cotton 2/40', 'Grey', 190], ['Polyester 150D Semi-dull', 'Raw White', 150], ['Polyester 75D Bright', 'Raw White', 175],
  ['Viscose 30s', 'Natural', 230], ['Linen 25s', 'Natural', 540], ['Cotton 30s Melange', 'Grey', 255],
];

// fabric → [price factor, yarn kg per m, material indexes, colours, share].
// List price = yarn cost per metre × 1.45 × factor, so yarn is roughly two thirds of the price.
const FABRICS = {
  Poplin: [1.0, 0.11, [0], ['White', 'Navy', 'Sky Blue', 'Black', 'Olive'], 14],
  Cambric: [1.05, 0.09, [1], ['White', 'Ivory', 'Peach'], 7],
  Lawn: [1.1, 0.07, [2], ['White', 'Mint', 'Lilac', 'Printed Floral'], 5],
  Twill: [0.95, 0.2, [3, 6], ['Khaki', 'Black', 'Navy', 'Olive', 'Grey'], 12],
  Denim: [1.0, 0.45, [5], ['Indigo', 'Dark Indigo', 'Stone Wash'], 11],
  Canvas: [0.95, 0.5, [4], ['Natural', 'Khaki', 'Black'], 6],
  Oxford: [1.0, 0.17, [6], ['White', 'Light Blue', 'Pink'], 9],
  Chambray: [1.05, 0.15, [11], ['Grey', 'Blue Melange'], 5],
  Satin: [1.1, 0.13, [7], ['Ivory', 'Champagne', 'Maroon', 'Black'], 9],
  Georgette: [1.15, 0.08, [8], ['Black', 'Peach', 'Teal', 'Wine'], 7],
  'Linen Suiting': [1.2, 0.22, [10], ['Beige', 'Natural', 'Sand'], 4],
  'Rayon Print': [1.05, 0.12, [9], ['Red Floral', 'Blue Paisley', 'Yellow Print'], 11],
};
const FABRIC_NAMES = Object.keys(FABRICS);

// Output per machine per 8-hour shift: spinning in kg of yarn, weaving and dyeing in metres.
const PER_SHIFT = { SPINNING: 190, WEAVING: 300, DYEING: 900 };
const MACHINES = [
  ['SP-01', 'Ring Frame 1', 'SPINNING'], ['SP-02', 'Ring Frame 2', 'SPINNING'], ['SP-03', 'Ring Frame 3', 'SPINNING'],
  ['SP-04', 'Ring Frame 4', 'SPINNING'],
  ['WV-01', 'Air-jet Loom 1', 'WEAVING'], ['WV-02', 'Air-jet Loom 2', 'WEAVING'], ['WV-03', 'Air-jet Loom 3', 'WEAVING'],
  ['WV-04', 'Rapier Loom 4', 'WEAVING'], ['WV-05', 'Rapier Loom 5', 'WEAVING'], ['WV-06', 'Rapier Loom 6', 'WEAVING'],
  ['WV-07', 'Water-jet Loom 7', 'WEAVING'], ['WV-08', 'Water-jet Loom 8', 'WEAVING'], ['WV-09', 'Air-jet Loom 9', 'WEAVING'],
  ['DY-01', 'Jet Dyeing 1', 'DYEING'], ['DY-02', 'Jet Dyeing 2', 'DYEING'], ['DY-03', 'Jigger 3', 'DYEING'],
  ['DY-04', 'Soft-flow 4', 'DYEING'],
];

const SUPPLIERS = [
  'Vardhman Yarns', 'Nahar Spinning Mills', 'Sutlej Textiles', 'Trident Yarns', 'KPR Mill Yarn Division', 'Ambika Cotton Mills',
  'Nitin Spinners', 'Sangam Yarn Co', 'Indo Count Yarns', 'Filatex Polyester', 'Reliance Polyester Yarn', 'Grasim Viscose',
  'Jaya Shree Linen', 'Banswara Syntex', 'Surat Yarn Agency', 'Raghuvir Polyfils',
];
const BUYERS = [
  'Arvind Garments', 'Raymond Apparel', 'Welspun Home', 'Aditya Birla Fashion', 'Page Industries', 'Shahi Exports', 'Gokaldas Exports',
  'Bombay Dyeing Retail', 'Siyaram Silk Mills', 'Mafatlal Fabrics', 'Fabindia Sourcing', 'Westside Sourcing', 'Max Fashion Sourcing',
  'Pantaloons Sourcing', 'Biba Apparels', 'W for Woman', 'Peter England Supply', 'Louis Philippe Supply', 'Kewal Kiran Clothing',
  'Spykar Lifestyle', 'Killer Jeans', 'Mufti Menswear', 'Zodiac Clothing', 'Cotton King', 'Indian Terrain', 'Being Human Clothing',
  'Jaipur Kurti House', 'Global Desi Supply', 'Anokhi Prints', 'Surat Saree Traders', 'Mumbai Uniform Co', 'Delhi School Uniforms',
  'Tirupur Knit Exports', 'Ludhiana Hosiery Exports', 'Bengaluru Apparel Hub', 'Chennai Linen House',
];
const FIRST = ['Ramesh', 'Suresh', 'Anita', 'Imran', 'Lakshmi', 'Mohan', 'Kavita', 'Rajesh', 'Sunita', 'Arjun', 'Pooja', 'Vijay', 'Meena', 'Sanjay', 'Farida', 'Prakash', 'Geeta', 'Dinesh', 'Rekha', 'Harish', 'Nirmala', 'Ashok', 'Shabana', 'Kiran', 'Bharat', 'Usha', 'Mahesh', 'Savita', 'Naresh', 'Jyoti'];
const LAST = ['Patel', 'Yadav', 'Kumari', 'Shaikh', 'Devi', 'Singh', 'Chauhan', 'Prajapati', 'Rathod', 'Solanki', 'Parmar', 'Desai', 'Pandey', 'Mishra', 'Khan', 'Vasava', 'Gohil', 'Bhatt'];
const DEFECTS = [['Holes', 3], ['Colour mismatch', 4], ['Uneven weaving', 3], ['Stains', 2], ['Broken ends', 2], ['Shade variation', 3]];
const HOLIDAYS = new Set([
  '2023-01-26', '2023-03-08', '2023-08-15', '2023-10-02', '2023-11-12', '2023-11-13', '2023-11-14',
  '2024-01-26', '2024-03-25', '2024-08-15', '2024-10-02', '2024-11-01', '2024-11-02', '2024-11-03',
  '2025-01-26', '2025-03-14', '2025-08-15', '2025-10-02', '2025-10-21', '2025-10-22', '2025-10-23',
  '2026-01-26', '2026-03-04', '2026-08-15', '2026-10-02', '2026-11-08', '2026-11-09', '2026-11-10',
]);
const METHODS = [['NEFT', 55], ['RTGS', 25], ['Cheque', 15], ['UPI', 5]];

// Yarn price index: seasonal swing, slow inflation, and the mid-2024 cotton spike.
function priceTrend(t) {
  const months = (t - START) / (30.44 * D);
  const season = 0.06 * Math.sin((2 * Math.PI * (months - 2)) / 12);
  // The 2024 cotton spike rises and falls over April–September rather than landing overnight.
  const a = Date.UTC(2024, 3, 1);
  const b = Date.UTC(2024, 8, 1);
  const spike = t > a && t < b ? 0.12 * Math.sin((Math.PI * (t - a)) / (b - a)) : 0;
  return 1 + season + 0.045 * (months / 12) + spike;
}
const priceIndex = (t, r) => priceTrend(t) + r.normal(0, 0.02);

// Orders per day: festive build-up Aug–Oct, monsoon dip, slow growth, plus the confirmed
// order book for the next quarter booked over the last three weeks.
function intakeRate(t, T) {
  const season = [1.0, 1.05, 1.05, 1.0, 0.97, 0.93, 0.92, 1.08, 1.12, 1.1, 0.98, 0.96][new Date(t + IST).getUTCMonth()];
  const growth = 1 + 0.07 * ((t - START) / (365 * D));
  return 1.6 * season * growth * (t > T - 21 * D ? 2.8 : 1);
}

// ---------- generator ----------

function generate({ asOfDate }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error('as-of must be YYYY-MM-DD');
  const T = Date.parse(`${asOfDate}T05:00:00Z`); // 10:30 IST, mid morning shift
  if (T < START + 400 * D) throw new Error('as-of must be after 2024-02-05');
  const r = rng(SEED);
  const counters = {};
  const id = (kind) => `${kind}_${pad((counters[kind] = (counters[kind] || 0) + 1), 6)}`;

  // ---------- masters ----------
  const users = [
    ['Mill Owner', 'owner@everest.dev', 'OWNER'], ['Store Keeper', 'store@everest.dev', 'STORE'],
    ['Floor Supervisor', 'production@everest.dev', 'PRODUCTION'], ['QC Inspector', 'qc@everest.dev', 'QC'],
    ['Dispatch Clerk', 'dispatch@everest.dev', 'DISPATCH'], ['Farida Khan', 'qc2@everest.dev', 'QC'],
    ['Harish Bhatt', 'qc3@everest.dev', 'QC'], ['Naresh Parmar', 'store2@everest.dev', 'STORE'],
  ].map(([name, email, role]) => ({ id: id('usr'), name, email, password: 'Password123', role, isActive: true, createdAt: iso(START) }));
  const inspectors = users.filter((u) => u.role === 'QC');
  const storeKeepers = users.filter((u) => u.role === 'STORE');

  const suppliers = SUPPLIERS.map((name, i) => ({ id: id('sup'), name, phone: `98250${pad(10000 + i * 731, 5)}`, createdAt: iso(START) }));
  const buyers = BUYERS.map((name, i) => ({
    id: id('buy'), name, phone: `98790${pad(20000 + i * 577, 5)}`,
    email: `purchase@${name.toLowerCase().replace(/[^a-z]+/g, '')}.in`, createdAt: iso(START),
    weight: 1 / (1 + i * 0.35), terms: r.pick([15, 30, 30, 45, 45, 60]), late: r.chance(0.15), discount: r.between(0, 0.06),
  }));
  const materials = MATERIALS.map(([yarnType, colour, base]) => ({
    id: id('mat'), yarnType, colour, unit: 'kg', base, reorderLevel: 0,
    suppliers: [r.pick(suppliers), r.pick(suppliers), r.pick(suppliers)],
  }));
  const machines = MACHINES.map(([code, name, type]) => ({
    id: id('mac'), code, name, type, status: 'IDLE', createdAt: iso(START),
    speed: r.between(0.88, 1.1), defect: r.between(0.7, 1.4), free: START, maintenance: [],
  }));
  // Preventive maintenance: one 24-hour stop every 45–75 days.
  for (const m of machines) {
    for (let t = START + r.int(5, 40) * D; t < T + 120 * D; t += r.int(45, 75) * D) {
      const a = shiftStart(t);
      m.maintenance.push([a, a + D]);
    }
  }

  const workers = [];
  for (let i = 0; i < 72; i += 1) {
    const joined = i < 62 ? START : START + r.int(200, 1100) * D;
    const left = i % 13 === 5 ? joined + r.int(300, 700) * D : null;
    workers.push({
      id: id('wrk'), code: `W-${pad(i + 1, 3)}`, name: `${FIRST[(i * 7) % FIRST.length]} ${LAST[(i * 5 + 3) % LAST.length]}`,
      shift: SHIFTS[i % 3], dailyWage: roundTo(r.between(560, 920), 10), isActive: !(left && left <= T), createdAt: iso(joined),
      joined, left: left && left <= T ? left : null, reliability: r.between(0.88, 0.97),
    });
  }

  // ---------- attendance ----------
  const attendance = [];
  const onShift = new Map(); // `${date}|${shift}` → worker ids at work
  const today = istDay(T);
  for (let day = START; day <= T; day += D) {
    const date = istDay(day + 12 * H);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0 || HOLIDAYS.has(date)) continue;
    for (const w of workers) {
      if (day + D < w.joined || (w.left && day > w.left)) continue;
      if (date === today && w.shift !== 'MORNING') continue; // at 10:30 only the morning shift has clocked in
      const x = r.next();
      const status = x < w.reliability ? 'PRESENT' : x < w.reliability + 0.03 ? 'HALF_DAY' : 'ABSENT';
      attendance.push({ id: id('att'), workerId: w.id, date, shift: w.shift, status });
      if (status !== 'ABSENT') {
        const k = `${date}|${w.shift}`;
        if (!onShift.has(k)) onShift.set(k, []);
        onShift.get(k).push(w.id);
      }
    }
  }
  const staff = (t) => {
    if (t > T) return null; // future shift: no register yet, and the job is cut at T anyway
    const list = onShift.get(`${rosterDay(t)}|${shiftOf(t)}`);
    if (!list || !list.length) throw new Error(`No one on the register for ${rosterDay(t)} ${shiftOf(t)}`);
    return r.pick(list);
  };

  // ---------- orders ----------
  const orders = [];
  for (let day = START; day <= T; day += D) {
    if (isClosedDay(day + 12 * H)) continue; // the sales office is shut on Sundays and holidays
    const n = r.poisson(intakeRate(day, T) * 7 / 6);
    for (let k = 0; k < n; k += 1) {
      const createdAt = Math.round(day + r.between(9, 17.5) * H); // office hours IST
      if (createdAt > T) continue;
      const fabric = r.weighted(FABRIC_NAMES, (f) => FABRICS[f][4]);
      const [factor, kgPerM, mats, colours] = FABRICS[fabric];
      const buyer = r.weighted(buyers, (b) => b.weight);
      const qty = Math.min(8000, Math.max(500, roundTo(Math.exp(r.normal(Math.log(2300), 0.33)), 100)));
      const material = materials[r.pick(mats)];
      const booked = createdAt > T - 21 * D && r.chance(0.7); // the extra order book for the coming quarter
      const rush = !booked && r.chance(0.18);
      const lead = booked ? r.between(25, 92) : rush ? 4 + qty / 600 + r.between(0, 3) : 14 + qty / 260 + r.between(-2, 12);
      orders.push({
        id: id('ord'), buyer, material, fabricType: fabric, colour: r.pick(colours), qty,
        yarnRequired: roundTo(qty * kgPerM * 1.04, 5),
        pricePerUnit: round2(kgPerM * 1.04 * material.base * priceTrend(createdAt) * 1.75 * factor * (1 - buyer.discount) * r.between(0.96, 1.04)),
        deadline: createdAt + Math.round(lead * D),
        createdAt, booked, cancelled: r.chance(0.02), badBatch: r.chance(0.05),
      });
    }
  }
  orders.forEach((o, i) => {
    o.orderNo = `ORD-${pad(i + 1)}`;
    o.trackingToken = `trk${pad(i + 1, 5)}${(i * 2654435761 >>> 0).toString(36)}`;
  });
  const years = (T - START) / (365 * D);
  for (const m of materials) {
    const used = orders.filter((o) => o.material === m).reduce((t, o) => t + o.yarnRequired, 0);
    m.reorderLevel = Math.max(100, roundTo((used / years / 52) * 1.5, 50)); // ~1.5 weeks of use
  }

  // ---------- production, shift by shift ----------
  const jobs = [];
  const rolls = [];
  const qc = [];

  // The mill runs three shifts round the clock, Monday to Saturday; Sundays and festival
  // holidays are off, matching the attendance register.
  const closed = (s) => {
    const day = rosterDay(s);
    return new Date(`${day}T00:00:00Z`).getUTCDay() === 0 || HOLIDAYS.has(day);
  };
  const blocked = (m, a, b) => m.maintenance.some(([x, y]) => a < y && b > x);
  function nextSlot(m, at) {
    let s = Math.max(m.free, at);
    s = s === shiftStart(s) ? s : nextShiftStart(s);
    while (closed(s) || blocked(m, s, s + SHIFT_HOURS * H)) s += SHIFT_HOURS * H;
    return s;
  }

  // Run `qty` through `stage`: consecutive shifts on one machine, one job per shift.
  // A breakdown stops the job and the rest moves to another machine.
  function runStage(order, stage, qty, ready) {
    const out = [];
    let remaining = qty;
    let at = ready;
    let avoid = null;
    while (remaining > 0.5) {
      const options = machines.filter((m) => m.type === stage && m !== avoid);
      const m = options.reduce((best, x) => (nextSlot(x, at) < nextSlot(best, at) ? x : best));
      let s = nextSlot(m, at);
      avoid = null;
      while (remaining > 0.5) {
        while (closed(s)) s += SHIFT_HOURS * H; // pick up again on the next working shift
        if (blocked(m, s, s + SHIFT_HOURS * H)) break; // maintenance: hand over to whichever machine is free
        const cap = PER_SHIFT[stage] * m.speed;
        const start = s + (out.length && out.at(-1).machine === m ? 0 : r.int(5, 40) * 60 * 1000);
        let produced = Math.min(remaining, cap);
        let end = start + Math.max(1.5 * H, (produced / cap) * (SHIFT_HOURS * H - 40 * 60 * 1000));
        let status = 'COMPLETED';
        if (r.chance(0.006)) {
          const frac = r.between(0.2, 0.8);
          end = start + (end - start) * frac;
          produced = Math.floor(produced * frac);
          status = 'STOPPED';
        }
        const job = {
          id: id('job'), order, machine: m, workerId: staff(start), stage, shift: shiftOf(start), status,
          qtyPlanned: round2(remaining), qtyProduced: round2(produced), startedAt: start, completedAt: Math.round(end),
        };
        jobs.push(job);
        out.push(job);
        remaining = round2(remaining - job.qtyProduced);
        if (status === 'STOPPED') {
          m.free = end + r.int(1, 6) * SHIFT_HOURS * H; // repair
          m.repairs = [...(m.repairs || []), [end, m.free]];
          avoid = m;
          at = end + H;
          break;
        }
        m.free = job.completedAt;
        s = nextShiftStart(start);
      }
      if (!avoid) at = Math.max(at, m.free);
    }
    return out;
  }

  // Cut dyeing output into rolls of ~1,000–1,400 m. A roll belongs to the job it was finished in.
  function rollsFrom(order, stageJobs) {
    const made = [];
    const target = () => roundTo(r.between(1000, 1400), 10);
    let want = target();
    let acc = 0;
    let prev = null;
    const flush = () => {
      if (acc > 0.5) made.push({ job: prev, qty: acc, at: prev.completedAt });
      acc = 0;
    };
    for (const job of stageJobs) {
      if (prev && prev.machine !== job.machine) flush();
      acc += job.qtyProduced;
      while (acc >= want) {
        made.push({ job, qty: want, at: job.completedAt });
        acc -= want;
        want = target();
      }
      prev = job;
    }
    flush();
    return made.map(({ job, qty, at }) => {
      const roll = { id: id('rol'), order, job, machine: job.machine, qty: round2(qty), createdAt: at, inspections: [] };
      rolls.push(roll);
      return roll;
    });
  }

  function inspect(order, roll, force) {
    const monsoon = [6, 7].includes(new Date(roll.createdAt + IST).getUTCMonth()) ? 0.03 : 0;
    const bad = (order.badBatch ? 0.2 : 0) + monsoon;
    const reject = force ? 0 : (0.03 + bad / 3) * roll.machine.defect;
    const rework = force ? 0 : (0.05 + bad / 2) * roll.machine.defect;
    let t = workingHours(roll.createdAt + Math.round(r.between(2, 20) * H), 7, 21); // inspection queue
    const record = (result) => {
      const q = {
        id: id('qc'), roll, inspectorId: r.pick(inspectors).id, result,
        defectType: result === 'PASS' ? null : r.weighted(DEFECTS, (d) => d[1])[0],
        notes: result === 'REJECT' ? r.pick(['Beyond repair, set aside as seconds', 'Buyer spec not met', 'Shade outside tolerance'])
          : result === 'REWORK' ? r.pick(['Send back for re-dye', 'Mend and re-check', 'Re-wash and re-check']) : null,
        checkedAt: t,
      };
      qc.push(q);
      roll.inspections.push(q);
    };
    const x = r.next();
    const first = x < reject ? 'REJECT' : x < reject + rework ? 'REWORK' : 'PASS';
    record(first);
    if (first === 'REWORK') {
      t = workingHours(t + Math.round(r.between(24, 48) * H), 7, 21);
      record(r.chance(0.85) ? 'PASS' : 'REJECT');
    }
  }

  // Regular orders start as soon as planned; the forward order book waits for its slot before
  // the deadline. Machines are booked in planned-start order so nothing queues behind the future.
  for (const order of orders) {
    const earliest = order.booked ? order.deadline - Math.round((12 + order.qty / 350 + r.between(5, 12)) * D) : 0;
    order.plannedStart = Math.max(order.createdAt + Math.round(r.between(6, 36) * H), earliest);
  }
  const trips = [];
  for (const order of [...orders].sort((a, b) => a.plannedStart - b.plannedStart)) {
    if (order.cancelled) {
      order.cancelledAt = order.createdAt + Math.round(r.between(1, 6) * D);
      continue;
    }
    const spin = runStage(order, 'SPINNING', order.yarnRequired, order.plannedStart);
    order.issueAt = spin[0].startedAt - 30 * 60 * 1000;
    const weave = runStage(order, 'WEAVING', roundTo(order.qty * 1.06, 10), spin.at(-1).completedAt + H);
    let dye = runStage(order, 'DYEING', weave.reduce((t, j) => t + j.qtyProduced, 0), weave.at(-1).completedAt + H);
    for (let round = 0; round < 4; round += 1) {
      const fresh = rollsFrom(order, dye);
      for (const roll of fresh) inspect(order, roll, round === 3);
      const mine = rolls.filter((x) => x.order === order);
      const passed = mine.filter((x) => x.inspections.at(-1).result === 'PASS').reduce((t, x) => t + x.qty, 0);
      if (passed >= order.qty) break;
      // Short after QC: dye a top-up lot from spare grey fabric.
      const lastCheck = Math.max(...mine.map((x) => x.inspections.at(-1).checkedAt));
      dye = runStage(order, 'DYEING', roundTo((order.qty - passed) * 1.12 + 50, 10), lastCheck + 2 * H);
    }
    const mine = rolls.filter((x) => x.order === order);
    const good = mine.filter((x) => x.inspections.at(-1).result === 'PASS').sort((a, b) => a.inspections.at(-1).checkedAt - b.inspections.at(-1).checkedAt);
    const resolved = Math.max(...mine.map((x) => x.inspections.at(-1).checkedAt));
    if (good.length >= 4 && r.chance(0.28)) {
      const half = good.slice(0, Math.floor(good.length / 2));
      const firstAt = workingHours(half.at(-1).inspections.at(-1).checkedAt + Math.round(r.between(4, 24) * H), 9, 18);
      if (firstAt < resolved) {
        trips.push({ order, at: firstAt, rolls: half });
        trips.push({ order, at: workingHours(resolved + Math.round(r.between(4, 40) * H), 9, 18), rolls: good.slice(half.length) });
        continue;
      }
    }
    trips.push({ order, at: workingHours(resolved + Math.round(r.between(4, 40) * H), 9, 18), rolls: good });
  }

  // ---------- yarn ledger: purchases and issues in time order ----------
  const inwards = [];
  const issues = [];
    const stock = new Map(materials.map((m) => [m, { qty: 0, cost: 0 }]));
  const receive = (m, qty, at, order, premium = 1) => {
    const rate = round2(m.base * priceIndex(at, r) * premium);
    const s = stock.get(m);
    s.cost = (s.qty * s.cost + qty * rate) / (s.qty + qty);
    s.qty += qty;
    inwards.push({
      id: id('inw'), materialId: m.id, supplierId: r.pick(m.suppliers).id, orderId: order ? order.id : null,
      receivedById: r.pick(storeKeepers).id, qty, rate, billAmount: round2(qty * rate), receivedAt: Math.round(at),
    });
  };
  // Opening stock: four weeks of use, delivered before the first order is issued.
  for (const m of materials) receive(m, roundTo(m.reorderLevel * 2.7, 50), START + Math.round(r.between(30, 40) * H), null);
  const planned = orders.filter((o) => o.issueAt).sort((a, b) => a.issueAt - b.issueAt); // the store sees the plan
  const draws = planned.filter((o) => o.issueAt <= T);

  // Purchasing: every Monday the store tops each yarn up to what the next two weeks of issues
  // need plus a safety stock, so bills follow consumption instead of landing in lumps. An
  // urgent truck (at a premium) covers the rare order that still finds the shelf short.
  const reviews = [];
  for (let t = START + 7 * D; t <= T; t += D) {
    if (new Date(t + IST).getUTCDay() === 1) reviews.push(t + 10 * H);
  }
  const events = [
    ...draws.map((o) => ({ at: o.issueAt, order: o })),
    ...reviews.map((at) => ({ at, review: true })),
  ].sort((a, b) => a.at - b.at || (a.review ? -1 : 1));
  // The week's order arrives as two or three trucks spread over its working days.
  const pending = [];
  const workdays = (monday) =>
    [0, 1, 2, 3, 4, 5].map((d) => monday + d * D).filter((t) => !HOLIDAYS.has(istDay(t)));
  const flush = (until) => {
    pending.sort((a, b) => a.at - b.at);
    while (pending.length && pending[0].at <= until) {
      const p = pending.shift();
      receive(p.m, p.qty, p.at, null);
    }
  };
  for (const e of events) {
    flush(e.at);
    if (e.review) {
      for (const m of materials) {
        const needIn = (days) =>
          planned.filter((o) => o.material === m && o.issueAt > e.at && o.issueAt <= e.at + days * D).reduce((t, o) => t + o.yarnRequired, 0);
        const used = issues.filter((x) => x.materialId === m.id && x.issuedAt > e.at - 28 * D).reduce((t, x) => t + x.qty, 0);
        const weekly = used / 4;
        const have = stock.get(m).qty;
        // Replenish what the floor has been using, steered a quarter of the way toward the
        // stock the next two weeks of the plan need. Bills then follow consumption smoothly.
        const target = needIn(14) + m.reorderLevel;
        let buy = weekly > 0 ? weekly + 0.15 * (target - have) : target - have;
        if (weekly > 0) buy = Math.min(Math.max(buy, 0.7 * weekly), 1.3 * weekly);
        buy = roundTo(buy, 50);
        if (buy < 100) continue;
        const days = workdays(e.at - 2 * H);
        const trucks = Math.min(days.length, buy >= 1500 ? 3 : buy >= 600 ? 2 : 1);
        const picks = [...days].sort(() => r.next() - 0.5).slice(0, trucks).sort((a, b) => a - b);
        let left = buy;
        picks.forEach((day, i) => {
          const qty = i === picks.length - 1 ? left : roundTo(buy / trucks, 50);
          left -= qty;
          if (qty > 0) pending.push({ m, qty, at: day - Math.round(r.between(10, 90) * 60 * 1000) });
        });
      }
      continue;
    }
    const o = e.order;
    const m = o.material;
    const s = stock.get(m);
    // A truck already booked for later this week is pulled forward before paying for an urgent one.
    if (s.qty < o.yarnRequired) {
      const due = pending.filter((p) => p.m === m).sort((a, b) => a.at - b.at);
      for (const p of due) {
        if (s.qty >= o.yarnRequired) break;
        pending.splice(pending.indexOf(p), 1);
        receive(m, p.qty, o.issueAt - Math.round(r.between(2, 6) * H), null);
      }
    }
    if (s.qty < o.yarnRequired) {
      receive(m, roundTo(o.yarnRequired - s.qty + 50, 50), o.issueAt - Math.round(r.between(3, 10) * H), o, 1.06);
    }
    s.qty = round2(s.qty - o.yarnRequired);
    issues.push({ id: id('iss'), materialId: m.id, orderId: o.id, qty: o.yarnRequired, cost: round2(o.yarnRequired * s.cost), issuedAt: o.issueAt });
  }
  flush(T);
  inwards.sort((a, b) => a.receivedAt - b.receivedAt);

  // ---------- cut at T ----------
  const keptJobs = jobs.filter((j) => j.startedAt <= T);
  const logs = [];
  for (const j of keptJobs) {
    if (j.completedAt > T) {
      // On the floor right now: report what has been made so far this shift.
      j.status = 'RUNNING';
      const done = Math.floor(j.qtyProduced * Math.min(1, (T - 20 * 60 * 1000 - j.startedAt) / (j.completedAt - j.startedAt)));
      j.completedAt = null;
      j.qtyProduced = Math.max(0, done);
      if (j.qtyProduced > 0) logs.push({ job: j, qty: j.qtyProduced, at: T - 20 * 60 * 1000 });
    } else {
      logs.push({ job: j, qty: j.qtyProduced, at: j.completedAt });
    }
  }

  // This morning a loom broke down mid-shift; one machine is on planned maintenance.
  const runningNow = keptJobs.filter((j) => j.status === 'RUNNING');
  const brokenJob = runningNow.find((j) => j.stage === 'WEAVING');
  if (brokenJob) {
    brokenJob.status = 'STOPPED';
    brokenJob.completedAt = T - 50 * 60 * 1000;
    const log = logs.find((l) => l.job === brokenJob);
    if (log) log.at = brokenJob.completedAt;
    brokenJob.machine.now = 'BREAKDOWN';
  }
  for (const m of machines) {
    if (!m.now && (m.repairs || []).some(([a, b]) => a <= T && T < b)) m.now = 'BREAKDOWN';
    if (!m.now && m.maintenance.some(([a, b]) => a <= T && T < b)) m.now = 'MAINTENANCE';
    if (!m.now) m.now = keptJobs.some((j) => j.machine === m && j.status === 'RUNNING') ? 'RUNNING' : 'IDLE';
  }
  if (!machines.some((m) => m.now === 'MAINTENANCE')) {
    const idle = machines.filter((m) => m.now === 'IDLE');
    if (idle.length) idle[idle.length - 1].now = 'MAINTENANCE';
  }

  const keptRolls = rolls.filter((x) => x.createdAt <= T).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  keptRolls.forEach((x, i) => (x.rollNo = `ROLL-${pad(i + 1)}`));
  const keptQc = qc.filter((q) => q.checkedAt <= T && q.roll.createdAt <= T);
  const keptTrips = trips.filter((t) => t.at <= T).sort((a, b) => a.at - b.at);
  const dispatches = [];
  const invoices = [];
  const payments = [];
  keptTrips.forEach((trip, i) => {
    const d = {
      id: id('dsp'), dispatchNo: `DSP-${pad(i + 1)}`, orderId: trip.order.id, buyerId: trip.order.buyer.id,
      vehicleNo: `GJ-05-${String.fromCharCode(65 + r.int(0, 25))}${String.fromCharCode(65 + r.int(0, 25))}-${r.int(1000, 9999)}`,
      dispatchedAt: trip.at,
    };
    dispatches.push(d);
    trip.rolls.forEach((x) => (x.dispatch = d));
    const amount = round2(trip.rolls.reduce((t, x) => t + x.qty, 0) * trip.order.pricePerUnit);
    const inv = { id: id('inv'), invoiceNo: `INV-${pad(i + 1)}`, dispatchId: d.id, amount, issuedAt: trip.at };
    invoices.push(inv);
    const b = trip.order.buyer;
    if (r.chance(0.015)) return; // never paid: stays on the books
    const due = trip.at + Math.round((b.terms + r.between(-5, b.late ? 45 : 12)) * D);
    const method = () => r.weighted(METHODS, (m) => m[1])[0];
    if (r.chance(0.15)) {
      const first = round2(amount * r.between(0.4, 0.7));
      payments.push({ id: id('pay'), invoiceId: inv.id, amount: first, method: method(), paidAt: due });
      payments.push({ id: id('pay'), invoiceId: inv.id, amount: round2(amount - first), method: method(), paidAt: due + Math.round(r.between(15, 35) * D) });
    } else {
      payments.push({ id: id('pay'), invoiceId: inv.id, amount, method: method(), paidAt: due });
    }
  });
  const keptPayments = payments.filter((p) => p.paidAt <= T);
  for (const inv of invoices) {
    const paid = round2(keptPayments.filter((p) => p.invoiceId === inv.id).reduce((t, p) => t + p.amount, 0));
    inv.status = paid <= 0 ? 'UNPAID' : Math.abs(paid - inv.amount) < 0.011 ? 'PAID' : 'PARTIAL';
  }

  for (const x of keptRolls) {
    const last = x.inspections.filter((q) => q.checkedAt <= T).at(-1);
    if (x.dispatch && x.dispatch.dispatchedAt <= T) x.status = 'DISPATCHED';
    else {
      x.dispatch = null;
      x.status = !last ? 'PENDING_QC' : { PASS: 'PASSED', REWORK: 'REWORK', REJECT: 'REJECTED' }[last.result];
    }
  }

  // Wages: a month is paid on the 5th of the next, at exactly what the register earned.
  const wagePayments = [];
  const earned = new Map();
  const wageOf = new Map(workers.map((w) => [w.id, w.dailyWage]));
  for (const a of attendance) {
    const k = `${a.workerId}|${a.date.slice(0, 7)}`;
    earned.set(k, (earned.get(k) || 0) + (a.status === 'PRESENT' ? 1 : a.status === 'HALF_DAY' ? 0.5 : 0) * wageOf.get(a.workerId));
  }
  for (const [k, amount] of earned) {
    const [workerId, month] = k.split('|');
    const [y, mo] = month.split('-').map(Number);
    const paidAt = Date.UTC(y, mo, 5, 6, 30);
    if (paidAt <= T && amount > 0) wagePayments.push({ id: id('wage'), workerId, month, amount: round2(amount), paidAt: iso(paidAt) });
  }

  // ---------- flat rows ----------
  const data = {
    User: users,
    Supplier: suppliers,
    Buyer: buyers.map(({ id: bid, name, phone, email, createdAt }) => ({ id: bid, name, phone, email, createdAt })),
    RawMaterial: materials.map((m) => ({ id: m.id, yarnType: m.yarnType, colour: m.colour, unit: m.unit, qtyInStock: round2(stock.get(m).qty), reorderLevel: m.reorderLevel, avgCost: round2(stock.get(m).cost), createdAt: iso(START) })),
    Worker: workers.map(({ id: wid, code, name, shift, dailyWage, isActive, createdAt }) => ({ id: wid, code, name, shift, dailyWage, isActive, createdAt })),
    Machine: machines.map((m) => ({ id: m.id, code: m.code, name: m.name, type: m.type, status: m.now, createdAt: m.createdAt })),
    Order: orders.map((o) => ({
      id: o.id, orderNo: o.orderNo, trackingToken: o.trackingToken, buyerId: o.buyer.id, materialId: o.material.id, fabricType: o.fabricType,
      colour: o.colour, qty: o.qty, yarnRequired: o.yarnRequired, pricePerUnit: o.pricePerUnit, deadline: iso(o.deadline), status: 'PENDING',
      createdAt: iso(o.createdAt), cancelled: Boolean(o.cancelled && o.cancelledAt <= T),
    })),
    MaterialInward: inwards.map((i) => ({ ...i, receivedAt: iso(i.receivedAt) })),
    MaterialIssue: issues.map((i) => ({ ...i, issuedAt: iso(i.issuedAt) })),
    ProductionJob: keptJobs.map((j) => ({
      id: j.id, orderId: j.order.id, machineId: j.machine.id, workerId: j.workerId, stage: j.stage, shift: j.shift, status: j.status,
      qtyPlanned: j.qtyPlanned, qtyProduced: j.qtyProduced, startedAt: iso(j.startedAt), completedAt: iso(j.completedAt),
    })),
    ProductionLog: logs.map((l, i) => ({ id: `log_${pad(i + 1, 6)}`, jobId: l.job.id, machineId: l.job.machine.id, qty: l.qty, loggedAt: iso(l.at) })),
    Dispatch: dispatches.map((d) => ({ ...d, dispatchedAt: iso(d.dispatchedAt) })),
    Roll: keptRolls.map((x) => ({
      id: x.id, rollNo: x.rollNo, orderId: x.order.id, machineId: x.machine.id, jobId: x.job.id,
      dispatchId: x.dispatch ? x.dispatch.id : null, qty: x.qty, status: x.status, createdAt: iso(x.createdAt),
    })),
    QCRecord: keptQc.map((q) => ({ id: q.id, rollId: q.roll.id, inspectorId: q.inspectorId, result: q.result, defectType: q.defectType, notes: q.notes, checkedAt: iso(q.checkedAt) })),
    Invoice: invoices.map((i) => ({ ...i, issuedAt: iso(i.issuedAt) })),
    Payment: keptPayments.map((p) => ({ ...p, paidAt: iso(p.paidAt) })),
    Attendance: attendance,
    WagePayment: wagePayments,
  };
  syncOrderStatuses(data);
  for (const o of data.Order) delete o.cancelled;
  return { data, asOf: iso(T) };
}

// Same rule as orderService.syncStatus and the dataset checker.
function syncOrderStatuses(data) {
  const rollsBy = new Map();
  for (const x of data.Roll) rollsBy.set(x.orderId, [...(rollsBy.get(x.orderId) || []), x]);
  const jobsBy = new Map();
  for (const j of data.ProductionJob) jobsBy.set(j.orderId, [...(jobsBy.get(j.orderId) || []), j]);
  for (const o of data.Order) {
    if (o.cancelled || o.status === 'CANCELLED') {
      o.status = 'CANCELLED';
      continue;
    }
    const rolls = rollsBy.get(o.id) || [];
    const mine = [...(jobsBy.get(o.id) || [])].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const qtyOf = (s) => rolls.filter((x) => x.status === s).reduce((t, x) => t + x.qty, 0);
    const passed = rolls.filter((x) => x.status === 'PASSED');
    let status = mine[0]?.stage || 'PENDING';
    if (mine.some((j) => j.status === 'RUNNING')) status = mine.find((j) => j.status === 'RUNNING').stage;
    else if (rolls.some((x) => x.status === 'PENDING_QC' || x.status === 'REWORK')) status = 'QC';
    else if (passed.length === 0 && qtyOf('DISPATCHED') >= o.qty) status = 'DISPATCHED';
    else if (passed.length > 0 && qtyOf('DISPATCHED') + qtyOf('PASSED') >= o.qty) status = 'READY';
    o.status = status;
  }
}

module.exports = { generate, syncOrderStatuses, PER_SHIFT, SHIFT_HOURS, HOLIDAYS, round2, pad };

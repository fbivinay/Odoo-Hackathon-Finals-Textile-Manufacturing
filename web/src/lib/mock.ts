// In-memory stand-in for the backend (VITE_USE_MOCKS=true). Same paths and shapes the real
// API should return — see the endpoint list at the bottom. Resets on reload.
// ponytail: no role checks here; the backend enforces requireRole.
import { decodeToken, getToken } from './token.ts'
import { ownerReport } from './textile.ts'
import type {
  Dispatch, Invoice, Machine, MachineBoardRow, MaterialInward, Order, OrderStatus, Payment,
  ProductionJob, QCRecord, QCResult, RawMaterial, Ref, Role, Roll, Shift, Stage, Tracking, User,
} from '@/types'

const LATENCY = 250
const DAY = 86400000
const now = Date.now()
const ago = (days: number, hours = 0) => new Date(now - days * DAY - hours * 3600000).toISOString()
const ahead = (days: number) => new Date(now + days * DAY).toISOString()
const dec = (v: number) => v.toFixed(2)
const num = (v: string) => Number(v) || 0
let seq = 100
const id = (p: string) => `${p}_${++seq}`

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

// ---------- seed ----------

const ROLES: Role[] = ['OWNER', 'STORE', 'PRODUCTION', 'QC', 'DISPATCH']
const users: User[] = ROLES.map((role, i) => ({
  id: `usr_${i + 1}`,
  name: ['Ramesh Agarwal', 'Sunita Patil', 'Imran Shaikh', 'Kavya Nair', 'Deepak Yadav'][i],
  email: `${role.toLowerCase()}@everest.dev`,
  role,
}))

const suppliers: Ref[] = ['Vardhman Yarns', 'Nahar Spinning', 'Sutlej Textiles'].map((name, i) => ({ id: `sup_${i + 1}`, name }))
const buyers: Ref[] = ['Arvind Garments', 'Raymond Apparel', 'Welspun Home', 'Trident Exports'].map((name, i) => ({ id: `buy_${i + 1}`, name }))

const materials: RawMaterial[] = (
  [
    ['Cotton 30s', 'Raw White', 1200, 300, 210],
    ['Cotton 40s', 'Raw White', 260, 300, 240],
    ['Polyester 150D', 'Black', 800, 200, 165],
    ['Viscose 30s', 'Natural', 90, 150, 230],
    ['Linen 25s', 'Natural', 420, 100, 520],
    ['Poly-Cotton 2/40', 'Grey', 640, 200, 190],
  ] as const
).map(([yarnType, colour, stock, reorder, cost], i) => ({
  id: `mat_${i + 1}`, yarnType, colour, unit: 'kg', qtyInStock: dec(stock), reorderLevel: dec(reorder), avgCost: dec(cost),
}))

const machines: Machine[] = (
  [
    ['SP-01', 'Ring Frame 1', 'SPINNING', 'RUNNING'],
    ['SP-02', 'Ring Frame 2', 'SPINNING', 'BREAKDOWN'],
    ['SP-03', 'Ring Frame 3', 'SPINNING', 'IDLE'],
    ['WV-01', 'Air-jet Loom 1', 'WEAVING', 'IDLE'],
    ['WV-02', 'Air-jet Loom 2', 'WEAVING', 'RUNNING'],
    ['WV-03', 'Rapier Loom 3', 'WEAVING', 'IDLE'],
    ['WV-04', 'Rapier Loom 4', 'WEAVING', 'MAINTENANCE'],
    ['DY-01', 'Jet Dyer 1', 'DYEING', 'RUNNING'],
    ['DY-02', 'Jigger 2', 'DYEING', 'IDLE'],
  ] as const
).map(([code, name, type, status], i) => ({ id: `mac_${i + 1}`, code, name, type, status }))

type OrderRow = Omit<Order, 'buyer' | 'material'>
const orders: OrderRow[] = (
  [
    [1, 1, 'Poplin', 'Navy', 4000, 800, 145, -2, 'DISPATCHED', 24],
    [2, 5, 'Linen Suiting', 'Beige', 1200, 300, 410, 3, 'READY', 20],
    [3, 2, 'Terry Towel', 'White', 3000, 900, 95, 5, 'QC', 18],
    [4, 3, 'Twill', 'Black', 2500, 500, 120, 8, 'DYEING', 14],
    [1, 6, 'Oxford', 'Grey', 1800, 360, 130, 2, 'WEAVING', 10],
    [2, 1, 'Satin', 'Ivory', 1500, 320, 160, 12, 'SPINNING', 4],
    [3, 4, 'Rayon Print', 'Red', 1000, 250, 150, 15, 'PENDING', 1],
    [4, 2, 'Denim', 'Indigo', 2200, 600, 175, 20, 'PENDING', 0],
  ] as const
).map(([b, m, fabricType, colour, qty, yarn, price, due, status, created], i) => ({
  id: `ord_${i + 1}`,
  orderNo: `ORD-${1001 + i}`,
  trackingToken: `trk${(i + 1) * 7919}x${1001 + i}`,
  buyerId: `buy_${b}`,
  materialId: `mat_${m}`,
  fabricType, colour,
  qty: dec(qty), yarnRequired: dec(yarn), pricePerUnit: dec(price),
  deadline: ahead(due), status: status as OrderStatus, createdAt: ago(created),
}))

const issues: { id: string; materialId: string; orderId: string; qty: string; cost: string; issuedAt: string }[] =
  orders.slice(0, 6).map((o) => {
    const m = materials.find((x) => x.id === o.materialId)!
    return { id: id('iss'), materialId: m.id, orderId: o.id, qty: o.yarnRequired, cost: dec(num(o.yarnRequired) * num(m.avgCost)), issuedAt: o.createdAt }
  })

type InwardRow = Omit<MaterialInward, 'material' | 'supplier' | 'order'> & { receivedById: string }
const inwards: InwardRow[] = (
  [[1, 1, 500, 205, 12], [3, 2, 300, 168, 9], [5, 3, 200, 515, 7], [2, 1, 400, 238, 5], [6, 2, 350, 192, 3], [4, 3, 120, 228, 1]] as const
).map(([m, s, qty, rate, d]) => ({
  id: id('inw'), materialId: `mat_${m}`, supplierId: `sup_${s}`, orderId: null, receivedById: 'usr_2',
  qty: dec(qty), rate: dec(rate), billAmount: dec(qty * rate), receivedAt: ago(d, 3),
}))

type JobRow = Omit<ProductionJob, 'order'> & { workerId: string | null }
const jobs: JobRow[] = []
function seedJob(o: number, mac: number, stage: Stage, shift: Shift, planned: number, produced: number, days: number, done: boolean) {
  jobs.push({
    id: id('job'), orderId: `ord_${o}`, machineId: `mac_${mac}`, workerId: null, stage, shift,
    status: done ? 'COMPLETED' : 'RUNNING', qtyPlanned: dec(planned), qtyProduced: dec(produced),
    startedAt: ago(days), completedAt: done ? ago(days - 1) : null,
  })
}
seedJob(1, 1, 'SPINNING', 'MORNING', 800, 800, 22, true)
seedJob(1, 4, 'WEAVING', 'EVENING', 4000, 4000, 18, true)
seedJob(1, 8, 'DYEING', 'MORNING', 4000, 4000, 9, true)
seedJob(2, 3, 'SPINNING', 'NIGHT', 300, 300, 17, true)
seedJob(2, 6, 'WEAVING', 'MORNING', 1200, 1200, 13, true)
seedJob(2, 9, 'DYEING', 'EVENING', 1200, 1200, 8, true)
seedJob(3, 2, 'SPINNING', 'MORNING', 900, 900, 15, true)
seedJob(3, 5, 'WEAVING', 'NIGHT', 3000, 3000, 9, true)
seedJob(3, 9, 'DYEING', 'MORNING', 3000, 3000, 5, true)
seedJob(4, 1, 'SPINNING', 'EVENING', 500, 500, 11, true)
seedJob(4, 4, 'WEAVING', 'MORNING', 2500, 2500, 6, true)
seedJob(4, 8, 'DYEING', 'MORNING', 2500, 1600, 2, false)
seedJob(5, 3, 'SPINNING', 'MORNING', 360, 360, 7, true)
seedJob(5, 5, 'WEAVING', 'EVENING', 1800, 950, 2, false)
seedJob(6, 1, 'SPINNING', 'MORNING', 320, 140, 1, false)

// Output entries per machine, so "produced today" reflects work done today, not job start.
const outputLog: { machineId: string; qty: number; at: string }[] = jobs
  .filter((j) => j.status === 'RUNNING')
  .map((j) => ({ machineId: j.machineId, qty: Math.round(num(j.qtyProduced) * 0.3), at: ago(0, 1) }))

type RollRow = Omit<Roll, 'order' | 'machine'>
const rolls: RollRow[] = []
let rollSeq = 0
function seedRoll(o: number, mac: number, qty: number, status: Roll['status'], days: number, dispatchId: string | null = null) {
  const job = jobs.find((j) => j.orderId === `ord_${o}` && j.stage === 'DYEING')
  rolls.push({
    id: id('rol'), rollNo: `R-${String(++rollSeq).padStart(4, '0')}`, orderId: `ord_${o}`, machineId: `mac_${mac}`,
    jobId: job?.id ?? null, dispatchId, qty: dec(qty), status, createdAt: ago(days, 2),
  })
}
const DISPATCH_1 = 'dis_1'
for (let i = 0; i < 8; i++) seedRoll(1, 8, 500, 'DISPATCHED', 8, DISPATCH_1)
for (let i = 0; i < 3; i++) seedRoll(2, 9, 400, 'PASSED', 7)
;(['PASSED', 'PASSED', 'PENDING_QC', 'PENDING_QC', 'REWORK', 'REJECTED'] as const).forEach((s) => seedRoll(3, 9, 500, s, 4))
seedRoll(4, 8, 300, 'PENDING_QC', 0)
seedRoll(4, 8, 300, 'PENDING_QC', 0)

type QCRow = Omit<QCRecord, 'roll' | 'inspector'> & { inspectorId: string }
const qcRecords: QCRow[] = rolls
  .filter((r) => r.status !== 'PENDING_QC')
  .map((r) => {
    const result: QCResult = r.status === 'REWORK' ? 'REWORK' : r.status === 'REJECTED' ? 'REJECT' : 'PASS'
    const defectType = result === 'REWORK' ? 'Colour mismatch' : result === 'REJECT' ? 'Holes' : null
    return { id: id('qc'), rollId: r.id, inspectorId: 'usr_4', result, defectType, notes: null, checkedAt: ago(3) }
  })

type DispatchRow = { id: string; dispatchNo: string; orderId: string; buyerId: string; vehicleNo: string | null; dispatchedAt: string }
const dispatches: DispatchRow[] = [{ id: DISPATCH_1, dispatchNo: 'DSP-501', orderId: 'ord_1', buyerId: 'buy_1', vehicleNo: 'GJ-05-AB-4821', dispatchedAt: ago(5) }]
type InvoiceRow = Omit<Invoice, 'payments'> & { dispatchId: string }
const invoices: InvoiceRow[] = [{ id: 'inv_1', invoiceNo: 'INV-501', dispatchId: DISPATCH_1, amount: dec(4000 * 145), status: 'PARTIAL', issuedAt: ago(5) }]
const payments: (Payment & { invoiceId: string })[] = [{ id: id('pay'), invoiceId: 'inv_1', amount: dec(300000), method: 'NEFT', paidAt: ago(2) }]

const month = (d: number) => new Date(now - d).toISOString().slice(0, 7)
const wages = Array.from({ length: 12 }, (_, i) => [
  { month: month(0), amount: dec(26 * (550 + (i % 5) * 50)) },
  { month: month(31 * DAY), amount: dec(25 * (550 + (i % 5) * 50)) },
]).flat()

// ---------- joins ----------

const byId = <T extends { id: string }>(rows: T[], rid: string) => rows.find((r) => r.id === rid)
const orderRef = (oid: string) => {
  const o = byId(orders, oid)!
  return { id: o.id, orderNo: o.orderNo, fabricType: o.fabricType, colour: o.colour }
}
const fullOrder = (o: OrderRow): Order => ({ ...o, buyer: byId(buyers, o.buyerId)!, material: o.materialId ? byId(materials, o.materialId)! : null })
const fullRoll = (r: RollRow): Roll => {
  const m = byId(machines, r.machineId)!
  return { ...r, order: orderRef(r.orderId), machine: { id: m.id, code: m.code, type: m.type } }
}
const fullJob = ({ workerId: _w, ...j }: JobRow): ProductionJob => ({ ...j, order: orderRef(j.orderId) })
const fullDispatch = (d: DispatchRow): Dispatch => {
  const o = byId(orders, d.orderId)!
  const inv = invoices.find((i) => i.dispatchId === d.id)
  return {
    id: d.id, dispatchNo: d.dispatchNo, vehicleNo: d.vehicleNo, dispatchedAt: d.dispatchedAt,
    order: { id: o.id, orderNo: o.orderNo, fabricType: o.fabricType, colour: o.colour, pricePerUnit: o.pricePerUnit },
    buyer: byId(buyers, d.buyerId)!,
    rolls: rolls.filter((r) => r.dispatchId === d.id).map(({ id, rollNo, qty }) => ({ id, rollNo, qty })),
    invoice: inv ? { id: inv.id, invoiceNo: inv.invoiceNo, amount: inv.amount, status: inv.status, issuedAt: inv.issuedAt, payments: payments.filter((p) => p.invoiceId === inv.id) } : null,
  }
}
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()
const rollQty = (oid: string, statuses: Roll['status'][]) =>
  rolls.filter((r) => r.orderId === oid && statuses.includes(r.status)).reduce((a, r) => a + num(r.qty), 0)

function currentUser(): User {
  const sub = decodeToken(getToken() ?? '')?.sub
  return byId(users, sub ?? '') ?? fail('UNAUTHORIZED', 'Please sign in again.')
}

function fakeJwt(u: User) {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '')
  return `${b64({ alg: 'none' })}.${b64({ sub: u.id, role: u.role, exp: Math.floor(now / 1000) + 86400 })}.mock`
}

// ---------- router ----------

export async function mockRequest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  await new Promise((r) => setTimeout(r, LATENCY))
  return structuredClone(handle(path, (init.method ?? 'GET').toUpperCase(), (init.body ?? {}) as Record<string, any>)) as T
}

function handle(path: string, method: string, body: Record<string, any>): unknown {
  const [route, qs] = path.split('?')
  const query = new URLSearchParams(qs)
  const seg = route.split('/').filter(Boolean)
  const is = (m: string, pattern: string) =>
    m === method && pattern.split('/').filter(Boolean).every((p, i) => p.startsWith(':') || p === seg[i]) && pattern.split('/').filter(Boolean).length === seg.length

  // auth
  if (is('POST', '/auth/signin')) {
    const u = users.find((x) => x.email === String(body.email).toLowerCase())
    if (!u || body.password !== 'Password123') fail('UNAUTHORIZED', 'Invalid email or password')
    return { token: fakeJwt(u), user: u }
  }
  if (is('GET', '/me')) return currentUser()

  // public tracking
  if (is('GET', '/track/:token')) {
    const o = orders.find((x) => x.trackingToken === seg[1]) ?? fail('NOT_FOUND', 'No order found for this tracking link.')
    const lastJob = jobs.filter((j) => j.orderId === o.id).at(-1)
    const t: Tracking = {
      orderNo: o.orderNo, buyerName: byId(buyers, o.buyerId)!.name, fabricType: o.fabricType, colour: o.colour,
      qty: o.qty, deadline: o.deadline, status: o.status,
      producedQty: dec(rollQty(o.id, ['PENDING_QC', 'PASSED', 'REWORK', 'REJECTED', 'DISPATCHED'])),
      passedQty: dec(rollQty(o.id, ['PASSED', 'DISPATCHED'])),
      dispatchedQty: dec(rollQty(o.id, ['DISPATCHED'])),
      updatedAt: lastJob?.startedAt ?? o.createdAt,
    }
    return t
  }

  currentUser()

  // lookups
  if (is('GET', '/suppliers')) return suppliers
  if (is('GET', '/buyers')) return buyers
  if (is('GET', '/materials')) return materials

  // store
  if (is('GET', '/inwards'))
    return [...inwards].reverse().map(({ receivedById: _r, ...i }) => ({
      ...i, material: byId(materials, i.materialId)!, supplier: byId(suppliers, i.supplierId)!,
      order: i.orderId ? { id: i.orderId, orderNo: byId(orders, i.orderId)!.orderNo } : null,
    }))
  if (is('POST', '/inwards')) {
    const m = byId(materials, body.materialId) ?? fail('NOT_FOUND', 'Pick a yarn.')
    if (!byId(suppliers, body.supplierId)) fail('NOT_FOUND', 'Pick a supplier.')
    const qty = Number(body.qty), rate = Number(body.rate)
    if (!(qty > 0) || !(rate > 0)) fail('BAD_REQUEST', 'Quantity and rate must be positive.')
    const stock = num(m.qtyInStock)
    m.avgCost = dec((stock * num(m.avgCost) + qty * rate) / (stock + qty))
    m.qtyInStock = dec(stock + qty)
    const row: InwardRow = {
      id: id('inw'), materialId: m.id, supplierId: body.supplierId, orderId: body.orderId || null, receivedById: currentUser().id,
      qty: dec(qty), rate: dec(rate), billAmount: dec(qty * rate), receivedAt: new Date().toISOString(),
    }
    inwards.push(row)
    return row
  }

  // orders
  if (is('GET', '/orders')) return [...orders].reverse().map(fullOrder)
  if (is('POST', '/orders')) {
    if (!byId(buyers, body.buyerId)) fail('BAD_REQUEST', 'Pick a buyer.')
    if (!body.fabricType || !(Number(body.qty) > 0) || !body.deadline) fail('BAD_REQUEST', 'Fabric, quantity and deadline are required.')
    const n = orders.length + 1001
    const row: OrderRow = {
      id: id('ord'), orderNo: `ORD-${n}`, trackingToken: `trk${Date.now().toString(36)}`, buyerId: body.buyerId,
      materialId: body.materialId || null, fabricType: body.fabricType, colour: body.colour ?? '',
      qty: dec(Number(body.qty)), yarnRequired: dec(Number(body.yarnRequired) || 0), pricePerUnit: dec(Number(body.pricePerUnit) || 0),
      deadline: new Date(body.deadline).toISOString(), status: 'PENDING', createdAt: new Date().toISOString(),
    }
    orders.push(row)
    return fullOrder(row)
  }
  if (is('PATCH', '/orders/:id')) {
    const o = byId(orders, seg[1]) ?? fail('NOT_FOUND', 'Order not found.')
    if (body.status) o.status = body.status
    return fullOrder(o)
  }

  // production
  if (is('GET', '/machines'))
    return machines.map((m): MachineBoardRow => {
      const job = jobs.find((j) => j.machineId === m.id && j.status === 'RUNNING')
      const today = outputLog.filter((o) => o.machineId === m.id && isToday(o.at)).reduce((a, o) => a + o.qty, 0)
      return { ...m, currentJob: job ? fullJob(job) : null, producedToday: dec(today) }
    })
  if (is('PATCH', '/machines/:id')) {
    const m = byId(machines, seg[1]) ?? fail('NOT_FOUND', 'Machine not found.')
    if (jobs.some((j) => j.machineId === m.id && j.status === 'RUNNING') && body.status === 'IDLE') fail('CONFLICT', 'Finish or stop the running job first.')
    m.status = body.status
    return m
  }
  if (is('POST', '/jobs')) {
    const o = byId(orders, body.orderId) ?? fail('NOT_FOUND', 'Pick an order.')
    const m = byId(machines, body.machineId) ?? fail('NOT_FOUND', 'Pick a machine.')
    if (m.status !== 'IDLE') fail('CONFLICT', `${m.code} is ${m.status.toLowerCase()}.`)
    if (m.type === 'SPINNING' && o.materialId && !issues.some((i) => i.orderId === o.id)) {
      const mat = byId(materials, o.materialId)!
      if (num(mat.qtyInStock) < num(o.yarnRequired)) fail('INSUFFICIENT_STOCK', `Not enough ${mat.yarnType}: need ${o.yarnRequired} kg, have ${mat.qtyInStock} kg.`)
      mat.qtyInStock = dec(num(mat.qtyInStock) - num(o.yarnRequired))
      issues.push({ id: id('iss'), materialId: mat.id, orderId: o.id, qty: o.yarnRequired, cost: dec(num(o.yarnRequired) * num(mat.avgCost)), issuedAt: new Date().toISOString() })
    }
    const job: JobRow = {
      id: id('job'), orderId: o.id, machineId: m.id, workerId: null, stage: m.type, shift: body.shift ?? 'MORNING', status: 'RUNNING',
      qtyPlanned: dec(Number(body.qtyPlanned) || num(o.qty)), qtyProduced: '0.00', startedAt: new Date().toISOString(), completedAt: null,
    }
    jobs.push(job)
    m.status = 'RUNNING'
    o.status = m.type
    return fullJob(job)
  }
  if (is('PATCH', '/jobs/:id')) {
    const j = byId(jobs, seg[1]) ?? fail('NOT_FOUND', 'Job not found.')
    if (body.qtyProduced !== undefined) {
      outputLog.push({ machineId: j.machineId, qty: Number(body.qtyProduced) - num(j.qtyProduced), at: new Date().toISOString() })
      j.qtyProduced = dec(Number(body.qtyProduced))
    }
    if (body.status && body.status !== 'RUNNING') {
      j.status = body.status
      j.completedAt = new Date().toISOString()
      const m = byId(machines, j.machineId)!
      if (m.status === 'RUNNING') m.status = 'IDLE'
    }
    return fullJob(j)
  }

  // rolls + QC
  if (is('GET', '/rolls')) {
    const statuses = query.get('status')?.split(',')
    return rolls.filter((r) => !statuses || statuses.includes(r.status)).reverse().map(fullRoll)
  }
  if (is('POST', '/rolls')) {
    const j = byId(jobs, body.jobId) ?? fail('NOT_FOUND', 'Job not found.')
    if (!(Number(body.qty) > 0)) fail('BAD_REQUEST', 'Roll quantity must be positive.')
    const row: RollRow = {
      id: id('rol'), rollNo: `R-${String(++rollSeq).padStart(4, '0')}`, orderId: j.orderId, machineId: j.machineId, jobId: j.id,
      dispatchId: null, qty: dec(Number(body.qty)), status: 'PENDING_QC', createdAt: new Date().toISOString(),
    }
    rolls.push(row)
    byId(orders, j.orderId)!.status = 'QC'
    return fullRoll(row)
  }
  if (is('GET', '/qc'))
    return [...qcRecords].reverse().map(({ inspectorId, ...q }): QCRecord => {
      const r = byId(rolls, q.rollId)!
      const m = byId(machines, r.machineId)!
      const u = byId(users, inspectorId)!
      return { ...q, roll: { id: r.id, rollNo: r.rollNo, order: orderRef(r.orderId), machine: { id: m.id, code: m.code } }, inspector: { id: u.id, name: u.name } }
    })
  if (is('POST', '/qc')) {
    const r = byId(rolls, body.rollId) ?? fail('NOT_FOUND', 'Roll not found.')
    if (!['PENDING_QC', 'REWORK'].includes(r.status)) fail('CONFLICT', `${r.rollNo} is already ${r.status.toLowerCase()}.`)
    const result = body.result as QCResult
    if (result !== 'PASS' && !body.defectType) fail('BAD_REQUEST', 'Pick a defect type.')
    r.status = result === 'PASS' ? 'PASSED' : result === 'REWORK' ? 'REWORK' : 'REJECTED'
    const row: QCRow = { id: id('qc'), rollId: r.id, inspectorId: currentUser().id, result, defectType: body.defectType || null, notes: body.notes || null, checkedAt: new Date().toISOString() }
    qcRecords.push(row)
    const o = byId(orders, r.orderId)!
    if (o.status === 'QC' && rollQty(o.id, ['PASSED', 'DISPATCHED']) >= num(o.qty)) o.status = 'READY'
    return row
  }

  // dispatch + invoices
  if (is('GET', '/dispatches')) return [...dispatches].reverse().map(fullDispatch)
  if (is('POST', '/dispatches')) {
    const o = byId(orders, body.orderId) ?? fail('NOT_FOUND', 'Pick an order.')
    const ids: string[] = body.rollIds ?? []
    if (!ids.length) fail('BAD_REQUEST', 'Select at least one roll.')
    const picked = ids.map((rid) => byId(rolls, rid) ?? fail('NOT_FOUND', 'Roll not found.'))
    const bad = picked.find((r) => r.orderId !== o.id || r.status !== 'PASSED')
    if (bad) fail('CONFLICT', `${bad.rollNo} is not a passed roll of ${o.orderNo}.`)
    const d: DispatchRow = { id: id('dis'), dispatchNo: `DSP-${500 + dispatches.length + 1}`, orderId: o.id, buyerId: o.buyerId, vehicleNo: body.vehicleNo || null, dispatchedAt: new Date().toISOString() }
    dispatches.push(d)
    picked.forEach((r) => { r.status = 'DISPATCHED'; r.dispatchId = d.id })
    const amount = picked.reduce((a, r) => a + num(r.qty), 0) * num(o.pricePerUnit)
    invoices.push({ id: id('inv'), invoiceNo: `INV-${500 + invoices.length + 1}`, dispatchId: d.id, amount: dec(amount), status: 'UNPAID', issuedAt: d.dispatchedAt })
    if (rollQty(o.id, ['DISPATCHED']) >= num(o.qty)) o.status = 'DISPATCHED'
    return fullDispatch(d)
  }
  if (is('POST', '/invoices/:id/payments')) {
    const inv = byId(invoices, seg[1]) ?? fail('NOT_FOUND', 'Invoice not found.')
    const amount = Number(body.amount)
    const paid = payments.filter((p) => p.invoiceId === inv.id).reduce((a, p) => a + num(p.amount), 0)
    if (!(amount > 0) || amount > num(inv.amount) - paid + 0.001) fail('BAD_REQUEST', `Amount must be between 1 and ${dec(num(inv.amount) - paid)}.`)
    const p = { id: id('pay'), invoiceId: inv.id, amount: dec(amount), method: body.method || null, paidAt: new Date().toISOString() }
    payments.push(p)
    inv.status = paid + amount >= num(inv.amount) - 0.001 ? 'PAID' : 'PARTIAL'
    return p
  }

  // owner
  if (is('GET', '/reports/owner'))
    return ownerReport(query.get('month') ?? month(0), {
      orders: orders.filter((o) => o.status !== 'CANCELLED').map((o) => ({ ...o, buyerName: byId(buyers, o.buyerId)!.name })),
      inwards, issues, invoices, payments, wages, jobs, machines,
    })

  fail('NOT_FOUND', `No mock handler for ${method} ${route}`)
}

/* Endpoints the backend needs (all under /api, envelope { ok, data }):
   POST /auth/signin            GET /me
   GET  /suppliers /buyers /materials
   GET  /inwards                POST /inwards {materialId, supplierId, orderId?, qty, rate}
   GET  /orders                 POST /orders {buyerId, materialId?, fabricType, colour, qty, yarnRequired, pricePerUnit, deadline}
   PATCH /orders/:id {status}
   GET  /machines (+currentJob, producedToday)   PATCH /machines/:id {status}
   POST /jobs {orderId, machineId, shift, qtyPlanned}   PATCH /jobs/:id {qtyProduced?, status?}
   GET  /rolls?status=A,B       POST /rolls {jobId, qty}
   GET  /qc                     POST /qc {rollId, result, defectType?, notes?}
   GET  /dispatches             POST /dispatches {orderId, rollIds[], vehicleNo?}
   POST /invoices/:id/payments {amount, method?}
   GET  /track/:token (public)  GET /reports/owner?month=YYYY-MM
*/

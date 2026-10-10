// In-memory stand-in for the backend (VITE_USE_MOCKS=true). Paths and shapes follow
// docs/api.md and backend/src/services. Resets on full page reload.
// ponytail: no role checks here; the backend enforces requireRole.
import { decodeToken, getToken } from './token.ts'
import { deriveStatus } from './textile.ts'
import type {
  Employee,
  Board, Dispatch, Machine, MachineOutput, MaterialInward, MaterialIssue, Order, OrderCost, Payment,
  Pnl, ProductionJob, QCRecord, QCResult, RawMaterial, Ref, Role, Roll, RollStatus, Shift, ShelfStock, Stage, Tracking, User,
} from '@/types'

const LATENCY = 250
const DAY = 86400000
const now = Date.now()
const ago = (days: number, hours = 0) => new Date(now - days * DAY - hours * 3600000).toISOString()
const ahead = (days: number) => new Date(now + days * DAY).toISOString()
const round = (n: number) => Math.round(n * 100) / 100
const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0)
const nowIso = () => new Date().toISOString()
const thisMonth = () => new Date().toISOString().slice(0, 7)
let seq = 100
const id = (p: string) => `${p}_${++seq}`
const pad = (p: string, n: number) => `${p}-${String(n).padStart(4, '0')}`

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

// ---------- seed ----------

const ROLES: Role[] = ['OWNER', 'STORE', 'PRODUCTION', 'QC', 'DISPATCH']
const users: Employee[] = ROLES.map((role, i) => ({
  id: `usr_${i + 1}`,
  name: ['Ramesh Agarwal', 'Sunita Patil', 'Imran Shaikh', 'Kavya Nair', 'Deepak Yadav'][i],
  email: `${role.toLowerCase()}@everest.dev`,
  role,
  extraTabs: [],
  isActive: true,
  mustChangePassword: false,
  createdAt: new Date(now).toISOString(),
}))
const passwords: Record<string, string> = {} // set on the Employees screen; demo logins use Password123

const suppliers: Ref[] = ['Vardhman Yarns', 'Nahar Spinning', 'Sutlej Textiles'].map((name, i) => ({ id: `sup_${i + 1}`, name }))
const buyers: Ref[] = ['Arvind Garments', 'Raymond Apparel', 'Welspun Home', 'Trident Exports'].map((name, i) => ({ id: `buy_${i + 1}`, name }))

type MaterialRow = Omit<RawMaterial, 'lowStock'>
const materials: MaterialRow[] = (
  [
    ['Cotton 30s', 'Raw White', 1200, 300, 210],
    ['Cotton 40s', 'Raw White', 260, 300, 240],
    ['Polyester 150D', 'Black', 800, 200, 165],
    ['Viscose 30s', 'Natural', 90, 150, 230],
    ['Linen 25s', 'Natural', 420, 100, 520],
    ['Poly-Cotton 2/40', 'Grey', 640, 200, 190],
  ] as const
).map(([yarnType, colour, qtyInStock, reorderLevel, avgCost], i) => ({ id: `mat_${i + 1}`, category: 'YARN' as const, yarnType, colour, unit: 'kg', qtyInStock, reorderLevel, avgCost }))

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

type OrderRow = Omit<Order, 'buyer' | 'isDelayed'>
const orders: OrderRow[] = (
  [
    [1, 1, 'Poplin', 'Navy', 4000, 800, 145, -2, 'DISPATCHED', 24],
    [2, 5, 'Linen Suiting', 'Beige', 1200, 300, 410, 3, 'READY', 20],
    [3, 2, 'Terry Towel', 'White', 3000, 900, 95, 5, 'QC', 18],
    [4, 3, 'Twill', 'Black', 2500, 500, 120, 8, 'DYEING', 14],
    [1, 6, 'Oxford', 'Grey', 1800, 360, 130, -1, 'WEAVING', 10],
    [2, 1, 'Satin', 'Ivory', 1500, 320, 160, 12, 'SPINNING', 4],
    [3, 4, 'Rayon Print', 'Red', 1000, 250, 150, 15, 'PENDING', 1],
    [4, 2, 'Denim', 'Indigo', 2200, 600, 175, 20, 'PENDING', 0],
  ] as const
).map(([b, m, fabricType, colour, qty, yarnRequired, pricePerUnit, due, status, created], i) => ({
  id: `ord_${i + 1}`,
  orderNo: pad('ORD', i + 1),
  trackingToken: `trk${(i + 1) * 7919}x${i + 1}`,
  buyerId: `buy_${b}`,
  materialId: `mat_${m}`,
  fabricType, colour, qty, yarnRequired, pricePerUnit,
  deadline: ahead(due), status, createdAt: ago(created),
}))

const issues: MaterialIssue[] = orders.slice(0, 6).map((o) => {
  const m = materials.find((x) => x.id === o.materialId)!
  return { id: id('iss'), materialId: m.id, orderId: o.id, qty: o.yarnRequired, cost: round(o.yarnRequired * m.avgCost), issuedAt: o.createdAt }
})

type InwardRow = { id: string; materialId: string; supplierId: string; orderId: string | null; receivedById: string; qty: number; rate: number; billAmount: number; receivedAt: string }
const inwards: InwardRow[] = (
  [[1, 1, 500, 205, 12], [3, 2, 300, 168, 9], [5, 3, 200, 515, 7], [2, 1, 400, 238, 5], [6, 2, 350, 192, 3], [4, 3, 120, 228, 1]] as const
).map(([m, s, qty, rate, d]) => ({
  id: id('inw'), materialId: `mat_${m}`, supplierId: `sup_${s}`, orderId: null, receivedById: 'usr_2', qty, rate, billAmount: qty * rate, receivedAt: ago(d, 3),
}))

type JobRow = Omit<ProductionJob, 'order' | 'machine' | 'worker' | 'percent'>
const jobs: JobRow[] = []
const logs: { machineId: string; jobId: string; qty: number; loggedAt: string }[] = []
function seedJob(o: number, mac: number, stage: Stage, shift: Shift, planned: number, produced: number, days: number, done: boolean) {
  const j: JobRow = {
    id: id('job'), orderId: `ord_${o}`, machineId: `mac_${mac}`, stage, shift, status: done ? 'COMPLETED' : 'RUNNING',
    qtyPlanned: planned, qtyProduced: produced, startedAt: ago(days), completedAt: done ? ago(Math.max(0, days - 1)) : null,
  }
  jobs.push(j)
  // Spread output over the job's days so machine output and "today" have something to show.
  const span = done ? 1 : days + 1
  for (let d = 0; d < span; d++) logs.push({ machineId: j.machineId, jobId: j.id, qty: round(produced / span), loggedAt: ago(days - d) })
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

type RollRow = { id: string; rollNo: string; orderId: string; machineId: string; jobId: string | null; dispatchId: string | null; qty: number; status: RollStatus; createdAt: string }
const rolls: RollRow[] = []
function seedRoll(o: number, mac: number, qty: number, status: RollStatus, days: number, dispatchId: string | null = null) {
  const job = jobs.find((j) => j.orderId === `ord_${o}` && j.stage === 'DYEING')
  rolls.push({ id: id('rol'), rollNo: pad('ROLL', rolls.length + 1), orderId: `ord_${o}`, machineId: `mac_${mac}`, jobId: job?.id ?? null, dispatchId, qty, status, createdAt: ago(days, 2) })
}
for (let i = 0; i < 8; i++) seedRoll(1, 8, 500, 'DISPATCHED', 8, 'dis_1')
for (let i = 0; i < 3; i++) seedRoll(2, 9, 400, 'PASSED', 7)
;(['PASSED', 'PASSED', 'PENDING_QC', 'PENDING_QC', 'REWORK', 'REJECTED'] as const).forEach((s) => seedRoll(3, 9, 500, s, 4))
seedRoll(4, 8, 300, 'PENDING_QC', 0)
seedRoll(4, 8, 300, 'PENDING_QC', 0)

type QCRow = Omit<QCRecord, 'inspector'> & { rollId: string; inspectorId: string }
const qcRecords: QCRow[] = rolls
  .filter((r) => r.status !== 'PENDING_QC')
  .map((r) => {
    const result: QCResult = r.status === 'REWORK' ? 'REWORK' : r.status === 'REJECTED' ? 'REJECT' : 'PASS'
    const defectType = result === 'REWORK' ? 'Colour mismatch' : result === 'REJECT' ? 'Holes' : null
    return { id: id('qc'), rollId: r.id, inspectorId: 'usr_4', result, defectType, notes: null, checkedAt: ago(3) }
  })

type DispatchRow = { id: string; dispatchNo: string; orderId: string; buyerId: string; vehicleNo: string | null; dispatchedAt: string }
const dispatches: DispatchRow[] = [{ id: 'dis_1', dispatchNo: 'DSP-0001', orderId: 'ord_1', buyerId: 'buy_1', vehicleNo: 'GJ-05-AB-4821', dispatchedAt: ago(5) }]
type InvoiceRow = { id: string; invoiceNo: string; dispatchId: string; amount: number; status: 'UNPAID' | 'PARTIAL' | 'PAID'; issuedAt: string }
const invoices: InvoiceRow[] = [{ id: 'inv_1', invoiceNo: 'INV-0001', dispatchId: 'dis_1', amount: 4000 * 145, status: 'PARTIAL', issuedAt: ago(5) }]
const payments: (Payment & { invoiceId: string })[] = [{ id: id('pay'), invoiceId: 'inv_1', amount: 300000, method: 'NEFT', paidAt: ago(2) }]

// ponytail: wages as a flat monthly figure; the backend derives them from attendance.
const WAGES_EARNED = 12 * 26 * 650
const wagesPaidIn = (month: string) => (month < thisMonth() ? WAGES_EARNED : 0)

// ---------- joins ----------

const byId = <T extends { id: string }>(rows: T[], rid: string | null | undefined) => rows.find((r) => r.id === rid)
const withLowStock = (m: MaterialRow): RawMaterial => ({ ...m, lowStock: m.qtyInStock <= m.reorderLevel })
const isDelayed = (o: OrderRow) => !['DISPATCHED', 'CANCELLED'].includes(o.status) && new Date(o.deadline).getTime() < Date.now()
const fullOrder = (o: OrderRow): Order => ({ ...o, buyer: byId(buyers, o.buyerId)!, isDelayed: isDelayed(o) })
const orderBrief = (oid: string) => {
  const { id, orderNo, fabricType, colour, qty, deadline } = byId(orders, oid)!
  return { id, orderNo, fabricType, colour, qty, deadline }
}
const fullJob = (j: JobRow): ProductionJob => {
  const { id, code, name, type } = byId(machines, j.machineId)!
  return { ...j, percent: Math.min(100, Math.round((j.qtyProduced / j.qtyPlanned) * 100)), order: orderBrief(j.orderId), machine: { id, code, name, type }, worker: null }
}
const fullRoll = (r: RollRow): Roll => {
  const o = byId(orders, r.orderId)!
  const m = byId(machines, r.machineId)!
  return {
    ...r,
    order: { id: o.id, orderNo: o.orderNo, fabricType: o.fabricType, colour: o.colour, buyer: { name: byId(buyers, o.buyerId)!.name } },
    machine: { id: m.id, code: m.code, name: m.name },
    qcRecords: qcRecords
      .filter((q) => q.rollId === r.id)
      .reverse()
      .map(({ rollId: _r, inspectorId, ...q }) => ({ ...q, inspector: { id: inspectorId, name: byId(users, inspectorId)!.name } })),
  }
}
const fullInvoice = (inv: InvoiceRow) => {
  const ps = payments.filter((p) => p.invoiceId === inv.id)
  const paid = sum(ps, (p) => p.amount)
  return { ...inv, payments: ps, paid, balance: round(inv.amount - paid) }
}
const fullDispatch = (d: DispatchRow): Dispatch => {
  const rs = rolls.filter((r) => r.dispatchId === d.id).map(({ id, rollNo, qty }) => ({ id, rollNo, qty }))
  const inv = invoices.find((i) => i.dispatchId === d.id)
  return { ...d, order: orderBrief(d.orderId), buyer: byId(buyers, d.buyerId)!, rolls: rs, totalQty: sum(rs, (r) => r.qty), invoice: inv ? fullInvoice(inv) : null }
}
const inMonth = (iso: string, month: string) => iso.slice(0, 7) === month
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()

function sync(orderId: string) {
  const o = byId(orders, orderId)!
  o.status = deriveStatus(o.status, o.qty, jobs.filter((j) => j.orderId === o.id), rolls.filter((r) => r.orderId === o.id))
}

function currentUser(): Employee {
  return byId(users, decodeToken(getToken() ?? '')?.sub) ?? fail('UNAUTHORIZED', 'Please sign in again.')
}

function fakeJwt(u: User) {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '')
  return `${b64({ alg: 'none' })}.${b64({ sub: u.id, role: u.role, exp: Math.floor(now / 1000) + 86400 })}.mock`
}

const TRACK_LABEL: Record<string, string> = {
  PENDING: 'Order received, waiting to start', SPINNING: 'Yarn is being spun', WEAVING: 'Fabric is being woven', DYEING: 'Fabric is being dyed',
  QC: 'Fabric is being quality checked', READY: 'Ready to ship', DISPATCHED: 'Dispatched', CANCELLED: 'Cancelled',
}
const TIMELINE = ['PENDING', 'SPINNING', 'WEAVING', 'DYEING', 'QC', 'READY', 'DISPATCHED'] as const

// ---------- router ----------

export async function mockRequest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  await new Promise((r) => setTimeout(r, LATENCY))
  return structuredClone(handle(path, (init.method ?? 'GET').toUpperCase(), (init.body ?? {}) as Record<string, any>)) as T
}

function handle(path: string, method: string, body: Record<string, any>): unknown {
  const [route, qs] = path.split('?')
  const query = new URLSearchParams(qs)
  const seg = route.split('/').filter(Boolean)
  const is = (m: string, pattern: string) => {
    const parts = pattern.split('/').filter(Boolean)
    return m === method && parts.length === seg.length && parts.every((p, i) => p.startsWith(':') || p === seg[i])
  }
  const month = query.get('month') || thisMonth()

  if (is('POST', '/auth/signin')) {
    const u = users.find((x) => x.email === String(body.email).toLowerCase())
    if (!u || !u.isActive || body.password !== (passwords[u.id] ?? 'Password123')) fail('UNAUTHORIZED', 'Invalid email or password')
    return { token: fakeJwt(u), user: u }
  }

  if (is('GET', '/track/:token')) {
    const o = orders.find((x) => x.trackingToken === seg[1]) ?? fail('NOT_FOUND', 'Order not found')
    const reached = TIMELINE.indexOf(o.status as (typeof TIMELINE)[number])
    const qtyOf = (s: RollStatus) => sum(rolls.filter((r) => r.orderId === o.id && r.status === s), (r) => r.qty)
    const t: Tracking = {
      orderNo: o.orderNo, buyer: byId(buyers, o.buyerId)!.name, fabricType: o.fabricType, colour: o.colour, qty: o.qty, deadline: o.deadline,
      status: o.status, statusLabel: TRACK_LABEL[o.status], isDelayed: isDelayed(o),
      timeline: TIMELINE.map((step, i) => ({ step, label: TRACK_LABEL[step], done: i <= reached })),
      qtyReady: qtyOf('PASSED'), qtyDispatched: qtyOf('DISPATCHED'),
      dispatches: dispatches.filter((d) => d.orderId === o.id).map(({ dispatchNo, vehicleNo, dispatchedAt }) => ({ dispatchNo, vehicleNo, dispatchedAt })),
    }
    return t
  }

  const me = currentUser()
  if (is('GET', '/me')) return me
  if (is('POST', '/auth/change-password')) {
    if (!/^[A-Za-z0-9]{6,}$/.test(body.newPassword)) fail('VALIDATION_ERROR', 'Password must be at least 6 letters or digits')
    passwords[me.id] = body.newPassword
    me.mustChangePassword = false
    return { changed: true }
  }
  if (me.mustChangePassword) fail('PASSWORD_CHANGE_REQUIRED', 'Set a new password to continue')

  // The real assistant needs the backend; mock mode only shows the chat working.
  if (is('POST', '/assistant/chat')) return { reply: 'This is the demo build, so I am not connected to live data. Run the backend to ask real questions.', lookups: [] }

  // employees
  if (seg[0] === 'users' && me.role !== 'OWNER') fail('FORBIDDEN', 'You do not have access to this resource')
  if (is('GET', '/users')) return [...users].sort((a, b) => Number(b.isActive) - Number(a.isActive)) // deactivated last
  if (is('POST', '/users')) {
    const email = String(body.email).toLowerCase()
    if (users.some((u) => u.email === email)) fail('CONFLICT', 'Duplicate value for email')
    const u: Employee = { id: `usr_${users.length + 1}`, name: body.name, email, role: body.role, extraTabs: body.extraTabs ?? [], isActive: true, mustChangePassword: true, createdAt: new Date().toISOString() }
    users.unshift(u) // newest first
    passwords[u.id] = body.password
    return u
  }
  if (is('PATCH', '/users/:id')) {
    const u = byId(users, seg[1]) ?? fail('NOT_FOUND', 'User not found')
    const { password, ...changes } = body
    Object.assign(u, changes)
    users.unshift(...users.splice(users.indexOf(u), 1)) // last edited on top
    if (password) {
      passwords[u.id] = password
      u.mustChangePassword = true
    }
    return u
  }

  // masters
  if (is('GET', '/suppliers')) return suppliers
  // ponytail: no purchase orders in mock mode; the real list comes from the backend.
  if (is('GET', '/materials/purchase-orders')) return []
  // ponytail: no Config figures in mock mode; the order form falls back to its built-in fabric list.
  if (is('GET', '/config')) return { fabrics: [], rules: [], settings: [], materials: [] }
  if (is('GET', '/config/changes')) return []
  if (is('GET', '/buyers')) return buyers

  // store
  if (is('GET', '/materials')) return materials.map(withLowStock)
  if (is('GET', '/materials/inwards'))
    return [...inwards].reverse().map(({ materialId, supplierId, orderId, receivedById, ...i }): MaterialInward => {
      const m = byId(materials, materialId)!
      return {
        ...i,
        material: { id: m.id, yarnType: m.yarnType, colour: m.colour, unit: m.unit },
        supplier: byId(suppliers, supplierId)!,
        order: orderId ? { id: orderId, orderNo: byId(orders, orderId)!.orderNo } : null,
        receivedBy: { id: receivedById, name: byId(users, receivedById)!.name },
      }
    })
  if (is('POST', '/materials/inwards')) {
    const m = byId(materials, body.materialId) ?? fail('NOT_FOUND', 'Material not found')
    if (!byId(suppliers, body.supplierId)) fail('NOT_FOUND', 'Supplier not found')
    const qty = Number(body.qty), rate = Number(body.rate)
    if (!(qty > 0) || !(rate > 0)) fail('VALIDATION_ERROR', 'Quantity and rate must be positive.')
    m.avgCost = round((m.qtyInStock * m.avgCost + qty * rate) / (m.qtyInStock + qty))
    m.qtyInStock = round(m.qtyInStock + qty)
    const row: InwardRow = { id: id('inw'), materialId: m.id, supplierId: body.supplierId, orderId: body.orderId ?? null, receivedById: me.id, qty, rate, billAmount: round(qty * rate), receivedAt: nowIso() }
    inwards.push(row)
    return { ...row, material: withLowStock(m) }
  }
  if (is('GET', '/materials/issues')) {
    const orderId = query.get('orderId')
    return issues.filter((i) => !orderId || i.orderId === orderId)
  }
  if (is('POST', '/materials/issues')) {
    const m = byId(materials, body.materialId) ?? fail('NOT_FOUND', 'Material not found')
    if (!byId(orders, body.orderId)) fail('NOT_FOUND', 'Order not found')
    const qty = Number(body.qty)
    if (m.qtyInStock < qty) fail('INSUFFICIENT_STOCK', `Only ${m.qtyInStock} ${m.unit} in stock`)
    m.qtyInStock = round(m.qtyInStock - qty)
    const row: MaterialIssue = { id: id('iss'), materialId: m.id, orderId: body.orderId, qty, cost: round(qty * m.avgCost), issuedAt: nowIso() }
    issues.push(row)
    return { ...row, material: withLowStock(m) }
  }

  // orders
  if (is('GET', '/orders')) return [...orders].sort((a, b) => (a.deadline < b.deadline ? -1 : 1)).map(fullOrder)
  if (is('POST', '/orders')) {
    if (!byId(buyers, body.buyerId)) fail('NOT_FOUND', 'Buyer not found')
    if (body.yarnRequired > 0 && !body.materialId) fail('BAD_REQUEST', 'materialId is required with yarnRequired')
    const row: OrderRow = {
      id: id('ord'), orderNo: pad('ORD', orders.length + 1), trackingToken: `trk${Date.now().toString(36)}`, buyerId: body.buyerId,
      materialId: body.materialId ?? null, fabricType: body.fabricType, colour: body.colour, qty: Number(body.qty),
      yarnRequired: Number(body.yarnRequired) || 0, pricePerUnit: Number(body.pricePerUnit) || 0,
      deadline: new Date(body.deadline).toISOString(), status: 'PENDING', createdAt: nowIso(),
    }
    orders.push(row)
    return fullOrder(row)
  }
  if (is('PATCH', '/orders/:id/status')) {
    const o = byId(orders, seg[1]) ?? fail('NOT_FOUND', 'Order not found')
    o.status = body.status
    return fullOrder(o)
  }

  // production
  if (is('GET', '/machines')) return machines
  if (is('GET', '/production/board')) {
    const rows = machines.map((m) => {
      const job = jobs.find((j) => j.machineId === m.id && j.status === 'RUNNING')
      return { ...m, producedToday: round(sum(logs.filter((l) => l.machineId === m.id && isToday(l.loggedAt)), (l) => l.qty)), currentJob: job ? fullJob(job) : null }
    })
    const count = (s: string) => rows.filter((m) => m.status === s).length
    const board: Board = {
      machines: rows,
      summary: { total: rows.length, running: count('RUNNING'), idle: count('IDLE'), breakdown: count('BREAKDOWN'), maintenance: count('MAINTENANCE'), producedToday: sum(rows, (m) => m.producedToday) },
    }
    return board
  }
  if (is('PATCH', '/machines/:id/status')) {
    const m = byId(machines, seg[1]) ?? fail('NOT_FOUND', 'Machine not found')
    for (const j of jobs.filter((x) => x.machineId === m.id && x.status === 'RUNNING')) {
      j.status = 'STOPPED'
      j.completedAt = nowIso()
      sync(j.orderId)
    }
    m.status = body.status
    return m
  }
  if (is('POST', '/production/jobs')) {
    const o = byId(orders, body.orderId) ?? fail('NOT_FOUND', 'Order not found')
    const m = byId(machines, body.machineId) ?? fail('NOT_FOUND', 'Machine not found')
    if (['DISPATCHED', 'CANCELLED'].includes(o.status)) fail('BAD_REQUEST', `Order is ${o.status}`)
    if (m.status !== 'IDLE') fail('MACHINE_BUSY', `Machine ${m.code} is ${m.status}`)
    m.status = 'RUNNING'
    const job: JobRow = { id: id('job'), orderId: o.id, machineId: m.id, stage: m.type, shift: body.shift, status: 'RUNNING', qtyPlanned: Number(body.qtyPlanned), qtyProduced: 0, startedAt: nowIso(), completedAt: null }
    jobs.push(job)
    sync(o.id)
    return fullJob(job)
  }
  if (is('POST', '/production/jobs/:id/progress')) {
    const j = byId(jobs, seg[2]) ?? fail('NOT_FOUND', 'Job not found')
    if (j.status !== 'RUNNING') fail('BAD_REQUEST', `Job is ${j.status}`)
    const qty = Number(body.qty)
    logs.push({ machineId: j.machineId, jobId: j.id, qty, loggedAt: nowIso() })
    j.qtyProduced = round(j.qtyProduced + qty)
    return fullJob(j)
  }
  if (is('POST', '/production/jobs/:id/complete') || is('POST', '/production/jobs/:id/stop')) {
    const j = byId(jobs, seg[2]) ?? fail('NOT_FOUND', 'Job not found')
    if (j.status !== 'RUNNING') fail('BAD_REQUEST', `Job is already ${j.status}`)
    j.status = seg[3] === 'complete' ? 'COMPLETED' : 'STOPPED'
    j.completedAt = nowIso()
    const m = byId(machines, j.machineId)!
    if (m.status === 'RUNNING') m.status = 'IDLE'
    sync(j.orderId)
    return fullJob(j)
  }
  if (is('POST', '/production/rolls')) {
    const j = byId(jobs, body.jobId) ?? fail('NOT_FOUND', 'Job not found')
    const row: RollRow = { id: id('rol'), rollNo: pad('ROLL', rolls.length + 1), orderId: j.orderId, machineId: j.machineId, jobId: j.id, dispatchId: null, qty: Number(body.qty), status: 'PENDING_QC', createdAt: nowIso() }
    rolls.push(row)
    sync(j.orderId)
    return fullRoll(row)
  }

  // QC
  if (is('GET', '/qc/rolls')) {
    const status = query.get('status')
    return rolls.filter((r) => !status || r.status === status).reverse().map(fullRoll)
  }
  if (is('POST', '/qc/rolls/:id/inspect')) {
    const r = byId(rolls, seg[2]) ?? fail('NOT_FOUND', 'Roll not found')
    if (!['PENDING_QC', 'REWORK'].includes(r.status)) fail('BAD_REQUEST', `Roll is already ${r.status}`)
    const result = body.result as QCResult
    if (result !== 'PASS' && !body.defectType) fail('VALIDATION_ERROR', 'defectType is required unless PASS')
    qcRecords.push({ id: id('qc'), rollId: r.id, inspectorId: me.id, result, defectType: result === 'PASS' ? null : body.defectType, notes: body.notes ?? null, checkedAt: nowIso() })
    r.status = result === 'PASS' ? 'PASSED' : result === 'REWORK' ? 'REWORK' : 'REJECTED'
    sync(r.orderId)
    return fullRoll(r)
  }

  // dispatch
  if (is('GET', '/dispatch/stock')) {
    const shelf = rolls.filter((r) => r.status === 'PASSED' && !r.dispatchId)
    const groups = new Map<string, ShelfStock['orders'][number]>()
    for (const r of shelf) {
      if (!groups.has(r.orderId)) groups.set(r.orderId, { order: { ...orderBrief(r.orderId), buyer: byId(buyers, byId(orders, r.orderId)!.buyerId)! }, rolls: [], totalQty: 0 })
      const g = groups.get(r.orderId)!
      g.rolls.push({ id: r.id, rollNo: r.rollNo, qty: r.qty })
      g.totalQty += r.qty
    }
    const stock: ShelfStock = { orders: [...groups.values()], totalRolls: shelf.length, totalQty: sum(shelf, (r) => r.qty), unsold: { rolls: [], totalQty: 0 } }
    return stock
  }
  if (is('GET', '/dispatch')) return [...dispatches].reverse().map(fullDispatch)
  if (is('POST', '/dispatch')) {
    const o = byId(orders, body.orderId) ?? fail('NOT_FOUND', 'Order not found')
    const ids = [...new Set<string>(body.rollIds ?? [])]
    const picked = rolls.filter((r) => ids.includes(r.id) && r.orderId === o.id && r.status === 'PASSED' && !r.dispatchId)
    if (!ids.length || picked.length !== ids.length) fail('ROLLS_NOT_AVAILABLE', 'Some rolls are not passed, already dispatched, or belong to another order')
    const d: DispatchRow = { id: id('dis'), dispatchNo: pad('DSP', dispatches.length + 1), orderId: o.id, buyerId: o.buyerId, vehicleNo: body.vehicleNo ?? null, dispatchedAt: nowIso() }
    dispatches.push(d)
    picked.forEach((r) => Object.assign(r, { status: 'DISPATCHED', dispatchId: d.id }))
    invoices.push({ id: id('inv'), invoiceNo: pad('INV', invoices.length + 1), dispatchId: d.id, amount: round(sum(picked, (r) => r.qty) * o.pricePerUnit), status: 'UNPAID', issuedAt: d.dispatchedAt })
    sync(o.id)
    return fullDispatch(d)
  }
  if (is('POST', '/invoices/:id/payments')) {
    const inv = byId(invoices, seg[1]) ?? fail('NOT_FOUND', 'Invoice not found')
    const amount = Number(body.amount)
    const { balance } = fullInvoice(inv)
    if (amount > balance) fail('BAD_REQUEST', `Payment exceeds the balance of ${balance}`)
    payments.push({ id: id('pay'), invoiceId: inv.id, amount, method: body.method ?? null, paidAt: nowIso() })
    inv.status = amount === balance ? 'PAID' : 'PARTIAL'
    return fullInvoice(inv)
  }

  if (is('GET', '/invoices')) {
    const status = query.get('status')
    // Same shape as the API: each invoice carries its dispatch with order and buyer.
    return invoices
      .map((inv) => {
        const d = byId(dispatches, inv.dispatchId)!
        const b = byId(buyers, d.buyerId)!
        return { ...fullInvoice(inv), dispatch: { id: d.id, dispatchNo: d.dispatchNo, dispatchedAt: d.dispatchedAt, order: orderBrief(d.orderId), buyer: { id: b.id, name: b.name } } }
      })
      .filter((i) => !status || i.status === status)
  }
  if (is('GET', '/qc/summary')) {
    const counts = { PENDING_QC: 0, PASSED: 0, REWORK: 0, REJECTED: 0, DISPATCHED: 0 }
    for (const r of rolls) counts[r.status] += 1
    const checked = counts.PASSED + counts.DISPATCHED + counts.REWORK + counts.REJECTED
    const byType = new Map<string, number>()
    for (const q of qcRecords) if (q.result !== 'PASS') byType.set(q.defectType ?? 'Unspecified', (byType.get(q.defectType ?? 'Unspecified') ?? 0) + 1)
    return {
      counts,
      passRate: checked ? Math.round(((counts.PASSED + counts.DISPATCHED) / checked) * 100) : null,
      defectsByType: [...byType].map(([defectType, count]) => ({ defectType, count })),
      defectsByMachine: [],
    }
  }
  // ponytail: mock planning is an empty plan; the real one is computed by the backend.
  if (is('GET', '/planning/schedule')) {
    const cap = { machines: 0, usable: 0, perDay: 0 }
    return { days: 90, capacity: { SPINNING: cap, WEAVING: cap, DYEING: cap }, summary: { openOrders: 0, onTime: 0, late: 0, unscheduled: 0, yarnsShort: 0 }, orders: [], weeklyLoad: [], yarnNeeds: [] }
  }

  // owner reports
  if (is('GET', '/reports/pnl')) {
    const materialBills = sum(inwards.filter((i) => inMonth(i.receivedAt, month)), (i) => i.billAmount)
    const invoiced = sum(invoices.filter((i) => inMonth(i.issuedAt, month)), (i) => i.amount)
    const paymentsReceived = sum(payments.filter((p) => inMonth(p.paidAt, month)), (p) => p.amount)
    const wagesPaid = wagesPaidIn(month)
    const pnl: Pnl = {
      month, materialBills, wagesEarned: WAGES_EARNED, wagesPaid, invoiced, paymentsReceived,
      profit: round(invoiced - materialBills - WAGES_EARNED), cashFlow: round(paymentsReceived - materialBills - wagesPaid),
    }
    return pnl
  }
  if (is('GET', '/reports/machine-output')) {
    const mine = logs.filter((l) => inMonth(l.loggedAt, month))
    const daily = new Map<string, number>()
    for (const l of mine) daily.set(l.loggedAt.slice(0, 10), (daily.get(l.loggedAt.slice(0, 10)) ?? 0) + l.qty)
    const rows = machines.map((m) => ({ ...m, produced: round(sum(mine.filter((l) => l.machineId === m.id), (l) => l.qty)) }))
    const out: MachineOutput = { month, machines: rows, daily: [...daily].sort().map(([date, qty]) => ({ date, qty: round(qty) })), total: round(sum(rows, (r) => r.produced)) }
    return out
  }
  if (is('GET', '/reports/order-costs'))
    return [...orders].reverse().map((o): OrderCost => {
      const materialCost = sum(issues.filter((i) => i.orderId === o.id), (i) => i.cost)
      // ponytail: flat labour estimate (3 workers × ₹650 per job day); the backend uses each worker's wage × hours.
      const labourCost = sum(jobs.filter((j) => j.orderId === o.id), (j) => (((j.completedAt ? Date.parse(j.completedAt) : Date.now()) - Date.parse(j.startedAt)) / DAY) * 3 * 650)
      const good = rolls.filter((r) => r.orderId === o.id && ['PASSED', 'DISPATCHED'].includes(r.status))
      const goodQty = sum(good, (r) => r.qty)
      const totalCost = materialCost + labourCost
      const orderValue = o.qty * o.pricePerUnit
      return {
        id: o.id, orderNo: o.orderNo, buyer: byId(buyers, o.buyerId)!, fabricType: o.fabricType, colour: o.colour, status: o.status, qty: o.qty,
        goodQty, rolls: good.length, rejectedQty: sum(rolls.filter((r) => r.orderId === o.id && r.status === 'REJECTED'), (r) => r.qty),
        materialCost: round(materialCost), labourCost: round(labourCost), totalCost: round(totalCost),
        costPerUnit: goodQty ? round(totalCost / goodQty) : null, costPerRoll: good.length ? round(totalCost / good.length) : null,
        orderValue: round(orderValue),
        invoiced: sum(dispatches.filter((d) => d.orderId === o.id), (d) => invoices.find((i) => i.dispatchId === d.id)?.amount ?? 0),
        margin: round(orderValue - totalCost),
      }
    })

  fail('NOT_FOUND', `No mock handler for ${method} ${route}`)
}

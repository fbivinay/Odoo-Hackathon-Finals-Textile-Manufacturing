// Shapes returned by the backend (see docs/api.md and backend/src/services).
// Decimals arrive as JSON numbers; dates as ISO strings.

export type Role = 'OWNER' | 'STORE' | 'PRODUCTION' | 'QC' | 'DISPATCH'
export type Shift = 'MORNING' | 'EVENING' | 'NIGHT'
export type Stage = 'SPINNING' | 'WEAVING' | 'DYEING'
export type OrderStatus = 'PENDING' | 'SPINNING' | 'WEAVING' | 'DYEING' | 'QC' | 'READY' | 'DISPATCHED' | 'CANCELLED'
export type MachineStatus = 'IDLE' | 'RUNNING' | 'BREAKDOWN' | 'MAINTENANCE'
export type JobStatus = 'RUNNING' | 'COMPLETED' | 'STOPPED'
export type RollStatus = 'PENDING_QC' | 'PASSED' | 'REWORK' | 'REJECTED' | 'DISPATCHED'
export type QCResult = 'PASS' | 'REWORK' | 'REJECT'
export type InvoiceStatus = 'UNPAID' | 'PARTIAL' | 'PAID'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  extraTabs?: string[] // sidebar tabs granted on top of the role, e.g. ['/waste']
  createdAt?: string // when the owner added this login; shown as the joining date
  mustChangePassword?: boolean // owner-issued password: must be changed before anything else
}

// A login as the owner sees it on the Employees screen.
export interface Employee extends User {
  isActive: boolean
  mustChangePassword: boolean
  createdAt: string
}

// One turn of the assistant chat. Images ride as base64 and only on the user's side.
export interface ChatImage {
  mediaType: string
  data: string
}
export interface ChatReply {
  reply: string
  lookups: string[]
}

export interface AuthResponse {
  token: string
  user: User
}

export interface Ref {
  id: string
  name: string
}

// GET /materials
export type MaterialCategory = 'YARN' | 'WEAVING' | 'DYEING' | 'FINISHING' | 'QC' | 'PACKAGING' | 'MAINTENANCE'

export interface RawMaterial {
  id: string
  category: MaterialCategory
  yarnType: string // the material's name; for yarn, the yarn type

  colour: string
  unit: string
  qtyInStock: number
  reorderLevel: number
  avgCost: number
  lowStock: boolean
  supplierId?: string | null // usual supplier (Config)
  leadDays?: number // supplier delivery days (Config)
  sku?: string | null
  subcategory?: string | null
  department?: string | null
  taxCode?: string | null // GST rule (backend/src/lib/tax.js)
  isSpare?: boolean
}

// GET /materials/inwards
export interface MaterialInward {
  id: string
  qty: number
  rate: number
  billAmount: number
  receivedAt: string
  // The delivery's supplier bill: GST and the total payable.
  billNo?: string | null
  dueDate?: string | null
  taxRatePct?: number
  taxTreatment?: string | null
  cgst?: number
  sgst?: number
  igst?: number
  totalAmount?: number | null
  material: Pick<RawMaterial, 'id' | 'yarnType' | 'colour' | 'unit'>
  supplier: Ref
  order: { id: string; orderNo: string } | null
  receivedBy: Ref
}

// GET /materials/purchase-orders
export interface PurchaseOrder {
  id: string
  poNo: string
  qty: number
  rate: number
  status: 'PENDING' | 'RECEIVED' | 'CANCELLED'
  orderedAt: string
  receivedAt: string | null
  material: Pick<RawMaterial, 'id' | 'category' | 'yarnType' | 'colour' | 'unit' | 'leadDays'>
  supplier: Ref & { phone: string | null }
  orderedBy: Ref
}

// GET /materials/issues
export interface MaterialIssue {
  id: string
  materialId: string
  orderId: string
  qty: number
  cost: number
  issuedAt: string
}

// GET /orders
export interface Order {
  id: string
  orderNo: string
  trackingToken: string
  buyerId: string
  materialId: string | null
  fabricType: string
  colour: string
  qty: number
  yarnRequired: number
  pricePerUnit: number
  deadline: string
  status: OrderStatus
  createdAt: string
  isDelayed: boolean
  buyer: Ref
  // The Config figures the order was taken with (null on orders from before Config).
  yarnPerMetre?: number | null
  wastagePct?: number | null
  listPrice?: number | null
}

export interface Machine {
  id: string
  code: string
  name: string
  type: Stage
  status: MachineStatus
}

export interface ProductionJob {
  id: string
  orderId: string
  machineId: string
  stage: Stage
  shift: Shift
  status: JobStatus
  qtyPlanned: number
  qtyProduced: number
  percent: number
  startedAt: string
  completedAt: string | null
  order: Pick<Order, 'id' | 'orderNo' | 'fabricType' | 'colour' | 'qty' | 'deadline'>
  machine: Pick<Machine, 'id' | 'code' | 'name' | 'type'>
  worker: { id: string; code: string; name: string } | null
}

// GET /production/board
export interface Board {
  machines: (Machine & { producedToday: number; currentJob: ProductionJob | null })[]
  summary: { total: number; running: number; idle: number; breakdown: number; maintenance: number; producedToday: number }
}

export interface QCRecord {
  id: string
  result: QCResult
  defectType: string | null
  notes: string | null
  checkedAt: string
  inspector: Ref
}

// GET /qc/rolls
export interface Roll {
  id: string
  rollNo: string
  orderId: string
  machineId: string
  qty: number
  status: RollStatus
  createdAt: string
  order: Pick<Order, 'id' | 'orderNo' | 'fabricType' | 'colour'> & { buyer: { name: string } }
  machine: Pick<Machine, 'id' | 'code' | 'name'>
  qcRecords: QCRecord[]
}

// GET /dispatch/stock
export interface ShelfStock {
  orders: {
    order: Pick<Order, 'id' | 'orderNo' | 'fabricType' | 'colour' | 'qty' | 'deadline'> & { buyer: Ref }
    rolls: { id: string; rollNo: string; qty: number; createdAt?: string }[]
    totalQty: number
  }[]
  totalRolls: number
  totalQty: number
}

export interface Payment {
  id: string
  amount: number
  method: string | null
  paidAt: string
}

export interface Invoice {
  id: string
  invoiceNo: string
  amount: number
  status: InvoiceStatus
  issuedAt: string
  payments: Payment[]
  paid: number
  balance: number
}

// GET /dispatch
export interface Dispatch {
  id: string
  dispatchNo: string
  vehicleNo: string | null
  dispatchedAt: string
  order: Pick<Order, 'id' | 'orderNo' | 'fabricType' | 'colour' | 'qty'>
  buyer: Ref
  rolls: { id: string; rollNo: string; qty: number }[]
  totalQty: number
  invoice: Invoice | null
}

// GET /track/:token — public, no prices.
export interface Tracking {
  orderNo: string
  buyer: string
  fabricType: string
  colour: string
  qty: number
  deadline: string
  status: OrderStatus
  statusLabel: string
  isDelayed: boolean
  timeline: { step: OrderStatus; label: string; done: boolean }[]
  qtyReady: number
  qtyDispatched: number
  dispatches: { dispatchNo: string; vehicleNo: string | null; dispatchedAt: string }[]
}

// GET /reports/pnl?month=
export interface Pnl {
  month: string
  materialBills: number
  wagesEarned: number
  wagesPaid: number
  logistics?: number
  utilities?: number
  supplierPayments?: number
  invoiced: number
  paymentsReceived: number
  profit: number
  cashFlow: number
}

// GET /reports/machine-output?month=
export interface MachineOutput {
  month: string
  machines: (Machine & { produced: number })[]
  daily: { date: string; qty: number }[]
  total: number
}

// GET /reports/order-costs
export interface OrderCost {
  id: string
  orderNo: string
  buyer: Ref
  fabricType: string
  colour: string
  status: OrderStatus
  qty: number
  goodQty: number
  rolls: number
  rejectedQty: number
  materialCost: number
  labourCost: number
  totalCost: number
  costPerUnit: number | null
  costPerRoll: number | null
  orderValue: number
  invoiced: number
  margin: number
}

// GET /qc/summary?from=&to=
export interface QcSummary {
  counts: Record<RollStatus, number>
  passRate: number | null
  defectsByType: { defectType: string; count: number }[]
  defectsByMachine: { id: string; code: string; name: string; count: number }[]
}

// GET /planning/schedule?days=90 — computed on the fly from history; nothing stored.
export interface StageLoad {
  load: number
  capacity: number
  utilisation: number
}
export interface Planning {
  days: number
  capacity: Record<Stage, { machines: number; usable: number; perDay: number }>
  summary: { openOrders: number; onTime: number; late: number; unscheduled: number; waitingForYarn: number; yarnsShort: number }
  orders: {
    id: string
    orderNo: string
    buyer: Ref
    fabricType: string
    colour: string
    qty: number
    status: OrderStatus
    deadline: string
    stages: { stage: Stage; remaining: number; start: string | null; end: string | null }[]
    yarnToIssue: number
    yarnShortBy: number
    expectedReady: string | null
    lateByDays: number
    onTime: boolean
    withinHorizon: boolean
  }[]
  weeklyLoad: ({ weekStart: string } & Record<Stage, StageLoad>)[]
  yarnNeeds: { id: string; yarnType: string; colour: string; unit: string; needed: number; inStock: number; shortBy: number; orders: number; neededBy: string | null }[]
}

// GET /config — figures the owner edits on the Config page.
export interface Config {
  fabrics: {
    fabricType: string
    saved: boolean
    materialId: string | null
    yarnPerMetre: number
    wastagePct: number
    pricePerMetre: number
    updatedAt: string | null
    history: { orders: number; yarnPerMetre: number; pricePerMetre: number; wastagePct: number } | null
  }[]
  rules: { id: string; kind: 'QUANTITY' | 'DEADLINE'; below: number; pricePct: number; wastagePct: number }[]
  settings: { key: 'qcDays' | 'rollLength' | 'shiftHours' | 'dispatchTolerancePct' | 'shelfWaitDays'; label: string; value: number; default: number; min: number; max: number }[]
  materials: { id: string; category: MaterialCategory; yarnType: string; colour: string; unit: string; reorderLevel: number; avgCost: number; supplierId: string | null; leadDays: number }[]
}

// GET /config/changes
export interface ConfigChange {
  id: string
  what: string
  field: string
  oldValue: string | null
  newValue: string | null
  changedBy: string
  changedAt: string
}

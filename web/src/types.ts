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
export interface RawMaterial {
  id: string
  yarnType: string
  colour: string
  unit: string
  qtyInStock: number
  reorderLevel: number
  avgCost: number
  lowStock: boolean
}

// GET /materials/inwards
export interface MaterialInward {
  id: string
  qty: number
  rate: number
  billAmount: number
  receivedAt: string
  material: Pick<RawMaterial, 'id' | 'yarnType' | 'colour' | 'unit'>
  supplier: Ref
  order: { id: string; orderNo: string } | null
  receivedBy: Ref
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
    rolls: { id: string; rollNo: string; qty: number }[]
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

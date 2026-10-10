// Mirrors backend/prisma/schema.prisma. Prisma Decimals arrive as strings in JSON.
export type Dec = string

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

export interface RawMaterial {
  id: string
  yarnType: string
  colour: string
  unit: string
  qtyInStock: Dec
  reorderLevel: Dec
  avgCost: Dec
}

export interface MaterialInward {
  id: string
  materialId: string
  supplierId: string
  orderId: string | null
  qty: Dec
  rate: Dec
  billAmount: Dec
  receivedAt: string
  material: RawMaterial
  supplier: Ref
  order: { id: string; orderNo: string } | null
}

export interface Order {
  id: string
  orderNo: string
  trackingToken: string
  buyerId: string
  materialId: string | null
  fabricType: string
  colour: string
  qty: Dec
  yarnRequired: Dec
  pricePerUnit: Dec
  deadline: string
  status: OrderStatus
  createdAt: string
  buyer: Ref
  material: RawMaterial | null
}

export type OrderRef = Pick<Order, 'id' | 'orderNo' | 'fabricType' | 'colour'>

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
  qtyPlanned: Dec
  qtyProduced: Dec
  startedAt: string
  completedAt: string | null
  order: OrderRef
}

// GET /machines includes the running job (if any) and today's roll output.
export interface MachineBoardRow extends Machine {
  currentJob: ProductionJob | null
  producedToday: Dec
}

export interface Roll {
  id: string
  rollNo: string
  orderId: string
  machineId: string
  jobId: string | null
  dispatchId: string | null
  qty: Dec
  status: RollStatus
  createdAt: string
  order: OrderRef
  machine: Pick<Machine, 'id' | 'code' | 'type'>
}

export interface QCRecord {
  id: string
  rollId: string
  result: QCResult
  defectType: string | null
  notes: string | null
  checkedAt: string
  roll: Pick<Roll, 'id' | 'rollNo'> & { order: OrderRef; machine: Pick<Machine, 'id' | 'code'> }
  inspector: Ref
}

export interface Payment {
  id: string
  amount: Dec
  method: string | null
  paidAt: string
}

export interface Invoice {
  id: string
  invoiceNo: string
  amount: Dec
  status: InvoiceStatus
  issuedAt: string
  payments: Payment[]
}

export interface Dispatch {
  id: string
  dispatchNo: string
  vehicleNo: string | null
  dispatchedAt: string
  order: Pick<Order, 'id' | 'orderNo' | 'fabricType' | 'colour' | 'pricePerUnit'>
  buyer: Ref
  rolls: Pick<Roll, 'id' | 'rollNo' | 'qty'>[]
  invoice: Invoice | null
}

// GET /track/:token — public, no auth.
export interface Tracking {
  orderNo: string
  buyerName: string
  fabricType: string
  colour: string
  qty: Dec
  deadline: string
  status: OrderStatus
  producedQty: Dec
  passedQty: Dec
  dispatchedQty: Dec
  updatedAt: string
}

// GET /reports/owner?month=YYYY-MM — OWNER only.
export interface OwnerReport {
  month: string
  revenue: number // invoiced this month
  received: number // buyer payments this month
  materialCost: number // inward bills this month
  wages: number // wage payments this month
  profit: number // revenue - materialCost - wages
  orders: { orderNo: string; buyer: string; materialCost: number; revenue: number; margin: number }[]
  machines: { code: string; type: Stage; produced: number }[]
}

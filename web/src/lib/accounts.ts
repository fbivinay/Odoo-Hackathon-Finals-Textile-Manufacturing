// Shared bits for the Accounts pages: periods, money helpers and API shapes.

export const todayIst = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)

// Indian financial year: April to March. "FY 2025-26" runs 2025-04-01 to 2026-03-31.
export function fyOf(day: string) {
  const y = +day.slice(0, 4)
  return +day.slice(5, 7) >= 4 ? y : y - 1
}

export function periodPresets(today = todayIst()) {
  const fy = fyOf(today)
  const label = (y: number) => `FY ${y}-${String(y + 1).slice(2)}`
  const presets = [
    { key: 'fy', label: `${label(fy)} to date`, from: `${fy}-04-01`, to: today },
    { key: 'month', label: 'This month', from: `${today.slice(0, 7)}-01`, to: today },
    { key: `fy${fy - 1}`, label: label(fy - 1), from: `${fy - 1}-04-01`, to: `${fy}-03-31` },
    { key: `fy${fy - 2}`, label: label(fy - 2), from: `${fy - 2}-04-01`, to: `${fy - 1}-03-31` },
    { key: `fy${fy - 3}`, label: label(fy - 3), from: `${fy - 3}-04-01`, to: `${fy - 2}-03-31` },
  ]
  for (const y of [2025, 2024, 2023]) presets.push({ key: `y${y}`, label: `Calendar ${y}`, from: `${y}-01-01`, to: `${y}-12-31` })
  return presets
}

export const n = (v: unknown) => Number(v ?? 0)
export const gstOf = (r: { cgst?: unknown; sgst?: unknown; igst?: unknown }) => Math.round((n(r.cgst) + n(r.sgst) + n(r.igst)) * 100) / 100

export const TREATMENT: Record<string, string> = {
  NIL: 'Nil rated',
  INTRA: 'CGST + SGST',
  INTER: 'IGST',
  EXEMPT: 'Exempt',
  NON_GST: 'Outside GST',
  RCM_INTRA: 'Reverse charge (CGST + SGST)',
  RCM_INTER: 'Reverse charge (IGST)',
  UNCLASSIFIED: 'Not classified',
}

export interface Paged<T> {
  rows: T[]
  count: number
  totals: { taxable: number; tax: number; total: number }
}

export interface MonthRow {
  month: string
  revenue: number
  outputGst: number
  materials: number
  yarn: number
  maintenance: number
  wages: number
  logistics: number
  utilities: number
  purchases: number
  inputGst: number
  rcm: number
  cashIn: number
  cashOut: number
  grossProfit: number
  netProfit: number
  gstPayable: number
}

export interface Company {
  name: string
  state: string
  address: string | null
  gstin: string | null
  synthetic: boolean
}

export interface OpenItem {
  id: string
  invoiceNo?: string
  billNo?: string
  buyer?: string
  supplier?: string
  orderNo?: string
  material?: string
  dueDate: string | null
  balance: number
  daysOverdue: number
}

export interface Overview {
  period: { from: string; to: string }
  company: Company
  pnl: { revenue: number; materials: number; wages: number; grossProfit: number; logistics: number; utilities: number; maintenance: number; netProfit: number; expenses: number }
  receivable: { total: number; overdue: number; count: number; overdueCount: number }
  payable: { bills: number; billsOverdue: number; billsDueSoon: number; expenses: number; accrued: number }
  cash: { in: number; out: number; net: number }
  gst: { output: number; input: number; rcm: number; payable: number }
  purchases: number
  workInProgress: number // materials issued to orders not billed yet, today
  series: MonthRow[]
  topReceivables: OpenItem[]
  billsDue: OpenItem[]
}

export interface TaxFields {
  taxCode: string | null
  taxRatePct: number
  taxTreatment: string | null
  cgst: number
  sgst: number
  igst: number
  itcEligible: boolean
  totalAmount: number | null
}

export interface SalesInvoice extends TaxFields {
  id: string
  invoiceNo: string
  amount: number
  status: 'UNPAID' | 'PARTIAL' | 'PAID'
  issuedAt: string
  dueDate: string | null
  paid: number
  balance: number
  payable: number
  tax: number
  overdueDays: number
  payments: { id: string; amount: number; method: string | null; reference: string | null; paidAt: string }[]
  dispatch: {
    dispatchNo: string
    dispatchedAt: string
    vehicleNo?: string | null
    buyer: { id: string; name: string; state: string; phone?: string | null; email?: string | null }
    order: { id: string; orderNo: string; fabricType?: string; colour?: string; pricePerUnit?: number; createdAt?: string }
    rolls?: { rollNo: string; qty: number }[]
  }
}

export interface Bill extends TaxFields {
  id: string
  billNo: string | null
  qty: number
  rate: number
  billAmount: number
  receivedAt: string
  dueDate: string | null
  batchNo: string | null
  payable: number
  paid: number
  balance: number
  tax: number
  overdueDays: number
  status: 'UNPAID' | 'PARTIAL' | 'PAID'
  payments: { id: string; amount: number; method: string | null; reference: string | null; paidAt: string }[]
  supplier: { id: string; name: string; state: string; phone?: string | null }
  material: { id: string; yarnType: string; colour: string; unit: string; category: string; sku?: string | null }
}

export interface Expense extends TaxFields {
  id: string
  voucherNo: string
  category: 'LOGISTICS' | 'UTILITIES'
  subcategory: string
  description: string
  payee: string
  incurredAt: string
  dueDate: string | null
  amount: number
  status: 'PAID' | 'UNPAID' | 'ACCRUED'
  paidAt: string | null
  method: string | null
  reference: string | null
  costCentre: string
  recurring: boolean
  tax: number
  order?: { orderNo: string } | null
  dispatch?: { dispatchNo: string } | null
}

export interface Rule {
  code: string
  label: string
  hsn: string
  confidence: string
  note: string
}

export interface AuditRow {
  id: string
  action: string
  detail: string | null
  by: string
  at: string
}

import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable } from '@/components/DataTable'
import { Field, selectClass } from '@/components/Field'
import { Pill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { type Bill, type Expense, type Paged, type SalesInvoice, TREATMENT, todayIst } from '@/lib/accounts'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatINR } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import { usePeriod, type PeriodProps } from '@/pages/Accounts'
import type { Ref } from '@/types'

const PAGE_SIZE = 50
const money = (v: number) => <span className="tabular-nums">{formatINR(v)}</span>

// Filters and page number live in the URL with the period, so Back from a document keeps them.
function useFilter(key: string) {
  const { params, set } = usePeriod()
  return [params.get(key) ?? '', (v: string) => set({ [key]: v, page: '' })] as const
}

function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>
}

function SearchBox({ placeholder }: { placeholder: string }) {
  const [q, setQ] = useFilter('q')
  const [draft, setDraft] = useState(q)
  return (
    <form
      className="relative min-w-56 flex-1"
      onSubmit={(e) => {
        e.preventDefault()
        setQ(draft.trim())
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input aria-label="Search" placeholder={placeholder} className="pl-8" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft.trim() !== q && setQ(draft.trim())} />
    </form>
  )
}

function Select({ label, k, options, className }: { label: string; k: string; options: [string, string][]; className?: string }) {
  const [v, setV] = useFilter(k)
  return (
    <select aria-label={label} className={cn(selectClass, 'w-44 bg-surface', className)} value={v} onChange={(e) => setV(e.target.value)}>
      {options.map(([value, text]) => (
        <option key={value} value={value}>
          {text}
        </option>
      ))}
    </select>
  )
}

function Pager({ count }: { count: number }) {
  const [p, setP] = useFilter('page')
  const page = Math.max(1, Number(p) || 1)
  const last = Math.max(1, Math.ceil(count / PAGE_SIZE))
  return (
    <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>
        {count === 0 ? 'No entries' : `${((page - 1) * PAGE_SIZE + 1).toLocaleString('en-IN')}–${Math.min(page * PAGE_SIZE, count).toLocaleString('en-IN')} of ${count.toLocaleString('en-IN')}`}
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setP(String(page - 1))}>
          Previous
        </Button>
        <Button size="sm" variant="outline" disabled={page >= last} onClick={() => setP(String(page + 1))}>
          Next
        </Button>
      </div>
    </div>
  )
}

function Totals({ totals, label }: { totals?: Paged<unknown>['totals']; label: string }) {
  if (!totals) return null
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>
        Taxable <b className="tabular-nums">{formatINR(totals.taxable)}</b>
      </span>
      <span>
        GST <b className="tabular-nums">{formatINR(totals.tax)}</b>
      </span>
      <span>
        Total <b className="tabular-nums">{formatINR(totals.total)}</b>
      </span>
    </div>
  )
}

const query = (o: Record<string, string>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString()

const statusPill = (status: string, overdueDays: number) =>
  status === 'PAID' ? <Pill tone="good">Paid</Pill> : overdueDays > 0 ? <Pill tone="problem">Overdue {overdueDays}d</Pill> : status === 'PARTIAL' ? <Pill tone="watch">Part paid</Pill> : <Pill>Unpaid</Pill>

// ------------------------------------------------------------- invoices --

export function Invoices({ from, to }: PeriodProps) {
  const navigate = useNavigate()
  const { params } = usePeriod()
  const buyers = useApi<Ref[]>('/buyers')
  const list = useApi<Paged<SalesInvoice>>(
    `/accounts/invoices?${query({ from, to, status: params.get('status') ?? '', buyerId: params.get('buyerId') ?? '', q: params.get('q') ?? '', page: params.get('page') ?? '', pageSize: String(PAGE_SIZE) })}`,
  )
  const cols: ColumnDef<SalesInvoice>[] = [
    { id: 'no', header: 'Invoice', cell: ({ row: { original: i } }) => <div className="leading-tight"><p className="font-medium">{i.invoiceNo}</p><p className="text-xs text-muted-foreground">{formatDate(i.issuedAt)}</p></div> },
    { id: 'buyer', header: 'Buyer', cell: ({ row: { original: i } }) => <div className="leading-tight"><p>{i.dispatch.buyer.name}</p><p className="text-xs text-muted-foreground">{i.dispatch.order.orderNo} · {i.dispatch.dispatchNo}</p></div> },
    { id: 'taxable', header: 'Taxable', cell: ({ row: { original: i } }) => money(i.amount) },
    { id: 'gst', header: 'GST', cell: ({ row: { original: i } }) => <div className="leading-tight">{money(i.tax)}<p className="text-xs text-muted-foreground">{TREATMENT[i.taxTreatment ?? ''] ?? '—'}</p></div> },
    { id: 'total', header: 'Total', cell: ({ row: { original: i } }) => <b>{money(i.payable)}</b> },
    { id: 'balance', header: 'Balance', cell: ({ row: { original: i } }) => (i.balance > 0 ? money(i.balance) : '—') },
    { id: 'due', header: 'Due', cell: ({ row: { original: i } }) => (i.dueDate ? formatDate(i.dueDate) : '—') },
    { id: 'status', header: 'Status', cell: ({ row: { original: i } }) => statusPill(i.status, i.overdueDays) },
  ]
  return (
    <div className="space-y-3">
      <Toolbar>
        <SearchBox placeholder="Invoice no., order no. or buyer" />
        <Select label="Status" k="status" options={[['', 'All statuses'], ['UNPAID', 'Unpaid'], ['PARTIAL', 'Part paid'], ['PAID', 'Paid'], ['OVERDUE', 'Overdue']]} />
        <Select label="Buyer" k="buyerId" options={[['', 'All buyers'], ...(buyers.data ?? []).map((b): [string, string] => [b.id, b.name])]} className="w-52" />
      </Toolbar>
      <Totals totals={list.data?.totals} label={`${list.data?.count ?? 0} invoices`} />
      {list.error && <p className="text-sm text-problem">{list.error}</p>}
      <DataTable columns={cols} data={list.data?.rows ?? []} loading={list.loading && !list.data} onRowClick={(i) => navigate(`/accounts/invoices/${i.id}`)} empty="No invoices in this period." />
      <Pager count={list.data?.count ?? 0} />
    </div>
  )
}

// ---------------------------------------------------------------- bills --

const CATEGORIES: [string, string][] = [['', 'All materials'], ['YARN', 'Yarn'], ['WEAVING', 'Weaving'], ['DYEING', 'Dyeing'], ['FINISHING', 'Finishing'], ['QC', 'QC'], ['PACKAGING', 'Packaging'], ['MAINTENANCE', 'Maintenance']]

export function Bills({ from, to }: PeriodProps) {
  const navigate = useNavigate()
  const { params } = usePeriod()
  const suppliers = useApi<Ref[]>('/suppliers')
  const list = useApi<Paged<Bill>>(
    `/accounts/bills?${query({ from, to, status: params.get('status') ?? '', supplierId: params.get('supplierId') ?? '', category: params.get('category') ?? '', q: params.get('q') ?? '', page: params.get('page') ?? '', pageSize: String(PAGE_SIZE) })}`,
  )
  const cols: ColumnDef<Bill>[] = [
    { id: 'no', header: 'Bill', cell: ({ row: { original: b } }) => <div className="leading-tight"><p className="font-medium">{b.billNo ?? '—'}</p><p className="text-xs text-muted-foreground">{formatDate(b.receivedAt)}</p></div> },
    { id: 'supplier', header: 'Supplier', cell: ({ row: { original: b } }) => <div className="leading-tight"><p>{b.supplier.name}</p><p className="text-xs text-muted-foreground">{b.supplier.state}</p></div> },
    { id: 'item', header: 'Material', cell: ({ row: { original: b } }) => <div className="leading-tight"><p>{b.material.yarnType}</p><p className="text-xs text-muted-foreground">{Number(b.qty).toLocaleString('en-IN')} {b.material.unit} × {formatINR(Number(b.rate))}</p></div> },
    { id: 'taxable', header: 'Taxable', cell: ({ row: { original: b } }) => money(Number(b.billAmount)) },
    { id: 'gst', header: 'GST', cell: ({ row: { original: b } }) => <div className="leading-tight">{b.tax ? money(b.tax) : '—'}<p className="text-xs text-muted-foreground">{TREATMENT[b.taxTreatment ?? ''] ?? 'Before GST fields'}{b.tax ? ` ${Number(b.taxRatePct)}%` : ''}</p></div> },
    { id: 'total', header: 'Total', cell: ({ row: { original: b } }) => <b>{money(b.payable)}</b> },
    { id: 'due', header: 'Due', cell: ({ row: { original: b } }) => (b.dueDate ? formatDate(b.dueDate) : '—') },
    { id: 'status', header: 'Status', cell: ({ row: { original: b } }) => statusPill(b.status, b.overdueDays) },
  ]
  return (
    <div className="space-y-3">
      <Toolbar>
        <SearchBox placeholder="Bill no., supplier or material" />
        <Select label="Status" k="status" options={[['', 'All statuses'], ['OPEN', 'Not fully paid'], ['OVERDUE', 'Overdue'], ['PAID', 'Paid']]} />
        <Select label="Material" k="category" options={CATEGORIES} />
        <Select label="Supplier" k="supplierId" options={[['', 'All suppliers'], ...(suppliers.data ?? []).map((s): [string, string] => [s.id, s.name])]} className="w-52" />
      </Toolbar>
      <Totals totals={list.data?.totals} label={`${list.data?.count ?? 0} bills`} />
      {list.error && <p className="text-sm text-problem">{list.error}</p>}
      <DataTable columns={cols} data={list.data?.rows ?? []} loading={list.loading && !list.data} onRowClick={(b) => navigate(`/accounts/bills/${b.id}`)} empty="No supplier bills in this period." />
      <Pager count={list.data?.count ?? 0} />
    </div>
  )
}

// ------------------------------------------------------------- expenses --

type ExpensePage = Paged<Expense> & { bySubcategory: { category: string; subcategory: string; amount: number; count: number }[] }

const SUBCATEGORIES: Record<'LOGISTICS' | 'UTILITIES', [string, string, string][]> = {
  // [subcategory, default tax code, cost centre]
  LOGISTICS: [
    ['Driver salaries', 'SALARY', 'Fleet'], ['Driver allowances', 'SALARY', 'Dispatch'], ['Truck rental', 'VEHICLE_HIRE', 'Dispatch'], ['Diesel/petrol', 'FUEL', 'Dispatch'],
    ['Vehicle maintenance', 'REPAIRS', 'Fleet'], ['Tolls and parking', 'TOLL', 'Dispatch'], ['Loading and unloading', 'UNREGISTERED', 'Dispatch'],
    ['Third-party transport', 'GTA', 'Dispatch'], ['Courier', 'COURIER', 'Fleet'], ['Vehicle insurance', 'INSURANCE', 'Fleet'], ['Permits', 'GOVT_FEE', 'Fleet'], ['Failed delivery', 'GTA', 'Dispatch'],
  ],
  UTILITIES: [
    ['Electricity', 'ELECTRICITY', 'Utilities'], ['Water', 'WATER', 'Utilities'], ['Steam and boiler fuel', 'COAL', 'Utilities'], ['Generator diesel', 'FUEL', 'Utilities'],
    ['Wastewater treatment', 'WATER', 'Utilities'], ['Effluent treatment plant', 'ETP', 'Utilities'],
  ],
}

export function Expenses({ from, to }: PeriodProps) {
  const navigate = useNavigate()
  const { params } = usePeriod()
  const [adding, setAdding] = useState(false)
  const category = params.get('category') ?? ''
  const list = useApi<ExpensePage>(
    `/accounts/expenses?${query({ from, to, category, subcategory: params.get('subcategory') ?? '', status: params.get('status') ?? '', costCentre: params.get('costCentre') ?? '', q: params.get('q') ?? '', page: params.get('page') ?? '', pageSize: String(PAGE_SIZE) })}`,
  )
  const subs = category ? SUBCATEGORIES[category as 'LOGISTICS' | 'UTILITIES'] : [...SUBCATEGORIES.LOGISTICS, ...SUBCATEGORIES.UTILITIES]
  const cols: ColumnDef<Expense>[] = [
    { id: 'no', header: 'Voucher', cell: ({ row: { original: e } }) => <div className="leading-tight"><p className="font-medium">{e.voucherNo}</p><p className="text-xs text-muted-foreground">{formatDate(e.incurredAt)}</p></div> },
    { id: 'what', header: 'Expense', cell: ({ row: { original: e } }) => <div className="max-w-80 leading-tight"><p>{e.subcategory}</p><p className="truncate text-xs text-muted-foreground">{e.description}</p></div> },
    { id: 'payee', header: 'Payee', cell: ({ row: { original: e } }) => <div className="leading-tight"><p>{e.payee}</p><p className="text-xs text-muted-foreground">{[e.costCentre, e.dispatch?.dispatchNo ?? e.order?.orderNo].filter(Boolean).join(' · ')}</p></div> },
    { id: 'amount', header: 'Amount', cell: ({ row: { original: e } }) => money(Number(e.amount)) },
    { id: 'gst', header: 'GST', cell: ({ row: { original: e } }) => <div className="leading-tight">{e.tax ? money(e.tax) : '—'}<p className="text-xs text-muted-foreground">{TREATMENT[e.taxTreatment ?? ''] ?? ''}</p></div> },
    { id: 'total', header: 'Total', cell: ({ row: { original: e } }) => <b>{money(Number(e.totalAmount ?? e.amount))}</b> },
    { id: 'status', header: 'Status', cell: ({ row: { original: e } }) => (e.status === 'PAID' ? <Pill tone="good">Paid</Pill> : e.status === 'ACCRUED' ? <Pill tone="watch">Accrued</Pill> : <Pill tone="problem">Unpaid</Pill>) },
  ]
  return (
    <div className="space-y-3">
      <Toolbar>
        <SearchBox placeholder="Voucher, payee, description or reference" />
        <Select label="Category" k="category" options={[['', 'Logistics and utilities'], ['LOGISTICS', 'Logistics and transport'], ['UTILITIES', 'Factory utilities']]} className="w-52" />
        <Select label="Type" k="subcategory" options={[['', 'All types'], ...subs.map(([s]): [string, string] => [s, s])]} className="w-52" />
        <Select label="Status" k="status" options={[['', 'All statuses'], ['PAID', 'Paid'], ['UNPAID', 'Unpaid'], ['ACCRUED', 'Accrued']]} className="w-36" />
        <Select label="Cost centre" k="costCentre" options={[['', 'All cost centres'], ['Dispatch', 'Dispatch'], ['Fleet', 'Fleet'], ['Utilities', 'Utilities']]} className="w-40" />
        <Button className="gap-1.5" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          New expense
        </Button>
      </Toolbar>
      {list.data && list.data.bySubcategory.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {list.data.bySubcategory.slice(0, 10).map((s) => (
            <span key={s.subcategory} className="rounded-full border border-border bg-surface px-3 py-1 text-xs">
              {s.subcategory} <b className="tabular-nums">{formatINR(s.amount)}</b> <span className="text-muted-foreground">· {s.count}</span>
            </span>
          ))}
        </div>
      )}
      <Totals totals={list.data?.totals} label={`${list.data?.count ?? 0} entries`} />
      {list.error && <p className="text-sm text-problem">{list.error}</p>}
      <DataTable columns={cols} data={list.data?.rows ?? []} loading={list.loading && !list.data} onRowClick={(e) => navigate(`/accounts/expenses/${e.id}`)} empty="No expenses match." />
      <Pager count={list.data?.count ?? 0} />
      {adding && <ExpenseDialog onClose={() => setAdding(false)} />}
    </div>
  )
}

const STATES = ['Gujarat', 'Maharashtra', 'Rajasthan', 'Madhya Pradesh', 'Karnataka', 'Delhi', 'Haryana', 'Punjab', 'Tamil Nadu', 'West Bengal', 'Other state']

function ExpenseDialog({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({
    category: 'LOGISTICS' as 'LOGISTICS' | 'UTILITIES', subcategory: 'Diesel/petrol', description: '', payee: '', partyState: 'Gujarat',
    incurredAt: todayIst(), dueDate: '', amount: '', status: 'UNPAID', method: '', reference: '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const sub = SUBCATEGORIES[f.category].find(([s]) => s === f.subcategory) ?? SUBCATEGORIES[f.category][0]

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/accounts/expenses', {
        method: 'POST',
        body: {
          category: f.category, subcategory: sub[0], description: f.description, payee: f.payee, partyState: f.partyState,
          incurredAt: f.incurredAt, dueDate: f.dueDate || undefined, amount: Number(f.amount), taxCode: sub[1], costCentre: sub[2],
          status: f.status, paidAt: f.status === 'PAID' ? f.incurredAt : undefined, method: f.method || undefined, reference: f.reference || undefined,
        },
      })
      toast.success('Expense recorded')
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New expense</DialogTitle>
          <DialogDescription>GST is worked out from the type and the payee's state. Materials for the store are booked by receiving them, not here.</DialogDescription>
        </DialogHeader>
        <form id="expense" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label="Category" htmlFor="category">
            <select id="category" className={selectClass} value={f.category} onChange={(e) => setF((x) => ({ ...x, category: e.target.value as 'LOGISTICS', subcategory: SUBCATEGORIES[e.target.value as 'LOGISTICS'][0][0] }))}>
              <option value="LOGISTICS">Logistics and transport</option>
              <option value="UTILITIES">Factory utilities</option>
            </select>
          </Field>
          <Field label="Type" htmlFor="subcategory">
            <select id="subcategory" className={selectClass} value={sub[0]} onChange={set('subcategory')}>
              {SUBCATEGORIES[f.category].map(([s]) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" htmlFor="description">
              <Input id="description" required value={f.description} onChange={set('description')} placeholder="October power bill" />
            </Field>
          </div>
          <Field label="Payee" htmlFor="payee">
            <Input id="payee" required value={f.payee} onChange={set('payee')} />
          </Field>
          <Field label="Payee's state" htmlFor="partyState">
            <select id="partyState" className={selectClass} value={f.partyState} onChange={set('partyState')}>
              {STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Date" htmlFor="incurredAt">
            <Input id="incurredAt" type="date" required max={todayIst()} value={f.incurredAt} onChange={set('incurredAt')} />
          </Field>
          <Field label="Amount before GST (₹)" htmlFor="amount">
            <Input id="amount" type="number" min="0.01" step="0.01" required value={f.amount} onChange={set('amount')} />
          </Field>
          <Field label="Status" htmlFor="status">
            <select id="status" className={selectClass} value={f.status} onChange={set('status')}>
              <option value="UNPAID">Unpaid bill</option>
              <option value="PAID">Paid</option>
              <option value="ACCRUED">Accrued (no bill yet)</option>
            </select>
          </Field>
          {f.status === 'PAID' ? (
            <>
              <Field label="Paid by" htmlFor="method">
                <select id="method" required className={selectClass} value={f.method} onChange={set('method')}>
                  <option value="">Select…</option>
                  {['NEFT', 'RTGS', 'UPI', 'Cheque', 'Card', 'Cash', 'FASTag'].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label="Reference (optional)" htmlFor="reference">
                <Input id="reference" value={f.reference} onChange={set('reference')} />
              </Field>
            </>
          ) : (
            <Field label="Due date (optional)" htmlFor="dueDate">
              <Input id="dueDate" type="date" value={f.dueDate} onChange={set('dueDate')} />
            </Field>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form="expense" disabled={busy}>
            {busy ? 'Saving…' : 'Record expense'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

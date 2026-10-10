import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable } from '@/components/DataTable'
import { Field, selectClass } from '@/components/Field'
import { Pill } from '@/components/StatusPill'
import { KpiCard } from '@/components/tremor/KpiCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { type Bill, type Expense, type Paged, type SalesInvoice, todayIst } from '@/lib/accounts'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatINR, formatMoney } from '@/lib/format'
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

function Totals({ totals, count, noun }: { totals?: Paged<unknown>['totals']; count?: number; noun: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <KpiCard label={noun} value={(count ?? 0).toLocaleString('en-IN')} loading={!totals} />
      <KpiCard label="Before GST" value={formatMoney(totals?.taxable ?? 0)} loading={!totals} />
      <KpiCard label="Total with GST" value={formatMoney(totals?.total ?? 0)} loading={!totals} />
    </div>
  )
}

// Number and date in one cell.
const Doc = ({ no, date }: { no: string; date: string }) => (
  <div className="leading-tight">
    <p className="font-medium">{no}</p>
    <p className="text-xs text-muted-foreground">{formatDate(date)}</p>
  </div>
)

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
  // Five columns; the invoice page has GST, order and dispatch.
  const cols: ColumnDef<SalesInvoice>[] = [
    { id: 'no', header: 'Invoice', cell: ({ row: { original: i } }) => <Doc no={i.invoiceNo} date={i.issuedAt} /> },
    { id: 'buyer', header: 'Buyer', cell: ({ row: { original: i } }) => i.dispatch.buyer.name },
    { id: 'total', header: 'Amount', cell: ({ row: { original: i } }) => <b>{money(i.payable)}</b> },
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
      <Totals totals={list.data?.totals} count={list.data?.count} noun="Invoices" />
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
    { id: 'no', header: 'Bill', cell: ({ row: { original: b } }) => <Doc no={b.billNo ?? '—'} date={b.receivedAt} /> },
    { id: 'supplier', header: 'Supplier', cell: ({ row: { original: b } }) => b.supplier.name },
    { id: 'item', header: 'Material', cell: ({ row: { original: b } }) => b.material.yarnType },
    { id: 'total', header: 'Amount', cell: ({ row: { original: b } }) => <b>{money(b.payable)}</b> },
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
      <Totals totals={list.data?.totals} count={list.data?.count} noun="Bills" />
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

// One picker for what the money was spent on: each type sits once, under its own category.
function TypeSelect() {
  const { params, set } = usePeriod()
  const value = `${params.get('category') ?? ''}|${params.get('subcategory') ?? ''}`
  return (
    <select
      aria-label="Expense type"
      className={cn(selectClass, 'w-56 bg-surface')}
      value={value}
      onChange={(e) => {
        const [category, subcategory] = e.target.value.split('|')
        set({ category, subcategory, page: '' })
      }}
    >
      <option value="|">All expenses</option>
      {(['LOGISTICS', 'UTILITIES'] as const).map((cat) => (
        <optgroup key={cat} label={cat === 'LOGISTICS' ? 'Logistics and transport' : 'Factory utilities'}>
          <option value={`${cat}|`}>All {cat === 'LOGISTICS' ? 'logistics' : 'utilities'}</option>
          {SUBCATEGORIES[cat].map(([sub]) => (
            <option key={sub} value={`${cat}|${sub}`}>
              {sub}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

export function Expenses({ from, to }: PeriodProps) {
  const navigate = useNavigate()
  const { params } = usePeriod()
  const [adding, setAdding] = useState(false)
  const category = params.get('category') ?? ''
  const list = useApi<ExpensePage>(
    `/accounts/expenses?${query({ from, to, category, subcategory: params.get('subcategory') ?? '', status: params.get('status') ?? '', costCentre: params.get('costCentre') ?? '', q: params.get('q') ?? '', page: params.get('page') ?? '', pageSize: String(PAGE_SIZE) })}`,
  )
  const cols: ColumnDef<Expense>[] = [
    { id: 'no', header: 'Voucher', cell: ({ row: { original: e } }) => <Doc no={e.voucherNo} date={e.incurredAt} /> },
    { id: 'what', header: 'Type', cell: ({ row: { original: e } }) => <div className="leading-tight"><p>{e.subcategory}</p><p className="text-xs text-muted-foreground">{e.category === 'UTILITIES' ? 'Utilities' : 'Logistics'}</p></div> },
    { id: 'payee', header: 'Paid to', cell: ({ row: { original: e } }) => e.payee },
    { id: 'total', header: 'Amount', cell: ({ row: { original: e } }) => <b>{money(Number(e.totalAmount ?? e.amount))}</b> },
    { id: 'status', header: 'Status', cell: ({ row: { original: e } }) => (e.status === 'PAID' ? <Pill tone="good">Paid</Pill> : e.status === 'ACCRUED' ? <Pill tone="watch">Accrued</Pill> : <Pill tone="problem">Unpaid</Pill>) },
  ]
  return (
    <div className="space-y-3">
      <Toolbar>
        <SearchBox placeholder="Voucher, payee, description or reference" />
        <TypeSelect />
        <Select label="Status" k="status" options={[['', 'All statuses'], ['PAID', 'Paid'], ['UNPAID', 'Unpaid'], ['ACCRUED', 'Accrued']]} className="w-36" />
        <Button className="gap-1.5" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          New expense
        </Button>
      </Toolbar>
      <Totals totals={list.data?.totals} count={list.data?.count} noun="Expenses" />
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

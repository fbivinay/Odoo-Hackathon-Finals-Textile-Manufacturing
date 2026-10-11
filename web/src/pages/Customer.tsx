import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowLeft, Mail, MapPin, Phone, Search, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from '@/auth/session'
import { actsAs, PageSkeleton } from '@/components/AppShell'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Field, selectClass } from '@/components/Field'
import { Figure } from '@/components/Figure'
import { PageHead } from '@/components/PageHead'
import { StatusPill } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ApiError } from '@/lib/api'
import { summariseCustomers, type CInvoice, type COrder } from '@/lib/customers'
import { dayFromToday, formatDate, formatINR, formatMoney, formatQty } from '@/lib/format'
import { PERIODS, useCustomerData } from '@/lib/useCustomers'
import { cn } from '@/lib/utils'
import { CollectDialog } from '@/pages/Customers'

const DAY = 86400000
// Paid: invoice date to final payment. Unpaid: days since the invoice.
function invoiceDays(i: CInvoice, today: string) {
  const paid = i.balance <= 0.5 && i.payments.length > 0
  const end = paid ? i.payments.reduce((m, x) => (x.paidAt > m ? x.paidAt : m), i.payments[0].paidAt) : today
  return { paid, days: Math.max(0, Math.floor((Date.parse(end) - Date.parse(i.issuedAt)) / DAY)) }
}

export function Customer() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useSession()
  const { data, error } = useCustomerData()
  const [period, setPeriod] = useState<string>('365')
  const [tab, setTab] = useState<'orders' | 'invoices'>('orders')
  const [showAll, setShowAll] = useState(false)
  const [q, setQ] = useState('')
  const [collecting, setCollecting] = useState(false)
  const [editing, setEditing] = useState(false)
  // The address is saved here; the shared client history refreshes in the background.
  const [savedAddress, setSavedAddress] = useState<string | null | undefined>(undefined)
  const needle = q.trim().toLowerCase()
  const p = PERIODS.find((x) => x.key === period)!
  const from = p.days ? dayFromToday(-p.days) : null
  const today = dayFromToday(0)
  const inPeriod = (iso: string) => !from || iso.slice(0, 10) >= from

  const stats = useMemo(() => (data ? summariseCustomers(data, { from, today }) : null), [data, from, today])
  const s = stats?.find((x) => x.buyer.id === id)

  const invoices = useMemo(() => data?.invoices.filter((i) => i.dispatch.buyer.id === id) ?? [], [data, id])
  const orders = useMemo(() => (data?.orders.filter((o) => o.buyerId === id && inPeriod(o.createdAt)) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [data, id, from]) // eslint-disable-line react-hooks/exhaustive-deps
  // Unpaid first, whatever the period: money owed never drops off the list.
  const history = invoices
    .filter((i) => i.balance > 0.5 || inPeriod(i.issuedAt))
    .sort((a, b) => Number(b.balance > 0.5) - Number(a.balance > 0.5) || b.issuedAt.localeCompare(a.issuedAt))
  const found = (...nos: string[]) => !needle || nos.some((n) => n.toLowerCase().includes(needle))
  const shownInvoices = history.filter((i) => found(i.invoiceNo, i.dispatch.order.orderNo))
  const shownOrders = orders.filter((o) => found(o.orderNo, o.fabricType))

  if (error) return <p className="text-sm text-problem">{error}</p>
  if (!stats) return <PageSkeleton />
  if (!s) {
    return (
      <div className="data-table-wrap">
        <EmptyState icon={Users} line="This client was not found." actionLabel="Back to clients" onAction={() => navigate('/clients')} />
      </div>
    )
  }
  const address = savedAddress !== undefined ? savedAddress : s.buyer.address
  const canEdit = actsAs(user, 'STORE', 'DISPATCH') || (user?.extraTabs ?? []).includes('/clients')
  const canCollect = actsAs(user, 'DISPATCH')

  // No column sorting on either list: the newest, and anything unpaid, comes first.
  const orderCols: ColumnDef<COrder>[] = [
    {
      id: 'no',
      header: 'Order',
      meta: { width: '22%' },
      enableSorting: false,
      cell: ({ row: { original: o } }) => (
        <div className="leading-tight">
          <p className="font-medium">{o.orderNo}</p>
          <p className="text-xs text-muted-foreground">{formatDate(o.createdAt)}</p>
        </div>
      ),
    },
    {
      id: 'fabric',
      header: 'Fabric',
      meta: { width: '24%' },
      enableSorting: false,
      cell: ({ row: { original: o } }) => (
        <div className="leading-tight">
          <p className="truncate">{o.fabricType}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{formatQty(o.qty)}</p>
        </div>
      ),
    },
    {
      id: 'value',
      header: 'Value',
      meta: { width: '20%' },
      enableSorting: false,
      cell: ({ row: { original: o } }) => (
        <div className="leading-tight tabular-nums">
          <p>{formatMoney(o.qty * o.pricePerUnit)}</p>
          <p className="text-xs text-muted-foreground">{formatINR(o.pricePerUnit)} per metre</p>
        </div>
      ),
    },
    { id: 'deadline', header: 'Due', meta: { width: '16%' }, enableSorting: false, accessorFn: (o) => formatDate(o.deadline) },
    { id: 'status', header: 'Status', meta: { width: '18%' }, enableSorting: false, cell: ({ row: { original: o } }) => <StatusPill status={o.status} /> },
  ]
  const invoiceCols: ColumnDef<CInvoice>[] = [
    {
      id: 'no',
      header: 'Invoice',
      meta: { width: '22%' },
      enableSorting: false,
      cell: ({ row: { original: i } }) => (
        <div className="leading-tight">
          <p className="font-medium">{i.invoiceNo}</p>
          <p className="text-xs text-muted-foreground">{formatDate(i.issuedAt)}</p>
        </div>
      ),
    },
    { id: 'order', header: 'Order', meta: { width: '18%' }, enableSorting: false, accessorFn: (i) => i.dispatch.order.orderNo },
    { id: 'amount', header: 'Amount', meta: { width: '18%' }, enableSorting: false, cell: ({ row: { original: i } }) => <span className="tabular-nums">{formatINR(i.amount)}</span> },
    { id: 'balance', header: 'Still owed', meta: { width: '18%' }, enableSorting: false, cell: ({ row: { original: i } }) => <span className={cn('tabular-nums', i.balance > 0.5 && 'font-medium text-problem')}>{i.balance > 0.5 ? formatINR(i.balance) : '—'}</span> },
    {
      id: 'status',
      header: 'Status',
      meta: { width: '24%' },
      enableSorting: false,
      cell: ({ row: { original: i } }) => {
        const { days, paid } = invoiceDays(i, today)
        return (
          <div className="leading-tight">
            <StatusPill status={i.status} />
            <p className={cn('mt-0.5 text-xs', paid ? 'text-muted-foreground' : days > 60 ? 'font-medium text-problem' : 'text-muted-foreground')}>{paid ? `Paid in ${days} days` : `${days} days unpaid`}</p>
          </div>
        )
      },
    },
  ]
  const rows = tab === 'orders' ? shownOrders : shownInvoices
  const limit = 10

  return (
    <div className="space-y-5">
      <Link to="/clients" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-brand">
        <ArrowLeft className="size-4" />
        Clients
      </Link>
      <PageHead
        eyebrow={s.firstOrder ? `Client since ${new Date(s.firstOrder).getFullYear()}` : 'Client'}
        title={s.buyer.name}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Period" className={cn(selectClass, 'w-40 bg-white')} value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
            {canCollect && s.outstanding > 0.5 && <Button onClick={() => setCollecting(true)}>Receive payment</Button>}
          </div>
        }
      />

      {/* How to reach them, and where their fabric goes. */}
      <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
        {s.buyer.phone && (
          <a href={`tel:${s.buyer.phone}`} className="inline-flex items-center gap-1.5 hover:text-brand">
            <Phone className="size-3.5" />
            {s.buyer.phone}
          </a>
        )}
        {s.buyer.email && (
          <a href={`mailto:${s.buyer.email}`} className="inline-flex items-center gap-1.5 hover:text-brand">
            <Mail className="size-3.5" />
            {s.buyer.email}
          </a>
        )}
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-3.5 shrink-0" />
          {address || <span className="text-muted-foreground">No delivery address</span>}
          {canEdit && (
            <button type="button" className="font-medium text-brand underline-offset-2 hover:underline" onClick={() => setEditing(true)}>
              {address ? 'Edit' : 'Add'}
            </button>
          )}
        </span>
      </div>

      <section className="figures-panel">
        <div className="grid gap-4 sm:grid-cols-3">
          <Figure label="Revenue" value={formatMoney(s.invoiced)} note={`${s.orders} order${s.orders === 1 ? '' : 's'}${s.marginPct != null ? ` · ${s.marginPct.toFixed(1)}% margin` : ''}`} />
          <Figure
            label="Outstanding"
            onClick={() => setTab('invoices')}
            active={tab === 'invoices'}
            tone={s.overdue > 0 ? 'problem' : s.outstanding > 0.5 ? 'watch' : 'good'}
            value={formatMoney(s.outstanding)}
            note={s.outstanding <= 0.5 ? 'Everything is paid' : s.overdue > 0 ? `${formatMoney(s.overdue)} over 60 days` : 'Nothing overdue'}
          />
          <Figure label="Pays in" value={s.daysToPay === null ? '—' : `${s.daysToPay} days`} note={s.paidWithin30 === null ? 'No paid invoices yet' : `${Math.round(s.paidWithin30 * 100)}% paid within 30 days`} />
        </div>
      </section>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as typeof tab)
          setShowAll(false)
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="orders">Orders · {orders.length}</TabsTrigger>
            <TabsTrigger value="invoices">Invoices · {history.length}</TabsTrigger>
          </TabsList>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Search" placeholder={tab === 'orders' ? 'Search order or fabric' : 'Search invoice or order'} className="bg-white pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <TabsContent value="orders" className="mt-4">
          <DataTable
            columns={orderCols}
            data={showAll ? shownOrders : shownOrders.slice(0, limit)}
            onRowClick={(o) => navigate(`/orders/${o.id}`)}
            empty={<EmptyState icon={Search} line={needle ? 'No order matches.' : 'No orders in this period.'} actionLabel={needle ? 'Clear search' : undefined} onAction={needle ? () => setQ('') : undefined} />}
          />
        </TabsContent>
        <TabsContent value="invoices" className="mt-4">
          <DataTable
            columns={invoiceCols}
            data={showAll ? shownInvoices : shownInvoices.slice(0, limit)}
            empty={<EmptyState icon={Search} line={needle ? 'No invoice matches.' : 'No invoices in this period.'} actionLabel={needle ? 'Clear search' : undefined} onAction={needle ? () => setQ('') : undefined} />}
          />
        </TabsContent>
      </Tabs>
      {rows.length > limit && (
        <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
          <span>
            Showing {showAll ? rows.length : limit} of {rows.length}
          </span>
          <Button size="xs" variant="outline" onClick={() => setShowAll(!showAll)}>
            {showAll ? `Show first ${limit}` : 'Show all'}
          </Button>
        </div>
      )}

      {collecting && <CollectDialog client={s} onClose={() => setCollecting(false)} />}
      {editing && <AddressDialog id={s.buyer.id} name={s.buyer.name} address={address ?? ''} onClose={() => setEditing(false)} onSaved={setSavedAddress} />}
    </div>
  )
}

// The one delivery address: a single line, used as the default place their fabric is sent.
function AddressDialog({ id, name, address, onClose, onSaved }: { id: string; name: string; address: string; onClose: () => void; onSaved: (a: string | null) => void }) {
  const [value, setValue] = useState(address)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      // `quiet`: only the address changed, so the whole client history need not be read again.
      await api(`/buyers/${id}`, { method: 'PATCH', body: { address: value.trim() || null }, quiet: true })
      onSaved(value.trim() || null)
      toast.success('Delivery address saved')
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delivery address</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>
        <form id="client-address" onSubmit={submit}>
          <Field label="Address" htmlFor="address" hint="Fabric for this client is delivered here.">
            <Input id="address" autoFocus maxLength={300} placeholder="Plot 12, GIDC Estate, Surat, Gujarat 395003" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="client-address" disabled={busy || value.trim() === address.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

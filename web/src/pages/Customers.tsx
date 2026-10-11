import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Search } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { useSession } from '@/auth/session'
import { actsAs } from '@/components/AppShell'
import { Field, selectClass } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { api, ApiError } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { PageHead } from '@/components/PageHead'
import { Figure } from '@/components/Figure'
import { summariseCustomers, type CustomerStats } from '@/lib/customers'
import { dayFromToday, formatDate, formatINR, formatMoney } from '@/lib/format'
import { PERIODS, useCustomerData } from '@/lib/useCustomers'

const RANK_BY: { key: string; label: string; value: (r: CustomerStats) => number | null; asc?: boolean }[] = [
  { key: 'score', label: 'Overall score', value: (r) => r.score },
  { key: 'invoiced', label: 'Revenue', value: (r) => r.invoiced },
  { key: 'orders', label: 'Most orders', value: (r) => r.orders },
  { key: 'metres', label: 'Most metres', value: (r) => r.metres },
  { key: 'pay', label: 'Fastest payment', value: (r) => r.daysToPay, asc: true },
  { key: 'margin', label: 'Best margin', value: (r) => r.marginPct },
  { key: 'outstanding', label: 'Most outstanding', value: (r) => r.outstanding },
]

const pct = (v: number | null, digits = 0) => (v === null ? '—' : `${v.toFixed(digits)}%`)

export function Customers() {
  const navigate = useNavigate()
  const { data, error } = useCustomerData()
  const [period, setPeriod] = useState<string>('365')
  const [rankBy, setRankBy] = useState('score')
  const { user } = useSession()
  // Payments are taken by the owner or the dispatch desk.
  const canCollect = actsAs(user, 'DISPATCH')
  const [collecting, setCollecting] = useState<CustomerStats | null>(null)
  const p = PERIODS.find((x) => x.key === period)!
  const from = p.days ? dayFromToday(-p.days) : null

  const stats = useMemo(() => (data ? summariseCustomers(data, { from, today: dayFromToday(0) }) : null), [data, from])
  const ranked = useMemo(() => {
    if (!stats) return []
    const r = RANK_BY.find((x) => x.key === rankBy)!
    // Buyers without a figure go last whichever way the list runs.
    return [...stats].sort((a, b) => {
      const va = r.value(a)
      const vb = r.value(b)
      if (va === null || vb === null) return va === null ? (vb === null ? 0 : 1) : -1
      return r.asc ? va - vb : vb - va
    })
  }, [stats, rankBy])

  const [search, setSearch] = useState('')
  const shown = ranked.filter((s) => s.buyer.name.toLowerCase().includes(search.trim().toLowerCase()))

  const active = stats?.filter((s) => s.orders > 0) ?? []
  const invoiced = active.reduce((t, s) => t + s.invoiced, 0)
  const outstanding = stats?.reduce((t, s) => t + s.outstanding, 0) ?? 0
  const overdue = stats?.reduce((t, s) => t + s.overdue, 0) ?? 0
  const top = [...active].sort((a, b) => b.invoiced - a.invoiced)[0]
  const best = (get: (s: CustomerStats) => number | null, asc = false) =>
    active.filter((s) => get(s) !== null).sort((a, b) => (asc ? get(a)! - get(b)! : get(b)! - get(a)!))[0]
  const slowest = best((s) => s.daysToPay)
  const margin = best((s) => s.marginPct)
  const owing = best((s) => s.overdue || null)

  const columns: ColumnDef<CustomerStats>[] = [
    { id: 'name', header: 'Client', accessorFn: (s) => s.buyer.name, cell: ({ row: { original: s } }) => <span className="font-medium">{s.buyer.name}</span> },
    { id: 'orders', header: 'Total orders', accessorFn: (s) => s.orders },
    { id: 'invoiced', header: 'Revenue', accessorFn: (s) => s.invoiced, cell: ({ row: { original: s } }) => formatMoney(s.invoiced) },
    {
      id: 'outstanding',
      header: 'Outstanding',
      accessorFn: (s) => s.outstanding,
      cell: ({ row: { original: s } }) => <span className={s.overdue > 0 ? 'text-problem' : undefined}>{s.outstanding > 0 ? formatMoney(s.outstanding) : '—'}</span>,
    },
    { id: 'last', header: 'Last order', accessorFn: (s) => s.lastOrder ?? '', cell: ({ row: { original: s } }) => (s.lastOrder ? formatDate(s.lastOrder) : '—') },
    {
      id: 'act',
      header: '',
      enableSorting: false,
      cell: ({ row: { original: s } }) =>
        canCollect && s.outstanding > 0.5 ? (
          <div className="flex justify-end">
            <Button
              size="xs"
              onClick={(e) => {
                // The row itself opens the client; this button only opens the payment popup.
                e.stopPropagation()
                setCollecting(s)
              }}
            >
              Receive payment
            </Button>
          </div>
        ) : null,
    },
  ]

  const loading = !stats && !error

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Sales"
        title="Clients"
        actions={
          <div className="flex gap-2">
            <select aria-label="Rank by" className={`${selectClass} max-w-52 bg-surface`} value={rankBy} onChange={(e) => setRankBy(e.target.value)}>
              {RANK_BY.map((r) => (
                <option key={r.key} value={r.key}>
                  Rank: {r.label}
                </option>
              ))}
            </select>
            <select aria-label="Period" className={`${selectClass} max-w-44 bg-surface`} value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
          </div>
        }
      />
      {error && <p className="text-sm text-problem">{error}</p>}

      {/* Six figures: three about the book as a whole, three naming the client behind a number. */}
      <section className="figures-panel">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Figure label="Active clients" value={String(active.length)} note={stats ? `of ${stats.length} on the books` : undefined} loading={loading} />
          <Figure label="Revenue" value={formatMoney(invoiced)} note={`Invoiced, ${p.label.toLowerCase()}`} loading={loading} />
          <Figure label="Outstanding today" tone={overdue > 0 ? 'problem' : undefined} value={formatMoney(outstanding)} note={overdue > 0 ? `${formatMoney(overdue)} over 60 days` : 'Nothing overdue'} loading={loading} />
          <Figure label="Biggest client" onClick={top ? () => navigate(`/clients/${top.buyer.id}`) : undefined} value={top?.buyer.name ?? '—'} note={top ? `${formatMoney(top.invoiced)} · ${pct(top.share * 100)} of revenue` : undefined} loading={loading} />
          <Figure label="Best margin" onClick={margin ? () => navigate(`/clients/${margin.buyer.id}`) : undefined} tone={margin ? 'good' : undefined} value={margin?.buyer.name ?? '—'} note={margin ? `${pct(margin.marginPct, 1)} margin` : undefined} loading={loading} />
          {owing ? (
            <Figure label="Most overdue" onClick={() => navigate(`/clients/${owing.buyer.id}`)} tone="problem" value={owing.buyer.name} note={`${formatMoney(owing.overdue)} overdue`} loading={loading} />
          ) : (
            <Figure label="Slowest payer" onClick={slowest ? () => navigate(`/clients/${slowest.buyer.id}`) : undefined} tone={slowest ? 'watch' : undefined} value={slowest?.buyer.name ?? '—'} note={slowest ? `${slowest.daysToPay} days to pay` : undefined} loading={loading} />
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-head">All clients</h2>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Search clients" placeholder="Search client" className="bg-white pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <DataTable
          key={rankBy}
          columns={columns}
          data={shown}
          loading={loading}
          onRowClick={(s) => navigate(`/clients/${s.buyer.id}`)}
          empty={<EmptyState icon={Search} line={`No client matches "${search.trim()}".`} actionLabel="Clear search" onAction={() => setSearch('')} />}
        />
      </section>
      {collecting && <CollectDialog client={collecting} onClose={() => setCollecting(null)} />}
    </div>
  )
}

export function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ground">
        <div className="h-full rounded-full bg-brand" style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs tabular-nums">{score}</span>
    </div>
  )
}

// An invoice still owed, as GET /invoices?open=true returns it.
interface OpenInvoice {
  id: string
  invoiceNo: string
  issuedAt: string
  balance: number
  dispatch: { order: { id: string; orderNo: string } }
}
const METHODS = ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Cash']

// Take what a client owes: every pending order in one go, or one order at a time.
export function CollectDialog({ client, onClose }: { client: CustomerStats; onClose: () => void }) {
  const open = useApi<OpenInvoice[]>(`/invoices?open=true&buyerId=${client.buyer.id}&limit=200`)
  const [method, setMethod] = useState('NEFT')
  const [busy, setBusy] = useState<string | null>(null)
  const rows = open.data ?? []
  const total = rows.reduce((t, r) => t + Number(r.balance), 0)

  // Each invoice is settled in full, one after another; whatever is done stays done if one fails.
  async function receive(list: OpenInvoice[], key: string) {
    setBusy(key)
    let done = 0
    try {
      for (const inv of list) {
        await api(`/invoices/${inv.id}/payments`, { method: 'POST', body: { amount: Number(inv.balance), method } })
        done += 1
      }
      toast.success(list.length === 1 ? `${formatINR(Number(list[0].balance))} received for ${list[0].dispatch.order.orderNo}` : `${formatINR(list.reduce((t, r) => t + Number(r.balance), 0))} received for ${list.length} orders`)
      if (list.length === rows.length) onClose()
      else open.reload()
    } catch (err) {
      toast.error(`${err instanceof ApiError ? err.message : 'Something went wrong.'}${done ? ` ${done} of ${list.length} were saved.` : ''}`)
      open.reload()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Receive payment</DialogTitle>
          <DialogDescription>{client.buyer.name}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Paid by" htmlFor="pay-method">
            <select id="pay-method" className={selectClass} value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          {open.loading && !open.data ? (
            <Skeleton className="h-32 w-full" />
          ) : open.error ? (
            <p className="text-sm text-problem">{open.error}</p>
          ) : rows.length === 0 ? (
            <p className="rounded-lg bg-good-bg px-3 py-2 text-sm text-good">Nothing is pending. Every invoice is paid.</p>
          ) : (
            <div>
              <p className="mb-1.5 text-sm font-medium">Pending, order by order</p>
              <ul className="divide-y divide-border rounded-lg bg-zinc-50 px-3 text-sm">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 leading-tight">
                      <span className="font-medium">{r.dispatch.order.orderNo}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.invoiceNo} · {formatDate(r.issuedAt)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 tabular-nums">
                      {formatINR(Number(r.balance))}
                      <Button size="xs" variant="outline" disabled={busy !== null} onClick={() => receive([r], r.id)}>
                        Receive
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {rows.length > 0 && (
            <Button disabled={busy !== null} onClick={() => receive(rows, 'all')}>
              Receive all · {formatINR(total)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Recycle, Search } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { selectClass } from '@/components/Field'
import { Figure } from '@/components/Figure'
import { PageHead } from '@/components/PageHead'
import { Pagination } from '@/components/Pagination'
import { RollLink } from '@/components/RollTrace'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/auth/session'
import { useDataVersion } from '@/lib/changes'
import { ApiError } from '@/lib/api'
import { fetchAll, pagerOf, useClientPages } from '@/lib/useApi'
import { dayFromToday, formatDateTime, formatINR, formatMoney, formatQty } from '@/lib/format'
import { cn } from '@/lib/utils'
import { costPerMetreOf, summariseWaste, type Bucket, type WasteRoll } from '@/lib/waste'
import type { OrderCost } from '@/types'

const PERIODS = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '365', label: 'Last 12 months', days: 365 },
]

// A rejected roll as the list shows it.
type Rejected = WasteRoll & { order: WasteRoll['order'] & { colour?: string | null } }
const defectOf = (r: WasteRoll) => r.qcRecords.find((q) => q.result === 'REJECT')
// The list API also sends who made each check; the shared waste type doesn't carry it.
const inspectorOf = (r: WasteRoll) => (defectOf(r) as { inspector?: { name: string } } | undefined)?.inspector?.name
const rollsOf = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'roll' : 'rolls'}`

// Fabric that failed quality check: how much, what it cost, and where it came from, so a defect
// can be traced to its cause. Reworked fabric is not waste and is not counted here.
export function Waste() {
  const { user } = useSession()
  const isOwner = user?.role === 'OWNER'
  const [period, setPeriod] = useState('30')
  const days = PERIODS.find((p) => p.key === period)!.days
  const [rolls, setRolls] = useState<Rejected[] | null>(null)
  const [costs, setCosts] = useState<Map<string, number> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // The list can be narrowed to one defect, one machine, or both.
  const [defect, setDefect] = useState('')
  const [machine, setMachine] = useState('')
  // Cost of waste box: every rejected roll, costliest first instead of newest first.
  const [byCost, setByCost] = useState(false)
  const listTop = useRef<HTMLDivElement>(null)
  const toList = () => listTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const version = useDataVersion()

  useEffect(() => {
    let live = true
    setError(null)
    fetchAll<Rejected>(`/qc/rolls?from=${dayFromToday(-days)}`)
      .then((r) => live && setRolls(r))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load rolls.'))
    return () => {
      live = false
    }
  }, [days, version])

  // Cost per metre comes from the owner's order-cost report; other roles see quantities only.
  useEffect(() => {
    if (!isOwner) return
    let live = true
    fetchAll<OrderCost>(`/reports/order-costs?from=${dayFromToday(-days - 120)}`)
      .then((c) => live && setCosts(costPerMetreOf(c)))
      .catch(() => live && setCosts(new Map()))
    return () => {
      live = false
    }
  }, [days, isOwner, version])

  const s = useMemo(() => (rolls ? summariseWaste(rolls, costs ?? new Map()) : null), [rolls, costs])
  const rejected = useMemo(() => (rolls ?? []).filter((r) => r.status === 'REJECTED'), [rolls])
  // The same rate Quality check shows: rejected rolls out of the rolls with a final result.
  const passedCount = (rolls ?? []).filter((r) => r.status === 'PASSED' || r.status === 'DISPATCHED').length
  const decided = passedCount + rejected.length
  const rejectRate = decided ? Math.round((100 - Math.round((passedCount / decided) * 1000) / 10) * 10) / 10 : null
  const byDefect = (s?.byDefect ?? []).filter((b) => b.rejected > 0).sort((a, b) => b.rejected - a.rejected)
  const byMachine = (s?.byMachine ?? []).filter((b) => b.rejected > 0).sort((a, b) => b.rejected - a.rejected)
  const loading = !rolls && !error
  const costOf = (r: WasteRoll) => (costs?.get(r.orderId) ?? 0) * Number(r.qty)

  const q = search.trim().toLowerCase()
  const matches = rejected.filter(
    (r) =>
      (!defect || (defectOf(r)?.defectType ?? 'Unspecified') === defect) &&
      (!machine || r.machine.code === machine) &&
      (!q || [r.rollNo, r.order.orderNo, r.order.fabricType, r.order.buyer?.name, r.machine.code, defectOf(r)?.defectType].some((v) => v?.toLowerCase().includes(q))),
  )
  const ordered = byCost ? [...matches].sort((a, b) => costOf(b) - costOf(a)) : matches
  const paged = useClientPages(ordered)
  const rows = paged.rows
  const filtered = !!q || !!defect || !!machine
  const clear = () => {
    setSearch('')
    setDefect('')
    setMachine('')
    setByCost(false)
  }

  const columns: ColumnDef<Rejected>[] = [
    {
      accessorKey: 'rollNo',
      header: 'Roll',
      meta: { width: '16%' },
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <div className="leading-tight">
          <RollLink id={r.id} rollNo={r.rollNo} />
          <p className="text-xs text-muted-foreground tabular-nums">{formatQty(r.qty)}</p>
        </div>
      ),
    },
    {
      id: 'order',
      header: 'Order',
      meta: { width: '22%' },
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <div className="leading-tight">
          <p className="font-medium">{r.order.orderNo}</p>
          <p className="truncate text-xs text-muted-foreground">{[r.order.fabricType, r.order.colour].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    { id: 'machine', header: 'Machine', meta: { width: '11%' }, enableSorting: false, accessorFn: (r) => r.machine.code },
    { id: 'defect', header: 'Defect', meta: { width: '15%' }, enableSorting: false, accessorFn: (r) => defectOf(r)?.defectType ?? '—' },
    {
      id: 'when',
      header: 'Rejected',
      meta: { width: '20%' },
      enableSorting: false,
      cell: ({ row: { original: r } }) => {
        const check = defectOf(r)
        if (!check) return <span className="text-muted-foreground">—</span>
        return (
          <div className="leading-tight">
            <p>{formatDateTime(check.checkedAt)}</p>
            {/* Who made the call, as in Quality check. */}
            <p className="text-xs text-muted-foreground">{inspectorOf(r) ? `by ${inspectorOf(r)}` : ''}</p>
          </div>
        )
      },
    },
    ...(isOwner
      ? [{ id: 'cost', header: 'Cost', meta: { width: '16%' }, enableSorting: false, cell: ({ row: { original: r } }: { row: { original: Rejected } }) => <span className="tabular-nums">{costOf(r) > 0 ? formatINR(costOf(r)) : '—'}</span> } as ColumnDef<Rejected>]
      : []),
  ]

  return (
    <div className="space-y-5">
      <PageHead
        eyebrow="Rejected fabric"
        title="Waste"
        actions={
          <select aria-label="Period" className={cn(selectClass, 'w-40 bg-white')} value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        }
      />
      {error && <p className="text-sm text-problem">{error}</p>}

      <section className="figures-panel">
        <div className="grid gap-4 sm:grid-cols-3">
          <Figure
            label="Rejected"
            onClick={clear}
            active={!filtered && !byCost}
            tone={rejected.length ? 'problem' : undefined}
            value={rollsOf(rejected.length)}
            note={
              s && rejectRate != null ? (
                <>
                  {formatQty(s.rejected)} · <span className="font-semibold text-problem">{rejectRate}%</span> of {decided.toLocaleString('en-IN')} rolls checked
                </>
              ) : (
                'Nothing checked in this period'
              )
            }
            loading={loading}
          />
          <Figure
            label="Cost of waste"
            // One view at a time: this one is all rolls, costliest first. Clicking it again goes back to normal.
            onClick={
              isOwner
                ? () => {
                    const on = !byCost
                    clear()
                    setByCost(on)
                  }
                : undefined
            }
            active={byCost}
            value={isOwner ? formatMoney(s?.rejectCost ?? 0) : '—'}
            note={isOwner ? `Lost in the ${PERIODS.find((p) => p.key === period)!.label.toLowerCase()}` : 'Visible to the owner only'}
            loading={loading || (isOwner && !costs)}
          />
          <Figure
            label="Main cause"
            onClick={
              byDefect[0]
                ? () => {
                    const on = defect !== byDefect[0].label
                    clear()
                    if (on) setDefect(byDefect[0].label)
                  }
                : undefined
            }
            active={!!byDefect[0] && defect === byDefect[0].label}
            value={byDefect[0]?.label ?? 'None'}
            note={byDefect[0] ? `${formatQty(byDefect[0].rejected)}${byMachine[0] ? ` · most from ${byMachine[0].label}` : ''}` : 'No rejects in this period'}
            loading={loading}
          />
        </div>
      </section>

      <div ref={listTop} className="flex scroll-mt-4 flex-wrap items-center justify-between gap-2">
        <h2 className="section-head">
          Rejected rolls
          {byCost && <span className="ml-2 text-xs font-normal text-muted-foreground">costliest first</span>}
        </h2>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Search rejected rolls" placeholder="Search roll or order" className="bg-white pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select aria-label="Filter by defect" className={cn(selectClass, 'bg-white sm:w-auto sm:min-w-40')} value={defect} onChange={(e) => setDefect(e.target.value)}>
            <option value="">All defects</option>
            {byDefect.map((b) => (
              <option key={b.key} value={b.label}>
                {b.label}
              </option>
            ))}
          </select>
          <select aria-label="Filter by machine" className={cn(selectClass, 'bg-white sm:w-auto sm:min-w-36')} value={machine} onChange={(e) => setMachine(e.target.value)}>
            <option value="">All machines</option>
            {byMachine.map((b) => (
              <option key={b.key} value={b.label}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        empty={
          filtered ? (
            <EmptyState icon={Search} line="No rejected roll matches these filters." actionLabel="Clear filters" onAction={clear} />
          ) : (
            <EmptyState icon={Recycle} line="Nothing was rejected in this period." />
          )
        }
      />
      <Pagination {...pagerOf(paged)} />

      {/* Where the waste comes from. Picking a bar filters the list above and takes you back to it. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Breakdown
          title="By defect"
          rows={byDefect}
          loading={loading}
          picked={defect}
          onPick={(b) => {
            setDefect(defect === b.label ? '' : b.label)
            toList()
          }}
        />
        <Breakdown
          title="By machine"
          rows={byMachine}
          loading={loading}
          picked={machine}
          onPick={(b) => {
            setMachine(machine === b.label ? '' : b.label)
            toList()
          }}
        />
      </div>
    </div>
  )
}

// Where the rejected metres come from. Click a row to see just those rolls in the list.
function Breakdown({ title, rows, loading, picked, onPick }: { title: string; rows: Bucket[]; loading: boolean; picked: string; onPick: (b: Bucket) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.rejected))
  return (
    <section className="data-table-wrap space-y-3 p-4">
      <h2 className="section-head">{title}</h2>
      {loading ? (
        <Skeleton className="h-32" />
      ) : rows.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">Nothing rejected in this period.</p>
      ) : (
        <ul className="space-y-1">
          {rows.slice(0, 6).map((r) => (
            <li key={r.key}>
              <button
                type="button"
                aria-pressed={picked === r.label}
                onClick={() => onPick(r)}
                className={cn('w-full space-y-1 rounded-lg px-2 py-1.5 text-left transition-colors outline-none hover:bg-zinc-50 focus-visible:ring-3 focus-visible:ring-ring/50', picked === r.label && 'bg-brand-tint hover:bg-brand-tint')}
              >
                <span className="flex justify-between gap-3 text-sm">
                  <span className={cn(picked === r.label && 'font-medium text-brand')}>{r.label}</span>
                  <span className="text-ink-2 tabular-nums">{formatQty(r.rejected)}</span>
                </span>
                <span className="block h-1.5 overflow-hidden rounded-full bg-ink/5">
                  <span className="block h-full rounded-full bg-problem" style={{ width: `${(r.rejected / max) * 100}%` }} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

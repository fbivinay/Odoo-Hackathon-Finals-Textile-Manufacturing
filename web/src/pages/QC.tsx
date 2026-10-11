import { useEffect, useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { ClipboardCheck, Search } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Field, selectClass } from '@/components/Field'
import { Figure } from '@/components/Figure'
import { Pagination } from '@/components/Pagination'
import { PageHead } from '@/components/PageHead'
import { RollLink } from '@/components/RollTrace'
import { Pill, label } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { dayFromToday, formatDateTime, formatQty } from '@/lib/format'
import { api, ApiError } from '@/lib/api'
import { pagerOf, useApi, usePages } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import type { Machine, QcSummary, Roll, Stage } from '@/types'

const DEFECTS = ['Holes', 'Colour mismatch', 'Uneven weaving', 'Stains', 'Broken ends', 'Other']

// What is waiting, what passed and what failed: one list each, opened from its box at the top.
const VIEWS = [
  { key: 'waiting', title: 'Waiting to be checked', status: 'PENDING_QC', empty: 'No rolls waiting. Nice.' },
  { key: 'passed', title: 'Passed rolls', status: 'PASSED,DISPATCHED', empty: 'No roll has passed yet.' },
  { key: 'rejected', title: 'Rejected rolls', status: 'REJECTED', empty: 'No roll has been rejected.' },
] as const
type View = (typeof VIEWS)[number]['key']

const order = (r: Roll) => (
  <div className="leading-tight">
    <p className="font-medium">{r.order.orderNo}</p>
    <p className="truncate text-xs text-muted-foreground">{[r.order.fabricType, r.order.colour].filter(Boolean).join(' · ')}</p>
  </div>
)
const none = <span className="text-muted-foreground">—</span>
const rolls = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'roll' : 'rolls'}`
// The figures cover the last 30 days, so each check visibly moves them.
const WINDOW_DAYS = 30

export function QC() {
  const [view, setView] = useState<View>('waiting')
  const [checking, setChecking] = useState<{ roll: Roll; result: 'REWORK' | 'REJECT' } | null>(null)
  const [passing, setPassing] = useState<string | null>(null)
  const summary = useApi<QcSummary>('/qc/summary')
  const recent = useApi<QcSummary>(`/qc/summary?from=${dayFromToday(-WINDOW_DAYS)}`)
  const current = VIEWS.find((v) => v.key === view)!
  // Searched on the server, so it reaches every roll, not just the ones loaded so far.
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => setQ(search.trim()), 250)
    return () => window.clearTimeout(t)
  }, [search])
  // Rolls come off the dyeing line, so those are the machines to filter by.
  const machines = useApi<Machine[]>('/machines')
  const dyeing = (machines.data ?? []).filter((m) => m.type === 'DYEING')
  const [machineId, setMachineId] = useState('')
  const [defect, setDefect] = useState('')
  // Passed rolls are either still in the store or already on a truck.
  const [where, setWhere] = useState<'' | 'PASSED' | 'DISPATCHED'>('')
  const filters = `${q ? `&q=${encodeURIComponent(q)}` : ''}${machineId ? `&machineId=${machineId}` : ''}${view === 'rejected' && defect ? `&defect=${encodeURIComponent(defect)}` : ''}`
  const filtered = !!q || !!machineId || (view === 'rejected' && !!defect) || (view === 'passed' && !!where)
  const clear = () => {
    setSearch('')
    setMachineId('')
    setDefect('')
    setWhere('')
  }
  const list = usePages<Roll>(`/qc/rolls?status=${view === 'passed' && where ? where : current.status}${filters}`)
  const counts = summary.data?.counts
  const countOf: Record<View, number | undefined> = {
    waiting: counts?.PENDING_QC,
    passed: counts && counts.PASSED + counts.DISPATCHED,
    rejected: counts?.REJECTED,
  }
  // Pass needs nothing more: one click sends the roll to Dispatch.
  async function pass(roll: Roll) {
    setPassing(roll.id)
    try {
      await api(`/qc/rolls/${roll.id}/inspect`, { method: 'POST', body: { result: 'PASS' } })
      toast.success(`${roll.rollNo} passed, ready for dispatch`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setPassing(null)
    }
  }

  // Recent figures: every pass, rework or reject re-reads them, so the rate moves as you work.
  const c = recent.data?.counts
  const passed = c ? c.PASSED + c.DISPATCHED : 0
  // Final results only, so the two rates total 100%. Rework isn't a verdict: that fabric is made
  // again and judged as a new roll.
  const checkedCount = c ? passed + c.REJECTED : 0
  const passRate = checkedCount ? Math.round((passed / checkedCount) * 1000) / 10 : null
  const rejectRate = passRate == null ? null : Math.round((100 - passRate) * 10) / 10
  const topDefect = recent.data?.defectsByType.slice().sort((a, b) => b.count - a.count)[0]

  // Every list traces a roll to its order and machine. No column sorting: newest on top.
  const base: ColumnDef<Roll>[] = [
    {
      accessorKey: 'rollNo',
      header: 'Roll',
      meta: { width: '18%' },
      enableSorting: false,
      cell: ({ row: { original: r } }) => {
        const last = r.qcRecords[0]
        return (
          <div className="leading-tight">
            <RollLink id={r.id} rollNo={r.rollNo} />
            <p className="text-xs text-muted-foreground tabular-nums">{formatQty(r.qty)}</p>
            {view === 'waiting' && last?.result === 'REWORK' && <p className="text-xs font-medium text-watch">Re-check{last.defectType ? ` · ${last.defectType}` : ''}</p>}
          </div>
        )
      },
    },
    { id: 'order', header: 'Order', meta: { width: '24%' }, enableSorting: false, cell: ({ row: { original: r } }) => order(r) },
    { id: 'machine', header: 'Machine', meta: { width: '12%' }, enableSorting: false, accessorFn: (r) => r.machine.code },
  ]
  const checked: ColumnDef<Roll> = {
    id: 'checked',
    header: 'Checked',
    meta: { width: '26%' },
    enableSorting: false,
    cell: ({ row: { original: r } }) => {
      const last = r.qcRecords[0]
      if (!last) return none
      return (
        <div className="leading-tight">
          <p>{formatDateTime(last.checkedAt)}</p>
          <p className="text-xs text-muted-foreground">{last.inspector.name}</p>
        </div>
      )
    },
  }
  const columns: ColumnDef<Roll>[] =
    view === 'waiting'
      ? [
          ...base,
          { id: 'made', header: 'Made', meta: { width: '18%' }, enableSorting: false, accessorFn: (r) => formatDateTime(r.createdAt) },
          {
            id: 'act',
            header: '',
            meta: { width: '28%' },
            enableSorting: false,
            cell: ({ row: { original: r } }) => (
              <div className="flex justify-end gap-3">
                <Button size="xs" className="bg-good text-white hover:bg-good/90" disabled={passing === r.id} onClick={() => pass(r)}>
                  Pass
                </Button>
                <Button size="xs" variant="outline" onClick={() => setChecking({ roll: r, result: 'REWORK' })}>
                  Rework
                </Button>
                <Button size="xs" variant="destructive" onClick={() => setChecking({ roll: r, result: 'REJECT' })}>
                  Reject
                </Button>
              </div>
            ),
          },
        ]
      : view === 'passed'
        ? [...base, checked, { id: 'now', header: 'Now', meta: { width: '20%' }, enableSorting: false, cell: ({ row: { original: r } }) => (r.status === 'DISPATCHED' ? <Pill>Dispatched</Pill> : <Pill tone="good">In store</Pill>) }]
        : [...base, checked, { id: 'defect', header: 'Defect', meta: { width: '20%' }, enableSorting: false, cell: ({ row: { original: r } }) => r.qcRecords[0]?.defectType ?? none }]

  return (
    <div className="space-y-5">
      <PageHead eyebrow="Before it leaves the line" title="Quality check" />
      {(summary.error || list.error) && <p className="text-sm text-problem">{summary.error || list.error}</p>}

      <section className="figures-panel">
        <div className="grid gap-4 sm:grid-cols-3">
          <Figure
            label="Waiting to be checked"
            onClick={() => setView('waiting')}
            active={view === 'waiting'}
            tone={countOf.waiting ? 'watch' : undefined}
            value={rolls(countOf.waiting ?? 0)}
            note={countOf.waiting ? 'Ready for inspection' : 'Nothing left to inspect'}
            loading={summary.loading}
          />
          <Figure
            label="Passed"
            onClick={() => setView('passed')}
            active={view === 'passed'}
            tone={passRate == null ? undefined : passRate >= 90 ? 'good' : passRate >= 75 ? 'watch' : 'problem'}
            value={rolls(passed)}
            note={
              passRate == null ? (
                `In the last ${WINDOW_DAYS} days`
              ) : (
                <>
                  <span className="font-semibold text-good">{passRate}%</span> of {checkedCount.toLocaleString('en-IN')} checked in the last {WINDOW_DAYS} days
                </>
              )
            }
            loading={recent.loading}
          />
          <Figure
            label="Rejected"
            onClick={() => setView('rejected')}
            active={view === 'rejected'}
            tone={c?.REJECTED ? 'problem' : undefined}
            value={rolls(c?.REJECTED ?? 0)}
            note={
              <>
                {rejectRate != null && (
                  <>
                    <span className="font-semibold text-problem">{rejectRate}%</span> of {checkedCount.toLocaleString('en-IN')} checked in the last {WINDOW_DAYS} days
                  </>
                )}
                {topDefect && ` · mostly ${topDefect.defectType.toLowerCase()}`}
              </>
            }
            loading={recent.loading}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-head">{current.title}</h2>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Search rolls" placeholder="Search roll, order or fabric" className="bg-white pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select aria-label="Filter by machine" className={cn(selectClass, 'bg-white sm:w-auto sm:min-w-36')} value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            <option value="">All machines</option>
            {dyeing.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code}
              </option>
            ))}
          </select>
          {view === 'passed' && (
            <select aria-label="Filter by where it is now" className={cn(selectClass, 'bg-white sm:w-auto sm:min-w-36')} value={where} onChange={(e) => setWhere(e.target.value as '' | 'PASSED' | 'DISPATCHED')}>
              <option value="">All status</option>
              <option value="PASSED">In store</option>
              <option value="DISPATCHED">Dispatched</option>
            </select>
          )}
          {view === 'rejected' && (
            <select aria-label="Filter by defect" className={cn(selectClass, 'bg-white sm:w-auto sm:min-w-40')} value={defect} onChange={(e) => setDefect(e.target.value)}>
              <option value="">All defects</option>
              {DEFECTS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          )}
        </div>
      </div>
      <DataTable key={view} columns={columns} data={list.rows} loading={list.loading} empty={filtered ? <EmptyState icon={Search} line="No roll matches these filters." actionLabel="Clear filters" onAction={clear} /> : <EmptyState icon={ClipboardCheck} line={current.empty} />} />
      <Pagination {...pagerOf(list)} />

      {checking && <CheckDialog roll={checking.roll} result={checking.result} onClose={() => setChecking(null)} />}
    </div>
  )
}

// Yarn can't be redone, so rework goes back to weaving or dyeing.
const REWORK_STAGES: Stage[] = ['WEAVING', 'DYEING']
const choice = (on: boolean, onClass: string) =>
  cn('rounded-lg border text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50', on ? onClass : 'border-input text-zinc-600 hover:bg-zinc-50')

// The popup for a failed roll. Rework sends its fabric back to a stage under the same order;
// reject sends it to waste and raises a priority order to make it again.
function CheckDialog({ roll, result, onClose }: { roll: Roll; result: 'REWORK' | 'REJECT'; onClose: () => void }) {
  const [defectType, setDefectType] = useState('')
  const [reworkStage, setReworkStage] = useState<Stage | ''>('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const before = roll.qcRecords[0]?.result === 'REWORK' ? roll.qcRecords[0] : null
  const length = formatQty(roll.qty)
  const ready = !!defectType && (result === 'REJECT' || !!reworkStage)

  const outcome =
    result === 'REJECT'
      ? `This roll goes to Waste. A new priority order for ${length} is created for ${roll.order.buyer.name}.`
      : reworkStage
        ? `${roll.order.orderNo} goes back to the ${label(reworkStage).toLowerCase()} list for ${length}${reworkStage === 'WEAVING' ? ', then dyeing' : ''}. Same order number.`
        : null
  const cta = result === 'REJECT' ? 'Reject roll' : reworkStage ? `Move to ${label(reworkStage).toLowerCase()}` : 'Move'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    const body = { result, defectType, notes: notes.trim() || undefined, ...(result === 'REWORK' ? { reworkStage } : {}) }
    try {
      const saved = await api<Roll & { replacementOrder?: { orderNo: string } }>(`/qc/rolls/${roll.id}/inspect`, { method: 'POST', body })
      toast.success(
        result === 'REWORK' ? `${roll.rollNo} sent back to ${label(reworkStage as Stage).toLowerCase()}` : `${roll.rollNo} rejected. Priority order ${saved.replacementOrder?.orderNo ?? ''} created`,
      )
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
          <DialogTitle>
            {result === 'REWORK' ? 'Rework' : 'Reject'} {roll.rollNo} · {length}
          </DialogTitle>
          <DialogDescription>{[roll.order.orderNo, roll.order.fabricType, roll.order.colour, `made on ${roll.machine.code}`].filter(Boolean).join(' · ')}</DialogDescription>
        </DialogHeader>
        <form id="check-roll" onSubmit={submit} className="grid gap-4">
          {before && (
            <p className="rounded-lg bg-watch-bg px-3 py-2 text-xs text-watch">
              Back from rework{before.defectType ? `: ${before.defectType.toLowerCase()}` : ''}.
            </p>
          )}
          <Field label="Reason" htmlFor="defect">
            <div id="defect" role="radiogroup" className="flex flex-wrap gap-1.5">
              {DEFECTS.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={defectType === d}
                  onClick={() => setDefectType(d)}
                  className={cn('h-7 rounded-full border px-2.5 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50', defectType === d ? 'border-brand bg-brand-tint font-medium text-brand' : 'border-input text-zinc-600 hover:bg-zinc-50')}
                >
                  {d}
                </button>
              ))}
            </div>
          </Field>
          {result === 'REWORK' && (
            <Field label="Send back to" htmlFor="rework-stage">
              <div id="rework-stage" role="radiogroup" className="grid grid-cols-2 gap-2">
                {REWORK_STAGES.map((st) => (
                  <button key={st} type="button" role="radio" aria-checked={reworkStage === st} onClick={() => setReworkStage(st)} className={cn('h-9', choice(reworkStage === st, 'border-brand bg-brand-tint text-brand'))}>
                    {label(st)}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label="Notes (optional)" htmlFor="notes">
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {outcome && <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-ink-2">{outcome}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="check-roll" variant={result === 'REJECT' ? 'destructive' : 'default'} disabled={busy || !ready}>
            {cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

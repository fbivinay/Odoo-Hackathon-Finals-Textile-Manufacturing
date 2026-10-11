import { useState } from 'react'
import { FlaskConical, History, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { selectClass } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { DECISION, describe, show, type Decision, type LabResult, type Metric, type SavedScenario } from '@/lib/lab'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import type { Run, Shared } from '@/pages/Lab'

const toRun = (s: SavedScenario & { result: LabResult }): Run => ({ draft: { name: s.name, changes: s.changes, costs: s.costs, days: s.days }, result: s.result })

// Saved what-ifs: kept apart from the mill's records. Reopen, edit, rerun on today's data, and
// note a decision. "Approved" is a note only; nothing is ever applied to live operations.
export function Saved({ options, setDraft, go, onOpen }: Shared & { onOpen: (r: Run) => void }) {
  const list = useApi<SavedScenario[]>('/lab/scenarios')
  const [busy, setBusy] = useState<string | null>(null)
  const [rerun, setRerun] = useState<{ name: string; before: Metric[]; after: Metric[]; snapshotBefore: string | null } | null>(null)
  const [deleting, setDeleting] = useState<SavedScenario | null>(null)
  const [historyOf, setHistoryOf] = useState<SavedScenario | null>(null)
  const names = { machine: (id: string) => options?.machines.find((m) => m.id === id)?.code ?? 'Machine', yarn: (id: string) => options?.yarns.find((y) => y.id === id)?.name ?? 'Yarn' }

  const full = (id: string) => api<SavedScenario & { result: LabResult }>(`/lab/scenarios/${id}`)
  async function act(id: string, fn: () => Promise<void>) {
    setBusy(id)
    try {
      await fn()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  if (list.error) return <p className="mt-4 text-sm text-problem">{list.error}</p>
  if (list.loading && !list.data) return <Skeleton className="mt-4 h-64 w-full" />
  if (!list.data?.length)
    return (
      <div className="mt-4 data-table-wrap p-8 text-center text-sm text-muted-foreground">
        No saved scenarios yet. Run a simulation and press Save.
      </div>
    )

  return (
    <div className="mt-4 space-y-4">
      {list.data.map((s) => {
        // The same two answers as on Results: orders on time, and when the last open order is ready.
        const metric = (k: string) => s.headline?.metrics.find((m) => m.key === k)
        const onTime = metric('onTime')
        const total = (onTime?.base ?? 0) + (metric('late')?.base ?? 0) + (metric('unscheduled')?.base ?? 0)
        const book = metric('clearBookDays')
        const bookDiff = book?.base != null && book.alt != null ? book.alt - book.base : 0
        // The changes, minus any already spelled out in the name.
        const summary = describe(s.changes, names).filter((d) => !s.name.includes(d)).join(' · ')
        return (
          <article key={s.id} className="data-table-wrap space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{s.name}</h3>
                {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
                <p className="text-xs text-muted-foreground">
                  Saved {formatDateTime(s.createdAt)} by {s.createdBy}
                </p>
              </div>
              <DecisionBox s={s} onSaved={list.reload} />
            </div>
            {s.headline && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                {onTime && (
                  <span>
                    Orders on time <b>{onTime.alt} of {total}</b>
                    {onTime.alt !== onTime.base && <span className="text-muted-foreground"> (today {onTime.base})</span>}
                  </span>
                )}
                {book?.alt != null && (
                  <span className={cn(bookDiff < 0 && 'text-good', bookDiff > 0 && 'text-problem')}>
                    All open orders done in <b>{book.alt} days</b>
                    {bookDiff !== 0 && ` (${Math.abs(bookDiff)} days ${bookDiff < 0 ? 'sooner' : 'later'})`}
                  </span>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy === s.id} onClick={() => act(s.id, async () => onOpen(toRun(await full(s.id))))}>
                Open
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => {
                  setDraft({ name: s.name, changes: s.changes, costs: s.costs, days: s.days })
                  go('builder')
                }}
              >
                <FlaskConical className="size-4" /> Edit as new
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={busy === s.id}
                onClick={() =>
                  act(s.id, async () => {
                    const r = await api<SavedScenario & { result: LabResult }>(`/lab/scenarios/${s.id}/run`, { method: 'POST' })
                    setRerun({ name: s.name, before: r.previous?.metrics ?? [], after: r.result.metrics, snapshotBefore: r.previous?.snapshotAt ?? null })
                    list.reload()
                  })
                }
              >
                <RefreshCw className={cn('size-4', busy === s.id && 'animate-spin')} /> Rerun on today’s data
              </Button>
              <Button size="sm" variant="ghost" className="gap-1" onClick={() => setHistoryOf(s)}>
                <History className="size-4" /> History
              </Button>
              <Button size="sm" variant="ghost" className="gap-1 text-problem" onClick={() => setDeleting(s)}>
                <Trash2 className="size-4" /> Delete
              </Button>
            </div>
          </article>
        )
      })}

      {rerun && (
        <Dialog open onOpenChange={(o) => !o && setRerun(null)}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{rerun.name}: previous run vs today</DialogTitle>
              <DialogDescription>Scenario figures from the last run (data read {rerun.snapshotBefore ? formatDateTime(rerun.snapshotBefore) : '—'}) against a fresh run on today’s data.</DialogDescription>
            </DialogHeader>
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 text-left font-medium">Measure</th>
                  <th className="py-1 text-right font-medium">Previous run</th>
                  <th className="py-1 text-right font-medium">Today</th>
                </tr>
              </thead>
              <tbody>
                {rerun.after.map((m) => {
                  const before = rerun.before.find((b) => b.key === m.key)
                  return (
                    <tr key={m.key} className="border-b last:border-0">
                      <td className="py-1">{m.label}</td>
                      <td className="py-1 text-right tabular-nums">{before ? show(before.alt, before.unit) : '—'}</td>
                      <td className={cn('py-1 text-right tabular-nums', before && before.alt !== m.alt && 'font-medium')}>{show(m.alt, m.unit)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </DialogContent>
        </Dialog>
      )}

      {historyOf && <HistoryDialog s={historyOf} onClose={() => setHistoryOf(null)} />}

      {deleting && (
        <Dialog open onOpenChange={(o) => !o && setDeleting(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete “{deleting.name}”?</DialogTitle>
              <DialogDescription>Only the saved scenario goes; the mill’s records are untouched. Its history stays in the audit log.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Keep it
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  act(deleting.id, async () => {
                    await api(`/lab/scenarios/${deleting.id}`, { method: 'DELETE' })
                    toast.success('Scenario deleted')
                    setDeleting(null)
                    list.reload()
                  })
                }
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function DecisionBox({ s, onSaved }: { s: SavedScenario; onSaved: () => void }) {
  const [decision, setDecision] = useState<Decision>(s.decision)
  const [note, setNote] = useState(s.note ?? '')
  const [busy, setBusy] = useState(false)
  const dirty = decision !== s.decision || note !== (s.note ?? '')
  async function save() {
    setBusy(true)
    try {
      await api(`/lab/scenarios/${s.id}`, { method: 'PATCH', body: { decision, note: note.trim() || null } })
      toast.success('Decision noted')
      onSaved()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="w-full space-y-2 sm:w-72">
      <select aria-label="Decision" className={cn(selectClass, 'bg-surface')} value={decision} onChange={(e) => setDecision(e.target.value as Decision)}>
        {(Object.keys(DECISION) as Decision[]).map((d) => (
          <option key={d} value={d}>
            {DECISION[d]}
          </option>
        ))}
      </select>
      <Textarea aria-label="Decision note" rows={2} placeholder="Why? (optional)" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
      {dirty && (
        <Button size="sm" className="w-full" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save decision'}
        </Button>
      )}
    </div>
  )
}

function HistoryDialog({ s, onClose }: { s: SavedScenario; onClose: () => void }) {
  const h = useApi<{ id: string; action: string; detail: string | null; by: string; at: string }[]>(`/lab/scenarios/${s.id}/history`)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>History: {s.name}</DialogTitle>
        </DialogHeader>
        {h.loading ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="space-y-1 text-sm">
            {h.data?.map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span>
                  {a.action.charAt(0) + a.action.slice(1).toLowerCase()}
                  {a.detail && <span className="block text-xs text-muted-foreground">{a.detail}</span>}
                </span>
                <span className="text-right text-xs text-muted-foreground">
                  {formatDateTime(a.at)}
                  <span className="block">{a.by}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

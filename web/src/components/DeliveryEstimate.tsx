import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Field } from '@/components/Field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { addDays, checkCommitment, daysBetween, estimateDelivery, MAX_OVERRIDE_DAYS, type PlanInput, type Stage } from '@/lib/deadline'
import { dayFromToday, formatDate, formatQty } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import type { Config, Planning, RawMaterial, Roll } from '@/types'

const HORIZON = 120 // days of plan to fit the new order into
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export interface Delivery {
  estimate: string | null // system-calculated date, or null when no reliable date can be given
  committed: string // the date promised to the buyer (the estimate, or up to 7 days later)
  reason: string // why the promise is later than the estimate
  valid: boolean // a date can be promised and the commitment rules are met
}

// planning/schedule returns `returning` per stage on the live API; the shared type predates it.
type Capacity = Planning['capacity'][Stage] & { returning?: { fromDay: number; perDay: number }[] }

// The delivery part of the new order form: the date the mill can actually make, worked out from
// today's plan (capacity, existing workload, repairs, yarn), and the date promised to the buyer.
export function DeliveryEstimate({ qty, yarnKg, materialId, onChange }: { qty: number; yarnKg: number; materialId: string; onChange: (d: Delivery) => void }) {
  const planning = useApi<Planning>(`/planning/schedule?days=${HORIZON}`)
  const materials = useApi<RawMaterial[]>('/materials')
  // Config: this yarn's delivery days and the QC days, the same figures the backend planner uses.
  const config = useApi<Config>('/config')
  const yarnLeadDays = config.data?.materials.find((m) => m.id === materialId)?.leadDays
  const qcDays = config.data?.settings.find((s) => s.key === 'qcDays')?.value
  // Rework allowance: the share of recently checked rolls that were sent back at least once.
  const recent = useApi<Roll[]>(`/qc/rolls?from=${dayFromToday(-60)}&limit=500`)
  const [commit, setCommit] = useState('')
  const [reason, setReason] = useState('')

  const reworkRate = useMemo(() => {
    const checked = (recent.data ?? []).filter((r) => r.qcRecords.length > 0)
    if (checked.length < 20) return 0
    return checked.filter((r) => r.qcRecords.some((q) => q.result === 'REWORK')).length / checked.length
  }, [recent.data])

  const material = materials.data?.find((m) => m.id === materialId)
  const committedYarn = planning.data?.yarnNeeds.find((y) => y.id === materialId)?.needed ?? 0
  const freeYarn = material ? Math.max(0, material.qtyInStock - committedYarn) : 0
  const yarnShort = material ? Math.max(0, yarnKg - freeYarn) : 0

  const estimate = useMemo(() => {
    if (!planning.data) return null
    const p = planning.data
    const cap = p.capacity as Record<Stage, Capacity>
    const plan: PlanInput = {
      today: new Date().toISOString().slice(0, 10),
      horizonDays: p.days,
      perDay: { SPINNING: cap.SPINNING.perDay, WEAVING: cap.WEAVING.perDay, DYEING: cap.DYEING.perDay },
      usable: { SPINNING: cap.SPINNING.usable, WEAVING: cap.WEAVING.usable, DYEING: cap.DYEING.usable },
      returning: { SPINNING: cap.SPINNING.returning ?? [], WEAVING: cap.WEAVING.returning ?? [], DYEING: cap.DYEING.returning ?? [] },
      weeklyLoad: p.weeklyLoad,
    }
    return estimateDelivery(plan, { yarnKg, metres: qty, reworkRate, yarnShortKg: yarnShort, yarnLeadDays, qcDays })
  }, [planning.data, yarnKg, qty, reworkRate, yarnShort, yarnLeadDays, qcDays])

  const estDate = estimate?.ok ? estimate.date! : null
  const commitError = estDate && commit ? checkCommitment(estDate, commit) : null
  const committed = estDate && commit && !commitError ? commit : estDate ?? ''
  const overridden = !!estDate && committed !== estDate
  const valid = !!estDate && !commitError && (!overridden || reason.trim().length > 0)

  useEffect(() => {
    onChange({ estimate: estDate, committed, reason: reason.trim(), valid })
  }, [estDate, committed, reason, valid, onChange])

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-3 rounded-xl bg-zinc-50 p-3" aria-live="polite">
      {planning.error && <p className="text-sm text-problem">Could not load the production plan: {planning.error}</p>}
      {!planning.error && !estimate && <Skeleton className="h-12" />}
      {estimate && !estimate.ok && (
        <div className="flex gap-2 text-sm text-watch">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>{estimate.limitation}</p>
        </div>
      )}

      {estimate?.ok && estDate && (
        <>
          {/* One line: the date the plan gives, and the date promised (the same unless changed). */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="leading-tight">
              <p className="text-xs text-muted-foreground">Delivery by</p>
              <p className="text-lg font-semibold tracking-tight text-brand">{formatDate(committed)}</p>
              <p className="text-xs text-muted-foreground">
                {overridden ? `Plan says ${formatDate(estDate)}` : `${plural(daysBetween(today, estDate), 'day')} from today`}
                <button type="button" className="ml-2 inline-flex items-center gap-1 underline-offset-2 hover:underline disabled:opacity-50" onClick={planning.reload} disabled={planning.loading}>
                  <RefreshCw className="size-3" />
                  Refresh
                </button>
              </p>
            </div>
            <div className="w-full sm:w-44">
              <label htmlFor="commit" className="text-xs text-muted-foreground">
                Promise a later date
              </label>
              <Input id="commit" type="date" className="mt-1 bg-white" min={estDate} max={addDays(estDate, MAX_OVERRIDE_DAYS)} value={commit || estDate} aria-invalid={!!commitError} onChange={(e) => setCommit(e.target.value)} />
            </div>
          </div>
          {commitError && <p className="text-xs text-problem">{commitError}</p>}

          {overridden && (
            <Field label="Reason for the later date" htmlFor="reason" hint={reason.trim() ? undefined : <span className="text-problem">Required for a later date.</span>}>
              <Textarea id="reason" rows={2} className="bg-white" placeholder="Client asked for a buffer" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}

          {yarnShort > 0 && (
            <p role="alert" className="flex items-center gap-2 rounded-lg bg-problem-bg px-3 py-2 text-xs font-medium text-problem">
              <AlertTriangle className="size-3.5 shrink-0" />
              Yarn short by {formatQty(yarnShort, 'kg')} after stock kept for open orders: order it now.
            </p>
          )}

          {/* The stage-by-stage dates, for anyone who wants to see how the date was reached. */}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">How this date is worked out</summary>
            <ol className="mt-2 space-y-1">
              {estimate.stages.map((s) => (
                <li key={s.stage} className="flex justify-between gap-3">
                  <span className="text-ink-2">
                    {s.stage.charAt(0) + s.stage.slice(1).toLowerCase()} · {formatQty(s.qty, s.unit)}
                  </span>
                  <span className="tabular-nums">
                    {formatDate(s.start)}
                    {s.end !== s.start && ` → ${formatDate(s.end)}`}
                  </span>
                </li>
              ))}
              <li className="flex justify-between gap-3">
                <span className="text-ink-2">Quality check and dispatch</span>
                <span className="tabular-nums">
                  {formatDate(estimate.qcDay!)} → {formatDate(estDate)}
                </span>
              </li>
            </ol>
          </details>
        </>
      )}
    </div>
  )
}

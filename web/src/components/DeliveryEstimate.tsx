import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Field } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { addDays, checkCommitment, daysBetween, estimateDelivery, MAX_OVERRIDE_DAYS, type PlanInput, type Stage } from '@/lib/deadline'
import { dayFromToday, formatDate, formatQty } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import type { Planning, RawMaterial, Roll } from '@/types'

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
    return estimateDelivery(plan, { yarnKg, metres: qty, reworkRate, yarnShortKg: yarnShort })
  }, [planning.data, yarnKg, qty, reworkRate, yarnShort])

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
    <div className="space-y-3 rounded-xl border bg-ground/60 p-4" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Delivery date</p>
        <Button type="button" variant="ghost" size="xs" className="gap-1" onClick={planning.reload} disabled={planning.loading}>
          <RefreshCw className="size-3" />
          Refresh workload
        </Button>
      </div>

      {planning.error && <p className="text-sm text-problem">Could not load the production plan: {planning.error}</p>}
      {!planning.error && !estimate && <Skeleton className="h-24" />}
      {estimate && !estimate.ok && (
        <div className="flex gap-2 rounded-lg bg-watch-bg p-3 text-sm text-watch">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>{estimate.limitation}</p>
        </div>
      )}

      {estimate?.ok && estDate && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-brand-tint p-3">
              <p className="text-xs text-ink-2">System estimate</p>
              <p className="mt-0.5 text-xl font-semibold tracking-tight text-brand">{formatDate(estDate)}</p>
              <p className="text-xs text-ink-3">{plural(daysBetween(today, estDate), 'day')} from today</p>
            </div>
            <div className="rounded-lg border bg-surface p-3">
              <p className="text-xs text-ink-2">Promised to buyer</p>
              <p className="mt-0.5 text-xl font-semibold tracking-tight">{formatDate(committed)}</p>
              <p className="text-xs text-ink-3">{overridden ? `${plural(daysBetween(estDate, committed), 'day')} after the estimate` : 'Same as the estimate'}</p>
            </div>
          </div>

          <ol className="space-y-1 text-xs">
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
              <span className="text-ink-2">Quality check, then dispatch preparation</span>
              <span className="tabular-nums">
                {formatDate(estimate.qcDay!)} → {formatDate(estDate)}
              </span>
            </li>
          </ol>

          {yarnShort > 0 && (
            <p role="alert" className="flex items-center gap-2 rounded-lg bg-problem-bg px-3 py-2 text-sm font-medium text-problem">
              <AlertTriangle className="size-4 shrink-0" />
              Yarn short by {formatQty(yarnShort, 'kg')} after stock kept for open orders: order it now.
            </p>
          )}

          <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
            <Field
              label="Promise to buyer"
              htmlFor="commit"
              hint={commitError ? <span className="text-problem">{commitError}</span> : `${formatDate(estDate)} to ${formatDate(addDays(estDate, MAX_OVERRIDE_DAYS))}`}
            >
              <Input
                id="commit"
                type="date"
                min={estDate}
                max={addDays(estDate, MAX_OVERRIDE_DAYS)}
                value={commit || estDate}
                aria-invalid={!!commitError}
                onChange={(e) => setCommit(e.target.value)}
              />
            </Field>
            {overridden && (
              <Field label="Reason for the later date" htmlFor="reason" hint={reason.trim() ? 'Not stored yet: the API has no field for it.' : <span className="text-problem">Required for a later date.</span>}>
                <Textarea id="reason" rows={2} placeholder="Buyer asked for a buffer" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            )}
          </div>
        </>
      )}
    </div>
  )
}

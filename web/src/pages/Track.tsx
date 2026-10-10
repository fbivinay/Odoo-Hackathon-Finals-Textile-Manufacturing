import { useParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, formatDateTime, formatQty } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import type { Tracking } from '@/types'

export function Track() {
  const { token } = useParams()
  const { data: t, loading, error } = useApi<Tracking>(`/track/${token}`)

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-lg space-y-6">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink text-white">
            <Logo className="size-4" />
          </div>
          <span className="text-sm font-medium">Everest Textile Mills · Order tracking</span>
        </div>

        {loading && <Skeleton className="h-96 w-full" />}
        {error && <p className="card text-sm text-problem">{error}</p>}

        {t && (
          <div className="card space-y-6 p-6!">
            <div>
              <p className="text-xs text-muted-foreground">{t.buyer}</p>
              <h1 className="text-xl font-semibold tracking-tight">{t.orderNo}</h1>
              <p className="text-sm text-muted-foreground">
                {formatQty(t.qty)} {t.fabricType} · {t.colour} · due {formatDate(t.deadline)}
              </p>
              <p className={cn('mt-2 text-sm font-medium', t.isDelayed ? 'text-problem' : 'text-ink')}>
                {t.statusLabel}
                {t.isDelayed && ' · running late'}
              </p>
            </div>

            {t.status === 'CANCELLED' ? (
              <p className="text-sm font-medium text-problem">This order was cancelled.</p>
            ) : (
              <ol className="space-y-0">
                {t.timeline.map((s, i) => {
                  // Every reached step is `done`; the latest one is still in progress unless it's the last.
                  const now = s.done && (i === t.timeline.length - 1 ? false : !t.timeline[i + 1].done) && s.step !== 'READY'
                  const done = s.done && !now
                  return (
                    <li key={s.step} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className={cn(
                            'flex size-6 items-center justify-center rounded-full border-2 text-xs',
                            done && 'border-ink bg-ink text-white',
                            now && 'animate-pulse border-ink text-ink',
                            !done && !now && 'border-line text-ink-3/50',
                          )}
                        >
                          {done ? <Check className="size-3.5" /> : i + 1}
                        </span>
                        {i < t.timeline.length - 1 && <span className={cn('h-6 w-0.5', done ? 'bg-ink' : 'bg-line')} />}
                      </div>
                      <p className={cn('pt-0.5 text-sm', now ? 'font-medium text-ink' : done ? 'text-ink-2' : 'text-ink-3/60')}>
                        {s.label}
                        {now && <span className="ml-2 text-xs font-normal text-muted-foreground">in progress</span>}
                      </p>
                    </li>
                  )
                })}
              </ol>
            )}

            <dl className="grid grid-cols-3 gap-3 border-t pt-4 text-center">
              {[
                ['Ordered', t.qty],
                ['Ready to ship', t.qtyReady],
                ['Shipped', t.qtyDispatched],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="text-sm font-medium tabular-nums">{formatQty(v)}</dd>
                </div>
              ))}
            </dl>
            {t.dispatches.map((d) => (
              <p key={d.dispatchNo} className="text-xs text-muted-foreground">
                {d.dispatchNo} left {formatDateTime(d.dispatchedAt)}
                {d.vehicleNo && ` on ${d.vehicleNo}`}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

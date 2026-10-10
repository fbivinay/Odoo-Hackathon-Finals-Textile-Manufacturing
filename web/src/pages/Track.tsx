import { useParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, formatDateTime, formatQty } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import type { OrderStatus, Tracking } from '@/types'

// What the buyer sees for each step, in order.
const STEPS: { status: OrderStatus; title: string }[] = [
  { status: 'PENDING', title: 'Order received' },
  { status: 'SPINNING', title: 'Spinning yarn' },
  { status: 'WEAVING', title: 'Weaving' },
  { status: 'DYEING', title: 'Dyeing' },
  { status: 'QC', title: 'Quality check' },
  { status: 'READY', title: 'Ready to ship' },
  { status: 'DISPATCHED', title: 'Dispatched' },
]

export function Track() {
  const { token } = useParams()
  const { data: t, loading, error } = useApi<Tracking>(`/track/${token}`)
  const current = t ? STEPS.findIndex((s) => s.status === t.status) : -1

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10">
      <div className="mx-auto max-w-lg space-y-6">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-indigo-600 text-white">
            <Logo className="size-4" />
          </div>
          <span className="text-sm font-medium">Everest Textile Mills · Order tracking</span>
        </div>

        {loading && <Skeleton className="h-96 w-full" />}
        {error && <p className="rounded-lg border bg-white p-6 text-sm text-rose-600">{error}</p>}

        {t && (
          <div className="space-y-6 rounded-xl border bg-white p-6 shadow-sm">
            <div>
              <p className="text-xs text-muted-foreground">{t.buyerName}</p>
              <h1 className="text-xl font-semibold tracking-tight">{t.orderNo}</h1>
              <p className="text-sm text-muted-foreground">
                {formatQty(t.qty)} {t.fabricType} · {t.colour} · due {formatDate(t.deadline)}
              </p>
            </div>

            {t.status === 'CANCELLED' ? (
              <p className="text-sm font-medium text-rose-600">This order was cancelled.</p>
            ) : (
              <ol className="space-y-0">
                {STEPS.map((s, i) => {
                  const done = i < current || t.status === 'DISPATCHED'
                  const now = i === current && t.status !== 'DISPATCHED'
                  return (
                    <li key={s.status} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className={cn(
                            'flex size-6 items-center justify-center rounded-full border-2 text-xs',
                            done && 'border-indigo-600 bg-indigo-600 text-white',
                            now && 'border-indigo-600 text-indigo-600',
                            !done && !now && 'border-zinc-200 text-zinc-300',
                          )}
                        >
                          {done ? <Check className="size-3.5" /> : i + 1}
                        </span>
                        {i < STEPS.length - 1 && <span className={cn('h-6 w-0.5', done ? 'bg-indigo-600' : 'bg-zinc-200')} />}
                      </div>
                      <p className={cn('pt-0.5 text-sm', now ? 'font-medium text-indigo-700' : done ? 'text-zinc-900' : 'text-zinc-400')}>
                        {s.title}
                        {now && <span className="ml-2 text-xs font-normal text-muted-foreground">in progress</span>}
                      </p>
                    </li>
                  )
                })}
              </ol>
            )}

            <dl className="grid grid-cols-3 gap-3 border-t pt-4 text-center">
              {[
                ['Produced', t.producedQty],
                ['Passed QC', t.passedQty],
                ['Shipped', t.dispatchedQty],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="text-sm font-medium tabular-nums">{formatQty(v)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">Last update {formatDateTime(t.updatedAt)}</p>
          </div>
        )}
      </div>
    </div>
  )
}

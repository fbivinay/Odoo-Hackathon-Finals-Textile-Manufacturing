import type { ReactNode } from 'react'
import { CountUp } from '@/components/CountUp'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// One box of a figures panel (Overview, Orders): a big number, a label and a short note.
// With `onClick` the box is a button (Orders uses it to filter the list below); `active` marks
// the box whose filter is applied.
export function Figure({
  label,
  value,
  note,
  tone,
  loading,
  onClick,
  active,
}: {
  label: string
  value: string
  note?: ReactNode // a short line; may colour a figure inside it
  tone?: 'good' | 'watch' | 'problem'
  loading?: boolean
  onClick?: () => void
  active?: boolean
}) {
  const body = (
    <>
      <p className="figure__label">{label}</p>
      {loading ? (
        <Skeleton className="mx-auto mt-2 h-9 w-32" />
      ) : (
        <p className={cn('figure__value', value.length > 10 && 'figure__value--long')} title={value.length > 10 ? value : undefined}>
          <CountUp text={value} />
        </p>
      )}
      {note && !loading && <p className="figure__note">{note}</p>}
    </>
  )
  const cls = cn('figure', tone && `figure--${tone}`)
  if (!onClick) return <div className={cls}>{body}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(cls, 'w-full cursor-pointer rounded-xl transition hover:ring-2 hover:ring-brand/30 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none', active && 'ring-2 ring-brand')}
    >
      {body}
    </button>
  )
}

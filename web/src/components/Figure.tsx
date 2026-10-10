import { CountUp } from '@/components/CountUp'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// One box of a figures panel (Overview, Orders): a big number, a label and a short note.
export function Figure({ label, value, note, tone, loading }: { label: string; value: string; note?: string; tone?: 'good' | 'watch' | 'problem'; loading?: boolean }) {
  return (
    <div className={cn('figure', tone && `figure--${tone}`)}>
      <p className="figure__label">{label}</p>
      {loading ? (
        <Skeleton className="mx-auto mt-2 h-9 w-32" />
      ) : (
        <p className="figure__value">
          <CountUp text={value} />
        </p>
      )}
      {note && !loading && <p className="figure__note">{note}</p>}
    </div>
  )
}

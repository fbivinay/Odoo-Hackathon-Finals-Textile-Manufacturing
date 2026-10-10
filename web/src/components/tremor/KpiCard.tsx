import type { ReactNode } from 'react'
import { CountUp } from '@/components/CountUp'
import { cn } from '@/lib/utils'

interface Props {
  label: string
  value: ReactNode
  hint?: ReactNode
  loading?: boolean
  tone?: 'good' | 'watch' | 'problem'
  className?: string
}

// Glass stat tile. String values count up when they come into view.
export function KpiCard({ label, value, hint, loading, tone, className }: Props) {
  return (
    <div className={cn('stat-card', tone && `stat-card--${tone}`, className)}>
      <p className="stat-card__label">{label}</p>
      {loading ? (
        <div className="skel mt-2 h-6 w-20" />
      ) : (
        <p className="stat-card__value">{typeof value === 'string' || typeof value === 'number' ? <CountUp text={String(value)} /> : value}</p>
      )}
      {hint && !loading && <p className="stat-card__note">{hint}</p>}
    </div>
  )
}

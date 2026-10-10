import { cn } from '@/lib/utils'

export type Tone = 'good' | 'watch' | 'problem' | 'neutral' | 'ink'

// Colour only ever means status: good / watch / problem / neutral. Stages in progress are ink.
const STATUS_TONE: Record<string, Tone> = {
  PENDING: 'neutral', SPINNING: 'ink', WEAVING: 'ink', DYEING: 'ink', QC: 'watch', READY: 'good', DISPATCHED: 'neutral', CANCELLED: 'problem',
  IDLE: 'watch', RUNNING: 'good', BREAKDOWN: 'problem', MAINTENANCE: 'neutral',
  PENDING_QC: 'watch', PASSED: 'good', REWORK: 'watch', REJECTED: 'problem',
  PASS: 'good', REJECT: 'problem',
  UNPAID: 'problem', PARTIAL: 'watch', PAID: 'good',
  COMPLETED: 'good', STOPPED: 'neutral',
}

export const label = (s: string) => (s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')).replace(/\bqc\b/i, 'QC')

export function Pill({ children, tone = 'neutral', className }: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return <span className={cn('pill', `pill--${tone}`, className)}>{children}</span>
}

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return <Pill tone={STATUS_TONE[status] ?? 'neutral'} className={className}>{label(status)}</Pill>
}

import { cn } from '@/lib/utils'

const TONE = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  zinc: 'bg-zinc-100 text-zinc-700 ring-zinc-500/20',
}

const STATUS_TONE: Record<string, keyof typeof TONE> = {
  PENDING: 'zinc', SPINNING: 'blue', WEAVING: 'blue', DYEING: 'violet', QC: 'amber', READY: 'green', DISPATCHED: 'zinc', CANCELLED: 'red',
  IDLE: 'amber', RUNNING: 'green', BREAKDOWN: 'red', MAINTENANCE: 'zinc',
  PENDING_QC: 'amber', PASSED: 'green', REWORK: 'violet', REJECTED: 'red',
  PASS: 'green', REJECT: 'red',
  UNPAID: 'red', PARTIAL: 'amber', PAID: 'green',
  COMPLETED: 'green', STOPPED: 'zinc',
}

export const label = (s: string) => (s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')).replace(/\bqc\b/i, 'QC')

export function Pill({ children, tone = 'zinc', className }: { children: React.ReactNode; tone?: keyof typeof TONE; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', TONE[tone], className)}>
      {children}
    </span>
  )
}

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return <Pill tone={STATUS_TONE[status] ?? 'zinc'} className={className}>{label(status)}</Pill>
}

import { Pill } from '@/components/StatusPill'
import { cn } from '@/lib/utils'

// Where a figure comes from, so actual data, calculations, owner inputs and AI text never blur.
const KIND = {
  actual: { text: 'Actual', tone: 'good', title: 'From the mill’s records' },
  estimate: { text: 'Estimate', tone: 'watch', title: 'Calculated by the Lab from the records' },
  assumption: { text: 'Assumption', tone: 'neutral', title: 'Your input or a stated rule of thumb' },
  ai: { text: 'AI', tone: 'ink', title: 'Written by AI from the calculated figures' },
  rules: { text: 'Rule-based', tone: 'neutral', title: 'Written by fixed rules from the calculated figures' },
  aiPowered: { text: 'AI Powered', tone: 'ink', title: 'Found automatically from the records and a simulation of the plan' },
} as const

export function Tag({ kind, className }: { kind: keyof typeof KIND; className?: string }) {
  const k = KIND[kind]
  return (
    <Pill tone={k.tone} className={cn('align-middle text-[10px]', className)}>
      <span title={k.title}>{k.text}</span>
    </Pill>
  )
}

// How strongly the records (and, where there is one, the simulated gain) back a recommendation.
export function Confidence({ level, pct }: { level: 'HIGH' | 'MEDIUM' | 'LOW'; pct: number }) {
  return (
    <Pill tone={level === 'HIGH' ? 'good' : level === 'MEDIUM' ? 'watch' : 'neutral'}>
      <span title="How strongly the records and the simulated gain support this">{pct}% confidence</span>
    </Pill>
  )
}

export function Section({ title, tag, children, className, actions }: { title: string; tag?: keyof typeof KIND; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <section className={cn('data-table-wrap space-y-3 p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-head flex items-center gap-2">
          {title}
          {tag && <Tag kind={tag} />}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  )
}
